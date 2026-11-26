import { Badge, Button, Card, Dialog, Input, Table, Toast } from '../../components/ui';

export default function ThemePreview() {
  return (
    <main className="shell preview">
      <a href="/">← ArenaHub</a>
      <h1>Componentes do tema</h1>
      <p>Prévia técnica da identidade LumixEngine.</p>
      <div className="preview-grid">
        <Card>
          <h2>Ações e campos</h2>
          <Button type="button">Reservar horário</Button>
          <Input id="preview-name" label="Nome do cliente" placeholder="Exemplo" />
        </Card>
        <Card>
          <h2>Estados</h2>
          <div className="preview-badges">
            <Badge>Rascunho</Badge>
            <Badge tone="success">Disponível</Badge>
            <Badge tone="warning">Pendente</Badge>
          </div>
          <Toast>Alterações de exemplo salvas.</Toast>
        </Card>
      </div>
      <Card>
        <h2>Dados</h2>
        <Table
          headers={['Espaço', 'Horário', 'Estado']}
          rows={[
            [
              'Quadra A',
              '18h–19h',
              <Badge tone="success" key="a">
                Livre
              </Badge>,
            ],
            [
              'Quadra B',
              '19h–20h',
              <Badge tone="warning" key="b">
                Pendente
              </Badge>,
            ],
          ]}
        />
      </Card>
      <Dialog title="Janela de exemplo" trigger="Abrir diálogo">
        <p>Conteúdo demonstrativo.</p>
      </Dialog>
    </main>
  );
}
