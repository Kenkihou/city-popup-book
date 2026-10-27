// simplify — 建物の三角形メッシュを「最低限の単純化」で、向きのそろった升目の高さ地図（ブロックの集まり）にする。
//
//   1. 向き … 水平な辺（屋根・足もとの輪郭）の方向を長さで重み付けして 90° 周期で集計し、いちばん多い方向を建物の軸にする。
//      （京都市役所のように街区にそろった建物は、ほぼ東西・南北になる）
//   2. 升目 … 軸にそろえた格子（1 升 cell[m]）に屋根を落とし、升ごとに【いちばん高い面】の高さをとる。
//      ⚠️ 升の中心が三角形に入らない小さな面も拾うため、頂点そのものも升に落とす。
//   3. 量子化 … 高さを step[m] 刻みに丸め、minHeight 未満（庇・階段・設備など）は 0 にする。
//      ついで 3×3 の多数決で孤立した升をならす（smooth 回）。
//
//   出力の座標系（建物系）: u = 軸に沿う方向、v = 軸に直交する方向、h = 高さ。u/v は格子の原点から [m]。
//   ★ three.js と Node の両方で使う。外部ライブラリに頼らない。

/* 三角形の水平な辺から建物の軸の角度 phi [rad, 0..π/2) を求める */
export function dominantAngle(positions, indices, { horizontalTol = 0.3, bins = 180 } = {}) {
  const hist = new Float64Array(bins);
  const n = indices.length;
  for (let k = 0; k < n; k += 3) {
    for (let e = 0; e < 3; e++) {
      const i0 = indices[k + e] * 3, i1 = indices[k + (e + 1) % 3] * 3;
      const dy = positions[i1 + 1] - positions[i0 + 1];
      if (Math.abs(dy) > horizontalTol) continue;
      const dx = positions[i1] - positions[i0], dz = positions[i1 + 2] - positions[i0 + 2];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      let a = Math.atan2(dz, dx);
      a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      hist[Math.floor(a / (Math.PI / 2) * bins) % bins] += len;
    }
  }
  // 円環で 3 つぶんならしてから最大を取る
  let best = 0, bestV = -1;
  for (let i = 0; i < bins; i++) {
    const v = hist[(i + bins - 1) % bins] + hist[i] + hist[(i + 1) % bins];
    if (v > bestV) { bestV = v; best = i; }
  }
  const phi = (best + 0.5) / bins * (Math.PI / 2);
  // 0° や 90° にごく近いときはぴたりとそろえる（街区にそろった建物の見栄え）
  const snap = Math.PI / 180 * 0.75;
  if (phi < snap || Math.PI / 2 - phi < snap) return 0;
  return phi;
}

/* 建物系 (u, v) と three.js 系 (x, z) の相互変換。phi は軸の角度 */
export function makeFrame(phi, u0 = 0, v0 = 0) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return {
    phi, u0, v0,
    toUV: (x, z) => [x * c + z * s - u0, -x * s + z * c - v0],
    toXZ: (u, v) => { const uu = u + u0, vv = v + v0; return [uu * c - vv * s, uu * s + vv * c]; },
  };
}

/* 高さ地図を作る。戻り: { frame, cell, nu, nv, heights(Float32Array nu*nv, 行= v, 列= u), hmax, raw } */
export function rasterize(positions, indices, { cell = 2, phi = null, minHeight = 1.5, step = 3, smooth = 1, pad = 0 } = {}) {
  if (phi == null) phi = dominantAngle(positions, indices);
  const f0 = makeFrame(phi);
  const nvert = positions.length / 3;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, ymin = Infinity;
  const UV = new Float64Array(nvert * 2);
  for (let i = 0; i < nvert; i++) {
    const [u, v] = f0.toUV(positions[i * 3], positions[i * 3 + 2]);
    UV[i * 2] = u; UV[i * 2 + 1] = v;
    if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    if (positions[i * 3 + 1] < ymin) ymin = positions[i * 3 + 1];
  }
  // 格子の原点を建物の角に置く（pad 升ぶん外側）
  const u0 = umin - pad * cell, v0 = vmin - pad * cell;
  const nu = Math.max(1, Math.ceil((umax - u0) / cell) + pad), nv = Math.max(1, Math.ceil((vmax - v0) / cell) + pad);
  const frame = makeFrame(phi, u0, v0);
  const H = new Float32Array(nu * nv).fill(0);
  const put = (i, j, h) => { if (i >= 0 && j >= 0 && i < nu && j < nv) { const k = j * nu + i; if (h > H[k]) H[k] = h; } };
  const cellOf = (u, v) => [Math.floor((u - u0) / cell), Math.floor((v - v0) / cell)];
  for (let k = 0; k < indices.length; k += 3) {
    const ia = indices[k], ib = indices[k + 1], ic = indices[k + 2];
    const ax = UV[ia * 2], ay = UV[ia * 2 + 1], bx = UV[ib * 2], by = UV[ib * 2 + 1], cx = UV[ic * 2], cy = UV[ic * 2 + 1];
    const ha = positions[ia * 3 + 1] - ymin, hb = positions[ib * 3 + 1] - ymin, hc = positions[ic * 3 + 1] - ymin;
    // 頂点を升に落とす（小さな面の取りこぼし防止）
    put(...cellOf(ax, ay), ha); put(...cellOf(bx, by), hb); put(...cellOf(cx, cy), hc);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-6) continue;   // 壁（鉛直面）は投影がつぶれるので飛ばす
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - u0) / cell)), i1 = Math.min(nu - 1, Math.floor((Math.max(ax, bx, cx) - u0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - v0) / cell)), j1 = Math.min(nv - 1, Math.floor((Math.max(ay, by, cy) - v0) / cell));
    for (let j = j0; j <= j1; j++) {
      const py = v0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = u0 + (i + 0.5) * cell;
        let l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
        let l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
        const l3 = 1 - l1 - l2;
        const eps = -1e-4;
        if (l1 < eps || l2 < eps || l3 < eps) continue;
        put(i, j, l1 * ha + l2 * hb + l3 * hc);
      }
    }
  }
  const raw = H.slice();
  // 量子化
  for (let k = 0; k < H.length; k++) {
    let h = H[k];
    if (h < minHeight) { H[k] = 0; continue; }
    h = Math.round(h / step) * step;
    H[k] = Math.max(step, h);
  }
  for (let s = 0; s < smooth; s++) modeFilter(H, nu, nv);
  let hmax = 0;
  for (let k = 0; k < H.length; k++) if (H[k] > hmax) hmax = H[k];
  return { frame, cell, nu, nv, heights: H, raw, hmax, ymin, step, minHeight };
}

/* 3×3 の多数決（同数なら自分を残す）。孤立した 1 升の飛び出しや欠けをならす */
function modeFilter(H, nu, nv) {
  const src = H.slice();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const counts = new Map();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      const v = (ii < 0 || jj < 0 || ii >= nu || jj >= nv) ? 0 : src[jj * nu + ii];
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const me = src[j * nu + i];
    let best = me, bestN = counts.get(me) || 0;
    for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
    H[j * nu + i] = best;
  }
}

/* 高さ地図を、同じ高さの長方形のブロック [{ i0, i1, j0, j1, h }]（升の番号・両端含む）に分ける（貪欲）。表示用 */
export function toBlocks(raster) {
  const { nu, nv, heights: H } = raster;
  const used = new Uint8Array(nu * nv);
  const blocks = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = j * nu + i;
    if (used[k] || H[k] <= 0) continue;
    const h = H[k];
    let i1 = i;
    while (i1 + 1 < nu && !used[j * nu + i1 + 1] && H[j * nu + i1 + 1] === h) i1++;
    let j1 = j;
    outer: while (j1 + 1 < nv) {
      for (let ii = i; ii <= i1; ii++) { const kk = (j1 + 1) * nu + ii; if (used[kk] || H[kk] !== h) break outer; }
      j1++;
    }
    for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) used[jj * nu + ii] = 1;
    blocks.push({ i0: i, i1, j0: j, j1, h });
  }
  return blocks;
}
