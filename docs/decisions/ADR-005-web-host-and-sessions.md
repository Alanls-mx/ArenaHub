# ADR-005 — Host, cookies e sessões

Status: **aprovado para a topologia do MVP**. O nome de domínio definitivo pode mudar.

Web e API compartilham um host dedicado ao ArenaHub, inicialmente `app.arenahub.com.br`. O proxy encaminha `/api/v1/...` ao processo Fastify no mesmo host público. A instalação do Cine Cruzeiro permanece separada.

Sessão Web usa cookie `__Host-session` com `Secure`, `HttpOnly`, `Path=/` e sem `Domain`. Métodos mutáveis validam token CSRF vinculado à sessão e origem da requisição. A API não precisa de CORS para a Web em produção; CORS restrito pode ser usado no desenvolvimento local em portas diferentes.

Sessões são globais ao usuário. A cada requisição de organização, a API consulta a membership ativa e as capacidades atuais. Desativar uma membership remove só o acesso àquela arena; logout, troca de senha ou ação de segurança revogam sessões conforme a política da §4.2 do documento mestre.
