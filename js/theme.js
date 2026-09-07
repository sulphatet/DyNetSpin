/* ─────────────────────────────────────────────────────────────────────────
   DyNetSpin — shared design tokens for JavaScript
   Single source of truth for the categorical temporal-state colours.
   These MUST stay in sync with the CSS custom properties in
   css/design-system.css (--state-*). Loaded before all other app scripts.

   Palette: Okabe–Ito (colour-blind safe). Saturated hues are reserved for
   the volatile states so that change reads as salient against the muted,
   neutral "Stable" core.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  const STATE_COLORS = {
    incoming: "#0072B2", // blue   — new arrival this slice
    outgoing: "#E69F00", // orange — present now, gone next slice
    both:     "#CC79A7", // purple — appears & disappears within one slice
    stable:   "#8C8C8C", // gray   — persistent core
  };

  // Map a node/edge `type` string to its state colour.
  function stateColor(type) {
    switch (type) {
      case "incoming": return STATE_COLORS.incoming;
      case "outgoing": return STATE_COLORS.outgoing;
      case "outandin": return STATE_COLORS.both;
      default:         return STATE_COLORS.stable; // "neither"/"none"/stable
    }
  }

  // Human labels for the four states (used by the legend).
  const STATE_LABELS = {
    incoming: "Incoming",
    outgoing: "Outgoing",
    both:     "Transient",
    stable:   "Stable",
  };

  window.STATE_COLORS = STATE_COLORS;
  window.STATE_LABELS = STATE_LABELS;
  window.stateColor = stateColor;
})();
