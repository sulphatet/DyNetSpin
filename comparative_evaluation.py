"""
comparative_evaluation.py
=========================
Quantitative comparison of DyNetSpin's Log-Hybrid Spiral Layout
against a Force-Directed baseline (spring_layout with temporal pinning).

Metrics:
  1. Temporal Stability (Kendall's τ on community rank orderings, t vs t+1)
  2. Radial Monotonicity (Spearman's ρ: community size vs radial rank)
  3. Mean Node Displacement (avg Euclidean distance each node moves between t, t+1)
  4. Edge Crossing Ratio (estimated via angular sweep on radial layout)

Baselines:
  A. Size-Only Spiral (α=1.0) — Jindal & Karlapalem [JK23] static ranking
  B. History-Only Spiral (α=0.0) — pure temporal anchoring
  C. Log-Hybrid (α=0.6) — our proposed method
  D. Force-Directed + Temporal Pinning — nx.spring_layout seeded from previous t
  E. Force-Directed (Independent) — nx.spring_layout per slice, no seeding

Datasets: Enron (forensic), UCI (high-churn), Reddit (identity-rich)

Usage:
  python comparative_evaluation.py                  # all datasets
  python comparative_evaluation.py --dataset enron   # single dataset
  python comparative_evaluation.py --save_figures    # save publication-ready plots
"""

import os
import sys
import json
import math
import argparse
import numpy as np
import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
from pathlib import Path
from collections import defaultdict
from scipy.stats import spearmanr, kendalltau

# ──────────────────────────────────────────────────────────────────
# 1. DATA LOADING
# ──────────────────────────────────────────────────────────────────

DATASET_PATHS = {
    'enron':  'data/enron_ipr',
    'uci':    'data/uci_college',
    'reddit': 'data/smallreddit',
}

def load_dataset(root_dir):
    """Load per-slice node data, community counts, and edge lists."""
    root = Path(root_dir)
    if not root.exists():
        print(f"Warning: {root_dir} not found, skipping.")
        return None

    slice_dirs = sorted([d for d in root.iterdir() if d.is_dir()])
    if not slice_dirs:
        return None

    slices = []
    for s_dir in slice_dirs:
        node_path = s_dir / "facebook_data_transformed_new.csv"
        count_path = s_dir / "commuity_count.csv"
        conn_path = s_dir / "connection_list.json"
        edge_path = s_dir / "node_to_node_link_data.csv"

        if not node_path.exists() or not count_path.exists():
            continue

        df_nodes = pd.read_csv(node_path)
        df_counts = pd.read_csv(count_path)

        # Normalise column names
        if 'Community' in df_counts.columns:
            df_counts.rename(columns={'Community': 'community'}, inplace=True)
        if 'Count' in df_counts.columns:
            df_counts.rename(columns={'Count': 'count'}, inplace=True)

        c_col = 'community' if 'community' in df_nodes.columns else 'Community'
        n_col = 'node' if 'node' in df_nodes.columns else 'Id'

        # Build NetworkX graph
        G = nx.Graph()
        for _, row in df_nodes.iterrows():
            G.add_node(int(row[n_col]), community=int(row[c_col]))

        if edge_path.exists():
            try:
                df_edges = pd.read_csv(edge_path)
                for _, e in df_edges.iterrows():
                    s, t = int(e['source']), int(e['target'])
                    if s in G.nodes and t in G.nodes:
                        G.add_edge(s, t)
            except Exception:
                pass
        elif conn_path.exists():
            try:
                with open(conn_path) as f:
                    conns = json.load(f)
                for src, tgts in conns.items():
                    for tgt in tgts:
                        si, ti = int(src), int(tgt)
                        if si in G.nodes and ti in G.nodes:
                            G.add_edge(si, ti)
            except Exception:
                pass

        node_map = dict(zip(df_nodes[n_col].astype(int), df_nodes[c_col].astype(int)))

        slices.append({
            'name': s_dir.name,
            'df_nodes': df_nodes,
            'df_counts': df_counts,
            'node_map': node_map,
            'graph': G,
        })

    return slices


# ──────────────────────────────────────────────────────────────────
# 2. LAYOUT ALGORITHMS
# ──────────────────────────────────────────────────────────────────

def log_hybrid_sort(slices, alpha=0.6, time_gap=0.1):
    """Log-Hybrid Spiral Ranking algorithm. Returns per-slice sorted counts."""
    counts = [s['df_counts'] for s in slices]
    node_maps = [s['node_map'] for s in slices]
    num_slices = len(counts)

    # T1: sort ascending by size
    df_t1 = counts[0].copy().sort_values('count', ascending=True).reset_index(drop=True)
    total_comms = len(df_t1)
    comm_rank = {row.community: idx / max(1, total_comms - 1)
                 for idx, row in enumerate(df_t1.itertuples())}
    node_db = {}
    for node, comm in node_maps[0].items():
        node_db[node] = comm_rank.get(comm, 1.0)

    wave = 1.0 + time_gap
    sorted_all = [df_t1.copy()]

    for i in range(1, num_slices):
        for node in node_maps[i]:
            if node not in node_db:
                node_db[node] = wave

        # barycentre
        comm_hist = defaultdict(list)
        for node, comm in node_maps[i].items():
            comm_hist[comm].append(node_db[node])
        barycenter = {c: np.mean(v) for c, v in comm_hist.items()}

        df = counts[i].copy()
        max_count = max(df['count'].max(), 1)
        max_log = math.log(max_count) if max_count > 1 else 1.0

        def score(row):
            s = (math.log(row['count']) / max_log) if row['count'] > 1 else 0.0
            b = barycenter.get(row['community'], wave)
            return alpha * s + (1 - alpha) * b

        df['_score'] = df.apply(score, axis=1)
        df_s = df.sort_values('_score', ascending=True).drop(columns=['_score']).reset_index(drop=True)
        sorted_all.append(df_s)

        ct = len(df_s)
        new_ranks = {row.community: idx / max(1, ct - 1)
                     for idx, row in enumerate(df_s.itertuples())}
        for node, comm in node_maps[i].items():
            if comm in new_ranks:
                node_db[node] = new_ranks[comm]
        wave += time_gap

    return sorted_all


def compute_spiral_positions(slices, sorted_counts):
    """Compute 2D spiral positions for each node based on sorted community order."""
    all_positions = []
    for t, s in enumerate(slices):
        df = s['df_nodes'].copy()
        c_col = 'community' if 'community' in df.columns else 'Community'
        n_col = 'node' if 'node' in df.columns else 'Id'

        # Community order from sorted counts
        comm_order = list(sorted_counts[t]['community'])
        comm_rank = {c: i for i, c in enumerate(comm_order)}

        # Macro layout: spiral of community centres
        n_comms = len(comm_order)
        max_radius = max(800, n_comms * 120)
        centres = {}
        for i, c in enumerate(comm_order):
            away = (i + 0.5) * (max_radius / max(n_comms, 1))
            theta = (i + 0.5) * (max(1, n_comms / 16.0) / max(n_comms, 1)) * 2 * np.pi
            centres[c] = (np.cos(theta) * away, np.sin(theta) * away)

        # Micro layout: nodes within community
        positions = {}
        for comm, group in df.groupby(c_col):
            cx, cy = centres.get(int(comm), (0, 0))
            n_pts = len(group)
            base_radius = np.sqrt(n_pts) * 25 * 1.5
            for j, (idx, row) in enumerate(group.iterrows()):
                prog = (j + 1) / max(n_pts, 1)
                r = np.sqrt(prog) * base_radius
                coils = max(1, np.ceil(n_pts / 45.0))
                angle = prog * coils * 2 * np.pi
                positions[int(row[n_col])] = (cx + np.cos(angle) * r,
                                               cy + np.sin(angle) * r)
        all_positions.append(positions)
    return all_positions


def compute_force_directed_positions(slices, pinned=True, seed=42, max_nodes_fd=2000):
    """
    Force-directed layout per slice.
    If pinned=True: seed positions from previous slice (temporal pinning).
    If pinned=False: independent layout per slice.
    Returns None if any slice exceeds max_nodes_fd (not scalable).
    """
    # Check scalability — skip FD if dataset exceeds tractable size
    for s in slices:
        if s['graph'].number_of_nodes() > max_nodes_fd:
            return None

    all_positions = []
    prev_pos = None

    for s in slices:
        G = s['graph']
        if G.number_of_nodes() == 0:
            all_positions.append({})
            continue

        # Scale iterations: fewer for larger graphs
        n = G.number_of_nodes()
        iters = max(10, 50 - n // 20)

        if pinned and prev_pos is not None:
            # Seed from previous positions for nodes that persist
            init_pos = {}
            for node in G.nodes():
                if node in prev_pos:
                    init_pos[node] = prev_pos[node]
            if len(init_pos) < len(G.nodes()):
                if init_pos:
                    cx = np.mean([p[0] for p in init_pos.values()])
                    cy = np.mean([p[1] for p in init_pos.values()])
                else:
                    cx, cy = 0.0, 0.0
                rng = np.random.RandomState(seed)
                for node in G.nodes():
                    if node not in init_pos:
                        init_pos[node] = (cx + rng.randn() * 0.1,
                                          cy + rng.randn() * 0.1)
            pos = nx.spring_layout(G, pos=init_pos, seed=seed,
                                   iterations=iters, k=1.0/np.sqrt(max(n, 1)))
        else:
            pos = nx.spring_layout(G, seed=seed, iterations=iters,
                                   k=1.0/np.sqrt(max(n, 1)))

        # Scale positions to comparable range as spiral
        pos = {node: (p[0] * 800.0, p[1] * 800.0) for node, p in pos.items()}

        all_positions.append(pos)
        prev_pos = pos

    return all_positions


# ──────────────────────────────────────────────────────────────────
# 3. METRICS
# ──────────────────────────────────────────────────────────────────

def metric_temporal_stability(sorted_counts_series):
    """Kendall's τ between community rank orderings at consecutive slices."""
    rankings = []
    for df in sorted_counts_series:
        rankings.append({row.community: idx for idx, row in enumerate(df.itertuples())})

    tau_scores = []
    for t in range(1, len(rankings)):
        common = set(rankings[t - 1]) & set(rankings[t])
        if len(common) > 2:
            v_prev = [rankings[t - 1][c] for c in common]
            v_curr = [rankings[t][c] for c in common]
            tau, _ = kendalltau(v_prev, v_curr)
            if not np.isnan(tau):
                tau_scores.append(tau)
    return np.mean(tau_scores) if tau_scores else 0.0


def metric_radial_monotonicity(sorted_counts_series):
    """Spearman's ρ: community size vs rank (higher = big communities at periphery)."""
    rho_scores = []
    for df in sorted_counts_series:
        sizes = df['count'].values
        ranks = np.arange(len(df))
        if len(sizes) > 2:
            rho, _ = spearmanr(sizes, ranks)
            if not np.isnan(rho):
                rho_scores.append(rho)
    return np.mean(rho_scores) if rho_scores else 0.0


def metric_mean_displacement(all_positions):
    """Average Euclidean distance each persisting node moves between consecutive slices."""
    displacements = []
    for t in range(1, len(all_positions)):
        prev_pos = all_positions[t - 1]
        curr_pos = all_positions[t]
        common = set(prev_pos) & set(curr_pos)
        if not common:
            continue
        dists = []
        for n in common:
            dx = curr_pos[n][0] - prev_pos[n][0]
            dy = curr_pos[n][1] - prev_pos[n][1]
            dists.append(np.sqrt(dx * dx + dy * dy))
        displacements.append(np.mean(dists))
    return np.mean(displacements) if displacements else 0.0


def metric_edge_crossings_estimate(positions, graph):
    """
    Estimate edge crossings by counting pairs of edges whose segments intersect.
    For scalability, we sample up to 5000 edge pairs.
    """
    edges = list(graph.edges())
    if len(edges) < 2:
        return 0

    def ccw(A, B, C):
        return (C[1]-A[1]) * (B[0]-A[0]) > (B[1]-A[1]) * (C[0]-A[0])

    def segments_intersect(A, B, C, D):
        return (ccw(A,C,D) != ccw(B,C,D)) and (ccw(A,B,C) != ccw(A,B,D))

    # Filter edges to those with positions
    valid_edges = [(u, v) for u, v in edges if u in positions and v in positions]
    if len(valid_edges) < 2:
        return 0

    # Sample for scalability
    max_pairs = 5000
    n_edges = len(valid_edges)
    total_pairs = n_edges * (n_edges - 1) // 2

    crossings = 0
    checked = 0

    if total_pairs <= max_pairs:
        for i in range(n_edges):
            for j in range(i + 1, n_edges):
                u1, v1 = valid_edges[i]
                u2, v2 = valid_edges[j]
                if len({u1, v1, u2, v2}) < 4:
                    continue
                A, B = positions[u1], positions[v1]
                C, D = positions[u2], positions[v2]
                if segments_intersect(A, B, C, D):
                    crossings += 1
                checked += 1
    else:
        rng = np.random.RandomState(42)
        for _ in range(max_pairs):
            i, j = rng.choice(n_edges, 2, replace=False)
            u1, v1 = valid_edges[i]
            u2, v2 = valid_edges[j]
            if len({u1, v1, u2, v2}) < 4:
                continue
            A, B = positions[u1], positions[v1]
            C, D = positions[u2], positions[v2]
            if segments_intersect(A, B, C, D):
                crossings += 1
            checked += 1
        # Scale estimate
        if checked > 0:
            crossings = int(crossings * (total_pairs / checked))

    return crossings


def metric_avg_edge_crossings(all_positions, slices):
    """Average edge crossings across all time slices."""
    xings = []
    for t, pos in enumerate(all_positions):
        if pos and slices[t]['graph'].number_of_edges() > 0:
            xings.append(metric_edge_crossings_estimate(pos, slices[t]['graph']))
    return np.mean(xings) if xings else 0.0


# ──────────────────────────────────────────────────────────────────
# 4. FULL EVALUATION PIPELINE
# ──────────────────────────────────────────────────────────────────

def evaluate_dataset(dataset_name, slices, save_figures=False, output_dir='.'):
    """Run all methods on one dataset and return results table."""
    print(f"\n{'='*60}")
    print(f"  DATASET: {dataset_name.upper()}")
    print(f"  Slices: {len(slices)}, Nodes: {[s['graph'].number_of_nodes() for s in slices]}")
    print(f"  Edges:  {[s['graph'].number_of_edges() for s in slices]}")
    print(f"{'='*60}")

    results = []

    # ── Method A: Size-Only (α=1.0) — equivalent to Jindal & Karlapalem [JK23]
    print("  [A] Size-Only Spiral (α=1.0) ...")
    sorted_size = log_hybrid_sort(slices, alpha=1.0)
    pos_size = compute_spiral_positions(slices, sorted_size)
    results.append({
        'Method': 'Size-Only Spiral [JK23]',
        'Temporal Stability (τ)': metric_temporal_stability(sorted_size),
        'Radial Monotonicity (ρ)': metric_radial_monotonicity(sorted_size),
        'Mean Displacement': metric_mean_displacement(pos_size),
        'Avg Edge Crossings': metric_avg_edge_crossings(pos_size, slices),
    })

    # ── Method B: History-Only (α=0.0)
    print("  [B] History-Only Spiral (α=0.0) ...")
    sorted_hist = log_hybrid_sort(slices, alpha=0.0)
    pos_hist = compute_spiral_positions(slices, sorted_hist)
    results.append({
        'Method': 'History-Only Spiral',
        'Temporal Stability (τ)': metric_temporal_stability(sorted_hist),
        'Radial Monotonicity (ρ)': metric_radial_monotonicity(sorted_hist),
        'Mean Displacement': metric_mean_displacement(pos_hist),
        'Avg Edge Crossings': metric_avg_edge_crossings(pos_hist, slices),
    })

    # ── Method C: Log-Hybrid (α=0.6) — OURS
    print("  [C] Log-Hybrid Spiral (α=0.6) [OURS] ...")
    sorted_lh = log_hybrid_sort(slices, alpha=0.6)
    pos_lh = compute_spiral_positions(slices, sorted_lh)
    results.append({
        'Method': 'Log-Hybrid (α=0.6) [Ours]',
        'Temporal Stability (τ)': metric_temporal_stability(sorted_lh),
        'Radial Monotonicity (ρ)': metric_radial_monotonicity(sorted_lh),
        'Mean Displacement': metric_mean_displacement(pos_lh),
        'Avg Edge Crossings': metric_avg_edge_crossings(pos_lh, slices),
    })

    # ── Method D: Force-Directed + Temporal Pinning
    print("  [D] Force-Directed + Temporal Pinning ...")
    pos_fd_pin = compute_force_directed_positions(slices, pinned=True)
    if pos_fd_pin is None:
        print("      → Skipped: graph too large for force-directed (>2000 nodes/slice).")
        results.append({
            'Method': 'Force-Directed + Pinning',
            'Temporal Stability (τ)': float('nan'),
            'Radial Monotonicity (ρ)': float('nan'),
            'Mean Displacement': float('nan'),
            'Avg Edge Crossings': float('nan'),
        })
    else:
        sorted_fd_pin = _rank_communities_by_centroid(slices, pos_fd_pin)
        results.append({
            'Method': 'Force-Directed + Pinning',
            'Temporal Stability (τ)': metric_temporal_stability(sorted_fd_pin),
            'Radial Monotonicity (ρ)': metric_radial_monotonicity(sorted_fd_pin),
            'Mean Displacement': metric_mean_displacement(pos_fd_pin),
            'Avg Edge Crossings': metric_avg_edge_crossings(pos_fd_pin, slices),
        })

    # ── Method E: Force-Directed Independent (no pinning)
    print("  [E] Force-Directed Independent ...")
    pos_fd_ind = compute_force_directed_positions(slices, pinned=False)
    if pos_fd_ind is None:
        print("      → Skipped: graph too large for force-directed (>2000 nodes/slice).")
        results.append({
            'Method': 'Force-Directed (Independent)',
            'Temporal Stability (τ)': float('nan'),
            'Radial Monotonicity (ρ)': float('nan'),
            'Mean Displacement': float('nan'),
            'Avg Edge Crossings': float('nan'),
        })
    else:
        sorted_fd_ind = _rank_communities_by_centroid(slices, pos_fd_ind)
        results.append({
            'Method': 'Force-Directed (Independent)',
            'Temporal Stability (τ)': metric_temporal_stability(sorted_fd_ind),
            'Radial Monotonicity (ρ)': metric_radial_monotonicity(sorted_fd_ind),
            'Mean Displacement': metric_mean_displacement(pos_fd_ind),
            'Avg Edge Crossings': metric_avg_edge_crossings(pos_fd_ind, slices),
        })

    df_results = pd.DataFrame(results)

    # Normalise displacement to [0, 1] for comparability (ignoring NaN rows)
    max_disp = df_results['Mean Displacement'].max(skipna=True)
    if max_disp > 0:
        df_results['Normalised Displacement'] = df_results['Mean Displacement'] / max_disp
    else:
        df_results['Normalised Displacement'] = 0.0

    print(f"\n  Results for {dataset_name.upper()}:")
    print(df_results.to_string(index=False, float_format='%.3f'))

    # ── Generate comparison figure
    if save_figures:
        _plot_comparison(df_results, dataset_name, output_dir)

    return df_results


def _rank_communities_by_centroid(slices, all_positions):
    """
    For force-directed layouts, rank communities by their centroid distance
    from origin (to make them comparable to spiral radial ranking).
    """
    sorted_counts_list = []
    for t, s in enumerate(slices):
        pos = all_positions[t]
        c_col = 'community' if 'community' in s['df_nodes'].columns else 'Community'
        n_col = 'node' if 'node' in s['df_nodes'].columns else 'Id'

        # Compute community centroids
        comm_centroids = defaultdict(list)
        for _, row in s['df_nodes'].iterrows():
            nid = int(row[n_col])
            comm = int(row[c_col])
            if nid in pos:
                comm_centroids[comm].append(pos[nid])

        # Rank by distance from origin
        comm_dist = {}
        for c, pts in comm_centroids.items():
            cx = np.mean([p[0] for p in pts])
            cy = np.mean([p[1] for p in pts])
            comm_dist[c] = np.sqrt(cx**2 + cy**2)

        df_c = s['df_counts'].copy()
        df_c['_dist'] = df_c['community'].map(comm_dist).fillna(0)
        df_c = df_c.sort_values('_dist', ascending=True).drop(columns=['_dist']).reset_index(drop=True)
        sorted_counts_list.append(df_c)

    return sorted_counts_list


def _plot_comparison(df_results, dataset_name, output_dir):
    """Generate a publication-ready comparison bar chart."""
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.5))

    methods = df_results['Method'].values
    x = np.arange(len(methods))
    colors = ['#377eb8', '#984ea3', '#e41a1c', '#ff7f00', '#999999']

    # Panel 1: Stability (τ)
    ax = axes[0]
    vals = df_results['Temporal Stability (τ)'].values
    bars = ax.bar(x, vals, color=colors, edgecolor='black', linewidth=0.5)
    ax.set_ylabel("Kendall's τ (higher = more stable)")
    ax.set_title("Temporal Stability")
    ax.set_xticks(x)
    ax.set_xticklabels(methods, rotation=35, ha='right', fontsize=7)
    ax.set_ylim(min(0, vals.min() - 0.1), 1.05)
    ax.axhline(y=0, color='gray', linewidth=0.5)

    # Panel 2: Radial Monotonicity (ρ)
    ax = axes[1]
    vals = df_results['Radial Monotonicity (ρ)'].values
    ax.bar(x, vals, color=colors, edgecolor='black', linewidth=0.5)
    ax.set_ylabel("Spearman's ρ (higher = better occlusion)")
    ax.set_title("Radial Monotonicity")
    ax.set_xticks(x)
    ax.set_xticklabels(methods, rotation=35, ha='right', fontsize=7)
    ax.set_ylim(min(0, vals.min() - 0.1), 1.05)

    # Panel 3: Normalised Displacement
    ax = axes[2]
    vals = df_results['Normalised Displacement'].values
    ax.bar(x, vals, color=colors, edgecolor='black', linewidth=0.5)
    ax.set_ylabel("Normalised Displacement (lower = more stable)")
    ax.set_title("Mean Node Displacement")
    ax.set_xticks(x)
    ax.set_xticklabels(methods, rotation=35, ha='right', fontsize=7)
    ax.set_ylim(0, 1.15)

    plt.suptitle(f"Comparative Evaluation — {dataset_name.upper()} Dataset",
                 fontsize=12, fontweight='bold')
    plt.tight_layout(rect=[0, 0, 1, 0.93])

    out_path = os.path.join(output_dir, f"comparison_{dataset_name}.pdf")
    plt.savefig(out_path, dpi=300, bbox_inches='tight')
    out_path_png = os.path.join(output_dir, f"comparison_{dataset_name}.png")
    plt.savefig(out_path_png, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"  Figure saved: {out_path}")


def generate_latex_table(all_results, output_path):
    """Generate a LaTeX table combining all dataset results."""
    with open(output_path, 'w') as f:
        f.write(r"""% Auto-generated comparison table
\begin{table}[t]
  \centering
  \caption{Quantitative comparison of layout strategies across three datasets.
    \textbf{Bold} indicates best per column. $\tau$: Kendall's temporal stability
    (higher = better mental map). $\rho$: Spearman's radial monotonicity
    (higher = better occlusion avoidance). $\Delta$: mean node displacement
    between consecutive slices (lower = better spatial stability).}
  \label{tab:comparison}
  \resizebox{\columnwidth}{!}{%
  \begin{tabular}{l|ccc|ccc|ccc}
    \toprule
    & \multicolumn{3}{c|}{\textbf{Enron}} & \multicolumn{3}{c|}{\textbf{UCI}} & \multicolumn{3}{c}{\textbf{Reddit}} \\
    \textbf{Method} & $\tau$ & $\rho$ & $\Delta$ & $\tau$ & $\rho$ & $\Delta$ & $\tau$ & $\rho$ & $\Delta$ \\
    \midrule
""")
        # Collect results
        datasets_order = ['enron', 'uci', 'reddit']
        methods_order = [
            'Size-Only Spiral [JK23]',
            'History-Only Spiral',
            'Log-Hybrid (α=0.6) [Ours]',
            'Force-Directed + Pinning',
            'Force-Directed (Independent)',
        ]

        for method in methods_order:
            line = f"    {method}"
            for ds in datasets_order:
                if ds in all_results:
                    df = all_results[ds]
                    row = df[df['Method'] == method]
                    if not row.empty:
                        tau = row['Temporal Stability (τ)'].values[0]
                        rho = row['Radial Monotonicity (ρ)'].values[0]
                        disp = row['Normalised Displacement'].values[0]
                        fmt_val = lambda v: f"{v:.3f}" if not (isinstance(v, float) and np.isnan(v)) else r"\na{}"
                        line += f" & {fmt_val(tau)} & {fmt_val(rho)} & {fmt_val(disp)}"
                    else:
                        line += " & -- & -- & --"
                else:
                    line += " & -- & -- & --"
            line += r" \\"
            f.write(line + "\n")

        f.write(r"""    \bottomrule
  \end{tabular}}
\end{table}
""")
    print(f"\nLaTeX table saved: {output_path}")


# ──────────────────────────────────────────────────────────────────
# 5. MAIN
# ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Comparative Layout Evaluation")
    parser.add_argument('--dataset', type=str, default='all',
                        choices=['all', 'enron', 'uci', 'reddit'],
                        help='Which dataset to evaluate')
    parser.add_argument('--save_figures', action='store_true',
                        help='Save publication-ready comparison plots')
    parser.add_argument('--output_dir', type=str, default='evaluation_results',
                        help='Directory for output files')
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    datasets_to_run = list(DATASET_PATHS.keys()) if args.dataset == 'all' else [args.dataset]
    all_results = {}

    for ds_name in datasets_to_run:
        ds_path = DATASET_PATHS[ds_name]
        slices = load_dataset(ds_path)
        if slices is None or len(slices) < 2:
            print(f"\nSkipping {ds_name}: insufficient data.")
            continue
        df_res = evaluate_dataset(ds_name, slices,
                                  save_figures=args.save_figures,
                                  output_dir=args.output_dir)
        all_results[ds_name] = df_res

    # Summary table
    if all_results:
        print("\n" + "=" * 60)
        print("  SUMMARY")
        print("=" * 60)
        for ds, df in all_results.items():
            print(f"\n  {ds.upper()}:")
            print(df[['Method', 'Temporal Stability (τ)', 'Radial Monotonicity (ρ)',
                       'Normalised Displacement']].to_string(index=False, float_format='%.3f'))

        # Generate LaTeX table
        generate_latex_table(all_results,
                             os.path.join(args.output_dir, 'comparison_table.tex'))

    print("\nDone.")


if __name__ == '__main__':
    main()
