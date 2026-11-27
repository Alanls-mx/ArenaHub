# Segurança da fundação

O host de produção planejado é dedicado ao ArenaHub; a API `/api/v1` fica no mesmo host por proxy. Sessões futuras usarão cookie `__Host-session`, sem `Domain`, e CSRF ligado à sessão para mutações. Membership e capacidades serão revalidadas por requisição, preservando acesso às outras arenas quando uma membership for removida. **Autenticação e CSRF ainda não foram implementados.**

Fastify usa Helmet, limite de corpo, timeout, request ID e redaction de headers sensíveis. Liveness e readiness são separados; readiness consulta PostgreSQL e responde apenas estado agregado. CORS amplo não é habilitado. `trustProxy` permanece desabilitado até haver uma topologia de proxy confiável configurada.

O isolamento tenant do **spike** tem matriz ampliada: `forTenant` é contornável por SQL manual, views e escritas aninhadas; repositories futuros precisam filtrar. A FK composta protege referência, não leitura ou alteração inteiramente dentro da organização errada. Um experimento RLS em banco descartável falhou fechado sem contexto e bloqueou escrita aninhada cruzada; a recomendação de adoção explícita está no ADR-002. Identidade e endpoints reais ainda precisarão de testes próprios na Fase 2.

O runner de integração cria banco descartável e recusa URLs herdadas. As migrations experimentais de Prisma só aceitam host local e nomes/usuários esperados; não existe fluxo de deploy de produção para elas.
