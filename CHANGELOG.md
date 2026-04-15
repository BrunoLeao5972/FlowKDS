# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2025-04-15

### Adicionado
- Nome do vendedor no card da cozinha para modalidades Mesa, Cartão e Apartamento
- Botão "Efeitos Visuais" na aba Tema para ativar/desativar piscar nos cards atrasados
- Filtro de modalidades no painel público (Mesa e Cartão não aparecem mais)
- Expansão do número do pedido no painel quando sem cliente identificado
- Setores ativáveis/desativáveis na configuração de Modalidades

### Corrigido
- JOIN SQL para buscar nome do vendedor corretamente via tabela PEDIDOS
- Painel público não mostra mais "Cliente não identificado" quando vazio
- Query SQL usa coluna [Lançamento] em vez de [Código] para vincular pedidos

### Changed
- Versão migrada para Semantic Versioning (SemVer)
- AdminPage mostra "Cliente não identificado" quando não há cliente
- PublicDisplayPage oculta cliente quando não identificado

## [1.0.0] - 2024 (Legado)

### Funcionalidades
- Sistema KDS completo com sincronização SQL Server 2014
- Painel de cozinha com controle de status
- Painel público de retirada
- Administração de pedidos
- Configurações de timer e sons
- Suporte a múltiplos setores
- Impressão de tickets
