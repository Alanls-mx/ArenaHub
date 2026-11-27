# Segurança da fundação

O host de produção planejado é dedicado ao ArenaHub; a API `/api/v1` fica no mesmo host por proxy. Sessões usam cookie `__Host-session`, sem `Domain`, e CSRF ligado à sessão para mutações. Membership e capacidades são revalidadas por requisição, preservando acesso às outras arenas quando uma membership for removida. O header CSRF é derivado do segredo aleatório da sessão e a origem é validada contra WEB_ORIGIN. As mutações autenticadas exigem ambos.

Fastify usa Helmet, limite de corpo, timeout, request ID e redaction de headers sensíveis. Liveness e readiness são separados; readiness consulta PostgreSQL e responde apenas estado agregado. CORS amplo não é habilitado. `trustProxy` permanece desabilitado até haver uma topologia de proxy confiável configurada.

O isolamento tenant do **spike** tem matriz ampliada: `forTenant` é contornável por SQL manual, views e escritas aninhadas; repositories futuros precisam filtrar. A FK composta protege referência, não leitura ou alteração inteiramente dentro da organização errada. Um experimento RLS em banco descartável falhou fechado sem contexto e bloqueou escrita aninhada cruzada; a recomendação de adoção explícita está no ADR-002. Os endpoints de identidade usam escopo explícito, locks e FKs compostas. A matriz e evidência da Fase 2 estão em PHASE2_ACCESS.md e PHASE2_GATE.md.

O runner de integração cria banco descartável e recusa URLs herdadas. As migrations experimentais de Prisma só aceitam host local e nomes/usuários esperados; não existe fluxo de deploy de produção para elas.
