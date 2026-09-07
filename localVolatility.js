/**
 * localVolatility.js
 * ==================
 * Single source of truth for Local Volatility state semantics.
 *
 * WHY THIS EXISTS
 * ---------------
 * A node's state comes from a ±1 window: it is Incoming if absent at t−1,
 * Outgoing if absent at t+1, Transient if both, Stable if neither.
 *
 * At the FIRST slice there is no t−1 and at the LAST slice there is no t+1,
 * so one half of the window is unobservable. The pipeline
 * (`build_dataset.py: patch_level → ntype`) treats "unobserved" as "absent",
 * which forces every first-slice node to Incoming/Transient and every
 * last-slice node to Outgoing/Transient. That is not a finding about the data;
 * it is a consequence of where the data stops, and a reviewer of an earlier
 * version of this work correctly identified it as such.
 *
 * The other half of the window IS observed, and the pipeline already computed
 * it — it is simply folded into the forced bit and mislabelled:
 *
 *            observed at t=0            observed at t=n−1
 *   raw      (whether it leaves)        (whether it just arrived)
 *   ───────────────────────────────────────────────────────────────
 *   outandin  leaves        → Outgoing   just arrived  → Incoming
 *   incoming  continues     → Stable     (not produced)
 *   outgoing  (not produced)             was already here → Stable
 *
 * So the correction needs no new state vocabulary, no new colours, and no
 * data migration: it is a pure function of (raw state, slice position) onto
 * the same four states. Every downstream consumer — colouring, ordering,
 * filters, the bar chart, the evolution overview — keeps working unchanged,
 * and now reads a state that is actually observed.
 *
 * This module also names the fourth state. `ntype()` emitted "" (and
 * "neither" in one dataset) for the Stable case while the legend and the
 * bar chart both expect the literal "stable", so Stable rendered as an empty
 * category and those nodes drew unstyled. `normalizeRaw()` repairs that at
 * read time, which means the app is correct against already-built data;
 * `tests/repair_volatility_states.py` writes the same fix into the CSVs and
 * is therefore optional housekeeping rather than a prerequisite.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * `boundaryMode = "raw"` restores the previous behaviour exactly. Raw values
 * are preserved on each record as `rawType`, so anything that needs the
 * as-built value can still reach it.
 *
 * Public API (window.LocalVolatility):
 *   normalizeRaw(t)                → canonical raw state
 *   sliceRole(i, n)                → "first" | "last" | "interior" | "only"
 *   isBoundary(i, n)               → boolean
 *   displayType(rawType, i, n)     → state to encode
 *   applyToRows(rows, i, n)        → normalise CSV rows in place
 *   applyToDict(dict, i, n)        → normalise a {id: rec} map in place
 *   statesFor(i, n)                → states producible at this slice
 *   labelFor(state, i, n)          → legend label, boundary-aware
 *   censorNote(i, n)               → one-line explanation, or ""
 */
(function (global) {
  "use strict";

  /* The corpus contains two spellings of the unnamed fourth state, neither of
     which matches the "stable" the legend and bar chart expect. */
  var UNNAMED = { "": 1, "neither": 1, "none": 1, "null": 1, "nan": 1, "undefined": 1 };

  /* At a boundary the forced half is discarded and the observed half decides
     the state. Anything not listed passes through untouched. */
  var BOUNDARY_MAP = {
    first: { outandin: "outgoing", incoming: "stable" },
    last:  { outandin: "incoming", outgoing: "stable" }
  };

  var LABELS = {
    interior: {
      incoming: "Incoming", outgoing: "Outgoing",
      outandin: "Transient", stable: "Stable"
    },
    first: { outgoing: "Leaves after this slice", stable: "Continues" },
    last:  { incoming: "New in this slice",       stable: "Was already here" }
  };

  var LV = {
    /* "observed" encodes the observed half at boundary slices (default).
       "raw" reproduces the pre-fix behaviour byte for byte. */
    boundaryMode: "observed",

    normalizeRaw: function (t) {
      var s = (t === null || t === undefined) ? "" : String(t).trim().toLowerCase();
      return UNNAMED[s] ? "stable" : s;
    },

    sliceRole: function (i, n) {
      if (!(n > 1)) return "only";          // nothing is observable either side
      if (i === 0) return "first";
      if (i === n - 1) return "last";
      return "interior";
    },

    isBoundary: function (i, n) {
      var r = this.sliceRole(i, n);
      return r === "first" || r === "last" || r === "only";
    },

    displayType: function (rawType, i, n) {
      var raw = this.normalizeRaw(rawType);
      if (this.boundaryMode !== "observed") return raw;
      var map = BOUNDARY_MAP[this.sliceRole(i, n)];
      return (map && map[raw]) ? map[raw] : raw;
    },

    /* Normalise d3.csv rows in place, keeping the as-built value on rawType. */
    applyToRows: function (rows, i, n) {
      if (!rows || !rows.length) return rows;
      for (var k = 0; k < rows.length; k++) {
        var r = rows[k];
        if (r.rawType === undefined) r.rawType = r.type;
        r.type = this.displayType(r.rawType, i, n);
      }
      return rows;
    },

    /* Same, for the { nodeId: record } maps the widgets consume. */
    applyToDict: function (dict, i, n) {
      if (!dict) return dict;
      var keys = Object.keys(dict);
      for (var k = 0; k < keys.length; k++) {
        var rec = dict[keys[k]];
        if (!rec) continue;
        if (rec.rawType === undefined) rec.rawType = rec.type;
        rec.type = this.displayType(rec.rawType, i, n);
      }
      return dict;
    },

    /* Which states this slice can actually produce — drives the legend so it
       never advertises a category the slice cannot contain. */
    statesFor: function (i, n) {
      if (this.boundaryMode !== "observed") {
        return ["incoming", "outgoing", "outandin", "stable"];
      }
      var role = this.sliceRole(i, n);
      if (role === "first") return ["outgoing", "stable"];
      if (role === "last")  return ["incoming", "stable"];
      if (role === "only")  return ["stable"];
      return ["incoming", "outgoing", "outandin", "stable"];
    },

    labelFor: function (state, i, n) {
      if (this.boundaryMode === "observed") {
        var role = this.sliceRole(i, n);
        if (LABELS[role] && LABELS[role][state]) return LABELS[role][state];
      }
      return LABELS.interior[state] || state;
    },

    censorNote: function (i, n) {
      if (this.boundaryMode !== "observed") return "";
      switch (this.sliceRole(i, n)) {
        case "first":
          return "First slice: no earlier slice, so arrivals cannot be observed here. " +
                 "Colour shows only whether a node leaves.";
        case "last":
          return "Last slice: the data ends here, so departures cannot be observed. " +
                 "Colour shows only whether a node is new.";
        case "only":
          return "Single slice: neither side of the window is observable.";
        default:
          return "";
      }
    }
  };

  global.LocalVolatility = LV;
})(window);
