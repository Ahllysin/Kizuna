// Testes leves para a lógica pura de index.html (sem dependências
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
  console.log('Carregando index.html num sandbox isolado...');
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

  console.log('\n[Simulador de combo: Ataque Comb. de Habilidade/Suprema]');

  await test('comboContinuations acha só quem tem o gatilho certo, ignora quem já é a própria origem e quem não bate', () => {
    const r = evalIn(sandbox, `(() => {
      const backupChars = state.characters, backupTeam = state.team;
      state.characters = [
        { id:'a', name:'A', tags:[], skill:{name:'Golpe A', effects:['derrubada']}, supreme:{name:'Supremo A', effects:[]}, combo:{name:'Comb A', triggers:[], effects:[]} },
        { id:'b', name:'B', tags:[], skill:{name:'Golpe B', effects:[]}, supreme:{name:'Supremo B', effects:[]}, combo:{name:'Comb B', triggers:['derrubada'], effects:[]} },
        { id:'c', name:'C', tags:[], skill:{name:'Golpe C', effects:[]}, supreme:{name:'Supremo C', effects:[]}, combo:{name:'Comb C', triggers:['empurrao'], effects:[]} },
      ];
      state.team = ['a','b','c',null,null,null];
      const skillCont = comboContinuations('a','skill').map(x=>x.char.id);
      const supremeCont = comboContinuations('a','supreme'); // supreme não causa efeito nenhum
      state.characters = backupChars; state.team = backupTeam;
      return { skillCont, supremeCont };
    })()`);
    assert.deepStrictEqual(r.skillCont, ['b'], 'só "b" tem o gatilho certo (derrubada); "c" pede empurrao e não deveria entrar');
    assert.deepStrictEqual(r.supremeCont, [], 'suprema sem efeitos não deveria continuar em ninguém');
  });

  console.log('\n[Filtro de pesquisa: tags + persegue/causa]');

  await test('matchSF: tags exigem todas as marcadas; persegue/causa aceitam qualquer uma; vazio deixa todos passarem', () => {
    const r = evalIn(sandbox, `(() => {
      const c = (tags, trig, eff) => ({ tags, combo:{ triggers:trig, effects:eff } });
      const A = c(['Guerreiro S','Artista Marcial'], ['derrubada'], ['empurrao']);
      const B = c(['Guerreiro S'], ['elevacao_baixa'], ['derrubada']);
      const f = (tags, trig, eff) => ({ tags, trig, eff });
      return {
        vazio: matchSF(A, f([],[],[])) && matchSF(B, f([],[],[])),
        duasTags: [matchSF(A, f(['Guerreiro S','Artista Marcial'],[],[])), matchSF(B, f(['Guerreiro S','Artista Marcial'],[],[]))],
        persegueQualquer: [matchSF(A, f([],['derrubada','empurrao'],[])), matchSF(B, f([],['derrubada','empurrao'],[]))],
        causa: [matchSF(A, f([],[],['derrubada'])), matchSF(B, f([],[],['derrubada']))],
        combinado: [matchSF(A, f(['Guerreiro S'],['derrubada'],['empurrao'])), matchSF(B, f(['Guerreiro S'],['derrubada'],['empurrao']))],
        contagem: sfCount(f(['a','b'],['x'],[])),
      };
    })()`);
    assert.strictEqual(r.vazio, true);
    assert.deepStrictEqual(r.duasTags, [true, false]);
    assert.deepStrictEqual(r.persegueQualquer, [true, false]);
    assert.deepStrictEqual(r.causa, [false, true]);
    assert.deepStrictEqual(r.combinado, [true, false]);
    assert.strictEqual(r.contagem, 3);
  });

  console.log('\n[Recomendações de combo]');

  await test('recommendForTeam: sugere quem puxa a cadeia, respeita a casa livre e não sugere quem não ajuda', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, trig, eff) => ({ id, name:id.toUpperCase(), tags:[], rarity:'R', skill:{name:'S'+id, effects:skillEff}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:eff} });
      state.characters = [
        mk('a', ['derrubada'], [], []),            // time: A causa derrubada
        mk('b', [], ['derrubada'], ['empurrao']),  // B persegue derrubada, causa empurrão
        mk('c', [], ['empurrao'], []),             // C persegue empurrão (continua depois de B)
        mk('z', [], ['elevacao_alta'], []),        // Z não encaixa em nada
      ];
      state.team = ['a', null, null, null, null, null];
      const rec = recommendForTeam(5).map(x => ({ id:x.char.id, gain:x.gain, slot:x.slot }));
      const score = comboScoreFor(state.team);
      state.team = ['a','b', null, null, null, null];
      const rec2 = recommendForTeam(5).map(x => x.char.id);
      state.characters = bk[0]; state.team = bk[1];
      return { rec, score, rec2 };
    })()`);
    assert.strictEqual(r.score, 0, 'sozinho, A não puxa ninguém');
    assert.deepStrictEqual(r.rec.map(x=>x.id), ['b'], 'só B ajuda de cara (C só serve depois de B; Z nunca)');
    assert.strictEqual(r.rec[0].gain, 1);
    assert.strictEqual(r.rec[0].slot, 1, 'primeira casa livre testada (empate) — a menor');
    assert.deepStrictEqual(r.rec2, ['c'], 'com A+B em campo, C estende a cadeia e Z continua de fora');
  });

  await test('optimizeTeamOrder: acha a ordem de casas que rende mais encadeamentos e mantém as casas ocupadas', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, trig, eff) => ({ id, name:id.toUpperCase(), tags:[], rarity:'R', skill:{name:'S'+id, effects:skillEff}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:eff} });
      state.characters = [
        mk('a', ['derrubada'], [], []),
        mk('b2', [], ['derrubada'], []),            // pega a derrubada primeiro se estiver numa casa menor, mas não continua
        mk('b1', [], ['derrubada'], ['empurrao']),  // pega a derrubada e causa empurrão
        mk('c', [], ['empurrao'], []),
      ];
      state.team = ['b2', null, 'b1', 'c', null, 'a'];
      const antes = comboScoreFor(state.team);
      const res = optimizeTeamOrder();
      const depois = comboScoreFor(res.team);
      const ocupadas = res.team.map(x => x ? 1 : 0).join('');
      state.team = res.team;
      const again = optimizeTeamOrder();
      state.team = ['a'];
      const solo = optimizeTeamOrder();
      state.characters = bk[0]; state.team = bk[1];
      return { antes, depois, ocupadas, changed: res.changed, againChanged: again.changed, solo };
    })()`);
    assert.ok(r.depois > r.antes, 'a ordem otimizada rende mais (' + r.antes + ' → ' + r.depois + ')');
    assert.strictEqual(r.ocupadas, '101101', 'continua nas mesmas casas ocupadas');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.againChanged, false, 'já otimizada: não propõe mudar de novo');
    assert.strictEqual(r.solo, null, 'com 1 guerreiro não há o que reordenar');
  });

  await test('comboSummary conta os encadeamentos, os inícios com combo e a maior cadeia da equipe', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, trig, eff) => ({ id, name:id.toUpperCase(), tags:[], rarity:'R', skill:{name:'S'+id, effects:skillEff}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:eff} });
      state.characters = [ mk('a',['derrubada'],[],[]), mk('b',[],['derrubada'],['empurrao']), mk('c',[],['empurrao'],[]) ];
      state.team = ['a','b','c',null,null,null];
      const s = comboSummary(state.team);
      const vazio = comboSummary(['a',null,null,null,null,null]);
      state.characters = bk[0]; state.team = bk[1];
      return { s, vazio };
    })()`);
    assert.strictEqual(r.s.starts, 1, 'só a Habilidade de A inicia combo');
    assert.strictEqual(r.s.total, 2, 'A→B→C: B e C são puxados');
    assert.strictEqual(r.s.best.n, 2);
    assert.strictEqual(r.vazio.total, 0);
  });

  await test('comboMaxFor: habilidades sem efeito de combo não entram no máximo, e cada cadeia puxa no máx. 1 por guerreiro em campo', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, supEff) => ({ id, name:id, tags:[], rarity:'R', skill:{name:'S', effects:skillEff}, supreme:{name:'U', effects:supEff}, combo:{name:'C', triggers:[], effects:[]} });
      state.characters = [ mk('a',['derrubada'],['empurrao']), mk('b',['derrubada'],[]), mk('c',[],[]) ];
      const cheio = comboMaxFor(['a','b','c',null,null,null]);
      const um = comboMaxFor(['a',null,null,null,null,null]);
      state.characters = bk[0]; state.team = bk[1];
      return { cheio, um };
    })()`);
    assert.strictEqual(r.cheio.starters, 3, 'A (2) + B (1); C não inicia combo');
    assert.strictEqual(r.cheio.max, 9, '3 inícios × 3 guerreiros');
    assert.strictEqual(r.cheio.abilities, 6);
    assert.strictEqual(r.um.max, 2);
  });

  await test('analyzeRoles: reconhece cura, tank, controle, suporte e dano pelo texto das habilidades', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = state.characters;
      const mk = (id, type, skill, supreme) => ({ id, name:'Teste ' + id, type, tags:[], rarity:'R', skill:{name:'S', desc:skill, effects:[]}, supreme:{name:'U', desc:supreme, effects:[]}, combo:{name:'C', triggers:[], effects:[]} });
      const out = {
        cura: analyzeRoles(mk('h', 'Habilidade', 'Cura todos os aliados em 90% do ATQ.', 'Restaura PV para 2 aliados com menor PV.')).roles,
        tank: analyzeRoles(mk('t', 'Defesa', 'Ganha Escudo de 30% do PV Máx. e aumenta a Redução de Dano em 20%.', 'Protege aliados da mesma coluna e absorve 35% do dano.')).roles,
        ctrl: analyzeRoles(mk('c', 'Habilidade', 'Ataca todos os inimigos, 70% de chance de causar [Atordoamento] e [Silêncio].', 'Reduz 300 de Fúria do alvo e causa [Paralisia].')).roles,
        sup: analyzeRoles(mk('s', 'Habilidade', 'Aumenta o ATQ e a DEF de todos os aliados em 20%.', 'Recupera 200 de Fúria para todos os aliados e concede escudo aos aliados.')).roles,
        dano: analyzeRoles(mk('d', 'Ataque', 'Ataca um único inimigo causando 30% de dano adicional.', 'Ataca todos os inimigos, aumenta a Taxa de Crítico em 30% e causa dano extra.')).roles,
        cond: analyzeRoles(mk('x', 'Ataque', 'Quando um guerreiro aliado é derrotado, recupera 8% da vida.', '')).roles,
      };
      state.characters = bk;
      return out;
    })()`);
    assert.strictEqual(r.cura[0], 'cura');
    assert.ok(r.tank.includes('tank'));
    assert.ok(r.ctrl.includes('controle'));
    assert.ok(r.sup.includes('suporte'));
    assert.strictEqual(r.dano[0], 'dano');
    assert.ok(!r.cond.includes('cura'), 'curar a si quando um aliado morre não faz do guerreiro um curandeiro');
  });

  await test('Sobrevivência: quem revive ou tem 2+ habilidades de autocura (cura própria/roubo de vida) entra; 1 só não; curar aliados é Cura', () => {
    const r = evalIn(sandbox, `(() => {
      const mk = (id, type, skill, sup) => ({ id, name:'Sv ' + id, type, tags:[], rarity:'R', skill:{name:'S', desc:skill, effects:[]}, supreme:{name:'U', desc:sup, effects:[]}, combo:{name:'C', triggers:[], effects:[]} });
      const roles = (...a) => analyzeRoles(mk(...a)).roles;
      return {
        uma: roles('1', 'Ataque', 'Ataca um único inimigo.', 'Ataca todos os inimigos e recupera 20% da vida.'),
        duas: roles('2', 'Ataque', 'Ataca um único inimigo e recupera 10% do PV.', 'Ataca todos os inimigos, com +40% de Roubo de Vida.'),
        reviver: roles('3', 'Ataque', 'Ataca um único inimigo.', 'Se for derrotado, revive com 30% do PV.'),
        reviverAliado: roles('4', 'Habilidade', 'Revive um aliado derrotado com 30% do PV.', ''),
        healer: roles('5', 'Habilidade', 'Cura todos os aliados em 90% do ATQ.', ''),
        duasPil: analyzeRoles(mk('6', 'Ataque', 'Recupera 10% da vida.', 'Aumenta o Roubo de Vida em 30%.')).pillars,
      };
    })()`);
    assert.ok(!r.uma.includes('sobrevivencia'), 'só 1 habilidade de autocura não basta (' + r.uma + ')');
    assert.ok(r.duas.includes('sobrevivencia'), '2 habilidades de autocura (cura própria + roubo de vida) entram (' + r.duas + ')');
    assert.ok(r.reviver.includes('sobrevivencia'), 'reviver entra (' + r.reviver + ')');
    assert.ok(!r.reviverAliado.includes('sobrevivencia'), 'reviver um aliado não é Sobrevivência (' + r.reviverAliado + ')');
    assert.ok(r.healer.includes('cura') && !r.healer.includes('sobrevivencia') && !r.healer.includes('suporte'), 'curar aliados continua sendo Cura');
    assert.ok(!r.duas.includes('suporte') && !r.duas.includes('cura'), 'autocura nunca vira Suporte nem Cura');
    assert.strictEqual(r.duasPil.suporte, 0);
  });

  await test('balanceScore premia equipe com dano, tank, suporte e controle; missingPillars aponta o que falta', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, type, skill) => ({ id, name:'Eq ' + id, type, tags:[], rarity:'R', skill:{name:'S', desc:skill, effects:[]}, supreme:{name:'U', desc:'', effects:[]}, combo:{name:'C', triggers:[], effects:[]} });
      state.characters = [
        mk('d1','Ataque','Causa 30% de dano adicional.'), mk('d2','Ataque','Causa dano extra a todos os inimigos.'),
        mk('t1','Defesa','Ganha Escudo e aumenta a Redução de Dano em 20%.'), mk('t2','Defesa','Aumenta a DEF própria em 20%.'),
        mk('s1','Habilidade','Cura todos os aliados em 90% do ATQ e aumenta o ATQ de todos os aliados.'),
        mk('c1','Habilidade','Causa [Atordoamento] e [Silêncio] nos inimigos e reduz a Fúria do alvo.'),
      ];
      const ids = state.characters.map(c => c.id);
      const solo = ['d1','d2','d1','d2'].slice(0,2);
      const equilibrada = balanceScore(ids);
      const soDano = balanceScore(['d1','d2']);
      const miss = missingPillars(['d1','d2']);
      state.characters = bk[0]; state.team = bk[1];
      return { equilibrada, soDano, miss };
    })()`);
    assert.ok(r.equilibrada > 0.9, 'equipe completa e variada fica perto de 100% (' + r.equilibrada + ')');
    assert.ok(r.soDano < r.equilibrada, 'só dano é menos equilibrado');
    assert.ok(r.miss.includes('tank') && r.miss.includes('suporte'), 'só dano: faltam tank e suporte');
  });

  await test('buildTeamOptions completa a equipe mantendo os guerreiros escolhidos, sem repetir e respeitando a raridade', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, rar, type, skill, trig, eff, skEff) => ({ id, name:'Bt ' + id, type, tags:[], rarity:rar, skill:{name:'S', desc:skill, effects:skEff||[]}, supreme:{name:'U', desc:'', effects:[]}, combo:{name:'C', triggers:trig||[], effects:eff||[]} });
      state.characters = [
        mk('a','SSR','Ataque','Causa dano adicional.',[],[],['derrubada']),
        mk('b','SSR','Defesa','Ganha Escudo e Redução de Dano.',['derrubada'],['empurrao']),
        mk('c','SR','Habilidade','Cura todos os aliados em 90% do ATQ.',['empurrao'],[]),
        mk('d','SSR','Habilidade','Causa [Atordoamento] e [Silêncio] nos inimigos.',['derrubada'],[]),
        mk('e','R','Ataque','Causa dano extra.',[],[]),
        mk('f','SSR [Limitado]','Ataque','Causa dano adicional a todos os inimigos.',[],[]),
        mk('g','SSR','Defesa','Aumenta a DEF própria.',[],[]),
      ];
      state.team = ['a', null, null, null, null, null];
      const todas = buildTeamOptions('equilibrado', 'all', 3);
      const ssr = buildTeamOptions('equilibrado', 'SSR', 3);
      state.team = ['a','b','c','d','e','f'];
      const cheia = buildTeamOptions('equilibrado', 'all', 3);
      state.team = [];
      const vazia = buildTeamOptions('equilibrado', 'all', 3);
      state.characters = bk[0]; state.team = bk[1];
      return {
        nTodas: todas.length, todasOk: todas.every(o => o.team.filter(Boolean).length === 6 && new Set(o.team.filter(Boolean)).size === 6 && o.team.includes('a')),
        ssrOnly: ssr.every(o => o.team.filter(Boolean).every(id => id === 'a' || ['b','d','f','g'].includes(id))),
        nSsr: ssr.length, cheia: cheia.length, vazia: vazia.length,
        ordenado: todas.every((o, i) => i === 0 || todas[i-1].score >= o.score),
      };
    })()`);
    assert.ok(r.nTodas >= 1);
    assert.ok(r.todasOk, 'sempre 6 guerreiros distintos, com o escolhido dentro');
    assert.ok(r.ssrOnly && r.nSsr >= 0, 'com "Só SSR" só entram SSR (inclui Limitado) além do guerreiro escolhido');
    assert.strictEqual(r.cheia, 0, 'equipe cheia não tem o que completar');
    assert.strictEqual(r.vazia, 0, 'sem nenhum guerreiro escolhido não monta nada');
    assert.ok(r.ordenado);
  });

  await test('recommendForTeam filtra por raridade (SSR inclui Limitado, exclui SR/R)', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, rar, trig) => ({ id, name:id.toUpperCase(), tags:[], rarity:rar, skill:{name:'S'+id, effects:id==='a'?['derrubada']:[]}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:[]} });
      state.characters = [ mk('a','SSR',[]), mk('s1','SSR',['derrubada']), mk('s2','SSR [Limitado]',['derrubada']), mk('r1','SR',['derrubada']), mk('r2','R',['derrubada']) ];
      state.team = ['a', null, null, null, null, null];
      const ids = x => recommendForTeam(10, x).map(y => y.char.id).sort().join(',');
      const out = { all: ids('all'), ssr: ids('SSR'), sr: ids('SR'), r: ids('R'), none: ids() };
      state.characters = bk[0]; state.team = bk[1];
      return out;
    })()`);
    assert.strictEqual(r.ssr, 's1,s2');
    assert.strictEqual(r.sr, 'r1');
    assert.strictEqual(r.r, 'r2');
    assert.strictEqual(r.all, 'r1,r2,s1,s2');
    assert.strictEqual(r.none, 'r1,r2,s1,s2');
  });

  await test('recommendForTeam com equipe cheia sugere trocas e equipe vazia não sugere nada', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, trig, eff) => ({ id, name:id.toUpperCase(), tags:[], rarity:'R', skill:{name:'S'+id, effects:skillEff}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:eff} });
      state.characters = [
        mk('a', ['derrubada'], [], []), mk('f1', [], [], []), mk('f2', [], [], []), mk('f3', [], [], []), mk('f4', [], [], []), mk('f5', [], [], []),
        mk('b', [], ['derrubada'], []),
      ];
      state.team = [];
      const vazio = recommendForTeam(5).length;
      state.team = ['a','f1','f2','f3','f4','f5'];
      const rec = recommendForTeam(5).map(x => ({ id:x.char.id, replaced:x.replacedId }));
      state.characters = bk[0]; state.team = bk[1];
      return { vazio, rec };
    })()`);
    assert.strictEqual(r.vazio, 0);
    assert.strictEqual(r.rec.length, 1);
    assert.strictEqual(r.rec[0].id, 'b');
    assert.notStrictEqual(r.rec[0].replaced, 'a', 'não troca o guerreiro que inicia a cadeia');
  });

  await test('quem inicia a cadeia também persegue (uma vez): o Ataque Combinado dele entra na própria cadeia', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.characters, state.team];
      const mk = (id, skillEff, trig, eff) => ({ id, name:id.toUpperCase(), tags:[], skill:{name:'S'+id, effects:skillEff}, supreme:{name:'U'+id, effects:[]}, combo:{name:'C'+id, triggers:trig, effects:eff} });
      state.characters = [
        mk('a', ['derrubada'], ['derrubada'], ['empurrao']),  // A causa derrubada e também persegue derrubada
        mk('b', [], ['empurrao'], ['derrubada']),              // B persegue empurrão e causa derrubada (devolveria pra A)
      ];
      state.team = ['a','b',null,null,null,null];
      const chain = simulateCombo('a','skill').map(s => s.charId + ':' + s.abilityKey);
      const cont = comboContinuations('a','skill').map(x => x.char.id);
      state.characters = bk[0]; state.team = bk[1];
      return { chain, cont };
    })()`);
    assert.deepStrictEqual(r.chain, ['a:skill','a:combo','b:combo'], 'A inicia, persegue a própria Derrubada uma vez e B continua; A não repete o combo');
    assert.deepStrictEqual(r.cont, ['a'], 'a lista de um passo também inclui o próprio A');
  });

  await test('renderSimPanel(): time vazio avisa; com time, mostra os 6 cards e as duas seções (Habilidade/Suprema) de quem está selecionado', () => {
    const r = evalIn(sandbox, `(() => {
      const backupChars = state.characters, backupTeam = state.team, backupSel = state.simCharId;
      const semTime = renderSimPanel();
      state.characters = [
        { id:'a', name:'A', tags:[], skill:{name:'Golpe A', effects:['derrubada']}, supreme:{name:'Supremo A', effects:[]}, combo:{name:'Comb A', triggers:[], effects:[]} },
        { id:'b', name:'B', tags:[], skill:{name:'Golpe B', effects:[]}, supreme:{name:'Supremo B', effects:[]}, combo:{name:'Comb B', triggers:['derrubada'], effects:[]} },
      ];
      state.team = ['a','b',null,null,null,null];
      state.simCharId = 'a';
      const comTime = renderSimPanel();
      state.characters = backupChars; state.team = backupTeam; state.simCharId = backupSel;
      return { semTime, comTime };
    })()`);
    assert.ok(!r.semTime.includes('kz-sim-roster'), 'sem ninguém no time não deveria mostrar a roleta de personagens');
    assert.ok(r.comTime.includes('data-sim-char="a"') && r.comTime.includes('data-sim-char="b"'), 'deveria listar os 2 do time como cards clicáveis');
    assert.ok(r.comTime.includes('Golpe A') && r.comTime.includes('Comb B'), 'seção de Habilidade de A deveria mostrar A e o Ataque Comb. de B que ela ativa');
    assert.ok(r.comTime.includes('não causa efeito de combo'), 'seção de Suprema de A (sem efeitos) deveria avisar que não continua em nada');
  });

  await test('simulateCombo() segue a prioridade de casa (menor número primeiro) e encadeia até onde der', () => {
    const r = evalIn(sandbox, `(() => {
      const backupChars = state.characters, backupTeam = state.team;
      state.characters = [
        { id:'a', name:'A', tags:[], skill:{name:'Golpe A', effects:['derrubada']}, supreme:{name:'Supremo A', effects:[]}, combo:{name:'Comb A', triggers:[], effects:[]} },
        { id:'b', name:'B', tags:[], skill:{name:'Golpe B', effects:[]}, supreme:{name:'Supremo B', effects:[]}, combo:{name:'Comb B', triggers:['derrubada'], effects:[]} },
        { id:'c', name:'C', tags:[], skill:{name:'Golpe C', effects:[]}, supreme:{name:'Supremo C', effects:[]}, combo:{name:'Comb C', triggers:['derrubada'], effects:['empurrao']} },
        { id:'d', name:'D', tags:[], skill:{name:'Golpe D', effects:[]}, supreme:{name:'Supremo D', effects:[]}, combo:{name:'Comb D', triggers:['empurrao'], effects:[]} },
      ];
      // casas: 1=a, 2=c, 3=d, 4=b — tanto b (casa4) quanto c (casa2) reagem a "derrubada",
      // mas c deveria ganhar por estar numa casa de número menor.
      state.team = ['a','c','d','b',null,null];
      const chain = simulateCombo('a','skill').map(step => step.charId);
      const html = renderAtkSection('a','skill');
      state.characters = backupChars; state.team = backupTeam;
      return { chain, html };
    })()`);
    assert.deepStrictEqual(r.chain, ['a','c','d'], 'c (casa 2) deveria entrar antes de b (casa 4), e d deveria continuar a cadeia depois de c');
    assert.ok(r.html.includes('3 hits'), 'deveria anunciar a cadeia completa de 3 hits');
    const tagCount = (r.html.match(/kz-atk-priority-tag/g) || []).length;
    assert.strictEqual(tagCount, 1, 'só um card deveria ganhar o selo de prioridade');
    const cCardIdx = r.html.indexOf('Comb C');
    const bCardIdx = r.html.indexOf('Comb B');
    const tagIdx = r.html.indexOf('kz-atk-priority-tag');
    assert.ok(tagIdx > -1 && cCardIdx > -1 && bCardIdx > -1 && tagIdx < cCardIdx && Math.abs(tagIdx - cCardIdx) < Math.abs(tagIdx - bCardIdx),
      'o selo de prioridade deveria estar no card de C (casa menor), não no de B');
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

  await test('patenteFor segue os limiares corretos, do Guerreiro Z ao Anjo', () => {
    const r = evalIn(sandbox, `[0, 19.99, 20, 49.99, 50, 99.99, 100, 199.99, 200, 349.99, 350, 599.99, 600, 999.99, 1000, 10000].map(v => patenteFor(v).key)`);
    assert.deepStrictEqual(r, [
      'guerreiro_z','guerreiro_z','saiyajin','saiyajin','ssj','ssj',
      'ssj_god','ssj_god','ssj_blue','ssj_blue','ultra','ultra',
      'deus_destruicao','deus_destruicao','anjo','anjo',
    ]);
  });

  await test('renderDoarTab mostra as 8 Patentes e as 4 Honras da trilha', () => {
    const html = evalIn(sandbox, 'renderDoarTab()');
    ['Guerreiro Z','Saiyajin','Super Saiyajin','Super Saiyajin God','Super Saiyajin Blue','Ultra Instinto','Deus da Destruição','Anjo'].forEach(label => {
      assert.ok(html.includes(label), `faltou a Patente "${label}"`);
    });
    Object.values(evalIn(sandbox, 'HONOR_BADGES')).forEach(h => {
      assert.ok(html.includes(h.label), `faltou a Honra "${h.label}"`);
    });
  });

  await test('patenteLook: Ultra aceita só as formas válidas e escolhe cor; Anjo escolhe cor (só #rrggbb) ou usa a padrão', () => {
    const r = evalIn(sandbox, `(() => {
      const forma = v => patenteLook(400, { patenteForma: v }).label;
      const cor = v => patenteLook(1500, { patenteCor: v }).style;
      return {
        beast: forma('Beast'), ego: forma('Ultra Ego'), invalida: forma('Sei lá'), semPerfil: patenteLook(400, null).label,
        outraPatenteIgnoraForma: patenteLook(60, { patenteForma: 'Beast' }).label,
        corOk: cor('#ff0000'), corPadrao: cor(''), corInjetada: cor('red;background:url(x)'),
        badge: patenteBadgeHtml(400, '', { patenteForma: 'Ultra Ego' }),
        badgeAnjo: patenteBadgeHtml(1500, '', { patenteCor: '#00ff00' }),
        corOutraPatente: patenteLook(60, { patenteCor: '#00ff00' }).style,
        ultraComCor: patenteLook(400, { patenteForma: 'Beast', patenteCor: '#ff00ff' }),
        ultraPadrao: patenteLook(400, null).style,
      };
    })()`);
    assert.strictEqual(r.beast, 'Beast');
    assert.strictEqual(r.ego, 'Ultra Ego');
    assert.strictEqual(r.invalida, 'Ultra Instinto', 'forma desconhecida volta pro nome da patente');
    assert.strictEqual(r.semPerfil, 'Ultra Instinto');
    assert.strictEqual(r.outraPatenteIgnoraForma, 'Super Saiyajin', 'só a patente Ultra tem formas');
    assert.ok(r.corOk.startsWith('--pc:255,0,0;'), 'cor escolhida vira variável de CSS (' + r.corOk + ')');
    assert.ok(r.corPadrao.startsWith('--pc:232,241,255;'), 'sem cor escolhida usa a padrão do Anjo');
    assert.ok(r.corPadrao === r.corInjetada, 'texto que não é #rrggbb é ignorado (nada vira CSS solto)');
    assert.ok(r.badge.includes('Ultra Ego') && r.badge.includes('patente-ultra'));
    assert.ok(r.badgeAnjo.includes('--pc:0,255,0;') && r.badgeAnjo.includes('patente-anjo'));
    assert.strictEqual(r.corOutraPatente, '', 'só Ultra Instinto e Anjo escolhem cor');
    assert.strictEqual(r.ultraComCor.label, 'Beast');
    assert.ok(r.ultraComCor.style.startsWith('--pc:255,0,255;'), 'Ultra: forma E cor escolhidas');
    assert.ok(r.ultraPadrao.startsWith('--pc:140,180,255;'), 'Ultra sem cor escolhida usa o azul prateado padrão');
  });

  await test('Perfil mostra a escolha de forma (patente Ultra) ou de cor (Anjo) só pra quem tem apoio vinculado a esse login', () => {
    const r = evalIn(sandbox, `(() => {
      supabaseAvailable = true;
      window.__sb = { client: {} };
      state.discordUser = { id: 'u1', username: 'Fulano' };
      state.myProfile = blankProfile();
      const semApoio = renderPerfilTab();
      state.donors = [{ id:'d1', number:1, name:'Fulano', amount:400, honras:[], active:true, linkedUserId:'u1' }];
      const ultra = renderPerfilTab();
      state.donors = [{ id:'d1', number:1, name:'Fulano', amount:1200, honras:[], active:true, linkedUserId:'u1' }];
      const anjo = renderPerfilTab();
      state.donors = [{ id:'d1', number:1, name:'Fulano', amount:60, honras:[], active:true, linkedUserId:'u1' }];
      const ssj = renderPerfilTab();
      state.donors = []; state.discordUser = null; state.myProfile = null;
      supabaseAvailable = false; window.__sb = undefined;
      return { semApoio, ultra, anjo, ssj };
    })()`);
    assert.ok(!r.semApoio.includes('perfilPatenteForma') && !r.semApoio.includes('perfilPatenteCor'));
    assert.ok(r.ultra.includes('perfilPatenteForma') && r.ultra.includes('Ultra Ego') && r.ultra.includes('Beast') && r.ultra.includes('perfilPatenteCor'), 'Ultra Instinto escolhe forma e cor');
    assert.ok(r.anjo.includes('perfilPatenteCor') && !r.anjo.includes('perfilPatenteForma'), 'Anjo escolhe só a cor');
    assert.ok(!r.ssj.includes('perfilPatenteForma') && !r.ssj.includes('perfilPatenteCor') && r.ssj.includes('Super Saiyajin'));
    assert.ok(!r.ultra.includes('perfilAvatarSelect'), 'avatar por guerreiro continua desligado');
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
      state.discordUser = { id: window.ADMIN_DISCORD_ID, username: 'Dono' };
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
    assert.ok(html.includes('Guerreiro Z'), 'amount 0 cai na Patente-base (Guerreiro Z), não fica sem nenhuma');
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

  console.log('\n[Comunidade: times e tier lists compartilhados]');

  await test('sanitizeCommunityData: aceita o formato certo e descarta lixo/injeção vindos do banco', () => {
    const r = evalIn(sandbox, `(() => ({
      time: sanitizeCommunityData('team', { team: ['c_a', null, 'c_b'] }),
      timeSujo: sanitizeCommunityData('team', { team: ['<img src=x onerror=alert(1)>', 'c_ok', 7, 'a'.repeat(200)] }),
      timeVazio: sanitizeCommunityData('team', { team: [null, null] }),
      timeErrado: sanitizeCommunityData('team', { team: 'c_a' }),
      tipoDesconhecido: sanitizeCommunityData('outro', { team: ['c_a'] }),
      tier: sanitizeCommunityData('tierlist', { tiers: [
        { label: 'S'.repeat(40), color: 'red;background:url(x)', items: ['c_a', '<b>', 'c_b'] },
        { label: 'Vazio', color: '#112233', items: [] },
        { label: 'A', color: '#AABBCC', items: ['c_c'] },
      ] }),
      tierSemNada: sanitizeCommunityData('tierlist', { tiers: [{ label: 'S', color: '#112233', items: [] }] }),
      tierMuitos: sanitizeCommunityData('tierlist', { tiers: Array.from({length: 30}, (_, i) => ({ label: 'T' + i, color: '#112233', items: ['c_a'] })) }),
    }))()`);
    assert.deepStrictEqual(r.time.team, ['c_a', null, 'c_b', null, null, null]);
    assert.deepStrictEqual(r.timeSujo.team, [null, 'c_ok', null, null, null, null], 'ids com HTML, números e textos gigantes viram vazio');
    assert.strictEqual(r.timeVazio, null);
    assert.strictEqual(r.timeErrado, null);
    assert.strictEqual(r.tipoDesconhecido, null);
    assert.strictEqual(r.tier.tiers.length, 2, 'rank sem ninguém é descartado');
    assert.strictEqual(r.tier.tiers[0].label.length, 16, 'nome do rank é cortado');
    assert.strictEqual(r.tier.tiers[0].color, '#5b7fa6', 'cor que não é #rrggbb vira a padrão (nada vira CSS solto)');
    assert.deepStrictEqual(r.tier.tiers[0].items, ['c_a', 'c_b']);
    assert.strictEqual(r.tierSemNada, null);
    assert.strictEqual(r.tierMuitos.tiers.length, 10, 'no máximo 10 ranks');
  });

  await test('communityShareData: time vem da Coleção (2+ guerreiros adquiridos, com o nível de estrela de cada um); tier list precisa de 3+ classificados', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.team, state.tierList, state.collection];
      const ids = state.characters.slice(0, 5).map(c => c.id);
      state.collection = { [ids[0]]: { owned: true, level: 7 }, [ids[1]]: { owned: true, level: 3 }, [ids[2]]: { owned: false, level: 9 } };
      const um = communityShareData('team', { team: [ids[0]] });
      const naoAdquirido = communityShareData('team', { team: [ids[0], ids[2]] });
      const dois = communityShareData('team', { team: [ids[0], ids[1], ids[2], ids[3]] });
      const semCompose = communityShareData('team');
      state.tierList = { tiers: [{ id:'t1', label:'S', color:'#d65a44', items:[ids[0], ids[1]] }], unranked: [] };
      const doisTier = communityShareData('tierlist');
      state.tierList = { tiers: [{ id:'t1', label:'S', color:'#d65a44', items:[ids[0], ids[1]] }, { id:'t2', label:'A', color:'#c9a24b', items:[ids[2], 'id-que-nao-existe'] }], unranked: [] };
      const tres = communityShareData('tierlist');
      state.team = bk[0]; state.tierList = bk[1];
      state.collection = bk[2];
      return { um, naoAdquirido, dois, semCompose, doisTier, tres: tres && tres.tiers.map(x => x.items.length) };
    })()`);
    assert.strictEqual(r.um, null);
    assert.strictEqual(r.naoAdquirido, null, 'guerreiro que não está adquirido na Coleção não entra no time');
    assert.strictEqual(r.semCompose, null);
    assert.ok(r.dois && r.dois.team.filter(Boolean).length === 2, 'só os 2 adquiridos entram');
    assert.deepStrictEqual(Object.values(r.dois.levels).sort(), [3, 7], 'cada um leva o nível de estrela que tem na Coleção');
    assert.strictEqual(r.doisTier, null);
    assert.deepStrictEqual(r.tres, [2, 1], 'ids inexistentes não são publicados');
  });

  await test('aba Comunidade: sem Supabase explica; com posts escapa HTML, filtra, ordena por curtidas e busca por guerreiro', () => {
    const r = evalIn(sandbox, `(() => {
      const semBanco = renderComunidadeTab();
      supabaseAvailable = true;
      window.__sb = { client: {} };
      const bk = [state.communityPosts, state.communityLoaded];
      const a = state.characters[0], b = state.characters[1];
      const mkRow = (id, kind, title, likes, when, data, author) => ({ id, user_id:'u-' + id, kind, title, description:'desc ' + id, data, author_name: author || 'Autor ' + id, created_at: when, community_likes:[{count:likes}], community_reports:[{count:0}] });
      state.communityPosts = [
        mkRow('1', 'team', 'Time <script>alert(1)</script> forte', 2, '2026-01-01T00:00:00Z', { team:[a.id, b.id, null, null, null, null] }, '<img src=x onerror=alert(2)>'),
        mkRow('2', 'tierlist', 'Minha tier', 9, '2026-01-02T00:00:00Z', { tiers:[{ label:'S', color:'#112233', items:[a.id] }] }),
        mkRow('3', 'team', 'Outro time', 5, '2026-01-03T00:00:00Z', { team:[b.id, null, null, null, null, null] }),
        { id:'x', kind:'team', title:'lixo', data:{ team: 'nao-e-lista' } },
      ].map(communityPostFromRow).filter(Boolean);
      state.communityLoaded = true;
      state.communityFilter = 'all'; state.communitySort = 'recent'; state.communitySearch = '';
      const html = renderComunidadeTab();
      const ordemRecente = communityVisiblePosts().map(p => p.id).join(',');
      state.communitySort = 'likes';
      const ordemLikes = communityVisiblePosts().map(p => p.id).join(',');
      state.communitySort = 'recent'; state.communityFilter = 'team';
      const soTimes = communityVisiblePosts().map(p => p.id).join(',');
      state.communityFilter = 'all'; state.communitySearch = b.name.toLowerCase();
      const porNome = communityVisiblePosts().map(p => p.id).sort().join(',');
      state.communitySearch = 'zzzz-nada';
      const nada = renderCommunityList();
      state.communitySearch = ''; state.communityPosts = bk[0]; state.communityLoaded = bk[1];
      supabaseAvailable = false; window.__sb = undefined;
      return { semBanco, html, ordemRecente, ordemLikes, soTimes, porNome, nada, total: 3 };
    })()`);
    assert.ok(r.semBanco.includes('precisa da conta online'));
    assert.ok(!r.html.includes('<script>alert(1)</script>') && r.html.includes('&lt;script&gt;'), 'título com HTML sai escapado');
    assert.ok(!r.html.includes('<img src=x onerror=alert(2)>'), 'nome do autor com HTML sai escapado');
    assert.ok(!r.html.includes('lixo'), 'post com dados inválidos nem aparece');
    assert.strictEqual(r.ordemRecente, '3,2,1');
    assert.strictEqual(r.ordemLikes, '2,3,1');
    assert.strictEqual(r.soTimes, '3,1');
    assert.ok(r.porNome.includes('1') && r.porNome.includes('3') && !r.porNome.includes('2'), 'busca pelo nome de um guerreiro do time (' + r.porNome + ')');
    assert.ok(r.nada.includes('Nada encontrado'));
  });

  await test('publicar na Comunidade: exige login, título e conteúdo; manda a linha certa; respeita o intervalo entre posts', async () => {
    runIn(sandbox, `
      window.__inserts = [];
      window.__sb = { client: { from: (table) => ({
        insert: (row) => { window.__inserts.push({ table, row }); return Promise.resolve({ error: null }); },
        select: () => ({ order: () => ({ limit: () => Promise.resolve({ error: null, data: [] }) }), eq: () => Promise.resolve({ error: null, data: [] }) }),
      }) } };
      supabaseAvailable = true;
      localStorage.removeItem('kiai_community_last');
      window.__bk = [state.team, state.communityCompose, state.discordUser, state.myProfile, state.collection];
      state.collection = { [state.characters[0].id]: { owned: true, level: 8 }, [state.characters[1].id]: { owned: true, level: 2 } };
      state.myProfile = { nickname: 'Apelido', public: true };
      state.discordUser = null;
      state.communityCompose = { kind: 'team', title: 'Meu time', desc: '  descrição  ', team: [state.characters[0].id, state.characters[1].id] };
    `);
    runIn(sandbox, 'publishCommunityPost()');
    await new Promise(res => setTimeout(res, 20));
    const semLogin = evalIn(sandbox, 'window.__inserts.length');
    runIn(sandbox, "state.discordUser = { id: 'uid-1', username: 'Fulano' }; state.communityCompose.title = 'ab'; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 20));
    const tituloCurto = evalIn(sandbox, 'window.__inserts.length');
    runIn(sandbox, "state.communityCompose.title = 'Meu time'; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 40));
    const row = evalIn(sandbox, 'window.__inserts[0] && window.__inserts[0].row');
    const table = evalIn(sandbox, 'window.__inserts[0] && window.__inserts[0].table');
    runIn(sandbox, "state.communityCompose = { kind: 'team', title: 'Segundo post', desc: '', team: [state.characters[0].id, state.characters[1].id] }; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 40));
    const depoisDoSegundo = evalIn(sandbox, 'window.__inserts.length');
    runIn(sandbox, `
      state.team = window.__bk[0]; state.communityCompose = window.__bk[1]; state.discordUser = window.__bk[2]; state.myProfile = window.__bk[3]; state.collection = window.__bk[4];
      supabaseAvailable = false; window.__sb = undefined; window.__inserts = undefined; window.__bk = undefined;
      localStorage.removeItem('kiai_community_last');
    `);
    assert.strictEqual(semLogin, 0, 'sem login não publica');
    assert.strictEqual(tituloCurto, 0, 'título curto não publica');
    assert.strictEqual(table, 'community_posts');
    assert.strictEqual(row.user_id, 'uid-1');
    assert.strictEqual(row.kind, 'team');
    assert.strictEqual(row.title, 'Meu time');
    assert.strictEqual(row.description, 'descrição', 'descrição sai sem espaços sobrando');
    assert.strictEqual(row.author_name, 'Apelido', 'perfil público: usa o apelido');
    assert.ok(row.data.team.filter(Boolean).length === 2);
    assert.deepStrictEqual(Object.values(row.data.levels).sort(), [2, 8], 'o time publicado leva o nível de estrela de cada guerreiro (da Coleção)');
    assert.strictEqual(depoisDoSegundo, 1, 'o segundo post logo em seguida é barrado pelo intervalo');
  });

  await test('limite de times na Comunidade: 2 pra todos, 5 pra quem apoiou com R$ 10+ (soma só apoio ativo vinculado ao login); tier list não entra nessa conta', async () => {
    runIn(sandbox, `
      window.__ins = [];
      window.__sb = { client: { from: () => ({ insert: (row) => { window.__ins.push(row); return Promise.resolve({ error: null }); },
        select: () => ({ order: () => ({ limit: () => Promise.resolve({ error: null, data: [] }) }), eq: () => Promise.resolve({ error: null, data: [] }) }) }) } };
      supabaseAvailable = true;
      window.__bk3 = [state.team, state.communityPosts, state.communityCompose, state.discordUser, state.donors, state.myProfile, state.tierList, state.collection];
      state.myProfile = null;
      state.collection = { [state.characters[0].id]: { owned: true, level: 1 }, [state.characters[1].id]: { owned: true, level: 1 } };
      state.discordUser = { id: 'uid-L', username: 'Lim' };
      const mk = (id, kind) => ({ id, userId: 'uid-L', kind, title: 'T', desc: '', author: 'A', createdAt: '', data: {}, likes: 0, reports: 0 });
      state.communityPosts = [mk('a', 'team'), mk('b', 'team'), mk('c', 'tierlist')];
      state.donors = [];
    `);
    const sem = evalIn(sandbox, '[communityTeamLimit(), communityMyTeamCount()]');
    runIn(sandbox, "localStorage.removeItem('kiai_community_last'); state.communityCompose = { kind: 'team', title: 'Terceiro time', desc: '', team: [state.characters[0].id, state.characters[1].id] }; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 30));
    const bloqueado = evalIn(sandbox, 'window.__ins.length');
    runIn(sandbox, "state.donors = [{ id: 'd1', number: 1, name: 'Lim', amount: 9.99, honras: [], active: true, linkedUserId: 'uid-L' }];");
    const quaseDez = evalIn(sandbox, 'communityTeamLimit()');
    runIn(sandbox, "state.donors = [{ id: 'd1', number: 1, name: 'Lim', amount: 10, honras: [], active: false, linkedUserId: 'uid-L' }];");
    const inativo = evalIn(sandbox, 'communityTeamLimit()');
    runIn(sandbox, "state.donors = [{ id: 'd1', number: 1, name: 'Lim', amount: 6, honras: [], active: true, linkedUserId: 'uid-L' }, { id: 'd2', number: 2, name: 'Lim', amount: 4, honras: [], active: true, linkedUserId: 'uid-L' }, { id: 'd3', number: 3, name: 'Outro', amount: 500, honras: [], active: true, linkedUserId: 'outro' }];");
    const somado = evalIn(sandbox, 'communityTeamLimit()');
    runIn(sandbox, "localStorage.removeItem('kiai_community_last'); state.communityCompose = { kind: 'team', title: 'Terceiro time', desc: '', team: [state.characters[0].id, state.characters[1].id] }; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 40));
    const apoiadorPublica = evalIn(sandbox, 'window.__ins.length');
    runIn(sandbox, "state.donors = []; localStorage.removeItem('kiai_community_last'); state.communityCompose = { kind: 'tierlist', title: 'Minha tier', desc: '' }; state.tierList = { tiers: [{ id:'t1', label:'S', color:'#d65a44', items: [state.characters[0].id, state.characters[1].id, state.characters[2].id] }], unranked: [] }; publishCommunityPost();");
    await new Promise(res => setTimeout(res, 40));
    const tierLivre = evalIn(sandbox, 'window.__ins.length');
    const composeHtml = evalIn(sandbox, "(() => { const mk = (id) => ({ id, userId: 'uid-L', kind: 'team', title: 'T', desc: '', author: 'A', createdAt: '', data: {}, likes: 0, reports: 0 }); state.communityPosts = [mk('a'), mk('b')]; state.donors = []; state.communityCompose = { kind: 'team', title: '', desc: '', team: [] }; const h = renderCommunityCompose(); state.communityCompose = null; return h; })()");
    runIn(sandbox, `
      state.team = window.__bk3[0]; state.communityPosts = window.__bk3[1]; state.communityCompose = window.__bk3[2]; state.discordUser = window.__bk3[3]; state.donors = window.__bk3[4]; state.myProfile = window.__bk3[5]; state.tierList = window.__bk3[6]; state.collection = window.__bk3[7];
      supabaseAvailable = false; window.__sb = undefined; window.__ins = undefined; window.__bk3 = undefined;
      localStorage.removeItem('kiai_community_last');
    `);
    assert.deepStrictEqual(sem, [2, 2], 'sem apoio: limite 2 (tier list não conta nos times)');
    assert.strictEqual(bloqueado, 0, 'com 2 times já publicados, o terceiro é barrado');
    assert.strictEqual(quaseDez, 2, 'R$ 9,99 ainda não libera');
    assert.strictEqual(inativo, 2, 'apoio inativo (removido do mural) não conta');
    assert.strictEqual(somado, 5, 'R$ 6 + R$ 4 do mesmo login somam 10 e liberam 5; apoio de outra pessoa não conta');
    assert.strictEqual(apoiadorPublica, 1, 'apoiador com 2 times publica o terceiro');
    assert.strictEqual(tierLivre, 2, 'tier list continua livre mesmo com o limite de times cheio');
    assert.ok(composeHtml.includes('2/2') && composeHtml.includes('disabled'), 'formulário mostra 2/2 e trava o botão');
  });

  await test('sanitize do time: nível de estrela só de 1 a 10 e só de quem está no time; estrelas douradas até 5 e azuis de 6 a 10', () => {
    const r = evalIn(sandbox, `(() => {
      const d = sanitizeCommunityData('team', { team: ['c_a', 'c_b'], levels: { c_a: 7, c_b: 11, c_z: 4, 'x': 3 } });
      const d2 = sanitizeCommunityData('team', { team: ['c_a'], levels: { c_a: '<b>' } });
      const d3 = sanitizeCommunityData('team', { team: ['c_a'] });
      return { d, d2, d3, ouro: communityStarsHtml(3), azul: communityStarsHtml(8), nada: communityStarsHtml(0), lixo: communityStarsHtml('abc') };
    })()`);
    assert.deepStrictEqual(r.d.levels, { c_a: 7 }, 'nível 11, de quem não está no time ou inválido é descartado');
    assert.deepStrictEqual(r.d2.levels, {}, 'nível que não é número é descartado');
    assert.deepStrictEqual(r.d3.levels, {}, 'post antigo, sem níveis, continua válido');
    assert.ok(r.ouro.includes('gold') && r.ouro.includes('★★★☆☆'));
    assert.ok(r.azul.includes('blue') && r.azul.includes('★★★☆☆'), 'nível 8 = 3 estrelas azuis');
    assert.strictEqual(r.nada, '');
    assert.strictEqual(r.lixo, '');
  });

  await test('formulário do time: escolhe só guerreiros adquiridos da Coleção, até 6, e mostra as estrelas de cada um', () => {
    const r = evalIn(sandbox, `(() => {
      supabaseAvailable = true; window.__sb = { client: {} };
      const bk = [state.collection, state.communityCompose, state.discordUser, state.communityPosts, state.donors];
      const [a, b, c] = state.characters;
      state.discordUser = { id: 'u-form', username: 'Forma' }; state.communityPosts = []; state.donors = [];
      state.collection = {};
      const semColecao = renderCommunityTeamPart({ kind: 'team', title: '', desc: '', team: [], search: '' });
      state.collection = { [a.id]: { owned: true, level: 9 }, [b.id]: { owned: true, level: 2 } };
      state.communityCompose = { kind: 'team', title: '', desc: '', team: [a.id], search: '' };
      const html = renderCommunityCompose();
      const grid = renderCommunityPickerGrid({ team: [a.id], search: '' });
      const busca = renderCommunityPickerGrid({ team: [], search: b.name.toLowerCase() });
      const semResultado = renderCommunityPickerGrid({ team: [], search: 'zzzz-nao-existe' });
      state.collection = bk[0]; state.communityCompose = bk[1]; state.discordUser = bk[2]; state.communityPosts = bk[3]; state.donors = bk[4];
      supabaseAvailable = false; window.__sb = undefined;
      return { semColecao, html, grid, busca, semResultado, aNome: a.name, bNome: b.name, cNome: c.name };
    })()`);
    assert.ok(r.semColecao.includes('data-com-gocoll'), 'sem nada na Coleção, manda marcar guerreiros lá');
    assert.ok(r.html.includes('Seu time (1/6)') && r.html.includes('Meu time (da Coleção)'));
    assert.ok(r.grid.includes(r.aNome.replace(/&/g, '&amp;')) && r.grid.includes('data-com-pick'), 'lista os adquiridos');
    assert.ok(!r.grid.includes('>' + r.cNome + '<'), 'quem não está na Coleção não aparece pra escolher');
    assert.ok(r.grid.includes('blue'), 'nível 9 aparece com estrelas azuis');
    assert.ok(r.grid.includes('kz-com-pick on'), 'quem já está no time fica marcado');
    assert.ok(!r.busca.includes('>' + r.aNome + '<') || r.aNome === r.bNome, 'a busca filtra a lista');
    assert.ok(r.semResultado.includes('Nenhum guerreiro seu'));
  });

  await test('formulário do time: cada guerreiro vai pra casa escolhida (ou a primeira livre), troca de lugar e trava nas 6 casas — mesma lógica do Montador', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.communityCompose, state.collection];
      const ids = state.characters.slice(0, 8).map(c => c.id);
      state.collection = Object.fromEntries(ids.map(id => [id, { owned: true, level: 1 }]));
      const novo = () => { state.communityCompose = { kind: 'team', title: '', desc: '', team: [], search: '', slotSel: null }; return state.communityCompose; };
      let c = novo();
      placeComposePick(ids[0]); placeComposePick(ids[1]);
      const ordem = [...c.team];                                   // primeira casa livre, na ordem de escolha
      c.slotSel = 4; placeComposePick(ids[2]);                     // casa escolhida: casa 5
      const naCasa5 = c.team[4];
      c.slotSel = 0; placeComposePick(ids[2]);                     // quem já estava na casa 5 vai pra casa 1 (troca)
      const trocou = [c.team[0], c.team[4]];
      swapComposeSlots(0, 1);
      const swap = [c.team[0], c.team[1]];
      placeComposePick(ids[1]);                                    // sem casa escolhida, clicar em quem já está tira
      const tirou = c.team[0];
      c = novo();
      ids.forEach(id => placeComposePick(id));                     // 8 tentativas, só cabem 6
      const cheio = c.team.filter(Boolean).length;
      state.communityCompose = bk[0]; state.collection = bk[1];
      return { ordem, naCasa5, trocou, swap, tirou, cheio, ids };
    })()`);
    const ids = r.ids;
    assert.deepStrictEqual(r.ordem.slice(0, 3), [ids[0], ids[1], null], 'sem casa escolhida vai pra primeira livre');
    assert.strictEqual(r.naCasa5, ids[2], 'com a casa 5 escolhida, o guerreiro vai pra casa 5');
    assert.deepStrictEqual(r.trocou, [ids[2], ids[0]], 'escolher a casa 1 e clicar em quem está na casa 5 troca os dois');
    assert.deepStrictEqual(r.swap, [ids[1], ids[2]], 'trocar duas casas inverte os dois');
    assert.strictEqual(r.tirou, null, 'clicar de novo em quem já está tira do time');
    assert.strictEqual(r.cheio, 6, 'no máximo 6 casas');
  });

  await test('time publicado mantém a ordem das casas (posições vazias incluídas) e o card usa o mesmo layout do Montador', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.collection];
      const [a, b, c] = state.characters;
      state.collection = { [a.id]: { owned: true, level: 9 }, [b.id]: { owned: true, level: 2 }, [c.id]: { owned: true, level: 5 } };
      const data = communityShareData('team', { team: [null, c.id, null, a.id, b.id, null] });
      const html = renderCommunityTeamBody({ data });
      state.collection = bk[0];
      return { team: data.team, levels: data.levels, html, ids: [a.id, b.id, c.id], nomes: [a.name, b.name, c.name] };
    })()`);
    assert.deepStrictEqual(r.team, [null, r.ids[2], null, r.ids[0], r.ids[1], null], 'cada guerreiro fica na casa em que foi colocado');
    assert.strictEqual(Object.keys(r.levels).length, 3);
    assert.ok(r.html.includes('kz-slots') && r.html.includes('kz-slot') && r.html.includes('Casa 4') && r.html.includes('Casa 6'), 'mesmo grid de casas do Montador');
    assert.ok(r.html.includes('Persegue') && r.html.includes('Causa'), 'mostra Persegue/Causa de cada guerreiro');
    assert.ok(r.html.includes('kz-comp') && r.html.includes('combos'), 'mostra composição e contagem de combos como no Montador');
    assert.ok(!r.html.includes('kz-slot-remove'), 'no post publicado não tem botão de remover');
    assert.ok(r.html.indexOf('Casa 4') < r.html.indexOf('Casa 1'), 'mesma ordem visual do Montador: coluna 4-5-6 antes da 1-2-3');
  });

  await test('lista da Comunidade: cards limpos (sem botões de ação), com autor clicável e escapando HTML; abrir o post mostra o time completo e as ações', () => {
    const r = evalIn(sandbox, `(() => {
      supabaseAvailable = true; window.__sb = { client: {} };
      const bk = [state.communityPosts, state.communityLoaded, state.communityOpenPost, state.donors, state.discordUser];
      const [a, b] = state.characters;
      state.discordUser = null; state.donors = [];
      state.communityPosts = [
        { id: 'p1', userId: 'u-1', kind: 'team', title: 'Time <b>forte</b>', desc: 'desc do time', author: '<img src=x onerror=alert(1)>', createdAt: new Date().toISOString(), likes: 4, reports: 0,
          data: { team: [a.id, null, b.id, null, null, null], levels: { [a.id]: 9 } } },
        { id: 'p2', userId: 'u-2', kind: 'tierlist', title: 'Tier boa', desc: '', author: 'Beto', createdAt: new Date().toISOString(), likes: 1, reports: 0,
          data: { tiers: [{ label: 'S', color: '#112233', items: [a.id, b.id] }, { label: 'A', color: '#445566', items: [a.id] }] } },
      ];
      state.communityLoaded = true; state.communityOpenPost = null;
      const lista = renderComunidadeTab();
      const card = renderCommunityCard(state.communityPosts[0]);
      const cardTier = renderCommunityCard(state.communityPosts[1]);
      state.communityOpenPost = 'p1';
      const detalhe = renderComunidadeTab();
      state.communityOpenPost = 'nao-existe';
      const inexistente = renderComunidadeTab();
      state.communityPosts = bk[0]; state.communityLoaded = bk[1]; state.communityOpenPost = bk[2]; state.donors = bk[3]; state.discordUser = bk[4];
      supabaseAvailable = false; window.__sb = undefined;
      return { lista, card, cardTier, detalhe, inexistente };
    })()`);
    assert.ok(r.lista.includes('data-com-open="p1"') && r.lista.includes('data-com-open="p2"'), 'cada card abre o seu post');
    assert.ok(!r.lista.includes('data-com-like') && !r.lista.includes('data-com-load') && !r.lista.includes('data-com-report') && !r.lista.includes('kz-slots'), 'a lista não tem botões nem o time completo — só a prévia');
    assert.ok(!r.lista.includes('<img src=x onerror=alert(1)>') && !r.card.includes('<b>forte</b>'), 'título e autor com HTML saem escapados');
    assert.ok(r.card.includes('data-com-profile="u-1"'), 'nome do autor abre o perfil');
    assert.ok(r.cardTier.includes('kz-com-pv-chip'), 'tier list mostra os ranks na prévia');
    assert.ok(r.detalhe.includes('comBackBtn') && r.detalhe.includes('kz-slots') && r.detalhe.includes('data-com-like="p1"') && r.detalhe.includes('data-com-load="p1"'), 'post aberto: voltar, time completo e ações');
    assert.ok(!r.detalhe.includes('comSearch'), 'o post aberto não mostra a barra de busca da lista');
    assert.ok(r.inexistente.includes('comSearch'), 'post que não existe volta pra lista');
  });

  await test('perfil do autor: nome, patente, honras, estatísticas e publicações; dados só quando o perfil é público; tudo escapado', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.communityPosts, state.profiles, state.donors, state.discordUser];
      const mk = (id, kind, title, likes, when) => ({ id, userId: 'u-9', kind, title, desc: '', author: 'Nick Post', createdAt: when, likes, reports: 0, data: {} });
      state.communityPosts = [mk('a', 'team', 'Primeiro', 3, '2026-01-01T00:00:00Z'), mk('b', 'tierlist', 'Segundo <i>x</i>', 2, '2026-02-01T00:00:00Z'), mk('c', 'team', 'Terceiro', 5, '2026-03-01T00:00:00Z'), { id: 'z', userId: 'outro', kind: 'team', title: 'De outro', desc: '', author: 'O', createdAt: '2026-03-02T00:00:00Z', likes: 99, reports: 0, data: {} }];
      state.discordUser = { id: 'u-9', username: 'Eu' };
      state.donors = [{ id: 'd1', number: 1, name: 'Apoiador', amount: 120, honras: ['escriba'], active: true, linkedUserId: 'u-9' }];
      state.profiles = [{ id: 'u-9', public: true, nickname: 'Apelido <b>Público</b>', servidor: 'S12', bio: 'Bio do jogador', instagram: '@insta', twitch: '', youtube: '', showSocials: true, patenteForma: '', patenteCor: '' }];
      const publico = communityProfileModalHtml('u-9');
      state.profiles = [{ id: 'u-9', public: false, nickname: 'Segredo', servidor: 'S99', bio: 'Bio secreta', showSocials: true, instagram: '@oculto' }];
      state.donors = []; state.discordUser = null;
      const privado = communityProfileModalHtml('u-9');
      state.communityPosts = bk[0]; state.profiles = bk[1]; state.donors = bk[2]; state.discordUser = bk[3];
      return { publico, privado };
    })()`);
    assert.ok(r.publico.includes('S12') && r.publico.includes('Bio do jogador') && r.publico.includes('@insta'), 'perfil público mostra servidor, bio e redes');
    assert.ok(!r.publico.includes('<b>Público</b>') && r.publico.includes('&lt;b&gt;'), 'apelido com HTML sai escapado');
    assert.ok(r.publico.includes('Super Saiyajin God') && r.publico.includes('Escriba'), 'mostra a patente e as honras');
    assert.ok(r.publico.includes('<b>2</b> time') && r.publico.includes('<b>1</b> tier list') && r.publico.includes('<b>10</b> curtida'), 'estatísticas só dos posts dessa pessoa');
    assert.ok(r.publico.indexOf('Terceiro') < r.publico.indexOf('Primeiro'), 'publicações da mais nova pra mais antiga');
    assert.ok(!r.publico.includes('De outro'), 'não mistura posts de outras pessoas');
    assert.ok(r.publico.includes('Esse é você') && r.publico.includes('comEditProfileBtn'), 'no próprio perfil aparece "Esse é você" e o atalho de editar');
    assert.ok(!r.privado.includes('S99') && !r.privado.includes('Bio secreta') && !r.privado.includes('@oculto') && !r.privado.includes('Segredo'), 'perfil não público: nada do que a pessoa preencheu aparece');
    assert.ok(r.privado.includes('ainda não tornou o perfil público') && r.privado.includes('Nick Post'), 'usa só o nome dos posts e avisa que o perfil não é público');
    assert.ok(!r.privado.includes('comEditProfileBtn'), 'sem login igual ao autor, sem atalho de editar');
  });

  await test('post de time sem níveis (publicado na versão antiga) avisa só o autor; com níveis mostra estrelas e "Nv"', () => {
    const r = evalIn(sandbox, `(() => {
      const bk = [state.discordUser, state.communityPosts];
      const [a, b] = state.characters;
      const mk = (levels) => ({ id: 'pz', userId: 'u-autor', kind: 'team', title: 'T', desc: '', author: 'A', createdAt: '', likes: 0, reports: 0, data: { team: [a.id, b.id, null, null, null, null], levels } });
      state.discordUser = { id: 'u-autor', username: 'A' };
      const antigoAutor = renderCommunityDetail(mk({}));
      state.discordUser = { id: 'outro', username: 'B' };
      const antigoOutro = renderCommunityDetail(mk({}));
      const novo = renderCommunityDetail(mk({ [a.id]: 7, [b.id]: 3 }));
      state.discordUser = bk[0]; state.communityPosts = bk[1];
      return { antigoAutor, antigoOutro, novo };
    })()`);
    assert.ok(r.antigoAutor.includes('sem os níveis de estrela'), 'o autor é avisado pra republicar');
    assert.ok(!r.antigoOutro.includes('sem os níveis de estrela'), 'quem vê de fora não vê o aviso');
    assert.ok(r.novo.includes('Nv 7') && r.novo.includes('Nv 3') && r.novo.includes('blue') && r.novo.includes('gold'), 'níveis aparecem com estrelas e "Nv"');
    assert.ok(!r.novo.includes('sem os níveis de estrela'));
  });

  await test('curtir: atualiza na hora, grava no banco, desfaz se o banco recusar e exige login', async () => {
    runIn(sandbox, `
      window.__likeCalls = []; window.__failLikes = false;
      window.__sb = { client: { from: (table) => ({
        insert: (row) => { window.__likeCalls.push(['insert', table, row]); return Promise.resolve({ error: window.__failLikes ? { message: 'boom' } : null }); },
        delete: () => ({ eq: () => ({ eq: () => { window.__likeCalls.push(['delete', table]); return Promise.resolve({ error: null }); } }) }),
      }) } };
      supabaseAvailable = true;
      window.__bk2 = [state.communityPosts, state.communityMyLikes, state.discordUser];
      state.communityPosts = [{ id: 'p1', userId: 'u2', kind: 'team', title: 'T', desc: '', author: 'A', createdAt: '', data: { team: [null,null,null,null,null,null] }, likes: 3, reports: 0 }];
      state.communityMyLikes = [];
      state.discordUser = null;
    `);
    runIn(sandbox, "toggleCommunityLike('p1')");
    await new Promise(res => setTimeout(res, 20));
    const semLogin = evalIn(sandbox, 'state.communityPosts[0].likes');
    runIn(sandbox, "state.discordUser = { id: 'uid-9', username: 'X' }; toggleCommunityLike('p1')");
    const otimista = evalIn(sandbox, '[state.communityPosts[0].likes, state.communityMyLikes.length]');
    await new Promise(res => setTimeout(res, 20));
    runIn(sandbox, "toggleCommunityLike('p1')");
    await new Promise(res => setTimeout(res, 20));
    const descurtiu = evalIn(sandbox, '[state.communityPosts[0].likes, state.communityMyLikes.length]');
    runIn(sandbox, "window.__failLikes = true; toggleCommunityLike('p1')");
    await new Promise(res => setTimeout(res, 30));
    const revertido = evalIn(sandbox, '[state.communityPosts[0].likes, state.communityMyLikes.length]');
    const calls = evalIn(sandbox, 'window.__likeCalls.map(c => c[0])');
    runIn(sandbox, `
      state.communityPosts = window.__bk2[0]; state.communityMyLikes = window.__bk2[1]; state.discordUser = window.__bk2[2];
      supabaseAvailable = false; window.__sb = undefined; window.__likeCalls = undefined; window.__bk2 = undefined; window.__failLikes = undefined;
    `);
    assert.strictEqual(semLogin, 3, 'sem login não curte');
    assert.deepStrictEqual(otimista, [4, 1], 'a curtida aparece na hora');
    assert.deepStrictEqual(descurtiu, [3, 0], 'curtir de novo tira a curtida');
    assert.deepStrictEqual(revertido, [3, 0], 'se o banco recusar, volta ao que era');
    assert.deepStrictEqual(calls, ['insert', 'delete', 'insert']);
  });

  await test('Comunidade aparece na navegação e é uma aba válida', () => {
    const r = evalIn(sandbox, "({ nav: NAV_TABS.includes('comunidade') })");
    assert.ok(r.nav);
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
      const backup = JSON.parse(JSON.stringify({team:state.team, tab:state.tab, favs:state.favs, collapsed:state.donorWidgetCollapsed}));
      applyStoredValue('team_state', JSON.stringify({team:['a','b',null,null,null,null]}));
      applyStoredValue('favs', JSON.stringify(['x','y']));
      applyStoredValue('donor_widget_collapsed', '1');
      applyStoredValue('ui_tab', 'guias');
      applyStoredValue('ui_tab', 'aba-que-nao-existe'); // chave inválida não deveria mudar nada
      const out = {team: state.team, favs: state.favs, collapsed: state.donorWidgetCollapsed, tab: state.tab};
      state.team = backup.team; state.tab = backup.tab; state.favs = backup.favs; state.donorWidgetCollapsed = backup.collapsed;
      return out;
    })()`);
    assert.deepStrictEqual(r.team, ['a','b',null,null,null,null]);
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

  console.log('\n[Perfil pessoal e link com apoiador na Aliança Z]');

  await test('renderPerfilTab() não estoura erro logado, deslogado ou sem Supabase configurado', () => {
    const r = evalIn(sandbox, `(() => {
      const semSupabase = renderPerfilTab();
      supabaseAvailable = true;
      window.__sb = { client: {} };
      const deslogado = renderPerfilTab();
      state.discordUser = { id:'u1', username:'Fulano' };
      state.myProfile = { nickname:'Fulaninho', servidor:'S12', bio:'Oi!', instagram:'', twitch:'', youtube:'', avatarCharId:'', showSocials:false, public:false };
      const logado = renderPerfilTab();
      state.discordUser = null; state.myProfile = null; supabaseAvailable = false; window.__sb = undefined;
      return { semSupabase, deslogado, logado };
    })()`);
    assert.ok(!r.semSupabase.includes('perfilNickInput'));
    assert.ok(!r.deslogado.includes('perfilNickInput'), 'sem login não deveria mostrar o formulário');
    assert.ok(r.logado.includes('perfilNickInput') && r.logado.includes('Fulaninho'));
  });

  await test('linkedProfileFor só usa o perfil linkado se a própria pessoa marcou "público"', () => {
    const r = evalIn(sandbox, `(() => {
      state.profiles = [
        { id:'dono-privado', nickname:'Escondido', public:false },
        { id:'dono-publico', nickname:'Visível', servidor:'S5', public:true },
      ];
      const semLink = linkedProfileFor({ linkedUserId:null });
      const linkadoPrivado = linkedProfileFor({ linkedUserId:'dono-privado' });
      const linkadoPublico = linkedProfileFor({ linkedUserId:'dono-publico' });
      const linkadoInexistente = linkedProfileFor({ linkedUserId:'nao-existe' });
      state.profiles = [];
      return {
        semLink, linkadoPrivado, linkadoInexistente,
        linkadoPublicoNick: linkadoPublico && linkadoPublico.nickname,
      };
    })()`);
    assert.strictEqual(r.semLink, null);
    assert.strictEqual(r.linkadoPrivado, null, 'perfil marcado como não-público nunca deveria aparecer, mesmo linkado');
    assert.strictEqual(r.linkadoInexistente, null);
    assert.strictEqual(r.linkadoPublicoNick, 'Visível');
  });

  await test('renderDonorCard e o popup usam o nick/servidor do perfil linkado (público) no lugar do que o admin digitou', () => {
    const r = evalIn(sandbox, `(() => {
      state.profiles = [{ id:'dono-publico', nickname:'Apelido Público', servidor:'S7', bio:'Minha bio', avatarCharId:'', showSocials:false, public:true }];
      const donor = { id:'d1', number:1, name:'Nome Digitado Pelo Admin', amount:30, quote:'Frase do admin', honras:[], active:true, linkedUserId:'dono-publico' };
      const card = renderDonorCard(donor, 0);
      const modal = donorProfileModalHtml(donor);
      state.profiles = [];
      return { card, modal };
    })()`);
    assert.ok(r.card.includes('Apelido Público') && !r.card.includes('Nome Digitado Pelo Admin'));
    assert.ok(r.card.includes('S7'));
    assert.ok(r.modal.includes('Apelido Público') && r.modal.includes('Minha bio'), 'bio do perfil deveria substituir a frase digitada pelo admin');
  });

  await test('logado (Supabase simulado), saveMyProfile() manda um upsert pra tabela profiles com o próprio id', async () => {
    runIn(sandbox, `
      window.__upsertCalls = [];
      window.__sb = { client: { from: (table) => ({
        upsert: (row) => { window.__upsertCalls.push({table, row}); return Promise.resolve({error:null}); },
        select: () => ({ eq: () => Promise.resolve({error:null, data:[]}) }),
      }) } };
      supabaseAvailable = true;
      state.discordUser = { id:'user-uid-789', username:'Fulano' };
      state.myProfile = { nickname:'Nick', servidor:'S1', bio:'Bio', instagram:'insta', twitch:'', youtube:'', avatarCharId:'char1', showSocials:true, public:true };
    `);
    runIn(sandbox, "saveMyProfile()");
    await new Promise(res => setTimeout(res, 20));
    const calls = evalIn(sandbox, 'window.__upsertCalls');
    runIn(sandbox, "supabaseAvailable = false; state.discordUser = null; state.myProfile = null; window.__sb = undefined; window.__upsertCalls = undefined;");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].table, 'profiles');
    assert.deepStrictEqual(calls[0].row, {
      id:'user-uid-789', nickname:'Nick', servidor:'S1', bio:'Bio', instagram:'insta', twitch:null, youtube:null,
      avatar_char_id:'char1', show_socials:true, is_public:true, patente_forma:null, patente_cor:null,
    });
  });

  await test('saveMyProfile(): se o banco ainda não tem as colunas de forma/cor da patente, salva o resto do perfil mesmo assim', async () => {
    runIn(sandbox, `
      window.__upsertCalls = [];
      window.__sb = { client: { from: (table) => ({
        upsert: (row) => {
          window.__upsertCalls.push({table, row});
          return Promise.resolve('patente_forma' in row ? {error:{message:'column "patente_forma" does not exist'}} : {error:null});
        },
        select: () => ({ eq: () => Promise.resolve({error:null, data:[]}) }),
      }) } };
      supabaseAvailable = true;
      state.discordUser = { id:'user-uid-789', username:'Fulano' };
      state.myProfile = { nickname:'Nick', servidor:'S1', bio:'', instagram:'', twitch:'', youtube:'', avatarCharId:'', patenteForma:'Beast', patenteCor:'', showSocials:false, public:true };
    `);
    runIn(sandbox, "saveMyProfile()");
    await new Promise(res => setTimeout(res, 30));
    const calls = evalIn(sandbox, 'window.__upsertCalls');
    runIn(sandbox, "supabaseAvailable = false; state.discordUser = null; state.myProfile = null; window.__sb = undefined; window.__upsertCalls = undefined;");
    assert.strictEqual(calls.length, 2, 'tenta com as colunas novas e, se o banco recusar, repete sem elas');
    assert.ok('patente_forma' in calls[0].row && !('patente_forma' in calls[1].row));
    assert.strictEqual(calls[1].row.nickname, 'Nick');
  });

  await test('logado (Supabase simulado), refreshMyProfile() aplica a linha existente ou volta um rascunho em branco', async () => {
    runIn(sandbox, `
      window.__sb = { client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ error:null, data: {
        nickname:'Servidor', servidor:'S9', bio:'', instagram:'', twitch:'', youtube:'', avatar_char_id:null, show_socials:false, is_public:false,
      } }) }) }) }) } };
      supabaseAvailable = true;
      state.discordUser = { id:'user-uid-000', username:'Ciclana' };
    `);
    runIn(sandbox, "refreshMyProfile()");
    await new Promise(res => setTimeout(res, 20));
    const comPerfil = evalIn(sandbox, 'state.myProfile');
    runIn(sandbox, `
      window.__sb = { client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ error:null, data: null }) }) }) }) } };
    `);
    runIn(sandbox, "refreshMyProfile()");
    await new Promise(res => setTimeout(res, 20));
    const semPerfil = evalIn(sandbox, 'state.myProfile');
    runIn(sandbox, "supabaseAvailable = false; state.discordUser = null; state.myProfile = null; window.__sb = undefined;");
    assert.strictEqual(comPerfil.nickname, 'Servidor');
    assert.strictEqual(comPerfil.servidor, 'S9');
    assert.deepStrictEqual(semPerfil, { nickname:'', servidor:'', bio:'', instagram:'', twitch:'', youtube:'', avatarCharId:'', patenteForma:'', patenteCor:'', showSocials:false, public:false }, 'sem linha no servidor deveria voltar um rascunho em branco, não null/erro');
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

  await test('"Sugestão por raridade" põe Ultimate/Lendário/Limitado no 1º rank, SSR no 2º, SR no 3º, R no 4º', () => {
    const r = evalIn(sandbox, `(() => {
      const backup = JSON.stringify(state.tierList);
      suggestTierListByRarity();
      const byTier = state.tierList.tiers.map(t => t.items.map(id => getChar(id).rarity));
      const unranked = state.tierList.unranked.length;
      state.tierList = JSON.parse(backup);
      return {byTier, unranked};
    })()`);
    assert.strictEqual(r.unranked, 0);
    assert.ok(r.byTier[0].length && r.byTier[0].every(x => x.includes('Limitado') || x.includes('Lendário') || x.includes('Ultimate')));
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
