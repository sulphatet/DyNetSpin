/* ─────────────────────────────────────────────────────────────────────────
   Compare Mode: area-proportional Euler comparison of 2–3 time slices.

   Shift-click 2–3 chips in the time strip. Each node appears exactly once,
   grouped by WHEN it was present (its presence signature across the selected
   slices); inside every group, nodes cluster by their COMMUNITY LINEAGE, so
   "which nodes belonged to which community at which time" stays readable.
   Conceptually this generalises Local Volatility: the four volatility states
   are the same partition computed on the (t−1, t, t+1) window.

   Geometry is derived from the data, not hardcoded:
   • Circle areas are proportional to slice size (r ∝ √n).
   • Overlap areas are fitted to the number of nodes actually in each region —
     exactly for k=2 (bisection on the circle-circle lens area), numerically
     for k=3 (Nelder–Mead on a venneuler-style area stress). Three-set Euler
     diagrams are not always exactly realisable, so the achieved fit is
     reported in the banner rather than silently implied.
   • Each region's spiral origin and reach budget come from its true geometry
     (largest inscribed circle of the sampled region), so glyphs cannot spill
     across a boundary.

   Community lineages: communities are matched across the selected slices by
   Jaccard overlap. Only 1-to-1 continuations are merged into one lineage, so
   a SPLIT or MERGE stays visible as a lineage boundary rather than being
   silently absorbed. A community that simply persists is one glyph; one that
   breaks becomes sibling glyphs joined by a lineage link.

   Chrome is hover-only. Nothing rings a community at rest. Hovering a NODE
   draws unobtrusive dashed rings around every lineage fragment that node
   passed through — one ring means its community held, several mean it broke
   across time — with dashed connectors in temporal order.

   Backward compatibility contract:
   • Node hover feeds the same Inspector as the normal view (Node History
     chart + Node Metadata) and uses the app's floating tooltip.
   • Cohort Tracker highlights (globalHighlightNodesMap) render here too,
     so a frozen cohort stays visible across the comparison.
   • The α slider / colour encodings / Labels toggle apply to the
     single-slice spiral only → the encoding bar is visually disabled while
     comparing; any normal action (chip click, encoding change) repaints
     the regular spiral and this module cleans up after itself.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const MAX_K = 3;

  // Two communities in consecutive slices are the same lineage when their
  // membership Jaccard clears this. Below it they are treated as unrelated.
  const JACCARD_TAU = 0.30;

  // Nominal layout box. SpinTrixMainZoom.fitAll() rescales to the viewport,
  // so these are units of composition, not pixels.
  const LAYOUT_W = 1200, LAYOUT_H = 700;

  const GRID_N_FIT   = 96;    // coarse sampling during the Euler optimisation
  const GRID_N_FINAL = 260;   // fine sampling for region geometry
  const ZONE_FILL    = 0.42;  // share of a region's area its glyphs may occupy
  const NODE_PICK_R  = 8;     // hover pick radius, layout units

  let selected = [];          // [{label, dir, seq}] in chronological chip order
  let active   = false;
  let seqCounter = 0;

  /* ── selection (called from the time-strip chip click handler) ─────────── */
  function toggle(label, dir) {
    const i = selected.findIndex(s => s.label === label);
    if (i >= 0) selected.splice(i, 1);
    else {
      // A fourth pick replaces the slice chosen longest ago rather than
      // refusing outright — beyond three, Euler regions stop being readable.
      if (selected.length >= MAX_K) {
        let oldest = 0;
        selected.forEach((s, idx) => { if (s.seq < selected[oldest].seq) oldest = idx; });
        selected.splice(oldest, 1);
      }
      selected.push({ label, dir, seq: seqCounter++ });
    }

    const order = window.currentSlices || [];
    selected.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    markChips();

    if (selected.length >= 2) render();
    else if (selected.length === 1) {
      showBanner(`Comparing: <b>${selected[0].label}</b> — shift-click 1–2 more slices.`, false);
    } else exitToNormal();
  }

  function markChips() {
    document.querySelectorAll("#year-buttons .ts-btn").forEach(btn => {
      const on = selected.some(s => s.label === btn.dataset.sliceLabel);
      btn.classList.toggle("ts-btn--compare", on);
    });
  }

  // Called from draw_spiral_community(): any normal repaint dismisses us.
  function reset() {
    detachHover();
    if (!active && !selected.length) return;
    active = false;
    selected = [];
    markChips();
    removeBanner();
    setEncodingBarDisabled(false);
    if (window.EgoSpiral) window.EgoSpiral.clear();
  }

  function exitToNormal() {
    reset();
    const btn = document.querySelector("#year-buttons .ts-btn.active")
             || document.querySelector("#year-buttons .ts-btn");
    if (btn) btn.click();
  }

  function setEncodingBarDisabled(on) {
    document.getElementById("encodingBar")
      ?.classList.toggle("encoding-bar--compare-disabled", !!on);
  }

  /* ── plain-language region descriptions ─────────────────────────────────────
     Wording is presence-explicit. The old phrasing ("Left after 2015") implied
     an absence that was never checked — with non-adjacent picks like
     2010/2015/2020 the node may well have been present in 2016. */
  function describeRegion(sig, labels, k) {
    const contiguous = sig.every((v, i) => i === 0 || v === sig[i - 1] + 1);
    if (sig.length === k) return { text: k === 2 ? "In both" : `In all ${k}`, kind: "core" };
    if (!contiguous)
      return { text: `Only ${sig.map(i => labels[i]).join(" & ")}`, kind: "gap" };
    if (sig.length === 1)
      return { text: `Only ${labels[sig[0]]}`,
               kind: sig[0] === 0 ? "left" : (sig[0] === k - 1 ? "joined" : "gap") };
    // Slice labels are themselves ranges ("2000-2004"), so an en-dash between
    // two of them is unreadable — use an arrow.
    const a = labels[sig[0]], b = labels[sig[sig.length - 1]];
    if (sig[0] === 0)                  return { text: `Only ${a} → ${b}`, kind: "left" };
    if (sig[sig.length - 1] === k - 1) return { text: `From ${a} on`,     kind: "joined" };
    return { text: `Only ${a} → ${b}`, kind: "gap" };
  }

  function classColor(kind) {
    const SC = window.STATE_COLORS || {};
    return { core: SC.stable || "#8C8C8C", left: SC.outgoing || "#E69F00",
             joined: SC.incoming || "#0072B2", gap: SC.both || "#CC79A7" }[kind];
  }

  function presenceText(sig, labels) {
    return sig.map(i => labels[i]).join(", ");
  }

  /* ── banner ─────────────────────────────────────────────────────────────── */
  function ensureBanner() {
    let el = document.getElementById("compareBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "compareBanner";
      el.className = "compare-banner";
      (document.querySelector(".stage") || document.body).appendChild(el);
    }
    return el;
  }
  function showBanner(html, withLegend) {
    const SC = window.STATE_COLORS || {};
    const legend = withLegend ? `
      <span class="cb-leg"><i style="background:${SC.stable}"></i>Stayed</span>
      <span class="cb-leg"><i style="background:${SC.outgoing}"></i>Left early</span>
      <span class="cb-leg"><i style="background:${SC.incoming}"></i>Joined later</span>
      <span class="cb-leg"><i style="background:${SC.both}"></i>Left &amp; returned</span>` : "";
    ensureBanner().innerHTML =
      `<span class="cb-text">${html}</span>${legend}
       <button class="cb-exit" type="button" title="Exit comparison">✕</button>`;
    ensureBanner().querySelector(".cb-exit").onclick = exitToNormal;
  }
  function flashBanner(msg) {
    const el = ensureBanner();
    const t = el.querySelector(".cb-text");
    if (t) { const old = t.innerHTML; t.innerHTML = msg; setTimeout(() => { t.innerHTML = old; }, 2200); }
  }
  function removeBanner() { document.getElementById("compareBanner")?.remove(); }

  /* ═══ Euler geometry ═══════════════════════════════════════════════════════ */

  function clamp1(v) { return Math.max(-1, Math.min(1, v)); }

  // Exact area of the lens formed by two overlapping circles.
  function lensArea(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
    const a1 = Math.acos(clamp1((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
    const a2 = Math.acos(clamp1((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
    const tri = 0.5 * Math.sqrt(Math.max(0,
      (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
    return r1 * r1 * a1 + r2 * r2 * a2 - tri;
  }

  // Lens area decreases monotonically in centre distance, so bisection is exact.
  function solveTwo(r1, r2, targetLens) {
    let lo = Math.abs(r1 - r2), hi = r1 + r2;
    if (targetLens <= 0) return hi;
    if (targetLens >= Math.PI * Math.min(r1, r2) ** 2) return lo;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (lensArea(r1, r2, mid) > targetLens) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function bitsToKey(bits, k) {
    const out = [];
    for (let i = 0; i < k; i++) if (bits & (1 << i)) out.push(i);
    return out.join(",");
  }

  /* Classify a regular grid over the circles' bounding box. Every sample falls
     in exactly one region (or outside the union), so region areas, centroids
     and inscribed circles all fall out of one pass. */
  function measureZones(circles, N, keepSamples) {
    const k = circles.length;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    circles.forEach(c => {
      minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
    });
    const stepX = (maxX - minX) / N, stepY = (maxY - minY) / N;
    const counts = new Map(), samples = keepSamples ? new Map() : null;
    for (let iy = 0; iy < N; iy++) {
      const py = minY + (iy + 0.5) * stepY;
      for (let ix = 0; ix < N; ix++) {
        const px = minX + (ix + 0.5) * stepX;
        let bits = 0;
        for (let i = 0; i < k; i++) {
          const dx = px - circles[i].x, dy = py - circles[i].y;
          if (dx * dx + dy * dy <= circles[i].r * circles[i].r) bits |= (1 << i);
        }
        if (!bits) continue;
        const key = bitsToKey(bits, k);
        counts.set(key, (counts.get(key) || 0) + 1);
        if (samples) {
          if (!samples.has(key)) samples.set(key, []);
          samples.get(key).push(px, py);
        }
      }
    }
    return { counts, samples, cellArea: stepX * stepY };
  }

  /* venneuler-style loss: squared difference between each region's share of
     the drawn area and its share of the nodes. Regions the data never
     populates are penalised so the optimiser closes them. */
  function eulerStress(circles, targets, totalTarget, N) {
    const { counts } = measureZones(circles, N);
    let totalCount = 0;
    counts.forEach(v => { totalCount += v; });
    if (!totalCount) return 1e6;
    let s = 0;
    targets.forEach((t, key) => {
      const got = (counts.get(key) || 0) / totalCount;
      const want = t / totalTarget;
      s += (got - want) * (got - want);
    });
    counts.forEach((v, key) => {
      if (!targets.has(key)) { const got = v / totalCount; s += got * got; }
    });
    return s;
  }

  function nelderMead(f, x0, step, iters) {
    const n = x0.length;
    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; simplex.push(p); }
    let val = simplex.map(f);
    for (let it = 0; it < iters; it++) {
      const order = val.map((v, i) => i).sort((a, b) => val[a] - val[b]);
      simplex = order.map(i => simplex[i]);
      val     = order.map(i => val[i]);
      const centroid = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
      const worst = simplex[n];
      const refl = centroid.map((c, j) => c + (c - worst[j]));
      const fr = f(refl);
      if (fr < val[0]) {
        const exp = centroid.map((c, j) => c + 2 * (c - worst[j]));
        const fe = f(exp);
        if (fe < fr) { simplex[n] = exp;  val[n] = fe; }
        else         { simplex[n] = refl; val[n] = fr; }
      } else if (fr < val[n - 1]) {
        simplex[n] = refl; val[n] = fr;
      } else {
        const con = centroid.map((c, j) => c + 0.5 * (worst[j] - c));
        const fc = f(con);
        if (fc < val[n]) { simplex[n] = con; val[n] = fc; }
        else {
          for (let i = 1; i <= n; i++) {
            simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
            val[i] = f(simplex[i]);
          }
        }
      }
    }
    let bi = 0;
    for (let i = 1; i <= n; i++) if (val[i] < val[bi]) bi = i;
    return { x: simplex[bi], f: val[bi] };
  }

  /* Replaces the old hardcoded scaffold(): radii and centres now both follow
     from the data. Returns circles in layout coordinates plus a 0–1 fit. */
  function solveEuler(k, sliceCounts, zoneCounts) {
    const maxN = Math.max(...sliceCounts, 1);
    const baseR = Math.min(LAYOUT_W, LAYOUT_H) * 0.30;
    // area ∝ node count  ⇒  radius ∝ √(node count)
    const radii = sliceCounts.map(n =>
      Math.max(baseR * 0.20, baseR * Math.sqrt(Math.max(n, 1) / maxN)));

    let total = 0;
    zoneCounts.forEach(v => { total += v; });

    let circles, fit;
    if (k === 2) {
      // lens / union = p  ⇒  lens = p·(A₁+A₂)/(1+p). Solved exactly.
      const p = (zoneCounts.get("0,1") || 0) / Math.max(total, 1);
      const A = Math.PI * (radii[0] ** 2 + radii[1] ** 2);
      const d = solveTwo(radii[0], radii[1], p * A / (1 + p));
      circles = [{ x: 0, y: 0, r: radii[0] }, { x: d, y: 0, r: radii[1] }];
      fit = 1;
    } else {
      // Canonical frame: c₀ at the origin, c₁ on +x. Three free parameters.
      const f = (p) => eulerStress([
        { x: 0,    y: 0,    r: radii[0] },
        { x: p[0], y: 0,    r: radii[1] },
        { x: p[1], y: p[2], r: radii[2] }
      ], zoneCounts, total, GRID_N_FIT);

      const side = baseR * 1.04;                    // ≈ the old equilateral start
      const init = [side, side * 0.5, side * 0.866];
      const res = nelderMead(f, init, [side * 0.25, side * 0.25, side * 0.25], 220);
      const p = res.x;
      circles = [{ x: 0,    y: 0,    r: radii[0] },
                 { x: p[0], y: 0,    r: radii[1] },
                 { x: p[1], y: p[2], r: radii[2] }];
      fit = Math.max(0, Math.min(1, 1 - Math.sqrt(Math.max(res.f, 0))));
    }

    // Centre the configuration in the layout box.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    circles.forEach(c => {
      minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
    });
    const pad = 80;
    const s = Math.min((LAYOUT_W - 2 * pad) / Math.max(maxX - minX, 1),
                       (LAYOUT_H - 2 * pad) / Math.max(maxY - minY, 1));
    const ox = LAYOUT_W / 2 - ((minX + maxX) / 2) * s;
    const oy = LAYOUT_H / 2 - ((minY + maxY) / 2) * s;
    return {
      circles: circles.map(c => ({ x: c.x * s + ox, y: c.y * s + oy, r: c.r * s })),
      fit
    };
  }

  /* Per-region geometry from one fine sampling pass: area, centroid, and the
     largest inscribed circle (origin + reach budget for that region's spiral).
     This is what replaces the old hardcoded R*0.34 / R*0.55 / R*0.22 budgets. */
  function zoneGeometry(circles, N) {
    const { samples, cellArea } = measureZones(circles, N, true);
    const geo = new Map();
    samples.forEach((flat, key) => {
      const n = flat.length / 2;
      let sx = 0, sy = 0, bestClear = -Infinity, bx = 0, by = 0;
      for (let i = 0; i < n; i++) {
        const px = flat[2 * i], py = flat[2 * i + 1];
        sx += px; sy += py;
        let clear = Infinity;
        for (let j = 0; j < circles.length; j++) {
          const d = Math.hypot(px - circles[j].x, py - circles[j].y);
          clear = Math.min(clear, Math.abs(d - circles[j].r));
        }
        if (clear > bestClear) { bestClear = clear; bx = px; by = py; }
      }
      geo.set(key, {
        area: n * cellArea,
        centroid: [sx / n, sy / n],
        origin: [bx, by],
        avail: Math.max(bestClear, 6)
      });
    });
    return geo;
  }

  // Fallback anchor for a region the sampler never hit (too thin to catch).
  function regionAnchor(sig, circles) {
    const pts = sig.map(i => [circles[i].x, circles[i].y]);
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const gx = circles.reduce((s, c) => s + c.x, 0) / circles.length;
    const gy = circles.reduce((s, c) => s + c.y, 0) / circles.length;
    if (sig.length === circles.length) return [gx, gy];
    if (sig.length === 1) return [mx + (mx - gx) * 0.8, my + (my - gy) * 0.8];
    const other = circles.filter((_, i) => !sig.includes(i))[0];
    return [mx + (mx - other.x) * 0.28, my + (my - other.y) * 0.28];
  }

  /* ═══ community lineages ═══════════════════════════════════════════════════
     Community ids are NOT stable across slices, so they are matched by
     membership. Crucially, only 1-to-1 continuations are unioned: where a
     community splits in two or two merge into one, the lineage deliberately
     ENDS, so the break is representable instead of being averaged away. */
  function buildLineages(dicts, k) {
    const key = (i, c) => i + ":" + c;

    const sets = dicts.map(d => {
      const m = new Map();
      Object.keys(d).forEach(n => {
        const c = d[n].community;
        if (c === undefined || c === null || Number.isNaN(c)) return;
        if (!m.has(c)) m.set(c, new Set());
        m.get(c).add(n);
      });
      return m;
    });

    const parent = new Map();
    sets.forEach((m, i) => m.forEach((_, c) => parent.set(key(i, c), key(i, c))));
    function find(x) {
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent.set(b, a); }

    const links = [];
    for (let i = 0; i + 1 < k; i++) {
      sets[i].forEach((A, ca) => {
        sets[i + 1].forEach((B, cb) => {
          let inter = 0;
          const [small, big] = A.size <= B.size ? [A, B] : [B, A];
          small.forEach(n => { if (big.has(n)) inter++; });
          if (!inter) return;
          const j = inter / (A.size + B.size - inter);
          if (j >= JACCARD_TAU) links.push({ a: key(i, ca), b: key(i + 1, cb), j });
        });
      });
    }

    const fwd = new Map(), bwd = new Map();
    links.forEach(l => {
      fwd.set(l.a, (fwd.get(l.a) || 0) + 1);
      bwd.set(l.b, (bwd.get(l.b) || 0) + 1);
    });
    links.forEach(l => { if (fwd.get(l.a) === 1 && bwd.get(l.b) === 1) union(l.a, l.b); });

    // Whatever survives unmerged is a real structural break.
    const relations = [];
    links.forEach(l => {
      const la = find(l.a), lb = find(l.b);
      if (la === lb) return;
      relations.push({ from: la, to: lb, j: l.j,
                       kind: fwd.get(l.a) > 1 ? "split" : "merge" });
    });

    // A "family" is a lineage plus everything it split into or merged with —
    // used for a shared hue and for community-hover kinship.
    const fam = new Map();
    parent.forEach((_, x) => { const r = find(x); fam.set(r, r); });
    function ffind(x) {
      if (!fam.has(x)) return x;
      while (fam.get(x) !== x) { fam.set(x, fam.get(fam.get(x))); x = fam.get(x); }
      return x;
    }
    relations.forEach(r => {
      const a = ffind(r.from), b = ffind(r.to);
      if (a !== b) fam.set(b, a);
    });

    return {
      has:       (i, c) => parent.has(key(i, c)),
      lineageOf: (i, c) => (parent.has(key(i, c)) ? find(key(i, c)) : null),
      familyOf:  (lin)  => ffind(lin),
      relations
    };
  }

  /* ═══ glyphs ═══════════════════════════════════════════════════════════════ */

  function buildGlyphs(sigOf, dicts, labels, lin, anchors) {
    const byLin = new Map();
    sigOf.forEach((sig, n) => {
      const refIdx = sig[sig.length - 1];
      const comm = dicts[refIdx][n]?.community;
      const lineage = lin.has(refIdx, comm) ? lin.lineageOf(refIdx, comm)
                                            : ("unassigned:" + refIdx);
      if (!byLin.has(lineage))
        byLin.set(lineage, { lin: lineage, refIdx, comm, members: [] });
      byLin.get(lineage).members.push({ node: n, sig, sigKey: sig.join(",") });
    });

    const glyphs = [];
    byLin.forEach(g => {
      const counts = {};
      g.members.forEach(m => { counts[m.sigKey] = (counts[m.sigKey] || 0) + 1; });

      // Mixture centroid: where the glyph belongs given how its members are
      // spread across regions. Pure glyphs land on their region, mixed ones
      // between regions — i.e. on the boundary they straddle.
      let tx = 0, ty = 0, dom = null, domN = -1;
      Object.entries(counts).forEach(([key, c]) => {
        const a = anchors.get(key) || [LAYOUT_W / 2, LAYOUT_H / 2];
        tx += a[0] * c; ty += a[1] * c;
        if (c > domN) { domN = c; dom = key; }
      });

      const n = g.members.length;
      const slices = new Set();
      g.members.forEach(m => m.sig.forEach(i => slices.add(i)));

      const refDict = dicts[g.refIdx];
      const anchorName = g.members.map(m => refDict[m.node]?.anchor)
                                  .find(v => v && v !== "undefined");
      glyphs.push({
        ...g, n, counts, slices,
        target: [tx / n, ty / n],
        dom,
        R0: Math.max(6, Math.sqrt(n) * 3.2),
        R:  Math.max(6, Math.sqrt(n) * 3.2),
        // `name` alone for contexts that already state the slice
        name:  anchorName || ("C" + g.comm),
        title: `${anchorName || ("C" + g.comm)} (${labels[g.refIdx]})`
      });
    });
    return glyphs;
  }

  /* Glyphs are laid out along each region's Archimedean walk — the same
     construction as the main view's macro layout — then pulled toward their
     mixture centroid in proportion to how mixed they are, then relaxed so
     nothing overlaps and nothing escapes the diagram. */
  function placeGlyphs(glyphs, anchors, circles, geo) {
    const zones = new Map();
    glyphs.forEach(gl => {
      if (!zones.has(gl.dom)) zones.set(gl.dom, []);
      zones.get(gl.dom).push(gl);
    });

    zones.forEach((list, zoneKey) => {
      const z = geo.get(zoneKey);
      const origin = z ? z.origin : (anchors.get(zoneKey) || [LAYOUT_W / 2, LAYOUT_H / 2]);
      const avail  = z ? z.avail : 30;
      const zArea  = z ? z.area  : Math.PI * avail * avail;

      // Scale glyphs to a fixed share of the region they live in. This is what
      // makes the view adapt: a crowded region shrinks its glyphs, a sparse one
      // grows them, instead of the old fixed [0.6, 3.0] clamp that let dense
      // regions overflow.
      const rawArea = list.reduce((s, gl) => s + Math.PI * gl.R0 * gl.R0, 0);
      let gs = Math.sqrt((ZONE_FILL * zArea) / Math.max(rawArea, 1));
      gs = Math.max(0.30, Math.min(gs, 2.4));
      list.forEach(gl => { gl.R = Math.max(3.2, gl.R0 * gs); });

      list.forEach(gl => { gl.purity = (gl.counts[zoneKey] || 0) / gl.n; });
      list.sort((a, b) => (b.purity - a.purity) || (a.n - b.n));

      const PAD = 6;
      const maxR = Math.max(...list.map(g => g.R));
      const rho = (2 * maxR + PAD) / (2 * Math.PI);
      const pos = [];
      let theta = 0, extent = list[0] ? list[0].R : 0;
      list.forEach((gl, i) => {
        if (i === 0) { pos.push([0, 0]); return; }
        const step = list[i - 1].R + gl.R + PAD;
        const rMin = list[0].R + gl.R + PAD;
        theta += step / Math.max(rho * theta, rMin);
        const r = Math.max(rho * theta, rMin);
        pos.push([Math.cos(theta) * r, Math.sin(theta) * r]);
        extent = Math.max(extent, r + gl.R);
      });
      const s = Math.min(1, avail / Math.max(extent, 1));

      list.forEach((gl, i) => {
        const sx = origin[0] + pos[i][0] * s;
        const sy = origin[1] + pos[i][1] * s;
        const w = Math.min(0.65, 1 - gl.purity);   // mixed ⇒ pulled to the boundary
        gl.x = sx + (gl.target[0] - sx) * w;
        gl.y = sy + (gl.target[1] - sy) * w;
      });
    });

    relaxGlyphs(glyphs, circles);
  }

  /* Keeps a glyph inside the union of the circles its members actually occupy,
     so a boundary-straddling glyph may sit on the line but never outside the
     diagram. */
  function containWithin(glyphs, circles) {
    function force() {
      glyphs.forEach(gl => {
        let best = null, bestDepth = -Infinity;
        gl.slices.forEach(i => {
          const c = circles[i];
          if (!c) return;
          const dx = gl.x - c.x, dy = gl.y - c.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const depth = (c.r - gl.R * 0.85) - d;
          if (depth > bestDepth) { bestDepth = depth; best = { c, d, dx, dy }; }
        });
        if (!best || bestDepth >= 0) return;
        const lim = Math.max(best.c.r - gl.R * 0.85, 1);
        const t = lim / best.d;
        gl.x = best.c.x + best.dx * t;
        gl.y = best.c.y + best.dy * t;
        gl.vx = 0; gl.vy = 0;
      });
    }
    force.initialize = () => {};
    return force;
  }

  function relaxGlyphs(glyphs, circles) {
    if (!glyphs.length) return;
    glyphs.forEach(gl => { gl.x0 = gl.x; gl.y0 = gl.y; });
    const sim = d3.forceSimulation(glyphs)
      .force("collide", d3.forceCollide(d => d.R + 3).strength(0.9).iterations(3))
      .force("x", d3.forceX(d => d.x0).strength(0.06))
      .force("y", d3.forceY(d => d.y0).strength(0.06))
      .force("contain", containWithin(glyphs, circles))
      .stop();
    for (let i = 0; i < 160; i++) sim.tick();
  }

  // Members inside a glyph: persistent core first, then joiners/leavers on
  // the rim; within each class by degree, descending.
  function classRank(sig, k) {
    if (sig.length === k) return 0;                             // persistent core
    const contiguous = sig.every((v, i) => i === 0 || v === sig[i - 1] + 1);
    if (contiguous && sig[sig.length - 1] === k - 1) return 1;  // joined
    if (contiguous && sig[0] === 0) return 2;                   // left
    return 3;                                                   // gapped
  }

  /* ── Inspector / tooltip integration ────────────────────────────────────── */
  function moveTip(event, html) {
    const tip = window.div;
    if (!tip || !tip.transition) return;
    tip.transition().duration(120).style("opacity", .9);
    if (html) tip.html(html);
    tip.style("left", (event.pageX) + "px")
       .style("top",  (event.pageY - 28) + "px")
       .style("text-align", "left");
  }
  function hoverOut() {
    const tip = window.div;
    if (tip && tip.transition) tip.transition().duration(250).style("opacity", 0);
  }

  /* ── hover teardown (module-level so reset() can reach it) ───────────────── */
  let detachHover = () => {};

  /* ═══ render ═══════════════════════════════════════════════════════════════ */
  function render() {
    const data = typeof allYearsNodeData !== "undefined" ? allYearsNodeData : null;
    if (!data) return;
    const labels = selected.map(s => s.label);
    const k = labels.length;
    const dicts = labels.map(l => data[l] || {});
    if (dicts.some(d => !Object.keys(d).length)) {
      flashBanner("Slice data still loading — try again in a moment.");
      return;
    }

    /* presence signatures + the counts that drive the geometry */
    const sigOf = new Map();
    dicts.forEach((d, i) => {
      Object.keys(d).forEach(n => {
        if (!sigOf.has(n)) sigOf.set(n, []);
        sigOf.get(n).push(i);
      });
    });
    const zoneCounts = new Map();
    const sliceCounts = new Array(k).fill(0);
    sigOf.forEach(sig => {
      const key = sig.join(",");
      zoneCounts.set(key, (zoneCounts.get(key) || 0) + 1);
      sig.forEach(i => { sliceCounts[i]++; });
    });

    if (typeof ensureBrushSkeleton === "function") ensureBrushSkeleton();
    const G = window.g;
    if (!G) return;
    detachHover();
    active = true;
    setEncodingBarDisabled(true);
    G.selectAll("*").remove();

    const { circles, fit } = solveEuler(k, sliceCounts, zoneCounts);
    const geo = zoneGeometry(circles, GRID_N_FINAL);
    const lin = buildLineages(dicts, k);

    const anchors = new Map();
    zoneCounts.forEach((_, key) => {
      const z = geo.get(key);
      anchors.set(key, z ? z.centroid : regionAnchor(key.split(",").map(Number), circles));
    });

    const glyphs = buildGlyphs(sigOf, dicts, labels, lin, anchors);
    placeGlyphs(glyphs, anchors, circles, geo);
    const glyphByLin = new Map(glyphs.map(gl => [gl.lin, gl]));

    /* explicit paint order — rings and labels must never be occluded */
    const layerRegions = G.append("g").attr("class", "pp-layer-regions");
    const layerLinks   = G.append("g").attr("class", "pp-layer-links");
    const layerNodes   = G.append("g").attr("class", "pp-layer-nodes");
    const layerRings   = G.append("g").attr("class", "pp-layer-rings");
    const layerLabels  = G.append("g").attr("class", "pp-layer-labels");

    /* regions */
    const gx = circles.reduce((s, c) => s + c.x, 0) / k;
    const gy = circles.reduce((s, c) => s + c.y, 0) / k;
    circles.forEach((c, i) => {
      layerRegions.append("circle").attr("class", "pp-circle non-scaling-stroke")
        .attr("cx", c.x).attr("cy", c.y).attr("r", c.r);
      const dx = c.x - gx, dy = c.y - gy;
      const len = Math.hypot(dx, dy) || 1;
      layerLabels.append("text").attr("class", "pp-slice-label")
        .attr("x", c.x + (dx / len) * (c.r + 26))
        .attr("y", c.y + (dy / len) * (c.r + 26))
        .attr("text-anchor", "middle")
        .text(`${labels[i]} · ${sliceCounts[i]}`);
    });

    /* lineage links: where a community split or merged */
    const famColor = d3.scaleOrdinal(d3.schemeTableau10);
    lin.relations.forEach(r => {
      const a = glyphByLin.get(r.from), b = glyphByLin.get(r.to);
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y) * 0.12, ny = (b.x - a.x) * 0.12;
      layerLinks.append("path")
        .attr("class", "pp-lineage-link non-scaling-stroke")
        .attr("d", `M${a.x},${a.y}Q${mx + nx},${my + ny} ${b.x},${b.y}`)
        .attr("stroke", famColor(lin.familyOf(r.from)))
        .attr("stroke-width", 0.8 + 2.6 * r.j);
    });

    /* glyph members */
    const hl = window.globalHighlightNodesMap || {};
    const nodeRecs = [];
    glyphs.sort((a, b) => b.n - a.n);
    glyphs.forEach(gl => {
      const refDict = dicts[gl.refIdx];
      gl.members.sort((a, b) => {
        const ra = classRank(a.sig, k), rb = classRank(b.sig, k);
        if (ra !== rb) return ra - rb;
        return (refDict[b.node]?.centrality ?? 0) - (refDict[a.node]?.centrality ?? 0);
      });

      // Uniform ARC-LENGTH spiral: dots sit a constant ds apart along the coil
      // and the pitch equals ds, so with dot radius 0.38·ds contact is
      // geometrically impossible at any glyph scale.
      const ds = gl.R * Math.sqrt(Math.PI / gl.n);
      const spiralA = ds / (2 * Math.PI);
      const dotR = Math.min(4.6, Math.max(1.3, ds * 0.38));
      gl.dotR = dotR;

      gl.members.forEach((m, j) => {
        const L = (j + 0.5) * ds;
        const r = Math.sqrt(L * ds / Math.PI) * 0.96;
        const a = r / spiralA;
        const x = gl.x + Math.cos(a) * r, y = gl.y + Math.sin(a) * r;

        const node = m.node;
        const nm = refDict[node]?.name;
        const desc = describeRegion(m.sig, labels, k);
        const info = {
          node: +node,   // numeric: drawNodeTimesliceChart compares === on ids
          name: (nm && nm !== "undefined") ? nm : ("Node " + node),
          presence: presenceText(m.sig, labels),
          commHtml: m.sig.map(i => {
            const e = dicts[i][node];
            const cName = (e?.anchor && e.anchor !== "undefined") ? e.anchor : ("C" + e?.community);
            return `<b>${labels[i]}:</b> ${cName}, degree ${e?.centrality ?? "?"}`;
          }).join("<br/>")
        };

        layerNodes.append("circle")
          .attr("class", "pp-node")
          .attr("data-node", node)
          .attr("cx", x).attr("cy", y)
          .attr("r", hl[node] ? dotR + 1 : dotR)
          .attr("fill", classColor(desc.kind))
          .style("stroke", hl[node] || null)
          .style("stroke-width", hl[node] ? 1.8 : null);

        nodeRecs.push({ x, y, node, sig: m.sig, info, glyph: gl });
      });
    });

    /* Region captions first, so they own their space and the glyph labels can
       yield to them. Each caption is anchored inside its OWN region — at the
       foot of that region's largest inscribed circle — so a caption can never
       drift into a neighbouring region and mislabel it. */
    const placed = [];
    function collides(x, y, halfW) {
      return placed.some(p => Math.abs(p.x - x) < (p.halfW + halfW) && Math.abs(p.y - y) < 13);
    }
    zoneCounts.forEach((count, key) => {
      const sig = key.split(",").map(Number);
      const desc = describeRegion(sig, labels, k);
      const text = `${desc.text} · ${count}`;
      const z = geo.get(key);
      const a = anchors.get(key);
      let x = z ? z.origin[0] : a[0];
      let y = z ? z.origin[1] + z.avail * 0.82 : a[1] + 24;
      const halfW = text.length * 3.4;
      let guard = 0;
      while (collides(x, y, halfW) && guard++ < 12) y += 15;
      placed.push({ x, y, halfW });
      layerLabels.append("text").attr("class", "pp-badge")
        .attr("x", x).attr("y", y)
        .attr("text-anchor", "middle")
        .text(text);
    });

    /* Glyph labels — a legibility budget, not a hover gate: every glyph
       responds to hover regardless of whether it earned a label. */
    glyphs.filter(gl => gl.n >= 10).slice(0, 14).forEach(gl => {
      const ly = gl.y - gl.R - 8;
      const halfW = gl.title.length * 2.7;
      if (collides(gl.x, ly, halfW)) return;
      placed.push({ x: gl.x, y: ly, halfW });
      layerLabels.append("text").attr("class", "pp-group-label")
        .attr("x", gl.x).attr("y", ly)
        .attr("text-anchor", "middle")
        .text(gl.title);
    });

    /* ═══ hover ══════════════════════════════════════════════════════════════
       One delegated handler over two quadtrees. No per-element hit geometry,
       so there is no painter-order theft, no flicker when the pointer crosses
       from a community onto one of its own nodes, and no size threshold below
       which a community stops responding. */
    const nodeTree  = d3.quadtree().x(d => d.x).y(d => d.y).addAll(nodeRecs);
    const glyphTree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(glyphs);
    let hoverKey = null;

    function clearHighlight() {
      layerRings.selectAll("*").remove();
      layerNodes.selectAll(".pp-node")
        .classed("pp-node--own",   false)
        .classed("pp-node--kin",   false)
        .classed("pp-node--dim",   false)
        .classed("pp-node--focus", false);
      layerLinks.selectAll(".pp-lineage-link").classed("pp-lineage-link--on", false);
    }

    function ring(gl, cls) {
      layerRings.append("circle")
        .attr("class", "pp-lineage-ring non-scaling-stroke" + (cls ? " " + cls : ""))
        .attr("cx", gl.x).attr("cy", gl.y).attr("r", gl.R + 6);
    }

    /* Hovering a NODE reveals the community lineages it passed through. One
       ring means its community held together; several mean it broke, and the
       dashed connectors trace the order in which that happened. */
    function nodeHover(rec, event) {
      const seen = [];
      rec.sig.forEach(i => {
        const c = dicts[i][rec.node]?.community;
        if (c === undefined || !lin.has(i, c)) return;
        const L = lin.lineageOf(i, c);
        if (!seen.some(s => s.lin === L)) seen.push({ lin: L, slice: i });
      });
      const rings = seen.map(s => ({ ...s, gl: glyphByLin.get(s.lin) })).filter(d => d.gl);

      const inRings = new Set();
      rings.forEach(d => d.gl.members.forEach(m => inRings.add(String(m.node))));
      layerNodes.selectAll(".pp-node").classed("pp-node--dim", function () {
        return !inRings.has(this.getAttribute("data-node"));
      });
      layerNodes.selectAll(`.pp-node[data-node="${rec.node}"]`).classed("pp-node--focus", true);

      for (let i = 0; i + 1 < rings.length; i++) {
        const a = rings[i].gl, b = rings[i + 1].gl;
        layerRings.append("path")
          .attr("class", "pp-lineage-trace non-scaling-stroke")
          .attr("d", `M${a.x},${a.y}L${b.x},${b.y}`);
      }
      rings.forEach(d => {
        ring(d.gl, rings.length > 1 ? "pp-lineage-ring--broken" : null);
        layerRings.append("text")
          .attr("class", "pp-ring-label")
          .attr("x", d.gl.x).attr("y", d.gl.y - d.gl.R - 12)
          .attr("text-anchor", "middle")
          .text(`${labels[d.slice]} · ${d.gl.name}`);
      });

      const broke = rings.length > 1
        ? `<br/><i>community broke across ${rings.length} fragments</i>` : "";
      moveTip(event,
        `<b>${rec.info.name}</b><br/>Present in: ${rec.info.presence}<br/>${rec.info.commHtml}${broke}`);
      if (typeof drawNodeTimesliceChart === "function") drawNodeTimesliceChart(rec.info.node);
      d3.select("#community_textbox").html(
        `<b>${rec.info.name}</b> (node ${rec.info.node})<br/>
         <b>Present in:</b> ${rec.info.presence}<br/>${rec.info.commHtml}`);
      if (window.EgoSpiral) window.EgoSpiral.show(rec.info.node, labels);
    }

    /* Hovering a COMMUNITY highlights its kin: the fragments it split from or
       merged into, and their members wherever they ended up. */
    function glyphHover(gl, event) {
      const fam = lin.familyOf(gl.lin);
      const kinGlyphs = glyphs.filter(g => g !== gl && lin.familyOf(g.lin) === fam);
      const own = new Set(gl.members.map(m => String(m.node)));
      const kin = new Set();
      kinGlyphs.forEach(g => g.members.forEach(m => kin.add(String(m.node))));

      layerNodes.selectAll(".pp-node").each(function () {
        const el = d3.select(this), id = this.getAttribute("data-node");
        if (own.has(id))      el.classed("pp-node--own", true);
        else if (kin.has(id)) el.classed("pp-node--kin", true);
        else                  el.classed("pp-node--dim", true);
      });

      ring(gl, "pp-lineage-ring--own");
      kinGlyphs.forEach(g => ring(g));

      moveTip(event,
        `<b>${gl.title}</b><br/>${gl.n} members here` +
        (kinGlyphs.length
          ? `<br/>${kin.size} co-members in ${kinGlyphs.length} related fragment(s)`
          : `<br/>lineage intact across the selection`));
    }

    function setHover(h, event) {
      const key = h ? h.type + ":" + (h.type === "node" ? h.rec.node : h.rec.lin) : null;
      if (key === hoverKey) { if (h && event) moveTip(event); return; }
      hoverKey = key;
      clearHighlight();
      if (!h) { hoverOut(); return; }
      if (h.type === "node") nodeHover(h.rec, event);
      else                   glyphHover(h.rec, event);
    }

    function onMove(event) {
      const [mx, my] = d3.pointer(event, G.node());
      const nd = nodeTree.find(mx, my, NODE_PICK_R);
      if (nd) { setHover({ type: "node", rec: nd }, event); return; }
      const gl = glyphTree.find(mx, my, 260);
      if (gl && Math.hypot(mx - gl.x, my - gl.y) <= gl.R + 8) {
        setHover({ type: "glyph", rec: gl }, event); return;
      }
      setHover(null);
    }

    const rootSel = d3.select(G.node().ownerSVGElement);
    rootSel.on("mousemove.pp", onMove).on("mouseleave.pp", () => setHover(null));
    detachHover = () => {
      rootSel.on("mousemove.pp", null).on("mouseleave.pp", null);
      detachHover = () => {};
    };

    const fitNote = k === 3
      ? ` Region areas fitted to ${Math.round(fit * 100)}% (exact 3-set Euler diagrams are not always realisable).`
      : ` Region areas are exact.`;
    showBanner(
      `Comparing <b>${labels.join(" · ")}</b> — circle area ∝ slice size, overlap ∝ shared nodes. ` +
      `One glyph per community lineage; hover a node to trace its community across time.` + fitNote,
      true);

    if (window.SpinTrixMainZoom) {
      window.SpinTrixMainZoom.setup();
      window.SpinTrixMainZoom.markNonScalingStrokes();
      // Generous padding: the floaty panels overlay the SVG, so fitting to the
      // full SVG width tucks the outer regions underneath them.
      window.SpinTrixMainZoom.fitAll(300, 120);
    }
  }

  window.PresencePartition = {
    toggle, reset, exitToNormal,
    // Exposed so the Community Evolution overview can reuse the exact same
    // cross-slice matcher (Jaccard τ, 1-to-1 union, split/merge relations)
    // rather than reimplementing lineage tracking a second time.
    buildLineages,
    get active() { return active; },
    get labels() { return selected.map(s => s.label); }
  };
})();
