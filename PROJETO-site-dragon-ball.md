# Site Dragon Ball — Brief de Projeto

> Documento de handoff gerado a partir da conversa de planejamento. Leve isso pro Claude Code
> como ponto de partida do projeto.

## 1. Visão geral

Site para um jogo de Dragon Ball com:

1. **Wiki de personagens** — descrição dos personagens em todos os níveis de UP (evolução/transformação).
2. **Gerenciador de combos** — monta o time e simula a cadeia de combo automaticamente.
3. **Contas de usuário** — cada um cria conta, salva suas comps e compartilha com todos.
4. **Tier lists** — montar e compartilhar tier lists com outros usuários.
5. **Ranking de apoiadores** — quem mais doou no mês e no total histórico.

Mais funcionalidades serão adicionadas depois — a arquitetura deve deixar espaço pra isso.

Quem está construindo tem noção básica de programação e quer uma stack bem estruturada
(não é iniciante total, mas também não é engenheiro experiente — evitar coisas que exigem
DevOps/infra manual).

## 2. Stack recomendada

| Camada | Escolha | Por quê |
|---|---|---|
| Frontend + Backend | **Next.js (React)** | Framework único pra páginas e API routes, bem documentado |
| Banco de dados + Auth | **Supabase** (Postgres) | Login pronto, Row Level Security, storage de imagens, sem gerenciar servidor |
| Pagamentos/Doações | **Mercado Pago** | Suporta Pix nativamente, checkout pronto, webhooks para confirmar doação |
| Hospedagem | **Vercel** | Integração direta com Next.js, plano gratuito pra começar |

## 3. Modelo de dados (visão geral)

```sql
usuarios          (id, nome, avatar, criado_em)
personagens       (id, nome, raca, descricao_geral, imagem)
niveis_up         (id, personagem_id, nome_da_forma, stats, habilidades, ordem)
golpes            (id, personagem_id, tipo, nome, descricao,
                    efeito_causado, efeito_requisito)
combos            (id, autor_id, nome, time (array de personagem_id em ordem),
                    publico?, criado_em)
tier_lists        (id, autor_id, nome, publico?, criado_em)
tier_list_itens   (id, tier_list_id, personagem_id, tier)
doacoes           (id, usuario_id, valor, data, referencia_mp)
```

`doacoes` alimenta o ranking de apoiadores — soma por mês (`WHERE data >= início_do_mês`)
e soma histórica total, via agregação SQL simples.

### Tipos de golpe (`golpes.tipo`)

- `ataque1`, `ataque2`, `habilidade`, `suprema` — **iniciam** um combo livremente, cada um
  causando um `efeito_causado`.
- `combinado` — só entra na cadeia se o efeito ativo no momento bater com o `efeito_requisito`
  dele; ao entrar, causa um novo `efeito_causado`, permitindo emendar o próximo golpe.

### Efeitos (`efeito_causado` / `efeito_requisito`)

`Empurrão`, `Derrubada`, `Elevação Alta`, `Elevação Baixa`.

## 4. Mecânica de combo (regra central)

- Time de **6 personagens**, organizados num **grid 2×3** (mesma estrutura usada no
  facilitador de combos anterior do autor, para outro jogo — ver seção 6).
- A cadeia de combo é **automática**, não escolhida golpe a golpe pelo usuário:
  - Para cada posição do time, em ordem de prioridade (fileira da frente primeiro):
    - Se o efeito ativo bate com o `efeito_requisito` do golpe `combinado` do personagem,
      ele entra automaticamente com o combinado (**combo continuado**).
    - Caso contrário, o personagem **reinicia** o combo com seu golpe de entrada
      (o primeiro golpe não-combinado que causa efeito).
  - O algoritmo real usado na base de referência (ver seção 6) faz uma busca por **todo o
    time ainda não usado** atrás de quem tem o gatilho certo — não é estritamente
    "próxima posição fixa", é "próximo personagem disponível que encaixa", com prioridade
    por fileira (linha da frente primeiro, conforme configuração `frontRow`).

```js
// Núcleo da lógica (adaptar do protótipo de referência):
function simulateCombo(charId, abilityKey) {
  const order = priorityOrder(); // ordem de prioridade das 6 posições
  const chain = [ /* golpe inicial */ ];
  const used = new Set([charId]);
  let queue = [...efeitosCausadosPeloGolpeInicial];

  while (queue.length) {
    const eff = queue.shift();
    // procura, na ordem de prioridade, o próximo personagem ainda não usado
    // cujo golpe "combinado" tenha efeito_requisito === eff
    // se achar: adiciona à cadeia, marca como usado, enfileira o efeito que ele causa
  }
  return chain;
}
```

## 5. Ordem sugerida de construção

1. **Wiki de personagens** (sem conta ainda) — cadastrar personagens e níveis de UP, páginas de leitura.
2. **Contas de usuário** — ativar login do Supabase.
3. **Gerenciador de combos** — portar a lógica de combo (ver seção 6) para o schema novo.
4. **Tier list builder** — montar e publicar, ver tier lists públicas de outros usuários.
5. **Ranking de apoiadores** — checkout Mercado Pago + webhook gravando em `doacoes` + página de ranking.
6. **Polimento e extras** — deixar espaço no schema pros recursos futuros.

## 6. Ativos de referência incluídos neste export

- **`dragon-ball-combos.html`** — protótipo funcional standalone (vanilla HTML/JS) com:
  - Aba **Personagens**: CRUD completo (nome, raça, gênero, tags, e os 5 golpes:
    Ataque 1, Ataque 2, Habilidade, Suprema, Ataque Combinado), com filtros e busca.
  - Aba **Montar Equipe**: tabuleiro 2×3, seleção de fileira com prioridade de combo,
    simulador de combo automático, formações salváveis.
  - Botão **Importar/Exportar** (JSON) para cadastrar personagens em lote — cole uma
    lista de personagens no formato mostrado no placeholder para importar de uma vez.
  - Esse arquivo é a base real de onde portar a lógica de combo (função `simulateCombo`,
    `priorityOrder`, `possibleStarters`) para o schema de banco de dados definitivo.
  - Ele foi adaptado de um projeto anterior do autor (mesmo motor de combo, para outro jogo)
    — os nomes de efeitos, raças e o modelo de golpes já foram atualizados para Dragon Ball.

- **`combo-builder-preview.jsx`** — protótipo React anterior (mais simples, sem
  persistência), útil como referência de UI em React/Tailwind caso o front do Next.js
  precise de um ponto de partida visual para o simulador de combo.

## 7. Em aberto / próximos passos com o usuário

- Nome definitivo do site/marca (o protótipo usa "Kiai" como placeholder).
- De onde vêm os dados reais dos personagens: o autor está avaliando extrair de
  screenshots do jogo (rodando em emulador de PC) ou de uma wiki, se existir uma
  com o nível de detalhe necessário (golpes + efeitos).
- Confirmar se o backend deve seguir exatamente Supabase/Next.js/Mercado Pago ou se
  há preferência diferente antes de gerar o scaffold do projeto real.
