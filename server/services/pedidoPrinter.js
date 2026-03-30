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

function gerarConteudoPedido(numeroPedido, customerName = '', dataHora = new Date()) {
  const separador = '__________________________';
  return [
    separador,
    `PEDIDO Nº: ${numeroPedido}`,
    `CLIENTE: ${obterNomeClienteParaImpressao(customerName)}`,
    `DATA: ${formatarDataHora(dataHora)}`,
    separador,
  ].join('\r\n');
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

async function gerarHtml(conteudo, numeroPedido, customOutputDir) {
  try {
    const pasta = obterPastaSaida(customOutputDir);
    await fs.mkdir(pasta, { recursive: true });

    const arquivo = path.join(
      pasta,
      `pedido-${numeroPedido}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`
    );

    const conteudoSeguro = String(conteudo || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const html = [
      '<!doctype html>',
      '<html lang="pt-BR">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <title>Senha do Pedido ${numeroPedido}</title>`,
      '  <style>',
      '    body { font-family: Consolas, Courier New, monospace; margin: 24px; }',
      '    .ticket { border: 1px dashed #333; padding: 12px; width: 320px; white-space: pre-wrap; }',
      '  </style>',
      '</head>',
      '<body>',
      `  <div class="ticket">${conteudoSeguro}</div>`,
      '</body>',
      '</html>',
    ].join('\r\n');

    await fs.writeFile(arquivo, html, 'utf8');
    await abrirNoNavegadorPadrao(arquivo);

    return {
      ok: true,
      mensagem: 'Arquivo HTML gerado e aberto no navegador padrao.',
      arquivoGerado: arquivo,
      erroTecnico: null,
    };
  } catch (error) {
    return {
      ok: false,
      mensagem: 'Erro ao gerar ou abrir arquivo HTML.',
      arquivoGerado: null,
      erroTecnico: error?.message || String(error),
    };
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

  const conteudo = gerarConteudoPedido(pedido, options.customerName || '', new Date());

  if (modo === MODOS_SAIDA.IMPRESSORA) {
    return imprimirDireto(conteudo, nomeImpressora);
  }
  if (modo === MODOS_SAIDA.FILE) {
    return gerarArquivoTxt(conteudo, pedido, options.outputDir);
  }
  return gerarHtml(conteudo, pedido, options.outputDir);
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
