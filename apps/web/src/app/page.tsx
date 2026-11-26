export default function HomePage() {
  return (
    <main className="shell">
      <div className="brand">
        Arena<span>Hub</span>
      </div>
      <section className="hero">
        <div className="eyebrow">Projeto em construção</div>
        <h1>A operação da sua arena, em um só lugar.</h1>
        <p>
          A fundação técnica do ArenaHub está pronta para receber agenda, clientes, mensalistas e
          financeiro.
        </p>
        <div className="card">
          <strong>Fase 0 — Fundação</strong>
          <p>
            Esta é a primeira tela de desenvolvimento. Os fluxos de produto entram nas próximas
            tarefas.
          </p>
        </div>
        <nav className="preview-links" aria-label="Prévia do projeto">
          <a href="/theme-preview">Componentes do tema</a>
          <a href="/agenda-preview">Protótipo da agenda</a>
        </nav>
      </section>
    </main>
  );
}
