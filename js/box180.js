// box180 — 本を 180° に開くと「のど（背）」をまたいで立ち上がる、側面の閉じた箱。箱は積める（本体の屋根に塔屋）。
//
//   【1 つの箱】市販のポップアップ絵本の「箱」。
//     ・前後の壁（のどに平行）は、それぞれ手前のページ・奥のページに、のどから a の位置でのりしろで貼る。
//     ・側壁（のどに直交）は中央（のどの真上）に縦の折り目を 1 本入れる。本を閉じると紙袋のマチのように内側へ折れる。
//     ・屋根は平らだと死点になるので、のどに沿う棟折り（山）を入れる。閉じるにつれて棟が持ち上がり、切妻になる。
//   【運動】開き角 φ（180° = 平ら）、α = φ/2。左右対称に置くと壁は常に 2 ページの二等分面に平行。
//     のどの高さを y_g とすると、壁の足もとは (y, z) = (y_g ± a cos α, ±a sin α)、壁の間隔 2a sin α、
//     側壁の折り目は x 方向に a cos α ずれて V、屋根の棟は壁の上端より a cos α 高い。φ = 0 で全部が 1 つの面にたたまれる。
//   【箱を積む】屋根の 2 枚は、閉じるにつれてページと同じ角度 φ の山形（Λ）になる。これを逆さの本と見なして、
//     棟から a' の位置に子の箱ののりしろを貼ると、子の箱も同じ二等分面に平行な壁で同じように動く。
//     子の足もとは y_R − a' cos α（y_R = 親の棟の高さ）。本のページ（V）に乗る親は y_g + a cos α。符号が違うだけ。
//     ★ どの箱も奥行の中心はのど（棟）の真上。a' ≤ 親の a、子の x の範囲は親の中。
//   【閉じるための条件】たたんだ全体の長さ（積んだぶんも含む）≤ ページの奥行。側壁を内折りにするなら W ≥ 2a。
//
//   座標は popup.js と同じ絵本系（x: のどに沿う、d: 奥行、h: 高さ。単位 m）。
//   箱 = { name, x0, x1, D (奥行。中心はのど), H (この箱の高さ), parent (親の番号 | null),
//          src: { x0, x1, d0, d1, h0, h1 } (画像を取る実際の範囲：絵本系) }

export const BOOK_PAGES = {
  A5: { name: 'A5 判の本（見開き A4 横）', width: 210, depth: 148 },
  B5: { name: 'B5 判の本（見開き B4 横）', width: 257, depth: 182 },
  A4: { name: 'A4 判の本（見開き A3 横）', width: 297, depth: 210 },
  SQ: { name: '20cm 角の本（見開き 40×20）', width: 200, depth: 200 },
  A3: { name: 'A3 判の本（見開き A2 横）', width: 420, depth: 297 },
};

/* 高さ地図から「本体＋塔屋」の 2 段を自動で作る。
   本体 = 建物の外形の矩形（x は全幅、奥行は全奥行）× 面積のいちばん多い高さ。塔屋 = 最高の塊の矩形 × (最高 − 本体)。
   mapper: popup.popupMapper の戻り（(u, v) → [x, d]）。gutterD … のどの d 座標（省略時は本体の奥行の中心） */
export function autoBoxes(raster, mapper, { tol = 0 } = {}) {
  const { nu, nv, heights: H, hmax, cell, step } = raster;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  const count = new Map();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const h = H[j * nu + i]; if (h <= 0) continue;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    count.set(h, (count.get(h) || 0) + 1);
  }
  if (!Number.isFinite(i0)) return [];
  let bodyH = 0, best = -1;
  for (const [h, n] of count) if (n > best || (n === best && h > bodyH)) { best = n; bodyH = h; }
  const rect = (ia, ib, ja, jb) => {
    const c1 = mapper(ia * cell, ja * cell), c2 = mapper((ib + 1) * cell, (jb + 1) * cell);
    return { x0: Math.min(c1[0], c2[0]), x1: Math.max(c1[0], c2[0]), d0: Math.min(c1[1], c2[1]), d1: Math.max(c1[1], c2[1]) };
  };
  const br = rect(i0, i1, j0, j1);
  const boxes = [{ name: '本体', x0: br.x0, x1: br.x1, D: br.d1 - br.d0, H: bodyH, parent: null, src: { ...br, h0: 0, h1: bodyH } }];
  if (hmax - bodyH >= step) {
    let ti0 = Infinity, ti1 = -Infinity, tj0 = Infinity, tj1 = -Infinity;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (H[j * nu + i] >= hmax - tol) { ti0 = Math.min(ti0, i); ti1 = Math.max(ti1, i); tj0 = Math.min(tj0, j); tj1 = Math.max(tj1, j); }
    const tr = rect(ti0, ti1, tj0, tj1);
    boxes.push({ name: '塔屋', x0: tr.x0, x1: tr.x1, D: Math.min(tr.d1 - tr.d0, br.d1 - br.d0), H: hmax - bodyH, parent: 0, src: { ...tr, h0: bodyH, h1: hmax } });
  }
  return boxes;
}

export const dimsOf = (b) => ({ W: b.x1 - b.x0, a: b.D / 2, H: b.H });
export const creaseInward = (b) => b.x1 - b.x0 >= b.D;

/* 箱の並びの 3D（開き角 phiDeg、180 = 平ら）。手前のページを水平に固定し、奥のページが背景のように起き上がる向き。
   gutterD … のどの d 座標。book: { width, depth } m。
   戻り: { pages: { far, near }, gutter, items: [{ box, faces, glue: [2 点]×2, corners, yFoot }] } */
export function boxesAt(boxes, phiDeg, book, gutterD = 0) {
  const alpha = Math.max(0.5, Math.min(180, phiDeg)) / 2 * Math.PI / 180;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const gamma = Math.PI / 2 - alpha, cg = Math.cos(gamma), sg = Math.sin(gamma);
  const P = (x, y, z) => [x, y * cg - z * sg, gutterD + (y * sg + z * cg)];   // 対称系 → 手前のページが水平な系
  const items = [];
  const ridgeY = [];   // 箱ごとの棟の高さ（対称系）
  boxes.forEach((b, k) => {
    const { W, a, H } = dimsOf(b);
    const base = b.parent == null ? 0 : (ridgeY[b.parent] ?? 0);
    const yf = b.parent == null ? base + a * ca : base - a * ca;   // V（ページ）に乗るか Λ（親の屋根）に乗るか
    const inward = creaseInward(b);
    const cx = (x, sideSign) => x + (inward ? -sideSign : sideSign) * a * ca;
    const yr = yf + H + a * ca; ridgeY[k] = yr;
    const faces = {
      front: [P(b.x0, yf, a * sa), P(b.x1, yf, a * sa), P(b.x1, yf + H, a * sa), P(b.x0, yf + H, a * sa)],
      back: [P(b.x1, yf, -a * sa), P(b.x0, yf, -a * sa), P(b.x0, yf + H, -a * sa), P(b.x1, yf + H, -a * sa)],
      roofF: [P(b.x0, yf + H, a * sa), P(b.x1, yf + H, a * sa), P(b.x1, yr, 0), P(b.x0, yr, 0)],
      roofB: [P(b.x0, yr, 0), P(b.x1, yr, 0), P(b.x1, yf + H, -a * sa), P(b.x0, yf + H, -a * sa)],
      leftB: [P(b.x0, yf, -a * sa), P(cx(b.x0, -1), yf, 0), P(cx(b.x0, -1), yf + H, 0), P(b.x0, yf + H, -a * sa)],
      leftF: [P(cx(b.x0, -1), yf, 0), P(b.x0, yf, a * sa), P(b.x0, yf + H, a * sa), P(cx(b.x0, -1), yf + H, 0)],
      rightF: [P(b.x1, yf, a * sa), P(cx(b.x1, +1), yf, 0), P(cx(b.x1, +1), yf + H, 0), P(b.x1, yf + H, a * sa)],
      rightB: [P(cx(b.x1, +1), yf, 0), P(b.x1, yf, -a * sa), P(b.x1, yf + H, -a * sa), P(cx(b.x1, +1), yf + H, 0)],
    };
    const glue = [[P(b.x0, yf, -a * sa), P(b.x1, yf, -a * sa)], [P(b.x0, yf, a * sa), P(b.x1, yf, a * sa)]];
    items.push({ box: b, faces, glue, inward, yFoot: yf, yRidge: yr, W, a, H });
  });
  const xs = boxes.length ? boxes.map((b) => (b.x0 + b.x1) / 2) : [0];
  const xm = xs.reduce((s, v) => s + v, 0) / xs.length, pw = book.width, pd = book.depth;
  const pages = {
    far: [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0), P(xm + pw / 2, pd * ca, -pd * sa), P(xm - pw / 2, pd * ca, -pd * sa)],
    near: [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0), P(xm + pw / 2, pd * ca, pd * sa), P(xm - pw / 2, pd * ca, pd * sa)],
  };
  return { pages, gutter: [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0)], items, foldedTop: Math.max(0, ...ridgeY) };
}

/* 面ごとの UV 用：箱の src（実際の範囲）での 4 隅の (x, d, h)。view3d と展開図が同じ割り付けを使う */
export function faceCorners(b) {
  const s = b.src || { x0: b.x0, x1: b.x1, d0: -b.D / 2, d1: b.D / 2, h0: 0, h1: b.H };
  const dc = (s.d0 + s.d1) / 2;
  return {
    front: { key: 'front', c: [[s.x0, s.d1, s.h0], [s.x1, s.d1, s.h0], [s.x1, s.d1, s.h1], [s.x0, s.d1, s.h1]] },
    back: { key: 'back', c: [[s.x1, s.d0, s.h0], [s.x0, s.d0, s.h0], [s.x0, s.d0, s.h1], [s.x1, s.d0, s.h1]] },
    roofF: { key: 'roof', c: [[s.x0, s.d1, s.h1], [s.x1, s.d1, s.h1], [s.x1, dc, s.h1], [s.x0, dc, s.h1]] },
    roofB: { key: 'roof', c: [[s.x0, dc, s.h1], [s.x1, dc, s.h1], [s.x1, s.d0, s.h1], [s.x0, s.d0, s.h1]] },
    leftB: { key: 'left', c: [[s.x0, s.d0, s.h0], [s.x0, dc, s.h0], [s.x0, dc, s.h1], [s.x0, s.d0, s.h1]] },
    leftF: { key: 'left', c: [[s.x0, dc, s.h0], [s.x0, s.d1, s.h0], [s.x0, s.d1, s.h1], [s.x0, dc, s.h1]] },
    rightF: { key: 'right', c: [[s.x1, s.d1, s.h0], [s.x1, dc, s.h0], [s.x1, dc, s.h1], [s.x1, s.d1, s.h1]] },
    rightB: { key: 'right', c: [[s.x1, dc, s.h0], [s.x1, s.d0, s.h0], [s.x1, s.d0, s.h1], [s.x1, dc, s.h1]] },
  };
}

/* 各面の「外から見た」横・縦の座標（画像を貼るため）。横は view3d.renderOrtho の right に合わせる。
   front: 横 x・縦 h ／ back: 横 -x ／ left（x0 の面、-x 側から見る）: 横 d ／ right: 横 -d ／ roof: 横 x・縦 -d */
export const FACE_VIEW = {
  front: { print: 'front', h: (x, d) => x, v: (h, d) => h },
  back: { print: 'back', h: (x, d) => -x, v: (h, d) => h },
  left: { print: 'left', h: (x, d) => d, v: (h, d) => h },
  right: { print: 'right', h: (x, d) => -d, v: (h, d) => h },
  roof: { print: 'top', h: (x, d) => x, v: (h, d) => -d },
};

/* たたんだときの全体の長さ（のどから）[m] と、本に収まるかの確認 */
export function checkBoxes(boxes, book, scaleDen, margin = 8) {
  const mm = (m) => m * 1000 / scaleDen;
  const issues = [];
  const r = boxesAt(boxes, 0.5, { width: 1, depth: 1 });
  const folded = r.foldedTop;
  if (mm(folded) + margin > book.depth) issues.push(`たたんだ全体の長さ ${mm(folded).toFixed(0)}mm がページの奥行 ${book.depth}mm を超えます。縮尺を小さく（分母を大きく）するか、大きな本にしてください`);
  // たたんだときの幅：外折りの側壁は箱の外に a ずつ出る
  const wmax = Math.max(0, ...boxes.map((b) => (b.x1 - b.x0) + (creaseInward(b) ? 0 : b.D)));
  if (mm(wmax) + margin * 2 > book.width) issues.push(`たたんだ箱の幅 ${mm(wmax).toFixed(0)}mm（外折りの側壁を含む）がページの幅 ${book.width}mm を超えます`);
  boxes.forEach((b, k) => {
    if (!creaseInward(b)) issues.push(`「${b.name}」は幅 ${(b.x1 - b.x0).toFixed(1)}m < 奥行 ${b.D.toFixed(1)}m なので側壁の折り目は外折り（閉じたとき折り目が箱の外に出ます）`);
    if (b.parent != null) {
      const p = boxes[b.parent];
      if (!p) issues.push(`「${b.name}」の親がありません`);
      else {
        if (b.D > p.D + 1e-6) issues.push(`「${b.name}」の奥行 ${b.D.toFixed(1)}m が親「${p.name}」の奥行 ${p.D.toFixed(1)}m を超えます（屋根に乗りません）`);
        if (b.x0 < p.x0 - 1e-6 || b.x1 > p.x1 + 1e-6) issues.push(`「${b.name}」の幅が親「${p.name}」からはみ出します`);
      }
    }
  });
  return { ok: !issues.some((s) => !s.includes('外折り')), issues, foldedMm: mm(folded), widthMm: mm(wmax) };
}

/* 展開図の部品。箱 1 つにつき、本体（背面・屋根 2 枚・正面＋のりしろ 2 つ）と側壁 2 枚（両端にのりしろ）。
   戻り: [{ w, h (mm), box, kind: 'main'|'left'|'right' }] */
function pieces(boxes, N, t) {
  const mm = (m) => m * 1000 / N;
  const out = [];
  boxes.forEach((b, k) => {
    const { W, a, H } = dimsOf(b);
    out.push({ w: mm(W), h: 2 * mm(H) + 2 * mm(a) + 2 * t, box: b, k, kind: 'main' });
    out.push({ w: 2 * mm(a) + 2 * t, h: mm(H), box: b, k, kind: 'left' });
    out.push({ w: 2 * mm(a) + 2 * t, h: mm(H), box: b, k, kind: 'right' });
  });
  return out;
}
/* 棚詰め（高さの順に並べて、左から右へ、あふれたら次の段）。戻り: 配置 [{ piece, x, y }] か null（収まらない） */
function pack(ps, paper, margin, gap, top) {
  const sorted = ps.map((p, i) => ({ p, i })).sort((u, v) => v.p.h - u.p.h);
  const W = paper.width - 2 * margin, Hh = paper.height - margin - top;
  let x = 0, y = 0, rowH = 0; const out = [];
  for (const { p } of sorted) {
    if (p.w > W) return null;
    if (x + p.w > W) { x = 0; y += rowH + gap; rowH = 0; }
    if (y + p.h > Hh) return null;
    out.push({ piece: p, x: margin + x, y: top + y });
    x += p.w + gap; rowH = Math.max(rowH, p.h);
  }
  return out;
}
/* 展開図が紙に収まり、かつ（book を渡せば）たたんだ箱が本のページに収まる縮尺（1/N） */
export function autoBoxesScale(boxes, paper, book = null, tabMm = 8) {
  const nice = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 3000];
  for (const n of nice) {
    if (!pack(pieces(boxes, n, tabMm), paper, 8, 4, 14)) continue;
    if (book && !checkBoxes(boxes, book, n).ok) continue;
    return n;
  }
  return 3000;
}

const f2 = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST = {
  cut: 'stroke="#000" stroke-width="0.3"',
  mountain: 'stroke="#c0392b" stroke-width="0.25" stroke-dasharray="2.2 0.9 0.5 0.9"',
  valley: 'stroke="#1f5fbf" stroke-width="0.25" stroke-dasharray="1.6 1"',
  faint: 'stroke="#999" stroke-width="0.15"',
  glue: 'fill="#f3e9c6" stroke="none"',
  mark: 'fill="none" stroke="#c08a2e" stroke-width="0.25" stroke-dasharray="1 0.6"',
};

/* 展開図 SVG（部品を 1 枚に詰める）。opts: { paper, scaleDen, book, prints: { front, back, left, right, top }|null, title, meta, tabMm } */
export function renderBoxesNet(boxes, opts) {
  const { paper, scaleDen: N, book } = opts;
  const mm = (m) => m * 1000 / N;
  const t = opts.tabMm ?? 8;
  const ps = pieces(boxes, N, t);
  const placed = pack(ps, paper, 8, 4, 14);
  const out = [];
  const line = (x1, y1, x2, y2, s) => out.push(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" ${ST[s]}/>`);
  const glueRect = (x, y, w, h) => out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" ${ST.glue}/>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}mm" height="${paper.height}mm" viewBox="0 0 ${paper.width} ${paper.height}" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif">`);
  out.push(`<rect x="0" y="0" width="${paper.width}" height="${paper.height}" fill="#fff"/>`);
  const pr = opts.prints;
  if (pr && pr.front) {
    out.push('<defs>');
    for (const k of ['front', 'back', 'left', 'right', 'top']) if (pr[k]) out.push(`<image id="bx-${k}" width="${pr[k].w}" height="${pr[k].h}" preserveAspectRatio="none" href="${pr[k].href}"/>`);
    out.push('</defs>');
  }
  let cid = 0;
  const paste = (f) => {   // f: { x, y, w, h, key, hA, hB, vT, vB }
    const p = pr && pr[FACE_VIEW[f.key].print]; if (!p) return;
    const sx = f.w * (p.h1 - p.h0) / (p.w * (f.hB - f.hA)), tx = f.x + f.w * (p.h0 - f.hA) / (f.hB - f.hA);
    const sy = f.h * (p.v1 - p.v0) / (p.h * (f.vT - f.vB)), ty = f.y + f.h * (f.vT - p.v1) / (f.vT - f.vB);
    const id = `bc${cid++}`;
    out.push(`<clipPath id="${id}"><rect x="${f2(f.x)}" y="${f2(f.y)}" width="${f2(f.w)}" height="${f2(f.h)}"/></clipPath>`);
    out.push(`<g clip-path="url(#${id})"><use href="#bx-${FACE_VIEW[f.key].print}" transform="matrix(${sx.toFixed(6)} 0 0 ${sy.toFixed(6)} ${f2(tx)} ${f2(ty)})"/></g>`);
  };
  const label = (x, y, s, size = 2.6) => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-size="${size}" fill="#555" text-anchor="middle">${esc(s)}</text>`);
  const k2 = 2;   // のりしろの角の面取り
  if (!placed) {
    out.push(`<text x="10" y="40" font-size="5" fill="#c0392b">この紙には収まりません。縮尺の分母を大きくするか、大きな紙にしてください。</text>`);
  } else {
    for (const { piece, x, y } of placed) {
      const b = piece.box, s = b.src || { x0: b.x0, x1: b.x1, d0: -b.D / 2, d1: b.D / 2, h0: 0, h1: b.H };
      const dc = (s.d0 + s.d1) / 2;
      const { W, a, H } = dimsOf(b);
      const Wm = mm(W), am = mm(a), Hm = mm(H);
      const inward = creaseInward(b);
      if (piece.kind === 'main') {
        const X0 = x, yBack = y + t, yRoofB = yBack + Hm, yRidge = yRoofB + am, yFront = yRidge + am, yBottom = yFront + Hm;
        paste({ x: X0, y: yBack, w: Wm, h: Hm, key: 'back', hA: -s.x0, hB: -s.x1, vT: s.h0, vB: s.h1 });
        paste({ x: X0, y: yRoofB, w: Wm, h: am, key: 'roof', hA: s.x0, hB: s.x1, vT: -s.d0, vB: -dc });
        paste({ x: X0, y: yRidge, w: Wm, h: am, key: 'roof', hA: s.x0, hB: s.x1, vT: -dc, vB: -s.d1 });
        paste({ x: X0, y: yFront, w: Wm, h: Hm, key: 'front', hA: s.x0, hB: s.x1, vT: s.h1, vB: s.h0 });
        glueRect(X0, yBottom, Wm, t); glueRect(X0, yBack - t, Wm, t);
        const o = [[X0, yBack - t + k2], [X0 + k2, yBack - t], [X0 + Wm - k2, yBack - t], [X0 + Wm, yBack - t + k2], [X0 + Wm, yBottom + t - k2], [X0 + Wm - k2, yBottom + t], [X0 + k2, yBottom + t], [X0, yBottom + t - k2]];
        out.push(`<polygon points="${o.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' ')}" fill="none" ${ST.cut}/>`);
        line(X0, yBack, X0 + Wm, yBack, 'valley'); line(X0, yRoofB, X0 + Wm, yRoofB, 'mountain'); line(X0, yRidge, X0 + Wm, yRidge, 'mountain');
        line(X0, yFront, X0 + Wm, yFront, 'mountain'); line(X0, yBottom, X0 + Wm, yBottom, 'valley');
        // 子の箱ののりしろ位置（屋根の上、棟から a' の線）
        boxes.forEach((c) => {
          if (c.parent !== piece.k) return;
          const cam = mm(c.D / 2), cx0 = X0 + mm(c.x0 - b.x0), cw = mm(c.x1 - c.x0);
          out.push(`<rect x="${f2(cx0)}" y="${f2(yRidge - cam - t)}" width="${f2(cw)}" height="${t}" ${ST.mark}/>`);
          out.push(`<rect x="${f2(cx0)}" y="${f2(yRidge + cam)}" width="${f2(cw)}" height="${t}" ${ST.mark}/>`);
          label(cx0 + cw / 2, yRidge - cam - t / 2 + 1, `${c.name}の背面ののりしろ`, 2.2); label(cx0 + cw / 2, yRidge + cam + t / 2 + 1, `${c.name}の正面ののりしろ`, 2.2);
        });
        label(X0 + Wm / 2, yBack + Hm / 2, `${b.name}：背面（逆さ）`); label(X0 + Wm / 2, yRoofB + am / 2 + 1, '屋根・奥'); label(X0 + Wm / 2, yRidge + am / 2 + 1, '屋根・手前');
        label(X0 + Wm / 2, yFront + Hm / 2, `${b.name}：正面`);
        label(X0 + Wm / 2, yBottom + t / 2 + 1, b.parent == null ? 'のりしろ→手前のページ' : `のりしろ→${boxes[b.parent].name}の屋根・手前`, 2.2);
        label(X0 + Wm / 2, yBack - t / 2 + 1, b.parent == null ? 'のりしろ→奥のページ' : `のりしろ→${boxes[b.parent].name}の屋根・奥`, 2.2);
      } else {
        // 側壁：[のりしろ][奥半分 a][手前半分 a][のりしろ]（左側壁は -x 側から見て右が手前。右側壁は +x 側から見て左が手前）
        const X0 = x + t, Y = y;
        const left = piece.kind === 'left';
        paste({ x: X0, y: Y, w: 2 * am, h: Hm, key: left ? 'left' : 'right', hA: left ? s.d0 : -s.d1, hB: left ? s.d1 : -s.d0, vT: s.h1, vB: s.h0 });
        glueRect(x, Y, t, Hm); glueRect(X0 + 2 * am, Y, t, Hm);
        const o = [[x + k2, Y], [X0 + 2 * am + t - k2, Y], [X0 + 2 * am + t, Y + k2], [X0 + 2 * am + t, Y + Hm - k2], [X0 + 2 * am + t - k2, Y + Hm], [x + k2, Y + Hm], [x, Y + Hm - k2], [x, Y + k2]];
        out.push(`<polygon points="${o.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' ')}" fill="none" ${ST.cut}/>`);
        line(X0, Y, X0, Y + Hm, 'valley'); line(X0 + 2 * am, Y, X0 + 2 * am, Y + Hm, 'valley');
        line(X0 + am, Y, X0 + am, Y + Hm, inward ? 'valley' : 'mountain');
        label(X0 + am, Y + Hm / 2, `${b.name}：${left ? '左' : '右'}側壁（中央で${inward ? '内' : '外'}折り）`);
        label(x + t / 2, Y + Hm / 2 - 3, left ? '背面へ' : '正面へ', 2); label(X0 + 2 * am + t / 2, Y + Hm / 2 - 3, left ? '正面へ' : '背面へ', 2);
      }
    }
  }
  // 凡例・表題
  const ly = 6;
  out.push(`<g font-size="3" fill="#333">`);
  out.push(`<line x1="8" y1="${ly}" x2="18" y2="${ly}" ${ST.cut}/><text x="20" y="${ly + 1}">切る</text>`);
  out.push(`<line x1="34" y1="${ly}" x2="44" y2="${ly}" ${ST.mountain}/><text x="46" y="${ly + 1}">山折り</text>`);
  out.push(`<line x1="62" y1="${ly}" x2="72" y2="${ly}" ${ST.valley}/><text x="74" y="${ly + 1}">谷折り</text>`);
  out.push(`<rect x="90" y="${ly - 1.6}" width="10" height="3.2" ${ST.glue}/><text x="102" y="${ly + 1}">のりしろ</text>`);
  out.push(`<rect x="124" y="${ly - 1.6}" width="10" height="3.2" ${ST.mark}/><text x="136" y="${ly + 1}">上に載る箱の貼り位置</text>`);
  out.push(`</g>`);
  const title = opts.title || '180° の箱';
  const meta = opts.meta || {};
  const chk = checkBoxes(boxes, book, N);
  const lines = [
    `${title}`,
    `縮尺 1/${N}　${boxes.map((b) => `${b.name} ${(b.x1 - b.x0).toFixed(1)}×${b.D.toFixed(1)}×${b.H.toFixed(1)}m${b.parent != null ? `（${boxes[b.parent].name}の屋根の上）` : ''}`).join('　')}`,
    `本：${book.name}　たたんだ全体の長さ ${chk.foldedMm.toFixed(0)}mm ≤ ページ奥行 ${book.depth}mm。本体ののりしろの折り線を、のどから ${f2(mm(boxes[0]?.D / 2 || 0))}mm の位置に、手前と奥のページへ左右対称に貼る`,
    `組み立て：各部品を切り、折り線を折る（印刷面が外側）。側壁の両端ののりしろを正面・背面の壁の内側の縦の辺に貼って筒にし、屋根を棟で折る。` +
      `上に載る箱は、親の屋根に描いた貼り位置（棟から等距離）に、正面・背面ののりしろを貼る。最後に本体を本のページに貼り、閉じて確かめる`,
    `${meta.gml_id ? 'gml:id ' + meta.gml_id + '　' : ''}出典：国土交通省 Project PLATEAU 3D都市モデル（建築物 LOD2）を単純化　${new Date().toISOString().slice(0, 10)}`,
  ];
  out.push(`<g font-size="2.8" fill="#333">`);
  lines.forEach((s, i) => out.push(`<text x="8" y="${f2(paper.height - 18 + i * 3.4)}" ${i === 0 ? 'font-size="4" font-weight="bold"' : ''}>${esc(s)}</text>`));
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join('\n');
}
