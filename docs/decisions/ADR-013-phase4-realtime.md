# ADR-013 — Invalidação da agenda em tempo real

Estado: adotado na Fase 4.

A API publica `pg_notify('arenahub_agenda', {org,kind})` na transação que altera reserva, bloqueio ou recorrência. PostgreSQL entrega a notificação somente após commit. Cada processo da API mantém uma conexão dedicada `LISTEN` e envia `agenda.invalidate` por WebSocket às conexões da organização. O payload não contém cliente, preço, cookie nem segredo. O cliente sempre consulta a API HTTP após a invalidação; WebSocket não é fonte de estado e não arbitra concorrência.

O handshake exige host e `Origin` autorizados, cookie de sessão, membership ativa e `reservations.read`. A API revalida sessão, membership e capability antes de cada transmissão e a cada 30 segundos. A perda do listener inicia reconexão com limite de espera; após reconectar, as conexões recebem invalidação. A Web refaz a consulta ao conectar, ao ganhar foco e por ação manual. As instâncias não compartilham memória: PostgreSQL distribui a invalidação entre processos. A exclusion constraint e os locks continuam sendo as garantias de integridade.

Não há entrega durável de eventos. Se uma futura funcionalidade exigir consumo exatamente uma vez, criar contrato próprio e reavaliar outbox. O proxy de produção deve encaminhar upgrade WebSocket no mesmo host `/api/v1`.
