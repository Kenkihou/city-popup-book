// pattern — 飛び出す絵本（折り紙建築式・90° カード）の設計図を SVG（単位 mm）で描く。
//
//   紙の置き方：背（谷折り）が紙の中央を横に走る。下半分が台紙（手前）、上半分が立て紙。
//   線の約束（日本の折り紙建築の本にならう）：切る = 実線、山折り = 一点鎖線、谷折り = 破線。
//   帯（ストリップ）の折り線は、足もと（台紙との折り）から立て紙への付け根まで、折れ線の長さを順に積んだ位置に引く。
//   ★ 1 枚の紙では折れ線の長さ = a + M なので、付け根はちょうど立て紙の高さ M の位置に来る（popup.js を参照）。

export const PAPERS = {
  A4: { name: 'A4（210×297）', width: 210, height: 297 },
  A3: { name: 'A3（297×420）', width: 297, height: 420 },
  B5: { name: 'B5（182×257）', width: 182, height: 257 },
  B4: { name: 'B4（257×364）', width: 257, height: 364 },
  SQ150: { name: '15cm 角（150×300 → 150×150）', width: 150, height: 300 },
  A4L: { name: 'A4 横（297×210）', width: 297, height: 210 },
};
export function pageOf(paper) { const p = PAPERS[paper] || PAPERS.A4; return { ...p, depthBase: p.height / 2, depthBack: p.height / 2 }; }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => (Math.round(v * 100) / 100).toString();

export const STYLES = {
  cut: 'stroke="#000" stroke-width="0.3"',
  mountain: 'stroke="#c0392b" stroke-width="0.25" stroke-dasharray="2.2 0.9 0.5 0.9"',
  valley: 'stroke="#1f5fbf" stroke-width="0.25" stroke-dasharray="1.6 1"',
  faint: 'stroke="#999" stroke-width="0.15"',
  ref: 'stroke="#888" stroke-width="0.2" stroke-dasharray="0.6 0.6"',
};

/* result … popup.buildStrips の戻り、opts … { paper, scaleDen, margin, title, meta, shading, backdrop, notes } */
export function renderSVG(result, opts = {}) {
  const page = pageOf(opts.paper || 'A4');
  const N = opts.scaleDen || 500;
  const mm = (m) => m * 1000 / N;
  const W = page.width, H = page.height, ys = H / 2;   // 背の y
  const widthMm = mm(result.W * result.cell);
  const xoff = (W - widthMm) / 2;
  const X = (u) => xoff + mm(u);
  const Yb = (d) => ys + mm(d);    // 台紙側（手前の奥行 d）
  const Yv = (h) => ys - mm(h);    // 立て紙側（高さ h）
  const out = [];
  const line = (x1, y1, x2, y2, style) => out.push(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" ${STYLES[style]}/>`);

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<rect x="0.2" y="0.2" width="${W - 0.4}" height="${H - 0.4}" fill="none" ${STYLES.faint}/>`);

  // 蹴上げ（鉛直面）の面を薄く塗る（折るときの目印。印刷しないときは shading=false。画像を貼るときは画像が優先）
  if (opts.shading !== false && !(opts.prints && opts.prints.front)) {
    for (const s of result.strips) {
      let t = 0; const yFoot = Yb(s.a);
      for (let k = 1; k < s.poly.length; k++) {
        const [d0, h0] = s.poly[k - 1], [d1, h1] = s.poly[k];
        const L = Math.abs(d1 - d0) + Math.abs(h1 - h0);
        const vertical = Math.abs(h1 - h0) > 1e-9;
        if (vertical) out.push(`<rect x="${f2(X(s.u0))}" y="${f2(yFoot - mm(t + L))}" width="${f2(mm(s.u1 - s.u0))}" height="${f2(mm(L))}" fill="#e9eef5" stroke="none"/>`);
        t += L;
      }
    }
  }

  // 印刷画像（opts.prints = { front: { href, x0, x1, a0, a1 }, top: { href, x0, x1, a0, a1 } }）。
  //   蹴上げ（鉛直面）には正面図、踏み面には平面図、立て紙の帯の付け根より上には正面図（吸収した奥側の立面）を貼る。
  //   画像ぜんぶを置いてから四角で切り抜く。正面図は高さ a0〜a1 を背の線（高さ 0）基準に、平面図は奥行 a0（上端・背側）〜a1。
  const pr = opts.prints;
  if (pr && pr.front && pr.top) {
    // ★ 画像は <defs> の <image> に 1 回だけ置き、面ごとに <use> + transform で参照する
    //   （面ごとに埋めると 50 面で 50 倍の大きさになった：実測 27MB。<symbol> 経由は Chrome で描かれなかったので <image> を直接参照する）
    //   切り抜きは <g clip-path> で包む（use 自身に付けると transform 後の座標系で切られてしまう）
    out.push(`<defs>`);
    for (const [id, p] of [['imgFront', pr.front], ['imgTop', pr.top]]) {
      out.push(`<image id="${id}" width="${p.w || 1000}" height="${p.h || 1000}" preserveAspectRatio="none" href="${p.href}"/>`);
    }
    out.push(`</defs>`);
    let cid = 0;
    const clipImg = (p, x, y, w, h, imgX, imgY, imgW, imgH) => {
      const id = `c${cid++}`;
      const pw = p.w || 1000, ph = p.h || 1000;
      out.push(`<clipPath id="${id}"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}"/></clipPath>`);
      out.push(`<g clip-path="url(#${id})"><use href="#${p === pr.front ? 'imgFront' : 'imgTop'}" transform="translate(${f2(imgX)} ${f2(imgY)}) scale(${(imgW / pw).toFixed(6)} ${(imgH / ph).toFixed(6)})"/></g>`);
    };
    const fw = mm(pr.front.x1 - pr.front.x0), fh = mm(pr.front.a1 - pr.front.a0);
    const tw = mm(pr.top.x1 - pr.top.x0), thh = mm(pr.top.a1 - pr.top.a0);
    for (const s of result.strips) {
      let t = 0; const yFoot = Yb(s.a), x0 = X(s.u0), w = mm(s.u1 - s.u0);
      for (let k = 1; k < s.poly.length; k++) {
        const [d0, h0] = s.poly[k - 1], [d1, h1] = s.poly[k];
        const L = Math.abs(d1 - d0) + Math.abs(h1 - h0);
        const yTop = yFoot - mm(t + L), yBot = yFoot - mm(t);   // この面の紙の上の位置（yBot が手前側）
        if (Math.abs(h1 - h0) > 1e-9) {
          // 蹴上げ：面の下端 = 高さ h0。正面図の高さ a0 の行を yBot + mm(h0 - a0) に置く
          clipImg(pr.front, x0, yTop, w, mm(L), X(pr.front.x0), yBot + mm(h0 - pr.front.a0) - fh, fw, fh);
        } else {
          // 踏み面：手前端 = 奥行 d0（yBot）。平面図の上端（奥行 a0）を yBot - mm(d0 - a0) に置く
          clipImg(pr.top, x0, yTop, w, mm(L), X(pr.top.x0), yBot - mm(d0 - pr.top.a0), tw, thh);
        }
        t += L;
      }
    }
    // 立て紙の背景（帯の付け根より上）
    if (result.backdrop) {
      const Mof = (i) => { const u = (i + 0.5) * result.cell; const s = result.strips.find((t) => t.u0 <= u && u < t.u1); return s ? s.M : 0; };
      for (let i = 0; i < result.W; i++) {
        const h = result.backdrop[i], m = Mof(i); if (h <= m) continue;
        clipImg(pr.front, X(i * result.cell), Yv(h), mm(result.cell), mm(h - m), X(pr.front.x0), ys - mm(pr.front.a0) - fh, fw, fh);
      }
    }
  }

  // 立て紙に、建物の背景（吸収した奥側や、吸収していない全体の列ごとの最大高さ）を参考線で描く
  if (opts.backdrop !== false && result.backdrop) {
    const pts = [];
    for (let i = 0; i < result.W; i++) {
      const h = result.backdrop[i];
      pts.push(`${f2(X(i * result.cell))},${f2(Yv(h))}`, `${f2(X((i + 1) * result.cell))},${f2(Yv(h))}`);
    }
    out.push(`<polyline points="${pts.join(' ')}" fill="none" ${STYLES.ref}/>`);
  }

  // 背の谷折り（帯の外側だけ）
  {
    const xs = [[0, W]];
    const covered = result.strips.map((s) => [X(s.u0), X(s.u1)]).sort((p, q) => p[0] - q[0]);
    let x = 0;
    for (const [a, b] of covered) { if (a > x) line(x, ys, a, ys, 'valley'); x = Math.max(x, b); }
    if (x < W) line(x, ys, W, ys, 'valley');
    void xs;
  }

  // 帯ごとの切り線と折り線
  for (const s of result.strips) {
    const x0 = X(s.u0), x1 = X(s.u1);
    const yTop = Yv(s.M), yBot = Yb(s.a);
    line(x0, yBot, x0, yTop, 'cut');
    line(x1, yBot, x1, yTop, 'cut');
    let t = 0;
    for (let k = 0; k < s.poly.length; k++) {
      if (k > 0) { const [d0, h0] = s.poly[k - 1], [d1, h1] = s.poly[k]; t += Math.abs(d1 - d0) + Math.abs(h1 - h0); }
      const y = yBot - mm(t);
      line(x0, y, x1, y, s.folds[k]);
    }
  }

  // 凡例（上の余白）と表題（下の余白）
  const legendY = 6;
  out.push(`<g font-size="3" fill="#333">`);
  out.push(`<line x1="8" y1="${legendY}" x2="18" y2="${legendY}" ${STYLES.cut}/><text x="20" y="${legendY + 1}">切る</text>`);
  out.push(`<line x1="34" y1="${legendY}" x2="44" y2="${legendY}" ${STYLES.mountain}/><text x="46" y="${legendY + 1}">山折り</text>`);
  out.push(`<line x1="62" y1="${legendY}" x2="72" y2="${legendY}" ${STYLES.valley}/><text x="74" y="${legendY + 1}">谷折り</text>`);
  if (pr && pr.front) out.push(`<text x="8" y="${legendY + 5}">画像：蹴上げ＝正面図（壁面）、踏み面＝平面図（屋根）、立て紙＝奥側の立面（元の建物の正射投影）</text>`);
  else out.push(`<rect x="90" y="${legendY - 1.6}" width="10" height="3.2" fill="#e9eef5"/><text x="102" y="${legendY + 1}">鉛直面（蹴上げ）</text>`);
  out.push(`<text x="${W - 8}" y="${legendY + 1}" text-anchor="end">↑ 立て紙（開くと立つ側）　　↓ 台紙（手前）</text>`);
  out.push(`</g>`);
  const title = opts.title || '飛び出す絵本の設計図';
  const meta = opts.meta || {};
  const lines = [
    `${title}`,
    `縮尺 1/${N}　升目 ${result.cell}m（紙の上で ${f2(mm(result.cell))}mm）　高さの刻み ${meta.step ?? '-'}m　帯 ${result.strips.length} 本　埋め ${(result.fillRatio * 100).toFixed(1)}%`,
    `${meta.gml_id ? 'gml:id ' + meta.gml_id + '　' : ''}${meta.lat ? '北緯 ' + meta.lat + '　東経 ' + meta.lon : ''}`,
    `出典：国土交通省 Project PLATEAU 3D都市モデル（建築物 LOD2）を単純化　${meta.date || new Date().toISOString().slice(0, 10)}`,
    `組み立て：実線を切る → 背を谷折り → 各帯を、台紙との折り（谷）・段鼻（山）・踏み面の奥（谷）の順に折る → 90° に開いて立たせる。${opts.notes || ''}`,
    `山谷はこの面が表（立ち上がって見える面）のときのもの。裏面に印刷して折るなら山谷を入れ替え、左右を反転する。点線の階段は立て紙に吸収した奥側の輪郭（参考）。`,
  ];
  out.push(`<g font-size="2.8" fill="#333">`);
  lines.forEach((t, i) => out.push(`<text x="8" y="${f2(H - 20 + i * 3.4)}" ${i === 0 ? 'font-size="4" font-weight="bold"' : ''}>${esc(t)}</text>`));
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join('\n');
}
