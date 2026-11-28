# ADR-015 — Fronteira entre reserva e confirmação financeira

Estado: interface interna adotada; integração financeira real pendente da Fase 5.

`confirmFromValidatedPayment` não tem rota HTTP. Só deve ser chamada pelo futuro adaptador financeiro depois de verificar aprovação efetiva, identidade da arena e cliente, referência do pagamento e valor suficiente. A função revalida a reserva sob os locks de organização e venue, registra a referência idempotente em `reservation_payment_confirmations`, confirma uma reserva pendente e escreve histórico na mesma transação. Repetir a referência para a mesma reserva não duplica efeitos; reutilizá-la para outra reserva falha. A tabela é um vínculo de prova, não um ledger de pagamentos, cobrança, saldo ou alocação.

Sem adaptador de pagamento confiável, nenhuma reserva é confirmada automaticamente por dinheiro nesta fase. A Fase 5 deve definir como pagamentos parciais, mensalidades, estornos e alocações satisfazem a elegibilidade antes de chamar esta interface.
