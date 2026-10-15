// Validação formal dos dados do site — junta as checagens que antes eram feitas na
// mão (script descartável) num script permanente e repetível. Roda contra os dados
// DE VERDADE que o site usa (via sandbox-harness.js), não uma cópia paralela da
// lógica, então não tem como desalinhar com o que está realmente no HTML.
//
// Rodar: node validate-data.js

const fs = require('fs');
const path = require('path');
const { loadApp, evalIn } = require('./sandbox-harness');

const ROOT = __dirname;
const RAW_JSON_PATH = path.join(ROOT, 'personagens-habilidades-completas.json');

let errors = 0, warnings = 0;
function fail(msg){ errors++; console.log(`  [ERRO] ${msg}`); }
function warn(msg){ warnings++; console.log(`  [aviso] ${msg}`); }

function fileExists(relPath){
  try{ return fs.existsSync(path.join(ROOT, relPath)); }catch(e){ return false; }
}

function nonEmpty(str){ return typeof str === 'string' && str.trim().length > 0; }

async function main(){
  console.log('Carregando site num sandbox isolado...');
  const sandbox = await loadApp();

  const characters = evalIn(sandbox, 'state.characters.map(c => ({id:c.id, name:c.name}))');
  const abilityProgressionNames = evalIn(sandbox, 'Object.keys(ABILITY_PROGRESSION)');

  console.log(`\nRoster do site: ${characters.length} personagens.`);

  console.log('\n[1/5] Duplicados no roster do site');
  const nameCounts = {};
  characters.forEach(c => { nameCounts[c.name] = (nameCounts[c.name]||0) + 1; });
  const dupes = Object.entries(nameCounts).filter(([, n]) => n > 1);
  if(dupes.length){
    dupes.forEach(([name, n]) => fail(`"${name}" aparece ${n} vezes no roster`));
  } else {
    console.log('  ok - nenhum nome duplicado');
  }

  console.log('\nLR (estrelas 11-15)');
  {
    const lrNames = evalIn(sandbox, "Object.keys(ABILITY_PROGRESSION).filter(n => ABILITY_PROGRESSION[n].lr)");
    lrNames.forEach(n => {
      const lr = evalIn(sandbox, 'ABILITY_PROGRESSION[' + JSON.stringify(n) + '].lr');
      if(!Array.isArray(lr) || lr.length !== 5) fail(`"${n}": LR precisa ter 5 itens (★11 a ★15)`);
      else lr.forEach((x, i) => {
        if(x.estrelas !== 11 + i) fail(`"${n}": item de LR #${i + 1} tem estrelas=${x.estrelas}, esperado ${11 + i}`);
        if(!x.desc && !x.semTexto) fail(`"${n}": item de LR ★${11 + i} sem descrição`);
        if(!x.icone || !fileExists(x.icone)) fail(`"${n}": item de LR ★${11 + i} sem ícone em disco (${x.icone})`);
      });
    });
    console.log(`  ${lrNames.length} guerreiros com habilidades de LR conferidos.`);
  }

  console.log('\nSinergias entre habilidades (SYNERGY_RULES)');
  {
    const r = evalIn(sandbox, `(() => {
      const nomes = new Set(state.characters.map(c => c.name)), erros = [];
      let regras = 0;
      Object.entries(SYNERGY_RULES).forEach(([dono, lista]) => {
        if(!nomes.has(dono)) erros.push('guerreiro não existe: ' + dono);
        lista.forEach(x => {
          regras++;
          if(!x.txt) erros.push(dono + ': regra sem texto');
          if(x.grupo && !SYNERGY_GROUPS[x.grupo]) erros.push(dono + ': grupo desconhecido ' + x.grupo);
          if(x.grupo && SYNERGY_GROUPS[x.grupo] && !state.characters.some(c => c.name !== dono && SYNERGY_GROUPS[x.grupo].test(c))) erros.push(dono + ': ninguém no grupo ' + x.grupo);
          (x.com || []).forEach(n => { if(!nomes.has(n)) erros.push(dono + ': parceiro não existe ' + n); });
          if(x.prefixo && !state.characters.some(c => c.name !== dono && synergyPrefixMatch(c.name, x.prefixo))) erros.push(dono + ': ninguém com o nome ' + x.prefixo);
          if(!x.grupo && !x.prefixo && !(x.com || []).length) erros.push(dono + ': regra sem alvo');
        });
      });
      return { erros, regras, donos: Object.keys(SYNERGY_RULES).length };
    })()`);
    r.erros.forEach(e => fail('sinergia: ' + e));
    console.log(`  ${r.regras} sinergias de ${r.donos} guerreiros conferidas.`);
  }

  console.log('\nGuias do jogo (guias/guias.json)');
  {
    let j = null;
    try{ j = JSON.parse(fs.readFileSync(path.join(ROOT, 'guias', 'guias.json'), 'utf8')); }catch(e){ fail('guias/guias.json não abre: ' + e.message); }
    if(j){
      if(!Array.isArray(j.guias) || j.guias.length !== 12) fail('esperava 12 guias, achei ' + (j.guias && j.guias.length));
      const ids = new Set();
      (j.guias || []).forEach(g => {
        const tag = `guia ${g.n} "${g.titulo}"`;
        if(!/^\d{2}b?$/.test(g.n)) fail(`${tag}: número inválido`);
        if(!/^[a-z0-9-]{1,40}$/.test(g.id || '')) fail(`${tag}: id inválido`); else if(ids.has(g.id)) fail(`${tag}: id repetido`); else ids.add(g.id);
        if(!nonEmpty(g.titulo) || !nonEmpty(g.resumo)) fail(`${tag}: sem título ou resumo`);
        if(!(g.nivel > 0)) fail(`${tag}: nível de desbloqueio inválido`);
        if(!Array.isArray(g.secoes) || !g.secoes.length) fail(`${tag}: sem seções`);
        if(!fileExists(`guias/img/${g.n}.webp`)) fail(`${tag}: capa guias/img/${g.n}.webp não existe`);
        (g.verTambem || []).forEach(v => { if(!(j.guias || []).some(o => o.id === v)) fail(`${tag}: "veja também" aponta para um guia que não existe (${v})`); });
        const confere = (sec, b) => {
          if(b.t === 'table' && (!Array.isArray(b.head) || !b.head.length || (b.rows || []).some(r => r.length !== b.head.length))) fail(`${tag}, seção ${sec.titulo}: tabela com colunas desalinhadas`);
          if(b.t === 'table' && b.head.some((c, i) => !nonEmpty(c) && (b.rows || []).every(r => !nonEmpty(r[i])))) fail(`${tag}, seção ${sec.titulo}: tabela com coluna vazia`);
          if((b.t === 'ul' || b.t === 'ol') && !(b.items || []).length) fail(`${tag}, seção ${sec.titulo}: lista vazia`);
          if(b.t === 'icons') (b.items || []).forEach(i => { if(!fileExists(i.src)) fail(`${tag}, seção ${sec.titulo}: ícone ${i.src} não existe`); });
          if(b.t === 'details'){
            if(!nonEmpty(b.titulo)) fail(`${tag}, seção ${sec.titulo}: bloco que abre sem título`);
            if(b.icone && !fileExists(b.icone)) fail(`${tag}, seção ${sec.titulo}: ícone ${b.icone} não existe`);
            (b.blocos || []).forEach(x => confere(sec, x));
          }
          if(b.t === 'img' && !(/^guias\/img\/[a-z0-9\/-]+\.webp$/.test(b.src || '') && fileExists(b.src))) fail(`${tag}, seção ${sec.titulo}: imagem ${b.src} inválida ou ausente`);
          if(!['p', 'note', 'h', 'ul', 'ol', 'table', 'callout', 'icons', 'details', 'img'].includes(b.t)) fail(`${tag}, seção ${sec.titulo}: tipo de bloco desconhecido (${b.t})`);
        };
        (g.secoes || []).forEach(sec => (sec.blocos || []).forEach(b => confere(sec, b)));
      });
      console.log(`  ${(j.guias || []).length} guias conferidos.`);
    }
  }

  console.log('\n[2/5] JSON de habilidades completas (personagens-habilidades-completas.json)');
  if(!fs.existsSync(RAW_JSON_PATH)){
    fail(`arquivo não encontrado: ${RAW_JSON_PATH}`);
  } else {
    let raw;
    try{ raw = JSON.parse(fs.readFileSync(RAW_JSON_PATH, 'utf8')); }
    catch(e){ fail(`JSON inválido: ${e.message}`); raw = null; }

    if(raw){
      // "personagens" é indexado por posição (0,1,2,...), não por nome — o nome de
      // cada personagem fica no campo .nome de cada entrada.
      const personagensByIndex = raw.personagens || {};
      const rawNames = Object.values(personagensByIndex).map(p => p.nome);
      const personagens = {};
      Object.values(personagensByIndex).forEach(p => { personagens[p.nome] = p; });
      console.log(`  ${rawNames.length} personagens no JSON.`);

      // Toda personagem do roster do site precisa existir no JSON e no
      // ABILITY_PROGRESSION embutido no HTML — os três precisam bater.
      characters.forEach(c => {
        if(!rawNames.includes(c.name)) fail(`"${c.name}" está no roster do site mas não no JSON de habilidades`);
        if(!abilityProgressionNames.includes(c.name)) fail(`"${c.name}" está no roster do site mas não no ABILITY_PROGRESSION embutido no HTML (dado desatualizado?)`);
      });
      rawNames.forEach(name => {
        if(!characters.some(c => c.name === name)) warn(`"${name}" está no JSON de habilidades mas não no roster do site (personagem removida?)`);
      });

      console.log('\n[3/5] Estrutura de cada personagem (habilidade/suprema/combinado/passiva)');
      let structOk = 0;
      rawNames.forEach(name => {
        const p = personagens[name];
        const problems = [];
        if(!p.habilidade || !p.habilidade.base) problems.push('sem habilidade.base');
        else if(!nonEmpty(p.habilidade.base.nome) || !nonEmpty(p.habilidade.base.desc)) problems.push('habilidade.base sem nome/desc');
        if(!p.suprema || !p.suprema.base) problems.push('sem suprema.base');
        else if(!nonEmpty(p.suprema.base.nome) || !nonEmpty(p.suprema.base.desc)) problems.push('suprema.base sem nome/desc');
        if(!p.combinado) problems.push('sem combinado (Ataque de Perseguição)');
        else if(!nonEmpty(p.combinado.nome) || !nonEmpty(p.combinado.desc)) problems.push('combinado sem nome/desc');
        if(!Array.isArray(p.passivasHabilidade) || !p.passivasHabilidade.length) problems.push('sem passivasHabilidade');
        else if(!nonEmpty(p.passivasHabilidade[0].nome) || !nonEmpty(p.passivasHabilidade[0].desc)) problems.push('passivasHabilidade[0] sem nome/desc');

        if(problems.length) fail(`"${name}": ${problems.join('; ')}`);
        else structOk++;
      });
      console.log(`  ${structOk}/${rawNames.length} personagens com a estrutura básica completa.`);

      console.log('\n[4/5] Ícones referenciados existem em disco (ability-icons/)');
      let iconsChecked = 0, iconsMissing = 0;
      const collectIcons = (p) => {
        const icons = [];
        if(p.habilidade){ if(p.habilidade.base) icons.push(p.habilidade.base.icone); if(p.habilidade.max) icons.push(p.habilidade.max.icone); }
        if(p.suprema){ ['base','max','smax'].forEach(k => { if(p.suprema[k]) icons.push(p.suprema[k].icone); }); }
        if(p.combinado) icons.push(p.combinado.icone);
        (p.passivasHabilidade||[]).forEach(x => icons.push(x.icone));
        (p.passivasSupremo||[]).forEach(x => icons.push(x.icone));
        if(p.passivaUnica){ ['base','max'].forEach(k => { if(p.passivaUnica[k]) icons.push(p.passivaUnica[k].icone); }); }
        if(p.passivaQuatroEstrelas) icons.push(p.passivaQuatroEstrelas.icone);
        return icons.filter(Boolean);
      };
      rawNames.forEach(name => {
        collectIcons(personagens[name]).forEach(iconPath => {
          iconsChecked++;
          if(!fileExists(iconPath)){
            iconsMissing++;
            fail(`"${name}": ícone referenciado não existe em disco: ${iconPath}`);
          }
        });
      });
      console.log(`  ${iconsChecked - iconsMissing}/${iconsChecked} ícones encontrados em disco.`);
    }
  }

  console.log('\n[5/5] Retratos existem em disco (portraits/<slug>.webp e portraits/mini/<slug>.webp)');
  let portraitsOk = 0;
  characters.forEach(c => {
    const slugName = evalIn(sandbox, `slug(${JSON.stringify(c.name)})`);
    const grande = `portraits/${slugName}.webp`, mini = `portraits/mini/${slugName}.webp`;
    if(fileExists(grande) && fileExists(mini)) portraitsOk++;
    else warn(`"${c.name}": retrato não encontrado (${fileExists(grande) ? mini : grande}) — cai no fallback de iniciais, mas também quebra a exportação de imagem da tier list`);
  });
  const pngs = fs.readdirSync(path.join(ROOT, 'portraits')).filter(f => f.endsWith('.png'));
  if(pngs.length) warn(`${pngs.length} retrato(s) ainda em PNG (pesado): rode "python otimizar-retratos.py" na pasta Kizuna`);
  console.log(`  ${portraitsOk}/${characters.length} retratos encontrados em disco.`);

  console.log(`\n${errors} erro(s), ${warnings} aviso(s).`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
