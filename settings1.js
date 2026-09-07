let density_var = 0;
let eign_var = 0;
let betweenness_var = 0;
let closeness_var = 0;
let volatility_var = 0; // New variable for volatility filtering

function local_volatility_ranking() {
  localVolatilityCenteringFlag = 1;
  let height = 700;
  let width = 1200;
  let prepare_data = [];

  let unique_communities = new Set(global_data_unchanged.map(d => d.community));

  console.log("updated_version_local_volatility");

  unique_communities.forEach(function(entry) {
    let community_data = global_data_unchanged.filter(d => d.community == entry);

    // Reorder the nodes so that outandin → incoming → outgoing → neither
    let outandin = community_data.filter(d => d.type === "outandin");
    let incoming = community_data.filter(d => d.type === "incoming");
    let outgoing = community_data.filter(d => d.type === "outgoing");
    let neither  = community_data.filter(d =>
      d.type !== "outandin" && d.type !== "incoming" && d.type !== "outgoing"
    );

    let sorted_community_data = outandin.concat(outgoing, incoming, neither);

    // Combine into our overall array
    prepare_data.push(...sorted_community_data);
  });

  // Recompute spiral positions
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width);
  global_data = prepare_data;
  global_data_unchanged = prepare_data;

  d3.select("#chart").select("svg").remove();

  let svg = d3.select("#chart");
  initializeSpiralChart(svg, height, width);
  draw_spiral_community();

  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Local Volatility (by Node Type) ");
}

let local_volatility_var = 0; // tracks the slider/cutoff for local-volatility

function updateTextInputLocalVolatility(val) {
  // Mirror the approach in your existing range bar
  document.getElementById('textInputLocalVolatility').value = val;
  local_volatility_var = val;

  // Filter the data
  global_data = global_data_unchanged.filter(function(d) {
    return (
      d.centrality >= density_var &&
      d.betwness >= betweenness_var &&
      d.eign >= eign_var &&
      d.closeness >= closeness_var &&
      d.volatility >= volatility_var &&
      d.local_volatility >= local_volatility_var  // Add your local-volatility filter
    );
  });

  console.log(global_data);

  // Clear any brush, redraw
  clearBrushSafely();
  draw_spiral_community();

  // Show only the filtered data in the table
  table.selectAll("tr").remove();
  show_table_data(global_data);
}

function colorNodesByLocalVolatility() {
  // Turn off all other color flags
  densityColFlag = 0;
  degreeColFlag = 0;
  closenessColFlag = 0;
  betweennessColFlag = 0;
  eignColFlag = 0;
  volatilityColFlag = 0;

  // Turn ON local volatility color flag
  localVolatilityColFlag = 1;

  // Clear brush & redraw
  clearBrushSafely();
  draw_spiral_community();

  // Update any textual tooltip or label
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Local Volatility ");
}


// ranking based on volatility
function volatility_ranking() {
  localVolatilityCenteringFlag = 0;
  let height = 700;
  let width = 1200;
  let prepare_data = [];
  unique_communities = new Set(global_data_unchanged.map(function(d) { return d.community; }));
  console.log("updated_version_volatility");
  localVolatilityCenteringFlag = 0;
  unique_communities.forEach(function(entry) {
    community_data = global_data_unchanged.filter(function(d) { return d.community == entry; });
    community_data.sort(function(a, b) { return d3.descending(a.volatility, b.volatility); });
    prepare_data.push.apply(prepare_data, community_data);
  });
  console.log(prepare_data);

  // Calculate final x and y position for each point
  localVolatilityCenteringFlag = 0;
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width);
  global_data = prepare_data;
  global_data_unchanged = prepare_data;

  d3.select("#chart").select("svg").remove();

  // Assign height and width of svg
  let svg = d3.select("#chart");
  initializeSpiralChart(svg, height, width);
  draw_spiral_community();
  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Volatility ");
}

// Volatility range bar
// function updateTextInputvolatility(val) {
//   document.getElementById('textInputvolatility').value = val;
//   volatility_var = +val;
//   global_data = global_data_unchanged.filter(function(d) {
//     return d.centrality >= density_var &&
//            d.volatility >= volatility_var; // Added filtering for volatility
//   });
//   console.log(global_data);
//   clearBrushSafely();
//   draw_spiral_community();
//   // Show only selected community in table
// }

function updateTextInputvolatility(val) {
  document.getElementById('textInputvolatility').value = val;
  activeFilters.volatility = +val; // Update the filter value
  applyFiltersAndRedraw();         // Apply all filters and redraw
}

// Color-coding by volatility
function colorNodesByVolatility() {
  densityColFlag = 0;
  degreeColFlag = 0;
  closenessColFlag = 0;
  betweennessColFlag = 0;
  eignColFlag = 0;
  volatilityColFlag = 1; // Set volatility color flag
  localVolatilityColFlag = 0;

  clearBrushSafely();
  draw_spiral_community();
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Volatility ");
}

function searchSelectedNode() {
  // 1) Read user input
  let rawValue = document.getElementById("searchInput").value.trim();
  if (!rawValue) {
    alert("Please choose an author or node ID from the dropdown.");
    return;
  }

  /* 2) Resolve the input to a node id. Three accepted forms, because requiring
        the exact "12 - Some Author" string meant anyone who typed a name got
        "Invalid node ID" — and on datasets with no author_mapping.txt the
        dropdown was empty, so typing a name was the ONLY thing possible.
          "12"              → bare id
          "12 - Some Name"  → the datalist format
          "Some Name"       → name, matched case-insensitively               */
  let selectedNodeId = NaN;

  if (/^\d+$/.test(rawValue)) {
    selectedNodeId = parseInt(rawValue, 10);
  } else {
    const m = rawValue.match(/^\s*(\d+)\s*-\s*/);   // leading "12 - "
    if (m) {
      selectedNodeId = parseInt(m[1], 10);
    } else {
      const needle = rawValue.toLowerCase();
      // Both spellings are searchable: the mapping file's and the CSV's.
      const pool = [
        ...(typeof authorMappingArray !== "undefined" ? authorMappingArray : []),
        ...(global_data_unchanged || []).map(d => ({ id: d.node, name: d.name || "" }))
      ];
      let hit = pool.find(e => (e.name || "").toLowerCase() === needle)
             || pool.find(e => (e.name || "").toLowerCase().includes(needle));
      if (hit) selectedNodeId = +hit.id;
    }
  }

  if (isNaN(selectedNodeId)) {
    alert('No node matches "' + rawValue + '". Type a node ID, or pick a name from the list.');
    return;
  }

  // 3) Check if this node ID is present in the currently loaded timeslice data
  //    Your existing data array is 'global_data_unchanged'
  let found = global_data_unchanged.find(d => d.node == selectedNodeId);

  // If not found, do nothing or show a message
  if (!found) {
    alert("No data found for node: " + selectedNodeId 
          + " in this timeslice.");
    return;
  }
  else{
    find_node_id = selectedNodeId;
  }

  // Clear any existing brush and re-draw spiral
  clearBrushSafely();
  draw_spiral_community();

  // 4) Use your existing logic to highlight that node’s community, etc.
  let node_community = found.community;
  let node_density = found.density;
  let node_centrality = found.centrality;
  let node_betweness = found.betwness;
  let node_closeness = found.closeness;
  let node_eign = found.eign;
  let node_volatility = found.volatility;

  // Filter and sort
  var node_community_data = global_data_unchanged.filter(function(client) {
    return client.community == node_community;
  });
  node_community_data.sort(function(a, b) {
    return d3.descending(a.centrality, b.centrality);
  });
  find_node_draw_spiral(node_community_data);

  // Update the side box
  // d3.select("#node_textbox").html(
  //   "<br/><b>NODE DATA</b>"
  //   + "<br/><b>Community: </b>" + node_community + "<br/>"
  //   + "<b>Degree:</b> " + node_centrality + "<br/>"
  //   + "<b>Betweeness:</b> " + node_betweness + "<br/>"
  //   + "<b>Closeness:</b> " + node_closeness + "<br/>"
  //   + "<b>Volatility:</b> " + node_volatility + "<br/>"
  //   + "<b>Eign:</b> " + node_eign
  // ).style("font-size", "12px");

  // Optionally highlight in the table, etc.
  // ...
}


// Tooltip update for node data
function find_node_by_label() {
  var node_community, node_density, node_centrality, node_betweness, node_closeness, node_eign, node_volatility;

  find_node_id = document.getElementById('textInputNodeId').value;
  clearBrushSafely();
  draw_spiral_community();

  // Search data to find the node and its community/density
  for (i = 0; i < global_data_unchanged.length; i++) {
    if (global_data_unchanged[i].node == find_node_id) {
      node_community = global_data_unchanged[i].community;
      node_density = global_data_unchanged[i].density;
      node_centrality = global_data_unchanged[i].centrality;
      node_betweness = global_data_unchanged[i].betwness;
      node_closeness = global_data_unchanged[i].closeness;
      node_eign = global_data_unchanged[i].eign;
      node_volatility = global_data_unchanged[i].volatility; // Added volatility
      break;
    }
  }

  // Highlighting the node and community in a separate window
  var node_community_data = global_data_unchanged.filter(function(client) { return client.community == node_community; });
  node_community_data.sort(function(a, b) { return d3.descending(a.centrality, b.centrality); });
  find_node_draw_spiral(node_community_data);

  // drawNodeTimesliceChart(find_node_id);

  // Node textbox
  d3.select("#node_textbox").html("<br/><b>NODE DATA</b><br/><b>Community: </b>" + node_community + "<br/>" +
    "<b>Degree:</b> " + node_centrality + "<br/>" +
    "<b>Betweeness:</b> " + node_betweness + "<br/>" +
    "<b>Closeness:</b> " + node_closeness + "<br/>" +
    "<b>Volatility:</b> " + node_volatility + "<br/>" + // Display volatility
    "<b>Eign:</b> " + node_eign)
    .style("font-size", "12px");

  // Highlight the searched node in the table
  // table.selectAll("tr").remove();
  // show_table_data(global_data);
}

//most connected node identification
//degree range_bar
function MostConnectedNodes(val) {
  //first set the flag
  flag_most_connected_nodes = 1
  document.getElementById('textInputConnecteddeg').value=val;
  //node data that are most connected
  most_connected_nodes_data = global_data_unchanged.filter(function(d){
        return d.centrality>=val
        })
  //most connected communities
  var list_of_communities = most_connected_nodes_data.map(function(d){return d.community})
  console.log([... new Set(list_of_communities)])
  var list_of_most_connected_communities = [... new Set(list_of_communities)]
  //filter the community data since you also want to show those communities
  var most_connected_community_data = global_data_unchanged.filter(function(d){
    if(list_of_most_connected_communities.includes(d.community))
      return d
  })
  console.log(most_connected_community_data)
  global_data = most_connected_community_data



  console.log(most_connected_nodes_data)
  var list_of_most_connected_nodes = most_connected_nodes_data.map(function(d){return d.node})
  console.log(list_of_most_connected_nodes)




 // g.call(brush.move, null);
  clearBrushSafely();
  draw_spiral_community()

  d3.selectAll("circle")
.attr("opacity", function(d){
    if(list_of_most_connected_nodes.includes(d.node) ) return 1
    else return .05} )

}

//ranking button
//ranking based on degree
function degree_ranking(){
  localVolatilityCenteringFlag = 0;
  let height = 700
  let width =1200
  let prepare_data = []
  unique_communities = new Set(global_data_unchanged.map(function(d){return d.community}))
  console.log("updated_version_degree")
  unique_communities.forEach(function(entry) {
    community_data = global_data_unchanged.filter(function(d){ return d.community == entry});
    community_data.sort(function(a,b){return d3.descending(a.centrality,b.centrality)})
    prepare_data.push.apply(prepare_data,community_data)
  })
  console.log(prepare_data)

  //calculate final x and y position for each point
  //computing_spiral_positions(center_positions_spiral, data, optimal_no_of_nodes, height, width)
  //prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width)
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width)
  global_data = prepare_data
  global_data_unchanged = prepare_data


  d3.select("#chart").select("svg").remove()


  //assign height and width of svg
  let svg = d3.select("#chart")
  initializeSpiralChart(svg, height, width)
  draw_spiral_community()
  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Degree ")

}

// ranking based on closeness
function closeness_ranking(){
  let height = 700
  let width =1200
  let prepare_data = []
  unique_communities = new Set(global_data_unchanged.map(function(d){return d.community}))
  console.log("updated_version_closeness")
  unique_communities.forEach(function(entry) {
    community_data = global_data_unchanged.filter(function(d){ return d.community == entry});
    community_data.sort(function(a,b){return d3.descending(a.closeness,b.closeness)})
    prepare_data.push.apply(prepare_data,community_data)
  })
  console.log(prepare_data)

  //calculate final x and y position for each point
  //prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width)
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data,optimal_no_of_nodes, height, width)
  global_data = prepare_data
  global_data_unchanged = prepare_data


  d3.select("#chart").select("svg").remove()


  //assign height and width of svg
  let svg = d3.select("#chart")
  initializeSpiralChart(svg, height, width)
  draw_spiral_community()
  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Closeness ")

}

//ranking based on eign centrality
function eign_ranking(){
  let height = 700
  let width =1200
  let prepare_data = []
  unique_communities = new Set(global_data_unchanged.map(function(d){return d.community}))
  console.log("updated_version_eign")
  unique_communities.forEach(function(entry) {
    community_data = global_data_unchanged.filter(function(d){ return d.community == entry});
    community_data.sort(function(a,b){return d3.descending(a.eign,b.eign)})
    prepare_data.push.apply(prepare_data,community_data)
  })
  console.log(prepare_data)

  //calculate final x and y position for each point
  //prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width)
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data,optimal_no_of_nodes, height, width)
  global_data = prepare_data
  global_data_unchanged = prepare_data


  d3.select("#chart").select("svg").remove()


  //assign height and width of svg
  let svg = d3.select("#chart")
  initializeSpiralChart(svg, height, width)
  draw_spiral_community()
  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Eigen Centrality ")

}

//ranking based on betweenness centrality
function between_ranking(){
  let height = 700
  let width =1200
  let prepare_data = []
  unique_communities = new Set(global_data_unchanged.map(function(d){return d.community}))
  console.log("updated_version_betweenness")
  unique_communities.forEach(function(entry) {
    community_data = global_data_unchanged.filter(function(d){ return d.community == entry});
    community_data.sort(function(a,b){return d3.descending(a.betwness,b.betwness)})
    prepare_data.push.apply(prepare_data,community_data)
  })
  console.log(prepare_data)

  //calculate final x and y position for each point
  //prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width)
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data,optimal_no_of_nodes, height, width)
  global_data = prepare_data
  global_data_unchanged = prepare_data


  d3.select("#chart").select("svg").remove()


  //assign height and width of svg
  let svg = d3.select("#chart")
  initializeSpiralChart(svg, height, width)
  draw_spiral_community()
  d3.select("#ranking_tooltip").html("<b>Ranking:</b> Betweenness ")

}

//radius range bar
function updateTextInputRadius(val) {
  console.log(val)
  console.log(global_data)
  document.getElementById('textInputradius').value=val;
  global_radius = val
  clearBrushSafely();
  draw_spiral_community()
  //show only selected community in table
  table.selectAll("tr").remove()
  // show_table_data(global_data)
}

// function updateTextInputdeg(val) {
//   document.getElementById('textInputdeg').value = val;
//   degree_var = +val; // parse to a number
//   console.log("Degree slider value:", degree_var);

//   global_data = global_data_unchanged.filter(d => 
//     d.centrality >= degree_var 
//   );

//   // Now redraw
//   clearBrushSafely();
//   draw_spiral_community();
// }

function updateTextInputdeg(val) {
  document.getElementById('textInputdeg').value = val;
  activeFilters.degree = +val; // Update the filter value
  applyFiltersAndRedraw();       // Apply all filters and redraw
}

  //betweenness range_bar
  function updateTextInputbet(val) {
    document.getElementById('textInputbet').value=val;
    betweenness_var = val
    global_data = global_data_unchanged.filter(function(d){
        return d.centrality>=density_var && d.betwness>=betweenness_var && d.eign>=eign_var && d.closeness>=closeness_var
        })
  console.log(global_data)
  clearBrushSafely();
  draw_spiral_community()
  //show only selected community in table
  table.selectAll("tr").remove()
  show_table_data(global_data)
  }


  //eign range_bar
  function updateTextInputeig(val) {
    document.getElementById('textInputeig').value=val;
    eign_var = val ;
    global_data = global_data_unchanged.filter(function(d){
        return d.centrality>=density_var && d.betwness>=betweenness_var && d.eign>=eign_var && d.closeness>=closeness_var
        })
  console.log(global_data)
  clearBrushSafely();
  draw_spiral_community()
  //show only selected community in table
  table.selectAll("tr").remove()
  show_table_data(global_data)
  }
//closeness range_bar
  function updateTextInputclo(val) {
    document.getElementById('textInputclo').value=val;
    closeness_var =val
    global_data = global_data_unchanged.filter(function(d){
        return d.centrality>=density_var && d.betwness>=betweenness_var && d.eign>=eign_var && d.closeness>=closeness_var
        })
  console.log(global_data)
  clearBrushSafely();
  draw_spiral_community()
  //show only selected community in table
  table.selectAll("tr").remove()
  show_table_data(global_data)
  }

//colorcoding
function colorNodesByDensity(){
   densityColFlag = 1
   degreeColFlag = 0
   closenessColFlag = 0
   betweennessColFlag = 0
   eignColFlag = 0
   localVolatilityColFlag = 0;
   clearBrushSafely();
   draw_spiral_community()
   d3.select("#color_tooltip").html("<b>Color-Coding:</b> Density ")
}

function colorNodesByDegree(){
  densityColFlag = 0
  degreeColFlag = 1
  closenessColFlag = 0
  betweennessColFlag = 0
  eignColFlag = 0
  localVolatilityColFlag = 0;
  clearBrushSafely();
  draw_spiral_community()
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Degree ")
}


function colorNodesByCloseness(){
  densityColFlag = 0
  degreeColFlag = 0
  closenessColFlag = 1
  betweennessColFlag = 0
  eignColFlag = 0
  localVolatilityColFlag = 0;
  clearBrushSafely();
  draw_spiral_community()
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Closeness ")
}

function colorNodesByBetweeness(){
  densityColFlag = 0
  degreeColFlag = 0
  closenessColFlag = 0
  betweennessColFlag = 1
  eignColFlag = 0
  localVolatilityColFlag = 0;
  clearBrushSafely();
  draw_spiral_community()
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Betweenness ")
}

function colorNodesByEign(){
  densityColFlag = 0
  degreeColFlag = 0
  closenessColFlag = 0
  betweennessColFlag = 0
  eignColFlag = 1
  localVolatilityColFlag = 0;
  clearBrushSafely();
  draw_spiral_community()
  d3.select("#color_tooltip").html("<b>Color-Coding:</b> Eigen Centrality ")

}


  function find_node_by_label(){

    var node_community;
    var node_density,
    node_centrality,
    node_betweness,
    node_closeness,
    node_eign;

    find_node_id = document.getElementById('textInputNodeId').value
    clearBrushSafely();
    draw_spiral_community()



    //search data to find the node and then community and denstity of searched node
    for(i=0; i<global_data_unchanged.length; i++)
    {
      if (global_data_unchanged[i].node == find_node_id)
      {
        node_community = global_data_unchanged[i].community
        node_density = global_data_unchanged[i].density
        node_centrality = global_data_unchanged[i].centrality
        node_betweness = global_data_unchanged[i].betwness
        node_closeness = global_data_unchanged[i].closeness
        node_eign = global_data_unchanged[i].eign
        node_volatility = global_data_unchanged[i].volatility // Added volatility
        break;
      }
    }
    //highlighting the node and commun ijty in seperate window
    var node_community_data = global_data_unchanged.filter(function(client){return client.community==node_community})
    node_community_data.sort(function(a,b){return d3.descending(a.centrality,b.centrality)})
    find_node_draw_spiral(node_community_data)
    //node textbox
    var margin = {top: 10, right: 30, bottom: 30, left: 40},
      width = 250 - margin.left - margin.right,
      height = 250 - margin.top - margin.bottom;

      d3.select("#community_histogram").select("svg").remove()
    d3.select("#node_textbox").select("svg").remove()

  // append the svg object to the body of the page
    var svg = d3.select("#node_textbox")
      .html("<br/><b>NODE DATA</b><br/><b>Community: </b>"+ node_community +"<br/>" + 
      "<b>Degree:</b> "+ node_centrality + "<br/>" +
       "<b>Betweeness:</b> " + node_betweness + "<br/>" +
       "<b>Closeness:</b> " + node_closeness + "<br/>" +
       "<b>Volatility:</b> " + node_volatility + "<br/>" +
       "<b>Eign:</b> " + node_eign )
       .style("font-size", "12px")
    //highlight the node in table also
    //introduce the reset button to reset the entire visualization again

    //highlight the searched node in table
      table.selectAll("tr").remove()
      show_table_data(global_data)

  }


//show and hide edges button
  function edge_visualization(){
    /* State is tracked explicitly rather than inferred from a style read-back.
       The old version compared style("stroke-opacity") against 1: after any
       node mouseout cleared the inline style the read returned "", so the first
       click showed edges instead of hiding them. Edge opacity is also
       weight-driven now, so there is no single value to compare against. */
    window.setEdgesHidden(!window.getEdgesHidden());
  }



  //show and hide edges button
  function reset_button(){
    //reset find node functionality
    find_node_id = -1
    document.getElementById('searchInput').placeholder = "Type author or ID..."

    //most connected node functionality reset
    flag_most_connected_nodes = 0
    document.getElementById('textInputConnecteddeg').value= 0
    document.getElementById('MostConnected').value= 0

    // reseting filtering values
    //degree
    document.getElementById('textInputdeg').value= 0
    document.getElementById('Degree').value= 0
    //closeness
    document.getElementById('textInputclo').value= 0
    document.getElementById('Closeness').value= 0
    //eign
    document.getElementById('textInputeig').value= 0
    document.getElementById('Eign').value= 0
    //between
    document.getElementById('textInputbet').value= 0
    document.getElementById('Betweenness').value= 0

    //clearing the highlight window
    d3.select("#node_textbox").html("")
    d3.select("#community_textbox").html("")
    d3.select("#community_histogram").select("svg").remove()
    d3.select("#community_spiral").select("svg").remove()


    global_data = global_data_unchanged
    clearBrushSafely();
    draw_spiral_community()
    //show only selected community in table
    table.selectAll("tr").remove()
    show_table_data(global_data)

  }


// ═══════════════════════════════════════════════════════════════
//  LOG-HYBRID α SLIDER  (Component 3)
// ═══════════════════════════════════════════════════════════════

/**
 * Called when the user releases the α slider.
 * Re-runs logHybridSort at the new α and rebuilds the spiral.
 */
function updateAlpha(val) {
  val = parseFloat(val);
  document.getElementById('textInputAlpha').value = val.toFixed(2);
  window.currentAlpha = val;

  // Update badge
  var isAuto = Math.abs(val - window.currentBestAlpha) < 0.026; // within one step
  var label = document.getElementById('paretoLabel');
  if (label) {
    label.textContent = isAuto ? 'Auto ★' : 'Manual';
    label.className   = 'badge ' + (isAuto ? 'bg-success' : 'bg-secondary');
  }

  // Nothing to recompute if no engine data is loaded
  if (!window.sliceDataForLogHybrid || window.sliceDataForLogHybrid.length < 2) return;

  // Recompute sorted counts for ALL slices at the new α
  window.allSliceSortedCounts = logHybridSort(
    window.sliceDataForLogHybrid, val
  );

  // Find current slice index and apply
  var sliceIndex = -1;
  if (window.currentSlices && window.currentYearRange) {
    sliceIndex = window.currentSlices.indexOf(window.currentYearRange);
  }
  if (sliceIndex >= 0 && window.allSliceSortedCounts[sliceIndex]) {
    window.currentSortedCountsForSlice = window.allSliceSortedCounts[sliceIndex];
    console.log("Rebuilding slice ", sliceIndex, window.currentSortedCountsForSlice); rebuildSpiralWithNewOrder();
  }
}

/**
 * Rebuild the entire spiral visualization using the current
 * engine-sorted community counts, without reloading data from disk.
 */
function rebuildSpiralWithNewOrder() {
  var sorted = window.currentSortedCountsForSlice;
  if (!sorted) return;

  var svg    = d3.select("#chart");
  var bounds = svg.node().getBoundingClientRect();
  var width  = bounds.width;
  var height = bounds.height;

  // Convert engine format to the CSV-row format the code expects
  var csvRows = sorted.map(function(r) {
    return { community: String(r.community), count: String(r.count) };
  });

  // Recompute community centre positions from the new ordering
  center_positions_spiral = string_to_numbers_graph_centers(csvRows);
  center_positions_spiral = transform_graph_centers(center_positions_spiral, height, width);
  center_positions_spiral.sort(function(a, b) { return d3.ascending(a.community, b.community); });

  // Recompute optimal number of nodes for the updated community sizes
  optimal_no_of_nodes = opt_no_of_nodes(csvRows);

  // Get the base node data (before spiral positions) by stripping x,y from current data
  // We use global_data_unchanged which has the full node attributes
  var baseData = global_data_unchanged.map(function(d) {
    var copy = Object.assign({}, d);
    // These will be recomputed by computing_spiral_positions
    delete copy.x;
    delete copy.y;
    return copy;
  });

  // Sort nodes within each community by centrality (same as showdata_spiral_community_chart)
  var prepare_data = [];
  var unique_comms = new Set(baseData.map(function(d) { return d.community; }));
  unique_comms.forEach(function(entry) {
    var commData = baseData.filter(function(d) { return d.community == entry; });
    commData.sort(function(a, b) { return d3.descending(a.centrality, b.centrality); });
    prepare_data.push.apply(prepare_data, commData);
  });

  // Recompute spiral positions with the new centres
  prepare_data = computing_spiral_positions(center_positions_spiral, prepare_data, height, width);

  global_data = prepare_data;
  global_data_unchanged = prepare_data;
  global_data_sorted = prepare_data.slice();
  global_data_sorted.sort(function(a, b) { return d3.descending(a.node, b.node); });
  global_data = global_data_sorted;

  // Clear and redraw
  d3.select("#chart").select("svg").remove();
  var newSvg = d3.select("#chart");
  var newBounds = newSvg.node().getBoundingClientRect();
  initializeSpiralChart(newSvg, newBounds.height, newBounds.width);

  updateGraphStats(global_data, node_to_node_link_data);
  draw_spiral_community();

  // Fit the newly ordered spiral to screen
  if (window.SpinTrixMainZoom && window.SpinTrixMainZoom.fitAll) {
    window.SpinTrixMainZoom.fitAll(400, 40);
  }
}

/**
 * Sync the α slider UI to reflect the auto-computed best α.
 * Called by BarChartPopulator.js after Pareto analysis completes.
 */
function syncAlphaSliderUI() {
  var slider   = document.getElementById('AlphaSlider');
  var text     = document.getElementById('textInputAlpha');
  var hint     = document.getElementById('alphaHint');
  var label    = document.getElementById('paretoLabel');
  var details  = document.getElementById('paretoDetailsText');
  var rhoDisp  = document.getElementById('rhoFloorDisplay');

  if (slider) slider.value = window.currentBestAlpha;
  if (text)   text.value   = window.currentBestAlpha.toFixed(2);
  // Wording matches the paper: this is where the slider OPENS, chosen by the
  // constrained sweep, not an optimum. The analyst sets any alpha they want.
  if (hint)   hint.textContent =
    'Suggested for this dataset: \u03b1 = ' + window.currentBestAlpha.toFixed(2) +
    ' \u00b7 drag to explore';
  if (label) {
    label.textContent = 'Suggested \u2605';
    label.className   = 'badge bg-success';
  }
  if (rhoDisp) rhoDisp.textContent = window.currentRhoFloor.toFixed(2);

  // Build mini sweep table in the info tooltip
  if (details && window.currentParetoResults.length > 0) {
    var html = '<table style="font-size:11px;width:100%">';
    html += '<tr><th>\u03b1</th><th>\u03c4</th><th>\u03c1</th><th></th></tr>';
    for (var i = 0; i < window.currentParetoResults.length; i++) {
      var r = window.currentParetoResults[i];
      var isBest    = Math.abs(r.alpha - window.currentBestAlpha) < 0.01;
      var qualified = r.rho >= window.currentRhoFloor;
      var style = isBest ? 'font-weight:bold;color:#4dac26' :
                  !qualified ? 'color:#999' : '';
      html += '<tr style="' + style + '">';
      html += '<td>' + r.alpha.toFixed(2) + '</td>';
      html += '<td>' + r.tau.toFixed(3)   + '</td>';
      html += '<td>' + r.rho.toFixed(3)   + '</td>';
      html += '<td>' + (isBest ? '\u2605' : !qualified ? '\u2715' : '') + '</td>';
      html += '</tr>';
    }
    html += '</table>';
    details.innerHTML = html;
  }
}
