//these variables are used to update the charts based on settings
var global_data;
var global_data_unchanged;
var global_data_sorted;//
let gBrush;
let brush;
let brushFlag = 0;
let densityColFlag = 0;
let degreeColFlag = 0;
let closenessColFlag = 0;
let betweennessColFlag = 0;
let volatilityColFlag = 0;
let eignColFlag = 0;
let global_radius = 2;
let new_data1;
// This will hold up to 3 selected communities from potentially different timeslices
let selectedCommunitySpirals = [];
// Holds the mapping from node ID to its highlight color (e.g., gold, magenta, or green)
let globalHighlightNodesMap = {};


let find_node_id = -1;
//let optimal_no_of_nodes =0;

// NEW GLOBAL VARIABLES for community selection
var selectedCommunity = null;       // holds the currently selected community id
var selectedCommunityNodes = [];    // holds the full node objects from when the community was selected

// NEW GLOBAL VARIABLES to persist the highlighted nodes across timeslices
var highlightNodes = [];            // list of node IDs (numbers) to be highlighted in the main view
var persistentCommunityData = [];   // the full node objects (from the timeslice when clicked)


var flag_most_connected_nodes = 0;
var most_connected_nodes_data;
var connections_list;
var extent_of_centralities_after_removing_outliers;

var activeCommunity =200;

var     idleTimeout,
idleDelay = 350;

var highlight_table_node = -1;

// Safe wrapper to avoid "t is undefined" for selection.call(...)
// Safe wrapper to use with both selections *and* transitions
function safeCall(selOrTr, fn, ...args) {
  if (typeof fn !== "function") return selOrTr;
  if (selOrTr && typeof selOrTr.call === "function") {
    selOrTr.call(fn, ...args);   // works for selections and transitions
  }
  return selOrTr;
}

// ── Main canvas zoom/pan state ─────────────────────────────────────
let mainZoom = null;
let mainZoomRoot = null;       // the <g> we actually transform
let currentTransform = d3.zoomIdentity;
const MAIN_ZOOM_EXTENT = [0.05, 40]; // "infinite-ish" range
let lodOverlayG = null;         // LOD group (aggregated view on far zoom-out)
let USE_BRUSH = false;          // turn off brush in favor of zoom/pan


var table = d3.select("#table-location")
    .append("table")
    .attr("class", "table table-condensed table-striped"),
    thead = table.append("thead"),
    tbody = table.append("tbody");

//--- ADDED FOR LOCAL VOLATILITY ---
let localVolatilityColFlag = 1;       // 0 => off, 1 => on
let localVolatilityCenteringFlag = 0; // 0 => off (default: rank by degree), 1 => reorder outandin->incoming->outgoing->neither

// Robust "invisible brush" that survives dataset switches
function ensureBrushSkeleton() {
  // Find the current SVG (after a slice change, the old one is gone)
  const chartSel = d3.select("#chart");
  const svgSel = chartSel.node()?.tagName?.toLowerCase() === "svg"
    ? chartSel
    : chartSel.select("svg");

  if (svgSel.empty()) {
    // Not ready yet (initializeSpiralChart hasn’t run)
    return false;
  }

  // Prefer your pan root if present; otherwise use (or create) a top-level <g>
  let panRoot = svgSel.select("#gPanRoot");
  if (panRoot.empty()) {
    // Fall back to a top-level <g>; this is safe and will be adopted later by SpinTrixMainZoom
    panRoot = svgSel.select("g").empty()
      ? svgSel.append("g")
      : svgSel.select("g");
  }

  // Keep the global reference 'g' pointing at the current, live <g>
  window.g = panRoot;

  // Ensure a brush group exists under the current root
  gBrush = panRoot.select(".brush");
  if (gBrush.empty()) gBrush = panRoot.append("g").attr("class", "brush");

  // Ensure the brush behavior exists
  if (!window.brush) window.brush = d3.brush();

  // Bind once, but keep it invisible (we just want a valid selection for .move(null))
  try {
    gBrush.call(window.brush).style("display", "none");
  } catch (e) {
    console.warn("ensureBrushSkeleton(): brush bind failed (SVG not fully ready yet).", e);
    return false;
  }
  return true;
}

function clearBrushSafely() {
  const svgSel = d3.select("#chart").select("svg");
  if (svgSel.empty()) return;
  let root = svgSel.select("#gPanRoot");
  if (root.empty()) root = svgSel.select("g");
  const brushG = root.select(".brush");

  if (!brushG.empty() && window.brush) {
    try { brushG.call(window.brush.move, null); } catch (_) {}
  }
}


function show_edge_tooltip(source, target, weight){
  //d3.select("#connection_tooltip").html("Community "+ source +" and " +target+ " share "+ weight + " links.")
}
// Move any direct child of the main <svg> *under* the pan root, so zoom moves it.
function adoptLooseChildren() {
  const host = d3.select("#chart");
  if (host.empty()) return;
  const svgSel = host.node().tagName.toLowerCase() === "svg" ? host : host.select("svg");
  if (svgSel.empty()) return;
  const panRoot = svgSel.select("#gPanRoot");
  if (panRoot.empty()) return;

  [...svgSel.node().children].forEach(n => {
    if (n.id !== "gPanRoot" && n.id !== "lodOverlay" && n.id !== "hudOverlay") {
      panRoot.node().appendChild(n);
    }
  });
}



function draw_textbox(data, adjacent_nodes, activeNode, count, deg, bet, clo, eig, node_name, anchor_name) {
  var centrality_data = data.map(function(d){return d.centrality});

  var margin = {top: 10, right: 30, bottom: 30, left: 40},
      width = 250 - margin.left - margin.right,
      height = 250 - margin.top - margin.bottom;

  var inter_community_connections = adjacent_nodes.length - count;

  d3.select("#community_textbox").select("svg").remove();
  d3.select("#node_textbox").html("");

  // Build the list of collaborator names
  let name_of_adjacent_nodes = [];
  for (let i = 0; i < adjacent_nodes.length; i++) {
    // FIX: Search 'global_data_unchanged' (all nodes) instead of 'data' (community-only nodes)
    let foundObj = global_data_unchanged.find(dd => dd.node === adjacent_nodes[i]);
    if (foundObj) {
      name_of_adjacent_nodes.push(foundObj.name);
    } else {
      // Fallback for a collaborator not in the current timeslice's node list
      name_of_adjacent_nodes.push("Unknown/Past Collaborator");
    }
  }

  let groupDensity = (data[0]) ? data[0].density : "N/A";
  let groupSize = data.length;

  // Build optional 'Community Seeded on' line for enron_ipr_new
  let seeded_html = "";
  if (anchor_name && anchor_name !== "" && anchor_name !== "None" && anchor_name !== "undefined") {
    seeded_html = "<b style='color:#CC79A7'>Community Seeded on: </b>" + anchor_name + "<br/><br/>";
  }

  // Neighbour list: wrap and truncate so a large community doesn't produce an
  // unbreakable multi-thousand-character line that gets silently clipped.
  const MAX_NEIGHBOURS_SHOWN = 30;
  const shownNeighbours = name_of_adjacent_nodes.slice(0, MAX_NEIGHBOURS_SHOWN).join(", ");
  const hiddenNeighbours = name_of_adjacent_nodes.length - MAX_NEIGHBOURS_SHOWN;
  const neighboursDisplay = hiddenNeighbours > 0
      ? (shownNeighbours + " <i>…and " + hiddenNeighbours + " more</i>")
      : shownNeighbours;

  // append the summary to #community_textbox
  d3.select("#community_textbox")
      .html("<b>Name: </b>"+ node_name +"<br/>"
          + "<b> Neighbours_Count: </b>"+ deg +"<br/><br/>"
          + "<b>Group Information:</b><br/>"
          + "<b>Number of Nodes in Group:</b> "+ groupSize + "<br/>"
          + "<b>Edge-density in Group:</b> "+ groupDensity + "<br/><br/>"
          + "<b>Total Neighbours:</b> " + adjacent_nodes.length + "<br/>"
          + "<b>Neighbours within Group:</b> " + count + "<br/>"
          + seeded_html
          + "<b>Neighbours in other Group:</b> " + inter_community_connections + "<br/>"
          + "<b>List of Neighbours:</b> <span class='neighbour-list'>" + neighboursDisplay + "</span>")
      .style("font-size", "12px");
}

function draw_histogram(centrality_data, width, height){

  // set the dimensions and margins of the graph
  var margin = {top: 10, right: 40, bottom: 50, left: 50},
      w = 300 - margin.left - margin.right,
      h = 250 - margin.top - margin.bottom;

  d3.select("#community_histogram").select("svg").remove();

  // append the svg object
  var svg = d3.select("#community_histogram")
    .append("svg")
      .attr("width", w + margin.left + margin.right)
      .attr("height", h + margin.top + margin.bottom)
    .append("g")
      .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");

    // X axis: scale and draw:
    var max = d3.max(centrality_data);
    var min = d3.min(centrality_data);

    var x = d3.scaleLinear()
          .domain([min, max])
          .range([0, w]);

    svg.append("g")
        .attr("transform", "translate(0," + h + ")")
        .call(d3.axisBottom(x))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .style("font-size", 14)
        .attr("transform", "rotate(-65)");

    // text label for the x axis
    svg.append("text")
        .attr("x", w/2)
        .attr("y", h + margin.top + 40)
         .style("text-anchor", "middle")
         .attr("dx", "1em")
         .attr("fill", "black")
         .style("font-size", 14)
         .text("Degree-centrality");

    // set the parameters for the histogram
    var histogram = d3.histogram()
        .value(function(d) { return d; })
        .domain(x.domain())
        .thresholds(x.ticks(10));

    // And apply this function to data to get the bins
    var bins = histogram(centrality_data);

    // Y axis: scale and draw:
    var y = d3.scaleLinear()
        .range([h, 0]);
    y.domain([0, d3.max(bins, function(d) { return d.length; })]);

    //label y-axis
    svg.append("g")
        .call(d3.axisLeft(y))
        .style("font-size", 14)
        .call(g => g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x",0 - (h / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .attr("fill", "black")
        .text("Number of Nodes"));

    // append the bar rectangles
    svg.selectAll("rect")
        .data(bins)
        .enter()
        .append("rect")
          .attr("x", 1)
          .attr("transform", function(d) {
              return "translate(" + x(d.x0) + "," + y(d.length) + ")";
          })
          .attr("width", function(d) { return x(d.x1) - x(d.x0) -1 ; })
          .attr("height", function(d) { return h - y(d.length); })
          .style("fill", "teal");
}

// the spiral is drawn in a seperate window on find node functionality
function find_node_draw_spiral(new_data1){

  var width = 400,
      height = 300;

  const nPts = new_data1.length || 1;
  // Scale coils so the arc is always a full Archimedean spiral, not a sliver
  const coils_dyn  = Math.max(2, Math.ceil(nPts / 12));  // ~12 nodes per revolution
  const sides_dyn  = nPts;                                // one step per node
  const radius_dyn = 120;                                 // fits within 300px container

  let centerX = 150,
      centerY = 150,
      rotation = 0;
  let count = 0;
  let awayStep   = radius_dyn / sides_dyn;
  let aroundStep = coils_dyn  / sides_dyn;
  let aroundRadians = aroundStep * 2 * Math.PI;
  rotation *= 2 * Math.PI;

  let no_of_points_in_community = new_data1.length;
  let xCoordinateOfActiveNode_new, yCoordinateOfActiveNode_new;
  let node_name, deg, clo, bet, eig, volatility, anchor_name_found;

  for (let i=0; i<no_of_points_in_community;i++){
      let away = i * awayStep;
      let around = i * aroundRadians + rotation;

      new_data1[i]['new_x'] = centerX + Math.cos(around) * (away );
      new_data1[i]['new_y'] = centerY + Math.sin(around) * (away);

      if (new_data1[i]['node']== find_node_id)
      {
        xCoordinateOfActiveNode_new = new_data1[i]['new_x'];
        yCoordinateOfActiveNode_new = new_data1[i]['new_y'];
        node_name = new_data1[i]['name'];
        deg = new_data1[i]['centrality'];
        clo = new_data1[i]['closeness'];
        bet = new_data1[i]['betwness'];
        eig = new_data1[i]['eign'];
        volatility = new_data1[i]['volatility'];
        anchor_name_found = new_data1[i]['anchor_name'];
      }
  }

  let adjacent_nodes_find_node = connections_list[find_node_id];
  d3.select("#community_spiral").select("svg").remove();
  d3.select("#node_spiral").select("svg").remove();
  d3.select("#community_textbox").html("");

  var svg_community = d3.select("#community_spiral").append("svg")
      .attr("width", width)
      .attr("height", height)
    .append("g");

  var circles = svg_community.selectAll("circle")
                  .data(new_data1)
                .enter()
                  .append("circle")
                  .attr("cx", function (d) { return d.new_x; })
                  .attr("cy", function (d) { return d.new_y; })
                  .attr("r", function(d){
                    if (d.node == find_node_id) return 5;
                    else return 2;
                  })
                  .style("fill", function(d){
                    if (d.node == find_node_id) {
                      return "black";
                    }

                    if (adjacent_nodes_find_node.includes(d.node)){
                      count++;
                      svg_community.append('line')
                            .style("stroke", "#253494" )
                            .style("stroke-opacity",.5)   // was "strokeOpacity": not a CSS property, silently ignored
                            .style("stroke-width",1.5)
                            .attr("x1", xCoordinateOfActiveNode_new)
                            .attr("y1", yCoordinateOfActiveNode_new)
                            .attr("x2", d.new_x)
                            .attr("y2", d.new_y);
                      return "#253494";
                    }
                    else {
                      //--- ADDED FOR LOCAL VOLATILITY ---
                      if (localVolatilityColFlag == 1) {
                        // New local-volatility color logic
                        if (d.type === "outandin") return "#CC79A7";
                        else if (d.type === "incoming") return "#0072B2";
                        else if (d.type === "outgoing") return "#E69F00";
                        else return "#8C8C8C"; // "neither"
                      }
                      // Otherwise, fall back to existing flags
                      if (densityColFlag ==1)
                        return colorscaleDensity(d.density);

                      else if (degreeColFlag==1){
                        if (d.centrality > extent_of_centralities_after_removing_outliers.degree_range[1])
                          return "black";
                        else
                          return colorscaleDegree(d.centrality);
                      }
                      else if (closenessColFlag==1){
                        if (d.closeness > extent_of_centralities_after_removing_outliers.closeness_range[1])
                          return "black";
                        else
                          return colorscaleCloseness(d.closeness);
                      }
                      else if (betweennessColFlag==1){
                        if (d.betwness > extent_of_centralities_after_removing_outliers.betwness_range[1])
                          return "black";
                        else
                          return colorscaleBetwness(d.betwness);
                      }
                      else if (eignColFlag==1){
                        if (d.eign > extent_of_centralities_after_removing_outliers.eign_range[1])
                          return "black";
                        else
                          return colorscaleEign(d.eign);
                      }
                      else if (volatilityColFlag==1){
                        if (d.volatility > extent_of_centralities_after_removing_outliers.volatility_range[1])
                          return "black";
                        else
                          return colorscaleVolatility(d.volatility);
                      }
                    }
                  });

  var centrality_data = new_data1.map(function(d){return d.centrality});
  draw_textbox(new_data1, adjacent_nodes_find_node, find_node_id, count, deg, bet, clo, eig, node_name, anchor_name_found);
}

// draw spiral in side window on click community
function draw_spiral(new_data1, adjacent_nodes, activeNode) {
  /******************************************************************
   * 1 ▸ DIMENSIONS
   ******************************************************************/
  // real size of the container (flex-box makes this vary!)
  const bounds   = d3.select("#community_spiral").node().getBoundingClientRect();
  const width    = bounds.width  || 300;          // fall-back for old browsers
  const height   = bounds.height || 300;
  const centerX  = width  / 2;
  const centerY  = height / 2;

  /******************************************************************
   * 2 ▸ SPIRAL PARAMETERS (derived, not fixed)
   ******************************************************************/
  const nPoints  = new_data1.length;

  // the outer radius is 90 % of the smallest half-dimension → no clipping
  const radius   = (Math.min(width, height) / 2) * 0.9;

  // one “side” per node, so every node has its own step
  const sides    = nPoints;

  // put ≈ 15 nodes per revolution; ensure at least 2 full turns
  const coils    = Math.max(2, Math.ceil(nPoints / 15));

  const awayStep     = radius / sides;
  const aroundStep   = coils  / sides;
  const aroundRad    = aroundStep * 2 * Math.PI;

  /******************************************************************
   * 3 ▸ CALCULATE COORDINATES
   ******************************************************************/
  let xActive, yActive, node_name, deg, clo, bet, eig, volatility, anchor_name_found;

  new_data1.forEach((d, i) => {
    const away   = (i + 0.5) * awayStep;          // 0.5 keeps the first node off the origin
    const around = (i + 0.5) * aroundRad;

    d.new_x = centerX + Math.cos(around) * away;
    d.new_y = centerY + Math.sin(around) * away;

    if (d.node === activeNode) {
      xActive = d.new_x;
      yActive = d.new_y;
      ({ name:  node_name,
         centrality: deg,
         closeness:  clo,
         betwness:   bet,
         eign:       eig,
         volatility: volatility,
         anchor_name: anchor_name_found } = d);
    }
  });

  /******************************************************************
   * 4 ▸ DRAW
   ******************************************************************/
  // wipe the old miniature spiral
  d3.select("#community_spiral").select("svg").remove();

  const svg = d3.select("#community_spiral")
                .append("svg")
                  .attr("viewBox", `0 0 ${width} ${height}`)
                  .attr("preserveAspectRatio", "xMidYMid meet")
                .append("g");                     // no translate needed – coords already centred

  // plot nodes
  const circles = svg.selectAll("circle")
      .data(new_data1)
    .enter().append("circle")
      .attr("cx", d => d.new_x)
      .attr("cy", d => d.new_y)
      .attr("r", d => (d.node === find_node_id ? 6 : 1.5))
      .style("fill", function(d) {                // ← your original colour logic
        if (d.node === find_node_id) return "black";

        if (adjacent_nodes.includes(d.node)) {
          // draw the spoke
          svg.append("line")
             .attr("x1", xActive).attr("y1", yActive)
             .attr("x2", d.new_x).attr("y2", d.new_y)
             .style("stroke", "#253494")
             .style("stroke-opacity", .5)
             .style("stroke-width", 1.5);
          return "#253494";
        }

        /* ---- original flag-driven palette ---- */
        if (localVolatilityColFlag === 1) {
          if (d.type === "outandin")  return "#CC79A7";
          if (d.type === "incoming")  return "#0072B2";
          if (d.type === "outgoing")  return "#E69F00";
          return "#8C8C8C";
        }

        if (densityColFlag)    return colorscaleDensity(d.density);
        if (degreeColFlag)     return (d.centrality > extent_of_centralities_after_removing_outliers.degree_range[1])
                                     ? "black" : colorscaleDegree(d.centrality);
        if (closenessColFlag)  return (d.closeness  > extent_of_centralities_after_removing_outliers.closeness_range[1])
                                     ? "black" : colorscaleCloseness(d.closeness);
        if (betweennessColFlag)return (d.betwness  > extent_of_centralities_after_removing_outliers.betwness_range[1])
                                     ? "black" : colorscaleBetwness(d.betwness);
        if (eignColFlag)       return (d.eign      > extent_of_centralities_after_removing_outliers.eign_range[1])
                                     ? "black" : colorscaleEign(d.eign);
        if (volatilityColFlag) return (d.volatility> extent_of_centralities_after_removing_outliers.volatility_range[1])
                                     ? "black" : colorscaleVolatility(d.volatility);

        return "#aaa"; // fall-back
      });

  /******************************************************************
   * 5 ▸ UPDATE INFO BOX
   ******************************************************************/
  draw_textbox(new_data1, adjacent_nodes, activeNode,
               adjacent_nodes.length, deg, bet, clo, eig, node_name, anchor_name_found);
}


//convert node data from string to integers
function transform_data(data){
  data = data.map(d=> ({
    node : +d.node,
    centrality : +d.centrality,
    community : +d.community,
    density : parseFloat(d.density),
    volatility : parseFloat(d.volatility),
    name: d.name,
    anchor_name: d.anchor_name,
    x : +d.x,
    y: +d.y,
    type: d.type
  }));
  return data;
}

//convert node data from string to integers
function transform_link_data(data){
  data = data.map(d=> ({
    source : +d.source,
    target: +d.target,
    weight: +d.weight
  }));
  return data;
}

//convert node data from string to integers
function transform_node_to_node_link_data(data){
  data = data.map(d=> ({
    source : +d.source,
    target: +d.target,
    type: d.type
  }));
  return data;
}

//convert coarse graph center points from string to integers
function string_to_numbers_graph_centers(data){
  data = data.map(d=> ({
    community : +d.community,
    size : +d.count
  }));
  return data;
}

// By default, no filtering
window.currentNodeFilter = "none";

// Then, in your radio-button change events, you set:
// document.querySelectorAll("input[name='nodeFilter']").forEach(radio => {
//   radio.addEventListener("change", function() {
//     window.currentNodeFilter = this.value;  // "none", "incoming", or "outgoing"
    
//     // Re-apply opacity:
//     d3.selectAll("circle").style("opacity", function(d) {
//       if (window.currentNodeFilter === "incoming") {
//         return d.type === "incoming" || d.type === "outandin" ? 1 : 0.2;
//       } else if (window.currentNodeFilter === "outgoing") {
//         return d.type === "outgoing" || d.type === "outandin" ? 1 : 0.2;
//       } else if (window.currentNodeFilter === "both") {
//         return d.type === "outandin" ? 1 : 0.2;
//       } else {
//         // "none" or anything else: show all
//         return 1;
//       }
//     });
//   });
// });

// Replace the old radio button logic with this
document.querySelectorAll("input[name='nodeFilter']").forEach(radio => {
  radio.addEventListener("change", function() {
    // Update the global filter state
    window.currentNodeFilter = this.value;
    
    // Call the central function to apply all filters and redraw
    applyFiltersAndRedraw();
  });
});

// ── Shared layout geometry constants ──────────────────────────────
// COMM_NODE_RADIUS controls macro-layout spacing only (micro-layout uses its own fixed spiral).
// It approximates the mini-spiral's actual visual extent: the spiral reaches ~0.15*N+15 px,
// which sqrt-fits to c≈3 across the typical community size range.
// Bounding circle: R_i = COMM_NODE_RADIUS * sqrt(N)  → ~21 px for N=50.
// Small communities (N<10) will have actual visual extent > R_i, so they blend with neighbours —
// this is intentional and reproduces the original blended-spiral appearance.
const COMM_NODE_RADIUS = 7;   // community packing radius (px per sqrt-node)
const MACRO_PADDING    = 20;   // minimum gap between community bounding circles (px)

// ── Adaptive Arc-Length Macro-Layout ──────────────────────────────
// Bounding radius per community:  R_i = COMM_NODE_RADIUS * sqrt(count_i)
// Angular step:  delta_theta = (R_prev + R_i + MACRO_PADDING) / (rho * theta_prev)
// Spiral:        r = rho * theta  (Archimedean)
// rho is derived from the existing layout parameters so the spiral fills the
// same screen area as before.  When all communities are equal-sized the arc
// spacing between every adjacent pair is constant (= 2R + MACRO_PADDING),
// which is strictly better than the old uniform-angular-step formula (whose
// arc spacing grew linearly toward the periphery).

function transform_graph_centers(data, height, width) {
  const nCommunities = data.length;
  if (nCommunities === 0) return data;

  const centerX   = width  / 2;
  const centerY   = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;

  // rho: derived from the same heuristics as the old layout so overall scale
  // is preserved across datasets of different sizes.
  const coils         = Math.max(4, Math.ceil(nCommunities / 8));
  const aroundRadians = (coils / nCommunities) * 2 * Math.PI;  // old step size
  const awayStep      = maxRadius / nCommunities;
  const rho           = awayStep / aroundRadians;               // r = rho * theta

  // string_to_numbers_graph_centers stores the count field as 'size', not 'count'.
  const getSize    = d => d.size || d.count || 1;
  const microAwayStep = 60 / 400; // mirrors computing_spiral_positions
  const getVisualRadius = size => Math.min(size, 300) * microAwayStep
                               + Math.max(0, size - 300) * (60 / 25000)
                               + 100 * microAwayStep;  // the +100 offset

  // theta0: place community 0 at r ≈ R_0 + MACRO_PADDING from the centre.
  // Floor at one old step so we never start at or near the pole.
  const R0  = getVisualRadius(getSize(data[0]));
  let theta = Math.max((R0 + MACRO_PADDING) / rho, aroundRadians);

  // Place community 0
  data[0].cx = centerX + Math.cos(theta) * (rho * theta);
  data[0].cy = centerY + Math.sin(theta) * (rho * theta);

  // Place communities 1 … n-1
  for (let i = 1; i < nCommunities; i++) {
    const R_prev      = getVisualRadius(getSize(data[i - 1]));
    const R_i         = getVisualRadius(getSize(data[i]));
    const delta_theta = (R_prev + R_i + MACRO_PADDING) / (rho * theta);
    theta            += delta_theta;

    const r    = rho * theta;
    data[i].cx = centerX + Math.cos(theta) * r;
    data[i].cy = centerY + Math.sin(theta) * r;
  }
  // ── NEW: rescale all computed cx/cy so they actually fit ──────────────
  const allCx = data.map(d => d.cx);
  const allCy = data.map(d => d.cy);
  const xMin = d3.min(allCx), xMax = d3.max(allCx);
  const yMin = d3.min(allCy), yMax = d3.max(allCy);

  const dataW = Math.max(xMax - xMin, 1e-6);
  const dataH = Math.max(yMax - yMin, 1e-6);
  const targetDiam = maxRadius * 2 * 0.9; // 90% of the intended diameter

  const scale = Math.min(targetDiam / dataW, targetDiam / dataH);

  const midX = (xMin + xMax) / 2;
  const midY = (yMin + yMax) / 2;

  data.forEach(d => {
    d.cx = centerX + (d.cx - midX) * scale;
    d.cy = centerY + (d.cy - midY) * scale;
  });
  // ─────────────────────────────────────────────────────────────────────

  return data;
}


//--- MODIFIED FOR LOCAL VOLATILITY CENTERING ---
function computing_spiral_positions(center_positions_spiral, data_points, height, width) {

  let radius = 60,
      coils = 15,
      rotation = 0,
      sides = 400;
  let awayStep = radius / sides;
  let aroundStep = coils / sides;
  let aroundRadians = aroundStep * 2 * 3.14;
  rotation *= 2 * 3.14;

  let newdata1 = [];

  center_positions_spiral.forEach(function(community_data){
    let filtered_community = data_points.filter(function(d){
      return d.community === community_data.community;
    });

    //--- ADDED FOR LOCAL VOLATILITY CENTERING ---
    if (localVolatilityCenteringFlag == 1) {
      let outandin = filtered_community.filter(d => d.type === "outandin");
      let incoming = filtered_community.filter(d => d.type === "incoming");
      let outgoing = filtered_community.filter(d => d.type === "outgoing");
      let neither  = filtered_community.filter(d =>
        d.type !== "outandin" && d.type !== "incoming" && d.type !== "outgoing"
      );
      filtered_community = outandin.concat(outgoing, incoming, neither);
    }

    let no_of_points_in_community = filtered_community.length;

    for (let i = 0; i < no_of_points_in_community; i++) {
      let away, around;
      if (i < 300) {
        away   = (i + 100) * awayStep;
        around = (i + 100) * aroundRadians + rotation;
      } else {
        // for bigger communities
        let new_awayStep      = radius / 25000;
        let new_aroundStep    = coils  / 25000;
        let new_aroundRadians = new_aroundStep * 2 * 3.14;
        away   = (299 + 100) * awayStep      + ((i - 299) * new_awayStep);
        around = (299 + 100) * aroundRadians + ((i - 299) * new_aroundRadians + rotation);
      }

      filtered_community[i]['x'] = community_data.cx + Math.cos(around) * away;
      filtered_community[i]['y'] = community_data.cy + Math.sin(around) * away;
    }
    newdata1 = newdata1.concat(filtered_community);
  });
  return newdata1;
}




/* ── Hover affordances ───────────────────────────────────────────────────
   Hover is the only way into a node's detail, and a node is a 2px dot, so the
   feedback has to do three things: confirm WHICH dot is under the pointer,
   say what its colour means, and stay on screen. These helpers own the first
   two; positionTooltip owns the third. */

/* The radius a node rests at, so a hover can restore it rather than guessing.
   Kept next to the hover code because it is the inverse of what the hover
   does, and the two drifting apart is how a node ends up stuck enlarged. */
function restingRadius(d){
  if (!d) return global_radius;
  if (d.node == find_node_id) return 4;
  return (highlightNodes.indexOf(d.node) !== -1) ? 3 : global_radius;
}
const HOVER_RADIUS_BOOST = 2.6;   // px added to the resting radius on hover

/* The colour channel is the paper's headline encoding and the tooltip never
   named it, so a reader saw "orange" and had to consult the legend. State
   names come from LocalVolatility, which owns the vocabulary; the swatch is
   the same colour the dot is actually drawn in. */
function hoverStateChip(d){
  const LV = window.LocalVolatility;
  if (!LV || localVolatilityColFlag != 1) return "";
  const labels = window.currentSlices || [];
  const i = labels.indexOf(window.currentYearRange);
  const state = LV.normalizeRaw(d.type);
  const name = (i >= 0 && labels.length)
    ? LV.labelFor(state, i, labels.length)
    : (state || "Stable");
  const col = getColorBasedOnFlags(d);
  return '<span class="tt-chip"><i style="background:' + col + '"></i>' + name + "</span>";
}

/* Place the tooltip near the pointer but always inside the viewport. The old
   version pinned it to (pageX, pageY-28) unconditionally, so a node near the
   right or bottom edge -- which on a spiral is most of the outer turn -- put
   its own detail off screen. Flips rather than clamps: a tooltip pinned to the
   edge covers the node it describes. */
function positionTooltip(sel, event){
  const PAD = 12, node = sel.node();
  if (!node) return;
  sel.style("left", "0px").style("top", "0px");
  const box = node.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = event.clientX + 14, y = event.clientY - 28;
  if (x + box.width  > vw - PAD) x = event.clientX - box.width - 14;
  if (y + box.height > vh - PAD) y = vh - box.height - PAD;
  if (y < PAD) y = PAD;
  if (x < PAD) x = PAD;
  // position:fixed coordinates, so no scroll offset is added -- the chart is
  // inside a scrollable column and pageX/pageY drifted from the cursor there.
  sel.style("left", x + "px").style("top", y + "px");
}

// Define the div for the tooltip
var div = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

var count = 0;

/* Opacity a node should have under the temporal radio-button filter alone.
   Shared by node enter, hover and mouseout so that hovering can no longer
   destroy the incoming/outgoing selection on the way out. */
function nodeFilterOpacity(d){
  if (!d) return 1;
  if (window.currentNodeFilter === "incoming")
    return (d.type === "incoming" || d.type === "outandin") ? 1 : 0.2;
  if (window.currentNodeFilter === "outgoing")
    return (d.type === "outgoing" || d.type === "outandin") ? 1 : 0.2;
  return 1;
}

/* ── boundary (censored) temporal states ──────────────────────────────────────
   The `type` column is precomputed by data_parsers/build_dataset.py, which does:

       prev_n = node_sets[i-1] if i > 0 else set()
       next_n = node_sets[i+1] if i < len-1 else set()
       inc, out = n not in prev_n, n not in next_n

   The empty-set sentinel says "the world was empty before / will be empty
   after", so at the FIRST slice every node tests as incoming and at the LAST
   slice every node tests as outgoing. Enron 2002 is 100% outgoing, Reddit
   2017-2019 is 88% outgoing. That is an artifact of the sentinel, not a finding
   — and it is the definitional artifact reviewers flagged.

   The fix needs no new state and no new colour. At a boundary only ONE half of
   the question is unanswerable:

       first slice — "did it just join?" unknowable; "does it leave?" KNOWN
       last slice  — "does it leave?"    unknowable; "did it join?"   KNOWN

   The old code destroyed both halves. Here an unknown neighbour slice simply
   fails to establish its half, so the node falls back to the existing neutral
   state rather than being asserted into incoming/outgoing. Every slice is
   loaded client-side already, so this needs no pipeline rerun.

   Applied to boundary slices only, deliberately: interior slices keep whatever
   the pipeline produced, so this changes nothing that was already well-defined.
   (Dropping the isFirst/isLast guard would also normalise the interior, which
   currently disagrees with build_dataset.py for 21–36% of rows depending on
   dataset — a separate problem, best fixed by regenerating the CSVs.)

   State VOCABULARY lives in localVolatility.js, which is the single source of
   truth for what the four states mean and how they are labelled. This function
   keeps its own presence-based derivation — recomputing from the loaded node
   sets is stronger than remapping the stored value, because it does not trust
   the pipeline's sentinel at all — but it must emit the same names. In
   particular the fourth state is "stable", never "": the legend and the bar
   chart both key on the literal, and a blank draws an unstyled dot.        */
function correctBoundaryStates(rows) {
  const labels = window.currentSlices || [];
  const i = labels.indexOf(window.currentYearRange);
  if (i < 0 || labels.length < 2) return rows;

  const isFirst = i === 0, isLast = i === labels.length - 1;
  if (!isFirst && !isLast) return rows;          // interior slices are fine

  // Honour the legacy switch: with boundaryMode "raw" the pipeline's
  // as-built states are left exactly as they were.
  const LV = window.LocalVolatility;
  if (LV && LV.boundaryMode !== "observed") return rows;

  const prev = isFirst ? null : (allYearsNodeData[labels[i - 1]] || {});
  const next = isLast  ? null : (allYearsNodeData[labels[i + 1]] || {});

  rows.forEach(d => {
    // null means "unobserved", which can never establish a transition.
    const joined = prev === null ? false : !prev[d.node];
    const left   = next === null ? false : !next[d.node];
    // The fourth state is named, not blank: the legend and the bar chart both
    // expect the literal "stable", and an empty string draws unstyled. Kept in
    // sync with localVolatility.js, which owns the state vocabulary.
    d.type = joined && left ? "outandin"
           : joined ? "incoming"
           : left ? "outgoing"
           : (LV ? LV.normalizeRaw("") : "stable");
  });
  return rows;
}
window.correctBoundaryStates = correctBoundaryStates;

/* ── hover labels ─────────────────────────────────────────────────────────────
   On hover the neighbours living in OTHER communities already stay opaque while
   the rest of the network drops to 0.1 — but an opaque dot three spirals away is
   indistinguishable from any other dot, so the brokerage the fade exists to
   reveal was still unreadable. These labels name them.

   Only cross-community neighbours are labelled. Same-community neighbours sit
   inside the one spiral the eye is already on, and labelling all of them is what
   turns a hover into a wall of text.

   Scalability comes from three limits, in this order:
     1. cap the count (MAX_HOVER_LABELS), keeping the highest-degree ones — the
        brokers you would actually chase;
     2. drop any label that would collide with one already placed, measured in
        SCREEN space so the rule holds at every zoom level;
     3. counter-scale the font by the zoom factor so labels stay legible zoomed
        out and never balloon zoomed in.                                       */
const MAX_HOVER_LABELS = 14;
const HOVER_LABEL_PX   = 10;    // on-screen font size, independent of zoom
const HOVER_LABEL_GAP  = 13;    // min on-screen separation between two labels

function currentZoomK() {
  const el = d3.select("#chart").node();
  if (!el) return 1;
  try { return d3.zoomTransform(el).k || 1; } catch (e) { return 1; }
}

/* Greedy, strongest first, skipping anything whose box would overlap one already
   placed. Boxes are built in DATA space from the on-screen size divided by k, so
   the same rule holds at every zoom level. Width is estimated from the character
   count rather than measured: measuring means laying out every candidate in the
   DOM on every hover, and names here are a single font at a single size, where
   0.58em per character is accurate enough to separate boxes. */
function labelBox(it, k) {
  const fs = HOVER_LABEL_PX / k;
  const w = (it.text ? it.text.length : 0) * fs * 0.58;
  const h = fs * 1.25;
  const cx = it.x + (it.ego ? 0 : 6 / k);
  const cy = it.y - 6 / k;
  const x0 = it.ego ? cx - w / 2 : cx;         // ego labels are centre-anchored
  return { x0: x0, x1: x0 + w, y0: cy - h, y1: cy + h * 0.25 };
}

function placeHoverLabels(items, k) {
  const pad = 2 / k;
  const kept = [], boxes = [];
  for (const it of items) {
    if (kept.length >= MAX_HOVER_LABELS) break;
    const b = labelBox(it, k);
    let clash = false;
    for (const p of boxes) {
      if (b.x0 - pad < p.x1 && p.x0 < b.x1 + pad &&
          b.y0 - pad < p.y1 && p.y0 < b.y1 + pad) { clash = true; break; }
    }
    if (!clash) { kept.push(it); boxes.push(b); }
  }
  return kept;
}

let _hoverLabelItems = null;    // full candidate list, kept for re-placement
let _hoverLabelG = null;

function drawHoverLabels(g, items) {
  _hoverLabelItems = items;
  _hoverLabelG = g;
  const k = currentZoomK();
  const kept = placeHoverLabels(items, k);
  g.selectAll("text.hover-label")
    .data(kept, d => d.id)
    .join("text")
      .attr("class", d => "hover-label" + (d.ego ? " hover-label--ego" : ""))
      .attr("x", d => d.x + (d.ego ? 0 : 6 / k))
      .attr("y", d => d.y - 6 / k)
      .attr("text-anchor", d => d.ego ? "middle" : "start")
      .style("font-size", (HOVER_LABEL_PX / k) + "px")
      .style("stroke-width", (3 / k) + "px")
      .text(d => d.text);
}

function clearHoverLabels() {
  _hoverLabelItems = null;
  _hoverLabelG = null;
  d3.selectAll("text.hover-label").remove();
}

/* Zoom changes k, which changes both the font size AND how much data-space each
   label occupies — so labels that fitted at one zoom can collide at another.
   Re-running the full placement (rather than just resizing what is already
   there) is what keeps the no-overlap guarantee true at every zoom level. */
function rescaleHoverLabels() {
  if (!_hoverLabelItems || !_hoverLabelG) return;
  drawHoverLabels(_hoverLabelG, _hoverLabelItems);
}
window.clearHoverLabels = clearHoverLabels;

/* ── inter-community edge geometry & styling ──────────────────────────────────
   One owner for how edges look at rest. Every handler that used to hardcode
   `stroke-opacity: 1` on mouseout now calls resetEdgeOpacity(), which is why
   the faint resting weight survives a bar hover.

   Weight is carried by OPACITY rather than stroke mass: widths stay under 2px
   and overlapping faint strokes accumulate, so a bundle darkens where many
   edges agree. Both scales are sqrt so mid weights are not crushed. */
const EDGE_COLOR      = "#6b7280";
const EDGE_WIDTH      = [0.3, 2.0];
const EDGE_OPACITY    = [0.06, 0.45];
const EDGE_DIM        = 0.03;   // non-zero, so context survives an emphasis pass
const EDGE_EMPHASIS   = 0.75;

let edgeWidthScale   = () => 0.6;
let edgeOpacityScale = () => 0.2;
let commIndexById    = new Map();   // community id -> position along the spiral
let spiralCentroid   = [0, 0];
let edgesHidden      = false;

// Rebuilt on every render, because α / ranking changes permute the spiral order.
function buildSpiralEdgeGeometry(){
  const centres = Array.isArray(center_positions_spiral)
    ? center_positions_spiral
    : Object.values(center_positions_spiral || {});

  commIndexById = new Map();
  centres.forEach((c, i) => { if (c && c.community !== undefined) commIndexById.set(+c.community, i); });

  // link_data.source/target are community IDS. They were previously used as
  // ARRAY POSITIONS, which only worked because the centres happen to be sorted
  // by id and ids happen to be dense from 0.
  spiralCentroid = centres.length
    ? [centres.reduce((s, c) => s + c.cx, 0) / centres.length,
       centres.reduce((s, c) => s + c.cy, 0) / centres.length]
    : [0, 0];

  _spiralSpan = centres.length
    ? Math.max(d3.max(centres, c => c.cx) - d3.min(centres, c => c.cx),
               d3.max(centres, c => c.cy) - d3.min(centres, c => c.cy))
    : 0;

  const maxW = d3.max(link_data || [], d => d.weight) || 1;
  edgeWidthScale   = d3.scaleSqrt().domain([0, maxW]).range(EDGE_WIDTH).clamp(true);
  edgeOpacityScale = d3.scaleSqrt().domain([0, maxW]).range(EDGE_OPACITY).clamp(true);
}

// Both endpoints of an edge, or null when a community is missing this slice.
function edgeEndpoints(e){
  const centres = Array.isArray(center_positions_spiral)
    ? center_positions_spiral
    : Object.values(center_positions_spiral || {});
  const i = commIndexById.get(+e.source), j = commIndexById.get(+e.target);
  if (i === undefined || j === undefined) return null;
  const a = centres[i], b = centres[j];
  if (!a || !b) return null;
  return { i, j, a, b, n: centres.length };
}

/* Bow a chord by offsetting both control points PERPENDICULAR to it.

   The obvious alternative — pulling the control points toward the spiral
   centroid — degenerates exactly where it is needed most: an edge spanning the
   diameter already has its midpoint on the centroid, so there is nothing to
   pull toward and it renders dead straight. Measured on data_vispub, that
   version bowed the longest edges LESS than the shortest ones.

   A perpendicular offset of magnitude m displaces the curve midpoint by 0.75·m
   regardless of where the chord sits, so the bow is always proportional to the
   distance term. The sign is taken consistently from the source→target
   direction, so long edges nest the same way round instead of crisscrossing. */
function bowedPath(x1, y1, x2, y2, amount){
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return `M${x1},${y1}L${x2},${y2}`;
  const px = -dy / len, py = dx / len;              // unit perpendicular
  const m  = Math.min(amount, 0.22 * Math.max(spiralSpan(), len));
  const c1x = x1 + dx * 0.25 + px * m, c1y = y1 + dy * 0.25 + py * m;
  const c2x = x1 + dx * 0.75 + px * m, c2y = y1 + dy * 0.75 + py * m;
  return `M${x1},${y1}C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

function spiralEdgePath(e){
  const p = edgeEndpoints(e);
  if (!p) return null;
  // normalised spiral-order distance; guard n < 2 (harry_potter has 1-3 edges)
  const t = p.n > 1 ? Math.abs(p.i - p.j) / (p.n - 1) : 0;
  const chord = Math.hypot(p.b.cx - p.a.cx, p.b.cy - p.a.cy);
  return bowedPath(p.a.cx, p.a.cy, p.b.cx, p.b.cy, 0.45 * chord * t);
}

function restingEdgeOpacity(d){
  return edgesHidden ? 0 : edgeOpacityScale(d && d.weight != null ? d.weight : 0);
}

function applyEdgeStyle(sel){
  sel.style("fill", "none")
     .style("stroke", EDGE_COLOR)
     .style("stroke-width", d => edgeWidthScale(d && d.weight != null ? d.weight : 0))
     .style("stroke-opacity", restingEdgeOpacity);
}

// The single reset every mouseout/toggle should call instead of hardcoding 1.
function resetEdgeOpacity(){
  d3.selectAll(".spiral_edges").style("stroke-opacity", restingEdgeOpacity);
}

/* Ego edges run node→node rather than community→community, so there is no
   spiral order to appeal to. Bow them by chord length instead: a link to a
   neighbour in the same community stays almost straight, one reaching across
   the diagram curves inward and joins the other long reaches. */
function egoEdgePath(e){
  const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
  const t = Math.min(len / Math.max(spiralSpan(), 1), 1);
  return bowedPath(e.x1, e.y1, e.x2, e.y2, 0.30 * len * t);
}

// Rough diameter of the laid-out spiral, used to normalise ego chord lengths.
let _spiralSpan = 0;
function spiralSpan(){ return _spiralSpan; }

// Emphasise the edges incident on one community; dim the rest without erasing.
function emphasiseCommunityEdges(commId){
  d3.selectAll(".spiral_edges").style("stroke-opacity", d => {
    if (edgesHidden || !d) return 0;
    return (+d.source === +commId || +d.target === +commId) ? EDGE_EMPHASIS : EDGE_DIM;
  });
}
/* snapshotCommunityCohort() is a top-level function declaration, so it is
   already reachable as window.snapshotCommunityCohort — do NOT reassign it to a
   wrapper that calls it by name, which resolves back to the wrapper and blows
   the stack. */
window.resetEdgeOpacity = resetEdgeOpacity;
window.emphasiseCommunityEdges = emphasiseCommunityEdges;
window.getEdgesHidden = () => edgesHidden;
window.setEdgesHidden = (on) => { edgesHidden = !!on; resetEdgeOpacity(); };

/* Edges answer a different question from the spiral itself: the layout never
   reads them, so hiding them removes ink without removing information the
   positions carry. At several thousand nodes the link layer is what stops a
   reader resolving individual dots, which is exactly what the spiral exists to
   let them do -- so this is a first-class control, not a debug hook. */
window.toggleEdges = function () {
  window.setEdgesHidden(!edgesHidden);
  const btn = document.getElementById("edgeToggle");
  if (btn) {
    btn.classList.toggle("active", !edgesHidden);
    btn.setAttribute("aria-pressed", String(!edgesHidden));
  }
};

/* One slot per EGO, not per wedge.

   The Tracker holds three snapshots, and Kale et al. 2023 (Table 2, Individual
   × Comparison) says what three slots are worth: comparing the ego networks of
   different people — Skilling vs Lay, Keim vs Ma. Clicking each wedge used to
   push a NEW card, so a single node with five wedges evicted every other ego
   after three clicks and you ended up comparing one person against themselves.

   So a wedge no longer decides membership; it decides EMPHASIS inside the card
   that ego already owns. Click a wedge, and if this ego is tracked the existing
   card highlights that community and leaves the other slots alone.

   Returns true when an existing card absorbed the focus. */
function focusTrackedEgo(egoID, focus) {
  /* Matched on the EGO alone. This also required `s.yearRange` to equal the
     slice on screen, which was right while a wedge meant "this person's
     community in this week" — but a band spans the whole timeline, so after
     stepping a week the same band click stopped finding the card and minted a
     second one for the same person, eating a tracker slot that is meant to hold
     someone else. A person is the same person in every slice. */
  /* ...but the SLICE SET still has to match. The presence-partition compare
     view freezes an ego over a two-slice subset; leaving that view and hovering
     the same ego on the main chart rebuilds the widget over all 14, and a band
     click then carried ids drawn from the 14-slice render into the 2-slice
     card. Almost none of them are in that card's roster, so every member falls
     outside the focus, the whole card greys uniformly and the click looks like
     it did nothing. Not matching is the correct answer there: fall through and
     let a card be built for the set actually on screen. */
  const span = (window.currentSlices || []).join("|");
  const card = selectedCommunitySpirals.find(s =>
    s.egoID != null && +s.egoID === +egoID && (s.sliceSpan || span) === span);
  if (!card) return false;
  // Clicking the same wedge twice clears the emphasis rather than doing nothing.
  const same = card.focus && focus && card.focus.key === focus.key;
  card.focus = same ? null : focus;
  updateCommunitySpiralSideWidget();
  return true;
}
window.focusTrackedEgo = focusTrackedEgo;


/* Freeze a community (or an arbitrary set, via opts) as a tracked cohort.
   Extracted from the node click handler so the Ego widget can call it too. */
/* Fill for a roster member who was not in the slice the cohort was frozen in.
   Deliberately not borrowed from another slice: `frozenColor` means "the colour
   this node had when you froze it", and asserting one for someone who was not
   there is the kind of small lie that later reads as data. */
const COHORT_ABSENT_FILL = "#c7c9cc";
let _cohortClickDown = null;
/* `opts` lets a caller freeze an ARBITRARY set of people rather than a whole
   community — used by the Ego widget, where the unit is a travel-group.
     opts.nodeIds : Set|Array of node ids to freeze
     opts.id      : synthetic identity for de-duplication
     opts.label   : header text shown in the Cohort Tracker
     opts.egoID   : the node the set was built around. Drawn at the centre of
                    the card with a heavy border and named in the header, so
                    two cards can be read as "Skilling's network vs Lay's"
                    rather than as two anonymous bags of nodes.            */
function snapshotCommunityCohort(d, opts) {

  // Identify the timeslice (yearRange) in which the user clicked.
  let clickedYearRange = window.currentYearRange || "UnknownYear";
  let commID = opts?.id ?? d.community;

  /* De-duplication. A COMMUNITY is an object of one slice — community 4 in 1975
     and community 4 in 1995 are different groups — so it is keyed by slice. An
     EGO is the same person in every slice and its card now holds the whole span,
     so keying it by slice minted a second card for the same person every time
     you froze them from a different week. */
  const clickedSpan = (window.currentSlices || []).join("|");
  let alreadySelected = selectedCommunitySpirals.find(s =>
    s.communityID === commID &&
    (opts?.egoID != null
      // An ego card is keyed by the span it covers, not by the week you froze
      // it in. Without the span an ego frozen over a compare subset would block
      // ever freezing that same person over the full timeline — the de-dup
      // would match, return early, and the click would do nothing at all.
      ? (s.sliceSpan || clickedSpan) === clickedSpan
      : s.yearRange === clickedYearRange)
  );
  if (alreadySelected) {
    return;
  }

  // Build the *original* community’s data from this timeslice
  // and freeze the colour each node has *right now*.
  const wanted = opts?.nodeIds ? new Set([...opts.nodeIds].map(Number)) : null;
  let originalCommData = global_data
    .filter(n => wanted ? wanted.has(n.node) : n.community === commID)
    .map(n => ({
      ...n,
      frozenColor: getColorBasedOnFlags(n)
    }));

  /* An explicit roster comes from the Ego Spiral, whose bands are built from
     EVERY slice. Filtering it against the slice on screen silently threw away
     most of what was just clicked: on un_voting it cut a 71-neighbour card to
     26, and the band headed "Algeria, Eswatini +2" arrived holding one of its
     four members. The card then dimmed the survivors as "outside the focus" and
     the result was 24 ghosts around 2 solid dots.

     So carry the absent members in. The tracker already has a mark for "in this
     cohort, not here this week" — opacityFor's 0.25 — and using it is the whole
     point of freezing a set and stepping through time. They get a neutral fill
     rather than a borrowed one: frozenColor means "the colour this node had when
     you froze it", and for someone who was not there, there is no such colour.

     A community click still resolves against the current slice, because a
     community IS a one-slice object and there is nothing to carry in. */
  if (wanted) {
    const have = new Set(originalCommData.map(n => n.node));
    const labels = window.currentSlices || [];
    wanted.forEach(id => {
      if (have.has(id)) return;
      for (const l of labels) {
        const rec = (typeof allYearsNodeData !== "undefined" &&
                     (allYearsNodeData[l] || {})[id]) || null;
        if (!rec) continue;
        originalCommData.push({ ...rec, node: id, frozenColor: COHORT_ABSENT_FILL });
        break;
      }
    });
  }
  if (!originalCommData.length) return;

  let originalCommLinks = node_to_node_link_data.filter(e => {
    let nodeIDs = new Set(originalCommData.map(n => n.node));
    return nodeIDs.has(e.source) && nodeIDs.has(e.target);
  });

  // Create an object representing this selection.
  let selectionObj = {
    yearRange: clickedYearRange,
    // The slice set this roster was built over, so a focus computed against a
    // different one cannot be installed on it. See focusTrackedEgo.
    sliceSpan: (window.currentSlices || []).join("|"),
    communityID: commID,
    label: opts?.label || null,     // used by the header when present
    egoID: opts?.egoID != null ? +opts.egoID : null,
    focus: opts?.focus || null,     // {ids:Set, label:String} — emphasis, not membership
    originalNodeData: originalCommData,
    originalLinkData: originalCommLinks,
    randomColorActive: false
  };

  // If we already have 3 selected, remove the oldest.
  if (selectedCommunitySpirals.length >= 3) {
    selectedCommunitySpirals.shift();
  }
  selectedCommunitySpirals.push(selectionObj);

  // Auto-expand the Cohort Tracker and pop it out to the right
  // (body.cohorts-active) so it doesn't cover the timeline.
  const _cf = document.getElementById("cohortFloat");
  if (_cf) _cf.classList.remove("collapsed");
  document.body.classList.add("cohorts-active");

  // Define the highlight colors for each selection.
  const highlightColors = ["gold", "magenta", "green"];
  
  // Build a mapping from node ID to its highlight color.
  let highlightNodesMap = {};
  selectedCommunitySpirals.forEach((sel, index) => {
    let color = highlightColors[index] || "gold";
    sel.originalNodeData.forEach(nodeObj => {
      // If a node belongs to more than one selected community,
      // assign it the color of the earliest selection.
      if (!(nodeObj.node in highlightNodesMap)) {
        highlightNodesMap[nodeObj.node] = color;
      }
    });
  });
  // Store the mapping globally.
  globalHighlightNodesMap = highlightNodesMap;

  /* Update the main view so that every node gets its assigned
     colour. Scoped to circle.happy and datum-guarded: an
     unscoped d3.selectAll("circle") reaches every circle in
     the DOCUMENT, including the Inspector's ego widget, whose
     circles carry no datum — `n.node` then throws and aborts
     this handler one line before the panel is populated,
     which is what made the Cohort Tracker look dead. */
  d3.selectAll("circle.happy")
    .style("stroke", n => (n && globalHighlightNodesMap[n.node]) || "none")
    .style("stroke-width", n => (n && globalHighlightNodesMap[n.node]) ? 5 : 0);

  // Now update the side widget with the persistent community spirals.
  updateCommunitySpiralSideWidget();
}

function draw_spiral_community(){
if (!ensureBrushSkeleton()) return;
ensureBrushSkeleton();

  // Any normal repaint dismisses the presence-partition compare chrome.
  if (window.PresencePartition) window.PresencePartition.reset();

  // Remove old inter-community edges to prevent them from stacking up
    g.selectAll(".spiral_edges").remove();


  // if we have "most connected nodes" data, we reset find_node_id
  // if (most_connected_nodes_data)
  //    find_node_id = -1;

  //g.selectAll(".brush").remove();
  count = count + 1;
  g.selectAll("circle").remove();

  //define scale
  let xExtent = d3.extent(global_data, d=>d.x);
  let xScale = d3.scaleLinear()
                  .domain(xExtent)
                  .range(xExtent);

  let yExtent = d3.extent(global_data, d=>d.y);
  let yScale = d3.scaleLinear()
                  .domain(yExtent)
                  .range(yExtent);

  let max_density = d3.max(global_data, d=>d.density);

  // define color scales
  colorscaleDensity = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([max_density, 0]);
  colorscaleDegree = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([extent_of_centralities_after_removing_outliers.degree_range[1],
                         extent_of_centralities_after_removing_outliers.degree_range[0] - 3]);
  colorscaleCloseness = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([extent_of_centralities_after_removing_outliers.closeness_range[1],
                         extent_of_centralities_after_removing_outliers.closeness_range[0]] );
  colorscaleBetwness = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([extent_of_centralities_after_removing_outliers.betwness_range[1],
                         extent_of_centralities_after_removing_outliers.betwness_range[0]]);
  colorscaleEign = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([extent_of_centralities_after_removing_outliers.eign_range[1],
                         extent_of_centralities_after_removing_outliers.eign_range[0]]);
  colorscaleVolatility = d3.scaleSequential(d3.interpolateRdYlBu)
                .domain([extent_of_centralities_after_removing_outliers.volatility_range[1],
                         extent_of_centralities_after_removing_outliers.volatility_range[0]]);

  gBrush = g.append("g")
    .attr("class", "brush");
  

  // // define brush
  // brush = d3.brush().on("end", function() {
  //    brushFlag = 1;
  //    var s = d3.brushSelection(this);
  //    if (!s) {
  //      if (!idleTimeout) return idleTimeout = setTimeout(idled, idleDelay);
  //      xScale.domain(xExtent);
  //      yScale.domain(yExtent);
  //    } else {
  //      xScale.domain([s[0][0], s[1][0]].map(xScale.invert, xScale));
  //      yScale.domain([s[1][1], s[0][1]].map(yScale.invert, yScale));
  //      g.select(".brush").call(brush.move, null);
  //    }
  //    var t = g.transition().duration(750);
  //    g.selectAll("circle").transition(t)
  //       .attr("cx", function(d) { return xScale(d.x); })
  //       .attr("cy", function(d) { return yScale(d.y); });
  //    d3.selectAll(".spiral_edges").style("stroke-opacity", 0);
  // });

  // // call brush
  // ── (REPLACED) Disable old brush; zoom/pan handles navigation now.
gBrush = g.append("g").attr("class","brush");
if (false) { // set to true only if you really want both brush and zoom
  brush = d3.brush().on("end", function(){ /* your old brush handler if needed */ });
  gBrush.call(brush);
} else {
  gBrush.remove();
  brushFlag = 0;
}

  //gBrush.call(brush);

  /* ── inter-community edges ────────────────────────────────────────────────
     Communities sit IN ORDER along one Archimedean spiral, so the macro layout
     is effectively 1-D and an edge is an arc over that ordering. Each edge is a
     cubic Bézier whose control points are pulled toward the spiral centroid in
     proportion to how far apart its endpoints are in spiral order:

       neighbours  → almost no pull, the edge hugs the coil
       distant     → strong pull, the edge dives inward

     Long-range edges therefore converge into visible trunks — bundling emerges
     from the layout instead of being iterated, which keeps this O(E) and safe
     to re-run on every α-slider re-layout. */
  buildSpiralEdgeGeometry();
  const spiralEdgeSel = g.selectAll("path.spiral_edges")
    .data((link_data || []).filter(e => edgeEndpoints(e)))
    .join("path")
      .attr("class", "spiral_edges non-scaling-stroke")
      .attr("d", spiralEdgePath);
  applyEdgeStyle(spiralEdgeSel);
  /* No mouseover binding: edges are `pointer-events: none` so they cannot steal
     hover from the nodes underneath. show_edge_tooltip() has had its body
     commented out for some time and is a no-op; to bring the edge tooltip back,
     restore that body, drop pointer-events on .spiral_edges, and rebind here —
     the datum now carries source/target/weight correctly via the data join. */

  // draw nodes
  var node = g.selectAll("circle")
              .data(global_data);

  var newElements = node.enter()
                  .append("circle")
                  .attr("class", "happy")
                  .attr("shape-rendering", "geometricPrecision")
                  .attr("vector-effect", "non-scaling-stroke")
                  .attr("r", function(d){
                    if (d.node == find_node_id) return 4;
                    else return (highlightNodes.indexOf(d.node) !== -1) ? 3 : global_radius;
                  })
                  .style("stroke", function(d) {
                    return globalHighlightNodesMap[d.node] || "none";
                  })
                  .style("stroke-width", function(d) {
                    return globalHighlightNodesMap[d.node] ? 5 : 0;
                  })
                  .style("fill", function(d){
                    if (d.node == find_node_id) {
                      return "black";
                    }
                    
                    //--- ADDED FOR LOCAL VOLATILITY ---
                    if (localVolatilityColFlag == 1) {
                      if (d.type === "outandin") return "#CC79A7";
                      else if (d.type === "incoming") return "#0072B2";
                      else if (d.type === "outgoing") return "#E69F00";
                      else return "#8C8C8C";
                    }

                    if (densityColFlag ==1) {
                      return colorscaleDensity(d.density);
                    }
                    else if (degreeColFlag==1){
                      if (d.centrality>extent_of_centralities_after_removing_outliers.degree_range[1])
                        return "black";
                      else
                        return colorscaleDegree(d.centrality);
                    }
                    else if (closenessColFlag==1){
                      if (d.closeness > extent_of_centralities_after_removing_outliers.closeness_range[1])
                        return "black";
                      else
                        return colorscaleCloseness(d.closeness);
                    }
                    else if (betweennessColFlag==1){
                      if (d.betwness > extent_of_centralities_after_removing_outliers.betwness_range[1])
                        return "black";
                      else
                        return colorscaleBetwness(d.betwness);
                    }
                    else if (eignColFlag==1){
                      if (d.eign > extent_of_centralities_after_removing_outliers.eign_range[1])
                        return "black";
                      else
                        return colorscaleEign(d.eign);
                    }
                    else if (volatilityColFlag==1){
                      if (d.volatility > extent_of_centralities_after_removing_outliers.volatility_range[1])
                        return "black";
                      else
                        return colorscaleVolatility(d.volatility);
                    }
                  })
                  .style("opacity", nodeFilterOpacity)
                  .attr("pointer-events", "all")
                  .on("mouseover", function(event, d) {
                      /* Single hover handler.

                         There used to be TWO `mouseover` registrations on this
                         selection. D3's selection.on(type, fn) replaces the
                         listener for a typename, so the first was silently dead
                         — along with everything only it did: the Cohort Tracker
                         ellipse highlight, the table row highlight, and the
                         community edge emphasis. Those are merged back in here.

                         Deliberately NOT revived:
                         • draw_spiral(), which renders into #community_spiral.
                           That panel no longer exists in index.html (the Cohort
                           Tracker replaced it), so the call would throw on a
                           null getBoundingClientRect().
                         • the activeCommunity/activeNode/activeName globals,
                           which nothing in the codebase reads. The behaviour
                           they were meant to drive is done from `d` directly. */
                      div.transition().duration(200).style("opacity", .9);

                      const activeNodeId = d.node;

                      const adjacent_nodes      = connections_list[activeNodeId] || [];
                      const communityNodesData  = global_data.filter(n => n.community === d.community);

                      // Set membership instead of the old nested filter/some scan
                      const commMembers = new Set(communityNodesData.map(n => n.node));
                      const intraCommunityCollaborators =
                        adjacent_nodes.reduce((c, id) => c + (commMembers.has(id) ? 1 : 0), 0);
                      const crossCount = adjacent_nodes.length - intraCommunityCollaborators;

                      /* The tooltip answers what the hover cannot show: what
                         the dot's colour means, which group it belongs to by
                         NAME rather than by an id that is renumbered every
                         timeslice, and how its neighbours split inside/outside
                         that group -- which is the split the ego edges drawn
                         below are about. */
                      if (flag_most_connected_nodes){
                        div.html("<b>Community:</b> " + d.community);
                      } else {
                        const groupName = (d.anchor_name && String(d.anchor_name).trim())
                          ? d.anchor_name : ("Community " + d.community);
                        div.html(
                          '<div class="tt-name">' + (d.name || ("Node " + d.node)) + "</div>"
                          + hoverStateChip(d)
                          + '<div class="tt-row"><span>Group</span><b>' + groupName + "</b></div>"
                          + '<div class="tt-row"><span>Neighbours</span><b>' + adjacent_nodes.length
                          + "</b></div>"
                          + '<div class="tt-sub">' + intraCommunityCollaborators
                          + " in this group · " + crossCount + " outside</div>"
                          + '<div class="tt-row"><span>Node</span><b>' + d.node + "</b></div>"
                        ).style("text-align", "left");
                      }
                      positionTooltip(div, event);

                      /* Grow the dot under the pointer. At a 2px resting radius
                         the only confirmation of WHICH dot you are reading was
                         the tooltip's own text, which is the thing you are
                         trying to check. Sized off restingRadius so a search
                         hit or a highlighted node keeps its own emphasis. */
                      d3.select(this).raise()
                        .transition().duration(90)
                        .attr("r", restingRadius(d) + HOVER_RADIUS_BOOST);

                      /* Mute this community's own label. It is drawn at the
                         glyph centre, on top of the dots being inspected. */
                      d3.selectAll("text.community-label")
                        .classed("community-label--muted", function(){
                          return this.getAttribute("data-community") == d.community;
                        });

                      draw_textbox(
                        communityNodesData,            // data for all nodes in the group
                        adjacent_nodes,                // all collaborator IDs
                        activeNodeId,                    // the hovered node
                        intraCommunityCollaborators,   // collaborators inside the group
                        d.centrality,                  // degree
                        d.betwness,
                        d.closeness,
                        d.eign,
                        d.name,
                        d.anchor_name
                      );
                      drawCommunityAdjMatrix(communityNodesData, node_to_node_link_data);
                      drawNodeTimesliceChart(activeNodeId);
                      highlightMatrixNode(activeNodeId);
                      if (window.EgoSpiral) window.EgoSpiral.show(activeNodeId);
                      // Fade the weeks this node is not in. Cleared on mouseout
                      // and again on slice load — see markSlicePresence.
                      if (window.markSlicePresence) window.markSlicePresence(activeNodeId);

                      // Cohort Tracker: mark this node wherever it is tracked
                      d3.selectAll(".sideCommEllipse")
                        .filter(n => n && n.node === d.node)
                        .style("stroke", "orange")
                        .style("stroke-width", 5);

                      /* Ego edges as a single data join, inserted beneath the
                         nodes. The old code appended one <line> at a time and
                         called .lower() on each — O(n) DOM churn per hover. */
                      const posByNode = new Map(global_data.map(n => [n.node, n]));
                      const egoEdges = [];
                      adjacent_nodes.forEach(neighborId => {
                        const neighborNode = posByNode.get(neighborId);
                        if (!neighborNode) return;      // neighbour absent this slice
                        const edge = node_to_node_link_data.find(e =>
                          (e.source === activeNodeId && e.target === neighborId) ||
                          (e.target === activeNodeId && e.source === neighborId));
                        if (!edge) return;
                        egoEdges.push({ x1: d.x, y1: d.y,
                                        x2: neighborNode.x, y2: neighborNode.y,
                                        type: edge.type });
                      });
                      g.selectAll("path.adjacent_edges")
                        .data(egoEdges)
                        .join(enter => enter.insert("path", ":first-child"))
                          .attr("class", "adjacent_edges non-scaling-stroke")
                          .attr("d", egoEdgePath)
                          .style("fill", "none")
                          .style("stroke", e => getEdgeColorByType(e.type))
                          // Opaque: these are the focal edges of the hover, and
                          // the cross-community ones are the whole point.
                          .style("stroke-opacity", .85)
                          .style("stroke-width", 1.3);

                      /* Fade everything outside the hovered community — EXCEPT
                         this node's own neighbours, which stay fully visible
                         wherever they live. Cross-community edges otherwise
                         terminate on dimmed nodes, so the edge appears to lead
                         nowhere and brokerage is unreadable.

                         Must use .style(), not .attr(): node enter sets an
                         inline style opacity, which always beats the attribute,
                         so the old .attr("opacity", …) fade never rendered. */
                      if (!flag_most_connected_nodes){
                        const neighbourIds = new Set(adjacent_nodes);
                        d3.selectAll("circle.happy").style("opacity", n => {
                          if (!n) return 1;
                          const kept = n.community === d.community || neighbourIds.has(n.node);
                          return kept ? nodeFilterOpacity(n) : 0.1;
                        });
                      }

                      /* Name the neighbours that sit in OTHER spirals. They were
                         already kept opaque above; without a name an opaque dot
                         across the canvas is just another dot. Highest degree
                         first, so the cap keeps the brokers. */
                      const crossLabels = adjacent_nodes
                        .map(id => posByNode.get(id))
                        .filter(n => n && n.community !== d.community)
                        .sort((a, b) => (b.centrality || 0) - (a.centrality || 0))
                        .map(n => ({ id: n.node, x: n.x, y: n.y,
                                     text: n.name || ("Node " + n.node), ego: false }));
                      drawHoverLabels(g, [
                        { id: d.node, x: d.x, y: d.y,
                          text: d.name || ("Node " + d.node), ego: true },
                        ...crossLabels
                      ]);

                      // Highlight the row in the table, when one is rendered
                      d3.selectAll("tr").style("background-color", function(dat){
                        if (dat === undefined) return null;
                        if (dat.node == find_node_id) return "blue";
                        if (dat.node == activeNodeId)   return "orange";
                        return "transparent";
                      });

                      /* Emphasise the community-level edges incident on this
                         community — a test on the bound datum. The previous
                         version compared rounded x1/y1 coordinates against a
                         centroid, which is both fragile and impossible now that
                         edges are <path> (SVGPathElement has no x1). */
                      if (brushFlag == 0){
                        emphasiseCommunityEdges(d.community);
                      } else {
                        d3.selectAll(".spiral_edges").style("stroke-opacity", 0);
                      }
                  })
                  .on("mouseout", function(event, d) {
                    div.transition().duration(300).style("opacity", 0);
                    clearHoverLabels();
                    d3.selectAll(".adjacent_edges").remove();
                    if (window.markSlicePresence) window.markSlicePresence(null);

                    /* Undo the hover emphasis. Restored to restingRadius rather
                       than to a constant, so a node that is also the search hit
                       or a highlighted node keeps the radius that state gives
                       it. Same duration as the grow, so a sweep across a dense
                       glyph settles instead of pulsing. */
                    d3.select(this).transition().duration(90)
                      .attr("r", restingRadius(d));
                    d3.selectAll("text.community-label")
                      .classed("community-label--muted", false);

                    /* Restore the temporal filter's dimming rather than forcing
                       every node to full opacity — the old reset destroyed the
                       incoming/outgoing selection after the first hover. */
                    d3.selectAll("circle.happy").style("opacity", nodeFilterOpacity);

                    // Restore the weight-driven resting opacity. Setting this to
                    // null used to leave an empty computed value, which is what
                    // broke the edge-visibility toggle's state read-back.
                    resetEdgeOpacity();

                    /* Restore only the ellipse this hover highlighted, to the
                       value the card computed for it — NOT to null. Nulling
                       removes the inline property, and since nothing in css/ or
                       index.html styles .sideCommEllipse it then falls back to
                       the SVG initial `stroke: none` and the ring disappears
                       outright. That silently stripped the ego's heavy black
                       border — the only mark saying whose network a card is —
                       after one hover of that node on the main chart, and now
                       that focus is drawn as a ring too it stripped those as
                       well, leaving a focused member indistinguishable from an
                       unfocused one while still claiming stroke-opacity 0.95.
                       The card's own mouseout gets this right by calling
                       strokeFor(d); those live in the card's closure and cannot
                       be reached from here, so the intended values are stashed
                       on the element at render time and read back. */
                    d3.selectAll(".sideCommEllipse")
                      .filter(n => n && n.node === d.node)
                      .style("stroke", function () {
                        return this.getAttribute("data-stroke") || "#333";
                      })
                      .style("stroke-width", function () {
                        return this.getAttribute("data-stroke-width") || 1;
                      });

                  })
                  /* Cohort snapshot. Bound through a pointer pair rather than
                     "click": d3-zoom suppresses the native click after ANY
                     pointer movement between down and up, which made selecting
                     a small node feel unreliable even once the exception below
                     was fixed. A 3px tolerance treats a nudge as a click. */
                  .on("pointerdown", function(event){
                    _cohortClickDown = [event.clientX, event.clientY];
                  })
                  .on("pointerup", function(event, d){
                    const down = _cohortClickDown; _cohortClickDown = null;
                    if (!down) return;
                    if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 3) return;
                    event.stopPropagation();
                    snapshotCommunityCohort(d);
                  });
                  

  // Assume "node" is your d3 selection for the circles (nodes)
  // After entering and before the transition, update the merge like this:
  // node.merge(newElements)
  // .transition()
  // .duration(750)
  // .attr("cx", function(d) { return xScale(d.x); })
  // .attr("cy", function(d) { return yScale(d.y); });
  node.merge(newElements)
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);



  g.selectAll(".axis").remove();
  g.selectAll(".text_for_legend").remove();

  // Unified legend that always reflects the active colour encoding.
  renderSpiralLegend();

  // Community labels + growth/shrink indicators (top-K by size).
  renderCommunityLabels();

   // Initialize main canvas zoom/pan once, then keep using it
// Ensure newly drawn layers zoom correctly, then init/refresh zoom + first fit
adoptLooseChildren();

if (window.SpinTrixMainZoom) {
  window.SpinTrixMainZoom.setup();                 // safe/idempotent
  window.SpinTrixMainZoom.markNonScalingStrokes(); // keep line widths constant
  // if (!window.__fitOnceDone__) {
  //   window.SpinTrixMainZoom.fitAll(300);           // includes off-canvas nodes
  //   window.__fitOnceDone__ = true;
  // }
  window.SpinTrixMainZoom.fitAll(window.__fitOnceDone__ ? 0 : 300);
  window.__fitOnceDone__ = true;
}



}

/* ─────────────────────────────────────────────────────────────────────────
   Unified spiral legend.
   Renders into #spiralLegend and always matches the active colour encoding:
   • Local Volatility  → four discrete, labelled categorical swatches.
   • Continuous scales → a gradient ramp with min/max readouts + the name.
   ───────────────────────────────────────────────────────────────────────── */
function renderSpiralLegend() {
  const host = d3.select("#spiralLegend");
  if (host.empty()) return;

  const SC = window.STATE_COLORS || {
    incoming: "#0072B2", outgoing: "#E69F00", both: "#CC79A7", stable: "#8C8C8C"
  };

  // ── Categorical: temporal state (Local Volatility) ──────────────────────
  if (localVolatilityColFlag == 1) {
    // Swatch colour and default wording per state. At the first/last slice the
    // ±1 window is one-sided, so LocalVolatility narrows this to the states the
    // slice can actually produce and relabels them — the legend must never
    // advertise a category the data cannot contain.
    const SWATCH = {
      incoming: { col: SC.incoming, id: "incoming-legend-info",
                  tip: "<b>Incoming:</b> New arrival; did not exist in previous slice." },
      outgoing: { col: SC.outgoing, id: "outgoing-legend-info",
                  tip: "<b>Outgoing:</b> Exists in current slice, disappears in next." },
      stable:   { col: SC.stable,   id: "stable-legend-info",
                  tip: "<b>Stable:</b> Persistent core; exists in T-1, T, and T+1." },
      outandin: { col: SC.both,     id: "transient-legend-info",
                  tip: "<b>Transient:</b> Appears and disappears within a single slice." }
    };

    const LV = window.LocalVolatility;
    const i  = (window.currentSlices || []).indexOf(window.currentYearRange);
    const n  = (window.currentSlices || []).length;
    const states = LV ? LV.statesFor(i, n)
                      : ["incoming", "outgoing", "stable", "outandin"];
    const note = LV ? LV.censorNote(i, n) : "";

    const items = states.map(s => {
      const sw = SWATCH[s];
      if (!sw) return "";
      const label = LV ? LV.labelFor(s, i, n) : s;
      return `
      <div class="legend-item">
        <span class="color-box" style="background:${sw.col}"></span><span>${label}</span>
        <span class="info-tooltip"><span class="info-icon">i</span><span class="info-text" id="${sw.id}">${sw.tip}</span></span>
      </div>`;
    }).join("");

    const noteHtml = note ? `
      <div class="legend-item legend-item--note" title="${note}">
        <span class="legend-censor-mark" aria-hidden="true"></span>
        <span class="legend-censor-text">Edge of data</span>
        <span class="info-tooltip"><span class="info-icon">i</span><span class="info-text">${note}</span></span>
      </div>` : "";

    host.classed("legend", true).html(items + noteHtml);
    // Re-apply slice-aware wording (spans were just recreated).
    if (typeof window.refreshLegendTooltips === "function") window.refreshLegendTooltips();
    return;
  }

  // ── Continuous encodings: gradient ramp ─────────────────────────────────
  let scale, name;
  if (densityColFlag == 1)          { scale = colorscaleDensity;    name = "Density"; }
  else if (degreeColFlag == 1)      { scale = colorscaleDegree;     name = "Degree"; }
  else if (closenessColFlag == 1)   { scale = colorscaleCloseness;  name = "Closeness"; }
  else if (betweennessColFlag == 1) { scale = colorscaleBetwness;   name = "Betweenness"; }
  else if (eignColFlag == 1)        { scale = colorscaleEign;       name = "Eigenvector"; }
  else if (volatilityColFlag == 1)  { scale = colorscaleVolatility; name = "Volatility"; }
  else { host.html(""); return; }

  if (!scale || typeof scale.domain !== "function") { host.html(""); return; }
  const domain = scale.domain();
  const lo = domain[0];
  const hi = domain[domain.length - 1];

  const N = 16;
  const stops = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const v = lo + t * (hi - lo);
    const col = d3.color(scale(v));
    stops.push(`${col ? col.formatRgb() : "#ccc"} ${Math.round(t * 100)}%`);
  }

  const fmt = v => (Number.isInteger(v) || Math.abs(v) >= 100) ? Math.round(v) : (+v).toFixed(2);

  host.classed("legend", true).html(`
    <div class="legend-continuous">
      <span class="legend-name">${name}</span>
      <span class="legend-min">${fmt(lo)}</span>
      <span class="legend-ramp" style="background:linear-gradient(to right, ${stops.join(",")})"></span>
      <span class="legend-max">${fmt(hi)}</span>
    </div>
  `);
}
window.renderSpiralLegend = renderSpiralLegend;

/* ─────────────────────────────────────────────────────────────────────────
   Community labels + growth/shrink indicators.
   The top-K communities (by member count) get a text label at their spiral
   centre: the seed anchor name when the dataset provides one, else the
   highest-degree member's name, else "C<id>". When a previous slice is in
   the cross-slice cache, the label carries a size delta (▲n / ▼n) computed
   against the community's member-overlap predecessor — the previous-slice
   community that contributed the plurality of its current members — so the
   indicator stays meaningful even when community ids are not stable across
   slices. "✦ new" marks communities with no members present at t−1.
   Labels are pointer-transparent so node hover underneath keeps working.
   ───────────────────────────────────────────────────────────────────────── */
function renderCommunityLabels(){
  if (window.PresencePartition && window.PresencePartition.active) return;
  g.selectAll(".community-label").remove();
  if (window.showCommunityLabels === false) return;
  if (typeof center_positions_spiral === "undefined" || !center_positions_spiral) return;
  if (!global_data || !global_data.length) return;

  const TOP_K = 12;
  const byComm = d3.group(global_data, d => d.community);
  const ranked = Array.from(byComm, ([comm, rows]) => ({ comm, rows, size: rows.length }))
                      .sort((a, b) => b.size - a.size)
                      .slice(0, TOP_K);

  // center_positions_spiral is an ARRAY of {community, size, cx, cy} —
  // build an id-keyed lookup rather than indexing by community id.
  const centerByComm = {};
  (Array.isArray(center_positions_spiral) ? center_positions_spiral
      : Object.values(center_positions_spiral)).forEach(c => {
    if (c && c.community !== undefined) centerByComm[+c.community] = c;
  });

  // Previous slice's node → community dict (for the growth indicator).
  const slices = window.currentSlices || [];
  const tIdx = slices.indexOf(window.currentYearRange);
  const prevDict = (tIdx > 0 && typeof allYearsNodeData !== "undefined")
      ? allYearsNodeData[slices[tIdx - 1]] : null;
  let prevSizes = null;
  if (prevDict){
    prevSizes = {};
    Object.values(prevDict).forEach(n => {
      prevSizes[n.community] = (prevSizes[n.community] || 0) + 1;
    });
  }

  const bad = v => (v === undefined || v === null || v === "" ||
                    v === "None" || v === "undefined" || v === "NaN");

  ranked.forEach(({ comm, rows, size }) => {
    const cp = centerByComm[+comm];
    if (!cp) return;

    let lbl = null;
    const anchorRow = rows.find(r => !bad(r.anchor_name));
    if (anchorRow) lbl = String(anchorRow.anchor_name);
    if (!lbl){
      // Ground-truth datasets name nodes "<group>#<id>"; when most members
      // share the same "<group>#" prefix, the group name IS the community.
      const prefixes = {};
      let named = 0;
      rows.forEach(r => {
        if (bad(r.name)) return;
        named++;
        const s = String(r.name);
        const h = s.indexOf("#");
        if (h > 0) prefixes[s.slice(0, h)] = (prefixes[s.slice(0, h)] || 0) + 1;
      });
      const best = Object.entries(prefixes).sort((a, b) => b[1] - a[1])[0];
      if (best && named && best[1] >= 0.8 * named) lbl = best[0];
    }
    if (!lbl){
      const top = rows.reduce((a, b) => (+b.centrality > +a.centrality ? b : a), rows[0]);
      if (top && !bad(top.name)) lbl = String(top.name);
    }
    if (!lbl) lbl = "C" + comm;
    if (lbl.length > 30) lbl = lbl.slice(0, 29) + "…";

    let delta = "";
    if (prevDict){
      const votes = {};
      let present = 0;
      rows.forEach(r => {
        const p = prevDict[r.node];
        if (p && p.community !== undefined && !Number.isNaN(p.community)){
          votes[p.community] = (votes[p.community] || 0) + 1;
          present++;
        }
      });
      if (!present){
        delta = " ✦ new";
      } else {
        const pred = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
        const d = size - (prevSizes[pred] || 0);
        if (d > 0)      delta = " ▲" + d;
        else if (d < 0) delta = " ▼" + Math.abs(d);
      }
    }

    g.append("text")
      .attr("class", "community-label")
      /* Carries its community so a hover can mute this one label without
         touching the others. The label sits at the glyph's CENTRE, which is
         exactly where the dots you are inspecting are, so leaving it up means
         reading a name printed across the thing it names. */
      .attr("data-community", comm)
      .attr("x", cp.cx)
      .attr("y", cp.cy)
      .attr("text-anchor", "middle")
      .text(lbl + delta);
  });
}
window.renderCommunityLabels = renderCommunityLabels;

window.toggleCommunityLabels = function(){
  window.showCommunityLabels = (window.showCommunityLabels === false);
  const btn = document.getElementById("labelToggle");
  if (btn) btn.classList.toggle("active", window.showCommunityLabels !== false);
  renderCommunityLabels();
};

function drawNodeTimesliceChart(nodeID){
  /* ─────────────────────────────────────────
     1 ▸ build summary object for every slice
     ───────────────────────────────────────── */
  let stackedData = [];

  (window.currentSlices || []).forEach(yr=>{
    const nodeInfo = allYearsNodeData[yr]  || {};
    const edgeInfo = allYearsNodeLinks[yr] || [];

    const me = nodeInfo[nodeID];
    const nodeType = me ? me.type : "none";

    /* edge counts (old code) */
    let inc=0,out=0,io=0,stable=0;

    /* NEW ▸ track communities we touch in this slice */
    const commSet = new Set();
    if(me) commSet.add(me.community);     // include my own community

    edgeInfo.forEach(e=>{
      if(e.source!==nodeID && e.target!==nodeID) return;

      if(e.type==="incoming")      inc++;
      else if(e.type==="outgoing") out++;
      else if(e.type==="outandin") io++;
      else                         stable++;

      const other = (e.source===nodeID) ? e.target : e.source;
      if(nodeInfo[other])                    // neighbour exists this slice
        commSet.add(nodeInfo[other].community);
    });

    stackedData.push({
      year:yr, incoming:inc, outgoing:out, outandin:io, none:stable,
      nodeType,                           // ellipse colour
      commCount:commSet.size              // NEW ▸ number printed inside
    });
  });

  /* ─────────────────────────────────────────
     2 ▸ draw stacked bar chart (unchanged)
     ───────────────────────────────────────── */
  d3.select("#nodeTimesliceChart").selectAll("*").remove();

  const M={top:30,right:10,bottom:40,left:60},
        W=300-M.left-M.right,
        H=200-M.top-M.bottom;

  // Responsive: the SVG scales to the card via viewBox, and a small root
  // font-size keeps axis/label text proportional (was inheriting the 16px
  // document default, which made the labels huge).
  const svg = d3.select("#nodeTimesliceChart").append("svg")
      .attr("viewBox",`0 0 ${W+M.left+M.right} ${H+M.top+M.bottom}`)
      .attr("preserveAspectRatio","xMidYMid meet")
      .style("width","100%")
      .style("height","auto")
      .style("max-width",(W+M.left+M.right)+"px")
      .style("font-family","Inter, sans-serif")
      .style("font-size","10px")
    .append("g").attr("transform",`translate(${M.left},${M.top})`);

  const sub=["incoming","outgoing","outandin","none"];
  const x=d3.scaleBand().domain(stackedData.map(d=>d.year))
                        .range([0,W]).padding(0.2);
  const y=d3.scaleLinear()
            .domain([0,d3.max(stackedData,d=>d.incoming+d.outgoing+d.outandin+d.none)])
            .range([H,0]);
  const col=d3.scaleOrdinal().domain(sub)
              .range(["#0072B2","#E69F00","#CC79A7","#8C8C8C"]);

  const series=d3.stack().keys(sub)(stackedData);

  svg.append("g").selectAll("g")
      .data(series).enter().append("g")
        .attr("fill",d=>col(d.key))
      .selectAll("rect")
        .data(d=>d).enter().append("rect")
          .attr("x",d=>x(d.data.year))
          .attr("y",d=>y(d[1]))
          .attr("height",d=>y(d[0])-y(d[1]))
          .attr("width",x.bandwidth());

  // Label only the first & last slice — a "1 … n" flow — so many-slice datasets
  // don't produce an overlapping wall of x-axis labels.
  const _endTicks = stackedData.length
    ? [stackedData[0].year, stackedData[stackedData.length - 1].year].filter((v, i, a) => a.indexOf(v) === i)
    : [];
  svg.append("g").attr("transform",`translate(0,${H})`).call(d3.axisBottom(x).tickValues(_endTicks));
  svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")));

  svg.append("text").attr("x",W/2).attr("y",H+M.bottom-5)
     .attr("text-anchor","middle").attr("font-size","11px").attr("fill","#4b4b50").text("Timeslices");
  svg.append("text").attr("transform","rotate(-90)")
     .attr("x",-H/2).attr("y",-M.left+15)
     .attr("text-anchor","middle").attr("font-size","11px").attr("fill","#4b4b50").text("No. of Edges");

  /* ─────────────────────────────────────────
     3 ▸ ellipse + white number inside
     ───────────────────────────────────────── */
  svg.selectAll(".nodeTypeEllipse")
      .data(stackedData).enter().append("ellipse")
        .attr("class","nodeTypeEllipse")
        .attr("cx",d=>x(d.year)+x.bandwidth()/2)
        .attr("cy",d=> y(d.incoming+d.outgoing+d.outandin+d.none) - 10)
        .attr("rx",d=> d.year===window.currentYearRange ? 10 : 8)
        .attr("ry",d=> d.year===window.currentYearRange ? 6.5 : 5)
        .attr("fill",d=>{
          if(d.nodeType==="incoming")  return "#0072B2";
          if(d.nodeType==="outgoing")  return "#E69F00";
          if(d.nodeType==="outandin")  return "#CC79A7";
          return "#8C8C8C";
        })
        // "You are here" ring on the current slice's oval.
        .attr("stroke",d=> d.year===window.currentYearRange ? "#1d1d1f" : "#fff")
        .attr("stroke-width",d=> d.year===window.currentYearRange ? 2 : 0.5);

  // Caret above the current slice's oval, reinforcing "you are here".
  const _cur = stackedData.find(d=>d.year===window.currentYearRange);
  if(_cur){
    const _cx = x(_cur.year)+x.bandwidth()/2;
    const _cy = y(_cur.incoming+_cur.outgoing+_cur.outandin+_cur.none) - 10;
    svg.append("text").attr("x",_cx).attr("y",_cy-11)
       .attr("text-anchor","middle").attr("font-size","11px").attr("fill","#1d1d1f")
       .attr("font-weight","700").text("▾");
  }

  svg.selectAll(".communityCountText")
      .data(stackedData).enter().append("text")
        .attr("class","communityCountText")
        .attr("x",d=>x(d.year)+x.bandwidth()/2)
        .attr("y",d=> y(d.incoming+d.outgoing+d.outandin+d.none) - 9) // tiny nudge
        .attr("text-anchor","middle").attr("dominant-baseline","middle")
        .attr("font-size","9px").attr("fill","white")
        .text(d=>d.commCount);     // ← the number you wanted
}





// // 8) Add prominent colored ellipses at the top of each bar
// svg.selectAll(".ellipse")
// .data(barData)
// .enter()
// .append("ellipse")
//   .attr("cx", d => x(d.year) + x.bandwidth() / 2) // Center horizontally
//   .attr("cy", d => y(d.edges) - 10) // Position above the bar
//   .attr("rx", 8) // Horizontal radius of the ellipse
//   .attr("ry", 5) // Vertical radius of the ellipse
//   .attr("fill", d => {
//     if (d.type === "outgoing") return "#E69F00";
//     else if (d.type === "incoming") return "#0072B2";
//     else if (d.type === "outandin") return "#CC79A7";
//     else return "#8C8C8C"; // Default color for "none"
//   });




function drawCommunityAdjMatrix(new_data1, node_to_node_link_data) {
  // 1) Sort the community nodes by ID so rows/columns are consistent
  new_data1.sort((a, b) => d3.ascending(a.node, b.node));

  // 2) Build a quick lookup of edges for this community
  let edgeMap = new Map();
  let edgesInThisCommunity = [];

  // Also build a small adjacency map => adjacency[nodeID] = array of neighborIDs
  let adjacency = {};

  // Initialize adjacency lists
  new_data1.forEach(n => {
    adjacency[n.node] = [];
  });

  node_to_node_link_data.forEach(e => {
    let inCommSource = new_data1.some(n => n.node === e.source);
    let inCommTarget = new_data1.some(n => n.node === e.target);
    if (inCommSource && inCommTarget) {
      // For undirected, store minID,maxID as key
      let minID = Math.min(e.source, e.target);
      let maxID = Math.max(e.source, e.target);
      let key = `${minID},${maxID}`;
      edgeMap.set(key, e.type || "none");

      edgesInThisCommunity.push(e);

      // Populate adjacency
      adjacency[e.source].push(e.target);
      adjacency[e.target].push(e.source);
    }
  });

  // 3) Remove old matrix
  d3.select("#communityMatrix").selectAll("*").remove();

  // 4) Compute community-level stats (for legend)
  let totalEdges = edgesInThisCommunity.length;
  let incomingCount = 0, outgoingCount = 0, outandinCount = 0, noneCount = 0;
  edgesInThisCommunity.forEach(e => {
    if (e.type === "incoming") incomingCount++;
    else if (e.type === "outgoing") outgoingCount++;
    else if (e.type === "outandin") outandinCount++;
    else noneCount++;
  });

  // 5) Make a small legend for the matrix
  let legendDiv = d3.select("#communityMatrixLegend")
                    .style("font-size", "12px")
                    //.style("margin", "6px 0px");

                    legendDiv.html(`
                      <div align:"right">
                        <b>Community Information:</b> <br>
                        <span>Total Edges: ${totalEdges}</span> <br>
                        <span>Incoming: ${incomingCount}</span> <br>
                        <span>Outgoing: ${outgoingCount}</span> <br>
                        <span>Transient: ${outandinCount}</span> <br>
                        <span>Stable: ${noneCount}</span>
                      </div>
                    `);

  // 5b) Summarize very large communities: cap to the top-K nodes by
  //     intra-community degree so the matrix stays legible and the DOM bounded
  //     (fit + summarize). The info box keeps the true totals.
  const MATRIX_MAX_NODES = 80;
  let hiddenNodeCount = 0;
  if (new_data1.length > MATRIX_MAX_NODES) {
    hiddenNodeCount = new_data1.length - MATRIX_MAX_NODES;
    new_data1 = new_data1
      .slice()
      .sort((a, b) => (adjacency[b.node] || []).length - (adjacency[a.node] || []).length)
      .slice(0, MATRIX_MAX_NODES)
      .sort((a, b) => d3.ascending(a.node, b.node));
    d3.select("#communityMatrixLegend").append("div")
      .style("margin-top", "6px")
      .style("font-style", "italic")
      .style("color", "#86868b")
      .html(`Showing top ${MATRIX_MAX_NODES} by degree · +${hiddenNodeCount} more`);
  }

  // 6) Basic geometry.
  //    The SVG uses a viewBox of the FULL grid and scales responsively to its
  //    container (width:100%, height:auto via CSS), so the whole matrix is
  //    always visible without scrollbars — however large the community is.
  //    max-width is capped at the natural pixel size so tiny matrices don't
  //    balloon to blurry proportions.
  let size = new_data1.length;
  let cellSize = 5;
  let margin = 4;
  let totalSize = margin * 2 + size * cellSize;

  let svg = d3.select("#communityMatrix")
              .append("svg")
              .attr("viewBox", `0 0 ${totalSize} ${totalSize}`)
              .attr("preserveAspectRatio", "xMidYMid meet")
              .style("width", "100%")
              .style("height", "auto")
              .style("max-width", totalSize + "px")
              .style("max-height", "100%");

  // 7) Our color function for the edge type
  function colorByEdgeType(type) {
    if (type === "incoming")  return "#0072B2"; // e.g. blue
    else if (type === "outgoing")  return "#E69F00"; // e.g. orange
    else if (type === "outandin")  return "#CC79A7"; // e.g. red
    else return "white"; // fallback color
  }

  // 8) Build array of row/col pairs
  let matrixPairs = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      matrixPairs.push({
        rowIndex: r,
        colIndex: c,
        rowNode: new_data1[r],
        colNode: new_data1[c]
      });
    }
  }

  // 9) Draw the cells
  let cellSelection = svg.selectAll(".cell")
    .data(matrixPairs)
    .enter()
    .append("rect")
      .attr("class", "cell")
      .attr("x", d => margin + d.colIndex * cellSize)
      .attr("y", d => margin + d.rowIndex * cellSize)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("stroke", "#ccc")
      .attr("fill", d => {
        // diagonal => #eee
        if (d.rowNode.node === d.colNode.node) return "#eee";

        let minID = Math.min(d.rowNode.node, d.colNode.node);
        let maxID = Math.max(d.rowNode.node, d.colNode.node);
        let key = `${minID},${maxID}`;
        let etype = edgeMap.get(key);
        return colorByEdgeType(etype);
      })
      .on("mouseover", function(event, d) {
        // Show a tooltip with (source, target)
        d3.select("#adjMatrixTooltip")
          .style("opacity", 1)
          .style("left", (event.pageX + 8) + "px")
          .style("top", (event.pageY - 20) + "px")
          .html(`Source: ${d.rowNode.node}<br/>Target: ${d.colNode.node}`);
      })
      .on("mouseout", function() {
        d3.select("#adjMatrixTooltip")
          .style("opacity", 0);
      });

  // 10) Row labels
  let rowLabels = svg.selectAll(".rowLabel")
    .data(new_data1)
    .enter()
    .append("text")
      .attr("class", "rowLabel")
      .attr("x", margin - 5)
      .attr("y", (d, i) => margin + i * cellSize + cellSize*0.65)
      .attr("text-anchor", "end")
      .style("font-size", "10px")
      .text(d => d.node)
      .on("mouseover", function(event, d) {
        // 1) Clear existing highlight
        rowLabels.style("fill", "black");
        colLabels.style("fill", "black");

        // 2) The hovered node => highlight in red
        d3.select(this).style("fill", "red");

        // 3) highlight neighbors in blue
        let nodeID = d.node;
        let neighbors = adjacency[nodeID];
        // For each neighbor, highlight rowLabels & colLabels in blue
        rowLabels.filter(n => neighbors.includes(n.node))
                 .style("fill", "blue");
        colLabels.filter(n => neighbors.includes(n.node))
                 .style("fill", "blue");
      })
      .on("mouseout", function() {
        // Reset all labels to black
        rowLabels.style("fill", "black");
        colLabels.style("fill", "black");
      });

  // 11) Column labels
  let colLabels = svg.selectAll(".colLabel")
    .data(new_data1)
    .enter()
    .append("text")
      .attr("class", "colLabel")
      .attr("x", (d, i) => margin + i * cellSize + cellSize*0.5)
      .attr("y", margin - 5)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .text(d => d.node)
      .on("mouseover", function(event, d) {
        // 1) Clear existing highlight
        rowLabels.style("fill", "black");
        colLabels.style("fill", "black");

        // 2) The hovered node => highlight in red
        d3.select(this).style("fill", "red");

        // 3) highlight neighbors in blue
        let nodeID = d.node;
        let neighbors = adjacency[nodeID];
        rowLabels.filter(n => neighbors.includes(n.node))
                 .style("fill", "blue");
        colLabels.filter(n => neighbors.includes(n.node))
                 .style("fill", "blue");
      })
      .on("mouseout", function() {
        // Reset all labels
        rowLabels.style("fill", "black");
        colLabels.style("fill", "black");
      });

  // 12) Save references if you want to highlight from the spiral as well
  window.__currentCommunityMatrix__ = {
    rowLabels, colLabels, cellSelection, new_data1,
    edgesInThisCommunity, edgeMap
  };
}



function highlightMatrixNode(nodeID) {
  if (!window.__currentCommunityMatrix__) return;

  let {
    rowLabels, 
    colLabels, 
    cellSelection, 
    new_data1,
    edgesInThisCommunity, 
    edgeMap
  } = window.__currentCommunityMatrix__;

  // 1) Clear old highlights: revert to black/normal
  rowLabels.style("fill","black").style("font-weight","normal");
  colLabels.style("fill","black").style("font-weight","normal");

  if (nodeID == null) {
    return; // no node hovered => no highlight
  }

  // 2) Find neighbors of nodeID within the community
  //    We can do that by scanning edgesInThisCommunity
  let neighborIDs = new Set();
  edgesInThisCommunity.forEach(e => {
    if (e.source === nodeID) neighborIDs.add(e.target);
    if (e.target === nodeID) neighborIDs.add(e.source);
  });

  // 3) Highlight the hovered node in RED
  rowLabels.filter(d => d.node === nodeID)
           .style("fill","red")
           .style("font-weight","bold");
           //.raise();
  colLabels.filter(d => d.node === nodeID)
           .style("fill","red")
           .style("font-weight","bold");
           //.raise();

  // 4) Highlight the neighbors in BLUE
  rowLabels.filter(d => neighborIDs.has(d.node))
           .style("fill","blue")
           .style("font-weight","bold");
           //.raise();

  colLabels.filter(d => neighborIDs.has(d.node))
           .style("fill","blue")
           .style("font-weight","bold");
           //.raise();
}


///////////////////////////////////////////////
// GLOBAL MAP + HELPER for Random Community Colors
///////////////////////////////////////////////
let randomColorsByTimeslice = {};

function getRandomColorForTimesliceCommunity(timeslice, commID) {
  if (!randomColorsByTimeslice[timeslice]) {
    randomColorsByTimeslice[timeslice] = {};
  }
  if (!randomColorsByTimeslice[timeslice][commID]) {
    let randHex = "#" + (Math.random().toString(16) + "000000").slice(2, 8);
    randomColorsByTimeslice[timeslice][commID] = randHex;
  }
  return randomColorsByTimeslice[timeslice][commID];
}

/**
 * Consistent colour for an edge or node type, shared by main view and side widgets
 */
 function getEdgeColorByType(t){
   if (t === "incoming")  return "#0072B2";   // blue
   if (t === "outgoing")  return "#E69F00";   // orange
   if (t === "outandin")  return "#CC79A7";   // red
   return "#8C8C8C";                          // “neither” / undefined
}



///////////////////////////////////////////////
// UPDATE COMMUNITY SPIRAL SIDE WIDGET
///////////////////////////////////////////////

/*─────────────────────────────────────────────────────────────────────────────
  Helper ▸ return a d3.zoomIdentity that scales + translates the rectangle
  [xMin,xMax] × [yMin,yMax] so it fits into a w × h viewport with “pad” pixels
  of breathing-room on every side.
─────────────────────────────────────────────────────────────────────────────*/
function getFitTransform (xMin, xMax, yMin, yMax, w, h, pad = 10) {
  // validate bounds
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
    return d3.zoomIdentity; // nothing to fit
  }
  const dataW = Math.max(xMax - xMin, 1e-6);
  const dataH = Math.max(yMax - yMin, 1e-6);
  const availW = Math.max(w - 2*pad, 1);
  const availH = Math.max(h - 2*pad, 1);

  let s = Math.min(availW / dataW, availH / dataH);
  if (!Number.isFinite(s) || s <= 0) s = 1;

  const tx = (w - s * (xMin + xMax)) / 2;
  const ty = (h - s * (yMin + yMax)) / 2;

  return d3.zoomIdentity
    .translate(Number.isFinite(tx) ? tx : 0, Number.isFinite(ty) ? ty : 0)
    .scale(s);
}


/*─────────────────────────────────────────────────────────────────────────────
  FULL SIDE-WIDGET REDRAW
  – shows up to three selected communities, each in its own mini-spiral
  – adaptive fit, +/–/reset buttons, random-colour checkbox
  – complete hover behaviour (tooltip, edge swapping, main-view highlight,
    side textbox & charts, etc.) restored
─────────────────────────────────────────────────────────────────────────────*/
/*─────────────────────────────────────────────────────────────────────────────
 FULL SIDE-WIDGET REDRAW (Fixed)
─────────────────────────────────────────────────────────────────────────────*/
function updateCommunitySpiralSideWidget() {

  /* The panel is sized by how many cards it holds — one card in a 730px box is
     mostly whitespace, three need the room to sit side by side. CSS keys off
     this attribute rather than guessing. */
  const _cohortFloat = document.getElementById("cohortFloat");
  if (_cohortFloat)
    _cohortFloat.setAttribute("data-cards", String(selectedCommunitySpirals.length));

  /* 1 ▸ nothing selected → wipe, collapse + dock back into the column, bail out */
  if (selectedCommunitySpirals.length === 0) {
    d3.select("#communitySideContainer").html("");
    if (_cohortFloat) _cohortFloat.classList.add("collapsed");
    document.body.classList.remove("cohorts-active");
    return;
  }

  const highlightColors = ["gold", "magenta", "green"]; // max. three

  /* 2 ▸ fresh canvas every time */
  d3.select("#communitySideContainer").html("");

  /* 3 ▸ one mini-spiral <div> per selected community */
  selectedCommunitySpirals.forEach((selObj, index) => {

    /* ───── a) outer <div> + header row ─────────────────────────────────── */
    const subDivID = `sideSpiralDiv_${index}`;
    const sideDiv = d3.select("#communitySideContainer")
      .append("div")
      .attr("id", subDivID)
      .style("border", "1px solid #ccc")
      .style("padding", "6px")
      .style("margin-bottom", "10px");

    const headerRow = sideDiv.append("div")
      .style("display", "flex")
      .style("justify-content", "space-between")
      .style("align-items", "center")
      .style("flex-wrap", "wrap")
      .style("gap", "4px 6px");

    /* Titles can now be a person's name plus a qualifier, not just
       "Community 7". The row also carries Unselect and three zoom buttons, so
       in a 320px card the title gets its own line (flex-basis 100%) and the
       controls wrap beneath it. Without min-width:0 it would refuse to shrink
       and the buttons would land on top of the text. */
    const headerText = `${selObj.label || ("Community " + selObj.communityID)} · ${selObj.yearRange}`;
    headerRow.append("span")
      .style("flex", "1 1 100%")
      .style("min-width", "0")
      .style("overflow", "hidden")
      .style("text-overflow", "ellipsis")
      .style("white-space", "nowrap")
      .attr("title", headerText)
      .html(`<b>${headerText}</b>`);

    /* The focus is emphasis WITHIN this card, so it belongs on its own line
       under the title with an explicit way out — otherwise a dimmed card looks
       broken rather than filtered. */
    if (selObj.focus && selObj.focus.label) {
      const fRow = headerRow.append("span")
        .style("flex", "1 1 100%")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "6px")
        .style("font-size", "0.7rem")
        .style("color", "#555");
      fRow.append("span")
        .style("overflow", "hidden").style("text-overflow", "ellipsis")
        .style("white-space", "nowrap")
        .text("Focus: " + selObj.focus.label);
      fRow.append("button")
        .style("flex", "0 0 auto")
        .text("Clear")
        .on("click", () => { selObj.focus = null; updateCommunitySpiralSideWidget(); });
    }

    /* remove-selection btn */
    headerRow.append("button")
      .style("flex", "0 0 auto")
      .text("Unselect")
      .on("click", () => {
        selectedCommunitySpirals.splice(index, 1); // drop it
        /* rebuild globalHighlightNodesMap */
        const newMap = {};
        selectedCommunitySpirals.forEach((s, i) => {
          const col = highlightColors[i] || "gold";
          s.originalNodeData.forEach(n => {
            if (!(n.node in newMap)) newMap[n.node] = col;
          });
        });
        globalHighlightNodesMap = newMap;
        d3.selectAll(".happy")
          .style("stroke", d => globalHighlightNodesMap[d.node] || "none")
          .style("stroke-width", d => globalHighlightNodesMap[d.node] ? 1 : 0);
        updateCommunitySpiralSideWidget(); // re-render
      });

    /* ───── b) svg canvas ──────────────────────────────────────────────── */
    const SVG_W = 300,
      SVG_H = 300;
    // viewBox (not fixed width/height) so each snapshot scales to the floaty
    // card. The inner gRoot is still fitted against SVG_W/SVG_H below.
    const svg = sideDiv.append("svg")
      .attr("viewBox", `0 0 ${SVG_W} ${SVG_H}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "auto")
      .style("display", "block");

    /* gRoot will be zoomed/panned as a single unit */
    const gRoot = svg.append("g");

    /* original node & edge data kept from click-time */
    const nodesOriginal = selObj.originalNodeData;
    const edgesOriginal = selObj.originalLinkData || [];

    /* mapping of nodes that still exist in the CURRENT timeslice */
    const currentNodeMap = new Map();
    global_data.forEach(n => currentNodeMap.set(n.node, n));

    /* edges among those present in the current slice */
    const nodeIDsSet = new Set(nodesOriginal.map(d => d.node));
    const edgesCurrent = node_to_node_link_data.filter(
      e => nodeIDsSet.has(e.source) && nodeIDsSet.has(e.target));

    /* ───── c) deterministic spiral layout for the original nodes ─────── */
    const centreX = 150,
      centreY = 150,
      R = 800,
      sides = 450,
      coils = 25,
      rotation = 0;
    const awayStep = R / sides,
      aroundStep = coils / sides,
      aroundRad = aroundStep * 2 * Math.PI;

    /* An ego-network cohort is only comparable against another one if you can
       see whose network it is, so the ego takes the centre. The spiral starts
       at i + 30 — roughly 53px out — so the centre is empty anyway and the
       neighbours keep the exact positions they would have had without it. */
    const isEgo = d => selObj.egoID != null && d.node === selObj.egoID;
    let spiralIdx = 0;
    nodesOriginal.forEach(d => {
      if (isEgo(d)) { d.new_x = centreX; d.new_y = centreY; return; }
      const i = spiralIdx++;
      const away = (i + 30) * awayStep;
      const around = (i + 30) * aroundRad + rotation;
      d.new_x = centreX + Math.cos(around) * away;
      d.new_y = centreY + Math.sin(around) * away;
    });

    /* .sideCommEllipse is a global selector shared by all three cards, and the
       hover/mouseout handlers below repaint stroke unconditionally — so the
       ego's border has to be derived from the datum every time it is set,
       never hardcoded, or the first mouseout strips it. */
    /* Two independent reasons to fade. They used to be an if/else, so the first
       one answered and the second never ran: an unfocused member and an absent
       member both came out at a flat 0.15, and a focused member who was NOT in
       this slice was drawn at full strength — the card asserting someone was
       present who was not. They COMPOSE now, one multiplying the other, so the
       four combinations are four opacities and each still means one thing:

         here + focused      1.00      here + unfocused      0.45
         gone + focused      0.25      gone + unfocused      0.11

       The floor also had to come up. At 0.15 a focus turned the rest of the
       neighbourhood off rather than down, and the rest of the neighbourhood is
       the context that makes a focus mean anything. The ego is never faded by
       focus — it is the card's identity — but it IS faded by absence. */
    const focusIds = selObj.focus && selObj.focus.ids
      ? new Set([...selObj.focus.ids].map(Number)) : null;
    const inFocus = d => !focusIds || isEgo(d) || focusIds.has(d.node);
    const opacityFor = d => {
      const here = currentNodeMap.has(d.node) ? 1 : 0.25;
      return inFocus(d) ? here : here * 0.45;
    };
    /* The ring stays legible for whatever the focus is, present or not — that
       is the point of clicking a band whose members mostly left. Everything
       else keeps a ring proportional to how visible its fill is, so unfocused
       nodes do not acquire an outline they never had. */
    const strokeOpacityFor = d =>
      (focusIds && inFocus(d)) ? 0.95 : opacityFor(d);

    /* Focus also gets a border, so it does not rest on opacity alone — opacity
       is spoken for by presence, and one channel cannot carry two variables. */
    const strokeFor = d =>
      isEgo(d) ? "#000" : (focusIds && inFocus(d) ? "#1d1d1f" : "#333");
    const strokeWidthFor = d =>
      isEgo(d) ? 3 : (focusIds && inFocus(d) ? 2 : 1);
    const radiusFor = d => isEgo(d) ? 6 : 4;

    /* ───── d) edge layers (current & original) ────────────────────────── */
    const edgesG = gRoot.append("g");
    const nodesG = gRoot.append("g");

    const edgesCurrentSel = edgesG.selectAll(".edgeCurrent")
      .data(edgesCurrent)
      .enter().append("line")
      .attr("class", "edgeCurrent")
      .attr("x1", d => nodesOriginal.find(n => n.node === d.source).new_x)
      .attr("y1", d => nodesOriginal.find(n => n.node === d.source).new_y)
      .attr("x2", d => nodesOriginal.find(n => n.node === d.target).new_x)
      .attr("y2", d => nodesOriginal.find(n => n.node === d.target).new_y)
      .style("stroke", d => getEdgeColorByType(d.type))
      .style("stroke-opacity", 0.25)
      .style("stroke-width", 1.5);

    const edgesOriginalSel = edgesG.selectAll(".edgeOriginal")
      .data(edgesOriginal)
      .enter().append("line")
      .attr("class", "edgeOriginal")
      .attr("x1", d => nodesOriginal.find(n => n.node === d.source).new_x)
      .attr("y1", d => nodesOriginal.find(n => n.node === d.source).new_y)
      .attr("x2", d => nodesOriginal.find(n => n.node === d.target).new_x)
      .attr("y2", d => nodesOriginal.find(n => n.node === d.target).new_y)
      .style("stroke", d => getEdgeColorByType(d.type))
      .style("stroke-width", 1.5)
      .style("opacity", 0); // hidden by default

    /* ───── e) nodes (ellipses) ────────────────────────────────────────── */
    let nodeSel = nodesG.selectAll(".sideCommEllipse")
      .data(nodesOriginal)
      .enter().append("ellipse")
      .attr("class", "sideCommEllipse")
      .attr("cx", d => d.new_x)
      .attr("cy", d => d.new_y)
      .attr("rx", radiusFor).attr("ry", radiusFor)
      .style("stroke", strokeFor).style("stroke-width", strokeWidthFor)
      /* The same two values as attributes, so a handler outside this closure
         can restore them. The main-chart mouseout is the one that needs it. */
      .attr("data-stroke", strokeFor).attr("data-stroke-width", strokeWidthFor)
      /* fill-opacity, NOT opacity: `opacity` fades the whole element, ring
         included, so a focused member who is not in this slice had its focus
         ring faded to 0.25 along with everything else — three of the four
         members of a clicked band were invisible, which is most of the way back
         to the bug this is fixing. Splitting the two lets the FILL say "here
         this week" and the RING say "this is what you clicked", which is one
         variable each. */
      .style("fill-opacity", opacityFor)
      .style("stroke-opacity", strokeOpacityFor)
      .style("fill", d => {
        // --- FIXED LOGIC START ---
        // 1) Random mode: colour by CURRENT timeslice community
        if (selObj.randomColorActive) {
          if (currentNodeMap.has(d.node)) {
            const currentData = currentNodeMap.get(d.node);
            const currentTs = window.currentYearRange || "UnknownTimeslice";
            // Use the CURRENT community ID to generate the color
            return getRandomColorForTimesliceCommunity(currentTs, currentData.community);
          }
          // Fallback if node doesn't exist in current slice (extinct)
          return "#e0e0e0"; 
        }
        // --- FIXED LOGIC END ---

        // 2) Normal mode: use the frozen colour from the year of selection
        if (d.frozenColor) {
          return d.frozenColor;
        }

        // 3) Backwards-compat fallback if frozenColor is missing
        if (!currentNodeMap.has(d.node)) return "gray";
        const cur = currentNodeMap.get(d.node);
        return getColorBasedOnFlags(cur);
      });

    /* ───── f) bounding-box fit + zoom behaviour ──────────────────────── */
    const xVals = nodesOriginal.map(d => d.new_x),
      yVals = nodesOriginal.map(d => d.new_y);
    const fit = getFitTransform(d3.min(xVals), d3.max(xVals),
      d3.min(yVals), d3.max(yVals),
      SVG_W, SVG_H, 10);
    gRoot.attr("transform", fit);

    const zoomBehaviour = d3.zoom()
      .scaleExtent([0.5, 10])
      .on("zoom", ev => gRoot.attr("transform", ev.transform));
    svg.call(zoomBehaviour).call(zoomBehaviour.transform, fit);

    /* ───── g) zoom buttons ( + / – / reset ) ─────────────────────────── */
    const btnRow = headerRow.append("span");
    btnRow.append("button").text("＋").style("margin-left", "4px")
      .on("click", () => svg.transition().call(zoomBehaviour.scaleBy, 1.25));
    btnRow.append("button").text("－").style("margin-left", "2px")
      .on("click", () => svg.transition().call(zoomBehaviour.scaleBy, 1 / 1.25));
    btnRow.append("button").text("Reset").style("margin-left", "2px")
      .on("click", () => svg.transition().call(zoomBehaviour.transform, fit));

    /* ───── h) hover info text placeholder ────────────────────────────── */
    const hoverInfo = svg.append("text")
      .attr("x", 10).attr("y", SVG_H - 10)
      .attr("font-size", "13px")
      .attr("font-weight", "bold");

    /* ───── i) random-colour checkbox (after nodeSel so it can reference) */
    const chkRow = sideDiv.append("div").style("margin-top", "6px");
    chkRow.append("input")
      .attr("type", "checkbox")
      .attr("id", `randCol_${index}`)
      .property("checked", selObj.randomColorActive)
      .on("change", function() {
        selObj.randomColorActive = this.checked;
        nodeSel.style("fill", d => {
          // --- FIXED LOGIC START (Repeated for Checkbox Change) ---
          if (selObj.randomColorActive) {
            if (currentNodeMap.has(d.node)) {
              const currentData = currentNodeMap.get(d.node);
              const currentTs = window.currentYearRange || "UnknownTimeslice";
              return getRandomColorForTimesliceCommunity(currentTs, currentData.community);
            }
            return "#e0e0e0"; 
          }
          // --- FIXED LOGIC END ---

          if (d.frozenColor) return d.frozenColor;
          if (!currentNodeMap.has(d.node)) return "gray";
          const cur = currentNodeMap.get(d.node);
          return getColorBasedOnFlags(cur);
        });
      });
    chkRow.append("label")
      .attr("for", `randCol_${index}`)
      .style("margin-left", "4px")
      .text("Random colour by timeslice community");

    /* ───── j) FULL hover behaviour on nodeSel ─────────────────────────── */
    nodeSel
      .on("mouseover", function(event, d) {
        if (!currentNodeMap.has(d.node)) return; // skip extinct nodes
        

        hoverInfo.text(`Name: ${d.name}  (id ${d.node})`);

        /* swap edge layers */
        edgesCurrentSel.style("opacity", 0);
        edgesOriginalSel.style("opacity",
          e => (e.source === d.node || e.target === d.node) ? 1 : 0);

        /* highlight this ellipse & its counterpart in the main chart */
        d3.select(this)
          .style("stroke", getEdgeColorByType(d.type))
          .style("stroke-width", isEgo(d) ? 3 : 2);
        d3.selectAll(".happy")
          .filter(n => n.node === d.node)
          .style("stroke", "blue")
          .style("stroke-width", 3);

        /* side-pane text box & charts */
        // A frozen cohort can contain nodes that no longer exist in the current
        // slice, in which case there is nothing to describe — bail rather than
        // dereference undefined.
        const curNode = currentNodeMap.get(d.node);
        if (!curNode) return;
        const neighbours = connections_list[d.node] || [];
        const commDataCur = global_data.filter(n => n.community === curNode.community);

        draw_textbox(
          commDataCur,
          neighbours,
          d.node,
          neighbours.filter(id => commDataCur.some(n => n.node === id)).length,
          curNode.centrality,
          curNode.betwness,
          curNode.closeness,
          curNode.eign,
          curNode.name,
          curNode.anchor_name
        );
        /* draw_spiral() is NOT called here: it renders into #community_spiral,
           which no longer exists in index.html, so it throws on a null
           getBoundingClientRect() and kills the two calls below. Same reason it
           is not called from the main node hover. */
        drawCommunityAdjMatrix(commDataCur, node_to_node_link_data);
        drawNodeTimesliceChart(d.node);
        if (window.EgoSpiral) window.EgoSpiral.show(d.node);
      })
      .on("mouseout", function(event, d) {
        hoverInfo.text("");

        edgesCurrentSel.style("opacity", 1);
        edgesOriginalSel.style("opacity", 0);

        d3.select(this)
          .style("stroke", strokeFor(d))
          .style("stroke-width", strokeWidthFor(d));

        d3.selectAll(".happy")
          .filter(n => n.node === d.node)
          .style("stroke", n => globalHighlightNodesMap[n.node] || "none")
          .style("stroke-width", n => globalHighlightNodesMap[n.node] ? 1 : 0);
      });

  }); // ← end forEach(selectedCommunitySpirals)
}


//////////////////////////////////////////
// HELPER: Use ColFlag to pick a color
//////////////////////////////////////////
// Adjust to your actual flag logic:
function getColorBasedOnFlags(nodeObj) {
  //  Example logic for your existing flags:
  if (localVolatilityColFlag == 1) {
    if (nodeObj.type === "outandin") return "#CC79A7";
    else if (nodeObj.type === "incoming") return "#0072B2";
    else if (nodeObj.type === "outgoing") return "#E69F00";
    else return "#8C8C8C";
  }
  else if (densityColFlag == 1) {
    return colorscaleDensity(nodeObj.density);
  }
  else if (degreeColFlag == 1) {
    if (nodeObj.centrality > extent_of_centralities_after_removing_outliers.degree_range[1]) {
      return "black";
    } else {
      return colorscaleDegree(nodeObj.centrality);
    }
  }
  else if (closenessColFlag == 1) {
    if (nodeObj.closeness > extent_of_centralities_after_removing_outliers.closeness_range[1]) {
      return "black";
    } else {
      return colorscaleCloseness(nodeObj.closeness);
    }
  }
  else if (betweennessColFlag == 1) {
    if (nodeObj.betwness > extent_of_centralities_after_removing_outliers.betwness_range[1]) {
      return "black";
    } else {
      return colorscaleBetwness(nodeObj.betwness);
    }
  }
  else if (eignColFlag == 1) {
    if (nodeObj.eign > extent_of_centralities_after_removing_outliers.eign_range[1]) {
      return "black";
    } else {
      return colorscaleEign(nodeObj.eign);
    }
  }
  else if (volatilityColFlag == 1) {
    if (nodeObj.volatility > extent_of_centralities_after_removing_outliers.volatility_range[1]) {
      return "black";
    } else {
      return colorscaleVolatility(nodeObj.volatility);
    }
  }

  // fallback if no flag is set
  return "#8C8C8C";
}



function opt_no_of_nodes(community_count) {
    let range_for_same_point = -1;
    let next_range_for_same_point = 1;
    let part_of_sprial_considered_same = 7*12;
    let set_of_disticnt_ranges = new Set();
    let optimal_no_of_nodes = 0;

    while (range_for_same_point != next_range_for_same_point) {
        range_for_same_point = next_range_for_same_point;
        set_of_disticnt_ranges.add(range_for_same_point);
        let set_of_node_counts = new Set();
        community_count.forEach(function(d){
            set_of_node_counts.add(range_for_same_point*Math.floor(d.count/range_for_same_point));
        });
        var sum = 0;
        set_of_node_counts.forEach(function(num) { sum += num; });

        let average = Math.floor(sum / set_of_node_counts.size);
        next_range_for_same_point = Math.floor(average/part_of_sprial_considered_same);
        optimal_no_of_nodes = average;
        if (set_of_disticnt_ranges.has(next_range_for_same_point)) {
            break;
        }
    }
    return optimal_no_of_nodes;
}


// This array will hold [{ name: "...", id: 123 }, ...] from author_mapping.txt
let authorMappingArray = [];

/* Build the search list from the node data that is ALREADY loaded.

   This used to depend solely on data/<dataset>/author_mapping.txt, which does
   not exist for data_vispub or smallreddit. The fetch 404'd, the promise
   rejected, populateDatalist() never ran, and the datalist stayed empty — so
   the user typed a name, searchSelectedNode() got no "id - name" string to
   parse, parseInt returned NaN and the search reported "Invalid node ID".

   Every node CSV carries a `name` column, so the list is derived from
   allYearsNodeData across all slices (union, not just the current one, so a
   node that has left the current slice is still findable). author_mapping.txt
   is now an optional override for datasets that ship a nicer label. */
function buildMappingFromLoadedData() {
  const seen = new Map();                       // id -> name
  const dicts = (window.currentSlices || []).map(l => (allYearsNodeData || {})[l]).filter(Boolean);
  const sources = dicts.length ? dicts : [];
  sources.forEach(dict => {
    Object.keys(dict).forEach(idStr => {
      const id = +idStr;
      if (seen.has(id)) return;
      const nm = dict[id] && dict[id].name;
      if (nm && nm !== "undefined") seen.set(id, nm);
    });
  });
  // Fall back to the current slice's rendered data if the cross-slice cache is
  // not populated yet (first paint ordering).
  if (!seen.size && Array.isArray(global_data_unchanged)) {
    global_data_unchanged.forEach(n => {
      if (!seen.has(n.node) && n.name && n.name !== "undefined") seen.set(n.node, n.name);
    });
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadAuthorMapping() {
  // Always populate from loaded data first, so search works with no extra file.
  authorMappingArray = buildMappingFromLoadedData();
  populateDatalist(authorMappingArray);

  const authorPath = `data/${window.currentDataset}/author_mapping.txt`;
  d3.text(authorPath).then(function(text) {
    // Parse the text line by line
    // Each line typically looks like: "Abdo, H.: 0"
    let lines = text.split(/\r?\n/);
    
    authorMappingArray = []; // clear/initialize

    lines.forEach(line => {
      line = line.trim();
      if (!line) return; // skip empty lines

      // Example line structure: "Abdo, H.: 0"
      let parts = line.split(":");
      if (parts.length < 2) return;

      let authorName = parts[0].trim(); // "Abdo, H."
      let idString = parts[1].trim();   // "0"
      let nodeId = parseInt(idString);

      // Build the array
      authorMappingArray.push({
        name: authorName,
        id: nodeId
      });
    });

    /* MERGE, never replace. Enron's mapping file holds addresses
       ("a..bibi_ENRON_a..bibi@enron.com") while the node CSV holds display
       names ("Sanjay Bhatnagar"); whichever list wins outright, the other
       spelling stops being searchable. Both are kept so either works. */
    const fromFile = authorMappingArray;
    const fromData = buildMappingFromLoadedData();
    const seen = new Set();
    authorMappingArray = [...fromData, ...fromFile].filter(e => {
      const key = e.id + "|" + e.name;
      if (!e.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    populateDatalist(authorMappingArray);
  }).catch(() => {
    // No author_mapping.txt for this dataset — the data-derived list already
    // loaded above, so there is nothing to do but stay quiet.
  });
}

function populateDatalist(mapping) {
  // Get reference to the <datalist> element
  let dataList = document.getElementById("nodeAuthorList");
  dataList.innerHTML = ""; // clear old options if any

  mapping.forEach(item => {
    // We'll show "nodeId - authorName"
    let displayValue = item.id + " - " + item.name;

    let option = document.createElement("option");
    option.value = displayValue;
    dataList.appendChild(option);
  });
}

// Call this once the page loads so the dropdown is ready
// window.onload = function() {
//   loadAuthorMapping();  // or you can call it inside some other init function
// };
// This object will hold the current values of your sliders
let activeFilters = {
    degree: 0,
    volatility: 0
};

function applyFiltersAndRedraw() {
    // Always start with the original, unfiltered data
    let filteredData = global_data_unchanged;

    // --- 1. Apply Slider Filters ---
    filteredData = filteredData.filter(d => {
        return d.centrality >= activeFilters.degree &&
               d.volatility >= activeFilters.volatility;
    });

    // --- 2. Apply Temporal Radio Button Filter ---
    const temporalFilter = window.currentNodeFilter;
    if (temporalFilter === "incoming") {
        filteredData = filteredData.filter(d => d.type === "incoming" || d.type === "outandin");
    } else if (temporalFilter === "outgoing") {
        filteredData = filteredData.filter(d => d.type === "outgoing" || d.type === "outandin");
    } else if (temporalFilter === "both") {
        filteredData = filteredData.filter(d => d.type === "outandin");
    }
    // If filter is "none", we do nothing and show all temporal types.

    // Update the global data that the chart uses
    global_data = filteredData;
    updateGraphStats(global_data, node_to_node_link_data); // Update node/edge counts

    // Redraw the spiral with the newly filtered data
    draw_spiral_community();
}

/* ──────────────────────────────────────────────────────────────────────────
   SpinTrix Main Canvas Zoom — DROP-IN (v2 safe)
   Requires: d3 v7+, #chart exists. Works with your existing <g> content.
   Exposes:  SpinTrixMainZoom.setup(), fitAll(), zoomToCommunity(), etc.
───────────────────────────────────────────────────────────────────────────*/
/* ──────────────────────────────────────────────────────────────────────────
   SpinTrix Main Canvas Zoom — robust + idempotent
   • Works whether #chart is <svg> itself or a <div> that contains one <svg>.
   • Re-binds itself if the SVG was wiped by a new slice (clearCharts()).
   • Ensures all drawable layers live under #gPanRoot so zoom moves them.
   • Has Fit / Reset / +/- helpers and LOD overlay.
───────────────────────────────────────────────────────────────────────────*/
window.SpinTrixMainZoom = (function () {
  let svg = null;              // d3 selection of the *SVG* element
  let gRoot = null;            // <g id="gPanRoot"> that we transform
  let lodG = null;             // <g id="lodOverlay"> for far zoom-out view
  let zoom = null;

  let hudSel = null; // <— add this near other module-level vars

  function getHud() { return hudSel; }

  const SCALE_EXTENT = [0.05, 40];

  function getSvgSelection() {
    const host = d3.select("#chart");
    if (host.empty()) return null;
    return host.node().tagName.toLowerCase() === "svg" ? host : host.select("svg");
  }

  function setup() {
    svg = getSvgSelection();
    if (!svg || svg.empty()) {
      console.warn("SpinTrixMainZoom.setup(): #chart or inner <svg> not found.");
      return;
    }

    // 1) Create (or re-use) pan root
    let rootSel = svg.select("#gPanRoot");
    if (rootSel.empty()) {
      rootSel = svg.insert("g", ":first-child").attr("id", "gPanRoot");
    }
    gRoot = rootSel;

    // 2) Ensure the LOD overlay exists
    let lodSel = svg.select("#lodOverlay");
    if (lodSel.empty()) {
      lodSel = svg.append("g")
        .attr("id", "lodOverlay")
        .style("pointer-events", "none")
        .style("opacity", 0);
    }
    lodG = lodSel;

    // 3) **NEW: HUD overlay (fixed, not zoomed)**
    hudSel = svg.select("#hudOverlay");
    if (hudSel.empty()) {
      hudSel = svg.append("g")
        .attr("id", "hudOverlay")
        .style("pointer-events", "none"); // HUD shouldn't eat mouse events
    }


    // 3) Adopt any loose direct children under gPanRoot (so zoom moves them)
    [...svg.node().children].forEach(n => {
      if (n.id === "gPanRoot" || n.id === "lodOverlay") return;
      gRoot.node().appendChild(n);
    });

    // 4) Build (or re-use) zoom behavior and (re)bind to the actual SVG
    if (!zoom) {
      zoom = d3.zoom()
        .scaleExtent(SCALE_EXTENT)
        .filter(function (event) {
          // Allow: wheel, dblclick, drag with no modifier keys
          return (!event.ctrlKey && !event.button) || event.type === "wheel" || event.type === "dblclick";
        })
        .on("zoom", ev => {
          gRoot.attr("transform", ev.transform);
          updateLOD(ev.transform.k);
        });
    }

    // (re)bind zoom to the SVG (safe to call multiple times)
    svg.interrupt().call(zoom);
    svg.style("overflow", "hidden");
    svg.style("touch-action", "none")
       .style("cursor", "grab")
       .on("mousedown.zoomCursor", () => svg.style("cursor", "grabbing"))
       .on("mouseup.zoomCursor mouseleave.zoomCursor", () => svg.style("cursor", "grab"));

    injectUI();
    // initialize LOD opacity based on current transform (if any)
    const k = (svg.property("__zoom") || d3.zoomIdentity).k;
    updateLOD(k);

  }

  // Level-of-detail overlay for far zoom-out
  function updateLOD(k) {
    // Hide edges when zoomed far out, otherwise defer to the weight-driven
    // resting opacity rather than flattening every edge to one value.
    d3.selectAll(".spiral_edges").classed("non-scaling-stroke", true);
    if (k < 0.6) d3.selectAll(".spiral_edges").style("stroke-opacity", 0);
    else         resetEdgeOpacity();

    d3.selectAll(".adjacent_edges")
      .classed("non-scaling-stroke", true)
      .style("stroke-opacity", k < 0.8 ? 0 : 0.55);

    // Labels are sized in screen pixels, so a zoom change has to re-scale them.
    rescaleHoverLabels();

    if (!lodG) return;

    if (k < 0.18) {
      drawLOD();
      lodG.interrupt().style("opacity", 1);
      d3.selectAll(".happy").style("opacity", 0.15);
    } else {
      lodG.interrupt().style("opacity", 0);
      d3.selectAll(".happy").style("opacity", 1);
    }
  }

  function drawLOD() {
    if (!lodG || !window.global_data || !window.center_positions_spiral) return;

    const counts = d3.rollup(global_data, v => v.length, d => d.community);
    const joined = center_positions_spiral
      .filter(c => counts.has(c.community))
      .map(c => ({ ...c, size: counts.get(c.community) }));

    const r = d3.scaleSqrt()
      .domain([0, d3.max(joined, d => d.size) || 1])
      .range([8, 40]);

    const bubbles = lodG.selectAll(".lod-bubble").data(joined, d => d.community);
    bubbles.enter().append("circle")
        .attr("class", "lod-bubble non-scaling-stroke")
        .attr("cx", d => d.cx).attr("cy", d => d.cy).attr("r", d => r(d.size))
        .style("fill", "#e9ecef").style("stroke", "#555").style("stroke-width", 1)
      .merge(bubbles)
        .attr("cx", d => d.cx).attr("cy", d => d.cy).attr("r", d => r(d.size));
    bubbles.exit().remove();

    const labels = lodG.selectAll(".lod-label").data(joined, d => d.community);
    labels.enter().append("text")
        .attr("class", "lod-label")
        .attr("x", d => d.cx).attr("y", d => d.cy)
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("font-size", 12).attr("fill", "#333")
        .attr("stroke", "white").attr("stroke-width", 0.75)
        .text(d => `C${d.community} (${d.size})`)
      .merge(labels)
        .attr("x", d => d.cx).attr("y", d => d.cy)
        .text(d => `C${d.community} (${d.size})`);
    labels.exit().remove();
  }

  // Fit to all drawn content (DOM bbox with data fallback)
  function fitAll(duration = 0, pad = 40) {
    svg = getSvgSelection();
    if (!svg || !gRoot) { setup(); if (!svg || !gRoot) return; }

    // 1) DOM bbox (can fail if offscreen/empty)
    let bbox = null;
    try { bbox = gRoot.node().getBBox(); } catch (_) {}

    const valid = bbox && isFinite(bbox.x) && isFinite(bbox.y) &&
                  isFinite(bbox.width) && isFinite(bbox.height) &&
                  bbox.width > 0 && bbox.height > 0;

    // 2) Fallback: compute from data extents (handles off-canvas nodes)
    if (!valid) {
      const pts = (window.global_data || []).filter(d => isFinite(d.x) && isFinite(d.y));
      if (!pts.length) return; // nothing to fit
      const xs = pts.map(d => d.x), ys = pts.map(d => d.y);
      bbox = {
        x: d3.min(xs), y: d3.min(ys),
        width: Math.max(d3.max(xs) - d3.min(xs), 1e-6),
        height: Math.max(d3.max(ys) - d3.min(ys), 1e-6)
      };
    }

    const w = svg.node().clientWidth  || +svg.attr("width")  || 800;
    const h = svg.node().clientHeight || +svg.attr("height") || 600;
    const availW = Math.max(w - 2 * pad, 1);
    const availH = Math.max(h - 2 * pad, 1);

    let s = Math.min(availW / Math.max(bbox.width, 1e-6),
                     availH / Math.max(bbox.height, 1e-6));
    s = Math.max(SCALE_EXTENT[0], Math.min(SCALE_EXTENT[1], s));

    const tx = (w - s * (bbox.x * 2 + bbox.width)) / 2;
    const ty = (h - s * (bbox.y * 2 + bbox.height)) / 2;

    const target = d3.zoomIdentity
      .translate(isFinite(tx) ? tx : 0, isFinite(ty) ? ty : 0)
      .scale(isFinite(s) ? s : 1);

    svg.transition().duration(duration).call(zoom.transform, target);
  }

  function zoomBy(factor) {
    svg = getSvgSelection();
    if (!svg || !zoom) return;
    svg.transition().duration(200).call(zoom.scaleBy, factor);
  }

  function reset() {
    svg = getSvgSelection();
    if (!svg || !zoom) return;
    svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
  }

  function zoomToNodeIDs(ids, duration = 350, pad = 30) {
    svg = getSvgSelection();
    if (!svg || !zoom || !Array.isArray(ids) || !ids.length || !window.global_data) return;

    const pts = global_data.filter(n => ids.includes(n.node));
    if (!pts.length) return;

    const xs = pts.map(d => d.x), ys = pts.map(d => d.y);
    const bbox = { x: d3.min(xs), y: d3.min(ys), width: d3.max(xs)-d3.min(xs), height: d3.max(ys)-d3.min(ys) };
    const w = svg.node().clientWidth || +svg.attr("width") || 800;
    const h = svg.node().clientHeight || +svg.attr("height") || 600;

    let s = Math.min((w - 2 * pad) / Math.max(bbox.width, 1e-6),
                     (h - 2 * pad) / Math.max(bbox.height, 1e-6));
    s = Math.max(SCALE_EXTENT[0], Math.min(SCALE_EXTENT[1], s));

    const tx = (w - s * (bbox.x * 2 + bbox.width)) / 2;
    const ty = (h - s * (bbox.y * 2 + bbox.height)) / 2;
    const target = d3.zoomIdentity.translate(tx, ty).scale(s);

    svg.transition().duration(duration).call(zoom.transform, target);
  }

  function zoomToCommunity(commID) {
    if (!window.global_data) return;
    const ids = global_data.filter(d => d.community === commID).map(d => d.node);
    zoomToNodeIDs(ids);
  }

  function markNonScalingStrokes() {
    d3.selectAll(".spiral_edges, .adjacent_edges").classed("non-scaling-stroke", true);
  }

  // Small floating UI on the main card that hosts #chart
  function injectUI() {
    const host = d3.select("#chart").node()?.parentElement;
    if (!host) return;
    const sel = d3.select(host);
    if (!sel.select("#mainZoomUI").empty()) return;

    sel.style("position", "relative");
    const ui = sel.append("div").attr("id", "mainZoomUI");
    const add = (txt, title, fn) => ui.append("button").attr("class", "zoom-btn").attr("title", title).text(txt).on("click", fn);
    add("＋", "+", () => zoomBy(1.25));
    add("－", "–", () => zoomBy(1 / 1.25));
    add("Reset", "Reset (0)", () => reset());
    add("Fit", "Fit to all (f)", () => fitAll(250));

    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "=" || e.key === "+") zoomBy(1.2);
      else if (e.key === "-") zoomBy(1/1.2);
      else if (e.key === "0") reset();
      else if (e.key.toLowerCase() === "f") fitAll(250);
    });
  }

  return { setup, fitAll, zoomBy, reset, zoomToNodeIDs, zoomToCommunity, markNonScalingStrokes, updateLOD, getHud };
})();



function idled() {
  idleTimeout = null;
}
