// view3d — three.js の画面。元の建物（テクスチャ付き）／単純化ブロック／紙の飛び出す絵本（開き角で動く）を同じ座標に重ねて見せる。
//   座標：背 = x 軸、台紙は +z（手前）に広がる、上 = +y。単位 m（建物の実寸。紙の寸法は縮尺で m に戻す）。
//   ★ 正面図・平面図の正射投影（renderOrtho）もここで描く。設計図の蹴上げ（壁面）・踏み面（屋根）・立て紙の背景に貼る画像のもと。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toBlocks } from './simplify.js';
import { boxAt, FACE_VIEW } from './box180.js';

const PLAIN = 0xd9cfbf;

export class View3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8e4d8);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.position.set(80, 90, 160);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(50, 10, 20);
    // 紙の内側（閉じかけの立て紙は下向き）も暗くならないよう、半球光の地面色を明るめに＋前からの補助光
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4c8, 1.0));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-60, 120, 90); this.scene.add(sun);
    const sun2 = new THREE.DirectionalLight(0xffffff, 0.5); sun2.position.set(80, 40, -60); this.scene.add(sun2);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(20, -30, 120); this.scene.add(fill);
    this.groups = { original: new THREE.Group(), blocks: new THREE.Group(), popup: new THREE.Group(), box: new THREE.Group(), ghost: new THREE.Group() };
    for (const g of Object.values(this.groups)) this.scene.add(g);
    this.mode = 'popup';
    this.theta = Math.PI / 2;
    this.showGhost = true;
    this.mats = {
      building: new THREE.MeshStandardMaterial({ color: PLAIN, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, flatShading: true }),
      ghost: new THREE.MeshStandardMaterial({ color: 0x8aa0c8, roughness: 1, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      block: new THREE.MeshStandardMaterial({ color: 0xe3b86c, roughness: 0.8, flatShading: true }),
      paper: new THREE.MeshStandardMaterial({ color: 0xf8f6f0, roughness: 0.95, side: THREE.DoubleSide }),
      riser: new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.95, side: THREE.DoubleSide }),
      backdrop: new THREE.MeshStandardMaterial({ color: 0xcfcbc0, roughness: 1, side: THREE.DoubleSide }),
      line: new THREE.LineBasicMaterial({ color: 0x333333 }),
      edge: new THREE.LineBasicMaterial({ color: 0x5a4a3a }),
    };
    this.applyVisibility();
    const ro = new ResizeObserver(() => this.resize()); ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setMode(mode) { this.mode = mode; this.applyVisibility(); }
  setGhost(on) { this.showGhost = on; this.applyVisibility(); }
  applyVisibility() {
    this.groups.original.visible = this.mode === 'original';
    this.groups.blocks.visible = this.mode === 'blocks';
    this.groups.popup.visible = this.mode === 'popup';
    this.groups.box.visible = this.mode === 'box';
    this.groups.ghost.visible = this.mode !== 'original' && this.showGhost;
  }
  clear(g) { while (g.children.length) { const c = g.children.pop(); c.geometry?.dispose?.(); } }

  /* 元の建物を絵本系に写して置く。b: { positions, indices, uvs|null, groups: [{start,count,image}], textures: Map(鍵 → THREE.Texture) }
     frame: simplify の frame（toUV）、mapper: popupMapper の戻り（(u,v) → [x,d]）。ymin: 建物の足もとの高さ */
  setBuilding(b, frame, mapper, ymin = 0) {
    this.clear(this.groups.original); this.clear(this.groups.ghost);
    const { positions, indices } = b;
    const n = positions.length / 3, P = new Float32Array(n * 3);
    let maxY = 0, minD = Infinity, maxD = -Infinity;
    for (let i = 0; i < n; i++) {
      const [u, v] = frame.toUV(positions[i * 3], positions[i * 3 + 2]);
      const [x, d] = mapper(u, v);
      const y = positions[i * 3 + 1] - ymin;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = d;
      if (y > maxY) maxY = y; if (d < minD) minD = d; if (d > maxD) maxD = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (b.uvs) g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(indices instanceof Uint32Array ? indices : Uint32Array.from(indices), 1));
    g.computeVertexNormals();
    // 画像ごとの材質（lit 用と、正射投影用の unlit）
    const groups = b.groups && b.groups.length ? b.groups : [{ start: 0, count: indices.length, image: null }];
    const lit = [], unlit = [];
    groups.forEach((gr, k) => {
      const tex = gr.image && b.textures ? b.textures.get(gr.image) : null;
      // ★ PLATEAU の画像は航空写真由来で陰影を含むので、照明を掛けず（unlit）そのまま見せる。掛けると壁面が暗く沈んだ
      lit.push(tex ? new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }) : this.mats.building);
      unlit.push(tex ? new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ color: PLAIN, side: THREE.DoubleSide }));
      g.addGroup(gr.start, gr.count, k);
    });
    this.building = { geometry: g, lit, unlit, maxY, minD, maxD, textured: lit.some((m) => m.map) };
    this.groups.original.add(new THREE.Mesh(g, lit));
    this.groups.original.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), this.mats.edge));
    this.groups.ghost.add(new THREE.Mesh(g, this.mats.ghost));
  }

  /* 単純化ブロック */
  setBlocks(raster, mapper) {
    this.clear(this.groups.blocks);
    const { cell } = raster;
    for (const b of toBlocks(raster)) {
      const c1 = mapper(b.i0 * cell, b.j0 * cell), c2 = mapper((b.i1 + 1) * cell, (b.j1 + 1) * cell);
      const x0 = Math.min(c1[0], c2[0]), x1 = Math.max(c1[0], c2[0]), d0 = Math.min(c1[1], c2[1]), d1 = Math.max(c1[1], c2[1]);
      const geo = new THREE.BoxGeometry(x1 - x0, b.h, d1 - d0);
      const m = new THREE.Mesh(geo, this.mats.block);
      m.position.set((x0 + x1) / 2, b.h / 2, (d0 + d1) / 2);
      this.groups.blocks.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.mats.edge); e.position.copy(m.position); this.groups.blocks.add(e);
    }
  }

  /* 元の建物の正射投影を描く（テクスチャは unlit＝色そのまま。建物の無いところは透明）。
     kind: 'front'（手前から背を見る。横 = x、縦 = 高さ）／'back'（奥から。横 = -x）／'left'（x の小さい側から。横 = d）／'right'（横 = -d）／'top'（真上。横 = x、縦 = -d：画像の上端が背側）
     戻り: { canvas, w, h, h0, h1, v0, v1 }（画像の右向き・上向きの座標の範囲）。front/top は旧来の { x0, x1, a0, a1 } も付ける */
  renderOrtho(kind, widthM, pxPerM, maxPx = 4096) {
    if (!this.building) return null;
    const bd = this.building;
    const e = 0.5, minD = bd.minD - e, maxD = bd.maxD + e, maxY = bd.maxY + e;
    let h0, h1, v0, v1; const cam = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 10000);
    const look = (px, py, pz, tx, ty, tz, ux, uy, uz) => { cam.position.set(px, py, pz); cam.up.set(ux, uy, uz); cam.lookAt(tx, ty, tz); };
    if (kind === 'front') { h0 = 0; h1 = widthM; v0 = 0; v1 = maxY; look(0, 0, maxD + 10, 0, 0, maxD - 1, 0, 1, 0); }
    else if (kind === 'back') { h0 = -widthM; h1 = 0; v0 = 0; v1 = maxY; look(0, 0, minD - 10, 0, 0, minD + 1, 0, 1, 0); }
    else if (kind === 'left') { h0 = minD; h1 = maxD; v0 = 0; v1 = maxY; look(-10, 0, 0, -9, 0, 0, 0, 1, 0); }
    else if (kind === 'right') { h0 = -maxD; h1 = -minD; v0 = 0; v1 = maxY; look(widthM + 10, 0, 0, widthM + 9, 0, 0, 0, 1, 0); }
    else { h0 = 0; h1 = widthM; v0 = -maxD; v1 = -minD; look(0, maxY + 10, 0, 0, maxY - 1, 0, 0, 0, -1); }
    let w = Math.ceil((h1 - h0) * pxPerM), h = Math.ceil((v1 - v0) * pxPerM);
    const k = Math.min(1, maxPx / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    cam.left = h0; cam.right = h1; cam.bottom = v0; cam.top = v1; cam.far = Math.max(widthM, maxD - minD, maxY) + 40; cam.updateProjectionMatrix();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(bd.geometry, bd.unlit));
    const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
    const prevTarget = this.renderer.getRenderTarget(), prevClear = this.renderer.getClearColor(new THREE.Color()), prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x000000, 0); this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    this.renderer.setRenderTarget(prevTarget); this.renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    // GL は下の行から並ぶので上下を返す
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    const top = kind === 'top';
    return { canvas, w, h, h0, h1, v0, v1, x0: h0, x1: h1, a0: top ? -v1 : v0, a1: top ? -v0 : v1 };
  }

  /* 180° の箱（box180.js）。spec: { x0, x1, d0, d1, H } m、book: { width, depth } m、prints: { front, back, left, right, top }（renderOrtho の戻り）|null */
  setBox(spec, book, prints = null) {
    if (this.boxTex) for (const t of Object.values(this.boxTex)) t.dispose();
    this.boxTex = null; this.boxMats = null;
    if (prints && prints.front) {
      this.boxTex = {}; this.boxMats = {};
      for (const k of ['front', 'back', 'left', 'right', 'top']) {
        if (!prints[k]) continue;
        const t = new THREE.CanvasTexture(prints[k].canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
        this.boxTex[k] = t;
        this.boxMats[k] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 });
      }
    }
    this.box = { spec, book, prints };
    this.rebuildBox();
  }
  rebuildBox() {
    this.clear(this.groups.box);
    if (!this.box) return;
    const { spec, book, prints } = this.box;
    const b = boxAt(spec, this.theta * 180 / Math.PI, book);
    const geomOf = (pts, uv = null) => {
      const g = new THREE.BufferGeometry();
      const arr = [], uvs = [];
      const tri = (i, j, k) => { arr.push(...pts[i], ...pts[j], ...pts[k]); if (uv) uvs.push(...uv[i], ...uv[j], ...uv[k]); };
      tri(0, 1, 2); tri(0, 2, 3);
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals(); return g;
    };
    // ページ・のど・のりしろの線
    this.groups.box.add(new THREE.Mesh(geomOf(b.pages.far), this.mats.paper));
    this.groups.box.add(new THREE.Mesh(geomOf(b.pages.near), this.mats.paper));
    const lines = [...b.gutter[0], ...b.gutter[1], ...b.glue.far[0], ...b.glue.far[1], ...b.glue.near[0], ...b.glue.near[1]];
    // 面：外から見た (横, 縦) 座標 → 画像の UV。face: 4 点 + その絵本系の (x, d, h)
    const { x0, x1, d0, d1, H } = spec; const dc = (d0 + d1) / 2;
    const corners = {
      front: { key: 'front', c: [[x0, d1, 0], [x1, d1, 0], [x1, d1, H], [x0, d1, H]] },
      back: { key: 'back', c: [[x1, d0, 0], [x0, d0, 0], [x0, d0, H], [x1, d0, H]] },
      roofF: { key: 'roof', c: [[x0, d1, H], [x1, d1, H], [x1, dc, H], [x0, dc, H]] },
      roofB: { key: 'roof', c: [[x0, dc, H], [x1, dc, H], [x1, d0, H], [x0, d0, H]] },
      leftB: { key: 'left', c: [[x0, d0, 0], [x0, dc, 0], [x0, dc, H], [x0, d0, H]] },
      leftF: { key: 'left', c: [[x0, dc, 0], [x0, d1, 0], [x0, d1, H], [x0, dc, H]] },
      rightF: { key: 'right', c: [[x1, d1, 0], [x1, dc, 0], [x1, dc, H], [x1, d1, H]] },
      rightB: { key: 'right', c: [[x1, dc, 0], [x1, d0, 0], [x1, d0, H], [x1, dc, H]] },
    };
    for (const [name, pts] of Object.entries(b.faces)) {
      const fc = corners[name]; const fv = FACE_VIEW[fc.key]; const p = prints && prints[fv.print];
      const mat = p && this.boxMats && this.boxMats[fv.print] ? this.boxMats[fv.print] : (fc.key === 'roof' ? this.mats.paper : this.mats.riser);
      const uv = p ? fc.c.map(([x, d, h]) => [(fv.h(x, d) - p.h0) / (p.h1 - p.h0), (fv.v(h, d) - p.v0) / (p.v1 - p.v0)]) : null;
      this.groups.box.add(new THREE.Mesh(geomOf(pts, uv), mat));
      for (let i = 0; i < 4; i++) lines.push(...pts[i], ...pts[(i + 1) % 4]);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.groups.box.add(new THREE.LineSegments(lg, this.mats.line));
  }

  /* 紙の模型。result: popup.buildStrips の戻り、page: { width, depthBase, depthBack } mm、scaleDen: 1/N
     prints: { front: { canvas, x0, x1, a0, a1 }, top: {...} } か null（紙に印刷する画像） */
  setPopup(result, page, scaleDen, prints = null) {
    if (this.printTex) { for (const t of Object.values(this.printTex)) t.dispose(); }
    this.printTex = null; this.printMats = null;
    if (prints && prints.front && prints.top) {
      const mk = (p) => { const t = new THREE.CanvasTexture(p.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
      this.printTex = { front: mk(prints.front), top: mk(prints.top) };
      this.printMats = {
        front: new THREE.MeshStandardMaterial({ map: this.printTex.front, roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 }),
        top: new THREE.MeshStandardMaterial({ map: this.printTex.top, roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 }),
      };
    }
    this.popup = { result, page, scaleDen, prints };
    this.rebuildPopup();
  }
  setTheta(deg) { this.theta = deg * Math.PI / 180; this.rebuildPopup(); this.rebuildBox(); }
  rebuildPopup() {
    this.clear(this.groups.popup);
    if (!this.popup) return;
    const { result, page, scaleDen, prints } = this.popup;
    const th = this.theta, sy = Math.sin(th), cz = Math.cos(th);
    const mToPaper = (mm) => mm * scaleDen / 1000;    // 紙の mm → 建物の m
    const widthM = result.W * result.cell;
    const pageW = mToPaper(page.width), xoff = (pageW - widthM) / 2;   // 紙の左端は x = -xoff
    const depthBase = mToPaper(page.depthBase), depthBack = mToPaper(page.depthBack);
    const V = (x, h, d) => [x, h * sy, d + h * cz];   // 絵本系 (x, 高さ, 奥行) → 3D（立て紙の向きで回す）
    const sets = { paper: [], riser: [], backdrop: [], front: [], top: [] };
    const uvs = { front: [], top: [] };
    const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    const lines = [];
    const fr = this.printMats && prints.front, tp = this.printMats && prints.top;
    const uvFront = (x, h) => [(x - fr.x0) / (fr.x1 - fr.x0), (h - fr.a0) / (fr.a1 - fr.a0)];
    const uvTop = (x, d) => [(x - tp.x0) / (tp.x1 - tp.x0), 1 - (d - tp.a0) / (tp.a1 - tp.a0)];
    // 台紙：帯の外側は全面、帯の下は足もとの折りから奥へ。立て紙：帯の付け根より上
    const covered = result.strips.map((s) => [s.u0, s.u1]).sort((p, q) => p[0] - q[0]);
    const baseRect = (x0, x1, d0, d1) => quad(sets.paper, V(x0, 0, d0), V(x1, 0, d0), V(x1, 0, d1), V(x0, 0, d1));
    const backRect = (x0, x1, h0, h1) => quad(sets.paper, V(x0, h0, 0), V(x1, h0, 0), V(x1, h1, 0), V(x0, h1, 0));
    let x = -xoff;
    for (const [a, b] of covered) { if (a > x) { baseRect(x, a, 0, depthBase); backRect(x, a, 0, depthBack); } x = Math.max(x, b); }
    if (x < pageW - xoff) { baseRect(x, pageW - xoff, 0, depthBase); backRect(x, pageW - xoff, 0, depthBack); }
    for (const s of result.strips) {
      baseRect(s.u0, s.u1, s.a, depthBase);
      backRect(s.u0, s.u1, s.M, depthBack);
      // 帯：折れ線の各線分を四角で張る。印刷があれば蹴上げは正面図、踏み面は平面図を貼る
      for (let k = 1; k < s.poly.length; k++) {
        const [d0, h0] = s.poly[k - 1], [d1, h1] = s.poly[k];
        const vertical = Math.abs(h1 - h0) > 1e-9;
        const corners = [V(s.u0, h0, d0), V(s.u1, h0, d0), V(s.u1, h1, d1), V(s.u0, h1, d1)];
        if (vertical && fr) { quad(sets.front, ...corners); quad(uvs.front, uvFront(s.u0, h0), uvFront(s.u1, h0), uvFront(s.u1, h1), uvFront(s.u0, h1)); }
        else if (!vertical && tp) { quad(sets.top, ...corners); quad(uvs.top, uvTop(s.u0, d0), uvTop(s.u1, d0), uvTop(s.u1, d1), uvTop(s.u0, d1)); }
        else quad(vertical ? sets.riser : sets.paper, ...corners);
      }
      for (const [d, h] of s.poly) lines.push(...V(s.u0, h, d), ...V(s.u1, h, d));   // 折り線（切り口は面の縁で見える）
    }
    // 立て紙の背景：印刷があれば正面図（帯の付け根より上に見える部分 = 吸収した奥側）、無ければ列ごとの最大高さを薄く
    if (result.backdrop) {
      const Mof = (i) => { const u = (i + 0.5) * result.cell; const s = result.strips.find((t) => t.u0 <= u && u < t.u1); return s ? s.M : 0; };
      for (let i = 0; i < result.W; i++) {
        const h = result.backdrop[i]; if (h <= 0) continue;
        const x0 = i * result.cell, x1 = (i + 1) * result.cell, e = 0.02;
        if (fr) {
          const m = Mof(i); if (h <= m) continue;
          quad(sets.front, V(x0, m, e), V(x1, m, e), V(x1, h, e), V(x0, h, e));
          quad(uvs.front, uvFront(x0, m), uvFront(x1, m), uvFront(x1, h), uvFront(x0, h));
        } else quad(sets.backdrop, V(x0, 0, e), V(x1, 0, e), V(x1, h, e), V(x0, h, e));
      }
    }
    const mesh = (arr, mat, uv = null) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals(); this.groups.popup.add(new THREE.Mesh(g, mat));
    };
    mesh(sets.paper, this.mats.paper); mesh(sets.riser, this.mats.riser); mesh(sets.backdrop, this.mats.backdrop);
    if (this.printMats) { mesh(sets.front, this.printMats.front, uvs.front); mesh(sets.top, this.printMats.top, uvs.top); }
    if (lines.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)); this.groups.popup.add(new THREE.LineSegments(g, this.mats.line)); }
    const spine = new THREE.BufferGeometry(); spine.setAttribute('position', new THREE.Float32BufferAttribute([-xoff, 0, 0, pageW - xoff, 0, 0], 3));
    this.groups.popup.add(new THREE.Line(spine, this.mats.line));
  }

  /* 建物の大きさに合わせてカメラを置く */
  frameTo(widthM, heightM, depthM) {
    const r = Math.max(widthM, depthM, heightM);
    this.controls.target.set(widthM / 2, heightM / 3, depthM / 2);
    this.camera.position.set(widthM / 2 + r * 0.6, r * 0.9, depthM / 2 + r * 1.3);
    this.camera.near = r / 100; this.camera.far = r * 50; this.camera.updateProjectionMatrix();
  }
}
