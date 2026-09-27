const { Jimp } = require('jimp');

async function main() {
  const [,, input, output, x, y, w, h] = process.argv;
  const img = await Jimp.read(input);
  img.crop({ x: parseInt(x), y: parseInt(y), w: parseInt(w), h: parseInt(h) });
  await img.write(output);
  console.log(`Cropped ${input} -> ${output} [${x},${y},${w},${h}] (result ${img.bitmap.width}x${img.bitmap.height})`);
}

main().catch(e => { console.error(e); process.exit(1); });
