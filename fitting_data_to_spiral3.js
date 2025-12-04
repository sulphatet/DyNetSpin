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
let localVolatilityCenteringFlag = 1; // 0 => off, 1 => reorder outandin->incoming->outgoing->neither

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



function draw_textbox(data, adjacent_nodes, activeNode, count, deg, bet, clo, eig, node_name) {
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

  // append the summary to #community_textbox
  d3.select("#community_textbox")
      .html("<b>Name: </b>"+ node_name +"<br/>"
          + "<b> Neighbours_Count: </b>"+ deg +"<br/><br/>"
          + "<b>Group Information:</b><br/>"
          + "<b>Number of Nodes in Group:</b> "+ groupSize + "<br/>"
          + "<b>Edge-density in Group:</b> "+ groupDensity + "<br/><br/>"
          + "<b>Total Neighbours:</b> " + adjacent_nodes.length + "<br/>"
          + "<b>Neighbours within Group:</b> " + count + "<br/>"
          + "<b>Neighbours in other Group:</b> " + inter_community_connections + "<br/>"
          + "<b>List of Neighbours:</b> " + name_of_adjacent_nodes.join(", "))
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

  let centerX = 150,
      centerY = 150,
      radius = 250,
      sides = 1000,
      coils = 20,
      rotation = 0;
  let count =0;
  let awayStep = radius/sides;
  let aroundStep = coils/sides;
  let aroundRadians = aroundStep * 2 * 3.14;
  rotation *= 2 * 3.14;

  let no_of_points_in_community = new_data1.length;
  let xCoordinateOfActiveNode_new, yCoordinateOfActiveNode_new;
  let node_name, deg, clo, bet, eig, volatility;

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
                            .style("strokeOpacity",.5)
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
                        if (d.type === "outandin") return "#ca0020";
                        else if (d.type === "incoming") return "#0571b0";
                        else if (d.type === "outgoing") return "#f4a582";
                        else return "#92c5de"; // "neither"
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
  draw_textbox(new_data1, adjacent_nodes_find_node, find_node_id, count, deg, bet, clo, eig, node_name);
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

  // put ≈ 45 nodes per revolution; tweak to taste
  const coils    = Math.ceil(nPoints / 45);

  const awayStep     = radius / sides;
  const aroundStep   = coils  / sides;
  const aroundRad    = aroundStep * 2 * Math.PI;

  /******************************************************************
   * 3 ▸ CALCULATE COORDINATES
   ******************************************************************/
  let xActive, yActive, node_name, deg, clo, bet, eig, volatility;

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
         volatility: volatility } = d);
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
          if (d.type === "outandin")  return "#ca0020";
          if (d.type === "incoming")  return "#0571b0";
          if (d.type === "outgoing")  return "#f4a582";
          return "#92c5de";
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
               adjacent_nodes.length, deg, bet, clo, eig, node_name);
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

function transform_graph_centers(data, height, width) {
  const nCommunities = data.length;

  // Dynamically adjust spiral radius based on available space
  const maxRadius = Math.min(width, height) * 0.45;  // 90% of half-dimension
  const centerX = width / 2;
  const centerY = height / 2;

  // Make spiral smoother when there are more communities
  const sides = nCommunities;
  const coils = Math.ceil(nCommunities / 16);         // 8 communities per loop

  const awayStep = maxRadius / sides;
  const aroundStep = coils / sides;
  const aroundRadians = aroundStep * 2 * Math.PI;

  for (let i = 0; i < nCommunities; i++) {
    const away = (i + 0.5) * awayStep;               // 0.5 offsets center
    const around = (i + 0.5) * aroundRadians;

    data[i].cx = centerX + Math.cos(around) * away;
    data[i].cy = centerY + Math.sin(around) * away;
  }

  return data;
}


//--- MODIFIED FOR LOCAL VOLATILITY CENTERING ---
function computing_spiral_positions(center_positions_spiral, data_points, height, width) {

  let radius = 60,
      coils = 15,
      rotation = 0,
      sides = 400;
  let awayStep = radius/sides;
  let aroundStep = coils/sides;
  let aroundRadians = aroundStep * 2 * 3.14;
  rotation *= 2 * 3.14;

  let newdata1 = [];

  center_positions_spiral.forEach(function(community_data){
    // subset data for this community
    let filtered_community= data_points.filter(function(d){
      return d.community===community_data.community;
    });

    //--- ADDED FOR LOCAL VOLATILITY CENTERING ---
    if (localVolatilityCenteringFlag == 1) {
      // Reorder so that outandin => incoming => outgoing => neither
      let outandin = filtered_community.filter(d => d.type === "outandin");
      let incoming = filtered_community.filter(d => d.type === "incoming");
      let outgoing = filtered_community.filter(d => d.type === "outgoing");
      let neither = filtered_community.filter(d =>
        d.type !== "outandin" && d.type !== "incoming" && d.type !== "outgoing"
      );
      filtered_community = outandin.concat(outgoing, incoming, neither);
    }
    // now compute spiral positions, in the order they appear
    let no_of_points_in_community = filtered_community.length;

    for (let i=0; i<no_of_points_in_community; i++){
      let away, around;
      if (i < 300) {
        away = (i+100) * awayStep;
        around = (i+100) * aroundRadians + rotation;
      } else {
        // for bigger communities
        let new_awayStep = radius/25000;
        let new_aroundStep = coils/25000;
        let new_aroundRadians = new_aroundStep * 2 * 3.14;

        away = (299+100) * awayStep + ((i-299) * new_awayStep);
        around = (299+100) * aroundRadians + ((i-299) * new_aroundRadians + rotation);
      }

      filtered_community[i]['x'] = community_data.cx + Math.cos(around) * (away );
      filtered_community[i]['y'] = community_data.cy + Math.sin(around) * (away);
    }
    newdata1 = newdata1.concat(filtered_community);
  });
  return newdata1;
}




// Define the div for the tooltip
var div = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

var count = 0;

function draw_spiral_community(){
if (!ensureBrushSkeleton()) return;
ensureBrushSkeleton();

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

  // scale for edge thickness
  var max_edge_strength = d3.max(link_data, function(d){return d.weight});
  var edge_strength_scale = d3.scaleLinear()
      .domain([0, max_edge_strength])
      .range([0.4, 6]);

  // add edges as lines
  for (let link in link_data){
    g.append('line')
      // .attr("class", "spiral_edges")
      .attr("class", "spiral_edges non-scaling-stroke")
      .style("stroke", "#555555")
      .style("strokeOpacity",0.1)
      .style("stroke-width", edge_strength_scale(link_data[link].weight))
      .attr("x1", center_positions_spiral[link_data[link].source].cx)
      .attr("y1", center_positions_spiral[link_data[link].source].cy)
      .attr("x2", center_positions_spiral[link_data[link].target].cx)
      .attr("y2", center_positions_spiral[link_data[link].target].cy)
      .on("mouseover", function(event, d){
        show_edge_tooltip(d.source, d.target, d.weight);
      });
  }
  g.selectAll(".spiral_edges").data(link_data).enter();

  // draw nodes
  var node = g.selectAll("circle")
              .data(global_data);

  var newElements = node.enter()
                  .append("circle")
                  .attr("class", "happy")
                  .attr("r", function(d){
                    if (d.node == find_node_id) return 4;
                    else return (highlightNodes.indexOf(d.node) !== -1) ? 3 : global_radius;
                  })
                  .style("stroke", function(d) {
                    return globalHighlightNodesMap[d.node] || "none";
                  })
                  .style("stroke-width", function(d) {
                    return globalHighlightNodesMap[d.node] ? 1 : 0;
                  })
                  .style("fill", function(d){
                    if (d.node == find_node_id) {
                      return "black";
                    }
                    
                    //--- ADDED FOR LOCAL VOLATILITY ---
                    if (localVolatilityColFlag == 1) {
                      if (d.type === "outandin") return "#ca0020";
                      else if (d.type === "incoming") return "#0571b0";
                      else if (d.type === "outgoing") return "#f4a582";
                      else return "#92c5de";
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
                  .style("opacity", function(d) {
                    // Adjust based on the global radio-button filter
                    if (window.currentNodeFilter === "incoming") {
                      return d.type === "incoming" || d.type === "outandin" ? 1 : 0.2;
                    } else if (window.currentNodeFilter === "outgoing") {
                      return d.type === "outgoing" || d.type === "outandin" ? 1 : 0.2;
                    } else {
                      return 1;
                    }
                  })
                  .attr("pointer-events", "all")
                  .on("mouseover", function(event, d) {
                      div.transition()
                          .duration(200)
                          .style("opacity", .9);

                      if (flag_most_connected_nodes){
                        div.html("<b>Community:</b> " + d.community)
                           .style("left", (event.pageX) + "px")
                           .style("top", (event.pageY - 28) + "px");
                      } else {
                        div.html("<b>Name:</b> "+ d.name +"<br/>"
                               + "<b>Node ID:</b> "+ d.node +"<br/>"
                               + "<b>Group:</b> " + d.community + "<br/>"
                               + "<b>Total Collaborators:</b> "+ d.centrality)
                           .style("left", (event.pageX) + "px")
                           .style("top", (event.pageY - 28) + "px")
                           .style("text-align", "left");
                      }
                      drawNodeTimesliceChart(d.node);
                      

                      activeCommunity = d.community;
                      activeNode = d.node;
                      activeName = d.name;
                      let xCoordinateOfActiveNode = d.x;
                      let yCoordinateOfActiveNode = d.y;

                      d3.selectAll(".sideCommEllipse")
                      .filter(n => n.node === d.node)
                      .style("stroke", "orange")       // or some highlight color
                      .style("stroke-width", 5);

                      

                      // show adjacent node
                      let adjacent_nodes = connections_list[activeNode];

                      d3.selectAll("circle")
                        .attr("r", function(n){
                          if (adjacent_nodes.includes(n.node))
                            return global_radius;
                          else
                            return global_radius;
                        })
                        .style("fill", function(n){
                          if (adjacent_nodes.includes(n.node)){
                            // find edge
                            let edge = node_to_node_link_data.find(e => 
                              (e.source === activeNode && e.target === n.node) || 
                              (e.target === activeNode && e.source === n.node)
                            );
                            if (edge) {
                              let edgecolor = "#253494";
                              // The new color logic if we want to highlight differently:
                              if (window.currentNodeFilter === "incoming" && edge.type !== "incoming") {
                                // skip
                                edgecolor = "#253494";
                              } else if (window.currentNodeFilter === "outgoing" && edge.type !== "outgoing") {
                                // skip
                                edgecolor = "#253494";
                              } else {
                                // color edges based on type
                                if (edge.type === "incoming") edgecolor = "#0571b0";
                                else if (edge.type === "outgoing") edgecolor = "#f4a582";
                                else if (edge.type === "outandin") edgecolor = "#ca0020";
                              }
                              // g.append('line')
                              //   .attr("class", "adjacent_edges")
                              //   .style("stroke", edgecolor)
                              //   .style("strokeOpacity", .5)
                              //   .style("stroke-width", 1)
                              //   .attr("x1", function(){
                              //     if (brushFlag==1) return xScale(xCoordinateOfActiveNode);
                              //     else return xCoordinateOfActiveNode;
                              //   })
                              //   .attr("y1", function(){
                              //     if (brushFlag==1) return yScale(yCoordinateOfActiveNode);
                              //     else return yCoordinateOfActiveNode;
                              //   })
                              //   .attr("x2", function(){
                              //     if (brushFlag==1) return xScale(n.x);
                              //     else return n.x;
                              //   })
                              //   .attr("y2", function(){
                              //     if (brushFlag==1) return yScale(n.y);
                              //     else return n.y;
                              //   });
                              g.append('line')
                                  .attr("class", "adjacent_edges non-scaling-stroke")
                                  .style("stroke", edgecolor)
                                  .style("strokeOpacity", .5)
                                  .style("stroke-width", 1)
                                  .attr("x1", () => xCoordinateOfActiveNode)
                                  .attr("y1", () => yCoordinateOfActiveNode)
                                  .attr("x2", () => n.x)
                                  .attr("y2", () => n.y);

                            }
                            return "#253494";
                          }
                          else {
                            //--- ADDED FOR LOCAL VOLATILITY ---
                            if (localVolatilityColFlag == 1) {
                              if (n.type === "outandin") return "#ca0020";
                              else if (n.type === "incoming") return "#0571b0"; 
                              else if (n.type === "outgoing") return "#f4a582";
                              else return "#92c5de";
                            }

                            if (densityColFlag ==1)
                              return colorscaleDensity(n.density);
                            else if (degreeColFlag==1){
                              if (n.centrality>extent_of_centralities_after_removing_outliers.degree_range[1])
                                return "black";
                              else
                                return colorscaleDegree(n.centrality);
                            }
                            else if (closenessColFlag==1){
                              if (n.closeness > extent_of_centralities_after_removing_outliers.closeness_range[1])
                                return "black";
                              else
                                return colorscaleCloseness(n.closeness);
                            }
                            else if (betweennessColFlag==1){
                              if (n.betwness > extent_of_centralities_after_removing_outliers.betwness_range[1])
                                return "black";
                              else
                                return colorscaleBetwness(n.betwness);
                            }
                            else if (eignColFlag==1){
                              if (n.eign > extent_of_centralities_after_removing_outliers.eign_range[1])
                                return "black";
                              else
                                return colorscaleEign(n.eign);
                            }
                            else if (volatilityColFlag==1){
                              if (n.volatility > extent_of_centralities_after_removing_outliers.volatility_range[1])
                                return "black";
                              else
                                return colorscaleVolatility(n.volatility);
                            }
                          }
                        });

                      new_data1 = global_data.filter(function(client){
                        return client.community==d.community;
                      });
                      draw_spiral(new_data1, adjacent_nodes, activeNode);
                      drawCommunityAdjMatrix(new_data1, node_to_node_link_data);
                      drawNodeTimesliceChart(d.node);
                      highlightMatrixNode(d.node);

                      // highlight row in the table
                      d3.selectAll("tr").style("background-color", function(dat,i){
                        if (dat!== undefined) {
                          if(dat.node == find_node_id)
                            return "blue";
                          else if (dat.node == activeNode)
                            return "orange";
                          else
                            return "transparent";
                        }
                      });

                      if (!flag_most_connected_nodes){
                        d3.selectAll("circle")
                          .attr("opacity", function(n){
                            if(n.community == activeCommunity) return 1;
                            else return 0.1;
                          });
                      }

                      if(brushFlag==0){
                        let all_lines = d3.selectAll(".spiral_edges")
                            .nodes();
                        for (let each in all_lines){
                          if(
                            parseInt(all_lines[each].x1.baseVal.value) == parseInt(center_positions_spiral[activeCommunity].cx) &&
                            parseInt(all_lines[each].y1.baseVal.value) == parseInt(center_positions_spiral[activeCommunity].cy) ||
                            parseInt(all_lines[each].x2.baseVal.value) == parseInt(center_positions_spiral[activeCommunity].cx )&&
                            parseInt(all_lines[each].y2.baseVal.value) == parseInt(center_positions_spiral[activeCommunity].cy)
                          ) {
                            all_lines[each].style.strokeOpacity = 1;
                          }
                          else {
                            all_lines[each].style.strokeOpacity = 0;
                          }
                        }
                      } else {
                        d3.selectAll(".spiral_edges").style("stroke-opacity", 0);
                      }
                  })
                 
.on("mouseover", function(event, d) {
    // --- Standard tooltip logic (unchanged) ---
    div.transition()
        .duration(200)
        .style("opacity", .9);

    div.html("<b>Name:</b> "+ d.name +"<br/>"
            + "<b>Node ID:</b> "+ d.node +"<br/>"
            + "<b>Group:</b> " + d.community + "<br/>"
            + "<b>Total Collaborators:</b> "+ d.centrality)
        .style("left", (event.pageX) + "px")
        .style("top", (event.pageY - 28) + "px")
        .style("text-align", "left");
    
    // --- Get data for the hovered node's community ---
    const activeNodeId = d.node;
    const activeCommunityId = d.community;
    const adjacent_nodes = connections_list[activeNodeId] || [];
    
    // Filter global data for nodes ONLY in the hovered community
    const communityNodesData = global_data.filter(n => n.community === activeCommunityId);

    // Count how many collaborators are within the same community
    const intraCommunityCollaborators = adjacent_nodes.filter(adjId => 
        communityNodesData.some(commNode => commNode.node === adjId)
    ).length;

    // --- CORRECTED FUNCTION CALLS ---
    // 1. Update the community textbox with detailed info
    draw_textbox(
        communityNodesData,            // Data for all nodes in the group
        adjacent_nodes,                // List of all collaborator IDs
        activeNodeId,                  // The ID of the hovered node
        intraCommunityCollaborators,   // Count of collaborators within the group
        d.centrality,                  // Degree (total collaborators)
        d.betwness,
        d.closeness,
        d.eign,
        d.name                         // Name of the hovered author
    );

    // 2. Update the community adjacency matrix
    drawCommunityAdjMatrix(communityNodesData, node_to_node_link_data);
    
    // 3. Update the node's historical bar chart
    drawNodeTimesliceChart(activeNodeId);
    
    // 4. Highlight the node in the matrix
    highlightMatrixNode(activeNodeId);


    // --- Highlighting logic (mostly unchanged) ---
    d3.selectAll(".adjacent_edges").remove(); // Clear previous edges
    
    // Show edges for the current hovered node
    adjacent_nodes.forEach(neighborId => {
        const neighborNode = global_data.find(n => n.node === neighborId);
        if (!neighborNode) return; // Skip if neighbor isn't in current slice

        let edge = node_to_node_link_data.find(e => 
            (e.source === activeNodeId && e.target === neighborId) || 
            (e.target === activeNodeId && e.source === neighborId)
        );
        if (!edge) return;

        g.append('line')
            .attr("class", "adjacent_edges non-scaling-stroke")
            .style("stroke", getEdgeColorByType(edge.type))
            .style("stroke-opacity", .5)
            .style("stroke-width", 1.5)
            .attr("x1", d.x)
            .attr("y1", d.y)
            .attr("x2", neighborNode.x)
            .attr("y2", neighborNode.y)
            .lower(); // Draw lines underneath the nodes
    });
    
    // Opacity fade for other communities
    d3.selectAll("circle.happy")
        .attr("opacity", n => (n.community === activeCommunityId) ? 1 : 0.1);
})
.on("mouseout", function(event, d) {
    // Hide the tooltip
    div.transition()
        .duration(300)
        .style("opacity", 0);

    // Remove the temporary edges drawn on hover
    d3.selectAll(".adjacent_edges").remove();

    // Reset the opacity for all nodes
    d3.selectAll("circle.happy")
        .attr("opacity", 1);

    // Reset any highlights on the side-panel charts
    d3.selectAll(".sideCommEllipse")
        .style("stroke", "#333")
        .style("stroke-width", 1);
})
                  .on("click", function(event, d) {
                    // Prevent propagation if needed
                    event.stopPropagation();

                    // Identify the timeslice (yearRange) in which the user clicked.
                    let clickedYearRange = window.currentYearRange || "UnknownYear";
                    let commID = d.community; 

                    // Check if this community from the current timeslice is already selected.
                    let alreadySelected = selectedCommunitySpirals.find(s => 
                      s.communityID === commID && s.yearRange === clickedYearRange
                    );
                    if (alreadySelected) {
                      return;
                    }

                    // Build the *original* community’s data from this timeslice
                    // and freeze the colour each node has *right now*.
                    let originalCommData = global_data
                      .filter(n => n.community === commID)
                      .map(n => ({
                        ...n,
                        frozenColor: getColorBasedOnFlags(n)
                      }));

                    let originalCommLinks = node_to_node_link_data.filter(e => {
                      let nodeIDs = new Set(originalCommData.map(n => n.node));
                      return nodeIDs.has(e.source) && nodeIDs.has(e.target);
                    });

                    // Create an object representing this selection.
                    let selectionObj = {
                      yearRange: clickedYearRange,
                      communityID: commID,
                      originalNodeData: originalCommData,
                      originalLinkData: originalCommLinks,
                      randomColorActive: false
                    };

                    // If we already have 3 selected, remove the oldest.
                    if (selectedCommunitySpirals.length >= 3) {
                      selectedCommunitySpirals.shift();
                    }
                    selectedCommunitySpirals.push(selectionObj);

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

                    // Update the main view so that every node gets its assigned color.
                    d3.selectAll("circle")
                      .style("stroke", function(n) {
                        return globalHighlightNodesMap[n.node] || "none";
                      })
                      .style("stroke-width", function(n) {
                        return globalHighlightNodesMap[n.node] ? 2 : 0;
                      });

                    // Now update the side widget with the persistent community spirals.
                    updateCommunitySpiralSideWidget();
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
  var legendheight = 200,
      legendwidth = 80,
      margin = {top: 10, right: 60, bottom: 10, left: 2};

  var canvas = d3.select("#legend1")
    .style("height", legendheight + "px")
    .style("width", legendwidth + "px")
    .style("position", "relative")
    .append("canvas")
    .attr("height", legendheight - margin.top - margin.bottom)
    .attr("width", 1)
    .style("height", (legendheight - margin.top - margin.bottom) + "px")
    .style("width", (legendwidth - margin.left - margin.right) + "px")
    .style("border", "1px solid #000")
    .style("position", "absolute")
    .style("top",  (margin.top) +"px")
    .style("left", (margin.left) + "px")
    .node();

  var ctx = canvas.getContext("2d");

  let domain_used_for_legend;
  if (densityColFlag ==1)
    domain_used_for_legend= colorscaleDensity.domain();
  else if (degreeColFlag==1)
    domain_used_for_legend=  colorscaleDegree.domain();
  else if (closenessColFlag==1)
    domain_used_for_legend=  colorscaleCloseness.domain();
  else if (betweennessColFlag==1)
    domain_used_for_legend =  colorscaleBetwness.domain();
  else if (eignColFlag==1)
    domain_used_for_legend= colorscaleEign.domain();
  else if (volatilityColFlag==1)
    domain_used_for_legend= colorscaleVolatility.domain();
  else {
    // If localVolatilityColFlag == 1, the "legend" is not numeric-based,
    // so you can skip or just give a dummy domain
    if (localVolatilityColFlag == 1) {
      domain_used_for_legend = [0,1];
    }
  }

  var legendscale = d3.scaleLinear()
    .range([1, legendheight - margin.top - margin.bottom])
    .domain(domain_used_for_legend || [0,1]);

  var image = ctx.createImageData(1, legendheight);
  d3.range(legendheight).forEach(function(i) {
    let c;
    if (densityColFlag ==1) c = d3.rgb(colorscaleDensity(legendscale.invert(i)));
    else if (degreeColFlag==1) c = d3.rgb(colorscaleDegree(legendscale.invert(i)));
    else if (closenessColFlag==1) c = d3.rgb(colorscaleCloseness(legendscale.invert(i)));
    else if (betweennessColFlag==1) c = d3.rgb(colorscaleBetwness(legendscale.invert(i)));
    else if (eignColFlag==1) c = d3.rgb(colorscaleEign(legendscale.invert(i)));
    else if (volatilityColFlag==1) c = d3.rgb(colorscaleVolatility(legendscale.invert(i)));
    else {
      // fallback
      c = d3.rgb("#ccc");
    }
    image.data[4*i] = c.r;
    image.data[4*i + 1] = c.g;
    image.data[4*i + 2] = c.b;
    image.data[4*i + 3] = 255;
  });
  ctx.putImageData(image, 0, 0);

  var legendaxis = d3.axisRight()
    .scale(legendscale)
    .tickSize(6)
    .ticks(8);

  d3.select("#legend1")
    .attr("height", 0+"px")//(legendheight) + "px")
    .attr("width", 0+"px")//(legendwidth) + "px")
    .style("position", "absolute")
    .style("left", "15px")
    .style("top", margin.top );

  // g.append("g")
  //  .attr("class", "axis")
  //  .attr("transform", "translate(" + (legendwidth - margin.left - margin.right + 3) + "," + (margin.top) + ")")
  //  .call(legendaxis);
//   const hud = window.SpinTrixMainZoom?.getHud?.();

//   if (hud) {
//   // Clear old HUD legend bits
//   hud.selectAll(".legendAxis,.legendLabel").remove();

//   // Axis in the HUD (fixed position in SVG pixels)
//   hud.append("g")
//      .attr("class", "legendAxis")
//      .attr("transform", `translate(${legendwidth + 20}, ${margin.top})`)
//      .call(legendaxis);

//   // Label in the HUD
//   hud.append("text")
//      .attr("class", "legendLabel")
//      .attr("x", legendwidth + 20)
//      .attr("y", legendheight + margin.top + 14)
//      .attr("opacity", 0.7)
//      .text(text_for_legend || "");
// }


  let text_for_legend;
  if (densityColFlag ==1) text_for_legend = "Density";
  else if (degreeColFlag==1) text_for_legend =   "   Degree";
  else if (closenessColFlag==1) text_for_legend=  "   Closeness";
  else if (betweennessColFlag==1) text_for_legend =  "Betweeness";
  else if (eignColFlag==1) text_for_legend = "Eigen";
  else if (volatilityColFlag==1) text_for_legend = "    Volatility";
  else if (localVolatilityColFlag==1) text_for_legend = "    Local Volatility";

// if (hud) {
//   hud.selectAll(".text_for_legend").remove();
//   hud.append("text")
//     .attr("class", "text_for_legend")
//     .text(text_for_legend || "")
//     .attr("opacity", 0.6)
//     .attr("x", 12)
//     .attr("y", 16); // stays the same on screen
// }


   // Initialize main canvas zoom/pan once, then keep using it
// Ensure newly drawn layers zoom correctly, then init/refresh zoom + first fit
adoptLooseChildren();

if (window.SpinTrixMainZoom) {
  window.SpinTrixMainZoom.setup();                 // safe/idempotent
  window.SpinTrixMainZoom.markNonScalingStrokes(); // keep line widths constant
  if (!window.__fitOnceDone__) {
    window.SpinTrixMainZoom.fitAll(300);           // includes off-canvas nodes
    window.__fitOnceDone__ = true;
  }
}

}

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

  const svg = d3.select("#nodeTimesliceChart").append("svg")
      .attr("width",W+M.left+M.right)
      .attr("height",H+M.top+M.bottom)
    .append("g").attr("transform",`translate(${M.left},${M.top})`);

  const sub=["incoming","outgoing","outandin","none"];
  const x=d3.scaleBand().domain(stackedData.map(d=>d.year))
                        .range([0,W]).padding(0.2);
  const y=d3.scaleLinear()
            .domain([0,d3.max(stackedData,d=>d.incoming+d.outgoing+d.outandin+d.none)])
            .range([H,0]);
  const col=d3.scaleOrdinal().domain(sub)
              .range(["#0571b0","#f4a582","#ca0020","#92c5de"]);

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

  svg.append("g").attr("transform",`translate(0,${H})`).call(d3.axisBottom(x));
  svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")));

  svg.append("text").attr("x",W/2).attr("y",H+M.bottom-5)
     .attr("text-anchor","middle").text("Timeslices");
  svg.append("text").attr("transform","rotate(-90)")
     .attr("x",-H/2).attr("y",-M.left+15)
     .attr("text-anchor","middle").text("No. of Edges");

  /* ─────────────────────────────────────────
     3 ▸ ellipse + white number inside
     ───────────────────────────────────────── */
  svg.selectAll(".nodeTypeEllipse")
      .data(stackedData).enter().append("ellipse")
        .attr("class","nodeTypeEllipse")
        .attr("cx",d=>x(d.year)+x.bandwidth()/2)
        .attr("cy",d=> y(d.incoming+d.outgoing+d.outandin+d.none) - 10)
        .attr("rx",8).attr("ry",5)
        .attr("fill",d=>{
          if(d.nodeType==="incoming")  return "#0571b0";
          if(d.nodeType==="outgoing")  return "#f4a582";
          if(d.nodeType==="outandin")  return "#ca0020";
          return "#92c5de";
        });

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
//     if (d.type === "outgoing") return "#f4a582";
//     else if (d.type === "incoming") return "#0571b0";
//     else if (d.type === "outandin") return "#ca0020";
//     else return "#92c5de"; // Default color for "none"
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
                        <span>Both: ${outandinCount}</span> <br>
                        <span>Stable: ${noneCount}</span>
                      </div>
                    `);

  // 6) Basic geometry
  let size = new_data1.length;
  let cellSize = 5;
  let margin = 4;
  let totalSize = margin * 2 + size * cellSize;

  let svg = d3.select("#communityMatrix")
              .append("svg")
              .attr("width", totalSize)
              .attr("height", totalSize);

  // 7) Our color function for the edge type
  function colorByEdgeType(type) {
    if (type === "incoming")  return "#0571b0"; // e.g. blue
    else if (type === "outgoing")  return "#f4a582"; // e.g. orange
    else if (type === "outandin")  return "#ca0020"; // e.g. red
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
   if (t === "incoming")  return "#0571b0";   // blue
   if (t === "outgoing")  return "#f4a582";   // orange
   if (t === "outandin")  return "#ca0020";   // red
   return "#92c5de";                          // “neither” / undefined
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

  /* 1 ▸ nothing selected → wipe and bail out */
  if (selectedCommunitySpirals.length === 0) {
    d3.select("#communitySideContainer").html("");
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
      .style("align-items", "center");

    headerRow.append("span")
      .html(`<b>Community ${selObj.communityID} from ${selObj.yearRange}</b>`);

    /* remove-selection btn */
    headerRow.append("button")
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
    const svg = sideDiv.append("svg")
      .attr("width", SVG_W)
      .attr("height", SVG_H);

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

    nodesOriginal.forEach((d, i) => {
      const away = (i + 30) * awayStep;
      const around = (i + 30) * aroundRad + rotation;
      d.new_x = centreX + Math.cos(around) * away;
      d.new_y = centreY + Math.sin(around) * away;
    });

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
      .attr("rx", 4).attr("ry", 4)
      .style("stroke", "#333").style("stroke-width", 1)
      .style("opacity", d => currentNodeMap.has(d.node) ? 1 : 0.25)
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
          .style("stroke-width", 2);
        d3.selectAll(".happy")
          .filter(n => n.node === d.node)
          .style("stroke", "blue")
          .style("stroke-width", 3);

        /* side-pane text box & charts */
        const curNode = currentNodeMap.get(d.node);
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
          curNode.name
        );
        draw_spiral(commDataCur, neighbours, d.node);
        drawCommunityAdjMatrix(commDataCur, node_to_node_link_data);
        drawNodeTimesliceChart(d.node);
      })
      .on("mouseout", function(event, d) {
        hoverInfo.text("");

        edgesCurrentSel.style("opacity", 1);
        edgesOriginalSel.style("opacity", 0);

        d3.select(this)
          .style("stroke", "#333")
          .style("stroke-width", 1);

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
    if (nodeObj.type === "outandin") return "#ca0020";
    else if (nodeObj.type === "incoming") return "#0571b0";
    else if (nodeObj.type === "outgoing") return "#f4a582";
    else return "#92c5de";
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
  return "#92c5de";
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

function loadAuthorMapping() {
  const authorPath = `data/${window.currentDataset}/author_mapping.txt`; // Adjust path if needed
  console.log("Loading author mapping from:", authorPath);
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

    // Now populate the <datalist> with these items
    populateDatalist(authorMappingArray);
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
    d3.selectAll(".spiral_edges")
      .classed("non-scaling-stroke", true)
      .style("stroke-opacity", k < 0.6 ? 0 : 0.2);

    d3.selectAll(".adjacent_edges")
      .classed("non-scaling-stroke", true)
      .style("stroke-opacity", k < 0.8 ? 0 : 0.5);

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
