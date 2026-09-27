// Converte frames com fundo preto (aditivo/glow) em PNGs com alpha real:
// alpha = brilho do pixel (preto -> transparente, chama -> opaco), preservando a cor.
// Uso: node make-fire-alpha.js <pasta_de_entrada_com_frames_png> <pasta_de_saida>
const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

async function main() {
  const [, , inDir, outDir] = process.argv;
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(inDir).filter(f => f.endsWith('.png')).sort();
  for (const f of files) {
    const img = await Jimp.read(path.join(inDir, f));
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
      this.bitmap.data[idx + 3] = Math.max(r, g, b);
    });
    await img.write(path.join(outDir, f));
  }
  console.log(`Processed ${files.length} frames -> ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
