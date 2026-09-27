// Flood-fills connected near-black background (starting from the 4 corners) to transparent,
// without touching black pixels inside the artwork (hair/shadows) since those aren't
// connected to the corners through other black pixels.
const { Jimp } = require('jimp');

async function main() {
  const [, , input, output, thresholdArg] = process.argv;
  const threshold = thresholdArg ? parseInt(thresholdArg, 10) : 12;
  const img = await Jimp.read(input);
  const { width: w, height: h, data } = img.bitmap;

  const isNearBlack = (idx) => data[idx] <= threshold && data[idx + 1] <= threshold && data[idx + 2] <= threshold;

  const visited = new Uint8Array(w * h);
  const stack = [];
  const starts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  for (const [x, y] of starts) {
    const p = y * w + x;
    if (!visited[p]) { visited[p] = 1; stack.push(p); }
  }

  let removed = 0;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    const idx = p * 4;
    if (!isNearBlack(idx)) continue;
    data[idx + 3] = 0;
    removed++;
    if (x > 0) { const np = p - 1; if (!visited[np]) { visited[np] = 1; stack.push(np); } }
    if (x < w - 1) { const np = p + 1; if (!visited[np]) { visited[np] = 1; stack.push(np); } }
    if (y > 0) { const np = p - w; if (!visited[np]) { visited[np] = 1; stack.push(np); } }
    if (y < h - 1) { const np = p + w; if (!visited[np]) { visited[np] = 1; stack.push(np); } }
  }

  await img.write(output);
  console.log(`${input} -> ${output}: removed ${removed} bg pixels (threshold ${threshold})`);
}

main().catch(e => { console.error(e); process.exit(1); });
