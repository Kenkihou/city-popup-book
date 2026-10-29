// box180 — 本を 180° に開くと「のど（背）」をまたいで立ち上がる、側面の閉じた箱（試作）。
//
//   【しくみ】市販のポップアップ絵本の「箱」。
//     ・前後の壁（のどに平行）は、それぞれ手前のページ・奥のページに、のどから a の位置でのりしろで貼る。
//     ・側壁（のどに直交）は中央（のどの真上）に縦の折り目を 1 本入れる。本を閉じると紙袋のマチのように内側へ折れて、箱がぺしゃんこになる。
//     ・屋根は平らだと死点になるので、のどに沿う棟折り（山）を入れる。閉じるにつれて棟が持ち上がり、切妻になる。
//   【運動】ページの開き角 φ（180° = 平ら）。左右対称に置くと、壁は常に 2 ページの二等分面に平行（180° で鉛直）。
//     α = φ/2。のどを原点、二等分面を上向き y とすると、壁の足もとは (y, z) = (a cos α, ±a sin α)、壁の間隔 2a sin α。
//     側壁の 2 枚（各 a）は折り目が x 方向に a cos α ずれて V になる。屋根の棟は壁の上端より a cos α 高い。
//     φ = 0 で全部が 1 つの面にたたまれる（紙の厚みを除く）。
//   【閉じるための条件】ページの奥行 ≥ 2a + H（たたんだ箱がページに収まる）。側壁を内折りにするなら W ≥ 2a（折り目どうしがぶつからない）。
//
//   座標は popup.js と同じ絵本系（x: のどに沿う、d: 奥行、h: 高さ。単位 m）。箱は spec = { x0, x1, d0, d1, H }。のどは d = (d0+d1)/2 に置く。

export const BOOK_PAGES = {
  A5: { name: 'A5 判の本（見開き A4 横）', width: 210, depth: 148 },
  B5: { name: 'B5 判の本（見開き B4 横）', width: 257, depth: 182 },
  A4: { name: 'A4 判の本（見開き A3 横）', width: 297, depth: 210 },
  SQ: { name: '20cm 角の本（見開き 40×20）', width: 200, depth: 200 },
};

/* 高さ地図のいちばん高い塊の範囲を、絵本系の箱 spec にする（高さは地面から）。
   raster: simplify.rasterize の戻り、mapper: popup.popupMapper の戻り、tol: 最高からこの範囲内の升を塊とみなす */
export function tallestBlockSpec(raster, mapper, tol = 0) {
  const { nu, nv, heights: H, hmax, cell } = raster;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (H[j * nu + i] >= hmax - tol) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  if (!Number.isFinite(i0)) return null;
  const c1 = mapper(i0 * cell, j0 * cell), c2 = mapper((i1 + 1) * cell, (j1 + 1) * cell);
  return { x0: Math.min(c1[0], c2[0]), x1: Math.max(c1[0], c2[0]), d0: Math.min(c1[1], c2[1]), d1: Math.max(c1[1], c2[1]), H: hmax };
}

export const specDims = (s) => ({ W: s.x1 - s.x0, D: s.d1 - s.d0, a: (s.d1 - s.d0) / 2, dc: (s.d0 + s.d1) / 2, H: s.H });

/* 側壁の折り目を内側に入れられるか（W ≥ 2a） */
export const creaseInward = (s) => { const { W, a } = specDims(s); return W >= 2 * a; };

/* 箱の 3D（開き角 phiDeg、180 = 平ら）。手前のページを水平（y=0・z>dc）に固定し、奥のページが背景のように起き上がる向きで返す
   （手前が起きると、途中の角度で箱がページに隠れて見えないため）。
   戻り: { faces: { front, back, left, right, roofF, roofB }（各 4 点 [x,y,z]、外から見て反時計回り）, pages: { far, near }（4 点）, gutter: [[x,y,z],[x,y,z]], creases }
   book: { width, depth } m（ページの大きさ） */
export function boxAt(spec, phiDeg, book) {
  const { W, a, dc, H } = specDims(spec);
  const alpha = Math.max(0.5, Math.min(180, phiDeg)) / 2 * Math.PI / 180;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const gamma = Math.PI / 2 - alpha, cg = Math.cos(gamma), sg = Math.sin(gamma);
  // 対称系 (y, z) → 手前のページが水平になる系（x 軸まわりに γ 回す）。x はそのまま。のどは z = dc
  const P = (x, y, z) => [x, y * cg - z * sg, dc + (y * sg + z * cg)];
  const yf = a * ca;                       // 壁の足もとの高さ（対称系）
  const inward = creaseInward(spec);
  const cx = (x, sideSign) => x + (inward ? -sideSign : sideSign) * a * ca;   // 側壁の折り目の x（sideSign: 左 = -1, 右 = +1）
  const faces = {
    front: [P(spec.x0, yf, a * sa), P(spec.x1, yf, a * sa), P(spec.x1, yf + H, a * sa), P(spec.x0, yf + H, a * sa)],
    back: [P(spec.x1, yf, -a * sa), P(spec.x0, yf, -a * sa), P(spec.x0, yf + H, -a * sa), P(spec.x1, yf + H, -a * sa)],
    roofF: [P(spec.x0, yf + H, a * sa), P(spec.x1, yf + H, a * sa), P(spec.x1, yf + H + a * ca, 0), P(spec.x0, yf + H + a * ca, 0)],
    roofB: [P(spec.x0, yf + H + a * ca, 0), P(spec.x1, yf + H + a * ca, 0), P(spec.x1, yf + H, -a * sa), P(spec.x0, yf + H, -a * sa)],
    // 側壁は 2 枚ずつ（奥半分・手前半分）
    leftB: [P(spec.x0, yf, -a * sa), P(cx(spec.x0, -1), yf, 0), P(cx(spec.x0, -1), yf + H, 0), P(spec.x0, yf + H, -a * sa)],
    leftF: [P(cx(spec.x0, -1), yf, 0), P(spec.x0, yf, a * sa), P(spec.x0, yf + H, a * sa), P(cx(spec.x0, -1), yf + H, 0)],
    rightF: [P(spec.x1, yf, a * sa), P(cx(spec.x1, +1), yf, 0), P(cx(spec.x1, +1), yf + H, 0), P(spec.x1, yf + H, a * sa)],
    rightB: [P(cx(spec.x1, +1), yf, 0), P(spec.x1, yf, -a * sa), P(spec.x1, yf + H, -a * sa), P(cx(spec.x1, +1), yf + H, 0)],
  };
  // ページ：のどを中心に、幅 book.width（x）、奥行 book.depth
  const xm = (spec.x0 + spec.x1) / 2, pw = book.width, pd = book.depth;
  const pages = {
    far: [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0), P(xm + pw / 2, pd * ca, -pd * sa), P(xm - pw / 2, pd * ca, -pd * sa)],
    near: [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0), P(xm + pw / 2, pd * ca, pd * sa), P(xm - pw / 2, pd * ca, pd * sa)],
  };
  const gutter = [P(xm - pw / 2, 0, 0), P(xm + pw / 2, 0, 0)];
  // のりしろの線（ページ上、のどから a）
  const glue = { far: [P(spec.x0, yf, -a * sa), P(spec.x1, yf, -a * sa)], near: [P(spec.x0, yf, a * sa), P(spec.x1, yf, a * sa)] };
  return { faces, pages, gutter, glue, inward, W, a, H };
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

/* 展開図を紙に収める縮尺（1/N）。net: 高さ 2t + 2H + 2a、幅 4a + W + 2t（mm） */
export function autoBoxScale(spec, paper, margin = 10, tabMm = 8) {
  const { W, a, H } = specDims(spec);
  const needH = (2 * H + 2 * a) * 1000 / (paper.height - 2 * margin - 2 * tabMm);
  const needW = (4 * a + W) * 1000 / (paper.width - 2 * margin - 2 * tabMm);
  const need = Math.max(needH, needW);
  const nice = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000];
  for (const n of nice) if (n >= need) return n;
  return Math.ceil(need / 500) * 500;
}
/* 本のページに箱がたためるか */
export function checkBook(spec, book, scaleDen, margin = 8) {
  const { W, a, H } = specDims(spec);
  const mm = (m) => m * 1000 / scaleDen;
  const issues = [];
  if (mm(2 * a + H) + margin > book.depth) issues.push(`たたんだ箱の長さ ${mm(2 * a + H).toFixed(0)}mm（2a + H）がページの奥行 ${book.depth}mm を超えます。縮尺を小さく（分母を大きく）するか、大きな本にしてください`);
  if (mm(W) + margin * 2 > book.width) issues.push(`箱の幅 ${mm(W).toFixed(0)}mm がページの幅 ${book.width}mm を超えます`);
  if (!creaseInward(spec)) issues.push(`幅 ${W.toFixed(1)}m < 奥行 ${(2 * a).toFixed(1)}m なので側壁の折り目は外折りにします（閉じたとき折り目が箱の外に出ます）`);
  return { ok: issues.filter((s) => !s.startsWith('幅')).length === 0, issues, foldedMm: mm(2 * a + H), widthMm: mm(W) };
}

const f2 = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST = {
  cut: 'stroke="#000" stroke-width="0.3"',
  mountain: 'stroke="#c0392b" stroke-width="0.25" stroke-dasharray="2.2 0.9 0.5 0.9"',
  valley: 'stroke="#1f5fbf" stroke-width="0.25" stroke-dasharray="1.6 1"',
  faint: 'stroke="#999" stroke-width="0.15"',
  glue: 'fill="#f3e9c6" stroke="none"',
};

/* 展開図 SVG。opts: { paper: {width,height,name}, scaleDen, book: {name,width,depth}, prints: { front, back, left, right, top } (各 { href, w, h, h0, h1, v0, v1 })|null, title, meta, tabMm } */
export function renderBoxNet(spec, opts) {
  const { paper, scaleDen: N, book } = opts;
  const { W, a, dc, H } = specDims(spec);
  const mm = (m) => m * 1000 / N;
  const t = opts.tabMm ?? 8;
  const inward = creaseInward(spec);
  const Wm = mm(W), am = mm(a), Hm = mm(H);
  const netW = 4 * am + Wm, netH = 2 * Hm + 2 * am;
  const X0 = (paper.width - netW) / 2 + 2 * am;    // 正面の壁の左端
  const Y0 = (paper.height - netH) / 2 + 14;        // 背面の壁の上端（上に凡例ぶん寄せる）
  const out = [];
  const line = (x1, y1, x2, y2, s) => out.push(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" ${ST[s]}/>`);
  const rect = (x, y, w, h, s) => out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="none" ${ST[s]}/>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}mm" height="${paper.height}mm" viewBox="0 0 ${paper.width} ${paper.height}" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif">`);
  out.push(`<rect x="0" y="0" width="${paper.width}" height="${paper.height}" fill="#fff"/>`);
  // 面の位置（紙の上）。上から：背面の壁（逆さ）→ 屋根（奥半分）→ 棟 → 屋根（手前半分）→ 正面の壁。正面の壁の左右に側壁
  const yBack = Y0, yRoofB = Y0 + Hm, yRidge = yRoofB + am, yRoofF = yRidge, yFront = yRoofF + am, yBottom = yFront + Hm;
  const xL = X0 - 2 * am, xR = X0 + Wm + 2 * am;
  const faces = {
    back: { x: X0, y: yBack, w: Wm, h: Hm, hA: -spec.x0, hB: -spec.x1, vT: 0, vB: H, key: 'back' },
    roofB: { x: X0, y: yRoofB, w: Wm, h: am, hA: spec.x0, hB: spec.x1, vT: -spec.d0, vB: -dc, key: 'roof' },
    roofF: { x: X0, y: yRoofF, w: Wm, h: am, hA: spec.x0, hB: spec.x1, vT: -dc, vB: -spec.d1, key: 'roof' },
    front: { x: X0, y: yFront, w: Wm, h: Hm, hA: spec.x0, hB: spec.x1, vT: H, vB: 0, key: 'front' },
    left: { x: xL, y: yFront, w: 2 * am, h: Hm, hA: spec.d0, hB: spec.d1, vT: H, vB: 0, key: 'left' },
    right: { x: X0 + Wm, y: yFront, w: 2 * am, h: Hm, hA: -spec.d1, hB: -spec.d0, vT: H, vB: 0, key: 'right' },
  };
  // 画像（あれば）。<defs> に 1 回置いて、面ごとに <use> + 行列で貼る（左右・上下の反転も行列で）
  const pr = opts.prints;
  if (pr && pr.front) {
    out.push('<defs>');
    for (const k of ['front', 'back', 'left', 'right', 'top']) if (pr[k]) out.push(`<image id="bx-${k}" width="${pr[k].w}" height="${pr[k].h}" preserveAspectRatio="none" href="${pr[k].href}"/>`);
    out.push('</defs>');
    let cid = 0;
    for (const f of Object.values(faces)) {
      const p = pr[FACE_VIEW[f.key].print]; if (!p) continue;
      const sx = f.w * (p.h1 - p.h0) / (p.w * (f.hB - f.hA)), tx = f.x + f.w * (p.h0 - f.hA) / (f.hB - f.hA);
      const sy = f.h * (p.v1 - p.v0) / (p.h * (f.vT - f.vB)), ty = f.y + f.h * (f.vT - p.v1) / (f.vT - f.vB);
      const id = `bc${cid++}`;
      out.push(`<clipPath id="${id}"><rect x="${f2(f.x)}" y="${f2(f.y)}" width="${f2(f.w)}" height="${f2(f.h)}"/></clipPath>`);
      out.push(`<g clip-path="url(#${id})"><use href="#bx-${FACE_VIEW[f.key].print}" transform="matrix(${sx.toFixed(6)} 0 0 ${sy.toFixed(6)} ${f2(tx)} ${f2(ty)})"/></g>`);
    }
  }
  // のりしろ（薄い色）：正面の壁の下、背面の壁の上、側壁の外側の端
  out.push(`<rect x="${f2(X0)}" y="${f2(yBottom)}" width="${f2(Wm)}" height="${t}" ${ST.glue}/>`);
  out.push(`<rect x="${f2(X0)}" y="${f2(yBack - t)}" width="${f2(Wm)}" height="${t}" ${ST.glue}/>`);
  out.push(`<rect x="${f2(xL - t)}" y="${f2(yFront)}" width="${t}" height="${f2(Hm)}" ${ST.glue}/>`);
  out.push(`<rect x="${f2(xR)}" y="${f2(yFront)}" width="${t}" height="${f2(Hm)}" ${ST.glue}/>`);
  // 切り線（外形）
  const k = 2;   // のりしろの角の面取り
  const outline = [
    [X0, yBack - t + k], [X0 + k, yBack - t], [X0 + Wm - k, yBack - t], [X0 + Wm, yBack - t + k], [X0 + Wm, yFront],
    [xR, yFront], [xR + t - k, yFront + k], [xR + t - k, yBottom - k], [xR, yBottom], [X0 + Wm, yBottom],
    [X0 + Wm, yBottom + t - k], [X0 + Wm - k, yBottom + t], [X0 + k, yBottom + t], [X0, yBottom + t - k], [X0, yBottom],
    [xL, yBottom], [xL - t + k, yBottom - k], [xL - t + k, yFront + k], [xL, yFront], [X0, yFront], [X0, yBack - t + k],
  ];
  out.push(`<polygon points="${outline.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" fill="none" ${ST.cut}/>`);
  // 折り線（外側の面が表）
  line(X0, yBack, X0 + Wm, yBack, 'valley');            // 背面ののりしろ（内へ）
  line(X0, yRoofB, X0 + Wm, yRoofB, 'mountain');        // 背面の壁 ↔ 屋根
  line(X0, yRidge, X0 + Wm, yRidge, 'mountain');        // 棟（閉じると持ち上がる）
  line(X0, yFront, X0 + Wm, yFront, 'mountain');        // 屋根 ↔ 正面の壁
  line(X0, yBottom, X0 + Wm, yBottom, 'valley');        // 正面ののりしろ
  line(X0, yFront, X0, yBottom, 'mountain');            // 正面 ↔ 左側壁
  line(X0 + Wm, yFront, X0 + Wm, yBottom, 'mountain');  // 正面 ↔ 右側壁
  line(xL + am, yFront, xL + am, yBottom, inward ? 'valley' : 'mountain');          // 左側壁の中央（マチ）
  line(X0 + Wm + am, yFront, X0 + Wm + am, yBottom, inward ? 'valley' : 'mountain'); // 右側壁の中央
  line(xL, yFront, xL, yBottom, 'valley');              // 左側壁 ↔ のりしろ
  line(xR, yFront, xR, yBottom, 'valley');              // 右側壁 ↔ のりしろ
  // 面の名前
  out.push(`<g font-size="2.6" fill="#555" text-anchor="middle">`);
  const label = (x, y, s) => out.push(`<text x="${f2(x)}" y="${f2(y)}">${esc(s)}</text>`);
  label(X0 + Wm / 2, yBack + Hm / 2, '背面（逆さ）'); label(X0 + Wm / 2, yRoofB + am / 2 + 1, '屋根・奥'); label(X0 + Wm / 2, yRoofF + am / 2 + 1, '屋根・手前');
  label(X0 + Wm / 2, yFront + Hm / 2, '正面'); label(xL + am, yFront + Hm / 2, '左側壁（中央で折る）'); label(X0 + Wm + am, yFront + Hm / 2, '右側壁（中央で折る）');
  label(X0 + Wm / 2, yBottom + t / 2 + 1, 'のりしろ→手前のページ'); label(X0 + Wm / 2, yBack - t / 2 + 1, 'のりしろ→奥のページ');
  out.push(`</g>`);
  // 凡例・表題・貼り位置
  const ly = 6;
  out.push(`<g font-size="3" fill="#333">`);
  out.push(`<line x1="8" y1="${ly}" x2="18" y2="${ly}" ${ST.cut}/><text x="20" y="${ly + 1}">切る</text>`);
  out.push(`<line x1="34" y1="${ly}" x2="44" y2="${ly}" ${ST.mountain}/><text x="46" y="${ly + 1}">山折り</text>`);
  out.push(`<line x1="62" y1="${ly}" x2="72" y2="${ly}" ${ST.valley}/><text x="74" y="${ly + 1}">谷折り</text>`);
  out.push(`<rect x="90" y="${ly - 1.6}" width="10" height="3.2" ${ST.glue}/><text x="102" y="${ly + 1}">のりしろ</text>`);
  out.push(`</g>`);
  const title = opts.title || '180° の箱';
  const meta = opts.meta || {};
  const lines = [
    `${title}`,
    `縮尺 1/${N}　箱 幅 ${W.toFixed(1)}m × 奥行 ${(2 * a).toFixed(1)}m × 高さ ${H.toFixed(1)}m（紙の上で ${f2(Wm)} × ${f2(2 * am)} × ${f2(Hm)}mm）　側壁の折り目 ${inward ? '内折り' : '外折り'}`,
    `本：${book.name}　のりしろの折り線を、のどから ${f2(am)}mm の位置に、手前と奥のページへ左右対称に貼る（箱の中心がのどの真上）。たたんだ長さ ${f2(2 * am + Hm)}mm ≤ ページ奥行 ${book.depth}mm`,
    `組み立て：外形を切る → 折り線を折る（表＝印刷面が外側）→ 側壁の端ののりしろを背面の壁の内側に貼って筒にする → 本を平らに開き、正面ののりしろを手前のページ、背面ののりしろを奥のページに貼る → 閉じて確かめる`,
    `${meta.gml_id ? 'gml:id ' + meta.gml_id + '　' : ''}出典：国土交通省 Project PLATEAU 3D都市モデル（建築物 LOD2）を単純化　${new Date().toISOString().slice(0, 10)}`,
  ];
  out.push(`<g font-size="2.8" fill="#333">`);
  lines.forEach((s, i) => out.push(`<text x="8" y="${f2(paper.height - 18 + i * 3.4)}" ${i === 0 ? 'font-size="4" font-weight="bold"' : ''}>${esc(s)}</text>`));
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join('\n');
}
