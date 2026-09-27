const { removeBackground } = require('@imgly/background-removal-node');
const { Jimp } = require('jimp');
const fs = require('fs');

async function main() {
  const [,, input, output, model] = process.argv;
  const blob = await removeBackground(input, { model: model || 'large' });
  const buffer = Buffer.from(await blob.arrayBuffer());
  const tmp = output + '.tmp.png';
  fs.writeFileSync(tmp, buffer);

  // Hard alpha threshold: kills the soft "ghosting" halo the matting model
  // leaves around light-colored parts (gloves/boots) instead of a crisp edge.
  const img = await Jimp.read(tmp);
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    this.bitmap.data[idx + 3] = a > 120 ? 255 : 0;
  });
  await img.write(output);
  fs.unlinkSync(tmp);
  console.log(`Background removed (model=${model || 'large'}): ${input} -> ${output}`);
}

main().catch(e => { console.error(e); process.exit(1); });
