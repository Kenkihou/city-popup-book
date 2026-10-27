// main — 画面の配線。① 建物を選ぶ → ② 単純化 → ③ 機構 → ④ 紙と縮尺 → 設計図（SVG）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { View3D } from './view3d.js';
import { rasterize, toBlocks } from './simplify.js';
import { buildStrips, chooseSide, checkFit, autoScale, popupMapper, SIDES } from './popup.js';
import { renderSVG, pageOf, PAPERS } from './pattern.js';
import { search, extract, catalogTilesets, KYOTO_TILESETS } from './plateau.js';
import { encodeGlb } from './b3dm.js';

const $ = (id) => document.getElementById(id);
const view = new View3D($('view'));

const state = {
  building: null,     // { positions, indices, meta }
  raster: null,
  side: 'auto',       // 'auto' か SIDES の 1 つ
  result: null,
  svg: '',
  scaleDen: 500,
};
let svgBlobUrl = null;

// ---- 状態表示 --------------------------------------------------------------
function status(msg) { const el = $('status'); if (!msg) { el.style.display = 'none'; return; } el.style.display = 'block'; el.textContent = msg; }

// ---- ① 建物 ------------------------------------------------------------------
function fillTilesets(list) {
  const sel = $('tileset');
  sel.innerHTML = '';
  for (const t of list) { const o = document.createElement('option'); o.value = t.url; o.textContent = t.name; sel.appendChild(o); }
  const o = document.createElement('option'); o.value = '__custom__'; o.textContent = 'tileset.json の URL を指定…'; sel.appendChild(o);
}
fillTilesets(KYOTO_TILESETS);
$('tileset').value = KYOTO_TILESETS[3].url;   // 中京区
$('tileset').addEventListener('change', () => { $('tilesetUrlRow').style.display = $('tileset').value === '__custom__' ? '' : 'none'; });
const tilesetUrl = () => ($('tileset').value === '__custom__' ? $('tilesetUrl').value.trim() : $('tileset').value);

$('catalog').addEventListener('click', async () => {
  const code = $('cityCode').value.trim();
  if (!/^\d{5}$/.test(code)) { alert('市区町村コード（5 桁）を入れてください。例：26100 京都市、27100 大阪市、13101 千代田区'); return; }
  try {
    status('データカタログに問い合わせ中…');
    const list = await catalogTilesets(code);
    if (!list.length) { alert('このコードの建築物 3D Tiles が見つかりません'); return; }
    fillTilesets([...list, ...KYOTO_TILESETS]);
    $('tileset').value = list[0].url;
    status('');
  } catch (e) { status(''); alert(e.message); }
});

$('search').addEventListener('click', async () => {
  const lat = +$('lat').value, lon = +$('lon').value, radius = +$('radius').value;
  const url = tilesetUrl(); if (!url) { alert('PLATEAU データを選んでください'); return; }
  $('search').disabled = true;
  try {
    const list = await search(url, lat, lon, radius, (k, n, tu) => status(`タイルを読んでいます ${k + 1}/${n}（${tu.split('/').pop()}）… 1 枚 5〜7MB`));
    status('');
    showResults(list, url, lat, lon);
  } catch (e) { status(''); alert('探せませんでした: ' + e.message); }
  $('search').disabled = false;
});

function showResults(list, url, lat, lon) {
  const box = $('results');
  if (!list.length) { box.innerHTML = '<div class="hint">半径内に建物がありません</div>'; return; }
  const rows = list.slice(0, 60).map((b, i) => `<tr data-i="${i}"><td>${b.name || '<span class="hint">（名前なし）</span>'}</td><td>${b.dist_m}m</td><td>${b.height_attr ?? b.height_geom}m</td><td>${b.footprint_m}</td><td>${b.usage}</td></tr>`).join('');
  box.innerHTML = `<table class="list"><thead><tr><th>名前</th><th>距離</th><th>高さ</th><th>大きさ</th><th>用途</th></tr></thead><tbody>${rows}</tbody></table><div class="hint">行をクリックすると、その建物を切り出して作ります（${list.length} 棟）</div>`;
  box.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', async () => {
    box.querySelectorAll('tr').forEach((r) => r.classList.remove('sel')); tr.classList.add('sel');
    const b = list[+tr.dataset.i];
    try {
      const r = await extract(url, lat, lon, b.gml_id, (k, n) => status(`建物を切り出しています ${k + 1}/${n}…`));
      if (!r) { status(''); alert('切り出せませんでした'); return; }
      status('テクスチャを用意しています…');
      await prepareTextures(r);
      status('');
      setBuilding(r);
    } catch (e) { status(''); alert(e.message); }
  }));
}

$('glbBtn').addEventListener('click', () => $('glbFile').click());
$('glbFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  try { setBuilding(await loadGlbFile(await file.arrayBuffer(), file.name)); } catch (e) { alert('GLB を読めませんでした: ' + e.message); }
});
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader(); dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/libs/draco/'); gltfLoader.setDRACOLoader(dracoLoader);
/* 任意の GLB → ワールド座標の三角形の束（Y 上・m を前提）。asset.extras に extract_building.mjs の情報があれば使う。
   材質の baseColorTexture（map）はそのまま THREE.Texture として持つ（textures）。画像の元バイト列は無いので、保存時は色だけになる */
function loadGlbFile(buf, name) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(buf, '', (gltf) => {
      const pos = [], uv = [], idx = [], groups = [], textures = new Map();
      let anyUV = false;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry; const P = g.attributes.position, U = g.attributes.uv; const base = pos.length / 3;
        const v = new THREE.Vector3();
        for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); }
        const start = idx.length;
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(base + i);
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const map = mat && mat.map && U ? mat.map : null;
        if (map) { anyUV = true; map.wrapS = map.wrapT = THREE.RepeatWrapping; textures.set(map.uuid, map); }
        groups.push({ start, count: idx.length - start, image: map ? map.uuid : null });
      });
      if (!pos.length) { reject(new Error('メッシュがありません')); return; }
      const extras = gltf.parser.json.asset?.extras || {};
      resolve({ positions: new Float32Array(pos), indices: new Uint32Array(idx), uvs: anyUV ? new Float32Array(uv) : null, groups, textures, images: new Map(),
        meta: { name: extras.name || name.replace(/\.glb$/i, ''), gml_id: extras.gml_id || '', lat: extras.lat, lon: extras.lon, source: extras.source || 'GLB', attributes: extras.attributes || {}, textured: anyUV } });
    }, reject);
  });
}
/* PLATEAU から切り出した建物（images: 鍵 → { bytes, mimeType }）の画像を THREE.Texture にする（glTF の UV なので flipY=false） */
async function prepareTextures(b) {
  b.textures = new Map();
  for (const [key, im] of b.images || []) {
    const url = URL.createObjectURL(new Blob([im.bytes], { type: im.mimeType }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('画像を読めません ' + im.mimeType)); i.src = url; });
      const t = new THREE.Texture(img); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
      b.textures.set(key, t);
    } catch (e) { console.warn(e); } finally { URL.revokeObjectURL(url); }
  }
}

function setBuilding(b) {
  state.building = b;
  const n = b.positions.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { const v = b.positions[i * 3 + j]; if (v < min[j]) min[j] = v; if (v > max[j]) max[j] = v; }
  b.size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  b.ymin = min[1];
  const a = b.meta.attributes || {};
  $('buildingInfo').innerHTML = `<b>${b.meta.name || '（名前なし）'}</b>　${b.meta.gml_id || ''}\n` +
    `大きさ 東西 ${b.size[0].toFixed(1)}m × 南北 ${b.size[2].toFixed(1)}m × 高さ ${b.size[1].toFixed(1)}m　三角形 ${(b.indices.length / 3)}　テクスチャ ${b.textures && b.textures.size ? b.textures.size + ' 枚' : 'なし'}\n` +
    `${a['bldg:usage'] ? '用途 ' + a['bldg:usage'] + '　' : ''}${a['bldg:storeysAboveGround'] ? '地上 ' + a['bldg:storeysAboveGround'] + ' 階　' : ''}${a['bldg:yearOfConstruction'] ? '建築年 ' + a['bldg:yearOfConstruction'] + '　' : ''}${b.meta.lat ? `北緯 ${b.meta.lat} 東経 ${b.meta.lon}` : ''}`;
  $('cut').max = 0;
  recompute();
  view.frameTo(b.size[0], b.size[1], b.size[2]);
}

// ---- ②③④ 再計算 ------------------------------------------------------------
function simplifyOpts() {
  return { cell: +$('cell').value, step: +$('step').value, minHeight: +$('minHeight').value, smooth: +$('smooth').value, phi: $('autoPhi').checked ? null : (+$('phi').value) * Math.PI / 180 };
}
function popupOpts() { return { cutDepth: Math.round(+$('cut').value / +$('cell').value), gap: +$('gap').value, minStripCells: +$('minStrip').value }; }

/* 建物系 +u / +v の向きを方位の言葉にする（軸の角度 phi から） */
function compass(side, phi) {
  // ENU: x 東、z 南（-北）。u = (cos φ, sin φ)、v = (-sin φ, cos φ)（x,z 成分）
  const dir = { '-v': [Math.sin(phi), -Math.cos(phi)], '+v': [-Math.sin(phi), Math.cos(phi)], '-u': [-Math.cos(phi), -Math.sin(phi)], '+u': [Math.cos(phi), Math.sin(phi)] }[side];
  const ang = Math.atan2(dir[0], -dir[1]) * 180 / Math.PI;   // 北 = 0、東 = 90
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return names[Math.round(((ang % 360) + 360) % 360 / 45) % 8];
}

function recompute() {
  const b = state.building; if (!b) return;
  const so = simplifyOpts();
  const raster = rasterize(b.positions, b.indices, so);
  state.raster = raster;
  if ($('autoPhi').checked) $('phi').value = (raster.frame.phi * 180 / Math.PI).toFixed(1);
  const blocks = toBlocks(raster);
  $('simplifyInfo').textContent = `軸の向き ${(raster.frame.phi * 180 / Math.PI).toFixed(1)}°（東西から）　升目 ${raster.nu} × ${raster.nv}　最高 ${raster.hmax}m　ブロック ${blocks.length} 個`;

  // 食い込みスライダーの上限 = 背の向きの奥行
  const po = popupOpts();
  const auto = chooseSide(raster, po);
  const side = state.side === 'auto' ? auto.side : state.side;
  const result = state.side === 'auto' ? auto.result : buildStrips(raster, { ...po, side });
  state.result = result;
  const depthM = result.D * raster.cell;
  $('cut').max = Math.max(0, depthM - raster.cell); $('cut').step = raster.cell;
  if (+$('cut').value > +$('cut').max) $('cut').value = $('cut').max;
  $('cutVal').textContent = `${Math.round(+$('cut').value)}m`;
  // 向きのボタン
  const sidesBox = $('sides');
  sidesBox.innerHTML = '';
  const mk = (val, label, title) => { const btn = document.createElement('button'); btn.textContent = label; btn.title = title || ''; if (state.side === val) btn.classList.add('on'); btn.addEventListener('click', () => { state.side = val; recompute(); }); sidesBox.appendChild(btn); };
  mk('auto', `自動（${compass(auto.side, raster.frame.phi)}）`, '4 方向のうち埋める体積が最小');
  for (const s of SIDES) {
    const r = buildStrips(raster, { ...po, side: s });
    mk(s, `${compass(s, raster.frame.phi)}を背に`, `埋め ${(r.fillRatio * 100).toFixed(0)}%　帯 ${r.strips.length} 本`);
  }
  const bad = result.strips.filter((s) => !s.ok).length;
  $('popupInfo').innerHTML = `背の側 ${compass(result.side, raster.frame.phi)}（見る人は${compass({ '-v': '+v', '+v': '-v', '-u': '+u', '+u': '-u' }[result.side], raster.frame.phi)}側から）　帯 ${result.strips.length} 本　段 ${result.strips.reduce((a, s) => a + s.steps.length, 0)}\n` +
    `埋めた体積 ${result.fillVolume.toFixed(0)}m³（${(result.fillRatio * 100).toFixed(1)}%）${result.fillRatio > 0.3 ? '<span class="warn">　多め：背の向きや食い込みを変えると減るかもしれません</span>' : ''}\n` +
    (bad ? `<span class="warn">折れ線の長さが合わない帯 ${bad} 本</span>` : `<span class="ok">すべての帯で 折れ線の長さ = 台紙の足もとまで + 立て紙の高さ（1 枚の紙で成立）</span>`);

  // 紙と縮尺
  const paper = $('paper').value, page = pageOf(paper);
  const scaleDen = $('autoScale').checked ? autoScale(result, page) : +$('scale').value;
  state.scaleDen = scaleDen;
  if ($('autoScale').checked) $('scale').value = scaleDen;
  const fit = checkFit(result, raster, page, scaleDen);
  const mm = (m) => (m * 1000 / scaleDen).toFixed(1);
  $('fitInfo').innerHTML = `縮尺 1/${scaleDen}　紙の上で 幅 ${fit.widthMm.toFixed(0)}mm・手前 ${fit.aMaxMm.toFixed(0)}mm・高さ ${fit.MMaxMm.toFixed(0)}mm　升目 ${mm(raster.cell)}mm　高さの刻み ${mm(so.step)}mm\n` +
    (fit.ok ? '<span class="ok">紙に収まります</span>' : fit.issues.map((s) => `<span class="warn">${s}</span>`).join('\n'));

  // 3D
  const mapper = popupMapper(raster, result.side, result.cutDepth, result.gap);
  view.setBuilding(b, raster.frame, mapper, b.ymin);
  view.setBlocks(raster, mapper);
  // 印刷画像：元の建物（テクスチャ付き）の正面図・平面図を正射投影で描く
  let prints = null, printHrefs = null;
  if ($('texPrint').checked && view.building && view.building.textured) {
    const pxPerM = (+$('pxPerMm').value || 6) * 1000 / scaleDen;
    prints = { front: view.renderOrtho('front', result.W * raster.cell, pxPerM), top: view.renderOrtho('top', result.W * raster.cell, pxPerM) };
    printHrefs = { front: { ...prints.front, href: prints.front.canvas.toDataURL('image/png') }, top: { ...prints.top, href: prints.top.canvas.toDataURL('image/png') } };
  }
  view.setPopup(result, page, scaleDen, prints);

  // 設計図
  const svg = renderSVG(result, { paper, scaleDen, shading: $('shading').checked, prints: printHrefs, title: `飛び出す絵本　${b.meta.name || ''}`, meta: { ...b.meta, step: so.step } });
  state.svg = svg;
  $('pattern').innerHTML = svg;
  $('patternInfo').textContent = `${PAPERS[paper].name}　1/${scaleDen}　帯 ${result.strips.length} 本${printHrefs ? `　画像 ${printHrefs.front.w}×${printHrefs.front.h} / ${printHrefs.top.w}×${printHrefs.top.h}px` : ''}`;
}

for (const id of ['cell', 'step', 'minHeight', 'smooth', 'phi', 'gap', 'minStrip', 'paper', 'scale', 'shading', 'texPrint', 'pxPerMm']) $(id).addEventListener('change', recompute);
$('cut').addEventListener('input', () => { $('cutVal').textContent = `${Math.round(+$('cut').value)}m`; recompute(); });
$('autoPhi').addEventListener('change', () => { $('phi').disabled = $('autoPhi').checked; recompute(); });
$('autoScale').addEventListener('change', () => { $('scale').disabled = $('autoScale').checked; recompute(); });
{
  const sel = $('paper');
  for (const [k, p] of Object.entries(PAPERS)) { const o = document.createElement('option'); o.value = k; o.textContent = p.name; sel.appendChild(o); }
  sel.value = 'A4';
}

// ---- 3D 画面の操作 ----------------------------------------------------------
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => view.setMode(r.value)));
$('showGhost').addEventListener('change', () => view.setGhost($('showGhost').checked));
$('theta').addEventListener('input', () => { $('thetaVal').textContent = `${$('theta').value}°`; view.setTheta(+$('theta').value); });
let anim = null;
$('animate').addEventListener('click', () => {
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / 2400);
    const deg = 90 * (1 - Math.cos(Math.PI * p)) / 2;   // 0 → 90 をなめらかに
    $('theta').value = deg; $('thetaVal').textContent = `${Math.round(deg)}°`; view.setTheta(deg);
    if (p < 1) anim = requestAnimationFrame(tick); else anim = null;
  };
  anim = requestAnimationFrame(tick);
});

// ---- 保存・印刷 --------------------------------------------------------------
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (svgBlobUrl) URL.revokeObjectURL(svgBlobUrl);
  svgBlobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = svgBlobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const baseName = () => (state.building?.meta.name || 'building').replace(/[\\/:*?"<>|\s]+/g, '_');
$('openSvg').addEventListener('click', () => { if (state.svg) window.open(URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml' })), '_blank'); });
$('saveSvg').addEventListener('click', () => { if (state.svg) download(`popup_${baseName()}_1-${state.scaleDen}.svg`, state.svg, 'image/svg+xml'); });
$('saveJson').addEventListener('click', () => {
  if (!state.result) return;
  const r = state.result, b = state.building;
  const design = { building: { ...b.meta, size: b.size }, simplify: { ...simplifyOpts(), phiDeg: +(state.raster.frame.phi * 180 / Math.PI).toFixed(2) }, popup: { side: r.side, cutDepth: r.cutDepth, gap: r.gap, strips: r.strips.length, fillRatio: r.fillRatio },
    paper: { paper: $('paper').value, scaleDen: state.scaleDen }, strips: r.strips.map((s) => ({ u0: s.u0, u1: s.u1, a: s.a, M: s.M, steps: s.steps, poly: s.poly, folds: s.folds })) };
  download(`popup_${baseName()}.json`, JSON.stringify(design, null, 1), 'application/json');
});
$('saveGlb').addEventListener('click', () => {
  if (!state.building) return;
  // PLATEAU から切り出した建物は画像ごと埋める（b3dm.js の encodeGlb）。読み込んだ glb は画像の元バイト列が無いので色だけ
  download(`${baseName()}.glb`, new Blob([encodeGlb(state.building)]), 'model/gltf-binary');
});
/* serve.py の /save へ（開発用）。output/<name> に書く */
async function saveToServer(name, data, base64 = false) {
  const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data, base64 }) });
  if (!r.ok) throw new Error('HTTP ' + r.status + '（serve.py で開いているときだけ使えます）');
  return (await r.json()).saved;
}
$('saveServer').addEventListener('click', async () => {
  if (!state.svg) return;
  try {
    const name = `${baseName()}_${$('paper').value}_1-${state.scaleDen}${$('texPrint').checked && view.building?.textured ? '_tex' : ''}.svg`;
    const saved = await saveToServer(name, state.svg);
    status('保存しました: ' + saved); setTimeout(() => status(''), 4000);
  } catch (e) { alert('保存できませんでした: ' + e.message); }
});
$('print').addEventListener('click', () => {
  const p = PAPERS[$('paper').value];
  let st = document.getElementById('printPage'); if (!st) { st = document.createElement('style'); st.id = 'printPage'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${p.width}mm ${p.height}mm; margin: 0; }`;
  window.print();
});

// ---- 起動：京都市役所（第 1 号）を読み込む -----------------------------------------
(async () => {
  try {
    const r = await fetch('./models/kyoto-cityhall.glb');
    if (r.ok) {
      const b = await loadGlbFile(await r.arrayBuffer(), 'kyoto-cityhall.glb');
      // 起動時の 1 棟は、画像の元バイト列も持っておく（「建物 GLB」で画像ごと保存できるように）
      try { const meta = await (await fetch('./models/kyoto-cityhall.json')).json(); b.meta = { ...b.meta, ...meta }; } catch (e) { /* 無くてもよい */ }
      setBuilding(b);
    }
    else $('buildingInfo').textContent = '建物を選んでください';
  } catch (e) { $('buildingInfo').textContent = '建物を選んでください（' + e.message + '）'; }
})();
