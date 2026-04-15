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

const FIXED_PRINT_SCALE = 115;

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

function montarDadosTicket(numeroPedido, options = {}) {
  const printSizeRaw = String(options.printSize || '80mm').trim().toLowerCase();
  const printSize = ['58mm', '80mm', 'a4'].includes(printSizeRaw) ? printSizeRaw : '80mm';
  const printScale = FIXED_PRINT_SCALE;

  return {
    numeroPedido: Number(numeroPedido),
    tradeName: String(options.tradeName || '').trim(),
    customerName: obterNomeClienteParaImpressao(options.customerName || ''),
    dataHora: formatarDataHora(options.dataHora || new Date()),
    printSize,
    printScale,
    items: Array.isArray(options.items)
      ? options.items.map(item => ({
        quantity: Number(item?.quantity || 1),
        name: String(item?.name || '').trim(),
        notes: String(item?.notes || '').trim(),
      }))
      : [],
  };
}

function gerarConteudoPedidoTexto(ticket) {
  return gerarConteudoPedido(
    ticket.numeroPedido,
    ticket.customerName,
    new Date(),
    ticket.tradeName
  );
}

function escapePowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function normalizarModoSaida(modoSaida) {
  return String(modoSaida || '').trim().toUpperCase();
}

function normalizarParaAscii(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\r\n]/g, '');
}

function montarPayloadRaw(conteudo, nomeImpressora) {
  const printer = String(nomeImpressora || '').toLowerCase();
  const texto = `${normalizarParaAscii(conteudo).replace(/\r?\n/g, '\r\n')}\r\n\r\n\r\n`;
  const textoBytes = Buffer.from(texto, 'ascii');

  const escInit = Buffer.from([0x1b, 0x40]);
  const escAlignLeft = Buffer.from([0x1b, 0x61, 0x00]);
  // Feed padrão antes do corte
  const feed = Buffer.from([0x0a, 0x0a, 0x0a]);
  // Corte parcial padrão ESC/POS
  const cutParcial = Buffer.from([0x1d, 0x56, 0x41, 0x10]);

  return Buffer.concat([escInit, escAlignLeft, textoBytes, feed, cutParcial]);
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
      // Tenta o proximo metodo para ambientes com PowerShell/permicoes diferentes.
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

async function imprimirDireto(ticket, nomeImpressora) {
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

  // Estrategia principal: GDI (melhor compatibilidade com drivers Windows).
  const resultadoGdi = await imprimirDiretoGdi(ticket, nomeImpressora);
  if (resultadoGdi.ok) {
    return resultadoGdi;
  }

  // Fallback RAW: cobre drivers que aceitam passthrough ESC/POS.
  const resultadoRaw = await imprimirDiretoRaw(gerarConteudoPedidoTexto(ticket), nomeImpressora);
  if (resultadoRaw.ok) {
    return { ...resultadoRaw, mensagem: 'Impressao RAW enviada (fallback).' };
  }

  return {
    ok: false,
    mensagem: 'Falha ao imprimir diretamente na impressora.',
    arquivoGerado: null,
    erroTecnico: `GDI: ${resultadoGdi.erroTecnico || resultadoGdi.mensagem} | RAW: ${resultadoRaw.erroTecnico || resultadoRaw.mensagem}`,
  };
}

async function imprimirDiretoRaw(conteudo, nomeImpressora) {
  const payload = montarPayloadRaw(conteudo, nomeImpressora);
  const printerEscaped = escapePowerShellSingleQuote(nomeImpressora);

  const binFile = path.join(os.tmpdir(), `kds-raw-${Date.now()}.bin`);
  const ps1File = path.join(os.tmpdir(), `kds-raw-${Date.now()}.ps1`);

  const ps1 = `$printerName = '${printerEscaped}'
$bytes = [System.IO.File]::ReadAllBytes('${escapePowerShellSingleQuote(binFile)}')
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    try {
      var di = new DOCINFO();
      di.pDocName = "SenhaPedido";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        try {
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written)) return false;
          return written == bytes.Length;
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
if (-not $ok) { throw 'Falha no envio RAW para a impressora.' }
`;

  try {
    await fs.writeFile(binFile, payload);
    await fs.writeFile(ps1File, ps1, 'utf8');
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      mensagem: 'Impressao RAW enviada com sucesso para a impressora.',
      arquivoGerado: null,
      erroTecnico: null,
    };
  } catch (error) {
    return {
      ok: false,
      mensagem: 'Falha na impressao RAW.',
      arquivoGerado: null,
      erroTecnico: error?.message || String(error),
    };
  } finally {
    await fs.unlink(binFile).catch(() => {});
    await fs.unlink(ps1File).catch(() => {});
  }
}

async function imprimirDiretoGdi(ticket, nomeImpressora) {
  const printerEscaped = escapePowerShellSingleQuote(nomeImpressora);
  const payload = {
    numeroPedido: normalizarParaAscii(String(ticket?.numeroPedido || '')),
    tradeName: normalizarParaAscii(String(ticket?.tradeName || '')),
    customerName: normalizarParaAscii(String(ticket?.customerName || '')),
    dataHora: normalizarParaAscii(String(ticket?.dataHora || '')),
    printSize: String(ticket?.printSize || '80mm').toLowerCase(),
    printScale: FIXED_PRINT_SCALE,
    items: Array.isArray(ticket?.items)
      ? ticket.items.map(item => ({
        quantity: Number(item?.quantity || 1),
        name: normalizarParaAscii(String(item?.name || '')),
        notes: normalizarParaAscii(String(item?.notes || '')),
      }))
      : [],
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  const ps1File = path.join(os.tmpdir(), `kds-gdi-${Date.now()}.ps1`);
  const ps1 = `Add-Type -AssemblyName System.Drawing
$printerName = '${printerEscaped}'
$payloadB64 = '${payloadBase64}'
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payloadB64))
$ticket = $payloadJson | ConvertFrom-Json
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = 'SenhaPedido'
$doc.PrinterSettings.PrinterName = $printerName
// Margens padrão para compatibilidade com diversas impressoras térmicas
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(10, 10, 5, 40)
if (-not $doc.PrinterSettings.IsValid) { throw 'Impressora invalida ou indisponivel.' }
$doc.add_PrintPage({
  param($sender, $e)
  $is80mm = ([string]$ticket.printSize -eq '80mm')
  $scalePct = if ($is80mm) { [Math]::Min(160, [Math]::Max(80, [int]$ticket.printScale)) } else { 100 }
  $scale = [float]$scalePct / 100.0
  $black = [System.Drawing.Brushes]::Black
  $fontTrade = New-Object System.Drawing.Font('Arial', (10 * $scale), [System.Drawing.FontStyle]::Bold)
  $fontLabel = New-Object System.Drawing.Font('Arial', (8 * $scale), [System.Drawing.FontStyle]::Regular)
  $fontSenha = New-Object System.Drawing.Font('Arial', (28 * $scale), [System.Drawing.FontStyle]::Bold)
  $fontInfo = New-Object System.Drawing.Font('Arial', (8 * $scale), [System.Drawing.FontStyle]::Regular)
  $fontFooter = New-Object System.Drawing.Font('Arial', (8 * $scale), [System.Drawing.FontStyle]::Regular)

  $x = [float](8 * $scale)
  $y = [float](8 * $scale)
  $width = [float]([Math]::Max((260 * $scale), $e.MarginBounds.Width - (16 * $scale)))

  function Draw-CenteredText([string]$text, $font, [float]$yPos) {
    if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
    $size = $e.Graphics.MeasureString($text, $font)
    $centerX = $x + (($width - $size.Width) / 2)
    $e.Graphics.DrawString($text, $font, $black, [float][Math]::Max($x, $centerX), $yPos)
    return [float]$size.Height
  }

  if (-not [string]::IsNullOrWhiteSpace($ticket.tradeName)) {
    $y += Draw-CenteredText $ticket.tradeName $fontTrade $y
    $y += (4 * $scale)
  }

  $e.Graphics.DrawLine([System.Drawing.Pens]::Black, $x, $y, $x + $width, $y)
  $y += (4 * $scale)
  $y += Draw-CenteredText 'Senha do Pedido' $fontLabel $y
  $y += (2 * $scale)
  $y += Draw-CenteredText ([string]$ticket.numeroPedido) $fontSenha $y
  $y += (4 * $scale)
  $e.Graphics.DrawLine([System.Drawing.Pens]::Black, $x, $y, $x + $width, $y)
  $y += (6 * $scale)

  $e.Graphics.DrawString(('Cliente: ' + [string]$ticket.customerName), $fontInfo, $black, $x, $y)
  $y += [float]$fontInfo.GetHeight($e.Graphics) + (2 * $scale)
  $e.Graphics.DrawString(('Data/Hora: ' + [string]$ticket.dataHora), $fontInfo, $black, $x, $y)
  $y += [float]$fontInfo.GetHeight($e.Graphics) + (4 * $scale)

  if ($ticket.items -and $ticket.items.Count -gt 0) {
    $e.Graphics.DrawString('Itens', $fontLabel, $black, $x, $y)
    $y += [float]$fontLabel.GetHeight($e.Graphics) + (2 * $scale)
    foreach ($item in $ticket.items) {
      $line = ('{0}x {1}' -f [int]$item.quantity, [string]$item.name)
      $e.Graphics.DrawString($line, $fontInfo, $black, $x, $y)
      $y += [float]$fontInfo.GetHeight($e.Graphics) + (1 * $scale)
      if (-not [string]::IsNullOrWhiteSpace([string]$item.notes)) {
        $e.Graphics.DrawString(('(' + [string]$item.notes + ')'), $fontLabel, $black, $x + (8 * $scale), $y)
        $y += [float]$fontLabel.GetHeight($e.Graphics) + (1 * $scale)
      }
    }
  }

  $y += (4 * $scale)
  $e.Graphics.DrawLine([System.Drawing.Pens]::Black, $x, $y, $x + $width, $y)
  $y += (4 * $scale)
  [void](Draw-CenteredText 'solucaosistemas.net' $fontFooter $y)
  $y += (6 * $scale)
  [void](Draw-CenteredText '_______________________________________________' $fontFooter $y)
  $y += (6 * $scale)
  [void](Draw-CenteredText '_______________________________________________' $fontFooter $y)
  $e.HasMorePages = $false
})
$doc.Print()
`;

  try {
    await fs.writeFile(ps1File, ps1, 'utf8');
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      mensagem: 'Impressao GDI enviada com sucesso para a impressora.',
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
  } finally {
    await fs.unlink(ps1File).catch(() => {});
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
    .ticket { background: #fff; border: 1px dashed #555; border-radius: 4px; padding: 24px 16px 32px 16px; width: 320px; }
    .trade-name { text-align: center; font-size: 17px; font-weight: 700; margin-bottom: 2px; color: #222; }
    .divider { border: none; border-top: 1px dashed #aaa; margin: 10px 0; }
    .label-senha { text-align: center; font-size: 12px; color: #222; text-transform: uppercase; letter-spacing: 1px; }
    .senha { text-align: center; font-size: 52px; font-weight: 900; margin: 4px 0 10px; }
    .info-line { font-size: 13px; margin: 4px 0; }
    .info-line strong { font-weight: 600; }
    .items-title { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin: 8px 0 4px; }
    .item { font-size: 13px; margin: 3px 0; }
    .obs { color: #888; font-size: 11px; }
    .footer { margin-top: 12px; text-align: center; font-size: 12px; color: #222; padding-bottom: 8px; }
    @media print {
      body { background: none; padding: 0; margin: 0; }
      .ticket { border: none; width: auto; padding: 16px 12px 28px 12px; }
      .footer { padding-bottom: 20px; page-break-inside: avoid; }
    }
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

  const ticket = montarDadosTicket(pedido, {
    customerName: options.customerName || '',
    tradeName: options.tradeName || '',
    items: Array.isArray(options.items) ? options.items : [],
    printSize: options.printSize || '80mm',
    printScale: FIXED_PRINT_SCALE,
    dataHora: new Date(),
  });

  if (modo === MODOS_SAIDA.IMPRESSORA) {
    return imprimirDireto(ticket, nomeImpressora);
  }
  if (modo === MODOS_SAIDA.FILE) {
    return gerarArquivoTxt(gerarConteudoPedidoTexto(ticket), pedido, options.outputDir);
  }
  return gerarHtml(pedido, {
    tradeName: ticket.tradeName,
    customerName: ticket.customerName,
    items: ticket.items,
    dataHora: new Date(),
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
