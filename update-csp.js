// Gera a Política de Segurança de Conteúdo (CSP) do site e grava no <meta> do index.html.
//
// Por que existe: o site é um arquivo só, com scripts inline. Em vez de liberar "unsafe-inline" (que anularia a proteção
// contra XSS), a política libera só os scripts cujo hash (SHA-256) bate com o do código que está no arquivo. Qualquer
// <script> injetado por alguém não tem esse hash e o navegador se recusa a rodar.
// Consequência: TODA VEZ que o código dentro de um <script> muda, o hash muda — rode este arquivo antes de publicar:
//
//     node update-csp.js          (atualiza o index.html)
//     node update-csp.js --check  (só confere; sai com erro se estiver desatualizado — o test-logic.js também confere)
//
// O hash é calculado com as duas quebras de linha possíveis (LF e CRLF), porque o GitHub serve LF e o Windows pode
// ter CRLF no arquivo local.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'index.html');
const SUPABASE = 'https://luyuprliobxtxnppdohw.supabase.co';
const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;

// Conteúdo de cada <script> inline (sem src) do HTML.
function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}
function hashSources(js) {
  const lf = js.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  return [...new Set([lf, crlf])].map(s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'");
}
function buildPolicy(html) {
  const hashes = inlineScripts(html).flatMap(hashSources);
  return [
    "default-src 'self'",
    // scripts: só os do próprio site — os inline por hash e o resto (vendor/supabase.js) por 'self'. Nenhum CDN.
    `script-src 'self' ${hashes.join(' ')}`,
    // estilos inline são usados em todo o site (style="..."); as fontes ficam em fonts/
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    // imagens: do site, data:, blob: (exportação) e avatar do Discord
    "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net",
    // chamadas de rede: só o próprio site e o Supabase — um script malicioso não consegue mandar dados pra outro lugar
    `connect-src 'self' ${SUPABASE}`,
    // sem frame-src: nenhum quadro de terceiros (o Mercado Pago abre como página própria)
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
function currentPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  return m ? m[1] : null;
}
function apply(html) {
  if (!META_RE.test(html)) throw new Error('não achei o <meta http-equiv="Content-Security-Policy"> no index.html');
  return html.replace(META_RE, () => `<meta http-equiv="Content-Security-Policy" content="${buildPolicy(html)}">`);
}

module.exports = { inlineScripts, hashSources, buildPolicy, currentPolicy, apply };

if (require.main === module) {
  const html = fs.readFileSync(FILE, 'utf8');
  const want = buildPolicy(html);
  const have = currentPolicy(html);
  if (process.argv.includes('--check')) {
    if (have === want) { console.log('CSP em dia.'); process.exit(0); }
    console.error('CSP desatualizada — rode: node update-csp.js');
    process.exit(1);
  }
  if (have === want) { console.log('CSP já estava em dia.'); }
  else { fs.writeFileSync(FILE, apply(html), 'utf8'); console.log('CSP atualizada.'); }
}
