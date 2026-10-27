// b3dm — PLATEAU の 3D Tiles（b3dm・Draco 圧縮の glTF）を、ブラウザと Node の両方で読む共通部。
//   04_earth-simulator/extract_castles.cjs の知見を、Buffer に頼らない書き方（DataView / Uint8Array）に直したもの。
//   ★ 座標：b3dm の中身は glTF（Y 上）。3D Tiles の約束で ECEF = (x, -z, y) + RTC_CENTER、さらにタイルの transform を掛ける。
//   ★ 建物の区別は頂点属性 _BATCHID と、batch table（gml_id / gml:name / bldg:measuredHeight …）。
//   ⚠️ Draco の解読器（three/examples/jsm/libs/draco/draco_decoder.js の DracoDecoderModule）は呼ぶ側が用意して渡す。

const R2D = 180 / Math.PI;
const a_ = 6378137.0, f_ = 1 / 298.257223563, e2 = f_ * (2 - f_);

export function ecef2geo(x, y, z) {
  const lon = Math.atan2(y, x), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2)), h = 0;
  for (let i = 0; i < 5; i++) {
    const N = a_ / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + h)));
  }
  return [lon * R2D, lat * R2D, h];
}
export function geo2ecef(lonD, latD, h) {
  const lon = lonD / R2D, lat = latD / R2D, N = a_ / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * Math.sin(lat)];
}
/* ECEF → ENU（東=+x・上=+y・北=-z：three.js の向き）。原点は lon0/lat0/h0 */
export function enuFrame(lon0, lat0, h0) {
  const O = geo2ecef(lon0, lat0, h0);
  const lo = lon0 / R2D, la = lat0 / R2D;
  const E = [-Math.sin(lo), Math.cos(lo), 0];
  const Nn = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (p) => { const d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]]; return [dot(d, E), dot(d, U), -dot(d, Nn)]; };
}

const xf = (tf, c) => (tf ? [tf[0]*c[0]+tf[4]*c[1]+tf[8]*c[2]+tf[12], tf[1]*c[0]+tf[5]*c[1]+tf[9]*c[2]+tf[13], tf[2]*c[0]+tf[6]*c[1]+tf[10]*c[2]+tf[14]] : c);
function contains(bv, lon, lat, marginDeg) {
  if (lon == null) return true;
  if (bv && bv.region) {
    const [w, s, e, n] = bv.region.slice(0, 4).map((v) => v * R2D); const m = marginDeg;
    return w - m <= lon && lon <= e + m && s - m <= lat && lat <= n + m;
  }
  return true;
}
/* tileset を降りて、地点（lon/lat）を含む葉タイルの [URL, transform] を集める。getJson(url) → Promise<object> */
export async function leaves(getJson, url, lon, lat, marginDeg = 0.0015, depth = 0) {
  const ts = await getJson(url); const out = [];
  const walk = async (n, tf) => {
    if (n.transform) tf = n.transform;
    if (!contains(n.boundingVolume, lon, lat, marginDeg)) return;
    const ch = n.children || [];
    const c = n.content || (n.contents || [])[0];
    if (c) {
      const uri = c.uri || c.url; const abs = new URL(uri, url).href;
      if (uri.endsWith('.json')) { if (depth < 3) out.push(...await leaves(getJson, abs, lon, lat, marginDeg, depth + 1)); }
      else if (!ch.length) out.push([abs, tf]);
    }
    for (const k of ch) await walk(k, tf);
  };
  await walk(ts.root, null);
  return out;
}

function decodeDraco(draco, gl, bin, ext) {
  const bv = gl.bufferViews[ext.bufferView];
  const buf = new Int8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
  const dec = new draco.Decoder(); const db = new draco.DecoderBuffer(); db.Init(buf, buf.length);
  const mesh = new draco.Mesh(); const st = dec.DecodeBufferToMesh(db, mesh);
  if (!st.ok()) throw new Error('draco ' + st.error_msg());
  const nf = mesh.num_faces(), np = mesh.num_points();
  const idx = new Uint32Array(nf * 3); const ia = new draco.DracoInt32Array();
  for (let f = 0; f < nf; f++) { dec.GetFaceFromMesh(mesh, f, ia); idx[f*3] = ia.GetValue(0); idx[f*3+1] = ia.GetValue(1); idx[f*3+2] = ia.GetValue(2); }
  draco.destroy(ia);
  const attr = (id) => {
    const at = dec.GetAttributeByUniqueId(mesh, id); const nc = at.num_components();
    const arr = new draco.DracoFloat32Array(); dec.GetAttributeFloatForAllPoints(mesh, at, arr);
    const out = new Float64Array(np * nc); for (let i = 0; i < np * nc; i++) out[i] = arr.GetValue(i);
    draco.destroy(arr); return out;
  };
  const P = attr(ext.attributes.POSITION);
  const B = ext.attributes._BATCHID !== undefined ? attr(ext.attributes._BATCHID) : new Float64Array(np);
  const UV = ext.attributes.TEXCOORD_0 !== undefined ? attr(ext.attributes.TEXCOORD_0) : null;
  draco.destroy(mesh); draco.destroy(db); draco.destroy(dec);
  return { P, B, I: idx, UV };
}
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(gl, bin, i) {
  const a = gl.accessors[i], bv = gl.bufferViews[a.bufferView], n = NC[a.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const rd = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || size * n;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength); const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let j = 0; j < n; j++) out[k*n+j] = dv[rd](off + k*stride + j*size, true);
  return out;
}
function matmul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[r + 4*k] * b[k + 4*c]; o[r + 4*c] = s; } return o; }

const td = new TextDecoder();
const u8 = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/* b3dm 1 枚を読んで { batchTable, batchLength, tris: [{ b, p: [ECEF×3], uv: [[u,v]×3]|null, img: 画像の鍵|null }], images } にする。
   data … ArrayBuffer か Uint8Array。want … 欲しい batch 番号の Set（null＝全部、空の Set＝属性表だけ）。draco … DracoDecoderModule の中身。
   images … Map（画像の鍵 "tileUrl#番号" → { bytes: Uint8Array, mimeType }）。呼ぶ側が渡せば足していく（テクスチャ）。
   ★ PLATEAU の LOD2（テクスチャあり）は材質ごとに baseColorTexture（WebP。EXT_texture_webp の source）を持つ。UV は 0〜1 をはみ出す（繰り返し）ことがある */
export function readB3dm(data, tf, want = null, draco = null, images = null, tileUrl = '') {
  const d = u8(data);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (td.decode(d.subarray(0, 4)) !== 'b3dm') return null;
  const ftj = dv.getUint32(12, true), ftb = dv.getUint32(16, true), btj = dv.getUint32(20, true), btb = dv.getUint32(24, true);
  const ft = ftj ? JSON.parse(td.decode(d.subarray(28, 28 + ftj))) : {};
  let o = 28 + ftj + ftb;
  const bt = btj ? JSON.parse(td.decode(d.subarray(o, o + btj))) : {};
  o += btj + btb;
  const tris = [];
  if (want && want.size === 0) return { batchTable: bt, batchLength: ft.BATCH_LENGTH || 0, tris };
  const glb = d.subarray(o);
  const gdv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jl = gdv.getUint32(12, true);
  const gl = JSON.parse(td.decode(glb.subarray(20, 20 + jl)));
  const bin = glb.subarray(20 + jl + 8);
  const rtc = (gl.extensions && gl.extensions.CESIUM_RTC && gl.extensions.CESIUM_RTC.center) || ft.RTC_CENTER || [0, 0, 0];
  const node = (ni, M) => {
    const nd = gl.nodes[ni];
    if (nd.matrix) M = matmul(M, nd.matrix);
    if (nd.mesh !== undefined) {
      for (const pr of gl.meshes[nd.mesh].primitives) {
        let P, B, I, UV = null;
        const ext = pr.extensions && pr.extensions.KHR_draco_mesh_compression;
        if (ext) {
          if (!draco) throw new Error('Draco の解読器がありません');
          ({ P, B, I, UV } = decodeDraco(draco, gl, bin, ext));
        } else {
          P = accessor(gl, bin, pr.attributes.POSITION);
          B = pr.attributes._BATCHID !== undefined ? accessor(gl, bin, pr.attributes._BATCHID) : new Float64Array(P.length / 3);
          I = pr.indices !== undefined ? accessor(gl, bin, pr.indices) : Array.from({ length: P.length / 3 }, (_, i) => i);
          UV = pr.attributes.TEXCOORD_0 !== undefined ? accessor(gl, bin, pr.attributes.TEXCOORD_0) : null;
        }
        // この部分の画像（材質の baseColorTexture）。images を渡されたときだけ集める
        let img = null;
        if (images && UV) {
          const mat = pr.material !== undefined ? gl.materials[pr.material] : null;
          const ti = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
          if (ti) {
            const T = gl.textures[ti.index];
            const src = T.source !== undefined ? T.source : T.extensions && T.extensions.EXT_texture_webp && T.extensions.EXT_texture_webp.source;
            const im = src !== undefined ? gl.images[src] : null;
            if (im && im.bufferView !== undefined) {
              img = tileUrl + '#' + src;
              if (!images.has(img)) {
                const bv = gl.bufferViews[im.bufferView];
                images.set(img, { bytes: bin.slice((bv.byteOffset || 0), (bv.byteOffset || 0) + bv.byteLength), mimeType: im.mimeType || 'image/webp' });
              }
            }
          }
        }
        const W = (k) => {
          let x = P[k*3], y = P[k*3+1], z = P[k*3+2];
          [x, y, z] = [M[0]*x+M[4]*y+M[8]*z+M[12], M[1]*x+M[5]*y+M[9]*z+M[13], M[2]*x+M[6]*y+M[10]*z+M[14]];
          return xf(tf, [x + rtc[0], -z + rtc[1], y + rtc[2]]);
        };
        const T2 = (k) => [UV[k*2], UV[k*2+1]];
        for (let k = 0; k + 2 < I.length; k += 3) {
          const b = Math.round(B[I[k]]);
          if (want && !want.has(b)) continue;
          tris.push({ b, p: [W(I[k]), W(I[k+1]), W(I[k+2])], uv: img ? [T2(I[k]), T2(I[k+1]), T2(I[k+2])] : null, img });
        }
      }
    }
    for (const c of nd.children || []) node(c, M);
  };
  for (const ni of gl.scenes[gl.scene || 0].nodes) node(ni, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  return { batchTable: bt, batchLength: ft.BATCH_LENGTH || 0, tris };
}

/* 属性表から 1 列を取る（gml:name の形でも gml_name の形でも） */
export const btColumn = (bt, key) => (bt && (bt[key] || bt[key.replace(':', '_')])) || null;

/* 地点のまわりの建物を一覧する。tiles … leaves() の結果、getBin(url) → Promise<ArrayBuffer>。
   戻り … [{ gml_id, name, dist_m, height_attr, height_geom, footprint_m, usage, tile, batch }] 近い順 */
export async function searchBuildings(getBin, tiles, lon, lat, radius, draco, onProgress = null) {
  const toENU = enuFrame(lon, lat, 0);
  const found = [];
  let k = 0;
  for (const [tu, tf] of tiles) {
    onProgress?.(k++, tiles.length, tu);
    const r = readB3dm(await getBin(tu), tf, null, draco);
    if (!r) continue;
    const ids = btColumn(r.batchTable, 'gml_id') || [];
    const names = btColumn(r.batchTable, 'gml:name') || [];
    const hs = btColumn(r.batchTable, 'bldg:measuredHeight') || [];
    const usage = btColumn(r.batchTable, 'bldg:usage') || [];
    const acc = new Map();
    for (const t of r.tris) {
      let a = acc.get(t.b);
      if (!a) { a = { n: 0, sx: 0, sz: 0, ymin: Infinity, ymax: -Infinity, xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity }; acc.set(t.b, a); }
      for (const p of t.p) {
        const [x, y, z] = toENU(p);
        a.n++; a.sx += x; a.sz += z;
        a.ymin = Math.min(a.ymin, y); a.ymax = Math.max(a.ymax, y);
        a.xmin = Math.min(a.xmin, x); a.xmax = Math.max(a.xmax, x);
        a.zmin = Math.min(a.zmin, z); a.zmax = Math.max(a.zmax, z);
      }
    }
    for (const [b, a] of acc) {
      const cx = a.sx / a.n, cz = a.sz / a.n, dist = Math.hypot(cx, cz);
      if (dist > radius) continue;
      found.push({ gml_id: ids[b], name: names[b] || '', dist_m: +dist.toFixed(0), height_attr: hs[b] ?? null, height_geom: +(a.ymax - a.ymin).toFixed(1),
        footprint_m: `${(a.xmax - a.xmin).toFixed(0)}×${(a.zmax - a.zmin).toFixed(0)}`, usage: usage[b] ?? '', tile: tu, batch: b });
    }
  }
  found.sort((p, q) => p.dist_m - q.dist_m);
  return found;
}

/* 建物 1 棟を ENU の三角形にする（原点 = 足もとの中心・いちばん低い点の高さ）。
   戻り … { positions: Float32Array, indices: Uint32Array, uvs: Float32Array|null, groups: [{ start, count, image }], images: Map(鍵 → { bytes, mimeType }), meta }
   groups は indices の範囲ごとの画像の鍵（null = 画像なし）。withTextures=false なら画像を集めない */
export async function extractBuilding(getBin, tiles, gmlId, draco, onProgress = null, withTextures = true) {
  let tris = [], attrs = null, k = 0;
  const images = withTextures ? new Map() : null;
  for (const [tu, tf] of tiles) {
    onProgress?.(k++, tiles.length, tu);
    const data = await getBin(tu);
    const r0 = readB3dm(data, tf, new Set(), draco);
    if (!r0) continue;
    const ids = btColumn(r0.batchTable, 'gml_id') || [];
    const b = ids.indexOf(gmlId);
    if (b < 0) continue;
    const r = readB3dm(data, tf, new Set([b]), draco, images, tu);
    tris = tris.concat(r.tris);
    if (!attrs) { attrs = {}; for (const [key, v] of Object.entries(r.batchTable)) if (Array.isArray(v)) attrs[key] = v[b]; }
  }
  if (!tris.length) return null;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const t of tris) for (const p of t.p) { sx += p[0]; sy += p[1]; sz += p[2]; n++; }
  const [lon0, lat0] = ecef2geo(sx / n, sy / n, sz / n);
  let hmin = Infinity;
  for (const t of tris) for (const p of t.p) hmin = Math.min(hmin, ecef2geo(...p)[2]);
  const f = enuFrame(lon0, lat0, hmin);
  const welded = weldTriangles(tris.map((t) => ({ p: t.p.map(f), uv: t.uv, img: t.img })));
  // 使われなかった画像は捨てる
  const used = new Set(welded.groups.map((g) => g.image).filter(Boolean));
  if (images) for (const key of [...images.keys()]) if (!used.has(key)) images.delete(key);
  const meta = { source: '国土交通省 Project PLATEAU 3D都市モデル', gml_id: gmlId, name: attrs['gml:name'] || '', lat: +lat0.toFixed(7), lon: +lon0.toFixed(7), baseHeight: +hmin.toFixed(2), attributes: attrs, textured: !!(images && images.size) };
  return { ...welded, images: images || new Map(), meta };
}

/* 三角形の配列（{ p: [p0,p1,p2] の ENU, uv: [[u,v]×3]|null, img: 鍵|null }、または素の [p0,p1,p2]）を、
   画像ごとにまとめて 1mm（UV は 1e-5）で溶接した頂点配列・番号配列にする。
   戻り … { positions, indices, uvs (画像が 1 つも無ければ null), groups: [{ start, count, image }] } */
export function weldTriangles(tris) {
  const byImg = new Map();
  for (const t0 of tris) {
    const t = Array.isArray(t0) ? { p: t0, uv: null, img: null } : t0;
    const key = t.img || null;
    if (!byImg.has(key)) byImg.set(key, []);
    byImg.get(key).push(t);
  }
  const anyUV = [...byImg.keys()].some(Boolean);
  const map = new Map(), pos = [], uvs = [], idx = [], groups = [];
  for (const [img, list] of byImg) {
    const start = idx.length;
    for (const t of list) {
      const vi = t.p.map((p, j) => {
        const uv = img && t.uv ? t.uv[j] : null;
        const k = p.map((v) => Math.round(v * 1000)).join(',') + '|' + (uv ? uv.map((v) => Math.round(v * 1e5)).join(',') : img || '');
        let i = map.get(k);
        if (i === undefined) { i = pos.length / 3; map.set(k, i); pos.push(p[0], p[1], p[2]); if (anyUV) uvs.push(uv ? uv[0] : 0, uv ? uv[1] : 0); }
        return i;
      });
      if (vi[0] === vi[1] || vi[1] === vi[2] || vi[0] === vi[2]) continue;
      idx.push(...vi);
    }
    if (idx.length > start) groups.push({ start, count: idx.length - start, image: img });
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), uvs: anyUV ? new Float32Array(uvs) : null, groups };
}

/* 建物を glb（Uint8Array）にする。画像は glb の中に埋める（WebP は EXT_texture_webp）。
   b … { positions, indices, uvs|null, groups: [{ start, count, image }], images: Map(鍵 → { bytes, mimeType }), meta }
   ⚠️ bytes の無い画像（ブラウザで読み込んだ glb のテクスチャなど）は落とし、その部分は色だけにする */
export function encodeGlb(b) {
  const pad4 = (n) => (n + 3) & ~3;
  const chunks = []; let off = 0;
  const bufferViews = [], accessors = [], images = [], textures = [], materials = [], primitives = [];
  const push = (bytes, target) => {
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    chunks.push(u, new Uint8Array(pad4(u.length) - u.length)); off += pad4(u.length);
    return bufferViews.length - 1;
  };
  const P = b.positions, nv = P.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], P[i*3+j]); max[j] = Math.max(max[j], P[i*3+j]); }
  accessors.push({ bufferView: push(P, 34962), componentType: 5126, count: nv, type: 'VEC3', min, max });
  const attributes = { POSITION: 0 };
  const hasUV = !!b.uvs;
  if (hasUV) { accessors.push({ bufferView: push(b.uvs, 34962), componentType: 5126, count: nv, type: 'VEC2' }); attributes.TEXCOORD_0 = 1; }
  const matByImg = new Map();
  const materialFor = (key) => {
    if (matByImg.has(key)) return matByImg.get(key);
    const im = key && b.images && b.images.get(key);
    let mi;
    if (im && im.bytes && hasUV) {
      const webp = /webp/.test(im.mimeType);
      images.push({ bufferView: push(im.bytes), mimeType: im.mimeType });
      textures.push(webp ? { extensions: { EXT_texture_webp: { source: images.length - 1 } } } : { source: images.length - 1 });
      materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: textures.length - 1 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true });
    } else {
      materials.push({ pbrMetallicRoughness: { baseColorFactor: [0.86, 0.84, 0.79, 1], metallicFactor: 0, roughnessFactor: 0.95 }, doubleSided: true });
    }
    mi = materials.length - 1; matByImg.set(key, mi); return mi;
  };
  const groups = b.groups && b.groups.length ? b.groups : [{ start: 0, count: b.indices.length, image: null }];
  const I = b.indices;
  for (const g of groups) {
    const sub = Uint32Array.from(I.subarray(g.start, g.start + g.count));
    accessors.push({ bufferView: push(sub, 34963), componentType: 5125, count: sub.length, type: 'SCALAR' });
    primitives.push({ attributes, indices: accessors.length - 1, mode: 4, material: materialFor(g.image) });
  }
  let binLen = 0; for (const c of chunks) binLen += c.length;
  const bin = new Uint8Array(binLen); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; } }
  const webpUsed = images.some((im) => /webp/.test(im.mimeType));
  const json = {
    asset: { version: '2.0', generator: 'popup-book-plateau (source: MLIT Project PLATEAU)', extras: b.meta || {} },
    ...(webpUsed ? { extensionsUsed: ['EXT_texture_webp'], extensionsRequired: ['EXT_texture_webp'] } : {}),
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: (b.meta && b.meta.name) || 'building' }], meshes: [{ primitives }],
    buffers: [{ byteLength: bin.length }], bufferViews, accessors, materials,
    ...(images.length ? { images, textures } : {}),
  };
  const js = new TextEncoder().encode(JSON.stringify(json)); const jsp = new Uint8Array(pad4(js.length)).fill(0x20); jsp.set(js);
  const total = 12 + 8 + jsp.length + 8 + bin.length;
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46], 0); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsp.length, true); out.set([0x4a, 0x53, 0x4f, 0x4e], 16); out.set(jsp, 20);
  const o2 = 20 + jsp.length; dv.setUint32(o2, bin.length, true); out.set([0x42, 0x49, 0x4e, 0x00], o2 + 4); out.set(bin, o2 + 8);
  return out;
}

// 京都市の区（LOD2・テクスチャあり）。04_earth-simulator/js/config.js より。他都市はデータカタログ（GraphQL）から引く
//   ⚠️ テクスチャありの葉タイルは 1 枚 5〜7MB。中京区だけテクスチャなし版（軽い）も置いておく
const A = 'https://assets.cms.plateau.reearth.io/assets/';
const KYOTO_P = '/26100_kyoto-shi_city_2025_citygml_1_op_bldg_3dtiles_';
export const KYOTO_TILESETS = [
  { name: '京都市 北区', url: A + '7a/918715-89fb-4f45-a48a-a77ee6288577' + KYOTO_P + '26101_kita-ku_lod2/tileset.json' },
  { name: '京都市 上京区', url: A + '71/0af6ab-875e-4c69-bb5e-9e06096e6fcb' + KYOTO_P + '26102_kamigyo-ku_lod2/tileset.json' },
  { name: '京都市 左京区', url: A + '96/d17b9d-5527-4610-90c8-9e9c44d500c3' + KYOTO_P + '26103_sakyo-ku_lod2/tileset.json' },
  { name: '京都市 中京区', url: A + '04/eaac56-936e-49e2-a91b-0db31a6ed192' + KYOTO_P + '26104_nakagyo-ku_lod2/tileset.json' },
  { name: '京都市 中京区（テクスチャなし・軽い）', url: A + '1a/bba122-47e9-45f6-bf4e-f8ce0dce172f' + KYOTO_P + '26104_nakagyo-ku_lod2_no_texture/tileset.json' },
  { name: '京都市 東山区', url: A + '25/dd4c50-5342-4a0b-ac51-05ffb138b8b5' + KYOTO_P + '26105_higashiyama-ku_lod2/tileset.json' },
  { name: '京都市 下京区', url: A + 'f0/2ed501-5480-4ccb-8293-9469a3856f9a' + KYOTO_P + '26106_shimogyo-ku_lod2/tileset.json' },
  { name: '京都市 南区', url: A + '1c/596e87-af58-4394-a4e7-ef429ba5732c' + KYOTO_P + '26107_minami-ku_lod2/tileset.json' },
  { name: '京都市 右京区', url: A + '64/cf6354-e5ff-4ee4-84d6-1751734da17c' + KYOTO_P + '26108_ukyo-ku_lod2/tileset.json' },
  { name: '京都市 伏見区', url: A + '6c/10f912-836b-483d-a6b2-881e298d7006' + KYOTO_P + '26109_fushimi-ku_lod2/tileset.json' },
];
export const PLATEAU_CATALOG_GRAPHQL = 'https://api.plateauview.mlit.go.jp/datacatalog/graphql';
