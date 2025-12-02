#!/usr/bin/env python3
"""
use_log_hybrid.py

Implements "Incremental Accretion" sorting.
- T1 establishes the Core (Ranks 0.0 - 1.0).
- T2 establishes the Second Wave (Rank 1.1).
- T3 establishes the Third Wave (Rank 1.2).

Result: The spiral becomes a chronological timeline. 
Old communities stay central; new ones accrete on the periphery.

Usage:
  python use_log_hybrid.py /path/to/data --t1 "2005-2007" --alpha 0.7
"""

import argparse
from pathlib import Path
import pandas as pd
import sys
import numpy as np

NODE_FILENAME = "facebook_data_transformed_new.csv"
COUNTS_FILENAME = "commuity_count.csv"

# How much "distance" to add for each new time slice layer
# 0.1 means T2 is 1.1, T3 is 1.2, etc.
TIME_SLICE_GAP = 0.1

def load_node_map(slice_dir: Path):
    """Returns dict: {node_id: community_id}"""
    csv_path = slice_dir / NODE_FILENAME
    if not csv_path.exists(): return None
    try:
        df = pd.read_csv(csv_path)
        df.columns = [c.strip() for c in df.columns]
        comm_col = 'community' if 'community' in df.columns else 'Community'
        return dict(zip(df['node'], df[comm_col]))
    except Exception as e:
        print(f"❌ Error reading {slice_dir.name}: {e}")
        return None

def run_incremental_sort(root_dir: Path, t1_name: str, alpha: float):
    if not root_dir.is_dir(): return

    # 1. Initialize the Knowledge Base with T1
    t1_dir = root_dir / t1_name
    if not t1_dir.exists(): return

    print(f"📍 Initializing Core from {t1_name}...")
    
    # Sort T1 by size (Ground Truth)
    t1_counts_path = t1_dir / COUNTS_FILENAME
    df_t1 = pd.read_csv(t1_counts_path).sort_values(by="count", ascending=True)
    df_t1.to_csv(t1_counts_path, index=False) # Save the perfect sort

    # Map T1 communities to 0.0 -> 1.0
    total_comms = len(df_t1)
    comm_rank_map = {
        row.community: (idx / max(1, total_comms - 1)) 
        for idx, row in enumerate(df_t1.itertuples())
    }

    # The Persistent Node Database
    # stores { node_id : rank_score }
    node_db = {}
    t1_nodes = load_node_map(t1_dir)
    if t1_nodes:
        for node, comm in t1_nodes.items():
            node_db[node] = comm_rank_map.get(comm, 1.0)

    # The "Wave Pointer" - starts after 1.0
    current_wave_rank = 1.0 + TIME_SLICE_GAP

    # 2. Process Time Slices Chronologically
    # We MUST sort the folders to ensure time progression
    sorted_slices = sorted([d for d in root_dir.iterdir() if d.is_dir()])

    for slice_dir in sorted_slices:
        counts_path = slice_dir / COUNTS_FILENAME
        if not counts_path.exists(): continue

        # Skip re-processing T1
        if slice_dir.name == t1_name: continue

        # Load nodes for this slice
        curr_nodes = load_node_map(slice_dir)
        if not curr_nodes: continue

        # A. LEARN NEW NODES
        # If a node is seen for the first time, assign it the current_wave_rank
        new_node_count = 0
        for node in curr_nodes:
            if node not in node_db:
                node_db[node] = current_wave_rank
                new_node_count += 1
        
        if new_node_count > 0:
            print(f"   -> {slice_dir.name}: Discovered {new_node_count} new nodes (Rank {current_wave_rank:.2f})")

        # B. CALCULATE COMMUNITY SCORES
        # Score = Average Rank of its members
        comm_history_vals = {}
        for node, comm in curr_nodes.items():
            if comm not in comm_history_vals: comm_history_vals[comm] = []
            # Look up rank (every node is now guaranteed to be in node_db)
            comm_history_vals[comm].append(node_db[node])
        
        comm_barycenter = {c: np.mean(v) for c, v in comm_history_vals.items()}

        # C. HYBRID SORT (Size + History)
        df = pd.read_csv(counts_path)
        max_log_size = np.log(df['count'].max()) if df['count'].max() > 0 else 1
        
        def get_score(row):
            size_part = np.log(row['count']) / max_log_size if row['count'] > 0 else 0
            # Default to current wave if community is ghost/empty
            hist_part = comm_barycenter.get(row['community'], current_wave_rank)
            
            # If Alpha is 0.7, Visibility is 70%, History is 30%
            return (alpha * size_part) + ((1 - alpha) * hist_part)

        df['sort_score'] = df.apply(get_score, axis=1)
        df_sorted = df.sort_values(by=['sort_score'], ascending=True)
        df_sorted.drop(columns=['sort_score'], inplace=True)
        df_sorted.to_csv(counts_path, index=False)

        # D. ADVANCE TIME
        # Increment the rank for the NEXT slice's newcomers
        current_wave_rank += TIME_SLICE_GAP
        
        print(f"✓ {slice_dir.name} processed.")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("dataset_dir", type=Path)
    p.add_argument("--t1", type=str, required=True, help="Name of T1 folder")
    p.add_argument("--alpha", type=float, default=0.6)
    args = p.parse_args()
    
    run_incremental_sort(args.dataset_dir, args.t1, args.alpha)

if __name__ == "__main__":
    main()