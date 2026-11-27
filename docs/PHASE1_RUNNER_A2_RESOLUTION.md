# Diagnóstico final do runner e validação do A2 — 26/11/2026

## Conclusão

O encerramento anterior `3221226505` foi reportado pelo **fork do Vitest** durante `runtime-outage.integration.test.ts`; não foi o processo principal do Vitest nem há evidência de que tenha sido o processo filho da API/worker. `0xC0000409` é classificado pela Microsoft como Fail Fast, que termina o processo fora do tratamento normal de exceções. Esse código não identifica por si só o módulo ou causa raiz ([Microsoft Learn](https://learn.microsoft.com/en-us/shows/inside/c0000409)).

Não foi possível comprovar causa nativa para aquele encerramento. Event Viewer/WER não apresentou evento correspondente de `node`/`vitest` na consulta de três dias. O relato upstream #10894 descreve o Vitest expondo exit code e menciona um incidente em um build específico de Node/V8; é um relato de terceiro, não prova de que a mesma causa se aplique à máquina ou ao Node 24.15.0 deste projeto ([Vitest #10894](https://github.com/vitest-dev/vitest/issues/10894)). O issue #2880 é antigo (Node 18/Vitest da época), foi fechado como “not planned” sem reprodução e não determina o caso atual ([Vitest #2880](https://github.com/vitest-dev/vitest/issues/2880)).

O crash **não foi reproduzido** em duas execuções completas consecutivas após a investigação: execução default 53/53 (62,15 s) e execução serial `--maxWorkers=1` 53/53 (61,83 s). Não há justificativa experimental para separar ou excluir suites do gate. O cenário Linux não foi executado: Ubuntu-24.04 WSL existe, mas não tem Node e não tem integração Docker habilitada; instalar/configurar isso foi evitado.

## Ambiente e evidências do processo

| Item                                    | Evidência desta sessão                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sistema                                 | Windows 11 Pro x64, versão 10.0.26300 (build 26300)                                                                                                                                          |
| Node / V8                               | Node v24.15.0 / V8 13.6.233.17-node.48, win32 x64                                                                                                                                            |
| pnpm                                    | 11.25.0                                                                                                                                                                                      |
| Vitest                                  | 5.1.2, binário win32-x64 Node 24                                                                                                                                                             |
| Testcontainers PostgreSQL               | 12.2.2                                                                                                                                                                                       |
| Docker                                  | Client/server 29.9.2; engine Linux, 4 CPUs, limite ~3,82 GiB                                                                                                                                 |
| RAM do host observada                   | 15,60 GiB total, 3,20 GiB livre em uma amostra; não é pico da execução                                                                                                                       |
| Pool Vitest                             | Config declara `fileParallelism: false`; 9 arquivos sequenciais. `maxWorkers` não estava definido; comparação explícita com `--maxWorkers=1` também passou                                   |
| Fork identificado no incidente anterior | Vitest reportou fork encerrado enquanto executava `runtime-outage.integration.test.ts`, code 3221226505. O Vitest 5.1.2 surfaced código e arquivo no erro reportado                          |
| Processo API/worker                     | Os testes de processo real monitoram seus exit codes; em todas as três execuções recentes da regressão isolada permaneceram vivos durante outage e encerraram somente no shutdown solicitado |
| WER/Event Viewer                        | Consulta de eventos Application Error/Windows Error Reporting dos três dias anteriores não encontrou eventos de Node/Vitest correspondentes                                                  |
| Outros processos                        | Nenhum subprocesso Node do teste ficou ativo ao final; apenas os dois processos long-lived do ambiente Codex. Nenhum container `arenahub_test*` permaneceu listado                           |

O runner cria um container por execução, aplica migrations, executa `db:check`, lança o Vitest como subprocesso e encerra o container em `finally`. A suíte dos processos reais cria seus próprios filhos de API/worker e containers e os encerra em `finally`. Não foi observada evidência de que o runner tenha chamado `kill` no fork Vitest. Os flags `--report-on-fatalerror`, `--report-uncaught-exception` e `--report-exclude-env` existem no Node instalado; não foram ligados permanentemente porque as execuções atuais não reproduziram o crash e relatórios não devem capturar ambiente sensível sem um diagnóstico reproduzível.

### Matriz experimental

| Caso                       | Comando/configuração                                                              | Resultado                                                                                                                 | Tempo / limitação                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A — regressão real isolada | `pnpm --filter @arenahub/api test:integration runtime-outage.integration.test.ts` | 3/3, passou em três execuções consecutivas no ciclo anterior; 3/3 novamente em três repetições da revalidação subsequente | Em torno de 15 s por execução; isolamento por processo/fixture descartável                     |
| B — suite completa default | `pnpm test:integration`                                                           | 53/53, 9 arquivos, passou                                                                                                 | 62,15 s; migrations e `db:check` descartáveis passaram antes dos testes                        |
| C — suite completa serial  | `pnpm --filter @arenahub/api test:integration --maxWorkers=1 --reporter=dot`      | 53/53, 9 arquivos, passou                                                                                                 | 61,83 s                                                                                        |
| D — ordem diferente        | Não executado                                                                     | Sem evidência                                                                                                             | Não necessário após B e C passarem; nenhum crash reproduzido                                   |
| E — Linux/WSL              | Checagem de disponibilidade                                                       | Não executado                                                                                                             | Ubuntu-24.04 está instalado, mas `node` não está presente e Docker não está integrado à distro |

Uma execução anterior em Windows perdeu um fork. Nas duas comparações controladas posteriores (B e C), não se reproduziu. Portanto, o diagnóstico causal permanece **não comprovado**, classificado como limitação episódica do ambiente/runner, sem atribuição a Node, Vitest ou ArenaHub.

## A2 — lock de negócio dentro do efeito idempotente

O lock discutido em A2 é o row lock de domínio que o callback `effect(client)` pode adquirir enquanto a chave de idempotência e o efeito permanecem na mesma transação. O lock de aquisição da própria chave, obtido pelo `INSERT ... ON CONFLICT`, continua limitado a cinco segundos para classificar concorrência da mesma chave. A garantia A2 é que esse limite não seja herdado pelo lock de negócio do efeito, nem gere falsamente `IDEMPOTENCY_IN_PROGRESS`.

Foi adicionado teste de integração com PostgreSQL real em `apps/api/src/shared/idempotency/idempotency.integration.test.ts`:

1. Conexão A inicia transação e bloqueia a linha sintética `idempotency_lock_rows` com `FOR UPDATE`.
2. `executeIdempotent` em outra conexão insere a chave e entra no `effect(client)` da mesma transação; o efeito tenta `FOR UPDATE` na linha bloqueada.
3. O teste aguarda `pg_stat_activity.wait_event_type='Lock'` para provar que o efeito realmente está esperando no lock de negócio.
4. A conexão A mantém o lock por 5,2 s (além do limite de aquisição da chave), então confirma a transação.
5. O efeito termina com resposta normal; a assertion confirma valor de domínio alterado uma vez, efeito persistido uma vez e registro da chave persistido.

Execução dedicada: `pnpm --filter @arenahub/api test:integration idempotency.integration.test.ts -t "timeout de aquisição" --reporter=verbose` passou, 1/1 teste, 5,60 s de arquivo e 5,236 s no teste. As execuções completas default e serial passaram 53/53 com o novo teste incluído. O código de produção não precisou de nova alteração nesta missão; a redefinição `SET LOCAL lock_timeout = DEFAULT` anterior está em `apps/api/src/shared/idempotency/index.ts:129`.

## CI e cobertura

O workflow `.github/workflows/ci.yml` usa `ubuntu-latest`, Node 24, pnpm 11.25.0, lockfile congelado e chama o agregador `pnpm test:integration`; não há `continue-on-error`. O agregador executa migrations + `db:check` e só então Vitest; qualquer status não zero propaga como falha. A suíte dos processos reais e o A2 permanecem incluídos; nenhum teste foi excluído, enfraquecido ou repetido automaticamente.

CI remoto continua pendente e não é declarado aprovado. O gate integral também continua aberto enquanto CI remoto e entrevistas comerciais não forem concluídos.
