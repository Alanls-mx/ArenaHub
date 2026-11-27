# ADR-012 — Estrutura operacional da Fase 3

## Decisão

As nove entidades operacionais da Fase 3 vivem em `arena_identity`, separadas das provas em `occupancy_spike`. Cada registro tenant possui `organization_id`; relações tenant usam FKs compostas. Um venue é o espaço ofertado; uma unidade é o recurso físico elementar. A criação de venue simples cria sua unidade na mesma transação. Venues compostos reutilizam unidades existentes da mesma organização. Venues ativos precisam de ao menos uma unidade ativa vinculada.

Os horários são linhas por turno e dia da semana local (0 = domingo). `close_time <= open_time` representa fechamento no dia seguinte; horários iguais só são aceitos com `spans_full_day`. O editor substitui a semana inteira sob lock do venue e verifica sobreposição inclusive entre domingo e segunda. Exceções usam data civil e `UNIQUE NULLS NOT DISTINCT` para tratar o escopo da organização.

Preços usam faixa local normalizada em minutos `[start_minute,end_minute)`, entre 0 e 1440, com vigência inclusiva. Nível 1: data específica, com modalidade opcional; nível 2: modalidade e dia; nível 3: dia sem modalidade; nível 4: preço padrão do venue. No nível 1, uma regra com modalidade prevalece sobre a regra geral da mesma data. Regras de mesmo nível e mesmo escopo não se sobrepõem em faixa e vigência. Todo escritor trava a organização e o venue e revalida a sobreposição após os locks. O simulador divide o intervalo nas fronteiras de data e regra, soma `centavos/hora × minutos` como inteiros e arredonda uma vez ao final.

Capacidades novas entram no catálogo sem alterar cargos já persistidos. Novas organizações recebem templates atualizados; cargos personalizados e existentes preservam concessões até edição explícita. Owner continua com o catálogo completo. Alterações administrativas têm auditoria na transação.

## Fluxo e integração

Web autenticada → `/api/v1/orgs/:slug` → sessão/CSRF, host e membership → capability → validação do contrato → transação e lock → SQL filtrado por organização → auditoria → resposta seletiva. A futura Fase 4 deverá adquirir o mesmo lock do venue antes de consultar ou alterar composição/ocupações; alteração de composição com reservas ativas exigirá bloqueio transacional, ainda não aplicável nesta fase.

Não há tabelas definitivas de reserva, cobrança ou pagamento neste ADR. Verificação DNS e TLS de domínios próprios continuam fora da Fase 3.
