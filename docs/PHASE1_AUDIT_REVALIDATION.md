# Revalidação final dos achados da auditoria — 26/11/2026

## Veredito técnico

**REVALIDAÇÃO INCONCLUSIVA**

O P1 foi revalidado nos processos reais da API e do worker, e a suíte específica passou três vezes consecutivas. Não declaro o parecer local totalmente aprovado porque `pnpm test:integration` falhou nesta revalidação: Vitest perdeu o fork que executava `runtime-outage.integration.test.ts` com exit code Windows `3221226505`. O resultado observável foi 8 arquivos/51 testes aprovados e uma falha de infraestrutura/processo no 9º arquivo; não há evidência suficiente para atribuí-la a um defeito do produto ou ignorá-la. O CI remoto continua pendente.

A auditoria original e seu veredito **REPROVADO TECNICAMENTE** permanecem preservados em `PHASE1_AUDIT.md`. Este documento é o parecer subsequente, não uma alteração do registro histórico.

## 1. Identificação e estado dos cinco achados

| ID  | Achado original                                                            | Estado revalidado                                                                                                                                                                |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | P1 — pool ocioso pode encerrar API/worker durante outage                   | **CORRIGIDO E VALIDADO** nos processos reais e na suíte específica; os gates integrais não permitem aprovar esta revalidação global                                              |
| A2  | P2 — timeout de lock de negócio classificado como conflito de idempotência | **PARCIALMENTE CORRIGIDO**; configuração limitada de lock foi restaurada antes do efeito, mas a integração completa não terminou e falta teste dedicado do lock dentro do efeito |
| A3  | P2 — formatação perde centavo no limite aceito                             | **CORRIGIDO E VALIDADO**; teste de limite e suite unitária passaram                                                                                                              |
| A4  | P2 — offset fixo aceito como fuso IANA                                     | **CORRIGIDO E VALIDADO**; teste negativo de `+03:00` e suite unitária passaram                                                                                                   |
| A5  | P3 — aviso de dados fictícios ausente na prévia do tema                    | **CORRIGIDO E VALIDADO** pelo código e build local                                                                                                                               |

## 2. Revalidação do P1

### Implementação e ciclo de vida

- [app.ts](../apps/api/src/app.ts#L22): cria o pool da readiness; registra `pool.on('error')` nas linhas 29–31 antes de rota/primeira consulta. O evento registra somente `error.code`; a rota devolve 503 sem detalhes internos e o hook `onClose` encerra o pool.
- [jobs/index.ts](../apps/api/src/shared/jobs/index.ts#L18): mantém o pool do pg-boss separado do pool da limpeza. O pool da limpeza registra um listener nas linhas 34–38; `boss.on('error')` separado nas linhas 44–47 mantém o mecanismo de estado/recuperação do pg-boss. O encerramento continua em `stop()`/caminho de startup.
- Não há listeners duplicados para um mesmo pool: um para o pool de readiness, um para o pool de limpeza e um para o emitter da instância pg-boss. Os dois listeners de pools somente registram código PostgreSQL; não logam connection string, `client`, query ou dados de usuário. Não há `uncaughtException`/`unhandledRejection` global.
- A API continua usando reconexão nativa do `pg.Pool`; o worker mantém polling/retries do pg-boss. `READY` do worker exige polling recente dos dois consumidores após o último erro (`jobs/index.ts:52–81`).
- O worker executa uma limpeza idempotente de chaves expiradas na inicialização (`jobs/index.ts:91–92`), aquecendo o mesmo pool de produção antes do teste de outage. Isso também faz com que schema/migration incompatíveis falhem visivelmente durante o startup, em vez de serem confundidos com recuperação.

### Fixture, processos e sequência observada

O teste é executado em processos filhos com `node --import tsx src/server.ts` e `src/worker.ts` ([runtime-outage.integration.test.ts](../apps/api/src/shared/jobs/runtime-outage.integration.test.ts#L54)). Testcontainers publica porta fixa, mantém o mesmo ID/URL, e o fixture cria `occupancy_spike` e aplica migrations com o `search_path` esperado (linhas 119–145). A condição de recuperação aguarda a nova transição `READY` (linha 208), ou o processamento do job após retorno (linha 249); não usa a mensagem inicial como prova de recuperação. O processo filho é monitorado e uma saída inesperada falha o teste.

Execuções independentes nesta revalidação:

1. **Worker isolado:** confirmado `startup idempotency cleanup completed`; consulta observou conexão `idle` com `application_name='arenahub-worker-cleanup'`; job inicial processado; PostgreSQL parado; log do listener observado; processo permaneceu ativo; mesmo container retomado; novo `READY`; segundo job processado. Cada ID apareceu uma vez no log de conclusão. Exit code do processo permaneceu indefinido até shutdown solicitado.
2. **API isolada:** readiness 200 antes do restart e novamente 200 após `container.restart()` no mesmo endereço. Processo permaneceu vivo.
3. **API e worker juntos:** readiness da API e inicialização real do worker; outage produziu 503 e log do erro do pool; ambos permaneceram vivos; restauração devolveu readiness; produtor enviou job e worker o concluiu; teste causou uma segunda indisponibilidade e solicitou shutdown, que encerrou os processos em menos de 20 s.

A suíte inteira de processos passou três vezes consecutivas, cada uma com **3 testes aprovados**: 14,69 s, 14,61 s e 15,07 s. Uma execução adicional passou em 12,98 s antes da série. Isso encerra a revalidação específica do P1 em ambiente local, sem constituir benchmark/SLA de produção.

### Diagnóstico da falha histórica do teste

O `42P01` anterior ocorreu antes da indisponibilidade: o fixture executava SQL sem `search_path` `occupancy_spike`, enquanto `cleanExpiredIdempotency` consulta explicitamente `occupancy_spike.idempotency_records`. O setup de regressão foi corrigido. A falha posterior no envio era condição de corrida: um `READY` antigo satisfazia a espera; agora a recuperação é provada por transição nova ou consumo do job. A revalidação não precisou alterar assertions para torná-las permissivas.

## 3. Revalidação dos achados não bloqueantes

### A2 — lock timeout e idempotência

O código aplica `SET LOCAL lock_timeout = '5s'` para adquirir a chave e redefine para `DEFAULT` antes de executar `effect(client)` ([idempotency/index.ts](../apps/api/src/shared/idempotency/index.ts#L81)). A correção corresponde à recomendação original. A classificação fica **PARCIALMENTE CORRIGIDO** porque não encontrei teste explícito em que um efeito espera por lock de linha e preserva esse SQLSTATE. A suite completa que poderia oferecer evidência adicional não terminou; trata-se de cobertura pendente, não de novo bloqueio P1.

### A3 — precisão monetária

`formatBRL` decompõe centavos inteiros e formata a parte em reais ([money/index.ts](../apps/api/src/shared/money/index.ts#L31)); o teste compara `Number.MAX_SAFE_INTEGER` com os centavos corretos ([money.test.ts](../apps/api/src/shared/money/money.test.ts#L23)). `pnpm test` passou 16/16.

### A4 — fuso IANA

`validateTimeZone` rejeita offsets fixos e valida a zona com Temporal ([time/index.ts](../apps/api/src/shared/time/index.ts#L5)); o teste negativo de `+03:00` está em [time.test.ts](../apps/api/src/shared/time/time.test.ts#L27). Unitários passaram.

### A5 — identificação de dados fictícios

A prévia do tema agora identifica dados fictícios ([page.tsx](../apps/web/src/app/theme-preview/page.tsx#L8)); o build Next passou. A afirmação documental anterior foi ajustada e corresponde ao texto visível.

## 4. Resultado dos gates locais

| Verificação                           | Resultado desta revalidação                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Suíte dos processos reais, execução 1 | 3/3, 14,69 s                                                                                                                |
| Suíte dos processos reais, execução 2 | 3/3, 14,61 s                                                                                                                |
| Suíte dos processos reais, execução 3 | 3/3, 15,07 s                                                                                                                |
| `pnpm lint`                           | Passou                                                                                                                      |
| `pnpm format:check`                   | Passou                                                                                                                      |
| `pnpm typecheck`                      | Passou                                                                                                                      |
| `pnpm test`                           | 16/16, 4 arquivos                                                                                                           |
| `pnpm test:integration`               | **Falhou**; Vitest reportou fork encerrado inesperadamente com exit code `3221226505`; 8/9 arquivos e 51/52 testes passaram |
| `pnpm db:check`                       | Executado pelo runner descartável dentro da integração; Prisma sem drift e garantias SQL aprovadas antes da falha do fork   |
| `pnpm build`                          | Passou; API e páginas Next compiladas                                                                                       |
| `git diff --check`                    | Passou                                                                                                                      |

## 5. Riscos residuais e pendências

- O gate de CI remoto segue sem execução observada nesta branch.
- A integração completa falhou por encerramento inesperado do fork Vitest no ambiente Windows. Os logs disponíveis não identificam a causa nativa do exit code; execução isolada dos processos reais passou. Não atribuo causa definitiva a produto ou runner.
- A2 precisa de teste dedicado de timeout de lock dentro do efeito para validação completa.
- Entrevistas comerciais seguem pendentes. São gate integral de produto, não condição inventada para aprovar engenharia local.
- Não foram usados bancos reais nem alterados código de implementação nesta revalidação. O histórico local e alterações preexistentes foram preservados.

## 6. Recomendação

O P1 está **CORRIGIDO E VALIDADO LOCALMENTE** quanto aos processos reais e seus pools ociosos. A correção dos quatro achados não bloqueantes foi validada, exceto que A2 permanece parcialmente validado pela falta de teste dedicado do efeito. Como o gate obrigatório `pnpm test:integration` não concluiu sem erro, o parecer geral é **REVALIDAÇÃO INCONCLUSIVA**, e não encerro formalmente todos os hardenings da Fase 1 nesta rodada. Reexecute o gate completo em ambiente estável; mantenha o CI remoto e as entrevistas como pendências do gate integral. A Fase 2 não está liberada por este parecer.
