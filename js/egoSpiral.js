/* ─────────────────────────────────────────────────────────────────────────
   Ego Spiral — one node's neighbourhood across every time slice.

   DyNetSpin covers the Network level (the whole spiral) and the Subnetwork
   level (communities, the Cohort Tracker). This is the Individual level:
   "describe the evolution of the ego network of a selected node", "find the
   neighbours present for at least n time steps", "compare ego networks".

   THE WHOLE ENCODING, in one sentence:
     each ring is a time step, each spoke is one neighbour, each band holds the
     neighbours who leave for the same crowd, and a tile marks the weeks they
     were there.

   Consequences of keeping it to that one sentence:
     • NO lines are drawn between data points. An earlier version connected a
       neighbour's position at t to its position at t+1, which in a node-link
       tool reads as "these two are connected" — it was showing time and being
       read as topology. Identity is now carried by radial alignment instead,
       supported by a faint polar grid that is obviously scaffold.
     • A neighbour missing from a ring simply has no dot there. That covers
       "left", "joined" and "left and came back" without a separate dashed-line
       or ✗ vocabulary.
     • Every dot in this view is connected to the ego — that is what being in
       the view MEANS. So no ego-to-neighbour edges are drawn either; the old
       version drew them for single-slice neighbours only, which implied the
       ego was connected to those and not the rest. Exactly backwards.

   A SPOKE NEVER MOVES. Slot assignment carries neighbour identity and nothing
   else; membership over time is carried by the per-ring tiles. The previous
   version conflated the two — a spoke's angle WAS its community in the slice on
   screen — so the entire widget re-sorted itself every time the participant
   stepped a week, which is the exact instability DyNetSpin's main spiral exists
   to remove. Separating slot from state applies the tool's own principle to its
   own widget.

   Grouping still never compares community ids ACROSS slices, because they are
   not stable between slices in this dataset family (measured on the study
   corpus: 9% of un_voting nodes and 16% of struct_a nodes keep their id from
   one slice to the next; the planted families keep 100%, which is a property of
   the generator and not something to design against). Two quantities ARE
   comparable across slices and both are used here:

     1. RELATION TO THE EGO — "was this neighbour in the ego's own community, in
        that slice?" Defined per slice, ego-relative, no id comparison. This is
        what the tiles draw.
     2. WHO THEY LEFT WITH — a neighbour's destination is identified by the set
        of the EGO'S OTHER NEIGHBOURS sharing its community while it is away.
        Membership, not id. Two neighbours belong to the same crowd when those
        sets overlap (Jaccard >= CROWD_JACCARD). This is what the bands are.

   What the measurements said, on the study corpus rather than on Enron:
     • A fixed grouping costs far less than the 28% of wedge memberships an
       earlier note recorded. Under the ego-relative recoding the worst case is
       un_voting at 12.0% of (neighbour, slice) cells disagreeing with a fixed
       band; data_vispub 7.2%; struct_a 0.3%; planted_a 0.0%. So the cells that
       used to force per-slice regrouping are few enough to DRAW, and drawing
       them is strictly more informative than hiding them in a reshuffle.
     • 86% of neighbours who ever leave (463 of 546 in un_voting) go to exactly
        ONE destination; 73 go to two, 10 to three. A crowd is therefore a
       well-defined place for almost every mover, which is what makes ordering
       by destination meaningful rather than decorative.
     • Widening a signature from the ego's own neighbours to the destination's
       FULL membership makes clustering worse on un_voting (18% vs 27% of movers
       landing in a cohort of >=3), because over 14 slices a bloc's full roster
       churns while the ego's own contacts stay put. Restricting the signature
       to co-neighbours is denoising, not a shortcut.
     • Cohorts are small: 287 singletons, 50 pairs, 25 triples and a tail out to
       8. A crowd of one is drawn as a single tile column and a crowd of eight as
       a small band — the same primitive at different widths, so a lone defector
       needs no special case.

   Data comes entirely from allYearsNodeLinks / allYearsNodeData, already
   loaded for every slice by loadAllYearsData(), so nothing extra is fetched.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const VB = 340;               // viewBox side; the SVG scales to its column
  /* The inner ring is kept well away from the pole because EVERY ring carries
     the same number of spokes, so the innermost one is always the binding
     constraint on angular resolution. (An earlier comment here claimed the
     inner ring mattered because early slices hold more neighbours — that was
     wrong: slots are allocated once from the union of all slices and rec.angle
     is fixed across rings, so per-slice degree never affects spacing.) */
  const R_INNER = 62;
  const R_OUTER = 146;
  const WEDGE_GAP = 0.09;       // radians between bands
  const MAX_SHOWN = 80;         // legibility budget for very high-degree egos
  /* Two neighbours are "going to the same crowd" when the ego's other contacts
     they sit with while away overlap by at least this much. 0.5 is the value the
     corpus measurement in the header was run at; loosening it merges the small
     cohorts into one blob and tightening it turns every mover into a singleton,
     which are the two ways this encoding stops saying anything. */
  const CROWD_JACCARD = 0.5;

  const adjCache = new WeakMap();      // edges array -> Map<nodeId, neighbourIds[]>
  let current = null;                  // last rendered model, for interaction

  function adjacencyFor(label) {
    const edges = (typeof allYearsNodeLinks !== "undefined" && allYearsNodeLinks[label]) || null;
    if (!edges) return null;
    let m = adjCache.get(edges);
    if (m) return m;
    m = new Map();
    edges.forEach(e => {
      const s = +e.source, t = +e.target;
      if (!m.has(s)) m.set(s, []);
      if (!m.has(t)) m.set(t, []);
      m.get(s).push(t);
      m.get(t).push(s);
    });
    adjCache.set(edges, m);
    return m;
  }

  function stateColor(kind) {
    const SC = window.STATE_COLORS || {};
    return { core: SC.stable || "#8C8C8C", left: SC.outgoing || "#E69F00",
             joined: SC.incoming || "#0072B2", gap: SC.both || "#CC79A7" }[kind];
  }

  // The same four states as Local Volatility and the compare view.
  function presenceKind(slices, k) {
    if (slices.length === k) return "core";
    const contiguous = slices.every((v, i) => i === 0 || v === slices[i - 1] + 1);
    if (!contiguous) return "gap";
    if (slices[slices.length - 1] === k - 1) return "joined";
    if (slices[0] === 0) return "left";
    return "gap";
  }

  function nameOf(dicts, id) {
    for (const d of dicts) {
      const e = d[id];
      if (e && e.name && e.name !== "undefined") return e.name;
    }
    return "Node " + id;
  }

  /* "W2, W4, W5, W6" -> "W2, W4–W6". Over 14 slices the un-collapsed form is a
     sentence nobody finishes reading, and the runs are the shape that matters:
     one long spell away is a defection, four scattered weeks is noise. */
  function runsOf(idxs, labels) {
    if (!idxs || !idxs.length) return "";
    const sorted = [...idxs].sort((a, b) => a - b);
    const out = [];
    let start = sorted[0], prev = sorted[0];
    const flush = () => out.push(start === prev ? labels[start]
                                                : `${labels[start]}–${labels[prev]}`);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
      flush(); start = prev = sorted[i];
    }
    flush();
    return out.join(", ");
  }

  const container = () => d3.select("#egoSpiral");

  function clear() {
    current = null;
    const c = container();
    if (!c.empty())
      c.html('<div class="ego-empty">Hover a node to see its neighbourhood across time.</div>');
  }

  /* Band tints. A patchwork only reads as a patchwork if the patches are few
     and separable, so the palette is capped: the biggest crowds get a hue each
     and the tail is pooled. These are light enough to sit under dots without
     competing with them. */
  const WEDGE_COLORS = ["#4E79A7", "#F28E2B", "#59A14F", "#B07AA1",
                        "#76B7B2", "#EDC948"];
  const OTHER_COLOR  = "#9AA0A6";   // pooled tail of small crowds
  const UNKNOWN_COLOR = "#C7C9CC";  // no community recorded in any shared slice
  const MAX_WEDGES   = WEDGE_COLORS.length;

  /* ── the two comparable quantities ───────────────────────────────────────
     Both are computed per slice and neither compares a community id across
     slices. See the header for why that constraint exists and what it costs. */

  const awaySlices = rec =>
    [...rec.rel.entries()].filter(([, withEgo]) => !withEgo).map(([i]) => i);
  const homeSlices = rec =>
    [...rec.rel.entries()].filter(([, withEgo]) => withEgo).map(([i]) => i);
  /* A neighbour whose relation to the ego is not constant. These carry the most
     information per slot, so they are what the MAX_SHOWN budget is spent on
     first — an always-together neighbour says the same thing on every ring. */
  const changesSide = rec => {
    const v = [...rec.rel.values()];
    return v.some(Boolean) && v.some(x => !x);
  };

  /* WHERE a neighbour goes, identified by membership rather than by an id: the
     ego's OTHER neighbours who share this one's community during the slices it
     is away. Read from the slice's node table (presence), not from rec.comm
     (adjacency) — for the same reason the old grouping did: existence in a
     slice and adjacency to the ego are different questions, and only the first
     decides which community you are counted in. */
  function awaySignature(rec, all, dicts) {
    const sig = new Set();
    rec.rel.forEach((withEgo, i) => {
      if (withEgo) return;
      const c = rec.comm.get(i);
      if (c === undefined) return;
      all.forEach(other => {
        if (other.id === rec.id) return;
        const oc = dicts[i][other.id]?.community;
        if (oc !== undefined && oc !== null && !Number.isNaN(oc) && +oc === c)
          sig.add(other.id);
      });
    });
    return sig;
  }

  /* Single-linkage at CROWD_JACCARD. Single linkage rather than a centroid
     method on purpose: a neighbour who defects with A early and with B late
     belongs in the same band as both, and the 14% of movers with more than one
     destination are exactly the interesting ones to keep attached rather than
     to split off into a singleton. n <= MAX_SHOWN so the O(n^2) sweep is at
     most ~3200 pairs. */
  function crowdsOf(outs, sigs) {
    const parent = new Map(outs.map(r => [r.id, r.id]));
    const find = x => {
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    for (let a = 0; a < outs.length; a++) {
      const A = sigs.get(outs[a].id);
      if (!A.size) continue;
      for (let b = a + 1; b < outs.length; b++) {
        const B = sigs.get(outs[b].id);
        if (!B.size) continue;
        let inter = 0;
        A.forEach(x => { if (B.has(x)) inter++; });
        if (inter && inter / (A.size + B.size - inter) >= CROWD_JACCARD) {
          const ra = find(outs[a].id), rb = find(outs[b].id);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
    }
    const by = new Map();
    outs.forEach(r => {
      const root = find(r.id);
      if (!by.has(root)) by.set(root, []);
      by.get(root).push(r);
    });
    return [...by.values()];
  }

  /* ── grouping: one band per destination crowd, fixed across ALL slices ────
     Band 0 is always the neighbours who are never anywhere else, so "my own
     group" starts at the top of the circle and stays there. Every other band is
     a crowd, holding both the neighbours who live there permanently and the
     ones who only visit — sorted so the occasional visitors sit next to the
     ego's own band and the permanent residents at the far end. That makes the
     sweep round the circle a ramp in "how much time apart", which is the
     ordering the eye reads for free. */
  function groupByDestination(list, dicts, labelFor) {
    const home = [], out = [], unknown = [];
    list.forEach(rec => {
      if (!rec.rel.size) { unknown.push(rec); return; }
      (awaySlices(rec).length ? out : home).push(rec);
    });

    const sigs = new Map(out.map(r => [r.id, awaySignature(r, list, dicts)]));
    const crowds = crowdsOf(out, sigs)
      .sort((a, b) => (b.length - a.length) || (a[0].id - b[0].id));

    const byTenure = (a, b) => (b.slices.length - a.slices.length) || (a.id - b.id);
    const byTimeAway = (a, b) =>
      (awaySlices(a).length - awaySlices(b).length) || (a.id - b.id);

    const groups = [], meta = [];
    if (home.length) {
      home.sort(byTenure);
      groups.push(home);
      meta.push({ kind: "own", crowd: 0, color: WEDGE_COLORS[0],
                  label: `${nameShort()}'s own group · ${home.length}` });
    }
    // One colour is spent on the ego's own band, so the rest is what crowds get.
    const named = crowds.slice(0, MAX_WEDGES - 1);
    const tail  = crowds.slice(MAX_WEDGES - 1);
    named.forEach((recs, i) => {
      recs.sort(byTimeAway);
      groups.push(recs);
      meta.push({ kind: "crowd", crowd: i + 1,
                  color: WEDGE_COLORS[(i + 1) % WEDGE_COLORS.length],
                  label: `${labelFor(recs)} · ${recs.length}` });
    });
    if (tail.length) {
      const pooled = tail.flat().sort(byTimeAway);
      groups.push(pooled);
      meta.push({ kind: "other", crowd: null, color: OTHER_COLOR,
                  label: `${tail.length} smaller crowds · ${pooled.length}` });
    }
    if (unknown.length) {
      unknown.sort(byTenure);
      groups.push(unknown);
      meta.push({ kind: "unknown", crowd: null, color: UNKNOWN_COLOR,
                  label: `no group recorded · ${unknown.length}` });
    }
    return { groups, meta };
  }
  let _egoName = "";
  function nameShort() { return _egoName.split(/\s+/).slice(-1)[0] || "ego"; }

  /* ── main entry ───────────────────────────────────────────────────────── */
  function show(nodeID, labelsOpt) {
    const host = container();
    if (host.empty()) return;
    nodeID = +nodeID;

    const labels = (labelsOpt && labelsOpt.length >= 2) ? labelsOpt : (window.currentSlices || []);
    const k = labels.length;
    if (!k || typeof allYearsNodeData === "undefined") { clear(); return; }

    /* Re-entry guard. show() is called from the main chart's mouseover, so
       sweeping the pointer across a dense region fires it once per node
       ENTERED — and re-entering a node already drawn used to tear the host down
       and rebuild it. The rebuild is ~4,700 individually appended SVG elements
       (up to 80 slots x 14 rings of dots and tiles, plus guides and grid), which
       is far past a frame budget; the clustering it also repeats is minor by
       comparison. Keyed on everything the render depends on: the node, the slice
       set, and the dataset (node ids are only meaningful within one). */
    const sig = nodeID + " " + labels.join("|") + " " + window.currentDataset;
    if (current && current.sig === sig && current.gGrid
        && !container().select(".ego-svg").empty()) return;
    const dicts = labels.map(l => allYearsNodeData[l] || {});

    /* 1 ▸ the neighbourhood, slice by slice */
    const num = v => (v === undefined || v === null || Number.isNaN(+v)) ? undefined : +v;
    const egoComm = labels.map((_, i) => num(dicts[i][nodeID]?.community));

    const byId = new Map();
    const degree = new Array(k).fill(0);
    const sets = [];
    for (let i = 0; i < k; i++) {
      const adj = adjacencyFor(labels[i]);
      const set = new Set(adj ? (adj.get(nodeID) || []) : []);
      sets.push(set);
      degree[i] = set.size;
      set.forEach(a => {
        if (!byId.has(a)) byId.set(a, { id: a, slices: [], comm: new Map(), rel: new Map() });
        const rec = byId.get(a);
        rec.slices.push(i);
        const c = num(dicts[i][a]?.community);
        if (c === undefined) return;
        rec.comm.set(i, c);
        /* The relation is only defined where the neighbour is ADJACENT, i.e.
           where a dot exists. A ring with no dot has no cell to tile, and
           claiming a relation there would be asserting something about a week
           in which the view shows nothing. */
        if (egoComm[i] !== undefined) rec.rel.set(i, c === egoComm[i]);
      });
    }

    if (!byId.size) {
      host.html(`<div class="ego-empty">${nameOf(dicts, nodeID)} has no recorded neighbours in these slices.</div>`);
      /* This return replaces the host's HTML, so the previous render's SVG is
         gone — and leaving `current` pointing at the node that drew it left
         refresh() holding a detached gGrid and the wrong nodeID. Stepping the
         rail after hovering an isolated node then redrew the PREVIOUS node's
         spiral over this one's empty-state message, attributed to nobody. The
         other two early returns are already safe (one renders nothing, one
         calls clear()); this one has to say so itself. */
      current = null;
      return;
    }

    /* Trim for legibility. Neighbours whose relation to the ego CHANGES are
       taken first: a slot spent on one of those carries a different mark on
       different rings, where a slot spent on an always-together neighbour
       repeats itself k times. Ties then go to the most persistent. The readout
       below is computed from the FULL sets, so the numbers stay exact. */
    let all = [...byId.values()];
    const total = all.length;
    all.sort((a, b) => (changesSide(b) - changesSide(a))
                    || (b.slices.length - a.slices.length) || (a.id - b.id));
    const trimmed = all.length > MAX_SHOWN;
    if (trimmed) all = all.slice(0, MAX_SHOWN);

    /* 2 ▸ group by destination crowd — the same bands on every ring — and give
       each neighbour one angular slot it keeps for the life of the widget. */
    _egoName = nameOf(dicts, nodeID);
    /* The chart's slice is still tracked, but ONLY to draw the active ring
       heavier. Nothing about the layout depends on it any more, which is what
       lets refresh() update a slice change in place instead of re-rendering. */
    let sliceIdx = labels.indexOf(window.currentYearRange);
    if (sliceIdx < 0) sliceIdx = k - 1;

    /* A crowd's name is its members — the only handle on it that survives from
       one slice to the next, since its community id does not. Two names plus a
       count is what fits in a legend row at this width. */
    const crowdLabel = recs => {
      const names = recs.map(r => nameOf(dicts, r.id));
      const head = names.slice(0, 2).join(", ");
      return names.length > 2 ? `${head} +${names.length - 2}` : head;
    };

    const { groups, meta } = groupByDestination(all, dicts, crowdLabel);
    const slots = [];                       // flat, in band order
    groups.forEach(g => g.forEach(rec => slots.push(rec)));

    const usable = 2 * Math.PI - groups.length * WEDGE_GAP;
    const wedge = [];
    let cursor = -Math.PI / 2, slotIndex = 0;
    groups.forEach((g, gi) => {
      const w = Math.max(usable * g.length / Math.max(slots.length, 1), 0.06);
      wedge.push({ start: cursor, width: w, centre: cursor + w / 2, size: g.length, index: gi });
      g.forEach((rec, j) => {
        rec.angle = cursor + ((j + 0.5) / g.length) * w;
        rec.aw = w / g.length;              // angular width of this rec's cells
        rec.band = gi;
        rec.slot = slotIndex++;
      });
      cursor += w + WEDGE_GAP;
    });

    const radiusAt = i => (k === 1 ? R_OUTER : R_INNER + (i / (k - 1)) * (R_OUTER - R_INNER));
    const ringGap = k > 1 ? (R_OUTER - R_INNER) / (k - 1) : (R_OUTER - R_INNER);
    /* Every ring gets a label at 6 slices (16.8px apart). At un_voting's 14 they
       are 6.5px apart against a 7.5px face, so drawing them all stacks fourteen
       year ranges into one illegible smear at the top of the view — which is what
       the first render of this redesign did. Label every nth instead. The skipped
       ones are still IN the DOM, hidden by a class that the active-ring class
       overrides, so the slice you are on always names itself and refresh() needs
       to know nothing about any of this. */
    const labelStride = Math.max(1, Math.ceil(9 / ringGap));

    /* 3 ▸ draw */
    host.html("");
    const svg = host.append("svg")
      .attr("class", "ego-svg")
      .attr("viewBox", `${-VB / 2} ${-VB / 2} ${VB} ${VB}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    const gWedge = svg.append("g");
    const gGrid  = svg.append("g");
    const gCell  = svg.append("g");     // paints under gDots by document order
    const gDots  = svg.append("g");
    const gHi    = svg.append("g");

    /* Band backgrounds say WHERE, for all of time; the tiles inside them say
       WHEN. The band is deliberately the fainter of the two: it is a container,
       and the thing worth looking at is which cells inside it are filled.
       Colour is set here rather than in CSS because the assignment is
       data-driven (which crowd is biggest), not a fixed set of classes. */
    const wedgeArc = d3.arc()
      .innerRadius(R_INNER - 12).outerRadius(R_OUTER + 6)
      .startAngle(d => d.start + Math.PI / 2)
      .endAngle(d => d.start + d.width + Math.PI / 2);
    wedge.forEach((w, i) => {
      gWedge.append("path")
        .attr("class", "ego-wedge ego-wedge--" + meta[i].kind)
        .attr("d", wedgeArc(w))
        .style("fill", meta[i].color)
        .style("fill-opacity", meta[i].kind === "own" ? 0.20 : 0.12)
        .append("title").text(meta[i].label);
    });

    /* Polar grid. Rings are time; the radial guides are what let a column of
       dots read as one person. Both are drawn at the same scaffold weight so
       neither can be mistaken for data — this is the whole reason no data
       lines are drawn anywhere in this view. */
    /* Every circle here carries a datum. Not because this view needs one, but
       because other code in the app runs document-wide d3.selectAll("circle")
       and dereferences the datum — a data-less circle in the Inspector once
       threw inside the Cohort Tracker's click handler and made it look dead. */
    /* The ring for the slice on screen is drawn heavier and its label bolded.
       This is now the ONLY thing in the view that depends on which slice is
       showing — it says "you are here", not "these colours are about this
       week". Both marks carry the ring index as a datum so refresh() can move
       the emphasis without rebuilding anything. */
    for (let i = 0; i < k; i++) {
      const active = i === sliceIdx;
      gGrid.append("circle").datum({ ring: i })
        .attr("class", "ego-ring" + (active ? " ego-ring--active" : ""))
        .attr("r", radiusAt(i));
      const thin = (i % labelStride !== 0) && i !== k - 1;
      gGrid.append("text").datum({ ring: i })
        .attr("class", "ego-ring-label"
          + (thin ? " ego-ring-label--thin" : "")
          + (active ? " ego-ring-label--active" : ""))
        .attr("x", 0).attr("y", -radiusAt(i) - 3)
        .attr("text-anchor", "middle")
        .text(labels[i]);
    }
    slots.forEach(rec => {
      gGrid.append("line").attr("class", "ego-guide")
        .attr("x1", Math.cos(rec.angle) * (R_INNER - 10))
        .attr("y1", Math.sin(rec.angle) * (R_INNER - 10))
        .attr("x2", Math.cos(rec.angle) * (R_OUTER + 4))
        .attr("y2", Math.sin(rec.angle) * (R_OUTER + 4));
    });

    // dot size follows the busiest ring
    const dotR = Math.max(1.7, Math.min(3.2,
      (2 * Math.PI * R_INNER) / (Math.max(...degree, 1) * 3.4)));

    /* ── the tiles: one cell per (neighbour, week) spent away from the ego ────
       A cell is filled when that neighbour was in this band's crowd that week,
       so a permanent resident reads as an unbroken radial ribbon and a visitor
       as a few marks with gaps where they came home. Same primitive at both
       extremes, which is what makes a crowd of one need no special case.

       No stroke. The binding constraint is un_voting: 14 rings across 84px of
       radial space is 6.5px between rings, and a slot at the inner ring is
       2*pi*62/80 ~ 4.9px wide, so a 1px outline would eat most of the fill it
       is supposed to delimit. Fill alone survives that; an outline does not.

       Nothing is drawn for the ego's own band — an empty band IS "never
       anywhere else", and tiling all of it would be ink for the default. */
    const cellH = Math.max(dotR + 1, Math.min(ringGap * 0.42, 6));
    const cellArc = d3.arc()
      .innerRadius(d => Math.max(d.r - cellH, 2)).outerRadius(d => d.r + cellH)
      .startAngle(d => d.a - d.hw + Math.PI / 2)
      .endAngle(d => d.a + d.hw + Math.PI / 2);

    slots.forEach(rec => {
      if (meta[rec.band].kind === "own") return;
      const label = nameOf(dicts, rec.id);
      awaySlices(rec).forEach(i => {
        gCell.append("path")
          .datum(rec)
          .attr("class", "ego-cell")
          .attr("data-slot", rec.slot)
          // The ring is not recoverable from the arc path, and the correctness
          // property worth asserting is per (neighbour, week) — so it is written
          // down rather than reconstructed. tests/widget_validation.js reads it.
          .attr("data-ring", i)
          // 0.86 leaves a hairline between neighbouring slots so a run of
          // filled cells still reads as several people, not one blob.
          .attr("d", cellArc({ r: radiusAt(i), a: rec.angle, hw: rec.aw * 0.43 }))
          .style("fill", meta[rec.band].color)
          .append("title")
          .text(`${label} — in a different group from ${nameShort()} in ${labels[i]}`);
      });
    });

    /* Three marks, and only three:
         dot      connected that slice
         nothing  not connected that slice
         ✕        connected up to here and never again
       Community is NOT encoded on the dot. It was, as a hollow ring, and it
       failed twice over: hollow at r≈1.7 is indistinguishable from filled, and
       it duplicated information the band and its tiles now carry outright. The
       dot's own colour is the presence state (arrived / left / passing through
       / stayed), which is about the EDGE to the ego and so never competes with
       the tile underneath it, which is about the neighbour's group. */
    slots.forEach(rec => {
      const col = stateColor(presenceKind(rec.slices, k));
      const label = nameOf(dicts, rec.id);
      rec.slices.forEach(i => {
        gDots.append("circle")
          .datum(rec)
          .attr("class", "ego-dot")
          .attr("data-slot", rec.slot)
          .attr("cx", Math.cos(rec.angle) * radiusAt(i))
          .attr("cy", Math.sin(rec.angle) * radiusAt(i))
          .attr("r", dotR)
          .attr("fill", col)
          .append("title")
          .text(`${label} — connected in ${labels[i]}`);
      });

      /* Departure marker at the ring AFTER the last connection. Only for
         neighbours that never come back — a mid-series gap is already legible
         as a missing dot and does not earn a mark of its own. */
      const last = rec.slices[rec.slices.length - 1];
      if (last < k - 1) {
        const r = radiusAt(last + 1), s = dotR + 1.2;
        const x = Math.cos(rec.angle) * r, y = Math.sin(rec.angle) * r;
        const g = gDots.append("g")
          .datum(rec)
          .attr("class", "ego-x")
          .attr("data-slot", rec.slot);
        g.append("line").attr("x1", x - s).attr("y1", y - s).attr("x2", x + s).attr("y2", y + s);
        g.append("line").attr("x1", x - s).attr("y1", y + s).attr("x2", x + s).attr("y2", y - s);
        g.append("title").text(`${label} — last seen in ${labels[last]}, gone after that`);
      }
    });

    gDots.append("circle").datum({ ego: nodeID }).attr("class", "ego-centre").attr("r", 5.5)
      .append("title").text(nameOf(dicts, nodeID));

    /* 4 ▸ interaction: hovering anywhere in a neighbour's wedge lights up that
       whole spoke, which is what makes radial alignment legible. Clicking a
       group freezes it into the Cohort Tracker. */
    /* Legend, because a patchwork is unreadable without one. It names each
       crowd by its MEMBERS: a community id would change under the reader every
       slice, where a roster does not. This is also the slot the Cohort Tracker
       reads its card name from, so naming a band well names a card well. */
    const legend = host.append("div").attr("class", "ego-legend");
    legend.append("div").attr("class", "ego-legend__head")
      .text(`Where this neighbourhood goes — all ${k} slices, not just the one on screen`);
    const legRow = legend.append("div").attr("class", "ego-legend__row");
    meta.forEach((m, i) => {
      const item = legRow.append("span")
        .attr("class", "ego-legend__item")
        .attr("data-wedge", i)
        .attr("title", m.kind === "unknown"
          ? "No community recorded for these in any shared slice"
          : m.kind === "own"
            ? `Never in another group while connected to ${nameShort()}`
            : "Click the band to focus it in the Cohort Tracker");
      item.append("span").attr("class", "ego-legend__swatch")
        .style("background", m.color)
        .style("opacity", m.kind === "own" ? 0.55 : 0.35);
      item.append("span").text(m.label);
    });

    /* Wedge and legend entry are the same object shown twice, so hovering
       either one marks both. Without this the patchwork is a colour-matching
       exercise between a tinted arc and a 9px swatch. */
    function markWedge(i, on) {
      legRow.selectAll(".ego-legend__item")
        .classed("ego-legend__item--on", function () {
          return on && +this.getAttribute("data-wedge") === i;
        });
      gWedge.selectAll(".ego-wedge")
        .style("fill-opacity", function (_, j) {
          const base = meta[j].kind === "own" ? 0.20 : 0.12;
          return (on && j === i) ? 0.34 : base;
        });
    }
    gWedge.selectAll(".ego-wedge")
      .on("mouseenter", function () {
        markWedge(gWedge.selectAll(".ego-wedge").nodes().indexOf(this), true);
      })
      .on("mouseleave", () => markWedge(-1, false));
    legRow.selectAll(".ego-legend__item")
      .on("mouseenter", function () { markWedge(+this.getAttribute("data-wedge"), true); })
      .on("mouseleave", () => markWedge(-1, false));

    const caption = host.append("div").attr("class", "ego-caption");
    const defaultCaption = `${slots.length} neighbours across ${k} slices. `
      + `Ring = time; dot = connected; band = the crowd they sit with when they `
      + `are not with ${nameShort()}; tile = the weeks they were there. `
      + `Click a band to track it, the centre for the whole neighbourhood.`;
    caption.text(defaultCaption);

    svg.on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, svg.node());
      const r = Math.hypot(mx, my);
      if (r < R_INNER - 14 || r > R_OUTER + 8) return hoverOff();
      let a = Math.atan2(my, mx);
      // nearest slot by angle
      let best = null, bestD = Infinity;
      slots.forEach(rec => {
        // Angular distance, wrapped: 0 when the cursor is on the spoke, π when
        // it is on the antipode. It is already a distance — do not invert it.
        const d = Math.abs(((rec.angle - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < bestD) { bestD = d; best = rec; }
      });
      if (!best || bestD > 0.12) return hoverOff();
      hoverOn(best);
    }).on("mouseleave", hoverOff);

    function hoverOn(rec) {
      if (current && current.hovered === rec.slot) return;
      hoverOff();
      if (current) current.hovered = rec.slot;
      gHi.append("line").attr("class", "ego-guide--on")
        .attr("x1", Math.cos(rec.angle) * (R_INNER - 10))
        .attr("y1", Math.sin(rec.angle) * (R_INNER - 10))
        .attr("x2", Math.cos(rec.angle) * (R_OUTER + 4))
        .attr("y2", Math.sin(rec.angle) * (R_OUTER + 4));
      dimAllBut(rec.slot);
      /* This used to print the raw community id per slice — "W1 (c3), W2 (c7),
         W3 (c3)" — which invited the reader to see a return to c3 in exactly
         the datasets where the ids are reassigned every slice (un_voting keeps
         9% of them). The relation to the ego is the version of that sentence
         which is true in every dataset, so it is the one said out loud. */
      const withRuns = runsOf(homeSlices(rec), labels);
      const awayRuns = runsOf(awaySlices(rec), labels);
      const parts = [];
      if (withRuns) parts.push(`with ${nameShort()} in ${withRuns}`);
      if (awayRuns) parts.push(`apart in ${awayRuns}`);
      if (!parts.length) parts.push(`connected in ${runsOf(rec.slices, labels)}`);
      const last = rec.slices[rec.slices.length - 1];
      if (last < k - 1) parts.push(`gone after ${labels[last]}`);
      caption.html(`<b>${nameOf(dicts, rec.id)}</b> — ${parts.join("; ")}`);
    }
    function hoverOff() {
      if (current) current.hovered = null;
      gHi.selectAll("*").remove();
      dimAllBut(null);
      caption.text(defaultCaption);
    }
    /* Cells live in their own layer, so dimming has to reach two selections.
       Missing the second one leaves a hovered spoke sitting on undimmed tiles,
       which reads as "these tiles belong to the highlighted person". */
    function dimAllBut(slot) {
      const on = slot !== null;
      gDots.selectAll(".ego-dot, .ego-x").classed("ego-dot--dim",
        function () { return on && +this.getAttribute("data-slot") !== slot; });
      gCell.selectAll(".ego-cell").classed("ego-dot--dim",
        function () { return on && +this.getAttribute("data-slot") !== slot; });
    }

    /* What a click freezes is always an EGO NETWORK — this node plus a set of
       its neighbours — never a bare bag of neighbours. Kale et al. 2023 put
       "compare the evolutionary patterns of ego networks of selected egos"
       (Table 2, Individual × Comparison) at this level, and the Tracker's three
       slots are exactly that comparison surface. A card without its ego in it
       cannot answer that question. The wedge only narrows WHICH neighbours. */
    /* A card is always ONE EGO'S NETWORK — the ego plus every neighbour present
       in this slice. The Tracker's three slots are for comparing different
       people's networks (Kale et al. Table 2, Individual × Comparison:
       Skilling vs Lay, Keim vs Ma), so spending them on subsets of one person
       is the wrong unit — five wedges used to evict every other ego after three
       clicks.

       A wedge therefore does not create a card. It focuses the card this ego
       already owns; only if the ego is not yet tracked does the click also
       create it. Same click, two outcomes, and the slot count is untouched. */
    function trackEgo(focus) {
      if (typeof window.snapshotCommunityCohort !== "function") return;
      if (focus && typeof window.focusTrackedEgo === "function"
          && window.focusTrackedEgo(nodeID, focus)) return;   // absorbed
      window.snapshotCommunityCohort(null, {
        nodeIds: [nodeID, ...slots.map(r => r.id)],
        id: `ego${nodeID}`,                    // identity is the EGO, not the wedge
        label: `Ego: ${_egoName}`,
        egoID: nodeID,
        focus: focus || null
      });
    }

    gWedge.selectAll(".ego-wedge")
      // Members with no community anywhere cannot be focused on a group they
      // were never recorded in — saying so beats a card that means nothing.
      .style("cursor", (_, i) => meta[i].kind === "unknown" ? "default" : "pointer")
      .on("click", function () {
        const gi = gWedge.selectAll(".ego-wedge").nodes().indexOf(this);
        if (!groups[gi] || meta[gi].kind === "unknown") return;
        /* The key no longer carries a slice: a band means the same thing on
           every ring, so re-clicking it after stepping a week should focus the
           card that already exists rather than mint a second one. */
        trackEgo({
          key: `band:${meta[gi].kind}:${meta[gi].crowd}`,
          label: `${meta[gi].label.split(" · ")[0]} (${groups[gi].length})`,
          ids: groups[gi].map(r => r.id)
        });
      });

    // The centre is the ego: track the whole neighbourhood, unfocused.
    gDots.select(".ego-centre")
      .style("cursor", "pointer")
      .on("click", () => trackEgo(null));

    /* 5 ▸ readout — computed from the untrimmed sets, so it stays exact even
       when the drawing is capped. "kept" is the Jaccard overlap with the
       previous slice, not a one-directional retention rate. */
    const rows = [];
    for (let i = 0; i < k; i++) {
      const prev = i > 0 ? sets[i - 1] : null;
      let gained = 0, lost = 0, jac = null;
      if (prev) {
        sets[i].forEach(a => { if (!prev.has(a)) gained++; });
        prev.forEach(a => { if (!sets[i].has(a)) lost++; });
        const union = new Set([...prev, ...sets[i]]).size;
        jac = union ? (prev.size + sets[i].size - union) / union : 0;
      }
      rows.push(`<tr><td>${labels[i]}</td><td>${degree[i]}</td>
                 <td>${prev ? "+" + gained : "—"}</td>
                 <td>${prev ? "−" + lost : "—"}</td>
                 <td>${jac === null ? "—" : (jac * 100).toFixed(0) + "%"}</td></tr>`);
    }
    host.append("div").attr("class", "ego-readout").html(
      `<div class="ego-title">${nameOf(dicts, nodeID)}</div>
       <table class="ego-table">
         <thead><tr><th>slice</th><th>deg</th><th>new</th><th>lost</th><th>overlap</th></tr></thead>
         <tbody>${rows.join("")}</tbody>
       </table>
       ${trimmed ? `<div class="ego-note">showing ${MAX_SHOWN} of ${total} neighbours — those who change group first, then the most persistent</div>` : ""}`);

    /* `explicit` records that the caller named the slice set rather than taking
       the rail's. presencePartition.js:899 does exactly that, passing the
       shift-clicked compare subset — which is shorter than window.currentSlices
       BY CONSTRUCTION, so a refresh() that compares the two would find them
       different on every single rail click and fall back to a full re-render,
       silently re-rendering the compare view over the whole timeline and
       throwing away both the hover and the point of not re-rendering. */
    current = { nodeID, hovered: null, labels, gGrid, sliceIdx, sig,
                explicit: !!(labelsOpt && labelsOpt.length >= 2),
                dataset: window.currentDataset };
  }

  /* Called from the slice loader after the chart is rebuilt.
     This used to re-run show(), because the wedges described one slice and
     moving to another invalidated them. The bands no longer describe a slice —
     they hold all of them — so the only thing a slice change alters is which
     ring is drawn as "you are here". Updating that in place is the point of the
     redesign: the spokes must not move under someone stepping through time, and
     a re-render would also discard their hover and re-run the crowd clustering
     for an identical result.

     A different SLICE SET, though, is a different dataset, and that does need a
     full rebuild. */
  function refresh() {
    if (!current || current.nodeID == null) return;

    /* A widget built from an EXPLICIT slice set belongs to whoever named it
       (the presence-partition compare view), and the main rail is not its
       basis — so it is never rebuilt from window.currentSlices. A dataset
       change still invalidates it, because the node ids themselves change. */
    if (!current.explicit) {
      const now = window.currentSlices || [];
      const same = current.labels && current.labels.length === now.length
        && current.labels.every((l, i) => l === now[i]);
      if (!same || !current.gGrid) { show(current.nodeID); return; }
    } else if (current.dataset !== window.currentDataset || !current.gGrid) {
      show(current.nodeID);
      return;
    }

    /* A slice outside this widget's set is not an error — in compare mode the
       rail can sit on a week the widget does not draw. Leave the emphasis where
       it is rather than guessing. */
    const i = current.labels.indexOf(window.currentYearRange);
    if (i < 0 || i === current.sliceIdx) return;
    current.sliceIdx = i;
    current.gGrid.selectAll(".ego-ring")
      .classed("ego-ring--active", d => !!d && d.ring === i);
    current.gGrid.selectAll(".ego-ring-label")
      .classed("ego-ring-label--active", d => !!d && d.ring === i);
  }

  window.EgoSpiral = { show, clear, refresh };

  // Show the affordance rather than an empty box before the first hover.
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", clear);
  else clear();
})();
