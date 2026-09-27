// Testes leves para a lógica pura de dragon-ball-combos.html (sem dependências
// externas — nada de jsdom). Usa o harness em sandbox-harness.js, que roda o próprio
// <script> do site dentro de um vm.Context do Node com um "stub silencioso" no lugar
// de document/window, só pra deixar o carregamento inicial (loadState -> render)
// terminar sem estourar erro. As funções de lógica que a gente quer testar
// (getAbilityUnlocks, ensureTierListIntegrity, moveTierItem, etc.) são declarações
// `function` no topo do arquivo, então continuam acessíveis de fora via
// vm.runInContext mesmo depois — só `const`/`let` de módulo é que não dá pra ler
// direto (mas ainda dá pra CHAMAR funções que os usam por dentro).
//
// Rodar: node test-logic.js

const assert = require('assert');
const { loadApp, evalIn, runIn } = require('./sandbox-harness');

let passed = 0, failed = 0;
async function test(name, fn){
  try{
    await fn();
    passed++;
    console.log(`  ok  - ${name}`);
  }catch(e){
    failed++;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
  }
}

async function main(){
  console.log('Carregando dragon-ball-combos.html num sandbox isolado...');
  const sandbox = await loadApp();

  console.log('\n[ability progression / getAbilityUnlocks]');

  await test('getAbilityUnlocks retorna dados pra um personagem real (Goku)', () => {
    const r = evalIn(sandbox, "getAbilityUnlocks('Goku', 10)");
    assert.ok(r, 'esperava um objeto de volta, veio null/undefined');
    assert.ok(Array.isArray(r.groups) && r.groups.length > 0, 'esperava r.groups não vazio');
  });

  await test('habilidade só vira MAX a partir de ★3 Azul (nível 8), não antes', () => {
    const raw = evalIn(sandbox, "ABILITY_PROGRESSION['Goku']");
    const lvl7 = evalIn(sandbox, "getAbilityUnlocks('Goku', 7)");
    const lvl8 = evalIn(sandbox, "getAbilityUnlocks('Goku', 8)");
    assert.strictEqual(lvl7.habilidade.nome, raw.habilidade.base.nome, 'nível 7 deveria continuar na base');
    assert.strictEqual(lvl8.habilidade.nome, raw.habilidade.max.nome, 'nível 8 deveria virar MAX');
  });

  await test('suprema segue base -> MAX (★5 dourada) -> SMAX (★5 azul/nível 10)', () => {
    const raw = evalIn(sandbox, "ABILITY_PROGRESSION['Goku']");
    assert.strictEqual(evalIn(sandbox, "getAbilityUnlocks('Goku', 4).suprema.nome"), raw.suprema.base.nome);
    assert.strictEqual(evalIn(sandbox, "getAbilityUnlocks('Goku', 5).suprema.nome"), raw.suprema.max.nome);
    assert.strictEqual(evalIn(sandbox, "getAbilityUnlocks('Goku', 10).suprema.nome"), raw.suprema.smax.nome);
  });

  await test('Passiva (Padrão): toda tier sem dado capturado cai em "Ativar" (nenhuma é upgrade de outra)', () => {
    const r = evalIn(sandbox, "getAbilityUnlocks('Goku', 10)");
    const grupo = r.groups.find(g => g.title === 'Passiva (Padrão)');
    assert.ok(grupo, 'esperava existir o grupo "Passiva (Padrão)"');
    assert.ok(grupo.tiers.every(t => t.fallbackTipo === 'Ativar'), 'toda tier desse grupo deveria ter fallbackTipo Ativar');
  });

  await test('Passiva Única: primeira tier é "Ativar", segunda (upgrade) é "Despertar"', () => {
    const r = evalIn(sandbox, "getAbilityUnlocks('Goku', 10)");
    const grupo = r.groups.find(g => g.title === 'Passiva Única');
    assert.ok(grupo, 'esperava existir o grupo "Passiva Única"');
    assert.strictEqual(grupo.tiers[0].fallbackTipo, 'Ativar');
    assert.strictEqual(grupo.tiers[1].fallbackTipo, 'Despertar');
  });

  console.log('\n[storage shim]');

  await test('window.storage existe e é substituído por localStorage quando não há um pré-existente', () => {
    assert.strictEqual(evalIn(sandbox, "typeof window.storage.get"), 'function');
    assert.strictEqual(evalIn(sandbox, "typeof window.storage.set"), 'function');
  });

  await test('window.storage.set/get faz round-trip via localStorage', async () => {
    runIn(sandbox, "window.storage.set('probe', 'hello-world')");
    const rawStored = evalIn(sandbox, "localStorage.getItem('kiai_probe')");
    assert.strictEqual(rawStored, 'hello-world');

    runIn(sandbox, "window.__testGetResult = undefined; window.storage.get('probe').then(r => { window.__testGetResult = r; });");
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual(evalIn(sandbox, "window.__testGetResult"), { value: 'hello-world' });
  });

  await test('window.storage.get de uma chave inexistente resolve null', async () => {
    runIn(sandbox, "window.__testMissing = 'not-set'; window.storage.get('chave_que_nao_existe_xyz').then(r => { window.__testMissing = r; });");
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(evalIn(sandbox, "window.__testMissing"), null);
  });

  await test('não sobrescreve um window.storage já injetado pelo ambiente de hospedagem', async () => {
    const marker = {
      async get(){ return { value: 'veio-do-ambiente' }; },
      async set(){},
    };
    const sandbox2 = await loadApp(marker);
    runIn(sandbox2, "window.__hostCheck = undefined; window.storage.get('qualquer').then(r => { window.__hostCheck = r; });");
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual(evalIn(sandbox2, "window.__hostCheck"), { value: 'veio-do-ambiente' });
  });

  console.log('\n[tier list]');

  await test('tier list nova começa com 5 ranks e todo personagem em "unranked"', () => {
    const info = evalIn(sandbox, "({tiersCount: state.tierList.tiers.length, unrankedCount: state.tierList.unranked.length, totalChars: state.characters.length, allTiersEmpty: state.tierList.tiers.every(t => t.items.length === 0)})");
    assert.strictEqual(info.tiersCount, 5);
    assert.strictEqual(info.unrankedCount, info.totalChars);
    assert.ok(info.allTiersEmpty, 'todo rank deveria começar vazio');
  });

  await test('moveTierItem move um personagem de "unranked" pro rank escolhido', () => {
    const before = evalIn(sandbox, "({unranked: state.tierList.unranked.length})");
    runIn(sandbox, "moveTierItem(state.characters[0].id, state.tierList.tiers[0].id)");
    const after = evalIn(sandbox, "({firstTierCount: state.tierList.tiers[0].items.length, unranked: state.tierList.unranked.length, hasIt: state.tierList.tiers[0].items.includes(state.characters[0].id)})");
    assert.strictEqual(after.firstTierCount, 1);
    assert.strictEqual(after.unranked, before.unranked - 1);
    assert.ok(after.hasIt);
  });

  await test('addTier cria um novo rank; renameTier muda o nome sem mexer nos personagens', () => {
    const countBefore = evalIn(sandbox, "state.tierList.tiers.length");
    runIn(sandbox, "addTier()");
    assert.strictEqual(evalIn(sandbox, "state.tierList.tiers.length"), countBefore + 1);

    const targetId = evalIn(sandbox, "state.tierList.tiers[0].id");
    runIn(sandbox, `renameTier(${JSON.stringify(targetId)}, 'Melhores')`);
    assert.strictEqual(evalIn(sandbox, "state.tierList.tiers[0].label"), 'Melhores');
    assert.strictEqual(evalIn(sandbox, "state.tierList.tiers[0].items.length"), 1, 'renomear não deveria alterar quem está no rank');
  });

  await test('removeTier apaga o rank mas devolve os personagens pra "unranked" (não perde ninguém)', () => {
    const targetId = evalIn(sandbox, "state.tierList.tiers[0].id");
    const itemsInTarget = evalIn(sandbox, "state.tierList.tiers[0].items.length");
    const tiersBefore = evalIn(sandbox, "state.tierList.tiers.length");
    const unrankedBefore = evalIn(sandbox, "state.tierList.unranked.length");

    runIn(sandbox, `removeTier(${JSON.stringify(targetId)})`);

    const tiersAfter = evalIn(sandbox, "state.tierList.tiers.length");
    const unrankedAfter = evalIn(sandbox, "state.tierList.unranked.length");
    assert.strictEqual(tiersAfter, tiersBefore - 1);
    assert.strictEqual(unrankedAfter, unrankedBefore + itemsInTarget);
  });

  console.log('\n[layout Kizuna: render de cada aba]');

  await test('toda aba e a ficha do personagem renderizam HTML sem estourar erro', () => {
    const out = evalIn(sandbox, `(() => {
      const r = {};
      r.chars = renderCharsTab();
      r.collection = renderCollectionTab();
      r.tierlist = renderTierListTab();
      r.combos = renderCombosTab();
      r.guias = renderGuiasTab();
      r.favs = renderFavsTab();
      const goku = state.characters.find(c => c.name === 'Goku');
      ['habilidades','comida','vinculos'].forEach(t => { state.charDetailTab = t; r['detail_'+t] = renderCharDetailPage(goku.id); });
      state.charDetailTab = 'habilidades';
      state.collection[goku.id] = {owned:true, level:7};
      r.coll_owned_card = renderCollectionCard(goku);
      delete state.collection[goku.id];
      return Object.fromEntries(Object.entries(r).map(([k,v]) => [k, typeof v === 'string' ? v.length : -1]));
    })()`);
    Object.entries(out).forEach(([k, len]) => assert.ok(len > 200, `render de "${k}" veio vazio/curto demais (${len})`));
  });

  await test('ficha mostra a progressão completa (base + MAX) e as Passivas do Supremo', () => {
    const html = evalIn(sandbox, "(() => { state.charDetailTab='habilidades'; return renderCharDetailPage(state.characters.find(c=>c.name==='Goku').id); })()");
    const raw = evalIn(sandbox, "ABILITY_PROGRESSION['Goku']");
    assert.ok(html.includes(raw.habilidade.base.nome), 'faltou a habilidade base');
    assert.ok(html.includes(raw.habilidade.max.nome), 'faltou a habilidade MAX');
    assert.ok(html.includes('Passivas do Supremo'), 'faltou o grupo Passivas do Supremo');
  });

  console.log('\n[efeitos de combo das Supremas]');

  await test('toda Suprema cujo texto (na versão mais forte da Ficha) menciona um efeito de combo tem esse efeito marcado em c.supreme.effects', () => {
    const SYN = {
      'Derrubar':'derrubada','Derrubado':'derrubada','Queda':'derrubada','Caído':'derrubada','Derrubada':'derrubada',
      'Repulsão':'empurrao','Recuo':'empurrao','Empurrão':'empurrao',
      'Grande Elevação':'elevacao_alta','Elevação Alta':'elevacao_alta',
      'Pequena Elevação':'elevacao_baixa','Elevação Baixa':'elevacao_baixa',
    };
    const r = evalIn(sandbox, `(() => {
      const SYN = ${JSON.stringify(SYN)};
      const keys = Object.keys(SYN).sort((a,b)=>b.length-a.length);
      const gaps = [];
      state.characters.forEach(c => {
        const p = ABILITY_PROGRESSION[c.name];
        if (!p || !p.suprema) return;
        const top = p.suprema.smax || p.suprema.max || p.suprema.base;
        const desc = (top && top.desc) || '';
        const wanted = new Set(keys.filter(k => desc.includes('['+k+']')).map(k => SYN[k]));
        const have = new Set(c.supreme.effects || []);
        [...wanted].forEach(e => { if (!have.has(e)) gaps.push(c.name + ':' + e); });
      });
      return gaps;
    })()`);
    assert.deepStrictEqual(r, [], 'personagens com efeito descrito na Suprema mas não marcado em supreme.effects: ' + r.join(', '));
  });

  console.log('\n[Doar / ranking de apoiadores]');

  await test('elenco padrão de doadores começa vazio (nunca inventar apoiador)', () => {
    assert.deepStrictEqual(evalIn(sandbox, 'DEFAULT_DONORS'), []);
  });

  await test('aba Doar e o widget flutuante renderizam sem erro; widget some sozinho sem doadores', () => {
    const out = evalIn(sandbox, `(() => {
      const r = {};
      r.doarEmpty = renderDoarTab();
      r.widgetEmpty = renderDonorWidget();
      state.donors = [
        {id:'d1', name:'Fulano', amount:50},
        {id:'d2', name:'Ciclana', amount:200},
        {id:'d3', name:'Beltrano', amount:10},
        {id:'d4', name:'Quarto Lugar', amount:5},
      ];
      r.doarFilled = renderDoarTab();
      r.widgetFilled = renderDonorWidget();
      state.donors = [];
      return Object.fromEntries(Object.entries(r).map(([k,v]) => [k, typeof v === 'string' ? v.length : -1]));
    })()`);
    assert.ok(out.doarEmpty > 200 && out.doarFilled > 200);
    assert.strictEqual(out.widgetEmpty, 0, 'sem doadores o widget deveria vir vazio (nada de caixa "Top 3" zerada)');
    assert.ok(out.widgetFilled > 100);
  });

  await test('widget mostra só o top 3 por valor, maior primeiro no pódio (2º-1º-3º)', () => {
    const r = evalIn(sandbox, `(() => {
      state.donors = [
        {id:'d1', name:'Fulano', amount:50},
        {id:'d2', name:'Ciclana', amount:200},
        {id:'d3', name:'Beltrano', amount:10},
        {id:'d4', name:'Quarto Lugar', amount:5},
      ];
      const html = renderDonorWidget();
      state.donors = [];
      return html;
    })()`);
    assert.ok(r.includes('Ciclana'), 'maior doador deveria aparecer');
    assert.ok(!r.includes('Quarto Lugar'), 'só top 3, o 4º não deveria aparecer');
    // no HTML, o 2º lugar (Fulano) vem ANTES do 1º (Ciclana), que vem antes do 3º (Beltrano) — 2-1-3 no pódio
    const iFulano = r.indexOf('Fulano'), iCiclana = r.indexOf('Ciclana'), iBeltrano = r.indexOf('Beltrano');
    assert.ok(iFulano < iCiclana && iCiclana < iBeltrano, 'ordem do pódio deveria ser 2º, 1º, 3º');
  });

  await test('adicionar e remover apoiador persiste no storage', async () => {
    runIn(sandbox, "state.donors = []; state.donors.push({id:'dx', name:'Teste', amount:12.5}); saveDonors();");
    await new Promise(r => setTimeout(r, 20));
    let saved = JSON.parse(evalIn(sandbox, "localStorage.getItem('kiai_donors')"));
    assert.deepStrictEqual(saved, [{id:'dx', name:'Teste', amount:12.5}]);
    runIn(sandbox, "state.donors = state.donors.filter(d => d.id !== 'dx'); saveDonors();");
    await new Promise(r => setTimeout(r, 20));
    saved = JSON.parse(evalIn(sandbox, "localStorage.getItem('kiai_donors')"));
    assert.deepStrictEqual(saved, []);
  });

  console.log('\n[Patentes, Trilha de Honra e perfil da Aliança Z]');

  await test('patenteFor segue os limiares corretos, do Terráqueo ao Ultra Instinto', () => {
    const r = evalIn(sandbox, `[0, 19.99, 20, 49.99, 50, 99.99, 100, 249.99, 250, 499.99, 500, 10000].map(v => patenteFor(v).key)`);
    assert.deepStrictEqual(r, [
      'terraqueo','terraqueo','guerreiro_z','guerreiro_z','ssj','ssj',
      'ssj2','ssj2','deus_ssj','deus_ssj','ultra_instinto','ultra_instinto',
    ]);
  });

  await test('renderDoarTab mostra as 6 Patentes e as 4 Honras da trilha', () => {
    const html = evalIn(sandbox, 'renderDoarTab()');
    ['Terráqueo','Guerreiro Z','Super Saiyajin','Super Saiyajin 2','Deus Saiyajin','Ultra Instinto'].forEach(label => {
      assert.ok(html.includes(label), `faltou a Patente "${label}"`);
    });
    Object.values(evalIn(sandbox, 'HONOR_BADGES')).forEach(h => {
      assert.ok(html.includes(h.label), `faltou a Honra "${h.label}"`);
    });
  });

  await test('sem Supabase configurado, o painel de admin fica aberto (compatível com o que já existia)', () => {
    assert.strictEqual(evalIn(sandbox, 'isSupabaseConfigured()'), false);
    assert.strictEqual(evalIn(sandbox, 'isDonorAdmin()'), true);
    assert.ok(evalIn(sandbox, 'renderDoarTab()').includes('id="addDonorBtn"'));
  });

  await test('com Supabase "configurado", só quem bate com ADMIN_DISCORD_ID vê o painel de admin', () => {
    const r = evalIn(sandbox, `(() => {
      supabaseAvailable = true;
      window.__sb = { client: {} };
      const withoutLogin = { admin: isDonorAdmin(), hasPanel: renderDoarTab().includes('id="addDonorBtn"') };
      state.discordUser = { id: 'outro-uid', username: 'Fulano' };
      const wrongUser = { admin: isDonorAdmin(), hasPanel: renderDoarTab().includes('id="addDonorBtn"') };
      state.discordUser = { id: ADMIN_DISCORD_ID, username: 'Dono' };
      const rightUser = { admin: isDonorAdmin(), hasPanel: renderDoarTab().includes('id="addDonorBtn"') };
      state.discordUser = null;
      supabaseAvailable = false;
      window.__sb = undefined;
      return { withoutLogin, wrongUser, rightUser };
    })()`);
    assert.deepStrictEqual(r.withoutLogin, { admin:false, hasPanel:false });
    assert.deepStrictEqual(r.wrongUser, { admin:false, hasPanel:false });
    assert.deepStrictEqual(r.rightUser, { admin:true, hasPanel:true });
  });

  await test('número permanente do apoiador nunca é reaproveitado, mesmo depois de remover alguém', () => {
    const r = evalIn(sandbox, `(() => {
      state.donors = [];
      state.nextDonorNumber = 1;
      const a = { id:'a', number: state.nextDonorNumber++, name:'A', amount:10, honras:[] };
      const b = { id:'b', number: state.nextDonorNumber++, name:'B', amount:20, honras:[] };
      state.donors.push(a, b);
      state.donors = state.donors.filter(d => d.id !== 'a'); // remove o primeiro
      const c = { id:'c', number: state.nextDonorNumber++, name:'C', amount:5, honras:[] };
      state.donors.push(c);
      const numbers = state.donors.map(d => d.number);
      state.donors = []; state.nextDonorNumber = 1;
      return numbers;
    })()`);
    assert.deepStrictEqual(r, [2, 3], 'o 3º apoiador deveria ganhar o número 3, não reaproveitar o 1 da pessoa removida');
  });

  await test('apoiador sem dinheiro mas com Honra ainda aparece no mural, sem Patente de apoio pago', () => {
    const html = evalIn(sandbox, `(() => {
      state.donors = [{id:'h1', number:1, name:'Ajudante', amount:0, honras:['cacador_erros']}];
      const out = renderDoarTab();
      state.donors = [];
      return out;
    })()`);
    assert.ok(html.includes('Ajudante'));
    assert.ok(html.includes('Terráqueo'), 'amount 0 cai na Patente-base (Terráqueo), não fica sem nenhuma');
  });

  await test('popup de perfil mostra citação, Discord, link e Honras quando presentes; e nada quando ausentes', () => {
    const r = evalIn(sandbox, `(() => {
      const full = donorProfileModalHtml({id:'p1', number:7, name:'Perfil Completo', amount:60, quote:'Rumo ao topo!', discord:'user#1234', link:'https://x.com/user', honras:['mestre_kame'], active:true});
      const simple = donorProfileModalHtml({id:'p2', number:8, name:'Perfil Simples', amount:5, honras:[], active:true});
      return { full, simple };
    })()`);
    assert.ok(r.full.includes('Rumo ao topo!') && r.full.includes('user#1234') && r.full.includes('x.com/user') && r.full.includes('Mestre Kame'));
    assert.ok(!r.simple.includes('kz-profile-quote'), 'sem citação não deveria renderizar o bloco de citação');
  });

  console.log('\n[ids estáveis do elenco padrão]');

  await test('ids do elenco padrão são únicos e iguais entre duas cargas da página (equipe/coleção/favoritos sobrevivem ao recarregar)', async () => {
    const ids1 = evalIn(sandbox, "state.characters.map(c => c.id)");
    const sandbox2 = await loadApp();
    const ids2 = evalIn(sandbox2, "state.characters.map(c => c.id)");
    assert.strictEqual(new Set(ids1).size, ids1.length, 'tem id repetido no elenco');
    assert.deepStrictEqual(ids2, ids1, 'os ids mudaram de uma carga pra outra');
  });

  console.log('\n[sincronização de dados pessoais via Discord/Supabase]');

  await test('applyStoredValue aplica cada chave certinho em cima do state ao vivo', () => {
    const r = evalIn(sandbox, `(() => {
      const backup = JSON.parse(JSON.stringify({team:state.team, frontRow:state.frontRow, tab:state.tab, favs:state.favs, collapsed:state.donorWidgetCollapsed}));
      applyStoredValue('team_state', JSON.stringify({team:['a','b',null,null,null,null], frontRow:'row1'}));
      applyStoredValue('favs', JSON.stringify(['x','y']));
      applyStoredValue('donor_widget_collapsed', '1');
      applyStoredValue('ui_tab', 'guias');
      applyStoredValue('ui_tab', 'aba-que-nao-existe'); // chave inválida não deveria mudar nada
      const out = {team: state.team, frontRow: state.frontRow, favs: state.favs, collapsed: state.donorWidgetCollapsed, tab: state.tab};
      state.team = backup.team; state.frontRow = backup.frontRow; state.tab = backup.tab; state.favs = backup.favs; state.donorWidgetCollapsed = backup.collapsed;
      return out;
    })()`);
    assert.deepStrictEqual(r.team, ['a','b',null,null,null,null]);
    assert.strictEqual(r.frontRow, 'row1');
    assert.deepStrictEqual(r.favs, ['x','y']);
    assert.strictEqual(r.collapsed, true);
    assert.strictEqual(r.tab, 'guias', 'aba inválida não deveria ter sido aplicada, deveria continuar na última válida (guias)');
  });

  await test('persist() sempre salva local mesmo sem Discord logado (sem tentar tocar no Supabase)', async () => {
    runIn(sandbox, "persist('favs', JSON.stringify(['p1','p2']))");
    await new Promise(r => setTimeout(r, 20));
    const saved = JSON.parse(evalIn(sandbox, "localStorage.getItem('kiai_favs')"));
    assert.deepStrictEqual(saved, ['p1','p2']);
    runIn(sandbox, "persist('favs', JSON.stringify([]))"); // limpa
  });

  await test('logado (Supabase simulado), persist() manda um upsert pra tabela user_data com o próprio user_id', async () => {
    runIn(sandbox, `
      window.__upsertCalls = [];
      window.__sb = { client: { from: (table) => ({ upsert: (row) => { window.__upsertCalls.push({table, row}); return Promise.resolve({error:null}); } }) } };
      supabaseAvailable = true;
      state.discordUser = { id: 'user-uid-123', username: 'Fulano' };
    `);
    runIn(sandbox, "persist('tier_list', JSON.stringify({tiers:[]}))");
    await new Promise(res => setTimeout(res, 20));
    const calls = evalIn(sandbox, 'window.__upsertCalls');
    runIn(sandbox, "supabaseAvailable = false; state.discordUser = null; window.__sb = undefined; window.__upsertCalls = undefined;");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].table, 'user_data');
    assert.deepStrictEqual(calls[0].row, { user_id:'user-uid-123', key:'tier_list', value: JSON.stringify({tiers:[]}) });
  });

  await test('logado (Supabase simulado), pullUserDataFromRemote() aplica as linhas vindas do servidor e refaz o cache local', async () => {
    // usa um id de personagem de verdade — pullUserDataFromRemote() sanitiza favs contra
    // o elenco carregado, então um id inventado seria (corretamente) descartado no filtro.
    const realId = evalIn(sandbox, 'state.characters[0].id');
    runIn(sandbox, `
      window.__sb = { client: { from: () => ({
        select: () => ({ eq: () => Promise.resolve({ error:null, data: [
          { key:'favs', value: JSON.stringify([${JSON.stringify(realId)}]) },
          { key:'ui_tab', value: 'tierlist' },
        ] }) }),
      }) } };
      supabaseAvailable = true;
      state.discordUser = { id:'user-uid-456', username:'Ciclana' };
    `);
    runIn(sandbox, "pullUserDataFromRemote()");
    await new Promise(res => setTimeout(res, 30));
    const out = evalIn(sandbox, `(() => {
      const o = { favs: state.favs, tab: state.tab, localFavs: JSON.parse(localStorage.getItem('kiai_favs')) };
      return o;
    })()`);
    runIn(sandbox, "supabaseAvailable = false; state.discordUser = null; window.__sb = undefined; state.favs = []; state.tab = 'chars';");
    assert.deepStrictEqual(out.favs, [realId], 'favs deveria ter vindo do "servidor"');
    assert.strictEqual(out.tab, 'tierlist');
    assert.deepStrictEqual(out.localFavs, [realId], 'o valor puxado do servidor também deveria ficar salvo local (cache)');
  });

  await test('donors (Aliança Z) não passam por persist()/user_data — continuam num canal público separado', () => {
    // garante que a lista de chaves sincronizadas por conta pessoal não inclui dado público
    const keys = evalIn(sandbox, 'SYNCED_KEYS');
    assert.ok(!keys.includes('donors') && !keys.includes('next_donor_number'), 'donors é dado público, não deveria ir na mesma tabela privada por usuário');
  });

  console.log('\n[layout Kizuna: lógica nova]');

  await test('filtro de raridade "SSR" inclui os SSR [Limitado] e exclui SR/R', () => {
    const r = evalIn(sandbox, `(() => {
      state.filters = {search:'', rarity:'SSR', type:null, affinity:null, element:null};
      const list = getFilteredChars().map(c => c.rarity);
      state.filters = {search:'', rarity:null, type:null, affinity:null, element:null};
      return list;
    })()`);
    assert.ok(r.length > 0);
    assert.ok(r.every(x => x.startsWith('SSR')), 'veio alguém que não é SSR');
    assert.ok(r.some(x => x.includes('Limitado')), 'SSR [Limitado] deveria entrar no filtro SSR');
  });

  await test('"Sugestão por raridade" põe Limitado no 1º rank, SSR no 2º, SR no 3º, R no 4º', () => {
    const r = evalIn(sandbox, `(() => {
      const backup = JSON.stringify(state.tierList);
      suggestTierListByRarity();
      const byTier = state.tierList.tiers.map(t => t.items.map(id => getChar(id).rarity));
      const unranked = state.tierList.unranked.length;
      state.tierList = JSON.parse(backup);
      return {byTier, unranked};
    })()`);
    assert.strictEqual(r.unranked, 0);
    assert.ok(r.byTier[0].length && r.byTier[0].every(x => x.includes('Limitado')));
    assert.ok(r.byTier[1].length && r.byTier[1].every(x => x === 'SSR'));
    assert.ok(r.byTier[2].length && r.byTier[2].every(x => x === 'SR'));
    assert.ok(r.byTier[3].length && r.byTier[3].every(x => x === 'R'));
  });

  await test('placeChar: casa selecionada recebe o guerreiro e troca de lugar se ele já estava em campo', () => {
    const r = evalIn(sandbox, `(() => {
      const [a, b] = state.characters;
      state.team = [a.id, null, null, null, b.id, null];
      state.slotSel = 4;
      placeChar(a.id);
      const afterSwap = [...state.team];
      state.slotSel = null;
      placeChar(b.id);
      const afterRemove = [...state.team];
      state.team = Array(6).fill(null);
      return {afterSwap, afterRemove, a: a.id, b: b.id};
    })()`);
    assert.strictEqual(r.afterSwap[4], r.a, 'a casa 5 deveria receber o personagem escolhido');
    assert.strictEqual(r.afterSwap[0], r.b, 'quem estava na casa 5 deveria ir pra casa antiga do escolhido');
    assert.ok(!r.afterRemove.includes(r.b), 'sem casa selecionada, clicar em quem já está em campo tira ele');
  });

  await test('favoritar persiste no storage e excluir o personagem limpa equipe/favoritos/tier list', async () => {
    const id = evalIn(sandbox, "state.characters[5].id");
    runIn(sandbox, `toggleFav(${JSON.stringify(id)})`);
    await new Promise(r => setTimeout(r, 20));
    assert.ok(JSON.parse(evalIn(sandbox, "localStorage.getItem('kiai_favs')")).includes(id));
    runIn(sandbox, `state.team[2] = ${JSON.stringify(id)}; deleteCharacter(${JSON.stringify(id)})`);
    const r = evalIn(sandbox, `({
      stillExists: state.characters.some(c => c.id === ${JSON.stringify(id)}),
      inTeam: state.team.includes(${JSON.stringify(id)}),
      inFavs: state.favs.includes(${JSON.stringify(id)}),
      inTiers: state.tierList.tiers.some(t => t.items.includes(${JSON.stringify(id)})) || state.tierList.unranked.includes(${JSON.stringify(id)}),
    })`);
    assert.deepStrictEqual(r, {stillExists:false, inTeam:false, inFavs:false, inTiers:false});
  });

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  if(failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
