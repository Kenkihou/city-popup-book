// popup — 高さ地図（simplify.js）から、90° に開くと立ち上がる「折り紙建築」式の飛び出す絵本の機構を組む。
//
//   【しくみ】1 枚の紙を谷折りの背（スパイン）で 90° に開く。背に直交する方向の切り込み 2 本で挟まれた帯（ストリップ）を
//     階段状に折ると、床（台紙）に立つ段々の立体になる。折り線はすべて背に平行。
//     開いた 90° の状態での帯の断面は、床に平行な線分（踏み面）と立て紙に平行な線分（蹴上げ）の交互の折れ線。
//     ★ どの開き角でも、踏み面は台紙に平行・蹴上げは立て紙に平行のまま動く（平行四辺形の連なり）。
//       折れ線の足もと（台紙上・背から a）から立て紙への付け根（高さ M）まで、横の合計 = a、縦の合計 = M なら成立する。
//     ★ 1 枚の紙では、帯の長さ（平らなとき a + M）が折れ線の長さに等しくなければならない。
//       → 背に向かって【下がる】段は作れない（下がる段 1 つにつき、その高さの 2 倍の紙が足りなくなる）。
//       ここでは、背に向かう途中で低くなる部分を手前の高さまで【埋める】（fillVolume に記録して設計者に知らせる）。
//
//   【座標】背に沿う方向 = u（帯の並び）、背からの距離 = d（手前が正）、高さ = h。単位 m。
//     立て紙（背）は d = 0 の面。cutDepth > 0 のときは建物の奥側を立て紙に吸収して、残りを立ち上げる。
//
//   【出力】strips: [{ u0, u1, a, M, steps: [{ d0, d1, h }] (手前→背の順。d1 < d0), poly: [[d, h], …] 折れ線（足もと→付け根）, folds: [...] }]
//     folds[k] は poly[k] の折りの種類: 'valley'（谷）か 'mountain'（山）。poly[0] は台紙との折り、最後は立て紙との折り。

export const SIDES = ['-v', '+v', '-u', '+u'];   // 背をどちらの辺に置くか（建物系で）

/* 高さ地図を、背の向きに合わせて並べ替える。
   戻り: { W (帯の並び方向の升数), D (背からの升数), get(i, j) (i: 0..W-1, j: 0..D-1 背に近い順), cell } */
export function orient(raster, side) {
  const { nu, nv, heights: H, cell } = raster;
  // 建物系の格子で、背が '-v' なら j = v の小さい側から、i = u。'+v' なら j を反転、'-u' なら i,j を入れ替え…
  const map = {
    '-v': { W: nu, D: nv, idx: (i, j) => j * nu + i },
    '+v': { W: nu, D: nv, idx: (i, j) => (nv - 1 - j) * nu + (nu - 1 - i) },
    '-u': { W: nv, D: nu, idx: (i, j) => (nv - 1 - i) * nu + j },
    '+u': { W: nv, D: nu, idx: (i, j) => i * nu + (nu - 1 - j) },
  }[side];
  return { W: map.W, D: map.D, get: (i, j) => H[map.idx(i, j)], idx: map.idx, cell, side };
}

/* 帯（ストリップ）を組む。
   opts: { side, cutDepth (背に吸収する升数), gap (建物の背面と立て紙のすきま [m]), minStripCells (これより細い帯は隣に合わせる) } */
export function buildStrips(raster, opts = {}) {
  const side = opts.side || '-v';
  const gap = Math.max(0, opts.gap || 0);
  const minStripCells = Math.max(1, Math.round(opts.minStripCells || 1));
  const o = orient(raster, side);
  const { W, D, cell } = o;
  // ⚠️ 食い込みは向きによって奥行（D）が変わる。自動で 4 方向を試すとき、別の向きで決めた値が D を超えることがあるので、ここで収める
  const cutDepth = Math.min(Math.max(0, Math.round(opts.cutDepth || 0)), Math.max(0, D - 1));
  // 列ごとの断面（背から手前へ）。cutDepth 升ぶんは立て紙に吸収（背景）
  const cols = [];
  let fillVolume = 0, volume = 0;
  const backdrop = new Float32Array(W).fill(0);   // 立て紙に描く背景（吸収した部分も含む、列ごとの最大高さ）
  for (let i = 0; i < W; i++) {
    const p = new Float32Array(D - cutDepth);
    for (let j = 0; j < D; j++) {
      const h = o.get(i, j);
      if (h > backdrop[i]) backdrop[i] = h;
      if (j >= cutDepth) p[j - cutDepth] = h;
    }
    // 背に向かって下がらないように埋める（手前から見た最大）
    const s = new Float32Array(p.length);
    let run = 0;
    for (let j = p.length - 1; j >= 0; j--) { run = Math.max(run, p[j]); s[j] = run; volume += p[j] * cell * cell; fillVolume += (run - p[j]) * cell * cell; }
    cols.push({ p, s });
  }
  // 細い帯を隣に合わせる（左右で長い方の隣の断面をコピー）
  const key = (s) => Array.from(s).join(',');
  const keys = cols.map((c) => key(c.s));
  if (minStripCells > 1) {
    let i = 0;
    while (i < W) {
      let j = i; while (j + 1 < W && keys[j + 1] === keys[i]) j++;
      const width = j - i + 1;
      if (width < minStripCells && cols[i].s.some((v) => v > 0)) {
        // 左右の隣のうち、広い方に合わせる
        const left = i > 0 ? i - 1 : -1, right = j + 1 < W ? j + 1 : -1;
        const wl = left >= 0 ? runWidth(keys, left, -1) : -1, wr = right >= 0 ? runWidth(keys, right, +1) : -1;
        const src = wl >= wr ? left : right;
        if (src >= 0) for (let k = i; k <= j; k++) { cols[k].s = cols[src].s.slice(); keys[k] = keys[src]; }
      }
      i = j + 1;
    }
  }
  // 同じ断面の列をまとめて帯にする
  const strips = [];
  let i = 0;
  while (i < W) {
    let j = i; while (j + 1 < W && keys[j + 1] === keys[i]) j++;
    const s = cols[i].s;
    if (s.some((v) => v > 0)) {
      const st = stripFromProfile(s, cell, gap);
      strips.push({ i0: i, i1: j, u0: i * cell, u1: (j + 1) * cell, ...st });
    }
    i = j + 1;
  }
  return { side, cutDepth, gap, cell, W, D, strips, backdrop, fillVolume, volume, fillRatio: volume > 0 ? fillVolume / volume : 0 };
}
function runWidth(keys, i, dir) { let n = 1; while (i + dir * n >= 0 && i + dir * n < keys.length && keys[i + dir * n] === keys[i]) n++; return n; }

/* 1 本の断面（背に近い順、下がらない）から、段と折れ線を作る */
function stripFromProfile(s, cell, gap) {
  const D = s.length;
  // 手前の空升を飛ばす（足もとの位置 a）
  let front = D - 1; while (front >= 0 && s[front] <= 0) front--;
  const a = (front + 1) * cell + gap;
  // 手前→背に段をまとめる
  const steps = [];
  let j = front;
  while (j >= 0) {
    const h = s[j]; let k = j; while (k - 1 >= 0 && s[k - 1] === h) k--;
    steps.push({ d0: (j + 1) * cell + gap, d1: k * cell + gap, h });
    j = k - 1;
  }
  // いちばん背側の段は立て紙まで（gap ぶん）伸ばす
  steps[steps.length - 1].d1 = 0;
  const M = steps[steps.length - 1].h;
  // 折れ線（d, h）：足もと → 蹴上げ ↑ → 踏み面 ← → … → 立て紙
  const poly = [[a, 0]], folds = ['valley'];
  let hPrev = 0;
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    if (st.h !== hPrev) { poly.push([st.d0, st.h]); folds.push('mountain'); }   // 蹴上げの上端（段鼻）= 山折り
    poly.push([st.d1, st.h]); folds.push('valley');                               // 踏み面の奥 = 谷折り（次の蹴上げ、または立て紙）
    hPrev = st.h;
  }
  // 平らなときの帯の長さ = a + M に等しいことを確かめる（下がる段が無いので必ず等しい）
  let len = 0; for (let k = 1; k < poly.length; k++) len += Math.abs(poly[k][0] - poly[k - 1][0]) + Math.abs(poly[k][1] - poly[k - 1][1]);
  return { a, M, steps, poly, folds, flatLength: len, ok: Math.abs(len - (a + M)) < 1e-6 };
}

/* 4 つの向きを試して、埋める体積が最小の向きを返す（同率なら帯の少ない方） */
export function chooseSide(raster, opts = {}) {
  let best = null;
  for (const side of SIDES) {
    const r = buildStrips(raster, { ...opts, side });
    const score = r.fillVolume * 1000 + r.strips.length;
    if (!best || score < best.score) best = { side, score, result: r };
  }
  return best;
}

/* 建物系の連続座標 (u, v)[m] を、絵本系 (x: 背に沿う位置, d: 背からの距離・手前が正)[m] に写す関数を返す。
   表示（元の建物・ブロック）を折れ線と同じ座標に重ねるため。cutDepth は升数 */
export function popupMapper(raster, side, cutDepth = 0, gap = 0) {
  const { nu, nv, cell } = raster;
  const off = cutDepth * cell - gap;
  return {
    '-v': (u, v) => [u, v - off],
    '+v': (u, v) => [nu * cell - u, nv * cell - v - off],
    '-u': (u, v) => [nv * cell - v, u - off],
    '+u': (u, v) => [v, nu * cell - u - off],
  }[side];
}

/* 開き角 theta[rad]（π/2 = 直角に開いた状態、π = 平ら、0 = 閉じた）での帯の 3D 折れ線。
   背は x 軸、台紙は +z（手前）に広がる。立て紙の向き e_v = (0, sin θ, cos θ)。
   戻り: [[x, y, z], …]（poly の各点に対応）。x は u の値をそのまま */
export function polyAt(poly, u, theta) {
  const sy = Math.sin(theta), cz = Math.cos(theta);
  return poly.map(([d, h]) => [u, h * sy, d + h * cz]);
}

/* 設計が紙に収まるかの確認。page: { width (背に沿う長さ mm), depthBase (台紙の奥行 mm), depthBack (立て紙の高さ mm) }, scale: 1/N */
export function checkFit(result, raster, page, scaleDen, margin = 10) {
  const mm = (m) => m * 1000 / scaleDen;
  const width = mm(result.W * result.cell);
  const aMax = Math.max(0, ...result.strips.map((s) => s.a));
  const MMax = Math.max(0, ...result.strips.map((s) => s.M));
  const issues = [];
  if (width + margin * 2 > page.width) issues.push(`建物の幅 ${width.toFixed(0)}mm が紙の幅 ${page.width}mm に収まりません`);
  if (mm(aMax) + margin > page.depthBase) issues.push(`手前への張り出し ${mm(aMax).toFixed(0)}mm が台紙の奥行 ${page.depthBase}mm を超えます`);
  if (mm(MMax) + margin > page.depthBack) issues.push(`高さ ${mm(MMax).toFixed(0)}mm が立て紙の高さ ${page.depthBack}mm を超えます`);
  const minStep = Math.min(Infinity, ...result.strips.flatMap((s) => s.steps.map((st) => st.d0 - st.d1)), ...result.strips.map((s) => s.u1 - s.u0));
  if (Number.isFinite(minStep) && mm(minStep) < 3) issues.push(`いちばん小さな段・帯が ${mm(minStep).toFixed(1)}mm と細すぎます（3mm 以上を推奨）`);
  return { ok: issues.length === 0, issues, widthMm: width, aMaxMm: mm(aMax), MMaxMm: mm(MMax) };
}

/* 紙に収まる縮尺の分母（1/N）を、よく使う値から選ぶ */
export function autoScale(result, page, margin = 10, fill = 0.8) {
  const width = result.W * result.cell;
  const aMax = Math.max(0, ...result.strips.map((s) => s.a));
  const MMax = Math.max(0, ...result.strips.map((s) => s.M));
  const need = Math.max(width * 1000 / ((page.width - 2 * margin) * fill), aMax * 1000 / ((page.depthBase - margin) * fill), MMax * 1000 / ((page.depthBack - margin) * fill));
  const nice = [100, 150, 200, 250, 300, 400, 500, 600, 750, 800, 1000, 1250, 1500, 2000, 2500, 3000];
  for (const n of nice) if (n >= need) return n;
  return Math.ceil(need / 1000) * 1000;
}
