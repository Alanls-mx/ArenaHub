# ADR-011 — Domínios por organização

**Estado:** decisão do fundador registrada em 27/11/2026. Cada arena poderá usar domínio próprio ou subdomínio da plataforma. O nome comercial do domínio da plataforma permanece pendente.

## Fundação da Fase 2

`arena_identity.organization_domains` associa um hostname globalmente único a uma organização e distingue `platform` de `custom`. Os estados são `pending`, `verified`, `active` e `suspended`. Somente `active` com `activated_at` pode ser resolvido. O provisionamento rejeita slugs reservados. O resolvedor normaliza hostnames e recusa hosts desconhecidos. Rotas com slug também exigem que o host ativo pertença à mesma organização.

O slug tem até 63 caracteres para caber em um rótulo DNS. Em host de arena, `/auth/me` lista apenas aquela arena; no host central, lista todas as memberships ativas do usuário.

O rewrite atual do Next encaminha à API o host interno e coloca o host público em `X-Forwarded-Host`. A API usa este cabeçalho **somente** quando o `Host` recebido coincide com `PROXY_INTERNAL_HOST` e o IP do peer está em `TRUSTED_PROXY_IPS`; em chamadas diretas o cabeçalho é ignorado. `trustProxy` do Fastify permanece desativado. O proxy deve limpar cabeçalhos `X-Forwarded-*` fornecidos pelo cliente e aceitar apenas hosts provisionados. Em produção, configure os endereços exatos do proxy; não exponha a API interna diretamente. Verificação de controle DNS, certificado, ativação e administração de domínio pertencem às fases 3 e 6.

## Autenticação entre domínios

O cookie `__Host-session` pertence ao host que o emitiu. Uma sessão criada no host da plataforma não aparece automaticamente em um domínio registrável independente. A identidade global e as memberships permitem login separado em cada host. A API atual aceita mutações de autenticação apenas na origem configurada em `WEB_ORIGIN`, por isso o domínio personalizado ainda não fornece login operacional.

Se o produto exigir entrada centralizada, o fluxo deverá validar previamente a organização e o destino registrado, autenticar na origem central, emitir código aleatório de uso único com expiração curta, trocar o código por sessão nova no host de destino e vincular a troca à membership ativa. Código e estado devem ficar protegidos contra replay, CSRF e redirecionamento arbitrário. O token de sessão não entra na URL. A troca e a revogação precisam de testes próprios antes de ativar domínios personalizados.

O mesmo host continuará servindo Web e `/api/v1` por proxy. Cada host usa cookie próprio, CSRF de sua sessão e origem estrita. CORS amplo e cookies de terceiros não fazem parte do fluxo.

## Administração inicial na Fase 3

Owner ou cargo com `domains.manage` pode listar hostnames da própria organização e registrar uma solicitação de domínio personalizado com hostname normalizado e globalmente único. A nova linha fica exclusivamente em `pending`; a API não oferece transição de estado, verificação DNS, configuração TLS nem disponibilização operacional. O nome comercial do subdomínio da plataforma permanece pendente, então a interface não fabrica um endereço. Auditoria registra o ID da solicitação na mesma transação. Ativação e login em host independente continuam sujeitos aos controles acima.
