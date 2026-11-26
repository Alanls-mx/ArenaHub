import { Badge, Card, Table } from '../../components/ui';

export default function AgendaPreview() {
  return (
    <main className="shell preview">
      <a href="/">← ArenaHub</a>
      <div className="eyebrow">Protótipo estático · dados fictícios</div>
      <h1>Agenda da arena</h1>
      <p>Esta tela demonstra a disposição visual. Nenhum horário pode ser reservado aqui.</p>
      <Card>
        <h2>Terça-feira, 9 de março · Exemplo</h2>
        <Table
          headers={['Horário', 'Quadra A', 'Quadra B', 'Campo society']}
          rows={[
            [
              '18h–19h',
              <Badge tone="success" key="a">
                Livre
              </Badge>,
              <Badge key="b">Reservado</Badge>,
              <Badge tone="success" key="c">
                Livre
              </Badge>,
            ],
            [
              '19h–20h',
              <Badge key="a">Mensalista</Badge>,
              <Badge tone="success" key="b">
                Livre
              </Badge>,
              <Badge tone="warning" key="c">
                Bloqueado
              </Badge>,
            ],
            [
              '20h–21h',
              <Badge tone="success" key="a">
                Livre
              </Badge>,
              <Badge tone="success" key="b">
                Livre
              </Badge>,
              <Badge key="c">Reservado</Badge>,
            ],
          ]}
        />
      </Card>
    </main>
  );
}
