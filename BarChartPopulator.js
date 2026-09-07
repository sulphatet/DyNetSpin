/* ─────────────────────────────────────────────────────
   GLOBALS used by both File 1 and File 2
   ───────────────────────────────────────────────────*/
let coarse_graph_data;
let center_positions_spiral;
let link_data;
// holds the UI labels (e.g. ["2000-2004","2005-2009",…]) of the currently-loaded slices
window.currentSlices = [];

let node_to_node_link_data;

let DATASETS_CONFIG = null;     // loaded from JSON
let DATASET_KEYS = [];          // ordered list of enabled dataset keys

// ── Log-Hybrid α state ──────────────────────────────────────────
window.currentAlpha         = 0.6;    // current α (slider value)
window.currentBestAlpha     = 0.6;    // auto-computed best α
window.currentParetoResults = [];     // full sweep results [{alpha, tau, rho}]
window.currentRhoFloor      = 0.70;   // computed ρ floor
window.sliceDataForLogHybrid = [];    // raw slice data for the engine
window.allSliceSortedCounts  = [];    // sorted counts at current α (all slices)
window.currentSortedCountsForSlice = null; // sorted counts for the active slice

// Which dataset and year slice are currently visualised
window.currentDataset    = null;   // e.g. "data_vispub"
window.currentYearRange  = null;   // e.g. "2005-2009"

// Caches for ALL year-slices – used by drawNodeTimesliceChart (File 1)
let allYearsNodeData  = {};  // { yearRange : { nodeID : {centrality,type} } }
let allYearsNodeLinks = {};  // { yearRange : [ {source,target,type} ] }
let allYearsCountData = {};  // { yearRange : [ {community, count} ] }  ← for engine

/* ─────────────────────────────────────────────────────
   HELPER CHART DRAWERS – unchanged from your original
   (I left the bodies exactly as you had them.)
   ───────────────────────────────────────────────────*/
function showdata_count(data){
  data = data.map(d=>({x:d.community, y:+d.count}));
  var svg = d3.select("#barchart-no_of_nodes");
  initializeChart(svg),
  draw(data,"Community","Number_of_nodes","Number of nodes in each community");
}

function updateGraphStats(nodeArr, edgeArr) {
  d3.select("#nodeCount").text(nodeArr.length);   // total nodes
  d3.select("#edgeCount").text(edgeArr.length);   // total edges
}

function showdata_density(data){
  data = data.map(d=>({x:d.community, y:+d.density}));
  var svg = d3.select("#barchart-density");
  initializeChart(svg),
  draw(data,"Community","Density","Density of edges in each community");
}

function showdata_hdegree(data){
  data = data.map(d=>({x:d.community, y:+d.h_degree}));
  var svg = d3.select("#barchart-h_degree");
  initializeChart(svg),
  draw(data,"Community","Max-Degree","Max-Degree in each community");
}

function showdata_connectivity_heatmap(data){
  data = data.map(d=>({source:d.source,target:d.target,weight:+d.weight}));
  var svg = d3.select("#heatmap-connectivity");
  initializeChart(svg),
  draw_heatmap(data,"Community","Community","Community to community connections");
}

function show_table_data(data){
  var columns = Object.keys(data[0]).filter(d=>!(d==="x"||d==="y"||d==="new_x"||d==="new_y"));
  var header = thead.append("tr").selectAll("th").data(columns).enter().append("th")
      .text(d=>d)
      .on("click",function(d,da){ rows.sort((a,b)=>b[da]-a[da]); });
  var rows = tbody.selectAll("tr").data(data).enter().append("tr")
      .on("mouseover",function(){
        d3.select(this).style("background-color",d3.select(this).style("background-color")==="blue"?"blue":"orange");
      })
      .on("mouseout",function(){
        d3.select(this).style("background-color",d3.select(this).style("background-color")==="blue"?"blue":"transparent");
      });
  rows.selectAll("td").data(row=>columns.map(i=>({i,value:row[i]}))).enter().append("td").html(d=>d.value);
  d3.selectAll("tr").style("background-color",d=>d&&d.node==find_node_id?"blue":null);
}

/*  The massive spiral-drawing function from your original File 2 remains exactly the same.
    I only changed variable names to use the new globals, so the body is pasted verbatim. */
function showdata_spiral_community_chart(data){
  /* … your original 250-line function was pasted here unchanged … */
  // --- start original body ---
  //define height and width of svg
  let svg = d3.select("#chart");
  let bounds = svg.node().getBoundingClientRect();
  let width = bounds.width;
  let height = bounds.height;
  initializeSpiralChart(svg,height,width);

  coarse_graph_data = data[6];
  center_positions_spiral = string_to_numbers_graph_centers(coarse_graph_data);
  center_positions_spiral = transform_graph_centers(center_positions_spiral,height,width);
  center_positions_spiral.sort((a,b)=>d3.ascending(a.community,b.community));

  link_data = transform_link_data(data[2]);
  connections_list = data[4];
  extent_of_centralities_after_removing_outliers = data[5];
  optimal_no_of_nodes = opt_no_of_nodes(data[6]);
  node_to_node_link_data = transform_node_to_node_link_data(data[3]);

  data = transform_data(data[0]);
  // First/last slice have an unobserved neighbour, so their precomputed
  // incoming/outgoing states are sentinel artifacts. Correct before anything
  // downstream reads `type` (colour, legend, charts, ego widget).
  data = correctBoundaryStates(data);
  data = computing_spiral_positions(center_positions_spiral,data,height,width);
  global_data = data;
  global_data_unchanged = data;
  global_data_sorted = data;
  global_data_sorted.sort((a,b)=>d3.descending(a.node,b.node));
  global_data = global_data_sorted;

  let prepare_data = [];
  unique_communities = new Set(global_data_unchanged.map(d=>d.community));
  unique_communities.forEach(entry=>{
    community_data = global_data_unchanged.filter(d=>d.community==entry);
    community_data.sort((a,b)=>d3.descending(a.centrality,b.centrality));
    prepare_data.push(...community_data);
  });
  prepare_data = computing_spiral_positions(center_positions_spiral,prepare_data,height,width);
  global_data = prepare_data;
  global_data_unchanged = prepare_data;

  updateGraphStats(global_data, node_to_node_link_data);

  draw_spiral_community();
  // --- end original body ---
}

/* ─────────────────────────────────────────────────────
   CLEAR every chart/container before loading a new slice
   ───────────────────────────────────────────────────*/
function clearCharts(){
  d3.selectAll("#barchart-no_of_nodes,#heatmap-connectivity,#barchart-h_degree,#barchart-density,#chart,#community_spiral,#community_textbox,#node_textbox,#community_histogram,#table-location").selectAll("*").remove();
}

/* ─────────────────────────────────────────────────────
   DATASET + YEAR buttons
   ───────────────────────────────────────────────────*/
const datasetContainer = d3.select("#dataset-buttons");
const yearContainer    = d3.select("#year-buttons");

window.addEventListener("load", () => {
  d3.json("data/datasets.config.json").then(cfg => {
    DATASETS_CONFIG = cfg;

    // derive enabled dataset keys preserving file order
    DATASET_KEYS = Object.keys(cfg).filter(k => cfg[k]?.enabled !== false);

    /* Build the DATASET picker as a two-level grouping rather than one flat
       row of buttons.

       The two levels are the two things that actually decide how a reader
       should treat a dataset, and they are independent of each other:

         source  where the partition comes from -- an attribute the data
                 already carries, or Louvain run on each timeslice. This is the
                 difference between "these groups are ground truth" and "these
                 groups are one detector's opinion, renumbered every slice".
         label   what the name drawn on a community MEANS. A given partition
                 names itself (a department is a department); a detected one
                 has no name of its own, so the tool derives one, and which
                 rule it used is not guessable from the picture.

       Both come from `community` in datasets.config.json, so adding a dataset
       is a config edit and this function needs no change. A dataset with no
       `community` block falls into "Unclassified" rather than vanishing. */
    const COMMUNITY_SOURCE_HEADINGS = {
      given:    "Given by the data",
      detected: "Detected per timeslice",
      unknown:  "Unclassified"
    };
    const SOURCE_ORDER = ["given", "detected", "unknown"];

    const meta = k => cfg[k]?.community || {};
    const srcOf = k => {
      const s = meta(k).source;
      return SOURCE_ORDER.indexOf(s) >= 0 ? s : "unknown";
    };

    // source -> label -> [keys], preserving config order inside each bucket
    const grouped = new Map();
    DATASET_KEYS.forEach(k => {
      const src = srcOf(k), sub = meta(k).label || "unspecified";
      if (!grouped.has(src)) grouped.set(src, new Map());
      const subs = grouped.get(src);
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub).push(k);
    });

    /* Which section opens on load: the one holding the dataset that is about
       to be auto-selected. Opening all of them defeats the collapse, and
       opening a fixed one hides the dataset the user is looking at. */
    const openSrc = DATASET_KEYS.length ? srcOf(DATASET_KEYS[0]) : null;

    SOURCE_ORDER.forEach(src => {
      const subs = grouped.get(src);
      if (!subs) return;
      const count = [...subs.values()].reduce((n, a) => n + a.length, 0);
      const section = datasetContainer.append("div")
        .attr("class", "ds-group")
        .classed("ds-group--open", src === openSrc);

      /* The header stays legible collapsed: it names the category and says how
         many datasets are inside, so a closed section is still an answer to
         "where is the ground-truth data" rather than a shut drawer. */
      const head = section.append("button")
        .attr("class", "ds-group__head")
        .attr("type", "button")
        .attr("aria-expanded", src === openSrc ? "true" : "false");
      head.append("span").attr("class", "ds-group__chev").html("&#9656;");
      head.append("span").attr("class", "ds-group__title")
        .text(COMMUNITY_SOURCE_HEADINGS[src]);
      head.append("span").attr("class", "ds-group__count").text(count);

      const body = section.append("div").attr("class", "ds-group__body");
      head.on("click", () => {
        const open = !section.classed("ds-group--open");
        section.classed("ds-group--open", open);
        head.attr("aria-expanded", open ? "true" : "false");
      });

      // One phrase, once, for the whole section -- every dataset in a section
      // shares its basis by construction of the taxonomy.
      const bases = [...new Set([...subs.values()].flat()
                                .map(k => meta(k).basis).filter(Boolean))];
      if (bases.length === 1) {
        body.append("div").attr("class", "ds-group__basis").text(bases[0]);
      }

      subs.forEach((keys, sub) => {
        const block = body.append("div").attr("class", "ds-sub");
        block.append("div").attr("class", "ds-sub__head").text("named by " + sub);
        block.append("div").attr("class", "ds-sub__btns")
          .selectAll("button").data(keys).enter()
          .append("button")
            .attr("class", "btn btn-outline-primary btn-sm ds-btn")
            /* The tooltip carries the per-dataset detail that would otherwise
               fragment the grouping -- the specific noun behind a shared rule,
               or a naming rule that is one dataset's own. */
            .attr("title", k => {
              const m = meta(k), name = cfg[k]?.label || k;
              if (!m.basis) return name;
              /* A given partition IS the attribute -- nothing derives its
                 name, so "named by" would be wrong. A detected one has no
                 name of its own and the rule that supplies one is the thing
                 worth stating. */
              return m.source === "given"
                ? `${name} — ${m.basis}: ${m.note || m.label}.`
                : `${name} — ${m.basis}; each community is named by ${m.note || m.label}.`;
            })
            .text(k => cfg[k]?.label || k)
            .on("click", datasetClicked);
      });
    });

    function datasetClicked(event, key){
          if (window.currentDataset !== key) {
            selectedCommunitySpirals = [];
            globalHighlightNodesMap  = {};
            randomColorsByTimeslice  = {};
            updateCommunitySpiralSideWidget();
          }

          datasetContainer.selectAll("button").classed("active",false);
          d3.select(this).classed("active",true);

          window.currentDataset = key;
          window.tsLevel = "fine";          // always start a dataset at its fine level
          loadAllYearsData(key).then(() => {
            runAlphaSelection(key);
            renderYearButtons(key);
            // AFTER the slice cache resolves: the search list is derived from
            // allYearsNodeData, and calling this alongside loadAllYearsData
            // (as it used to be) ran it against an empty cache, leaving the
            // datalist with zero options on every dataset.
            loadAuthorMapping();
          });
    }

    /* Auto-select the first dataset in CONFIG order, not the first in DOM
       order. Grouping reorders the buttons, so `select("button")` would now
       open whichever dataset happens to sort into the first section rather
       than the one the config puts first. */
    if (DATASET_KEYS.length) {
      const firstKey = DATASET_KEYS[0];
      const firstBtn = datasetContainer.selectAll("button")
        .filter(k => k === firstKey);
      (firstBtn.empty() ? datasetContainer.select("button") : firstBtn)
        .dispatch("click");
    }
  })
  .catch(err => console.error("Failed to load datasets.config.json:", err));
});


/* ── Timeline granularity model ───────────────────────────────────────────
   Each dataset has a FINE level (default) and a COARSE roll-up level. The rail
   shows the fine slices grouped into coloured coarse "bands"; clicking a band
   chip rolls up to the coarse level, and a ◀ back button returns to fine.
   Cohort snapshots (node-id arrays) survive the switch — see setTsLevel. */

window.tsLevel = window.tsLevel || "fine";  // "fine" | "coarse"
const TS_BAND_HUES = ["#0071e3","#e8890c","#34a853","#a142f4","#00a1b0","#d93b6c","#8a8d00","#6b5bd2"];

function datasetHasChildren(ds){
  return (ds?.slices || []).some(s => (s.children || []).filter(c => c.enabled !== false).length);
}

// Active-level slice list. Fine = flattened children (tagged with parent index
// + label); coarse (or a childless dataset) = the top-level slices.
function activeLevelSlices(datasetKey){
  const ds = DATASETS_CONFIG[datasetKey];
  const coarse = (ds?.slices || []).filter(s => s.enabled !== false);
  if (window.tsLevel === "coarse" || !datasetHasChildren(ds)){
    return coarse.map((s, i) => ({ label:s.label, dir:s.dir, parentIdx:i, parentLabel:s.label }));
  }
  const out = [];
  coarse.forEach((s, i) => {
    (s.children || []).filter(c => c.enabled !== false)
      .forEach(c => out.push({ label:c.label, dir:c.dir, parentIdx:i, parentLabel:s.label }));
  });
  return out;
}

// Switch granularity: reload the active level's cross-slice cache + α sweep,
// re-render the rail, and let updateCommunitySpiralSideWidget re-render any
// cohort snapshots against the new level (loadData does this).
function setTsLevel(level, preferDir){
  window.tsLevel = level;
  const key = window.currentDataset;
  if (!key) return;
  loadAllYearsData(key).then(() => {
    runAlphaSelection(key);
    renderYearButtons(key, preferDir);
  });
}

// Per-slice temporal-state breakdown for the event-strip minis.
function sliceStateBreakdown(label){
  const dict = allYearsNodeData[label];
  if (!dict) return null;
  const c = { incoming:0, outgoing:0, outandin:0, stable:0 };
  Object.values(dict).forEach(n => {
    if (n.type === "incoming")      c.incoming++;
    else if (n.type === "outgoing") c.outgoing++;
    else if (n.type === "outandin") c.outandin++;
    else                            c.stable++;
  });
  c.total = c.incoming + c.outgoing + c.outandin + c.stable;
  c.churn = c.total ? (c.total - c.stable) / c.total : 0;
  return c;
}

/* ── presence wash on the time rail ──────────────────────────────────────────
   Hovering a node fades the slices that node is not in, so "when did this
   person exist" is answerable without stepping through every week to find out.
   The main chart is a snapshot and cannot say it; the rail is the only surface
   in the layout that is already a timeline.

   PRESENCE, deliberately, not adjacency — "is this person in the data that
   week", read from the slice node tables. The Ego Spiral answers the adjacency
   question ("who were they connected to, and when") and answering a different
   question with the same mark in two places is how the two views end up
   contradicting each other.

   Passing null clears. Callers must clear on mouseout AND on slice load: the
   rail is rebuilt from scratch on a dataset or granularity change, and a wash
   left behind would then describe a node nobody is hovering. */
function markSlicePresence(nodeID){
  const btns = document.querySelectorAll("#year-buttons .ts-btn, #ts-unfurl .ts-btn");
  if (!btns.length) return;
  if (nodeID === null || nodeID === undefined
      || typeof allYearsNodeData === "undefined") {
    btns.forEach(b => b.classList.remove("ts-btn--nodeabsent"));
    return;
  }
  const id = +nodeID;
  btns.forEach(b => {
    const label = b.dataset ? b.dataset.sliceLabel : null;
    // A button with no slice label is a band chip in the coarse roll-up, which
    // stands for several slices at once and so has no single answer here.
    const dict = label ? allYearsNodeData[label] : null;
    b.classList.toggle("ts-btn--nodeabsent", !!dict && !dict[id]);
  });
}
window.markSlicePresence = markSlicePresence;

function renderYearButtons(datasetKey, preferDir){
  const ds = DATASETS_CONFIG[datasetKey];
  const active = activeLevelSlices(datasetKey);
  window.currentSlices = active.map(s => s.label);

  // Guidance layer: state shares per slice, and the interior slice with the
  // highest churn. Boundary slices are excluded from the "hot" marker — their
  // states are forced (all Incoming at t=0, all Outgoing at t=T−1), so they
  // would always win without carrying any signal.
  const breakdowns = {};
  active.forEach(s => { breakdowns[s.label] = sliceStateBreakdown(s.label); });
  let hotLabel = null, hotChurn = -1;
  active.slice(1, -1).forEach(s => {
    const b = breakdowns[s.label];
    if (b && b.total && b.churn > hotChurn){ hotChurn = b.churn; hotLabel = s.label; }
  });

  const viewport = document.getElementById("year-buttons");
  const upBtn    = document.getElementById("tsUp");
  const downBtn  = document.getElementById("tsDown");
  const unfurl   = document.getElementById("ts-unfurl");
  if (!viewport) return;
  viewport.innerHTML = "";
  if (unfurl){ unfurl.hidden = true; unfurl.innerHTML = ""; }

  function clearActive(){
    document.querySelectorAll("#timeStrip .ts-btn.active").forEach(b => b.classList.remove("active"));
  }
  function selectSlice(btn, label, dir){
    clearActive();
    btn.classList.add("active");
    window.currentYearRange = label;
    loadData(datasetKey, dir);
    const warn = document.getElementById("alphaFirstSliceWarning");
    if (warn) warn.classList.toggle("d-none", window.currentSlices.indexOf(label) !== 0);
  }
  function mkBtn(s){
    const btn = document.createElement("button");
    btn.className = "ts-btn ts-btn--banded";
    btn.textContent = s.label;
    btn.title = s.label;
    btn.dataset.dir = s.dir;
    btn.dataset.sliceLabel = s.label;
    btn.style.setProperty("--hue", TS_BAND_HUES[s.parentIdx % TS_BAND_HUES.length]);
    btn.addEventListener("click", (ev) => {
      // Shift-click: toggle this slice into the presence-partition compare
      // mode instead of navigating to it.
      if (ev.shiftKey && window.PresencePartition){
        window.PresencePartition.toggle(s.label, s.dir);
        return;
      }
      selectSlice(btn, s.label, s.dir);
    });

    const b = breakdowns[s.label];
    if (b && b.total){
      btn.title = `${s.label} — Incoming ${b.incoming} · Outgoing ${b.outgoing}`
                + ` · Transient ${b.outandin} · Stable ${b.stable}`;
      const SC = window.STATE_COLORS || {};
      const mini = document.createElement("span");
      mini.className = "ts-mini";
      [["incoming", SC.incoming], ["outgoing", SC.outgoing],
       ["outandin", SC.both],     ["stable",   SC.stable]].forEach(([k, col]) => {
        const v = (k === "stable") ? b.stable : b[k];
        if (!v) return;
        const seg = document.createElement("i");
        seg.style.flexGrow = v;
        seg.style.background = col || "#999";
        mini.appendChild(seg);
      });
      btn.appendChild(mini);
      if (s.label === hotLabel){
        btn.classList.add("ts-btn--hot");
        const pct = Math.round(b.churn * 100);
        btn.title += ` · highest churn (${pct}%)`;
        // Real element (not ::after) so the dot has its own hover tooltip.
        const dot = document.createElement("span");
        dot.className = "ts-hot-dot";
        dot.title = `Highest churn: ${pct}% of nodes in ${s.label} are `
                  + `Incoming, Outgoing, or Transient — the most volatile `
                  + `interior slice of this dataset.`;
        btn.appendChild(dot);
      }
    }
    return btn;
  }

  const banded = (window.tsLevel === "fine") && datasetHasChildren(ds);

  // Coarse view: a ◀ back button to return to the finer default.
  if (window.tsLevel === "coarse" && datasetHasChildren(ds)){
    const back = document.createElement("button");
    back.className = "ts-back";
    back.innerHTML = '<i class="bi bi-chevron-left"></i>';
    back.title = "Back to finer slices";
    back.addEventListener("click", () => setTsLevel("fine", window.tsLastFineDir));
    viewport.appendChild(back);
  }

  if (banded){
    // Group contiguous fine slices by their coarse parent → coloured band + chip.
    let gi = 0;
    while (gi < active.length){
      const pIdx = active[gi].parentIdx;
      const group = [];
      while (gi < active.length && active[gi].parentIdx === pIdx){ group.push(active[gi]); gi++; }
      const hue = TS_BAND_HUES[pIdx % TS_BAND_HUES.length];
      const groupEl = document.createElement("div");
      groupEl.className = "ts-group";
      groupEl.style.setProperty("--hue", hue);
      const chip = document.createElement("button");
      chip.className = "ts-band";
      chip.textContent = group[0].parentLabel;
      chip.title = "Roll up to " + group[0].parentLabel;
      chip.addEventListener("click", () => {
        window.tsLastFineDir = group[0].dir;
        setTsLevel("coarse", ds.slices[pIdx].dir);
      });
      groupEl.appendChild(chip);
      const col = document.createElement("div");
      col.className = "ts-group-col";
      group.forEach(s => col.appendChild(mkBtn(s)));
      groupEl.appendChild(col);
      viewport.appendChild(groupEl);
    }
  } else {
    active.forEach(s => viewport.appendChild(mkBtn(s)));
  }

  // ▲/▼ arrows appear only when the stack overflows the viewport.
  function refreshArrows(){
    if (!upBtn || !downBtn) return;
    const overflow = viewport.scrollHeight > viewport.clientHeight + 2;
    upBtn.hidden = downBtn.hidden = !overflow;
    if (overflow){
      upBtn.disabled   = viewport.scrollTop <= 0;
      downBtn.disabled = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
    }
  }
  if (upBtn && !upBtn.dataset.wired){
    upBtn.dataset.wired = "1";
    upBtn.addEventListener("click", () => { viewport.scrollBy({top:-140,behavior:"smooth"}); setTimeout(refreshArrows,300); });
    downBtn.addEventListener("click", () => { viewport.scrollBy({top:140,behavior:"smooth"}); setTimeout(refreshArrows,300); });
    viewport.addEventListener("scroll", refreshArrows);
  }
  setTimeout(refreshArrows, 0);

  // Initial selection: preferred dir (e.g. after a roll-up) else the first slice.
  let target = preferDir ? viewport.querySelector('.ts-btn[data-dir="' + preferDir + '"]') : null;
  if (!target) target = viewport.querySelector(".ts-btn");
  if (target) target.click();
}


/* ─────────────────────────────────────────────────────
   LOAD cross-slice cache for the *selected dataset*
   ───────────────────────────────────────────────────*/
function loadAllYearsData(datasetKey){
  allYearsNodeData  = {};
  allYearsNodeLinks = {};
  allYearsCountData = {};

  // Load the ACTIVE granularity level (fine by default, coarse when rolled up).
  // Set currentSlices now so the α sweep (runAlphaSelection → buildSliceData)
  // sees the correct level's labels before renderYearButtons runs.
  const slices = activeLevelSlices(datasetKey);
  window.currentSlices = slices.map(s => s.label);

  const promises = [];

  const sliceCount = slices.length;

  slices.forEach((slice, sliceIndex) => {
    const yearLabel = slice.label;   // cache keyed by label for UI lookups
    const yearDir   = slice.dir;     // actual folder path

    let pNodes = d3.csv(`data/${datasetKey}/${yearDir}/facebook_data_transformed_new.csv`)
      .then(csvData => {
        const dict = {};
        csvData.forEach(r => {
          const comm = r.community !== undefined     ? +r.community :
                       r["community "] !== undefined ? +r["community "] :
                       r.Community !== undefined     ? +r.Community :
                       undefined;
          dict[+r.node] = {
            centrality : +r.centrality,
            // Raw as-built state; LocalVolatility.applyToDict below names the
            // fourth state and, at boundary slices, replaces the unobservable
            // half of the ±1 window with the half that was observed.
            rawType    : r.type || "",
            type       : r.type || "",
            community  : comm,
            name       : r.name || "",
            anchor     : r.anchor_name || ""
          };
        });
        if (window.LocalVolatility) {
          window.LocalVolatility.applyToDict(dict, sliceIndex, sliceCount);
        }
        allYearsNodeData[yearLabel] = dict;
      });

    let pEdges = d3.csv(`data/${datasetKey}/${yearDir}/node_to_node_link_data.csv`)
      .then(edges => {
        edges.forEach(e => { e.source=+e.source; e.target=+e.target; });
        allYearsNodeLinks[yearLabel] = edges;
      });

    // Also load community counts for the Log-Hybrid engine
    let pCounts = d3.csv(`data/${datasetKey}/${yearDir}/commuity_count.csv`)
      .then(csvData => {
        const counts = csvData.map(r => ({
          community: +(r.community !== undefined ? r.community :
                       r.Community !== undefined ? r.Community : 0),
          count:     +(r.count !== undefined ? r.count :
                       r.Count !== undefined ? r.Count : 0)
        }));
        allYearsCountData[yearLabel] = counts;
      });

    promises.push(pNodes, pEdges, pCounts);
  });

  return Promise.all(promises);
}

/**
 * Run the Pareto α selection after all year data is loaded.
 * Sets globals: currentBestAlpha, currentAlpha, allSliceSortedCounts, etc.
 */
function runAlphaSelection(datasetKey) {
  // Build sliceData for the engine
  window.sliceDataForLogHybrid = buildSliceData(
    datasetKey, DATASETS_CONFIG, allYearsNodeData, allYearsCountData
  );

  if (window.sliceDataForLogHybrid.length < 2) {
    console.warn('[Pareto] Not enough slices for α selection, defaulting to 0.6');
    window.currentBestAlpha = 0.6;
    window.currentAlpha = 0.6;
    window.currentParetoResults = [];
    window.currentRhoFloor = 0.70;
    window.allSliceSortedCounts = [];
    return;
  }

  // Run the sweep
  var result = findBestAlpha(window.sliceDataForLogHybrid, 0.05);

  window.currentBestAlpha     = result.bestAlpha;
  window.currentAlpha         = result.bestAlpha;
  window.currentParetoResults = result.paretoResults;
  window.currentRhoFloor      = result.rhoFloor;

  // Pre-compute sorted counts for all slices at the best α
  window.allSliceSortedCounts = logHybridSort(
    window.sliceDataForLogHybrid, result.bestAlpha
  );

  console.log('[Pareto] Dataset "' + datasetKey + '": α*=' +
              result.bestAlpha.toFixed(2) + ', ρ_floor=' +
              result.rhoFloor.toFixed(3));

  // Sync the slider UI (if function exists — it's defined in settings1.js)
  if (typeof syncAlphaSliderUI === 'function') syncAlphaSliderUI();
}

/* ─────────────────────────────────────────────────────
   LOAD one DATASET × YEAR, build the whole viz
   ───────────────────────────────────────────────────*/
function loadData(datasetKey, yearDir){
  if(!datasetKey || !yearDir) return;

  clearCharts();
  let table=d3.select("#table-location").append("table").attr("class","table table-condensed table-striped");
  table.append("thead");
  table.append("tbody");

  Promise.all([
    d3.csv(`data/${datasetKey}/${yearDir}/facebook_data_transformed_new.csv`),
    d3.csv(`data/${datasetKey}/${yearDir}/coarse_graph_pos.csv`),
    d3.csv(`data/${datasetKey}/${yearDir}/link_data.csv`),
    d3.csv(`data/${datasetKey}/${yearDir}/node_to_node_link_data.csv`),
    d3.json(`data/${datasetKey}/${yearDir}/connection_list.json`),
    d3.json(`data/${datasetKey}/${yearDir}/new_extent_without_outliers_for_colorcoding.json`),
    d3.csv(`data/${datasetKey}/${yearDir}/commuity_count.csv`)
  ])
  .then(dataArr=>{
    // ── Use engine-sorted community counts if available ──
    const currentSliceIndex = window.currentSlices.indexOf(window.currentYearRange);

    // Name the fourth state, and at the first/last slice encode the observed
    // half of the ±1 window instead of the half the data cannot support.
    // Done here, once, so every consumer of dataArr[0] stays unchanged.
    if (window.LocalVolatility) {
      window.LocalVolatility.applyToRows(
        dataArr[0], currentSliceIndex, window.currentSlices.length);
    }
    if (window.allSliceSortedCounts.length > 0 && currentSliceIndex >= 0 &&
        window.allSliceSortedCounts[currentSliceIndex]) {
      // Replace the raw commuity_count.csv data (dataArr[6]) with engine-sorted data
      const sorted = window.allSliceSortedCounts[currentSliceIndex];
      // Convert to the CSV-row format the rest of the code expects
      const sortedCSV = sorted.map(r => ({ community: String(r.community), count: String(r.count) }));
      dataArr[6] = sortedCSV;
      window.currentSortedCountsForSlice = sorted;
    }

    showdata_spiral_community_chart(dataArr);
    updateCommunitySpiralSideWidget();
    /* The ego bands span every slice, so this no longer rebuilds the widget —
       refresh() only moves the "you are here" ring. It is still called here
       rather than from the rail click, so the emphasis moves when the slice has
       actually LOADED and the two views can never disagree. */
    if (window.EgoSpiral && window.EgoSpiral.refresh) window.EgoSpiral.refresh();
    // The rail is rebuilt on dataset/granularity change, and a stale presence
    // wash would survive that as a class on buttons for a different node.
    markSlicePresence(null);
    autoZoomOnSliceChangeV2({ massThreshold: 0.95, maxGroups: 5, pad: 40, duration: 400 });
    // Single signal the all-slices views ride: the Community Evolution overview
    // rebuilds on it (dataset / granularity change) and uses it to fire a
    // deferred cohort snapshot once the requested slice is on screen.
    document.dispatchEvent(new CustomEvent("dyn:slice-loaded",
      { detail: { label: window.currentYearRange } }));
  })
  .catch(err=>console.error("Error loading slice:",err));
}

// Centers on the dominant survivor community, then fits enough survivors
// to reach a mass threshold (relative to the ORIGINAL community size).
// Stateless: ignores current transform, so going T1→T2 is reproducible
// no matter what you did in between.
// Centers on the weighted centroid of survivor communities in the next slice,
// fits enough communities to reach a cumulative mass threshold (mass = survivors / |A|),
// and nudges up by a fixed number of pixels to keep content within the chart.
//
// Call AFTER draw_spiral_community() and updateCommunitySpiralSideWidget()
function autoZoomOnSliceChangeV2({
  massThresholdPerSel = 0.95,
  maxGroupsPerSel     = 5,
  pad                 = 40,
  nudgeUpPx           = 140,   // POSITIVE = move content up (intuitive)
  duration            = 4500,
  minScale            = 0.08,  // don’t zoom out beyond this
  maxScale            = 6.0,   // clip extreme zoom-ins
  singleMaxScale      = 3.0    // optional softer cap if only one community survives
} = {}) {
  if (!selectedCommunitySpirals.length || !window.global_data) {
    // If nothing is selected, fall back to fitting the entire spiral nicely to the screen
    if (window.SpinTrixMainZoom && window.SpinTrixMainZoom.fitAll) {
      window.SpinTrixMainZoom.fitAll(400, 40);
    }
    return;
  }

  const svg = d3.select("#chart").node().tagName.toLowerCase()==="svg"
              ? d3.select("#chart")
              : d3.select("#chart").select("svg");
  if (svg.empty()) return;

  const W = svg.node().clientWidth  || +svg.attr("width")  || 800;
  const H = svg.node().clientHeight || +svg.attr("height") || 600;

  // Ensure a zoom behavior exists
  const z = d3.zoom()
              .scaleExtent([minScale, maxScale]) // also cap user wheel/pinch
              .on("zoom", ev => d3.select("#gPanRoot").attr("transform", ev.transform));
  svg.call(z);

  const cur = new Map(global_data.map(n => [n.node, n]));

  const centroid = ids => {
    const pts = ids.map(id => cur.get(id)).filter(Boolean);
    return pts.length ? { x:d3.mean(pts, p=>p.x), y:d3.mean(pts, p=>p.y) } : {x:0, y:0};
  };
  const bbox = ids => {
    const pts = ids.map(id => cur.get(id)).filter(Boolean);
    if (!pts.length) return null;
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    return { x0:d3.min(xs), x1:d3.max(xs), y0:d3.min(ys), y1:d3.max(ys) };
  };

  // ---- survivors per selection (unchanged logic) ----
  let unionIDs = new Set();
  const selections = [];

  selectedCommunitySpirals.forEach(sel => {
    const original  = new Set(sel.originalNodeData.map(n => n.node));
    const survivors = [...original].filter(id => cur.has(id));
    if (!survivors.length) return;

    const byComm = d3.group(survivors, id => cur.get(id).community);
    const groups = Array.from(byComm, ([c, ids]) => ({
      community: c,
      ids,
      mass: ids.length / original.size
    })).sort((a,b)=>d3.descending(a.mass, b.mass));

    const kept = [];
    let covered = 0;
    for (const g of groups) {
      if (kept.length >= maxGroupsPerSel) break;
      kept.push(g);
      covered += g.mass;
      if (covered >= massThresholdPerSel) break;
    }

    const keptIDs = kept.flatMap(g => g.ids);
    keptIDs.forEach(id => unionIDs.add(id));
    selections.push({
      weight: survivors.length / original.size,
      centroid: centroid(keptIDs),
      ids: keptIDs
    });
  });

  if (!selections.length) {
    if (window.SpinTrixMainZoom && window.SpinTrixMainZoom.fitAll) {
      window.SpinTrixMainZoom.fitAll(400, 40);
    }
    return;
  }

  // ---- weighted centroid & bbox ----
  const Wsum = d3.sum(selections, s => s.weight) || 1;
  const Cx   = d3.sum(selections, s => s.weight * s.centroid.x) / Wsum;
  const Cy   = d3.sum(selections, s => s.weight * s.centroid.y) / Wsum;

  const bb = bbox([...unionIDs]);
  if (!bb) return;

  const dx = Math.max(bb.x1 - bb.x0, 1e-6);
  const dy = Math.max(bb.y1 - bb.y0, 1e-6);
  const sRaw = Math.min((W - 2*pad)/dx, (H - 2*pad)/dy);

  // Optional: if union touches only one community, soften the max zoom
  const unionCommunities = new Set([...unionIDs].map(id => cur.get(id)?.community));
  const localMax = (unionCommunities.size <= 1)
    ? Math.min(maxScale, singleMaxScale)
    : maxScale;

  // Clip to caps
  const s = Math.max(minScale, Math.min(localMax, sRaw));

  // Intuitive screen-pixel nudge: positive value moves content UP
  const target = d3.zoomIdentity
                  .translate(
                    W/2 - s*Cx,
                    H/2 - s*Cy - nudgeUpPx   // note the minus: +nudge = up
                  )
                  .scale(s);

  svg.transition().duration(duration).call(z.transform, target);
}
