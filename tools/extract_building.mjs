// extract_building — PLATEAU の建物 1 棟を glb（ENU・テクスチャ埋め込み）に切り出す／地点のまわりの建物を一覧する。
//   node tools/extract_building.mjs search <lat> <lon> [半径m] [tileset名|URL]
//   node tools/extract_building.mjs <gml_id> <lat> <lon> <出力.glb> [tileset名|URL] [--no-texture]
//   tileset 名は tools/plateau_b3dm.mjs の TILESETS のキー（既定 kyoto-nakagyo-lod2：テクスチャあり）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDraco, getJson, getBin, leaves, searchBuildings, extractBuilding, encodeGlb, TILESETS } from './plateau_b3dm.mjs';

/* タイルの画像は区画ぜんぶの壁面を 1 枚に詰めた大きなもの（実測 8192px・3.6MB）。この建物が使う範囲だけに切り詰めて UV を直す。
   ★ 切るのは Python の Pillow（python -I）。UV が 0〜1 をはみ出す（繰り返し）画像はそのまま。1 辺は 2048px まで */
function cropImages(b) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'popup-tex-'));
  const jobs = [];
  for (const [key, im] of b.images) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    const gs = b.groups.filter((g) => g.image === key);
    for (const g of gs) for (let k = g.start; k < g.start + g.count; k++) { const i = b.indices[k]; const u = b.uvs[i*2], v = b.uvs[i*2+1]; u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
    if (u0 < -1e-4 || v0 < -1e-4 || u1 > 1 + 1e-4 || v1 > 1 + 1e-4) continue;
    const src = path.join(tmp, jobs.length + '.webp'); fs.writeFileSync(src, im.bytes);
    jobs.push({ key, src, dst: src.replace(/\.webp$/, '.out.webp'), box: [Math.max(0, u0), Math.max(0, v0), Math.min(1, u1), Math.min(1, v1)], gs });
  }
  if (!jobs.length) return;
  const py = [
    'import sys, json',
    'from PIL import Image',
    'out = []',
    'for j in json.load(open(sys.argv[1], encoding="utf-8")):',
    '    im = Image.open(j["src"]).convert("RGB"); W, H = im.size',
    '    u0, v0, u1, v1 = j["box"]',
    '    x0 = max(0, int(u0 * W) - 2); y0 = max(0, int(v0 * H) - 2); x1 = min(W, int(u1 * W) + 3); y1 = min(H, int(v1 * H) + 3)',
    '    c = im.crop((x0, y0, x1, y1))',
    '    if max(c.size) > 2048: c.thumbnail((2048, 2048), Image.LANCZOS)',
    '    c.save(j["dst"], "WEBP", quality=85, method=6)',
    '    out.append([x0 / W, y0 / H, x1 / W, y1 / H])',
    'print(json.dumps(out))',
  ].join('\n');
  const list = path.join(tmp, 'jobs.json');
  fs.writeFileSync(list, JSON.stringify(jobs.map(({ src, dst, box }) => ({ src, dst, box }))));
  const r = spawnSync('python', ['-I', '-c', py, list], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('画像を切り詰められませんでした（Pillow）: ' + r.stderr); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  const boxes = JSON.parse(r.stdout);
  const done = new Set();
  jobs.forEach((j, n) => {
    const [x0, y0, x1, y1] = boxes[n];
    b.images.set(j.key, { bytes: new Uint8Array(fs.readFileSync(j.dst)), mimeType: 'image/webp' });
    for (const g of j.gs) for (let k = g.start; k < g.start + g.count; k++) {
      const i = b.indices[k]; if (done.has(i)) continue; done.add(i);
      b.uvs[i*2] = (b.uvs[i*2] - x0) / (x1 - x0); b.uvs[i*2+1] = (b.uvs[i*2+1] - y0) / (y1 - y0);
    }
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}

const argv = process.argv.slice(2);
const noTex = argv.includes('--no-texture');
const args = argv.filter((a) => !a.startsWith('--'));
if (args.length < 3) {
  console.log('usage:\n  node tools/extract_building.mjs search <lat> <lon> [radius_m] [tileset]\n  node tools/extract_building.mjs <gml_id> <lat> <lon> <out.glb> [tileset] [--no-texture]');
  process.exit(1);
}
const mode = args[0] === 'search' ? 'search' : 'extract';
const lat = +args[1], lon = +args[2];
const tsArg = args[4];
const tileset = tsArg ? (TILESETS[tsArg] || tsArg) : TILESETS['kyoto-nakagyo-lod2'];

const draco = await loadDraco();
const tiles = await leaves(getJson, tileset, lon, lat);
console.error(`leaf tiles: ${tiles.length}`);
const progress = (k, n, tu) => console.error(`  tile ${k + 1}/${n} ${tu.split('/').pop()}`);

if (mode === 'search') {
  const radius = +(args[3] || 150);
  const found = await searchBuildings(getBin, tiles, lon, lat, radius, draco, progress);
  console.log(JSON.stringify(found.map(({ tile, batch, ...r }) => r), null, 1));
} else {
  const gml = args[0], out = args[3];
  const b = await extractBuilding(getBin, tiles, gml, draco, progress, !noTex);
  if (!b) { console.error('not found:', gml); process.exit(2); }
  b.meta.tileset = tileset;
  if (!noTex && b.images.size) cropImages(b);
  const glb = encodeGlb(b);
  fs.writeFileSync(out, glb);
  const texBytes = [...b.images.values()].reduce((a, im) => a + im.bytes.byteLength, 0);
  const info = { ...b.meta, nv: b.positions.length / 3, nt: b.indices.length / 3, images: b.images.size, textureBytes: texBytes, bytes: glb.length };
  fs.writeFileSync(out.replace(/\.glb$/i, '') + '.json', JSON.stringify(info, null, 1));
  console.log(JSON.stringify({ out, name: b.meta.name, nt: info.nt, images: info.images, textureBytes: texBytes, bytes: glb.length, lat: b.meta.lat, lon: b.meta.lon }));
}
