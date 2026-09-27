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

  console.log('\n[5/5] Retratos existem em disco (portraits/<slug>.png)');
  let portraitsOk = 0;
  characters.forEach(c => {
    const slugName = evalIn(sandbox, `slug(${JSON.stringify(c.name)})`);
    const relPath = `portraits/${slugName}.png`;
    if(fileExists(relPath)) portraitsOk++;
    else warn(`"${c.name}": retrato não encontrado (${relPath}) — cai no fallback de iniciais, mas também quebra a exportação de imagem da tier list`);
  });
  console.log(`  ${portraitsOk}/${characters.length} retratos encontrados em disco.`);

  console.log(`\n${errors} erro(s), ${warnings} aviso(s).`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
