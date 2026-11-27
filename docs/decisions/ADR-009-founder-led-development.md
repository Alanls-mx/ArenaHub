# ADR-009 — Desenvolvimento guiado pela visão do fundador

- **Estado:** aceita
- **Data:** 27/11/2026
- **Decisor:** fundador da LumixEngine
- **Escopo:** estratégia do ArenaHub, gates comerciais e revisão do modelo candidato

## Contexto anterior

O roadmap v3.2 condicionava o fechamento da Fase 1 e o congelamento do banco a três a cinco entrevistas com proprietários de arenas. A pesquisa deveria determinar defaults de operação, cobrança e permissões. A fundação técnica da Fase 1 foi concluída e integrada à `main` no merge commit `be96251cfbe48cbc74cac3607632a3da7c04b26c`, com CI Linux aprovado.

O fundador ainda não realizou as entrevistas e decidiu que elas devem ocorrer quando houver um produto funcional e maduro o suficiente para apresentação. Não existe evidência comercial a registrar nesta decisão.

## Decisão

O desenvolvimento inicial do ArenaHub segue a visão do fundador, as funcionalidades planejadas e as regras de negócio atualmente documentadas. As entrevistas deixam de ser pré-condição para iniciar a Fase 2 ou construir o produto e passam a uma trilha de validação posterior. O feedback obtido poderá corrigir, evoluir ou expandir o produto.

Regras sem confirmação externa são **hipóteses de produto**. Não descrevê-las como padrões de mercado, necessidades comprovadas ou resultados de pesquisa. Preservar a identidade do ArenaHub, SaaS multi-tenant, configuração por organização quando prevista e um único produto evoluído por migrations, sem forks por cliente.

A Fase 1 fica classificada como **CONCLUÍDA — FUNDAÇÃO TÉCNICA APROVADA**. A conclusão técnica não aprova automaticamente as hipóteses comerciais nem o schema de produção. `docs/DATABASE.md` e `docs/ERD.md` são candidatos para aprovação do fundador antes das migrations definitivas das entidades relacionadas. Essa aprovação de modelagem não depende de entrevistas prévias.

## Justificativa e benefícios

- Evita esperar pela amostra comercial para iniciar a execução autorizada pelo fundador.
- Permite apresentar uma solução funcional, com contexto suficiente para obter feedback mais concreto.
- Mantém uma direção única de produto e reduz forks, customizações isoladas e divergência entre clientes.
- Mantém regras e premissas legíveis, revisáveis e versionadas junto do código e do modelo.
- Feedback futuro continua podendo alterar o produto por releases e migrations compatíveis.

## Riscos assumidos

1. Hipóteses sobre operação, recorrência, cancelamento, mensalidade e permissões podem divergir da prática das arenas e gerar retrabalho.
2. Mudanças depois do uso real podem exigir backfill, migrations de expansão/contração e tratamento de dados já persistidos.
3. Regras que afetem dinheiro, histórico, autorização ou ocupação podem ser difíceis de alterar depois de lançadas.
4. Uma demonstração madura pode revelar lacunas de produto mais tarde do que entrevistas iniciais revelariam.

## Mitigações e evolução incremental

- Rotular premissas no `DATABASE.md`, ERD, documento mestre e interfaces internas; pedir aprovação explícita de decisões estruturais ao fundador antes do DDL definitivo.
- Manter políticas comerciais configuráveis por organização apenas onde já previsto; não introduzir um framework genérico de regras sem necessidade comprovada.
- Preservar históricos e valores aplicados; preferir migrations aditivas, versionamento, defaults explícitos e rollout compatível.
- Antes de cada fluxo, mapear entrada, contrato, autorização/tenant, regras, persistência, jobs, falhas e consumidores conforme `AGENTS.md`.
- Quando o produto estiver funcional e demonstrável, executar 3–5 entrevistas como atividade de aprendizagem, distinguindo observação, interpretação e decisão.
- Submeter mudança de regra material ao review do fundador; decisões de privacidade, dinheiro, integridade e segurança não são substituídas por preferência comercial sem análise.

## Impacto nos gates

- Entrevistas: **ADIADAS POR DECISÃO ESTRATÉGICA DO FUNDADOR — NÃO BLOQUEANTES PARA O DESENVOLVIMENTO**.
- Fase 1: concluída quanto à fundação técnica. Seu gate técnico e CI foram aprovados; o histórico das auditorias não é reescrito.
- Gate integral: a ausência de entrevistas não o bloqueia. A modelagem candidata ainda requer aprovação do fundador antes das migrations definitivas; validação comercial posterior continua pendente como atividade de produto, não como critério técnico retroativo.
- Não iniciar funcionalidades da Fase 2 só por existir esta ADR ou uma proposta; implementação permanece sujeita a uma missão/autorização própria.
- A aprovação da Fase 1 não é aprovação do piloto, produção, segurança por endpoint ou do modelo final.

## Impacto no roadmap

1. Encerrar a Fase 1 como fundação técnica aprovada.
2. Preparar o candidato de `DATABASE.md` e ERD com constraints, riscos, premissas e decisões do fundador explícitas.
3. Planejar a Fase 2 de identidade e multi-tenancy em documento separado; aguardar aprovação do modelo de identidade antes das migrations dessa área.
4. Desenvolver MVP segundo a visão aprovada, em fatias verticais e mudanças incrementais.
5. Agendar pesquisa comercial quando a solução for funcional e suficientemente madura para demonstração; usar os resultados para priorizar evolução e piloto.

## Documentos relacionados

- [Documento Mestre v3.2, atualização estratégica §1.6 e roadmap §11/14/16](../ARENAHUB_MASTER_V3.2.md)
- [Gate da Fase 1](../PHASE1_GATE.md)
- [Modelo de dados candidato](../DATABASE.md)
- [ERD candidato](../ERD.md)
- [Proposta da Fase 2](../PHASE2_PROPOSAL.md)
- [Roteiro comercial adiado](../INTERVIEWS.md)
