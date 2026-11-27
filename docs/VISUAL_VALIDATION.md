# Validação visual — Fase 1.1

Em 26/11/2026, Web local (`next dev`) inspecionada no navegador com screenshots das rotas `/theme-preview` e `/agenda-preview` em 1440×900, 768×1024 e 390×844. Os screenshots foram observados durante a sessão, sem publicação de artefatos.

| Verificação               | Resultado observado                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tokens LumixEngine        | `--color-background` aplicado como `#0A0E15`; superfícies escuras e ação primária verde conforme tema                    |
| Responsividade            | `documentElement.scrollWidth` ≤ `innerWidth` nas seis combinações de página e viewport                                   |
| Tabela no mobile          | Scroll fica contido em `.ui-table-scroll` (500 px de conteúdo em 292 px de área na agenda)                               |
| Hierarquia e legibilidade | Títulos, labels, estados e aviso de dados fictícios legíveis nas três larguras                                           |
| Estados de reserva        | Badges exibem texto explícito (Livre, Reservado, Mensalista, Bloqueado), além de cor                                     |
| Teclado                   | Tab alcançou o campo de nome com foco sólido de 3 px; diálogo abriu com botão, possui nome acessível e fechou com Escape |

Contraste calculado dos tokens (razão texto/fundo): corpo 17,86:1, texto secundário 7,76:1, texto do botão primário 7,94:1, estado verde 11,19:1 e aviso amarelo 12,30:1. Esses pares superam o mínimo de 4,5:1 do [critério WCAG 2.2 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) para texto normal; a auditoria integral de acessibilidade permanece fora do alcance deste spike.

Limite: inspeção visual manual e métricas de DOM; não substitui auditoria WCAG automatizada ou teste com leitor de tela. Não foram detectados problemas que exigissem alteração do tema nesta rodada.
