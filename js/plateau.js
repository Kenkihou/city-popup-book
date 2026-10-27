// plateau（ブラウザ側）— PLATEAU の配信から建物を探して切り出す。中身は js/b3dm.js（Node と共通）。
//   ★ assets.cms.plateau.reearth.io は CORS が開いているので、ブラウザから直接 b3dm を読める（04 の知見）。
//   ★ Draco の解読器は index.html の <script> で読んだ DracoDecoderModule（three 同梱の JS 版）。
import { leaves, searchBuildings, extractBuilding, KYOTO_TILESETS, PLATEAU_CATALOG_GRAPHQL } from './b3dm.js';

let draco = null;
export async function getDraco() {
  if (draco) return draco;
  if (typeof DracoDecoderModule !== 'function') throw new Error('Draco の解読器（draco_decoder.js）が読めていません');
  draco = await DracoDecoderModule();
  return draco;
}
const jsonCache = new Map(), binCache = new Map();
const getJson = async (url) => {
  if (!jsonCache.has(url)) jsonCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.json(); }));
  return jsonCache.get(url);
};
const getBin = async (url) => {
  if (!binCache.has(url)) {
    binCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.arrayBuffer(); }));
    if (binCache.size > 12) binCache.delete(binCache.keys().next().value);   // 葉タイルは 1 枚 5〜7MB。持ちすぎない
  }
  return binCache.get(url);
};

export { KYOTO_TILESETS };

/* 地点のまわりの建物を一覧する */
export async function search(tilesetUrl, lat, lon, radius, onProgress) {
  const d = await getDraco();
  const tiles = await leaves(getJson, tilesetUrl, lon, lat);
  if (!tiles.length) throw new Error('この地点を含むタイルがありません（データの範囲外か、tileset の指定ちがい）');
  return searchBuildings(getBin, tiles, lon, lat, radius, d, onProgress);
}

/* 建物 1 棟を切り出す（ENU・足もと中心が原点） */
export async function extract(tilesetUrl, lat, lon, gmlId, onProgress) {
  const d = await getDraco();
  const tiles = await leaves(getJson, tilesetUrl, lon, lat);
  return extractBuilding(getBin, tiles, gmlId, d, onProgress);
}

/* データカタログ（GraphQL）から、市区町村コードの建築物 3D Tiles を引く。04 の fetch_cities.py と同じ問い合わせ。
   戻り: [{ name, url, lod, textured }] */
export async function catalogTilesets(cityCode) {
  const codes = String(cityCode).trim();
  const q = 'query($i:DatasetsInput){ datasets(input:$i){ name year typeCode cityCode wardCode city{ name } ward{ name code } ... on PlateauDataset { items { lod format url name } } } }';
  const r = await fetch(PLATEAU_CATALOG_GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { i: { areaCodes: [codes], includeTypes: ['bldg'] } } }) });
  if (!r.ok) throw new Error('カタログに届きません HTTP ' + r.status);
  const ds = ((await r.json()).data || {}).datasets || [];
  const out = [];
  for (const d of ds) {
    for (const it of d.items || []) {
      if (it.format !== 'CESIUM3DTILES' || !it.url || !it.lod) continue;
      const textured = !/no_texture|notexture/i.test(it.url) && !/テクスチャなし/.test(it.name || '');
      out.push({ name: `${d.city?.name || ''} ${d.ward?.name || ''} LOD${it.lod}${textured ? '' : '（テクスチャなし）'} ${d.year || ''}`.replace(/\s+/g, ' ').trim(), url: it.url, lod: it.lod, textured, year: d.year });
    }
  }
  // 同じ区なら LOD2 のテクスチャなし → LOD2 → LOD1 の順に出す（読む量が少なく、形は同じ）
  out.sort((a, b) => (b.lod === 2 ? 2 : b.lod === 1 ? 1 : 0) - (a.lod === 2 ? 2 : a.lod === 1 ? 1 : 0) || (a.textured ? 1 : 0) - (b.textured ? 1 : 0) || a.name.localeCompare(b.name, 'ja'));
  return out;
}
