# Política comercial central V1

O snapshot `policy_version=1` acompanha a reserva. Cancelamento pelo menos 24 horas antes do início gera 0 centavos; abaixo de 24 horas gera 50% do preço contratado, arredondado para cima em centavos. No-show após o início gera 100%. O cálculo não recebe valor financeiro do navegador. Isenção exige `commercial_policy.override` e motivo, ambos auditados. A operação registra `reservation_commercial_outcomes`; cobrar, receber ou reembolsar pertence à Fase 5.

`policy.test.ts` cobre limite exato de 24 horas, imediatamente depois e arredondamento ímpar. `booking.integration.test.ts` cobre liberação de ocupações e impedimento de isenção para Staff. Tolerância de atraso, multa de remarcação, reposição e demais exceções não foram definidas comercialmente; ver ADR-014.
