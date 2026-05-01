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

    // build DATASET buttons
    const dsButtons = datasetContainer.selectAll("button")
      .data(DATASET_KEYS)
      .enter()
      .append("button")
        .attr("class","btn btn-outline-primary btn-sm mx-1")
        .text(k => cfg[k]?.label || k)
        .on("click", function(event, key){
          if (window.currentDataset !== key) {
            selectedCommunitySpirals = [];
            globalHighlightNodesMap  = {};
            randomColorsByTimeslice  = {};
            updateCommunitySpiralSideWidget();
          }

          datasetContainer.selectAll("button").classed("active",false);
          d3.select(this).classed("active",true);

          window.currentDataset = key;
          loadAllYearsData(key).then(() => {
            runAlphaSelection(key);
            renderYearButtons(key);
          });
          loadAuthorMapping();
        });

    // auto-click first dataset if any
    if (DATASET_KEYS.length) datasetContainer.select("button").dispatch("click");
  })
  .catch(err => console.error("Failed to load datasets.config.json:", err));
});


function renderYearButtons(datasetKey){
  const ds = DATASETS_CONFIG[datasetKey];
  const slices = (ds?.slices || []).filter(s => s.enabled !== false);

  window.currentSlices = slices.map(s => s.label);

  yearContainer.selectAll("*").remove();

  const yBtns = yearContainer.selectAll("button")
    .data(slices, s => s.label)
    .enter()
    .append("button")
      .attr("class","btn btn-outline-secondary btn-sm mx-1")
      .text(s => s.label)
      .on("click", function(event, slice){
        yearContainer.selectAll("button").classed("active",false);
        d3.select(this).classed("active",true);

        // Keep the UI label as the current year range
        window.currentYearRange = slice.label;

        // Use the actual directory name for loading
        loadData(datasetKey, slice.dir);

        // Toggle alpha warning if it's the first slice
        const isFirstSlice = (window.currentSlices.indexOf(slice.label) === 0);
        const warningEl = document.getElementById('alphaFirstSliceWarning');
        if (warningEl) {
          if (isFirstSlice) warningEl.classList.remove('d-none');
          else warningEl.classList.add('d-none');
        }
      });

  if (slices.length) yearContainer.select("button").dispatch("click");
}


/* ─────────────────────────────────────────────────────
   LOAD cross-slice cache for the *selected dataset*
   ───────────────────────────────────────────────────*/
function loadAllYearsData(datasetKey){
  allYearsNodeData  = {};
  allYearsNodeLinks = {};
  allYearsCountData = {};

  const ds = DATASETS_CONFIG[datasetKey];
  const slices = (ds?.slices || []).filter(s => s.enabled !== false);

  const promises = [];

  slices.forEach(slice => {
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
            type       : r.type || "",
            community  : comm
          };
        });
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
    autoZoomOnSliceChangeV2({ massThreshold: 0.95, maxGroups: 5, pad: 40, duration: 400 });
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
