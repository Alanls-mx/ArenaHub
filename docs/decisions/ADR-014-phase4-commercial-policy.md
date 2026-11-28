# ADR-014 — Política comercial central da agenda

Estado: adotado para a política V1 da Fase 4.

Reservas administrativas pendentes ocupam unidades físicas e não expiram automaticamente. Funcionário pode criar reserva pendente ou confirmada, sem que `CONFIRMED` represente pagamento. Cancelamento com antecedência de pelo menos 24 horas calcula obrigação zero; abaixo de 24 horas calcula 50% do preço contratado, arredondado ao centavo; no-show identificado por pessoa autorizada calcula obrigação total de 100%, sem obrigação cumulativa de mais 100%. A reserva registra a versão da política, e `reservation_commercial_outcomes` preserva o resultado em centavos. Não cria cobrança nem débito. Exceção que zera taxa exige `commercial_policy.override` e motivo.

Remarcação recalcula preço pela função pura vigente e guarda o preço anterior no histórico e no resultado comercial. O histórico não é apagado. Mensalidade do primeiro mês é proporcional às ocorrências contratadas restantes sobre todas as ocorrências contratadas daquele mês civil local; o cálculo é inteiro e determinístico. Atraso financeiro não cancela ocupações.

Permanecem sem regra comercial: feriados sem uso, conflitos recorrentes não resolvidos, cancelamento causado pela arena, reposição, multa específica de remarcação, tolerância de no-show e holds do checkout público. Nenhum desses casos produz cobrança presumida nesta fase.
