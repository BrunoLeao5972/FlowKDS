/**
 * ConfigDialog
 *
 * Modal central de configurações do sistema KDS.
 * Contém abas para:
 *   - Restaurante: dados cadastrais (nome fantasia, razão social, CNPJ, endereço detalhado) e licença.
 *   - Timer: tempos de preparo, alerta e crítico para coloração dos cards da cozinha.
 *   - Usuários: criação e remoção de usuários do sistema.
 *   - Permissões: controle de acesso por tela para cada usuário.
 *   - Relatórios: visualização e exportação (CSV/PDF) de indicadores operacionais.
 *
 * Persiste as configurações via SettingsContext, que salva em localStorage.
 * A comunicação com a API usa o token JWT salvo em kds_auth_token.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { APP_VERSION } from '@/lib/version';

/**
 * Props recebidas pelo ConfigDialog.
 * onSave é chamado quando o usuário clica em Ok e a validação passa.
 * ThemeToggle é o componente de alternância de tema injetado pelo AppNav.
 */
interface ConfigDialogProps {
  tempoMedio: number;
  tempoCritico: number;
  tempoAlerta: number;
  onSave: (
    tempoMedio: number,
    tempoCritico: number,
    tempoAlerta: number,
    orderMode: 'continuous' | 'daily-reset' | 'custom-start',
    startNumber: number,
    restaurantTradeName: string,
    restaurantLegalName: string,
    restaurantCnpj: string,
    restaurantCep: string,
    restaurantStreet: string,
    restaurantNumber: string,
    restaurantCity: string,
    restaurantComplement: string,
    licenseFileName: string | null,
    licenseContent: string | null,
    newOrderSound: string | null,
    readyOrderSound: string | null,
    newOrderEnabled: boolean,
    readyEnabled: boolean,
    printerName: string,
    printSize: '58mm' | '80mm' | 'A4',
    printScale: number
  ) => void;
  ThemeToggle: React.ReactNode;
  orderNumberMode: 'continuous' | 'daily-reset' | 'custom-start';
  customStartNumber: number;
}

/** Representa um usuário cadastrado no banco, retornado pela API /users. */
interface UserData {
  _id: string;
  username: string;
  createdAt: string;
  /** Lista de permissões: admin | kitchen | display | settings | cook */
  permissions: string[];
  /** IDs de setores permitidos para o usuário aceitar/preparar pedidos. */
  sectorIds: string[];
}

interface SectorData {
  id: string;
  name: string;
  sortOrder?: number;
}

/**
 * Shape do payload retornado por GET /reports/operational.
 * Todos os campos são opcionais pois dependem de pedidos no período.
 */
interface OperationalReportData {
  operationalReports?: {
    totalsByPeriod?: {
      daily?: Array<{ day: string; total: number }>;
      weekly?: Array<{ year: number; week: number; total: number }>;
      monthly?: Array<{ year: number; month: number; total: number }>;
    };
    ordersByHour?: Array<{ hour: number; total: number }>;
    preparation?: {
      averagePrepTimeMin?: number | null;
      averageByStageMin?: {
        createdToAccepted?: number | null;
        acceptedToStarted?: number | null;
        startedToFinished?: number | null;
      };
    };
    cancellations?: {
      totalCancelled?: number;
      cancellationRatePct?: number;
      byStage?: Array<{ stage: string; total: number; ratePct: number }>;
    };
  };
  performanceMetrics?: {
    slaMinutes?: number;
    comparableOrders?: number;
    withinSlaOrders?: number;
    outsideSlaOrders?: number;
    slaWithinPct?: number;
    averageDelayMinutes?: number | null;
    delayedOrders?: number;
    averageWaitBeforePreparationMinutes?: number | null;
  };
  teamProductivity?: {
    byCook?: Array<{
      cookId: string;
      totalOrders: number;
      orderNumbers?: number[];
      avgPrepTimeMin: number | null;
      lateOrders: number;
      lateRatePct: number;
    }>;
  };
  operationalEfficiency?: {
    idleTimeTotalMinutes?: number | null;
    averageTimeBetweenOrdersMinutes?: number | null;
    idleBreakThresholdMinutes?: number | null;
    ignoredIdleGaps?: number;
    ignoredBetweenOrderGaps?: number;
    simultaneousOrders?: {
      max?: number;
      average?: number;
    };
    estimatedKitchenCapacityPerHour?: number | null;
  };
  orderFlow?: {
    averageTotalOrderTimeMinutes?: number | null;
    reprocessing?: {
      ordersWithReprocessing?: number;
    };
  };
}

export default function ConfigDialog({ tempoMedio, tempoCritico, tempoAlerta, orderNumberMode, customStartNumber, onSave, ThemeToggle }: ConfigDialogProps) {
  // Controla qual aba está ativa na navegação principal
  const [activeTab, setActiveTab] = useState<'restaurant' | 'users'>('restaurant');

  // Flags para os painéis que substituem o conteúdo das abas principais
  const [showUsersPanel, setShowUsersPanel] = useState(false);
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [showReportsPanel, setShowReportsPanel] = useState(false);
  const [showSupportPanel, setShowSupportPanel] = useState(false);

  // Estados de erro e carregamento para o painel de permissões
  const [permError, setPermError] = useState('');

  // Estados do painel de relatórios operacionais
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [reportData, setReportData] = useState<OperationalReportData | null>(null);

  // Filtros de data/hora para o relatório — valores padrão cobrem o dia inteiro
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportFromTime, setReportFromTime] = useState('00:00');
  const [reportToTime, setReportToTime] = useState('23:59');

  // Cópias locais dos tempos de timer — só são aplicadas ao clicar em Ok
  const [medio, setMedio] = useState(tempoMedio);
  const [critico, setCritico] = useState(tempoCritico);
  const [alerta, setAlerta] = useState(tempoAlerta);

  // Modo e número inicial de numeração de pedidos
  const [orderMode, setOrderMode] = useState<'continuous' | 'daily-reset' | 'custom-start'>(orderNumberMode || 'continuous');
  const [startNumber, setStartNumber] = useState<number>(customStartNumber || 100);

  const settings = useSettings();

  // Ref para o input de arquivo de licença (acionado programaticamente pelo botão)
  const licenseInputRef = useRef<HTMLInputElement | null>(null);

  // Dados cadastrais do restaurante — inicializados com os valores já salvos no contexto
  const [restaurantTradeName, setRestaurantTradeName] = useState(settings.restaurantTradeName || '');
  const [restaurantLegalName, setRestaurantLegalName] = useState(settings.restaurantLegalName || '');
  const [restaurantCnpj, setRestaurantCnpj] = useState(settings.restaurantCnpj || '');

  // Campos de endereço detalhado
  const [restaurantCep, setRestaurantCep] = useState(settings.restaurantCep || '');
  const [restaurantStreet, setRestaurantStreet] = useState(settings.restaurantStreet || '');
  const [restaurantNumber, setRestaurantNumber] = useState(settings.restaurantNumber || '');
  const [restaurantCity, setRestaurantCity] = useState(settings.restaurantCity || '');
  const [restaurantComplement, setRestaurantComplement] = useState(settings.restaurantComplement || '');

  // Mensagem de erro de validação exibida na aba Restaurante
  const [restaurantError, setRestaurantError] = useState('');

  // Licença do sistema: nome do arquivo e conteúdo bruto (texto)
  const [licenseFileName, setLicenseFileName] = useState<string | null>(settings.licenseFileName || null);
  const [licenseContent, setLicenseContent] = useState<string | null>(settings.licenseContent || null);

  // Sons configuráveis: data URL do arquivo de áudio e flag de ativação
  const [newOrderSoundData, setNewOrderSoundData] = useState<string | null>(settings.newOrderSound || null);
  const [readyOrderSoundData, setReadyOrderSoundData] = useState<string | null>(settings.readyOrderSound || null);
  const [newOrderEnabled, setNewOrderEnabled] = useState<boolean>(settings.newOrderSoundEnabled ?? true);
  const [readyEnabled, setReadyEnabled] = useState<boolean>(settings.readyOrderSoundEnabled ?? true);
  const [printerName, setPrinterName] = useState(settings.printerName || '');
  const [printSize, setPrintSize] = useState<'58mm' | '80mm' | 'A4'>(settings.printSize || '80mm');

  // Lista de usuários carregada da API e paginação dos painéis de Usuários e Permissões
  const [users, setUsers] = useState<UserData[]>([]);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [currentUsersPage, setCurrentUsersPage] = useState(1);
  const [currentPermsPage, setCurrentPermsPage] = useState(1);

  // Campos do formulário de criação de novo usuário
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUserSectorIds, setNewUserSectorIds] = useState<string[]>([]);
  const [newUserSectorToAdd, setNewUserSectorToAdd] = useState('');
  const [userSectorToAddByUserId, setUserSectorToAddByUserId] = useState<Record<string, string>>({});
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editUserLoading, setEditUserLoading] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');

  /** Itens exibidos por página no painel de Usuários */
  const USERS_PER_PAGE = 3;
  /** Itens exibidos por página no painel de Permissões */
  const PERMS_PER_PAGE = 8;

  /**
   * Capitaliza cada palavra do nome de usuário para exibição.
   * Ex: "joao silva" → "Joao Silva"
   */
  const formatDisplayName = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

  const formatCookName = (name: string) => {
    const raw = String(name || '').trim();
    if (!raw || raw.toLowerCase() === 'unassigned') return 'Nao atribuido';
    return formatDisplayName(raw);
  };

  const getSectorName = (sectorId: string) => {
    const found = sectors.find(s => s.id === sectorId);
    return found?.name || `Setor ${sectorId}`;
  };

  const HelpHint = ({ text, position = 'top' }: { text: string; position?: 'top' | 'left' | 'right' }) => (
    <span className="relative group inline-flex items-center justify-center w-5 h-5 rounded-full border border-muted-foreground/40 text-[11px] font-bold text-muted-foreground cursor-help select-none" aria-label={text}>
      ?
      <span className={`pointer-events-none absolute z-20 hidden group-hover:block group-focus:block w-64 rounded-md bg-zinc-900 text-white text-[11px] leading-snug p-2 shadow-lg ${
        position === 'left'
          ? 'right-[125%] top-1/2 -translate-y-1/2'
          : position === 'right'
            ? 'left-[125%] top-1/2 -translate-y-1/2'
            : 'bottom-[120%] right-0'
      }`}>
        {text}
      </span>
    </span>
  );

  /**
   * Retorna a URL base da API.
   * Em desenvolvimento (porta 5173 do Vite), aponta para o backend na porta 8081.
   * Em produção, usa a mesma origem da aplicação.
   */
  const getApiBase = () => {
    const port = window.location.port;
    if (port === '5173') {
      return `${window.location.protocol}//${window.location.hostname}:8081`;
    }
    return window.location.origin;
  };

  /**
   * Converte data + hora para timestamp em milissegundos.
   * isEnd=true ajusta o horário para 23:59:59.999 (fim do dia), caso necessário.
   * Retorna null se a data for vazia ou inválida.
   */
  const toBoundaryMs = (dateStr: string, timeStr: string, isEnd: boolean) => {
    if (!dateStr) return null;
    const normalizedTime = /^\d{2}:\d{2}$/.test(timeStr)
      ? `${timeStr}:${isEnd ? '59.999' : '00.000'}`
      : isEnd
        ? '23:59:59.999'
        : '00:00:00.000';
    const d = new Date(`${dateStr}T${normalizedTime}`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  };

  // Dispara o carregamento de usuários ao abrir o painel de Usuários ou Permissões
  useEffect(() => {
    if (showUsersPanel || showPermissionsPanel) {
      loadUsers();
      loadSectors();
    }
  }, [showUsersPanel, showPermissionsPanel]);

  // Dispara o carregamento de relatórios ao abrir o painel de Relatórios
  useEffect(() => {
    if (showReportsPanel) {
      loadReports();
    }
  }, [showReportsPanel]);

  /**
   * Busca a lista de usuários em GET /users.
   * Normaliza campos opcionais (_id vs id) e reinicia a paginação.
   */
  const loadUsers = async () => {
    try {
      const response = await fetch(`${getApiBase()}/users`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}` }
      });
      if (!response.ok) throw new Error('Failed to load users');
      const data = await response.json();
      const normalized = (data || []).map((u: any) => ({
        _id: u._id || u.id,
        username: u.username,
        createdAt: u.createdAt,
        permissions: u.permissions || ['admin', 'kitchen', 'display', 'settings', 'cook'],
        sectorIds: Array.isArray(u.sectorIds) ? u.sectorIds.map((s: any) => String(s)) : [],
      }));
      setUsers(normalized);
      setCurrentUsersPage(1);
      setCurrentPermsPage(1);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadSectors = async () => {
    try {
      const response = await fetch(`${getApiBase()}/sectors`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}` }
      });
      if (!response.ok) throw new Error('Failed to load sectors');
      const data = await response.json();
      const normalized = (data || []).map((s: any) => ({
        id: String(s.id),
        name: String(s.name || s.id),
        sortOrder: Number(s.sortOrder || 0),
      }));
      setSectors(normalized);
    } catch (error) {
      console.error('Error loading sectors:', error);
    }
  };

  /**
   * Busca os dados de relatório em GET /reports/operational.
   * Aplica os filtros de data/hora convertidos em timestamps.
   * O parâmetro slaMinutes define o limite de tempo para calcular o SLA.
   */
  const loadReports = async () => {
    setReportsLoading(true);
    setReportsError('');
    try {
      const fromMs = toBoundaryMs(reportFromDate, reportFromTime, false);
      const toMs = toBoundaryMs(reportToDate, reportToTime, true);
      if (fromMs !== null && toMs !== null && fromMs > toMs) {
        setReportsError('Data inicial não pode ser maior que a final');
        setReportsLoading(false);
        return;
      }

      const params = new URLSearchParams({ slaMinutes: String(tempoMedio || 20) });
      if (fromMs !== null) params.set('from', String(fromMs));
      if (toMs !== null) params.set('to', String(toMs));

      const response = await fetch(`${getApiBase()}/reports/operational?${params.toString()}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}` }
      });
      if (!response.ok) throw new Error('Failed to load reports');
      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error('Error loading reports:', error);
      setReportsError('Erro ao carregar relatórios operacionais');
    } finally {
      setReportsLoading(false);
    }
  };

  /**
   * Monta as linhas de resumo do relatório para exportação CSV/PDF.
   * Retorna array de pares [rótulo, valor] prontos para renderização em tabela.
   */
  const getReportSummaryRows = () => {
    if (!reportData) return [] as Array<[string, string]>;
    return [
      ['Tempo médio de preparo (min)', String(Math.round(reportData.operationalReports?.preparation?.averagePrepTimeMin ?? 0))],
      ['Taxa de cancelamento (%)', (reportData.operationalReports?.cancellations?.cancellationRatePct ?? 0).toFixed(1)],
      ['SLA dentro (%)', (reportData.performanceMetrics?.slaWithinPct ?? 0).toFixed(1)],
      ['Pedidos atrasados', String(reportData.performanceMetrics?.delayedOrders ?? 0)],
      ['Tempo ocioso total (min)', (reportData.operationalEfficiency?.idleTimeTotalMinutes ?? 0).toFixed(1)],
      ['Tempo médio entre pedidos (min)', String(Math.round(reportData.operationalEfficiency?.averageTimeBetweenOrdersMinutes ?? 0))],
      ['Simultâneos máximo', String(reportData.operationalEfficiency?.simultaneousOrders?.max ?? 0)],
      ['Tempo total médio do pedido (min)', String(Math.round(reportData.orderFlow?.averageTotalOrderTimeMinutes ?? 0))],
      ['Reprocessamentos detectados', String(reportData.orderFlow?.reprocessing?.ordersWithReprocessing ?? 0)],
    ];
  };

  /**
   * Cria um Blob com o conteúdo fornecido e dispara o download no navegador.
   * Revoga a URL temporária após o clique para evitar vazamento de memória.
   */
  const downloadFile = (content: string, fileName: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Exporta o relatório como arquivo CSV com BOM UTF-8 (compatível com Excel).
   * Inclui resumo operacional e detalhamento por cozinheiro.
   */
  const handleExportExcel = () => {
    if (!reportData) {
      setReportsError('Carregue os dados antes de exportar');
      return;
    }

    const rows = getReportSummaryRows();
    const cooks = reportData.teamProductivity?.byCook || [];
    const header = 'Categoria,Valor\n';
    const summaryCsv = rows
      .map(([k, v]) => `"${k.replace(/"/g, '""')}","${v.replace(/"/g, '""')}"`)
      .join('\n');

    const cooksHeader = '\n\nCozinheiro,Pedidos,Media(min),TaxaAtraso(%),PedidosProduzidos\n';
    const cooksCsv = cooks
      .map(cook => {
        const produced = (cook.orderNumbers || []).join(' | ');
        const cookName = formatCookName(String(cook.cookId));
        return `"${cookName.replace(/"/g, '""')}","${cook.totalOrders}","${Math.round(cook.avgPrepTimeMin ?? 0)}","${(cook.lateRatePct ?? 0).toFixed(1)}","${produced.replace(/"/g, '""')}"`;
      })
      .join('\n');

    const csv = `\uFEFF${header}${summaryCsv}${cooksHeader}${cooksCsv}`;
    downloadFile(csv, 'relatorio-operacional.csv', 'text/csv;charset=utf-8;');
  };

  /**
   * Exporta o relatório como PDF abrindo uma nova janela e acionando window.print().
   * Monta HTML inline com as tabelas de resumo e produtividade por cozinheiro.
   */
  const handleExportPdf = () => {
    if (!reportData) {
      setReportsError('Carregue os dados antes de exportar');
      return;
    }

    const rows = getReportSummaryRows();
    const cooks = reportData.teamProductivity?.byCook || [];
    const rangeText = `${reportFromDate || 'início'} ${reportFromTime || ''} até ${reportToDate || 'agora'} ${reportToTime || ''}`.trim();

    const summaryHtml = rows
      .map(([k, v]) => `<tr><td style="padding:6px 8px;border:1px solid #ddd;">${k}</td><td style="padding:6px 8px;border:1px solid #ddd;">${v}</td></tr>`)
      .join('');

    const cooksHtml = cooks
      .map(cook => `<tr>
          <td style="padding:6px 8px;border:1px solid #ddd;">${formatCookName(String(cook.cookId))}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${cook.totalOrders}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${Math.round(cook.avgPrepTimeMin ?? 0)}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${(cook.lateRatePct ?? 0).toFixed(1)}%</td>
          <td style="padding:6px 8px;border:1px solid #ddd;">${(cook.orderNumbers || []).join(', ')}</td>
        </tr>`)
      .join('');

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Relatório Operacional</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 20px; color: #222;">
          <h1 style="margin:0 0 8px;">Relatório Operacional</h1>
          <p style="margin:0 0 18px; color:#555;">Período: ${rangeText}</p>
          <h2 style="margin:0 0 8px; font-size:18px;">Resumo</h2>
          <table style="border-collapse:collapse; width:100%; margin-bottom:20px;">
            <tbody>${summaryHtml}</tbody>
          </table>
          <h2 style="margin:0 0 8px; font-size:18px;">Produtividade por cozinheiro</h2>
          <table style="border-collapse:collapse; width:100%;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">Cozinheiro</th>
                <th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">Pedidos</th>
                <th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">Média (min)</th>
                <th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">Taxa de atraso</th>
                <th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">Pedidos produzidos</th>
              </tr>
            </thead>
            <tbody>${cooksHtml}</tbody>
          </table>
        </body>
      </html>`;

    const win = window.open('', '_blank');
    if (!win) {
      setReportsError('Não foi possível abrir a janela para exportação em PDF');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  /** Lê um arquivo e resolve com seu conteúdo como Data URL (base64). Usado para sons. */
  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  /** Carrega o arquivo de som para novo pedido como Data URL. */
  const handleNewFile = async (f?: File) => {
    if (!f) return;
    try {
      const data = await readFileAsDataUrl(f);
      setNewOrderSoundData(data);
    } catch (e) {}
  };

  /** Carrega o arquivo de som para pedido pronto como Data URL. */
  const handleReadyFile = async (f?: File) => {
    if (!f) return;
    try {
      const data = await readFileAsDataUrl(f);
      setReadyOrderSoundData(data);
    } catch (e) {}
  };

  /** Toca uma prévia do som a partir de uma Data URL ou caminho absoluto. */
  const play = (src: string | null) => {
    if (!src) return;
    try {
      const a = new Audio(src);
      a.play();
    } catch (e) {}
  };

  /** Lê um arquivo e resolve com seu conteúdo como texto puro. Usado para o arquivo de licença. */
  const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsText(file);
  });

  /**
   * Aplica a máscara de CNPJ em tempo real: 00.000.000/0000-00.
   * Limita a entrada a 14 dígitos numéricos.
   */
  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  };

  /**
   * Aplica a máscara de CEP em tempo real: 00000-000.
   * Limita a entrada a 8 dígitos numéricos.
   */
  const formatCep = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
  };

  /**
   * Lê o arquivo de licença selecionado pelo usuário como texto.
   * Salva o nome e o conteúdo no estado local para persistência posterior.
   */
  const handleLicenseFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      setLicenseFileName(file.name);
      setLicenseContent(text);
    } catch (e) {
      console.error('Erro ao carregar licença:', e);
    }
  };

  /**
   * Cria um novo usuário via POST /users.
   * Valida campos obrigatórios e tamanho mínimo da senha antes de enviar.
   * Exibe erros específicos retornados pela API (ex: usuário já existe).
   */
  const handleAddUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      setUserError('Nome de usuário e senha são obrigatórios');
      return;
    }
    if (newPassword.length < 6) {
      setUserError('Senha deve ter no mínimo 6 caracteres');
      return;
    }

    setUserLoading(true);
    setUserError('');
    try {
      const response = await fetch(`${getApiBase()}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify({ username: newUsername, password: newPassword, sectorIds: newUserSectorIds })
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.error === 'username_already_exists') {
          setUserError('Isso nome de usuário já existe');
        } else if (error.error === 'password_too_short') {
          setUserError('Senha muito curta');
        } else {
          setUserError('Erro ao criar usuário');
        }
        return;
      }

      const newUser = await response.json();
      const normalizedNewUser: UserData = {
        _id: newUser._id || newUser.id,
        username: newUser.username,
        createdAt: newUser.createdAt,
        permissions: newUser.permissions || ['admin', 'kitchen', 'display', 'settings', 'cook'],
        sectorIds: Array.isArray(newUser.sectorIds) ? newUser.sectorIds.map((s: any) => String(s)) : [],
      };
      setUsers(prev => [...prev, normalizedNewUser]);
      setNewUsername('');
      setNewPassword('');
      setNewUserSectorIds([]);
      setNewUserSectorToAdd('');
    } catch (error) {
      console.error('Error adding user:', error);
      setUserError('Erro ao criar usuário');
    } finally {
      setUserLoading(false);
    }
  };

  /**
   * Remove um usuário via DELETE /users/:id.
   * Atualiza a lista local de usuários após a exclusão bem-sucedida.
   */
  const handleDeleteUser = async (id: string) => {
    try {
      const response = await fetch(`${getApiBase()}/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}` }
      });
      if (!response.ok) throw new Error('Failed to delete user');
      setUsers(prev => prev.filter(u => u._id !== id));
    } catch (error) {
      console.error('Error deleting user:', error);
      setUserError('Erro ao deletar usuário');
    }
  };

  /**
   * Adiciona ou remove uma permissão de um usuário via PATCH /users/:id/permissions.
   * A nova lista de permissões é calculada localmente e enviada completa para a API.
   */
  const handleTogglePermission = async (userId: string, perm: string, currentPerms: string[]) => {
    const newPerms = currentPerms.includes(perm)
      ? currentPerms.filter(p => p !== perm)
      : [...currentPerms, perm];
    setPermError('');
    try {
      const response = await fetch(`${getApiBase()}/users/${userId}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify({ permissions: newPerms })
      });
      if (!response.ok) throw new Error('Failed to update permissions');
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, permissions: newPerms } : u));
    } catch (error) {
      console.error('Error updating permissions:', error);
      setPermError('Erro ao atualizar permissões');
    }
  };

  const handleUpdateUserSectors = async (userId: string, newSectorIds: string[]) => {
    setPermError('');
    try {
      const response = await fetch(`${getApiBase()}/users/${userId}/sectors`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify({ sectorIds: newSectorIds })
      });
      if (!response.ok) throw new Error('Failed to update sectors');
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, sectorIds: newSectorIds } : u));
    } catch (error) {
      console.error('Error updating user sectors:', error);
      setPermError('Erro ao atualizar setores do usuário');
    }
  };

  const handleAddSectorToNewUser = () => {
    const sectorId = newUserSectorToAdd.trim();
    if (!sectorId) return;
    if (newUserSectorIds.includes(sectorId)) return;
    setNewUserSectorIds(prev => [...prev, sectorId]);
    setNewUserSectorToAdd('');
  };

  const handleRemoveSectorFromNewUser = (sectorId: string) => {
    setNewUserSectorIds(prev => prev.filter(id => id !== sectorId));
  };

  const startEditUser = (user: UserData) => {
    setEditingUserId(user._id);
    setEditUsername(user.username);
    setEditPassword('');
    setUserError('');
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUsername('');
    setEditPassword('');
  };

  const handleSaveEditedUser = async (userId: string) => {
    const usernameTrimmed = editUsername.trim();
    if (!usernameTrimmed) {
      setUserError('Nome de usuário é obrigatório');
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setUserError('Senha deve ter no mínimo 6 caracteres');
      return;
    }

    setEditUserLoading(true);
    setUserError('');
    try {
      const payload: Record<string, string> = { username: usernameTrimmed };
      if (editPassword.trim()) payload.password = editPassword;

      const response = await fetch(`${getApiBase()}/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === 'username_already_exists') {
          setUserError('Esse nome de usuário já existe');
        } else if (error.error === 'password_too_short') {
          setUserError('Senha deve ter no mínimo 6 caracteres');
        } else {
          setUserError('Erro ao editar usuário');
        }
        return;
      }

      const updated = await response.json();
      setUsers(prev => prev.map(u => u._id === userId ? {
        ...u,
        username: updated.username,
      } : u));
      cancelEditUser();
    } catch (error) {
      console.error('Error editing user:', error);
      setUserError('Erro ao editar usuário');
    } finally {
      setEditUserLoading(false);
    }
  };

  // Usuários ordenados alfabeticamente (pt-BR) para exibição consistente nos dois painéis
  const sortedUsers = [...users].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' }));

  // Paginação do painel de Usuários
  const totalUsersPages = Math.max(1, Math.ceil(sortedUsers.length / USERS_PER_PAGE));
  const safeUsersPage = Math.min(currentUsersPage, totalUsersPages);
  const paginatedUsers = sortedUsers.slice((safeUsersPage - 1) * USERS_PER_PAGE, safeUsersPage * USERS_PER_PAGE);

  // Paginação do painel de Permissões (limite maior pois não exibe botão de exclusão)
  const totalPermsPages = Math.max(1, Math.ceil(sortedUsers.length / PERMS_PER_PAGE));
  const safePermsPage = Math.min(currentPermsPage, totalPermsPages);
  const paginatedPermUsers = sortedUsers.slice((safePermsPage - 1) * PERMS_PER_PAGE, safePermsPage * PERMS_PER_PAGE);

  /**
   * Definição das abas navegáveis no topo do modal.
   * A ordem aqui determina a ordem visual dos botões.
  * Os painéis de Usuários, Permissões, Relatórios e Suporte são gerenciados
   * por flags separadas (showUsersPanel, etc.) pois estão fora desse array.
   */
  const tabs = [
    { id: 'restaurant', label: 'Cadastros' },
  ] as const;

  /**
   * Valida os campos obrigatórios da aba Restaurante antes de propagar o onSave.
   *
   * Regras:
   *   - CNPJ deve ter exatamente 14 dígitos.
   *   - CEP, se preenchido, deve ter exatamente 8 dígitos.
   *
   * Em caso de erro, redireciona para a aba Restaurante e exibe a mensagem inline.
   * Se a validação passar, chama onSave com todos os valores atuais do formulário.
   */
  const handleSave = () => {
    const cnpjDigits = restaurantCnpj.replace(/\D/g, '');
    const cepDigits = restaurantCep.replace(/\D/g, '');

    if (cnpjDigits.length !== 14) {
      setRestaurantError('CNPJ deve conter 14 dígitos.');
      setActiveTab('restaurant');
      setShowUsersPanel(false);
      setShowPermissionsPanel(false);
      setShowReportsPanel(false);
      setShowSupportPanel(false);
      return;
    }

    if (restaurantCep.trim().length > 0 && cepDigits.length !== 8) {
      setRestaurantError('CEP inválido. Use o formato 00000-000.');
      setActiveTab('restaurant');
      setShowUsersPanel(false);
      setShowPermissionsPanel(false);
      setShowReportsPanel(false);
      setShowSupportPanel(false);
      return;
    }

    setRestaurantError('');
    onSave(
      medio,
      critico,
      alerta,
      orderMode,
      startNumber,
      restaurantTradeName,
      restaurantLegalName,
      formatCnpj(restaurantCnpj),
      formatCep(restaurantCep),
      restaurantStreet,
      restaurantNumber,
      restaurantCity,
      restaurantComplement,
      licenseFileName,
      licenseContent,
      newOrderSoundData,
      readyOrderSoundData,
      newOrderEnabled,
      readyEnabled,
      printerName.trim(),
      printSize,
      115
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border-2 border-orange-500 w-[92%] max-w-2xl max-h-[78vh] flex flex-col">
        {/* Header e Abas */}
        <div className="border-b border-border rounded-t-2xl">
          <div className="p-4 pb-2">
            <h2 className="font-bold text-lg">Configurações</h2>
          </div>
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto whitespace-nowrap">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setShowUsersPanel(false);
                  setShowPermissionsPanel(false);
                  setShowReportsPanel(false);
                  setShowSupportPanel(false);
                  setActiveTab(tab.id);
                }}
                className={`shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  !showUsersPanel && !showPermissionsPanel && !showReportsPanel && !showSupportPanel && activeTab === tab.id
                    ? 'bg-orange-400 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-orange-100'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setShowPermissionsPanel(false);
                setShowReportsPanel(false);
                setShowSupportPanel(false);
                setShowUsersPanel(true);
                setActiveTab('users');
              }}
              className={`shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                showUsersPanel
                  ? 'bg-orange-400 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-orange-100'
              }`}
            >
              Usuários
            </button>

            <button
              type="button"
              onClick={() => {
                setShowUsersPanel(false);
                setShowReportsPanel(false);
                setShowSupportPanel(false);
                setShowPermissionsPanel(true);
                setActiveTab('users');
              }}
              className={`shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                showPermissionsPanel
                  ? 'bg-orange-400 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-orange-100'
              }`}
            >
              Permissões
            </button>

            <button
              type="button"
              onClick={() => {
                setShowUsersPanel(false);
                setShowPermissionsPanel(false);
                setShowSupportPanel(false);
                setShowReportsPanel(true);
                setActiveTab('users');
              }}
              className={`shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                showReportsPanel
                  ? 'bg-orange-400 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-orange-100'
              }`}
            >
              Relatórios
            </button>

            <button
              type="button"
              onClick={() => {
                setShowUsersPanel(false);
                setShowPermissionsPanel(false);
                setShowReportsPanel(false);
                setShowSupportPanel(true);
                setActiveTab('users');
              }}
              className={`shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                showSupportPanel
                  ? 'bg-orange-400 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-orange-100'
              }`}
            >
              Suporte
            </button>
          </div>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!showUsersPanel && activeTab === 'restaurant' && (
            <div className="space-y-3 max-w-xl">
              <div className="rounded-md border border-border p-3 bg-muted/20">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">Tema do sistema</p>
                  </div>
                  <div className="shrink-0">{ThemeToggle}</div>
                </div>
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium">Nome fantasia:</label>
                <input
                  type="text"
                  className="input w-full h-9 rounded-md text-sm"
                  value={restaurantTradeName}
                  onChange={e => setRestaurantTradeName(e.target.value)}
                  placeholder="Ex: Restaurante Durangos Burger"
                />
              </div>
              <div>
                <label className="block mb-1.5 text-sm font-medium">Razão social:</label>
                <input
                  type="text"
                  className="input w-full h-9 rounded-md text-sm"
                  value={restaurantLegalName}
                  onChange={e => setRestaurantLegalName(e.target.value)}
                  placeholder="Ex: Restaurante Durangos Burger LTDA"
                />
              </div>
              <div>
                <label className="block mb-1.5 text-sm font-medium">CNPJ:</label>
                <input
                  type="text"
                  className="input w-full h-9 rounded-md text-sm"
                  value={restaurantCnpj}
                  onChange={e => {
                    setRestaurantCnpj(formatCnpj(e.target.value));
                    if (restaurantError) setRestaurantError('');
                  }}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  maxLength={18}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5 text-sm font-medium">CEP:</label>
                  <input
                    type="text"
                    className="input w-full h-9 rounded-md text-sm"
                    value={restaurantCep}
                    onChange={e => {
                      setRestaurantCep(formatCep(e.target.value));
                      if (restaurantError) setRestaurantError('');
                    }}
                    placeholder="00000-000"
                    inputMode="numeric"
                    maxLength={9}
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Número:</label>
                  <input
                    type="text"
                    className="input w-full h-9 rounded-md text-sm"
                    value={restaurantNumber}
                    onChange={e => setRestaurantNumber(e.target.value)}
                    placeholder="Ex: 120"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5 text-sm font-medium">Endereço:</label>
                <input
                  type="text"
                  className="input w-full h-9 rounded-md text-sm"
                  value={restaurantStreet}
                  onChange={e => setRestaurantStreet(e.target.value)}
                  placeholder="Rua/Avenida"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Cidade/UF:</label>
                  <input
                    type="text"
                    className="input w-full h-9 rounded-md text-sm"
                    value={restaurantCity}
                    onChange={e => setRestaurantCity(e.target.value)}
                    placeholder="Ex: Fortaleza"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Complemento:</label>
                  <input
                    type="text"
                    className="input w-full h-9 rounded-md text-sm"
                    value={restaurantComplement}
                    onChange={e => setRestaurantComplement(e.target.value)}
                    placeholder="Ex: Sala 02, Fundos"
                  />
                </div>
              </div>

              {restaurantError && <p className="text-sm text-red-600">{restaurantError}</p>}

              <div className="rounded-md border border-border p-3 bg-muted/20 space-y-3">
                <p className="text-sm font-medium">Timer e Impressao</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1.5 text-sm font-medium">Tempo medio (min):</label>
                    <input
                      type="number"
                      className="input no-spinner w-full h-9 rounded-md text-sm"
                      value={medio}
                      onChange={e => setMedio(Number(e.target.value))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-sm font-medium">Tempo critico (min):</label>
                    <input
                      type="number"
                      className="input no-spinner w-full h-9 rounded-md text-sm"
                      value={critico}
                      onChange={e => setCritico(Number(e.target.value))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-sm font-medium">Tempo de alerta (min):</label>
                    <input
                      type="number"
                      className="input no-spinner w-full h-9 rounded-md text-sm"
                      value={alerta}
                      onChange={e => setAlerta(Number(e.target.value))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                  </div>
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Nome da impressora:</label>
                  <input
                    type="text"
                    className="input w-full h-9 rounded-md text-sm"
                    value={printerName}
                    onChange={e => setPrinterName(e.target.value)}
                    placeholder="Ex: Epson TM-T20"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-sm font-medium">Tamanho da impressao:</label>
                  <select
                    className="input w-full h-9 rounded-md text-sm"
                    value={printSize}
                    onChange={e => setPrintSize(e.target.value as '58mm' | '80mm' | 'A4')}
                  >
                    <option value="58mm">58mm</option>
                    <option value="80mm">80mm</option>
                    <option value="A4">A4</option>
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Prefixos aceitos no nome da impressora: IMPRESSORA:, HTML: ou FILE:. Sem prefixo, o sistema considera IMPRESSORA e envia direto para o Windows.
                </p>
              </div>
            </div>
          )}

          {/* TAB: PERMISSÕES */}
          {showPermissionsPanel && (
            <div className="space-y-3">
              <h3 className="font-semibold text-base">Permissões de Acesso</h3>
              <p className="text-sm text-muted-foreground">Defina quais páginas cada usuário pode acessar.</p>
              {permError && <p className="text-sm text-red-600">{permError}</p>}
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground px-2 pb-1 border-b">
                    <span>Usuário</span>
                    <span className="text-center">Admin</span>
                    <span className="text-center">Cozinha</span>
                    <span className="text-center">Painel</span>
                    <span className="text-center">Config.</span>
                    <span className="text-center">Cozinheiro</span>
                  </div>
                  {paginatedPermUsers.map(user => (
                    <div key={user._id} className="bg-muted/50 px-2 py-2.5 rounded-md space-y-2">
                      <div className="grid grid-cols-6 gap-2 items-center">
                        <span className="text-sm font-medium truncate">{formatDisplayName(user.username)}</span>
                        {(['admin', 'kitchen', 'display', 'settings', 'cook'] as const).map(perm => (
                          <label key={perm} className="flex justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-orange-500"
                              checked={user.permissions.includes(perm)}
                              onChange={() => handleTogglePermission(user._id, perm, user.permissions)}
                            />
                          </label>
                        ))}
                      </div>

                      <div className="rounded-md border border-border bg-background p-2">
                        <p className="text-xs font-medium mb-1">Setores permitidos para aceitar pedido:</p>
                        {sectors.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhum setor sincronizado.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <select
                                className="input h-8 text-xs flex-1"
                                value={userSectorToAddByUserId[user._id] || ''}
                                onChange={e => setUserSectorToAddByUserId(prev => ({ ...prev, [user._id]: e.target.value }))}
                              >
                                <option value="">Selecione um setor...</option>
                                {sectors
                                  .filter(sector => !user.sectorIds.includes(sector.id))
                                  .map(sector => (
                                    <option key={`${user._id}-opt-${sector.id}`} value={sector.id}>{sector.name}</option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                disabled={!userSectorToAddByUserId[user._id]}
                                onClick={() => {
                                  const sectorId = String(userSectorToAddByUserId[user._id] || '').trim();
                                  if (!sectorId) return;
                                  void handleUpdateUserSectors(user._id, [...user.sectorIds, sectorId]);
                                  setUserSectorToAddByUserId(prev => ({ ...prev, [user._id]: '' }));
                                }}
                                className="h-8 px-2 rounded-md border border-orange-300 text-orange-700 text-xs font-semibold disabled:opacity-50"
                              >
                                Adicionar
                              </button>
                            </div>

                            <div className="min-h-8 flex flex-wrap gap-1">
                              {user.sectorIds.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground">Nenhum setor liberado.</span>
                              ) : (
                                user.sectorIds.map(sectorId => (
                                  <span key={`${user._id}-sector-${sectorId}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
                                    {getSectorName(sectorId)}
                                    <button
                                      type="button"
                                      onClick={() => void handleUpdateUserSectors(user._id, user.sectorIds.filter(id => id !== sectorId))}
                                      className="text-orange-700 hover:text-orange-900"
                                      title="Remover setor"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {totalPermsPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPermsPage(prev => Math.max(1, prev - 1))}
                        disabled={safePermsPage === 1}
                        className="h-8 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
                      >
                        Anterior
                      </button>
                      <span className="text-xs text-muted-foreground">
                        Página {safePermsPage} de {totalPermsPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPermsPage(prev => Math.min(totalPermsPages, prev + 1))}
                        disabled={safePermsPage === totalPermsPages}
                        className="h-8 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
                      >
                        Próxima
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: RELATÓRIOS */}
          {showReportsPanel && (
            <div className="space-y-4">
              <div className="rounded-xl border border-orange-200/80 dark:border-orange-800/40 bg-gradient-to-br from-orange-50/80 to-amber-50/50 dark:from-orange-950/30 dark:to-amber-950/20 p-4">
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="font-bold text-base text-orange-900 dark:text-orange-200">Relatórios Operacionais</h3>
                    <p className="text-sm text-orange-800/80 dark:text-orange-200/80">Visual de performance por período com foco em produção, SLA e produtividade.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-xs font-medium text-orange-900/80 dark:text-orange-200/80">Data inicial</label>
                      <input
                        type="date"
                        value={reportFromDate}
                        onChange={e => setReportFromDate(e.target.value)}
                        className="h-10 w-full min-w-[190px] px-3 pr-10 rounded-md border border-input bg-background text-foreground text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-xs font-medium text-orange-900/80 dark:text-orange-200/80">Hora inicial</label>
                      <input
                        type="time"
                        value={reportFromTime}
                        onChange={e => setReportFromTime(e.target.value)}
                        className="h-10 w-full min-w-[170px] px-3 pr-10 rounded-md border border-input bg-background text-foreground text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-xs font-medium text-orange-900/80 dark:text-orange-200/80">Data final</label>
                      <input
                        type="date"
                        value={reportToDate}
                        onChange={e => setReportToDate(e.target.value)}
                        className="h-10 w-full min-w-[190px] px-3 pr-10 rounded-md border border-input bg-background text-foreground text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-xs font-medium text-orange-900/80 dark:text-orange-200/80">Hora final</label>
                      <input
                        type="time"
                        value={reportToTime}
                        onChange={e => setReportToTime(e.target.value)}
                        className="h-10 w-full min-w-[170px] px-3 pr-10 rounded-md border border-input bg-background text-foreground text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={reportsLoading || !reportData}
                      className="h-10 px-3 rounded-md border border-input bg-background text-foreground text-sm font-medium disabled:opacity-50"
                    >
                      Exportar PDF
                    </button>
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      disabled={reportsLoading || !reportData}
                      className="h-10 px-3 rounded-md border border-input bg-background text-foreground text-sm font-medium disabled:opacity-50"
                    >
                      Exportar Excel
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={loadReports}
                    disabled={reportsLoading}
                    className="h-10 px-4 rounded-md bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
                  >
                    {reportsLoading ? 'Atualizando...' : 'Aplicar Filtro'}
                  </button>
                </div>
              </div>

              {reportsError && <p className="text-sm text-red-600">{reportsError}</p>}

              {reportsLoading ? (
                <div className="rounded-xl border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  Carregando relatórios...
                </div>
              ) : !reportData ? (
                <div className="rounded-xl border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  Sem dados de relatório ainda.
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const dailyTotals = reportData.operationalReports?.totalsByPeriod?.daily || [];
                    const weeklyTotals = reportData.operationalReports?.totalsByPeriod?.weekly || [];
                    const monthlyTotals = reportData.operationalReports?.totalsByPeriod?.monthly || [];
                    const dailyOrders = dailyTotals.reduce((sum, item) => sum + Number(item.total || 0), 0);
                    const weeklyOrders = weeklyTotals.reduce((sum, item) => sum + Number(item.total || 0), 0);
                    const monthlyOrders = monthlyTotals.reduce((sum, item) => sum + Number(item.total || 0), 0);
                    const monthsLabel = monthlyTotals.length === 1 ? 'mes' : 'meses';
                    const idleThreshold = Math.round(reportData.operationalEfficiency?.idleBreakThresholdMinutes ?? 180);

                    return (
                      <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-orange-200 dark:border-orange-800/40 bg-card p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wide text-orange-700/80">Tempo médio</p>
                        <HelpHint position="right" text="Media de minutos entre inicio e finalizacao do preparo no periodo selecionado." />
                      </div>
                      <p className="text-2xl font-black text-orange-900">{Math.round(reportData.operationalReports?.preparation?.averagePrepTimeMin ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">min de preparo</p>
                    </div>
                    <div className="rounded-lg border border-red-200 dark:border-red-800/40 bg-card p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wide text-red-700/80">Cancelamento</p>
                        <HelpHint text="Percentual de pedidos cancelados sobre o total de pedidos no periodo." />
                      </div>
                      <p className="text-2xl font-black text-red-700">{(reportData.operationalReports?.cancellations?.cancellationRatePct ?? 0).toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">taxa no período</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-card p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wide text-emerald-700/80">SLA</p>
                        <HelpHint text="Percentual de pedidos concluidos dentro do tempo de SLA configurado." />
                      </div>
                      <p className="text-2xl font-black text-emerald-700">{(reportData.performanceMetrics?.slaWithinPct ?? 0).toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">pedidos dentro</p>
                    </div>
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-card p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wide text-amber-700/80">Atrasos</p>
                        <HelpHint text="Quantidade de pedidos que ultrapassaram o tempo de SLA no periodo." />
                      </div>
                      <p className="text-2xl font-black text-amber-700">{reportData.performanceMetrics?.delayedOrders ?? 0}</p>
                      <p className="text-xs text-muted-foreground">pedidos atrasados</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-bold">Totais por período</h4>
                        <HelpHint text="Volume total de pedidos agrupado por dia, semana e mes dentro do filtro aplicado." />
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Diário</span>
                        <span className="font-semibold">{dailyOrders} pedidos ({dailyTotals.length} dias)</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Semanal</span>
                        <span className="font-semibold">{weeklyOrders} pedidos ({weeklyTotals.length} semanas)</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Mensal</span>
                        <span className="font-semibold">{monthlyOrders} pedidos ({monthlyTotals.length} {monthsLabel})</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-bold">Eficiência Operacional</h4>
                        <HelpHint text="Indicadores de ociosidade e ritmo de entrada de pedidos, desconsiderando pausas longas e virada de dia." />
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tempo ocioso total</span>
                        <span className="font-semibold">{(reportData.operationalEfficiency?.idleTimeTotalMinutes ?? 0).toFixed(1)} min</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Média entre pedidos</span>
                        <span className="font-semibold">{Math.round(reportData.operationalEfficiency?.averageTimeBetweenOrdersMinutes ?? 0)} min</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Simultâneos (máx)</span>
                        <span className="font-semibold">{reportData.operationalEfficiency?.simultaneousOrders?.max ?? 0}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground pt-1">
                        Cálculo ignora pausas maiores que {idleThreshold} min e virada de dia para não considerar período fechado.
                      </p>
                    </div>
                  </div>
                      </>
                    );
                  })()}

                  <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold">Produtividade por cozinheiro</h4>
                      <HelpHint text="Desempenho por cozinheiro: volume, tempo medio de preparo e taxa de atraso no periodo." />
                    </div>
                    {(reportData.teamProductivity?.byCook || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem dados por cozinheiro no período.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="hidden md:grid md:grid-cols-5 gap-2 text-[11px] uppercase tracking-wide text-muted-foreground px-2">
                          <span>Cozinheiro</span>
                          <span>Pedidos</span>
                          <span>Média</span>
                          <span>Taxa atraso</span>
                          <span>Pedidos produzidos</span>
                        </div>
                        {(reportData.teamProductivity?.byCook || []).slice(0, 8).map(cook => (
                          <div key={cook.cookId} className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm rounded-md border border-border/70 bg-background p-2.5">
                            <span className="font-semibold truncate">{formatCookName(String(cook.cookId))}</span>
                            <span>{cook.totalOrders} pedidos</span>
                            <span>{Math.round(cook.avgPrepTimeMin ?? 0)} min</span>
                            <span>{(cook.lateRatePct ?? 0).toFixed(1)}%</span>
                            <div className="flex flex-wrap gap-1">
                              {(cook.orderNumbers || []).length > 0 ? (
                                (cook.orderNumbers || []).slice(0, 10).map(orderNumber => (
                                  <span key={`${cook.cookId}-${orderNumber}`} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-xs font-medium">
                                    {orderNumber}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">Sem pedidos</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold">Fluxo do Pedido</h4>
                      <HelpHint text="Tempo total do ciclo do pedido e quantidade de reprocessamentos detectados." />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Tempo total médio</span>
                      <span className="font-semibold">{Math.round(reportData.orderFlow?.averageTotalOrderTimeMinutes ?? 0)} min</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Reprocessamentos detectados</span>
                      <span className="font-semibold">{reportData.orderFlow?.reprocessing?.ordersWithReprocessing ?? 0}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: SUPORTE */}
          {showSupportPanel && (
            <div className="space-y-4">
              <div className="rounded-xl border border-orange-200/80 dark:border-orange-800/40 bg-gradient-to-br from-orange-50/80 to-amber-50/50 dark:from-orange-950/30 dark:to-amber-950/20 p-4">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-base text-orange-900 dark:text-orange-200">Suporte Solução Sistemas</h3>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-orange-200/70 dark:bg-orange-800/50 text-orange-800 dark:text-orange-200 select-all">
                    v{APP_VERSION}
                  </span>
                </div>
                <p className="text-sm text-orange-800/80 dark:text-orange-200/80 mt-1">
                  Canal rápido para atendimento, orientações e boas práticas de uso do KDS.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <h4 className="text-sm font-bold">Contato</h4>
                <p className="text-sm"><span className="font-semibold">Telefone/Whatsapp:</span> (85) 3307-6262</p>
                <p className="text-sm"><span className="font-semibold">E-mail:</span> bruno.leao@solucaosistemas.net</p>
                <p className="text-sm text-muted-foreground">
                  Nos envie uma sugestao de melhoria ou elogio por e-mail. Seu feedback ajuda na evolução do sistema.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <h4 className="text-sm font-bold">Preparação para suporte remoto</h4>
                <p className="text-sm text-muted-foreground">
                  Para agilizar o atendimento, recomendamos ter instalado na máquina um dos aplicativos abaixo:
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="https://anydesk.com/pt/downloads/windows"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-medium transition-colors underline-offset-2 hover:underline"
                  >
                    ↓ AnyDesk
                  </a>
                  <a
                    href="https://ultraviewer.net/pt/download.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded bg-orange-100 hover:bg-orange-200 text-orange-800 text-xs font-medium transition-colors underline-offset-2 hover:underline"
                  >
                    ↓ UltraViewer
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">
                  Deixe o código de acesso e senha temporária em mãos para reduzir o tempo de espera durante o chamado.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <h4 className="text-sm font-bold">Informações que ajudam no atendimento do KDS</h4>
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  <li>Nome da loja/unidade e contato do responsável no local.</li>
                  <li>Descrição objetiva do problema e horário em que ocorreu.</li>
                  <li>Número do pedido afetado (quando houver).</li>
                  <li>Status em que o pedido ficou (Recebido, Em preparo, Pronto, etc.).</li>
                  <li>Impressora configurada e modo de impressão (IMPRESSORA, HTML ou FILE).</li>
                  <li>Se possível, anexar print da tela ou mensagem de erro exibida.</li>
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <h4 className="text-sm font-bold">Checklist rápido antes de abrir chamado</h4>
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  <li>Verifique conexão de rede/internet da máquina.</li>
                  <li>Confirme se a impressora está ligada e definida no Windows.</li>
                  <li>Reinicie o KDS e teste novamente com um pedido de validação.</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB: USUÁRIOS */}
          {showUsersPanel && (
            <div className="space-y-3">
              <h3 className="font-semibold text-base">Gerenciar Usuários</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* Formulário de novo usuário */}
                <div className="bg-muted/50 p-3 rounded-md space-y-2.5">
                  <h4 className="text-sm font-medium">Criar novo usuário</h4>
                  <div>
                    <label className="block text-sm mb-1">Nome de usuário:</label>
                    <input
                      type="text"
                      className="input w-full h-9 text-sm"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder="Ex: gerente"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Senha:</label>
                    <input
                      type="password"
                      className="input w-full h-9 text-sm"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Digite a senha"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Setores permitidos:</label>
                    {sectors.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum setor sincronizado ainda.</p>
                    ) : (
                      <div className="space-y-2 rounded-md border border-border bg-background p-2">
                        <div className="flex gap-2">
                          <select
                            className="input h-8 text-xs flex-1"
                            value={newUserSectorToAdd}
                            onChange={e => setNewUserSectorToAdd(e.target.value)}
                          >
                            <option value="">Selecione um setor...</option>
                            {sectors
                              .filter(sector => !newUserSectorIds.includes(sector.id))
                              .map(sector => (
                                <option key={sector.id} value={sector.id}>{sector.name}</option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleAddSectorToNewUser}
                            disabled={!newUserSectorToAdd}
                            className="h-8 px-2 rounded-md border border-orange-300 text-orange-700 text-xs font-semibold disabled:opacity-50"
                          >
                            Adicionar
                          </button>
                        </div>

                        <div className="min-h-8 flex flex-wrap gap-1">
                          {newUserSectorIds.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">Nenhum setor adicionado.</span>
                          ) : (
                            newUserSectorIds.map(sectorId => (
                              <span key={sectorId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
                                {getSectorName(sectorId)}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSectorFromNewUser(sectorId)}
                                  className="text-orange-700 hover:text-orange-900"
                                  title="Remover setor"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">O usuário pode ter múltiplos setores.</p>
                  </div>
                  <button
                    onClick={handleAddUser}
                    disabled={userLoading}
                    className="w-full h-9 px-3 rounded-md bg-green-500 text-white text-sm font-medium hover:bg-green-600 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" /> {userLoading ? 'Adicionando...' : 'Adicionar usuário'}
                  </button>
                  {userError && <p className="text-sm text-red-600 text-center">{userError}</p>}
                </div>

                {/* Lista de usuários */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Usuários cadastrados:</h4>
                  {sortedUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum usuário criado ainda.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        {paginatedUsers.map(user => (
                          <div key={user._id} className="bg-muted p-2.5 rounded-md space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-sm font-medium">{formatDisplayName(user.username)}</span>
                                <p className="text-xs text-muted-foreground">Criado em {new Date(user.createdAt).toLocaleDateString('pt-BR')}</p>
                                <p className="text-xs text-muted-foreground">Setores permitidos: {user.sectorIds.length}</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => startEditUser(user)}
                                  className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900 rounded text-blue-600 transition-colors"
                                  title="Editar usuário"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(user._id)}
                                  className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600 transition-colors"
                                  title="Remover usuário"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {editingUserId === user._id && (
                              <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
                                <div>
                                  <label className="block text-xs mb-1">Editar nome de usuário:</label>
                                  <input
                                    type="text"
                                    className="input w-full h-8 text-sm"
                                    value={editUsername}
                                    onChange={e => setEditUsername(e.target.value)}
                                    placeholder="Nome de usuário"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs mb-1">Nova senha (opcional):</label>
                                  <input
                                    type="password"
                                    className="input w-full h-8 text-sm"
                                    value={editPassword}
                                    onChange={e => setEditPassword(e.target.value)}
                                    placeholder="Deixe vazio para manter"
                                  />
                                </div>
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={cancelEditUser}
                                    className="h-8 px-3 rounded-md border border-input bg-background text-sm"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditedUser(user._id)}
                                    disabled={editUserLoading}
                                    className="h-8 px-3 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-60"
                                  >
                                    {editUserLoading ? 'Salvando...' : 'Salvar'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {totalUsersPages > 1 && (
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => setCurrentUsersPage(prev => Math.max(1, prev - 1))}
                            disabled={safeUsersPage === 1}
                            className="h-8 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
                          >
                            Anterior
                          </button>
                          <span className="text-xs text-muted-foreground">
                            Página {safeUsersPage} de {totalUsersPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCurrentUsersPage(prev => Math.min(totalUsersPages, prev + 1))}
                            disabled={safeUsersPage === totalUsersPages}
                            className="h-8 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
                          >
                            Próxima
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer com botão Ok */}
        <div className="border-t border-border p-3 flex justify-end rounded-b-2xl">
          <button
            className="h-9 px-4 rounded-lg text-sm font-semibold border border-orange-400 bg-orange-50 text-orange-700 shadow-sm hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-colors"
            onClick={handleSave}
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
