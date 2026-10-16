// Baixa as fontes do Google Fonts pra dentro do site (pasta fonts/) e gera fonts/fonts.css.
// Assim os visitantes não mandam o IP pro Google e a CSP não precisa liberar fonts.googleapis.com / fonts.gstatic.com.
//
// Rodar de novo (precisa de internet) quando mudar a lista de fontes OU quando o site passar a usar um kanji novo:
//     node fetch-fonts.js
//
// - Nunito, Kaushan Script, JetBrains Mono, Barlow e Barlow Condensed: só a faixa "latin" (cobre o português inteiro).
// - Shippori Mincho (usada só nos kanji dos ícones): só as faixas que têm os kanji que o index.html usa.
// - Dela Gothic One (onomatopeias em katakana do visual novo, ex.: ワクワク): só as faixas com os katakana que o index.html usa.
// As famílias novas vão no FIM da URL para os arquivos das antigas manterem o mesmo nome.
// As fontes são licenciadas sob a SIL Open Font License (uso e redistribuição livres) — ver fonts/LICENSES.txt.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fonts');
// Duas consultas separadas: o Google devolve as famílias em ordem alfabética, então juntar tudo numa só
// renumeraria os arquivos das fontes antigas. Fontes novas entram sempre na última consulta.
const CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Kaushan+Script&family=Nunito:wght@400;500;700;900&family=JetBrains+Mono:wght@500;700&family=Shippori+Mincho:wght@800&display=swap',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800;1,900&family=Barlow:wght@400;500;600;700;800&family=Dela+Gothic+One&display=swap',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function inRange(cp, ur) {
  return ur.split(',').some(r => {
    r = r.trim().replace(/^U\+/i, '');
    if (r.includes('?')) { const a = parseInt(r.replace(/\?/g, '0'), 16), b = parseInt(r.replace(/\?/g, 'F'), 16); return cp >= a && cp <= b; }
    if (r.includes('-')) { const [a, b] = r.split('-'); return cp >= parseInt(a, 16) && cp <= parseInt(b, 16); }
    return cp === parseInt(r, 16);
  });
}

(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const used = [...new Set([...html])];
  const cjk = used.filter(ch => /[　-ヿ㐀-鿿＀-￯]/.test(ch) && !/[゠-ヿ]/.test(ch)).map(c => c.codePointAt(0));   // sem katakana
  const kana = used.filter(ch => /[゠-ヿ]/.test(ch)).map(c => c.codePointAt(0));
  let css = '';
  for (const u of CSS_URLS) css += (await (await fetch(u, { headers: { 'User-Agent': UA } })).text()) + '\n';
  const blocks = [...css.matchAll(/(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)].map(m => ({ label: m[1] || '', body: m[2] }));

  const keep = blocks.filter(b => {
    const fam = (b.body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const ur = (b.body.match(/unicode-range:\s*([^;]+)/) || [])[1] || '';
    if (fam === 'Shippori Mincho') return b.label !== 'latin' && b.label !== 'latin-ext' && cjk.some(cp => inRange(cp, ur));
    if (fam === 'Dela Gothic One') return b.label !== 'latin' && b.label !== 'latin-ext' && kana.some(cp => inRange(cp, ur));
    return b.label === 'latin';
  });

  fs.mkdirSync(OUT, { recursive: true });
  const files = new Map();                       // url -> arquivo local (os pesos do Nunito compartilham o mesmo arquivo variável)
  let total = 0, out = '/* Gerado por fetch-fonts.js — não edite à mão. */\n';
  for (const b of keep) {
    const url = (b.body.match(/url\(([^)]+)\)/) || [])[1];
    const fam = (b.body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const weight = (b.body.match(/font-weight:\s*([^;]+)/) || [])[1];
    const style = (b.body.match(/font-style:\s*([^;]+)/) || [])[1] || 'normal';
    const ur = (b.body.match(/unicode-range:\s*([^;]+)/) || [])[1];
    if (!files.has(url)) {
      const idx = [...files.keys()].length + 1;
      const name = fam.toLowerCase().replace(/\s+/g, '-') + '-' + idx + '.woff2';
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.writeFileSync(path.join(OUT, name), buf);
      total += buf.length;
      files.set(url, name);
    }
    out += `@font-face{font-family:'${fam}';font-style:${style};font-weight:${weight};font-display:swap;src:url(${files.get(url)}) format('woff2');unicode-range:${ur};}\n`;
  }
  fs.writeFileSync(path.join(OUT, 'fonts.css'), out, 'utf8');
  console.log(`${keep.length} faixas, ${files.size} arquivos, ${(total / 1024).toFixed(0)} KB em fonts/ (${cjk.length} kanji usados no site)`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
