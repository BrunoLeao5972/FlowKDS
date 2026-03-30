using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Text;

namespace FlowKDS.Printing;

public sealed class PedidoPrinter
{
    public const string ModoImpressora = "IMPRESSORA";
    public const string ModoFile = "FILE";
    public const string ModoHtml = "HTML";

    public PrintPedidoResultado PrintPedido(int numeroPedido, string nomeImpressora, string modoSaida)
    {
        if (numeroPedido <= 0)
        {
            return PrintPedidoResultado.Falha("Numero do pedido invalido.");
        }

        if (string.IsNullOrWhiteSpace(modoSaida))
        {
            return PrintPedidoResultado.Falha("Modo de saida nao informado. Use IMPRESSORA, FILE ou HTML.");
        }

        string conteudo = GerarConteudoPedido(numeroPedido, DateTime.Now);
        string modoNormalizado = modoSaida.Trim().ToUpperInvariant();

        try
        {
            return modoNormalizado switch
            {
                ModoImpressora => ImprimirDireto(conteudo, nomeImpressora),
                ModoFile => GerarArquivoTxt(conteudo, numeroPedido),
                ModoHtml => GerarHtml(conteudo, numeroPedido),
                _ => PrintPedidoResultado.Falha("Modo de saida invalido. Use IMPRESSORA, FILE ou HTML.")
            };
        }
        catch (Exception ex)
        {
            return PrintPedidoResultado.Falha(
                "Falha ao processar a impressao do pedido.",
                ex.Message
            );
        }
    }

    public string GerarConteudoPedido(int numeroPedido, DateTime dataHora)
    {
        string separador = "------------------------";

        return string.Join(
            Environment.NewLine,
            separador,
            $"PEDIDO No: {numeroPedido}",
            $"DATA: {dataHora:dd/MM/yyyy HH:mm}",
            separador
        );
    }

    public bool ImpressoraExiste(string nomeImpressora)
    {
        if (string.IsNullOrWhiteSpace(nomeImpressora))
        {
            return false;
        }

        foreach (string impressora in PrinterSettings.InstalledPrinters)
        {
            if (string.Equals(impressora?.Trim(), nomeImpressora.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    public PrintPedidoResultado ImprimirDireto(string conteudo, string nomeImpressora)
    {
        if (string.IsNullOrWhiteSpace(nomeImpressora))
        {
            return PrintPedidoResultado.Falha("Nome da impressora nao informado.");
        }

        if (!ImpressoraExiste(nomeImpressora))
        {
            return PrintPedidoResultado.Falha($"A impressora '{nomeImpressora}' nao foi encontrada no Windows.");
        }

        try
        {
            using PrintDocument documento = new();
            documento.DocumentName = "SenhaPedido";
            documento.PrinterSettings.PrinterName = nomeImpressora;

            if (!documento.PrinterSettings.IsValid)
            {
                return PrintPedidoResultado.Falha($"A impressora '{nomeImpressora}' nao esta disponivel para impressao.");
            }

            documento.PrintPage += (_, e) =>
            {
                using Font fonte = new("Consolas", 12, FontStyle.Regular);
                RectangleF area = e.MarginBounds;
                e.Graphics.DrawString(conteudo, fonte, Brushes.Black, area);
                e.HasMorePages = false;
            };

            documento.Print();
            return PrintPedidoResultado.Sucesso("Impressao enviada com sucesso para a impressora.");
        }
        catch (Exception ex)
        {
            return PrintPedidoResultado.Falha(
                "Erro ao imprimir diretamente na impressora.",
                ex.Message
            );
        }
    }

    public PrintPedidoResultado GerarArquivoTxt(string conteudo, int numeroPedido, string? pastaSaida = null)
    {
        try
        {
            string pasta = ResolverPastaSaida(pastaSaida);
            Directory.CreateDirectory(pasta);

            string arquivo = Path.Combine(
                pasta,
                $"pedido-{numeroPedido}-{DateTime.Now:yyyyMMdd-HHmmss}.txt"
            );

            File.WriteAllText(arquivo, conteudo, Encoding.UTF8);

            Process.Start(new ProcessStartInfo
            {
                FileName = "notepad.exe",
                Arguments = $"\"{arquivo}\"",
                UseShellExecute = true
            });

            return PrintPedidoResultado.Sucesso("Arquivo TXT gerado e aberto no Bloco de Notas.", arquivo);
        }
        catch (Exception ex)
        {
            return PrintPedidoResultado.Falha(
                "Erro ao gerar ou abrir arquivo TXT.",
                ex.Message
            );
        }
    }

    public PrintPedidoResultado GerarHtml(string conteudo, int numeroPedido, string? pastaSaida = null)
    {
        try
        {
            string pasta = ResolverPastaSaida(pastaSaida);
            Directory.CreateDirectory(pasta);

            string arquivo = Path.Combine(
                pasta,
                $"pedido-{numeroPedido}-{DateTime.Now:yyyyMMdd-HHmmss}.html"
            );

            string conteudoSeguro = WebUtility.HtmlEncode(conteudo);
            string html = $@"<!doctype html>
<html lang='pt-BR'>
<head>
  <meta charset='utf-8' />
  <meta name='viewport' content='width=device-width, initial-scale=1' />
  <title>Senha do Pedido {numeroPedido}</title>
  <style>
    body {{
      font-family: Consolas, 'Courier New', monospace;
      margin: 24px;
      color: #111;
      background: #fff;
    }}
    .ticket {{
      width: 320px;
      border: 1px dashed #333;
      padding: 12px;
      white-space: pre-wrap;
      line-height: 1.4;
      font-size: 16px;
    }}
  </style>
</head>
<body>
  <div class='ticket'>{conteudoSeguro}</div>
</body>
</html>";

            File.WriteAllText(arquivo, html, Encoding.UTF8);

            Process.Start(new ProcessStartInfo
            {
                FileName = arquivo,
                UseShellExecute = true
            });

            return PrintPedidoResultado.Sucesso("Arquivo HTML gerado e aberto no navegador padrao.", arquivo);
        }
        catch (Exception ex)
        {
            return PrintPedidoResultado.Falha(
                "Erro ao gerar ou abrir arquivo HTML.",
                ex.Message
            );
        }
    }

    private static string ResolverPastaSaida(string? pastaSaida)
    {
        if (!string.IsNullOrWhiteSpace(pastaSaida))
        {
            return pastaSaida;
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "FlowKDS",
            "Impressoes"
        );
    }
}

public sealed class PrintPedidoResultado
{
    public bool Ok { get; init; }
    public string Mensagem { get; init; } = string.Empty;
    public string? ArquivoGerado { get; init; }
    public string? ErroTecnico { get; init; }

    public static PrintPedidoResultado Sucesso(string mensagem, string? arquivoGerado = null)
    {
        return new PrintPedidoResultado
        {
            Ok = true,
            Mensagem = mensagem,
            ArquivoGerado = arquivoGerado,
            ErroTecnico = null
        };
    }

    public static PrintPedidoResultado Falha(string mensagem, string? erroTecnico = null)
    {
        return new PrintPedidoResultado
        {
            Ok = false,
            Mensagem = mensagem,
            ArquivoGerado = null,
            ErroTecnico = erroTecnico
        };
    }
}

/*
Exemplo de uso:

var printer = new FlowKDS.Printing.PedidoPrinter();
var resultado = printer.PrintPedido(1234, "Nome da Impressora", "IMPRESSORA");

if (!resultado.Ok)
{
    Console.WriteLine($"Erro amigavel: {resultado.Mensagem}");
    Console.WriteLine($"Detalhe tecnico: {resultado.ErroTecnico}");
}
*/
