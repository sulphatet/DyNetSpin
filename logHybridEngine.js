/**
 * logHybridEngine.js
 * ==================
 * Client-side implementation of the Log-Hybrid Spiral Ranking algorithm
 * and Constrained τ-Maximisation with ρ Floor for automatic α selection.
 *
 * Ported from: log_hybrid_experiment.py, comparative_evaluation.py
 *
 * Public API:
 *   logHybridSort(sliceData, alpha, timeGap)  → sortedCountsPerSlice
 *   computeMetrics(sortedCountsSeries)        → {tau, rho}
 *   findBestAlpha(sliceData, step)            → {bestAlpha, paretoResults, rhoFloor}
 */

// ─────────────────────────────────────────────────────────────────
// 1.  LOG-HYBRID SORT
// ─────────────────────────────────────────────────────────────────

/**
 * Run the Log-Hybrid algorithm across all slices.
 *
 * @param {Array} sliceData - Array of objects, one per time slice:
 *   [{
 *     counts: [{community: int, count: int}, ...],
 *     nodeMap: {nodeId: communityId, ...}
 *   }, ...]
 * @param {number} alpha  - Blending parameter ∈ [0, 1].
 *                          1 = pure size, 0 = pure history.
 * @param {number} [timeGap=0.1] - Rank increment for each new wave.
 * @returns {Array} sortedCountsPerSlice - Array of sorted counts arrays,
 *   one per slice. Each element is [{community, count}, ...] in sorted order.
 */
function logHybridSort(sliceData, alpha, timeGap) {
  if (timeGap === undefined) timeGap = 0.1;
  if (!sliceData || sliceData.length === 0) return [];

  var numSlices = sliceData.length;

  // ── T1: Sort ascending by count (smallest = centre, largest = periphery)
  var dfT1 = sliceData[0].counts.slice().sort(function(a, b) {
    if (a.count !== b.count) return a.count - b.count;
    return a.community - b.community;   // deterministic tie-break (see below)
  });

  var totalComms = dfT1.length;
  var commRankMap = {};
  for (var idx = 0; idx < totalComms; idx++) {
    commRankMap[dfT1[idx].community] = idx / Math.max(1, totalComms - 1);
  }

  // Persistent node database: { nodeId : rankScore }
  var nodeDb = {};
  var nodeMap0 = sliceData[0].nodeMap;
  var nodeKeys0 = Object.keys(nodeMap0);
  for (var k = 0; k < nodeKeys0.length; k++) {
    var node = nodeKeys0[k];
    var comm = nodeMap0[node];
    nodeDb[node] = (commRankMap[comm] !== undefined) ? commRankMap[comm] : 1.0;
  }

  var currentWaveRank = 1.0 + timeGap;
  var sortedAll = [dfT1.slice()];

  for (var i = 1; i < numSlices; i++) {
    var nodeMapI = sliceData[i].nodeMap;
    var nodeKeysI = Object.keys(nodeMapI);

    // A. Learn new nodes
    for (var nk = 0; nk < nodeKeysI.length; nk++) {
      var n = nodeKeysI[nk];
      if (nodeDb[n] === undefined) {
        nodeDb[n] = currentWaveRank;
      }
    }

    // B. Compute community barycentres
    var commHistVals = {};
    for (var nk2 = 0; nk2 < nodeKeysI.length; nk2++) {
      var nd = nodeKeysI[nk2];
      var cm = nodeMapI[nd];
      if (!commHistVals[cm]) commHistVals[cm] = [];
      commHistVals[cm].push(nodeDb[nd]);
    }

    var commBarycenter = {};
    var commKeys = Object.keys(commHistVals);
    for (var ck = 0; ck < commKeys.length; ck++) {
      var c = commKeys[ck];
      var vals = commHistVals[c];
      var sum = 0;
      for (var v = 0; v < vals.length; v++) sum += vals[v];
      commBarycenter[c] = sum / vals.length;
    }

    // C. Compute hybrid score and sort
    var df = sliceData[i].counts.slice();
    var maxCount = 1;
    for (var ci = 0; ci < df.length; ci++) {
      if (df[ci].count > maxCount) maxCount = df[ci].count;
    }
    var maxLogSize = Math.log(maxCount);
    if (maxLogSize === 0) maxLogSize = 1;

    for (var ci2 = 0; ci2 < df.length; ci2++) {
      var row = df[ci2];
      var sizePart = (row.count > 0)
        ? (Math.log(row.count) / maxLogSize)
        : 0.0;
      var histPart = (commBarycenter[row.community] !== undefined)
        ? commBarycenter[row.community]
        : currentWaveRank;
      df[ci2]._sortScore = alpha * sizePart + (1 - alpha) * histPart;
    }

    // Ties broken by community id so the ordering is fully determined by the
    // data, not by the sort implementation. (Without this, equal-size
    // communities — common at α=1 — order differently under a stable sort
    // (JS) than under an unstable one (pandas quicksort), and the two
    // implementations disagree on τ.)
    df.sort(function(a, b) {
      if (a._sortScore !== b._sortScore) return a._sortScore - b._sortScore;
      return a.community - b.community;
    });

    // Clean sort score and store
    var dfClean = [];
    for (var ci3 = 0; ci3 < df.length; ci3++) {
      dfClean.push({ community: df[ci3].community, count: df[ci3].count });
    }
    sortedAll.push(dfClean);

    // D. Update node database with new ranks
    var currentTotal = dfClean.length;
    var newCommRanks = {};
    for (var ci4 = 0; ci4 < dfClean.length; ci4++) {
      newCommRanks[dfClean[ci4].community] = ci4 / Math.max(1, currentTotal - 1);
    }
    for (var nk3 = 0; nk3 < nodeKeysI.length; nk3++) {
      var nd2 = nodeKeysI[nk3];
      var cm2 = nodeMapI[nd2];
      if (newCommRanks[cm2] !== undefined) {
        nodeDb[nd2] = newCommRanks[cm2];
      }
    }

    currentWaveRank += timeGap;
  }

  return sortedAll;
}


// ─────────────────────────────────────────────────────────────────
// 2.  RANK CORRELATION METRICS (pure JS, no dependencies)
// ─────────────────────────────────────────────────────────────────

/**
 * Compute Kendall's τ-b between two arrays.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} τ ∈ [-1, 1], or NaN if degenerate.
 */
function _kendallTau(x, y) {
  var n = x.length;
  if (n < 3) return NaN;
  var concordant = 0, discordant = 0, tiesX = 0, tiesY = 0;
  for (var i = 0; i < n; i++) {
    for (var j = i + 1; j < n; j++) {
      var dx = x[i] - x[j];
      var dy = y[i] - y[j];
      if (dx === 0 && dy === 0) { tiesX++; tiesY++; }
      else if (dx === 0) { tiesX++; }
      else if (dy === 0) { tiesY++; }
      else if ((dx > 0 && dy > 0) || (dx < 0 && dy < 0)) { concordant++; }
      else { discordant++; }
    }
  }
  var n0 = n * (n - 1) / 2;
  var denom = Math.sqrt((n0 - tiesX) * (n0 - tiesY));
  if (denom === 0) return NaN;
  return (concordant - discordant) / denom;
}

/**
 * Assign fractional ranks (handles ties via mean rank).
 * @param {number[]} arr
 * @returns {number[]} ranks (1-based)
 */
function _rankData(arr) {
  var n = arr.length;
  var indexed = [];
  for (var i = 0; i < n; i++) indexed.push({ val: arr[i], idx: i });
  indexed.sort(function(a, b) { return a.val - b.val; });

  var ranks = new Array(n);
  var i2 = 0;
  while (i2 < n) {
    var j = i2;
    while (j < n && indexed[j].val === indexed[i2].val) j++;
    var avgRank = (i2 + j + 1) / 2; // 1-based average
    for (var k = i2; k < j; k++) ranks[indexed[k].idx] = avgRank;
    i2 = j;
  }
  return ranks;
}

/**
 * Compute Spearman's ρ between two arrays.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} ρ ∈ [-1, 1], or NaN if degenerate.
 */
function _spearmanRho(x, y) {
  var rx = _rankData(x);
  var ry = _rankData(y);

  var n = rx.length;
  if (n < 3) return NaN;

  var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (var i = 0; i < n; i++) {
    sumX += rx[i]; sumY += ry[i];
    sumXY += rx[i] * ry[i];
    sumX2 += rx[i] * rx[i];
    sumY2 += ry[i] * ry[i];
  }
  var num = n * sumXY - sumX * sumY;
  var denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return NaN;
  return num / denom;
}


// ─────────────────────────────────────────────────────────────────
// 3.  COMPUTE METRICS
// ─────────────────────────────────────────────────────────────────

/**
 * Build the cross-slice community identity matching ONCE for a dataset.
 *
 * Why: per-slice Louvain (build_dataset.py: louvain_contiguous) assigns
 * community ids contiguously in per-slice discovery order and never matches
 * them across slices, so id k at slice t and id k at slice t+1 are unrelated
 * groups. Measured on this repo's data, the chance that a community's true
 * member-overlap successor carries the same id is at or near 1/k on every
 * Louvain dataset. Pairing communities by id therefore measures noise.
 * Datasets built in 'groundtruth' mode do get a global 0..K-1 remap, so
 * there ids ARE identities and this matching reduces to the identity map.
 *
 * The matching depends only on slice MEMBERSHIPS, never on the ordering, so
 * it is invariant across the whole α sweep and is computed a single time.
 *
 * @param {Array} sliceData - Same format as logHybridSort() input.
 * @param {number} [minJaccard=0.10] - Below this, two communities are not "the same".
 * @returns {Array} per-transition [[commA, commB], ...] matched pairs.
 */
function buildIdentityMatching(sliceData, minJaccard) {
  if (minJaccard === undefined) minJaccard = 0.10;
  var matchings = [];
  if (!sliceData || sliceData.length < 2) return matchings;

  function membersOf(nodeMap) {
    var g = {};
    var keys = Object.keys(nodeMap);
    for (var i = 0; i < keys.length; i++) {
      var c = nodeMap[keys[i]];
      if (!g[c]) g[c] = {};
      g[c][keys[i]] = 1;
    }
    return g;
  }

  for (var t = 0; t < sliceData.length - 1; t++) {
    var A = membersOf(sliceData[t].nodeMap);
    var B = membersOf(sliceData[t + 1].nodeMap);
    var aKeys = Object.keys(A), bKeys = Object.keys(B);

    // Candidate pairs with Jaccard >= threshold.
    var cands = [];
    for (var i2 = 0; i2 < aKeys.length; i2++) {
      var ma = A[aKeys[i2]];
      var maKeys = Object.keys(ma);
      for (var j2 = 0; j2 < bKeys.length; j2++) {
        var mb = B[bKeys[j2]];
        var inter = 0;
        for (var k2 = 0; k2 < maKeys.length; k2++) {
          if (mb[maKeys[k2]] !== undefined) inter++;
        }
        if (!inter) continue;
        var uni = maKeys.length + Object.keys(mb).length - inter;
        var jac = inter / uni;
        if (jac >= minJaccard) cands.push([jac, aKeys[i2], bKeys[j2]]);
      }
    }

    // Greedy one-to-one on descending Jaccard (Greene et al. style):
    // one-to-one stops a split being double-counted as two survivals.
    cands.sort(function (p, q) { return q[0] - p[0]; });
    var usedA = {}, usedB = {}, pairs = [];
    for (var c2 = 0; c2 < cands.length; c2++) {
      var ca = cands[c2][1], cb = cands[c2][2];
      if (usedA[ca] || usedB[cb]) continue;
      usedA[ca] = 1; usedB[cb] = 1;
      pairs.push([ca, cb]);
    }
    matchings.push(pairs);
  }
  return matchings;
}


/**
 * Compute Kendall's τ (temporal stability) and Spearman's ρ (radial monotonicity)
 * from a series of sorted community counts.
 *
 * @param {Array} sortedCountsSeries - Output of logHybridSort().
 * @param {Array} [matchings] - Output of buildIdentityMatching(). When supplied,
 *   τ is computed over member-matched communities (correct for Louvain
 *   datasets). When omitted, communities are paired by id — kept for
 *   backward compatibility and exact only for globally-stable ids.
 * @returns {{tau: number, rho: number}}
 */
function computeMetrics(sortedCountsSeries, matchings) {
  // Build rankings: community → rank index
  var rankings = [];
  for (var t = 0; t < sortedCountsSeries.length; t++) {
    var rankMap = {};
    var df = sortedCountsSeries[t];
    for (var idx = 0; idx < df.length; idx++) {
      rankMap[df[idx].community] = idx;
    }
    rankings.push(rankMap);
  }

  // 1. Temporal Stability: Kendall's τ between consecutive slices.
  //    Communities are paired by member-overlap identity when a matching is
  //    supplied, else by raw id (exact only for globally-stable ids).
  var tauScores = [];
  for (var t2 = 1; t2 < rankings.length; t2++) {
    var prev = rankings[t2 - 1];
    var curr = rankings[t2];
    var vecPrev = [], vecCurr = [];

    if (matchings && matchings[t2 - 1]) {
      var pairs = matchings[t2 - 1];
      for (var mi = 0; mi < pairs.length; mi++) {
        var pa = prev[pairs[mi][0]], pb = curr[pairs[mi][1]];
        if (pa !== undefined && pb !== undefined) {
          vecPrev.push(pa);
          vecCurr.push(pb);
        }
      }
    } else {
      var prevKeys = Object.keys(prev);
      for (var pk = 0; pk < prevKeys.length; pk++) {
        if (curr[prevKeys[pk]] !== undefined) {
          vecPrev.push(prev[prevKeys[pk]]);
          vecCurr.push(curr[prevKeys[pk]]);
        }
      }
    }

    if (vecPrev.length > 2) {
      var tau = _kendallTau(vecPrev, vecCurr);
      if (!isNaN(tau)) tauScores.push(tau);
    }
  }

  // 2. Radial Monotonicity: Spearman's ρ (size vs rank)
  var rhoScores = [];
  for (var t3 = 0; t3 < sortedCountsSeries.length; t3++) {
    var df2 = sortedCountsSeries[t3];
    if (df2.length > 2) {
      var sizes = [], rankIndices = [];
      for (var ri = 0; ri < df2.length; ri++) {
        sizes.push(df2[ri].count);
        rankIndices.push(ri);
      }
      var rho = _spearmanRho(sizes, rankIndices);
      if (!isNaN(rho)) rhoScores.push(rho);
    }
  }

  var meanTau = 0, meanRho = 0;
  if (tauScores.length > 0) {
    var s1 = 0; for (var a = 0; a < tauScores.length; a++) s1 += tauScores[a];
    meanTau = s1 / tauScores.length;
  }
  if (rhoScores.length > 0) {
    var s2 = 0; for (var b = 0; b < rhoScores.length; b++) s2 += rhoScores[b];
    meanRho = s2 / rhoScores.length;
  }

  return { tau: meanTau, rho: meanRho };
}


// ─────────────────────────────────────────────────────────────────
// 4.  FIND BEST ALPHA — Constrained τ-Max with ρ Floor
// ─────────────────────────────────────────────────────────────────

/**
 * Sweep α values and find the best one using the Constrained
 * τ-Maximisation with ρ Floor algorithm.
 *
 * Algorithm:
 *   1. Sweep α ∈ {0, step, 2·step, ..., 1.0}
 *   2. Compute (τ, ρ) for each α
 *   3. ρ_floor = max(0.70, ρ_best × 0.85)
 *   4. candidates = { α : ρ_α ≥ ρ_floor }
 *   5. Among candidates, pick α with highest τ
 *   6. Break ties by preferring higher ρ (within 0.005 τ tolerance)
 *
 * @param {Array} sliceData - Same format as logHybridSort() input.
 * @param {number} [step=0.05] - α increment for the sweep.
 * @returns {{bestAlpha: number, paretoResults: Array, rhoFloor: number}}
 */
function findBestAlpha(sliceData, step) {
  if (step === undefined) step = 0.05;
  if (!sliceData || sliceData.length < 2) {
    return { bestAlpha: 0.6, paretoResults: [], rhoFloor: 0.70 };
  }

  var t0 = performance.now();
  var results = [];

  // Community identity is a property of the memberships, not of the ordering,
  // so the matching is built once and reused for every α in the sweep.
  var matchings = buildIdentityMatching(sliceData);

  // Step 1: Sweep
  for (var a = 0; a <= 1.001; a += step) {
    var alpha = Math.round(a * 100) / 100; // avoid floating-point drift
    var sorted = logHybridSort(sliceData, alpha);
    var metrics = computeMetrics(sorted, matchings);
    results.push({
      alpha: alpha,
      tau: metrics.tau,
      rho: metrics.rho
    });
  }

  // Step 2: Find ρ_best
  var rhoBest = -Infinity;
  for (var r = 0; r < results.length; r++) {
    if (results[r].rho > rhoBest) rhoBest = results[r].rho;
  }

  // Step 3: Compute ρ_floor
  var rhoFloor = Math.max(0.70, rhoBest * 0.85);

  // Step 4: Filter candidates
  var candidates = [];
  for (var r2 = 0; r2 < results.length; r2++) {
    if (results[r2].rho >= rhoFloor) {
      candidates.push(results[r2]);
    }
  }

  // Fallback: if nothing qualifies (shouldn't happen), use α=1.0
  if (candidates.length === 0) {
    var t1 = performance.now();
    console.log("[logHybridEngine] α sweep: no candidates, fallback α=1.0 (" +
                (t1 - t0).toFixed(0) + "ms)");
    return { bestAlpha: 1.0, paretoResults: results, rhoFloor: rhoFloor };
  }

  // Step 5: Find max τ among candidates
  var tauMax = -Infinity;
  for (var c = 0; c < candidates.length; c++) {
    if (candidates[c].tau > tauMax) tauMax = candidates[c].tau;
  }

  // Step 6: Among finalists within τ tolerance, pick highest ρ
  var TAU_TOLERANCE = 0.005;
  var finalists = [];
  for (var c2 = 0; c2 < candidates.length; c2++) {
    if (candidates[c2].tau >= tauMax - TAU_TOLERANCE) {
      finalists.push(candidates[c2]);
    }
  }

  // Pick the finalist with highest ρ (cleanest visual among equally stable)
  var bestAlpha = finalists[0].alpha;
  var bestRho = finalists[0].rho;
  for (var f = 1; f < finalists.length; f++) {
    if (finalists[f].rho > bestRho) {
      bestRho = finalists[f].rho;
      bestAlpha = finalists[f].alpha;
    }
  }

  var t1b = performance.now();
  console.log("[logHybridEngine] α sweep complete: α*=" + bestAlpha.toFixed(2) +
              " (τ=" + tauMax.toFixed(3) + ", ρ_floor=" + rhoFloor.toFixed(3) +
              ", " + (t1b - t0).toFixed(0) + "ms)");

  return {
    bestAlpha: bestAlpha,
    paretoResults: results,
    rhoFloor: rhoFloor
  };
}


// ─────────────────────────────────────────────────────────────────
// 5.  CONVENIENCE: Build sliceData from loaded CSVs
// ─────────────────────────────────────────────────────────────────

/**
 * Build the sliceData structure expected by logHybridSort/findBestAlpha
 * from the CSVs already loaded by BarChartPopulator.js.
 *
 * @param {string} datasetKey     - e.g. "enron_ipr"
 * @param {object} datasetsConfig - The full DATASETS_CONFIG object
 * @param {object} allYearsNodeData  - { yearLabel: { nodeId: {community} } }
 * @param {object} allYearsCountData - { yearLabel: [{community, count}] }
 * @returns {Array} sliceData ready for the engine
 */
function buildSliceData(datasetKey, datasetsConfig, allYearsNodeData, allYearsCountData) {
  var ds = datasetsConfig[datasetKey];
  if (!ds) return [];

  // Iterate the ACTIVE granularity level (window.currentSlices), not the coarse
  // config, so the α sweep matches whatever level the timeline is showing.
  var labels = (window.currentSlices && window.currentSlices.length)
    ? window.currentSlices
    : (ds.slices || []).filter(function(s){ return s.enabled !== false; }).map(function(s){ return s.label; });
  var sliceData = [];

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var nodeData = allYearsNodeData[label];
    var countData = allYearsCountData[label];

    if (!nodeData || !countData) continue;

    // Build nodeMap: {nodeId: communityId}
    var nodeMap = {};
    var nodeIds = Object.keys(nodeData);
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var nid = nodeIds[ni];
      nodeMap[nid] = nodeData[nid].community;
    }

    // Build counts: [{community, count}]
    var counts = [];
    for (var ci = 0; ci < countData.length; ci++) {
      counts.push({
        community: countData[ci].community,
        count: countData[ci].count
      });
    }

    sliceData.push({ counts: counts, nodeMap: nodeMap });
  }

  return sliceData;
}
