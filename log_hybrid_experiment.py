"""
log_hybrid_proof_final.py

Quantitative Proof.
Configured for: "Big Communities at Periphery" (High Rank).

1. Radial Monotonicity (Spearman's Rho): 
   Target: POSITIVE correlation (Size increases -> Rank increases).
2. Temporal Stability (Kendall's Tau): 
   Target: POSITIVE correlation (Rank_t similar to Rank_t-1).
"""

import argparse
import os
import math
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from collections import defaultdict
from pathlib import Path
from scipy.stats import spearmanr, kendalltau

# ---------------------- Data Loading ----------------------
def load_real_world_data(root_dir):
    root = Path(root_dir)
    if not root.exists():
        sys.exit(f"Error: Data directory '{root_dir}' not found.")
        
    slice_dirs = sorted([d for d in root.iterdir() if d.is_dir()])
    if not slice_dirs:
        sys.exit(f"Error: No subdirectories found in '{root_dir}'. Run build_reddit_spinetrix.py first.")

    print(f"📂 Found {len(slice_dirs)} slices: {[d.name for d in slice_dirs]}")

    counts = []
    node_maps = []

    for s_dir in slice_dirs:
        count_path = s_dir / "commuity_count.csv"
        node_path = s_dir / "facebook_data_transformed_new.csv"
        
        if not count_path.exists() or not node_path.exists():
            continue
            
        df_c = pd.read_csv(count_path)
        if 'Community' in df_c.columns: df_c.rename(columns={'Community': 'community'}, inplace=True)
        if 'Count' in df_c.columns: df_c.rename(columns={'Count': 'count'}, inplace=True)
        counts.append(df_c)

        df_n = pd.read_csv(node_path)
        c_col = 'community' if 'community' in df_n.columns else 'Community'
        n_col = 'node' if 'node' in df_n.columns else 'Id'
        node_maps.append(dict(zip(df_n[n_col], df_n[c_col])))

    return counts, node_maps

# ---------------------- Algorithm ----------------------
def incremental_log_hybrid_sort(counts, node_maps, alpha=0.6, time_slice_gap=0.1):
    num_slices = len(counts)
    
    # Init T1
    # Standard: Sort by Size ASCENDING. 
    # Smallest (0) -> Rank 0 (Center)
    # Largest (N) -> Rank N (Periphery)
    df_t1 = counts[0].copy().sort_values(by='count', ascending=True).reset_index(drop=True)
    total_comms = len(df_t1)
    comm_rank_map = {row.community: idx / max(1, total_comms-1) for idx, row in enumerate(df_t1.itertuples())}
            
    node_db = {}
    for node, comm in node_maps[0].items():
        node_db[node] = comm_rank_map.get(comm, 1.0)
        
    current_wave_rank = 1.0 + time_slice_gap
    sorted_counts = [None] * num_slices
    histories = [None] * num_slices
    
    for i in range(num_slices):
        if i == 0:
            sorted_counts[i] = df_t1.copy()
            comm_history_vals = defaultdict(list)
            for node, comm in node_maps[i].items():
                comm_history_vals[comm].append(node_db[node])
            histories[i] = {c: np.mean(v) for c,v in comm_history_vals.items()}
            continue
            
        # 1. Learn
        for node in node_maps[i]:
            if node not in node_db: node_db[node] = current_wave_rank
                
        # 2. History
        comm_history_vals = defaultdict(list)
        for node, comm in node_maps[i].items():
            comm_history_vals[comm].append(node_db[node])
        comm_barycenter = {c: np.mean(v) for c,v in comm_history_vals.items()}
        histories[i] = comm_barycenter
        
        # 3. Hybrid Score
        df = counts[i].copy()
        max_count = df['count'].max() if df['count'].max() > 0 else 1
        max_log_size = math.log(max_count)
        
        def get_score(row):
            # REVERTED: Big Community -> High Count -> High Score (1.0) -> Periphery
            size_part = (math.log(row['count']) / max_log_size) if row['count'] > 0 else 0.0
            
            # History: We generally want newer/accreted things at the periphery too.
            # So High Rank (Periphery) is consistent with High History Score.
            hist_part = comm_barycenter.get(row['community'], current_wave_rank)
            
            return alpha * size_part + (1-alpha) * hist_part
            
        df['sort_score'] = df.apply(get_score, axis=1)
        df_sorted = df.sort_values(by='sort_score', ascending=True).drop(columns=['sort_score']).reset_index(drop=True)
        sorted_counts[i] = df_sorted
        
        # 4. Update Memory
        current_total = len(df_sorted)
        new_comm_ranks = {row.community: idx / max(1, current_total - 1) for idx, row in enumerate(df_sorted.itertuples())}
        for node, comm in node_maps[i].items():
            if comm in new_comm_ranks: node_db[node] = new_comm_ranks[comm]
        
        current_wave_rank += time_slice_gap
        
    return sorted_counts

# ---------------------- Standard Metrics ----------------------
def calc_metrics(sorted_counts_series):
    monotonicity_scores = []
    stability_scores = []
    
    rankings = []
    for df in sorted_counts_series:
        rankings.append({row.community: idx for idx, row in enumerate(df.itertuples())})

    for t, df in enumerate(sorted_counts_series):
        # 1. Radial Monotonicity (Spearman's Rho: Size vs Rank)
        # We want Big Size to have High Rank Index (Periphery).
        # Perfect Monotonicity = Positive Correlation (+1.0)
        sizes = df['count'].values
        ranks = df.index.values 
        
        if len(sizes) > 2:
            corr, _ = spearmanr(sizes, ranks)
            # No sign flip needed. Positive correlation is good.
            monotonicity_scores.append(corr if not np.isnan(corr) else 0)

        # 2. Temporal Stability (Kendall's Tau)
        if t > 0:
            prev_ranks = rankings[t-1]
            curr_ranks = rankings[t]
            common = set(prev_ranks.keys()) & set(curr_ranks.keys())
            if len(common) > 2:
                vec_prev = [prev_ranks[c] for c in common]
                vec_curr = [curr_ranks[c] for c in common]
                corr, _ = kendalltau(vec_prev, vec_curr)
                stability_scores.append(corr if not np.isnan(corr) else 0)
                
    return np.mean(monotonicity_scores), np.mean(stability_scores)

# ---------------------- Main ----------------------
def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data_dir', type=str, default='./data/smallreddit')
    args = p.parse_args()

    print(f"🔄 Loading data from {args.data_dir}...")
    counts, node_maps = load_real_world_data(args.data_dir)
    
    alphas = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    results = []
    
    print("\n🚀 Running Log-Hybrid Sweep...")
    for alpha in alphas:
        if alpha == 0.0: name = "History-Only"
        elif alpha == 1.0: name = "Size-Only"
        else: name = "Log-Hybrid"
        
        print(f"   ... {name} (alpha={alpha})")
        sorted_counts = incremental_log_hybrid_sort(
            counts, node_maps, alpha=alpha, time_slice_gap=0.1
        )
        
        mono, stable = calc_metrics(sorted_counts)
        results.append({'method': name, 'alpha': alpha, 'monotonicity': mono, 'stability': stable})

    df = pd.DataFrame(results)
    print("\nResults:")
    print(df)
    
    plt.figure(figsize=(8, 6))
    
    for _, row in df.iterrows():
        color = 'gray'; marker = 'o'; size = 100; label = None
        if row['alpha'] == 0.0: 
            color = 'red'; marker = 's'; size=150; label='History-Only (High Info, Low Radial Order)'
        elif row['alpha'] == 1.0: 
            color = 'blue'; marker = 's'; size=150; label='Size-Only (Low Info, High Radial Order)'
        else:
            color = 'green'; label='Log-Hybrid' if row['alpha']==0.6 else None
            
        plt.scatter(row['monotonicity'], row['stability'], c=color, s=size, marker=marker, label=label, zorder=10)
        plt.annotate(f"α={row['alpha']}", (row['monotonicity'], row['stability']), xytext=(5,5), textcoords='offset points')

    plt.plot(df['monotonicity'], df['stability'], 'k--', alpha=0.3, zorder=1)
    plt.xlabel("Radial Monotonicity (Spearman's ρ)\n(Big Communities at Periphery) -> Higher is Better")
    plt.ylabel("Temporal Stability (Kendall's τ)\n(Mental Map Preservation) -> Higher is Better")
    plt.title("Trade-off: Radial Order vs. Temporal Stability")
    plt.grid(True, alpha=0.3)
    plt.legend(loc='lower left')
    plt.tight_layout()
    
    plt.savefig(f"{args.data_dir}/eurovis_proof_final.png", dpi=300)
    print(f"\n✅ Plot saved to {args.data_dir}/eurovis_proof_final.png")

if __name__ == '__main__':
    main()