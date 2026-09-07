/* ─────────────────────────────────────────────────────────────────────────
   Community Evolution — every community across every time slice, at once.

   The OVERVIEW counterpart to the Ego Spiral, and a layout-based one: where a
   thing sits carries meaning.

     • each ring is a time slice, oldest at the centre, latest on the outside;
     • on each ring a community is placed at the AVERAGE ANGLE its own members
       occupied on the previous ring (its historic barycentre), so a group that
       stays together keeps its wedge from the inner ring to the outer one — a
       persistent community is a radial corridor, a split fans out from its
       parent's angle, a merge converges onto its child's;
     • each community is a round Archimedean micro-spiral of its member nodes,
       sized to the node count (ρ ∝ √n) so a 15-node group is a clearly wound
       little spiral, not a smear or a straight line; only a community too big to
       fit between the rings elongates, curving along its ring;
     • hover ANYWHERE near a community (nearest-centre pick) and the SAME
       individuals light up wherever they are in every other ring — identity, not
       a similarity threshold.

   Every dot is ONE global (refined) size, so how populous a slice looks is its
   node count, not an artefact of which ring it sits on; ring 0 is spread around
   the whole circle in Log-Hybrid order, so even a sparse dataset is balanced.

   Data is allYearsNodeData / currentSlices, already loaded for every slice.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const VB       = 800;
  /* An equal-sized community subtends an angle inversely proportional to its
     ring radius, so R_OUTER/R_INNER IS the inner-vs-outer angular distortion a
     reader sees: 3.33x here. Shrinking the centre hole to give glyphs more room
     makes that ratio worse, so these two are a trade, not free parameters.
     Was 122/350 (2.87x, large hole); 92/368 reads better still but costs 4.00x. */
  const R_INNER  = 110;
  const R_OUTER  = 366;
  /* Fraction of the inter-ring gap a glyph may fill. Few rings leave a wide gap,
     so glyphs can take more of it and the dial stops looking mostly empty. Many
     rings leave a narrow gap, and because a dot of radius dotR overhangs the band
     on both sides, the same fraction there lets neighbouring rings collide -- so
     the fraction tapers as ring count grows. */
  function bandFrac(k) {
    return Math.max(0.62, 0.78 - Math.max(0, k - 6) * (0.16 / 6));
  }
  const GAP_ANG  = 0.012;        // minimum blank between neighbouring spirals
  const PACK     = 0.55;         // areal density of dots inside a spiral
  const DOT_MIN  = 0.5;
  const DOT_MAX  = 3.0;          // refined — dots never balloon on sparse data
  const TOP      = -Math.PI / 2;

  const container = () => d3.select("#communityEvolution");
  let isOpen  = false;
  let current = null;

  /* ── helpers ─────────────────────────────────────────────────────────────*/
  function circMean(angles) {
    let sx = 0, sy = 0;
    for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
    return Math.atan2(sy, sx);
  }
  function radiusAt(i, k) {
    return k === 1 ? (R_INNER + R_OUTER) / 2 : R_INNER + i * (R_OUTER - R_INNER) / (k - 1);
  }
  function gapFor(n) { return Math.min(GAP_ANG, (Math.PI * 2 * 0.28) / Math.max(n, 1)); }
  function stateColor(type) {
    const SC = window.STATE_COLORS || {};
    return type === "incoming" ? (SC.incoming || "#0072B2")
         : type === "outgoing" ? (SC.outgoing || "#E69F00")
         : type === "outandin" ? (SC.both     || "#CC79A7")
         :                        (SC.stable   || "#8C8C8C");
  }
  const VOL_RANK = { outandin: 0, outgoing: 1, incoming: 2 };
  function volSort(ids, dict) {
    return ids.slice().sort((a, b) => {
      const ra = VOL_RANK[(dict[a] || {}).type] ?? 3, rb = VOL_RANK[(dict[b] || {}).type] ?? 3;
      return ra - rb || (a < b ? -1 : 1);
    });
  }

  // A community's spiral half-axes: round (rx = ry = ρ) when it fits between the
  // rings, elongating angularly only when ρ would cross into a neighbour ring.
  function axes(n, dotR, radHalf) {
    const area = n * Math.PI * dotR * dotR / PACK;
    const rho = Math.sqrt(area / Math.PI);
    if (rho <= radHalf) return { rx: rho, ry: rho };
    return { rx: area / (Math.PI * radHalf), ry: radHalf };
  }

  /* The glyph: a filled Archimedean spiral (r,θ ∝ √f → visible arms), fitted to
     (rx, ry) and wrapped around the ring. `turns` scales with the spiral's own
     radius, so small communities still wind ~1.5–2.5 turns and read as spirals
     rather than collapsing to a line. Members are volatility-ordered. */
  function genSpiral(ids, R, centre, rx, ry, dotR, dict) {
    const n = ids.length;
    const off = Math.max(2.5, n * 0.045);
    const denom = off + n;
    const turns = Math.max(1.25, Math.min(8, ry / (2.15 * dotR)));
    const out = [];
    for (let j = 0; j < n; j++) {
      const f = (j + off) / denom;
      const rr = Math.sqrt(f);
      const th = 2 * Math.PI * turns * rr;
      const la = Math.cos(th) * rr * rx;         // lateral offset (px)
      const lr = Math.sin(th) * rr * ry;         // radial offset (px)
      const ang = centre + la / R, rad = R + lr;
      out.push({ id: ids[j], x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
                 fill: stateColor((dict[ids[j]] || {}).type) });
    }
    return out;
  }

  /* ── model ───────────────────────────────────────────────────────────────*/
  function buildModel() {
    const labels = (window.currentSlices || []).slice();
    const k = labels.length;
    if (!k || typeof allYearsNodeData === "undefined") return null;
    const dicts = labels.map(l => allYearsNodeData[l] || {});
    const rings = dicts.map(d => {
      const m = new Map();
      for (const n of Object.keys(d)) {
        const c = d[n].community;
        if (c === undefined || c === null || Number.isNaN(c)) continue;
        if (!m.has(c)) m.set(c, new Set());
        m.get(c).add(n);
      }
      return m;
    });
    if (rings.every(m => m.size === 0)) return null;
    // per-slice community -> human label (the members' anchor_name, e.g. the
    // voting-bloc / org / house name), so widgets read "US-aligned" not "2".
    const commLabel = dicts.map(d => {
      const votes = new Map();      // community -> Map(anchor -> count)
      for (const n of Object.keys(d)) {
        const c = d[n].community, a = d[n].anchor;
        if (c === undefined || c === null || Number.isNaN(c) || !a) continue;
        if (!votes.has(c)) votes.set(c, new Map());
        const m = votes.get(c); m.set(a, (m.get(a) || 0) + 1);
      }
      const lab = new Map();
      votes.forEach((m, c) => {
        let best = null, bn = -1;
        m.forEach((v, a) => { if (v > bn) { bn = v; best = a; } });
        lab.set(c, best);
      });
      return lab;
    });
    return { labels, k, dicts, rings, commLabel };
  }
  // human label for a community in a slice (falls back to "community <id>")
  function commLabelOf(i, c) {
    const cl = current && current.model.commLabel[i];
    const l = cl && cl.get(c);
    return l || ("community " + c);
  }

  function seedOrder(i) {
    const s = window.allSliceSortedCounts && window.allSliceSortedCounts[i];
    if (!s || !s.length) return null;
    const m = new Map();
    s.forEach((r, idx) => m.set(+r.community, idx));
    return m;
  }

  /* ── isotonic (PAV) minimum-displacement placement ──────────────────────*/
  function pav(z) {
    const val = [], wt = [], cnt = [];
    for (let i = 0; i < z.length; i++) {
      let v = z[i], w = 1, c = 1;
      while (val.length && val[val.length - 1] > v) {
        const pv = val.pop(), pw = wt.pop(), pc = cnt.pop();
        v = (v * w + pv * pw) / (w + pw); w += pw; c += pc;
      }
      val.push(v); wt.push(w); cnt.push(c);
    }
    const out = [];
    for (let i = 0; i < val.length; i++) for (let j = 0; j < cnt[i]; j++) out.push(val[i]);
    return out;
  }
  function layoutRing(arr, gap) {
    const n = arr.length;
    if (!n) return;
    if (n === 1) { arr[0].centre = arr[0].target; return; }
    arr.sort((a, b) => a.target - b.target);
    let cut = 0, maxg = -1;
    for (let j = 0; j < n; j++) {
      const a = arr[j].target, b = arr[(j + 1) % n].target + (j + 1 === n ? Math.PI * 2 : 0);
      if (b - a > maxg) { maxg = b - a; cut = (j + 1) % n; }
    }
    const seq = [];
    for (let j = 0; j < n; j++) seq.push(arr[(cut + j) % n]);
    let base = seq[0].target;
    const tgt = seq.map(it => { let t = it.target; while (t < base - 1e-9) t += Math.PI * 2; base = t; return t; });
    const cum = [0];
    for (let j = 1; j < n; j++) cum.push(cum[j - 1] + (seq[j - 1].w + seq[j].w) / 2 + gap);
    const y = pav(tgt.map((t, j) => t - cum[j]));
    seq.forEach((it, j) => { it.centre = y[j] + cum[j]; });
  }

  /* Largest refined dot radius at which every ring's spirals still fit around
     the circle. Sparse datasets hit DOT_MAX (dots stay small, ring 0's spread
     fills the dial); dense datasets get a smaller dot so nothing overlaps. */
  function solveDotR(rings, k, band) {
    const radHalf = band / 2 * 0.92;
    const ringFill = (i, dotR) => {
      const R = radiusAt(i, k); let sum = 0, n = 0;
      rings[i].forEach(set => { sum += 2 * axes(set.size, dotR, radHalf).rx / R; n++; });
      return sum + n * gapFor(n);
    };
    let lo = DOT_MIN, hi = DOT_MAX;
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2;
      let ok = true;
      for (let i = 0; i < k; i++) if (ringFill(i, mid) > Math.PI * 2) { ok = false; break; }
      if (ok) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* ── placement ───────────────────────────────────────────────────────────*/
  function place(model) {
    const { rings, dicts, k } = model;
    const step = k > 1 ? (R_OUTER - R_INNER) / (k - 1) : (R_OUTER - R_INNER);
    const band = step * bandFrac(k);
    const radHalf = band / 2 * 0.92;
    const dotR = solveDotR(rings, k, band);

    const cells = new Array(k);
    let prevAngle = null;
    for (let i = 0; i < k; i++) {
      const R = radiusAt(i, k);
      const arr = [...rings[i].entries()].map(([c, set]) => {
        const ax = axes(set.size, dotR, radHalf);
        return { c, set, size: set.size, ax, w: 2 * ax.rx / R };
      });
      const baseGap = gapFor(arr.length);
      const sumW = arr.reduce((s, o) => s + o.w, 0);

      if (!prevAngle) {
        // ring 0: spread around the WHOLE circle in Log-Hybrid order, so even a
        // sparse dataset is balanced rather than piled into one arc.
        const seed = seedOrder(i);
        arr.sort((a, b) => seed ? ((seed.get(a.c) ?? 1e9) - (seed.get(b.c) ?? 1e9)) : (b.size - a.size));
        const gap = Math.max(baseGap, (Math.PI * 2 - sumW) / Math.max(arr.length, 1));
        const scale = (sumW + arr.length * gap > Math.PI * 2) ? (Math.PI * 2) / (sumW + arr.length * gap) : 1;
        let cur = TOP;
        arr.forEach(o => { o.w *= scale; o.centre = cur + o.w / 2; cur += o.w + gap * scale; });
      } else {
        const cont = [], fresh = [];
        arr.forEach(o => {
          const seen = []; o.set.forEach(n => { const a = prevAngle.get(n); if (a !== undefined) seen.push(a); });
          if (seen.length) { o.target = circMean(seen); cont.push(o); } else fresh.push(o);
        });
        if (!cont.length) {
          const seed = seedOrder(i);
          arr.sort((a, b) => seed ? ((seed.get(a.c) ?? 1e9) - (seed.get(b.c) ?? 1e9)) : (b.size - a.size));
          const gap = Math.max(baseGap, (Math.PI * 2 - sumW) / Math.max(arr.length, 1));
          let cur = TOP; arr.forEach(o => { o.centre = cur + o.w / 2; cur += o.w + gap; });
        } else {
          cont.sort((a, b) => a.target - b.target);
          fresh.sort((a, b) => b.size - a.size).forEach(o => {
            let bi = 0, bg = -1;
            for (let j = 0; j < cont.length; j++) {
              const a = cont[j].target, b = cont[(j + 1) % cont.length].target + (j + 1 === cont.length ? Math.PI * 2 : 0);
              if (b - a > bg) { bg = b - a; bi = j; }
            }
            const a = cont[bi].target, b = cont[(bi + 1) % cont.length].target + (bi + 1 === cont.length ? Math.PI * 2 : 0);
            o.target = ((a + b) / 2) % (Math.PI * 2);
            cont.splice(bi + 1, 0, o);
          });
          let gap = baseGap;
          if (sumW + arr.length * gap > Math.PI * 2) { const sc = (Math.PI * 2) / (sumW + arr.length * gap); arr.forEach(o => o.w *= sc); gap *= sc; }
          layoutRing(arr, gap);
        }
      }

      const ringCells = [];
      const angleOf = new Map();
      arr.forEach(o => {
        const centre = o.centre, a0 = centre - o.w / 2, a1 = centre + o.w / 2;
        const ids = volSort([...o.set], dicts[i]);
        const nodes = genSpiral(ids, R, centre, o.ax.rx, o.ax.ry, dotR, dicts[i]);
        ringCells.push({ c: o.c, size: o.size, members: o.set, R, a0, a1, centre, band,
                         cx: Math.cos(centre) * R, cy: Math.sin(centre) * R, nodes });
        o.set.forEach(n => angleOf.set(n, centre));
      });
      cells[i] = ringCells;
      prevAngle = angleOf;
    }
    return { cells, band, dotR };
  }

  /* ── render ──────────────────────────────────────────────────────────────*/
  function render() {
    const host = container();
    if (host.empty()) return;
    const model = buildModel();
    if (!model) { host.html('<div class="evo-empty">No community data loaded yet.</div>'); return; }
    const { labels, k } = model;
    const { cells, band, dotR } = place(model);
    const activeIdx = labels.indexOf(window.currentYearRange);

    host.html("");
    const svg = host.append("svg")
      .attr("class", "evo-svg")
      .attr("viewBox", `${-VB / 2} ${-VB / 2} ${VB} ${VB}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    // Retargeted by nameHovered() as the pointer moves — see there for why the
    // title lives on the root rather than on each dot.
    const titleEl = svg.append("title").node();
    // everything pannable/zoomable lives inside gZoom (like the main chart)
    const gZoom = svg.append("g").attr("class", "evo-zoom");
    const gRing = gZoom.append("g");
    const gDot  = gZoom.append("g").attr("class", "evo-dots");
    const gLbl  = gZoom.append("g");

    const step = k > 1 ? (R_OUTER - R_INNER) / (k - 1) : (R_OUTER - R_INNER);
    const lblPx = Math.max(6, Math.min(12, step * 0.95));
    const LV = window.LocalVolatility;
    for (let i = 0; i < k; i++) {
      const R = radiusAt(i, k), active = i === activeIdx;
      // The innermost and outermost rings sit at the edge of the observation
      // window: one side of the ±1 window does not exist there. That is a fact
      // about the RING, so it is drawn on the ring — a dashed stroke — rather
      // than repeated on every dot inside it.
      const censored = !!(LV && LV.isBoundary(i, k));
      const note = censored ? LV.censorNote(i, k) : "";
      const ring = gRing.append("circle").datum({ ring: i })
        .attr("class", "evo-ring"
              + (active ? " evo-ring--active" : "")
              + (censored ? " evo-ring--censored" : ""))
        .attr("r", R);
      if (note) ring.append("title").text(`${labels[i]} — ${note}`);
      // ring label as a real, obviously-clickable BUTTON (pill background + text)
      const gb = gLbl.append("g")
        .attr("class", "evo-ring-btn" + (active ? " evo-ring-btn--active" : "")
              + (censored ? " evo-ring-btn--censored" : ""))
        .attr("transform", `translate(0, ${-R - 3})`)
        .style("cursor", "pointer")
        .on("click", (ev) => { ev.stopPropagation(); enterSlice(labels[i]); });
      const t = gb.append("text").attr("class", "evo-ring-label")
        .attr("text-anchor", "middle").attr("dy", "0.32em")
        .style("font-size", lblPx + "px")
        .text(censored ? labels[i] + " ·" : labels[i]);
      const bb = t.node().getBBox();
      gb.insert("rect", "text").attr("class", "evo-ring-btn__bg")
        .attr("x", bb.x - 7).attr("y", bb.y - 3)
        .attr("width", bb.width + 14).attr("height", bb.height + 6)
        .attr("rx", (bb.height + 6) / 2);
      gb.append("title").text(note
        ? `Open ${labels[i]} in the main spiral — ${note}`
        : `Open ${labels[i]} in the main spiral`);
    }

    // all node dots in one data-join; dots ignore the pointer so the whole SVG
    // gets mousemove (nearest-DOT hover), not each of 30k circles.
    const allDots = [], cellMap = new Map();
    cells.forEach((ring, i) => ring.forEach(cell => {
      const key = i + ":" + cell.c;
      cellMap.set(key, cell);
      cell.nodes.forEach(nd => allDots.push({ x: nd.x, y: nd.y, fill: nd.fill, id: nd.id, key, ci: i, cc: cell.c }));
    }));
    const sel = gDot.selectAll("circle").data(allDots).join("circle")
      .attr("class", "evo-dot").attr("data-node", d => d.id).attr("data-cell", d => d.key)
      .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", dotR).style("fill", d => d.fill);

    const nodeIndex = new Map();
    sel.each(function (d) { let a = nodeIndex.get(d.id); if (!a) { a = []; nodeIndex.set(d.id, a); } a.push(this); });

    // quadtree over EVERY DOT (not community centres), so hovering anywhere over
    // a community's body — including the far edge of a big spiral — picks it up.
    const qt = d3.quadtree().x(d => d.x).y(d => d.y).addAll(allDots);
    const reach = Math.max(band, step * 0.7);
    // convert a pointer position to data coords, undoing the current pan/zoom
    const dataXY = (event) => {
      const [mx, my] = d3.pointer(event, svg.node());
      const t = d3.zoomTransform(svg.node());
      return [(mx - t.x) / t.k, (my - t.y) / t.k];
    };
    svg.on("mousemove", function (event) {
      const [dx, dy] = dataXY(event);
      const near = qt.find(dx, dy, reach);
      if (near) hoverComm(near.ci, near.cc); else clearHover();
    }).on("mouseleave", clearHover)
      .on("click", function (event) {
        const [dx, dy] = dataXY(event);
        const near = qt.find(dx, dy, reach);
        if (near) { const cell = cellMap.get(near.ci + ":" + near.cc); pickCommunity(near.ci, near.cc, [...cell.members]); }
      });

    // pan + zoom, exactly like the main chart (wheel to zoom, drag to pan)
    const zoom = d3.zoom().scaleExtent([0.5, 10])
      .on("zoom", (e) => gZoom.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);
    current = { model, cells, dotR, nodeIndex, cellMap, gDotEl: gDot.node(),
                lit: null, hoverKey: null, svg, zoom, titleEl };
    renderReadout(host, model);
    renderInspector(model);
  }

  /* ── interaction ─────────────────────────────────────────────────────────*/
  function hoverComm(i, c) {
    if (!current) return;
    const key = i + ":" + c;
    if (current.hoverKey === key) return;              // already lit — no work
    const cell = current.cellMap.get(key);
    if (!cell) return;
    if (current.lit) { for (const e of current.lit) e.classList.remove("evo-dot--lit"); }
    current.gDotEl.classList.add("evo-dots--focus");
    const lit = [];
    cell.members.forEach(id => { const els = current.nodeIndex.get(id); if (els) for (const e of els) { e.classList.add("evo-dot--lit"); lit.push(e); } });
    current.lit = lit; current.hoverKey = key;
    nameHovered(i, cell);
    describe(i, cell);
  }

  /* A community in the overview carries NO drawn text — the only labels are the
     ring periods — and the dots are pointer-transparent, so a per-circle <title>
     would never fire. Retarget one <title> on the SVG root as the hover moves:
     a plain browser tooltip naming whatever is under the cursor, independent of
     the Inspector. Without it, identifying a community requires the right-hand
     panel, and with the panel closed the overview cannot name anything it
     draws — which made "click the US-aligned bloc" unanswerable. */
  function nameHovered(i, cell) {
    if (!current || !current.titleEl) return;
    const lab = current.model.labels[i];
    current.titleEl.textContent =
      `${lab} · ${commLabelOf(i, cell.c)} — ${cell.size} members`;
  }
  // the live hover readout lives in the Inspector (right panel) in overview mode;
  // fall back to the overlay caption if the inspector element isn't present.
  /* Prefer the Inspector's readout, fall back to the overlay caption — but test
     that the Inspector one is actually ON SCREEN, not merely in the document.
     renderInspector() runs on every open and #overviewInspector lives in
     index.html unconditionally, so `.empty()` was never true and the fallback
     was dead code: with the Inspector panel hidden, every hover wrote into a
     display:none element and the overview named nothing at all. */
  function detailEl() {
    const inspector = d3.select("#overviewInspector .evo-hoverdetail");
    const node = inspector.node();
    const shown = node && (node.checkVisibility
      ? node.checkVisibility()
      : node.getClientRects().length > 0);
    return shown ? inspector : container().select(".evo-caption");
  }
  function clearHover() {
    if (!current || current.hoverKey === null) return;
    current.gDotEl && current.gDotEl.classList.remove("evo-dots--focus");
    if (current.lit) { for (const e of current.lit) e.classList.remove("evo-dot--lit"); current.lit = null; }
    current.hoverKey = null;
    if (current.titleEl) current.titleEl.textContent = "";
    const el = detailEl();
    if (!el.empty()) el.html('<span class="evo-hoverdetail__hint">Hover a community to trace it.</span>');
  }
  function describe(i, cell) {
    if (!current) return;
    const el = detailEl();
    if (el.empty()) return;
    const { model } = current;
    const M = cell.members;
    const per = model.rings.map((ring, j) => {
      if (j === i) return null;
      let present = 0; const groups = new Set();
      ring.forEach((set, cc) => set.forEach(n => { if (M.has(n)) { present++; groups.add(cc); } }));
      return { lab: model.labels[j], present, groups: groups.size };
    }).filter(x => x && x.present);
    const rows = per.map(p =>
      `<div class="evo-hd__row"><span>${p.lab}</span><b>${p.present}</b>`
      + `<span class="evo-hd__g">${p.groups} grp</span></div>`).join("");
    el.html(
      `<div class="evo-hd__title">${model.labels[i]} · ${commLabelOf(i, cell.c)}</div>`
      + `<div class="evo-hd__sub">${cell.size} members this slice</div>`
      + (rows ? `<div class="evo-hd__list"><div class="evo-hd__cap">same people elsewhere</div>${rows}</div>` : "")
      + `<div class="evo-hd__foot">Click the community to track it; click a ring's year to open that slice.</div>`);
  }

  function enterSlice(label) {
    const btn = document.querySelector('#year-buttons .ts-btn[data-slice-label="' + cssEscape(label) + '"]');
    close(); if (btn) btn.click();
  }
  function pickCommunity(i, c, memberIds) {
    if (typeof window.snapshotCommunityCohort !== "function") return;
    const label = current.model.labels[i];
    const payload = { nodeIds: memberIds.map(Number), id: `evo${label}#${c}`, label: `${label} · ${commLabelOf(i, c)}` };
    if (label === window.currentYearRange) window.snapshotCommunityCohort(null, payload);
    else {
      window.__evoPendingSnapshot = { label, payload };
      const btn = document.querySelector('#year-buttons .ts-btn[data-slice-label="' + cssEscape(label) + '"]');
      if (btn) btn.click();
    }
    close();
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* ── readout ─────────────────────────────────────────────────────────────*/
  function defaultCaption(model) {
    if (!model) return "";
    return `${model.k} slices, inner = oldest. Each community sits at the average angle `
         + `its members held the slice before, drawn as its own spiral of member dots — `
         + `every dot one node at one fixed size, so a slice's fullness is its true count. `
         + `Colour is temporal state. Hover near a community to light its members across `
         + `every slice; click to track it, or a ring's year to open that slice.`;
  }
  function renderReadout(host, model) {
    const bar = host.append("div").attr("class", "evo-bar");
    const ds = (typeof DATASETS_CONFIG !== "undefined" && window.currentDataset) ? DATASETS_CONFIG[window.currentDataset] : null;
    if ((typeof datasetHasChildren === "function") && ds && datasetHasChildren(ds)) {
      const finer = window.tsLevel !== "fine";
      bar.append("button").attr("class", "evo-gran")
        .attr("title", finer ? "Add rings: finer slices" : "Fewer rings: coarser slices")
        .text(finer ? "+ add rings" : "− fewer rings")
        .on("click", () => { if (typeof setTsLevel === "function") setTsLevel(finer ? "fine" : "coarse"); });
    }
    bar.append("button").attr("class", "evo-gran evo-gran--close").attr("title", "Close the overview").text("close").on("click", close);

    const leg = host.append("div").attr("class", "evo-legend");
    [["Stable", "stable"], ["Incoming", "incoming"], ["Outgoing", "outgoing"], ["Transient", "outandin"]]
      .forEach(([name, t]) => {
        const it = leg.append("span").attr("class", "evo-legend__item");
        it.append("span").attr("class", "evo-legend__swatch").style("background", stateColor(t));
        it.append("span").text(name);
      });
    host.append("div").attr("class", "evo-caption").html(defaultCaption(model));
  }

  /* ── Inspector panel (right bar) — trend widgets + live focus readout ─────
     In overview mode the right Inspector shows overview-specific widgets instead
     of the (irrelevant) ego/node sections: guidance, a colour legend, an
     activity-by-slice bar chart (each bar opens that slice), and a live focus
     readout that the community hover fills in. This is what tells the analyst
     the general trend and which slice is worth opening on the main chart. */
  function renderInspector(model) {
    const host = d3.select("#overviewInspector");
    if (host.empty() || !model) return;
    host.html("");

    host.append("div").attr("class", "evo-ins__guide").html(
      `Rings = time (inner oldest). Each community is a spiral of its members; `
      + `colour = temporal state. Hover a community to trace its people across every `
      + `slice; click a ring's year to open that slice on the main chart.`);

    const leg = host.append("div").attr("class", "evo-ins__legend");
    [["Stable", "stable"], ["Incoming", "incoming"], ["Outgoing", "outgoing"], ["Transient", "outandin"]]
      .forEach(([n, t]) => {
        const it = leg.append("span").attr("class", "evo-legend__item");
        it.append("span").attr("class", "evo-legend__swatch").style("background", stateColor(t));
        it.append("span").text(n);
      });

    // activity by slice (total active nodes) — the trend at a glance, clickable
    const counts = model.rings.map(m => { let s = 0; m.forEach(set => s += set.size); return s; });
    const comms = model.rings.map(m => m.size);
    const maxc = Math.max(1, ...counts);
    const activeIdx = model.labels.indexOf(window.currentYearRange);
    host.append("div").attr("class", "evo-ins__h").text("Activity by slice");
    const act = host.append("div").attr("class", "evo-act");
    counts.forEach((c, i) => {
      const row = act.append("button")
        .attr("class", "evo-act__row" + (i === activeIdx ? " evo-act__row--active" : ""))
        .attr("title", `${model.labels[i]}: ${c} people, ${comms[i]} communities — open in the main spiral`)
        .on("click", () => enterSlice(model.labels[i]));
      row.append("span").attr("class", "evo-act__lab").text(model.labels[i]);
      const bw = row.append("span").attr("class", "evo-act__barwrap");
      bw.append("span").attr("class", "evo-act__bar").style("width", (100 * c / maxc) + "%");
      row.append("span").attr("class", "evo-act__val").text(c);
    });

    host.append("div").attr("class", "evo-ins__h").text("Focus");
    host.append("div").attr("class", "evo-hoverdetail")
      .html('<span class="evo-hoverdetail__hint">Hover a community to trace it.</span>');
  }
  function clearInspector() { const h = d3.select("#overviewInspector"); if (!h.empty()) h.html(""); }

  /* ── open / close / refresh ──────────────────────────────────────────────*/
  function open() {
    const el = document.getElementById("communityEvolution");
    if (!el) return;
    el.hidden = false; isOpen = true; document.body.classList.add("evo-active"); syncToggle(); render();
  }
  function close() {
    const el = document.getElementById("communityEvolution");
    if (!el) return;
    el.hidden = true; isOpen = false; document.body.classList.remove("evo-active"); syncToggle();
    clearInspector();
  }
  function toggle() { isOpen ? close() : open(); }
  function refresh() { if (isOpen) render(); }
  function syncToggle() { const b = document.getElementById("evoToggle"); if (b) b.classList.toggle("active", isOpen); }

  function dump() {
    if (!current) return null;
    const { model, cells, dotR } = current;
    return {
      k: model.k, labels: model.labels, dotR,
      rings: cells.map(rc => rc.map(cell => ({
        c: cell.c, size: cell.size, R: cell.R, a0: cell.a0, a1: cell.a1, centre: cell.centre,
        band: cell.band, cx: cell.cx, cy: cell.cy, nodesDrawn: cell.nodes.length
      })))
    };
  }
  // test hooks — drive hover/pick without simulating a precise pointer position
  function _hoverCell(i, c) { hoverComm(i, c); }
  function _pickCell(i, c) { const cell = current && current.cellMap.get(i + ":" + c); if (cell) pickCommunity(i, c, [...cell.members]); }

  window.CommunityEvolution = { open, close, toggle, refresh, dump, _hoverCell, _pickCell, get isOpen() { return isOpen; } };

  document.addEventListener("dyn:slice-loaded", () => {
    if (window.__evoPendingSnapshot && window.__evoPendingSnapshot.label === window.currentYearRange &&
        typeof window.snapshotCommunityCohort === "function") {
      window.snapshotCommunityCohort(null, window.__evoPendingSnapshot.payload);
      window.__evoPendingSnapshot = null;
    }
    refresh();
  });

  function wireToggle() {
    const b = document.getElementById("evoToggle");
    if (b && !b.dataset.wired) { b.dataset.wired = "1"; b.addEventListener("click", toggle); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireToggle);
  else wireToggle();
})();
