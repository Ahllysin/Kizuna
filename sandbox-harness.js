// Harness compartilhado pra rodar o <script> principal de dragon-ball-combos.html
// dentro de um vm.Context isolado do Node, sem precisar de jsdom ou de um navegador
// de verdade. Usado tanto por test-logic.js (testes automatizados) quanto por
// validate-data.js (checagem de dados) — assim os dois sempre leem a MESMA lógica
// (slug(), ABILITY_PROGRESSION, state.characters) que o site de verdade usa, em vez
// de reimplementar essas regras separadamente e correr o risco de desalinhar.
//
// Veja o comentário no topo de test-logic.js pra entender o truque do "stub
// silencioso" no lugar de document/window.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'dragon-ball-combos.html');

function extractMainScript(html){
  const marker = '<script>';
  const start = html.indexOf(marker) + marker.length;
  const end = html.lastIndexOf('</script>');
  if(start < marker.length || end < 0 || end <= start){
    throw new Error('Não consegui encontrar o bloco <script> principal no HTML.');
  }
  return html.slice(start, end);
}

function makeStub(){
  const target = function(){};
  const handler = {
    get(_t, prop){
      if(prop === Symbol.toPrimitive) return () => '';
      if(prop === Symbol.iterator) return undefined;
      if(prop === 'then') return undefined;
      return makeStub();
    },
    set(){ return true; },
    apply(){ return makeStub(); },
    construct(){ return makeStub(); },
    has(){ return true; },
  };
  return new Proxy(target, handler);
}

function buildSandbox(preexistingStorage){
  const backing = {};
  const localStorage = {
    getItem: k => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: k => { delete backing[k]; },
    clear: () => { Object.keys(backing).forEach(k => delete backing[k]); },
  };
  const sandbox = {
    console,
    document: makeStub(),
    localStorage,
    Image: function(){ return { set src(_v){}, onload:null, onerror:null }; },
    requestAnimationFrame: fn => setTimeout(fn, 0),
    setTimeout, clearTimeout,
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){},
  };
  if(preexistingStorage) sandbox.storage = preexistingStorage;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

async function loadApp(preexistingStorage){
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = extractMainScript(html);
  const sandbox = buildSandbox(preexistingStorage);
  vm.runInContext(script, sandbox, { filename: 'dragon-ball-combos.html' });
  // loadState() dispara no fim do arquivo e é assíncrono — dá um respiro pro event
  // loop antes de qualquer leitura de estado.
  await new Promise(r => setTimeout(r, 50));
  return sandbox;
}

function evalIn(sandbox, expr){
  const json = vm.runInContext(`JSON.stringify((function(){ return (${expr}); })())`, sandbox);
  return json === undefined ? undefined : JSON.parse(json);
}
function runIn(sandbox, statement){
  vm.runInContext(statement, sandbox);
}

module.exports = { loadApp, evalIn, runIn, HTML_PATH };
