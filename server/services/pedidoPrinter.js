const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MODOS_SAIDA = {
  IMPRESSORA: 'IMPRESSORA',
  FILE: 'FILE',
  HTML: 'HTML',
};

function formatarDataHora(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function isClienteNaoCadastrado(customerName) {
  const normalized = String(customerName || '').trim().toLowerCase();
  return !normalized || normalized === 'geral' || normalized === 'cliente sem cadastro' || normalized === 'cliente nao cadastrado';
}

function obterNomeClienteParaImpressao(customerName) {
  return isClienteNaoCadastrado(customerName)
    ? 'Cliente nao cadastrado'
    : String(customerName).trim();
}

function gerarConteudoPedido(numeroPedido, customerName = '', dataHora = new Date(), tradeName = '') {
  const separador = '__________________________';
  const lines = [];
  if (tradeName && String(tradeName).trim()) {
    lines.push(String(tradeName).trim());
  }
  lines.push(
    separador,
    `PEDIDO N\u00ba: ${numeroPedido}`,
    `CLIENTE: ${obterNomeClienteParaImpressao(customerName)}`,
    `DATA: ${formatarDataHora(dataHora)}`,
    separador,
    'solucaosistemas.net'
  );
  return lines.join('\r\n');
}

function escapePowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function normalizarModoSaida(modoSaida) {
  return String(modoSaida || '').trim().toUpperCase();
}

function obterPastaSaida(customOutputDir) {
  if (customOutputDir && String(customOutputDir).trim()) {
    return path.resolve(String(customOutputDir).trim());
  }
  return path.join(os.homedir(), 'Documents', 'FlowKDS', 'Impressoes');
}

async function listarImpressorasWindows() {
  if (process.platform !== 'win32') {
    throw new Error('Listagem de impressoras suportada apenas no Windows.');
  }

  const parseList = (stdout) => String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const commands = [
    'Add-Type -AssemblyName System.Drawing; [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { $_ }',
    'Get-Printer | Select-Object -ExpandProperty Name',
  ];

  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const printers = parseList(stdout);
      if (printers.length > 0) return printers;
    } catch {
      // tenta proximo metodo de descoberta
    }
  }

  throw new Error('Nao foi possivel listar as impressoras instaladas no Windows.');
}

async function impressoraExiste(nomeImpressora) {
  if (!nomeImpressora || !String(nomeImpressora).trim()) return false;
  const printers = await listarImpressorasWindows();
  const target = String(nomeImpressora).trim().toLowerCase();
  return printers.some(p => p.trim().toLowerCase() === target);
}

async function imprimirDireto(conteudo, nomeImpressora) {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      mensagem: 'Impressao direta disponivel apenas no Windows.',
      erroTecnico: null,
    };
  }

  if (!nomeImpressora || !String(nomeImpressora).trim()) {
    return {
      ok: false,
      mensagem: 'Nome da impressora nao informado.',
      erroTecnico: null,
    };
  }

  let existe;
  try {
    existe = await impressoraExiste(nomeImpressora);
  } catch (error) {
    return {
      ok: false,
      mensagem: 'Nao foi possivel validar as impressoras instaladas no Windows.',
      erroTecnico: error?.message || String(error),
    };
  }
  if (!existe) {
    return {
      ok: false,
      mensagem: `A impressora '${nomeImpressora}' nao foi encontrada no Windows.`,
      erroTecnico: null,
    };
  }

  const printerEscaped = escapePowerShellSingleQuote(nomeImpressora);
  const contentB64 = Buffer.from(String(conteudo || ''), 'utf8').toString('base64');

  const command = [
    'Add-Type -AssemblyName System.Drawing',
    `$printerName = '${printerEscaped}'`,
    `$content = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${contentB64}'))`,
    '$doc = New-Object System.Drawing.Printing.PrintDocument',
    '$doc.DocumentName = "SenhaPedido"',
    '$doc.PrinterSettings.PrinterName = $printerName',
    'if (-not $doc.PrinterSettings.IsValid) { throw "Impressora invalida ou indisponivel." }',
    '$handler = [System.Drawing.Printing.PrintPageEventHandler]{ param($sender, $e) $font = New-Object System.Drawing.Font("Consolas", 12); $e.Graphics.DrawString($content, $font, [System.Drawing.Brushes]::Black, $e.MarginBounds); $e.HasMorePages = $false }',
    '$doc.add_PrintPage($handler)',
    '$doc.Print()',
    '$doc.remove_PrintPage($handler)',
  ].join('; ');

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    return {
      ok: true,
      mensagem: 'Impressao enviada com sucesso para a impressora.',
      arquivoGerado: null,
      erroTecnico: null,
    };
  } catch (error) {
    return {
      ok: false,
      mensagem: 'Erro ao imprimir diretamente na impressora.',
      arquivoGerado: null,
      erroTecnico: error?.message || String(error),
    };
  }
}

function abrirNoBlocoDeNotas(arquivoTxt) {
  const child = spawn('notepad.exe', [arquivoTxt], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function toFileUrl(localPath) {
  const normalized = path.resolve(localPath).replace(/\\/g, '/');
  return `file:///${encodeURI(normalized)}`;
}

async function abrirNoNavegadorPadrao(arquivoHtml) {
  const fileUrl = toFileUrl(arquivoHtml);

  if (process.platform === 'win32') {
    const urlEscaped = escapePowerShellSingleQuote(fileUrl);
    const command = `Start-Process -FilePath '${urlEscaped}'`;

    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return;
    } catch {
      await execFileAsync('cmd.exe', ['/c', 'start', '', fileUrl], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return;
    }
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', [arquivoHtml], { maxBuffer: 1024 * 1024 });
    return;
  }

  await execFileAsync('xdg-open', [arquivoHtml], { maxBuffer: 1024 * 1024 });
}

async function gerarArquivoTxt(conteudo, numeroPedido, customOutputDir) {
  try {
    const pasta = obterPastaSaida(customOutputDir);
    await fs.mkdir(pasta, { recursive: true });

    const arquivo = path.join(
      pasta,
      `pedido-${numeroPedido}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    );

    await fs.writeFile(arquivo, String(conteudo || ''), 'utf8');
    abrirNoBlocoDeNotas(arquivo);

    return {
      ok: true,
      mensagem: 'Arquivo TXT gerado e aberto no Bloco de Notas.',
      arquivoGerado: arquivo,
      erroTecnico: null,
    };
  } catch (error) {
    return {
      ok: false,
      mensagem: 'Erro ao gerar ou abrir arquivo TXT.',
      arquivoGerado: null,
      erroTecnico: error?.message || String(error),
    };
  }
}

async function gerarHtml(numeroPedido, options, customOutputDir) {
  const tradeName    = String(options.tradeName   || '').trim();
  const customerName = obterNomeClienteParaImpressao(options.customerName || '');
  const items        = Array.isArray(options.items) ? options.items : [];
  const dataHora     = formatarDataHora(options.dataHora || new Date());

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const itemsHtml = items.length
    ? items.map(i => `<div class="item">${esc(i.quantity || 1)}x ${esc(i.name)}${i.notes ? ` <span class="obs">(${esc(i.notes)})</span>` : ''}</div>`).join('\n')
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Senha do Pedido ${numeroPedido}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .ticket { background: #fff; border: 1px dashed #555; border-radius: 4px; padding: 16px; width: 320px; }
    .trade-name { text-align: center; font-size: 17px; font-weight: 700; margin-bottom: 2px; }
    .divider { border: none; border-top: 1px dashed #aaa; margin: 10px 0; }
    .label-senha { text-align: center; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .senha { text-align: center; font-size: 52px; font-weight: 900; margin: 4px 0 10px; }
    .info-line { font-size: 13px; margin: 4px 0; }
    .info-line strong { font-weight: 600; }
    .items-title { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin: 8px 0 4px; }
    .item { font-size: 13px; margin: 3px 0; }
    .obs { color: #888; font-size: 11px; }
    .footer { margin-top: 12px; text-align: center; font-size: 12px; color: #888; }
    @media print { body { background: none; padding: 0; } .ticket { border: none; width: auto; } }
  </style>
</head>
<body>
  <div class="ticket">
    ${tradeName ? `<div class="trade-name">${esc(tradeName)}</div>` : ''}
    <hr class="divider" />
    <div class="label-senha">Senha do Pedido</div>
    <div class="senha">${numeroPedido}</div>
    <hr class="divider" />
    <div class="info-line"><strong>Cliente:</strong> ${esc(customerName)}</div>
    <div class="info-line"><strong>Data/Hora:</strong> ${esc(dataHora)}</div>
    ${itemsHtml ? `<div class="items-title">Itens</div>\n    ${itemsHtml}` : ''}
    <hr class="divider" />
    <div class="footer">solucaosistemas.net</div>
  </div>
  <script>window.print();</script>
</body>
</html>`;

  try {
    const pasta = obterPastaSaida(customOutputDir);
    await fs.mkdir(pasta, { recursive: true });
    const arquivo = path.join(pasta, `pedido-${numeroPedido}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
    await fs.writeFile(arquivo, html, 'utf8');
    await abrirNoNavegadorPadrao(arquivo);
    return { ok: true, mensagem: 'Arquivo HTML gerado e aberto no navegador padrao.', arquivoGerado: arquivo, erroTecnico: null };
  } catch (error) {
    return { ok: false, mensagem: 'Erro ao gerar ou abrir arquivo HTML.', arquivoGerado: null, erroTecnico: error?.message || String(error) };
  }
}

async function printPedido(numeroPedido, nomeImpressora, modoSaida, options = {}) {
  const pedido = Number(numeroPedido);
  if (!Number.isFinite(pedido) || pedido <= 0) {
    return {
      ok: false,
      mensagem: 'Numero do pedido invalido.',
      arquivoGerado: null,
      erroTecnico: null,
    };
  }

  const modo = normalizarModoSaida(modoSaida);
  if (!Object.values(MODOS_SAIDA).includes(modo)) {
    return {
      ok: false,
      mensagem: 'Modo de saida invalido. Use IMPRESSORA, FILE ou HTML.',
      arquivoGerado: null,
      erroTecnico: null,
    };
  }

  const conteudo = gerarConteudoPedido(pedido, options.customerName || '', new Date(), options.tradeName || '');

  if (modo === MODOS_SAIDA.IMPRESSORA) {
    return imprimirDireto(conteudo, nomeImpressora);
  }
  if (modo === MODOS_SAIDA.FILE) {
    return gerarArquivoTxt(conteudo, pedido, options.outputDir);
  }
  return gerarHtml(pedido, {
    tradeName:    options.tradeName    || '',
    customerName: options.customerName || '',
    items:        Array.isArray(options.items) ? options.items : [],
    dataHora:     new Date(),
  }, options.outputDir);
}

module.exports = {
  MODOS_SAIDA,
  printPedido,
  gerarConteudoPedido,
  obterNomeClienteParaImpressao,
  imprimirDireto,
  gerarArquivoTxt,
  gerarHtml,
  impressoraExiste,
  listarImpressorasWindows,
};
