// plateau_b3dm — Node 側の糊。中身（b3dm の読み取り・glb の書き出し）は js/b3dm.js（ブラウザと共通）。
//   ⚠️ three の Draco 解読器は CommonJS/UMD の書き方なので、中身を関数として動かして module.exports を拾う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export * from '../js/b3dm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let draco = null;
export async function loadDraco() {
  if (draco) return draco;
  const file = path.join(here, '../node_modules/three/examples/jsm/libs/draco/draco_decoder.js');
  const src = fs.readFileSync(file, 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', src)(m, m.exports, createRequire(import.meta.url), file, path.dirname(file));
  draco = await m.exports();
  return draco;
}

const UA = { 'User-Agent': 'popup-book-plateau/0.1' };
export async function get(url, json = true) {
  if (url.startsWith('file:')) {
    const b = fs.readFileSync(fileURLToPath(url));
    return json ? JSON.parse(b.toString('utf8')) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : new Uint8Array(await r.arrayBuffer());
    } catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 1500)); }
  }
}
export const getJson = (url) => get(url, true);
export const getBin = (url) => get(url, false);

// 京都市の区（LOD2）。04_earth-simulator/js/config.js より
const A = 'https://assets.cms.plateau.reearth.io/assets/';
const KYOTO_P = '/26100_kyoto-shi_city_2025_citygml_1_op_bldg_3dtiles_';
export const TILESETS = {
  'kyoto-nakagyo-lod2': A + '04/eaac56-936e-49e2-a91b-0db31a6ed192' + KYOTO_P + '26104_nakagyo-ku_lod2/tileset.json',
  'kyoto-nakagyo-lod2nt': A + '1a/bba122-47e9-45f6-bf4e-f8ce0dce172f' + KYOTO_P + '26104_nakagyo-ku_lod2_no_texture/tileset.json',
  'kyoto-nakagyo-lod1': A + '65/c601e9-7ba9-42f2-8400-bd1ec5282421' + KYOTO_P + '26104_nakagyo-ku_lod1/tileset.json',
};
