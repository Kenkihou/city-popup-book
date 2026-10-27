// make_popup — glb（extract_building.mjs の出力）から飛び出す絵本の設計図（SVG）を作る CLI。ブラウザ版と同じ js/ の部品を使う。
//   node tools/make_popup.mjs --glb models/kyoto-cityhall.glb --out output/kyoto-cityhall [--side auto|-v|+v|-u|+u]
//        [--cell 2] [--step 3] [--min 1.5] [--smooth 1] [--cut 0] [--gap 0] [--minstrip 1] [--paper A4] [--scale auto|500] [--ascii]
import fs from 'node:fs';
import path from 'node:path';
import { rasterize, toBlocks } from '../js/simplify.js';
import { buildStrips, chooseSide, checkFit, autoScale } from '../js/popup.js';
import { renderSVG, pageOf } from '../js/pattern.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null)).filter(Boolean));
if (!args.glb) { console.log('usage: node tools/make_popup.mjs --glb <file.glb> --out <prefix> [options]'); process.exit(1); }

/* 自作の glb（位置＋番号だけ）を読む */
export function readGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jl = dv.getUint32(12, true);
  const gl = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jl)));
  const bin = buf.subarray(20 + jl + 8);
  const acc = (i) => {
    const a = gl.accessors[i], bv = gl.bufferViews[a.bufferView];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    return new T(bin.buffer.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const pr = gl.meshes[0].primitives[0];
  return { positions: acc(pr.attributes.POSITION), indices: Uint32Array.from(acc(pr.indices)), extras: gl.asset.extras || {} };
}

const glb = readGlb(fs.readFileSync(args.glb));
const metaFile = args.glb.replace(/\.glb$/i, '.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : glb.extras;
const simp = { cell: +(args.cell ?? 2), step: +(args.step ?? 3), minHeight: +(args.min ?? 1.5), smooth: +(args.smooth ?? 1) };
const raster = rasterize(glb.positions, glb.indices, simp);
const popOpts = { cutDepth: +(args.cut ?? 0), gap: +(args.gap ?? 0), minStripCells: +(args.minstrip ?? 1) };
let result;
if (!args.side || args.side === 'auto') result = chooseSide(raster, popOpts).result;
else result = buildStrips(raster, { ...popOpts, side: args.side });
const paper = args.paper || 'A4';
const page = pageOf(paper);
const scaleDen = args.scale && args.scale !== 'auto' ? +args.scale : autoScale(result, page);
const fit = checkFit(result, raster, page, scaleDen);

if (args.ascii) {
  // 升目の高さ地図を、背が上になる向きで文字で描く
  const { W, D, cell } = result;
  const o = (await import('../js/popup.js')).orient(raster, result.side);
  const ch = (h) => (h <= 0 ? '.' : String.fromCharCode(48 + Math.min(35, Math.round(h / raster.step))).replace(/[:-?]/, (c) => String.fromCharCode(c.charCodeAt(0) + 7)));
  console.log(`高さ地図（1 文字 = ${cell}m、数字 = 高さ ÷ ${raster.step}m。上が背／立て紙）  向き ${result.side}  軸 ${(raster.frame.phi * 180 / Math.PI).toFixed(1)}°`);
  for (let j = 0; j < D; j++) { let s = ''; for (let i = 0; i < W; i++) s += ch(o.get(i, j)); console.log(s); }
}

const svg = renderSVG(result, { paper, scaleDen, title: `飛び出す絵本　${meta.name || path.basename(args.glb)}`, meta: { ...meta, step: simp.step } });
const out = args.out || path.join('output', path.basename(args.glb, '.glb'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out + '.svg', svg);
const design = {
  building: { name: meta.name, gml_id: meta.gml_id, lat: meta.lat, lon: meta.lon, size: [raster.nu * raster.cell, raster.hmax, raster.nv * raster.cell] },
  simplify: { ...simp, phiDeg: +(raster.frame.phi * 180 / Math.PI).toFixed(2), blocks: toBlocks(raster).length },
  popup: { side: result.side, cutDepth: result.cutDepth, gap: result.gap, strips: result.strips.length, fillRatio: +result.fillRatio.toFixed(4), fillVolume_m3: +result.fillVolume.toFixed(1) },
  paper: { paper, scaleDen, fit },
  strips: result.strips.map((s) => ({ u0: s.u0, u1: s.u1, a: s.a, M: s.M, steps: s.steps, ok: s.ok })),
};
fs.writeFileSync(out + '.json', JSON.stringify(design, null, 1));
console.log(JSON.stringify({ out: out + '.svg', side: result.side, strips: result.strips.length, fillRatio: design.popup.fillRatio, scale: '1/' + scaleDen, fit: fit.ok ? 'ok' : fit.issues, allStripsOk: result.strips.every((s) => s.ok) }, null, 1));
