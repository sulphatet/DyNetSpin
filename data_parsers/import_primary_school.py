#!/usr/bin/env python3
"""
import_primary_school.py
-------------------------
ACADEMICALLY GROUNDED EDITION (Visual Complexity Balancing)

1. Reads Raw CSV.
2. Slices data based on EVENT DENSITY (edges per slice), not fixed time.
   - High activity = High temporal resolution (short time window).
   - Low activity = Low temporal resolution (long time window).
3. Aggregates these density-blocks into Epochs.
4. Generates standard SpinTrix files.

Usage:
  python3 import_primary_school.py
"""

import os
import json
import shutil
import pandas as pd
import networkx as nx
import community.community_louvain as community_louvain
from pathlib import Path

# --- CONFIGURATION ---
INPUT_CSV  = Path("data/primary_school/primaryschool.csv")
OUTPUT_DIR = Path("data/primary_school")

# ACADEMIC TUNING:
# Total edges ~125,000. 
# 3,000 edges/slice => ~42 slices total.
# This ensures every slice has enough data to form a meaningful structure.
EDGES_PER_SLICE = 3000 

# Group N density slices into one Parent Epoch
EPOCH_GROUP_SIZE = 10 

def safe_mkdir(p):
    p.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------
# 1. HELPER: Semantic Time Formatter
# ------------------------------------------------------------------
def format_time_label(seconds_from_start):
    """
    Converts raw timestamp (seconds from 00:00 Day 1) to "Day X HH:MM"
    """
    day = 1
    if seconds_from_start > 86400: # Next day? (Though dataset is usually 8am-5pm)
        # Primary school timestamps often run 8:30 (30600) to 17:00 (61200)
        # If the dataset uses continuous seconds across days, we adjust.
        # But SocioPatterns usually resets or uses large integers.
        # Let's assume standard HH:MM conversion first.
        pass
        
    # Heuristic: timestamps in this dataset usually start around 31220 (8:40 AM)
    # If t > 24 hours (86400), it's day 2.
    if seconds_from_start > 90000: # Arbitrary cutoff for Day 2 in seconds
        day = 2
        seconds_from_start -= 86400 # Subtract 24h roughly if needed, or just use mod
    elif seconds_from_start < 20000: # Early morning reset?
        day = 2 # Sometimes Day 2 starts at 0 again depending on CSV format
    
    # Just format HH:MM
    # Note: If your CSV has Day 2 starting at "Large Number", this works.
    # If Day 2 restarts at 0, we need to track index. 
    # We will rely on the raw value for HH:MM.
    
    # SocioPatterns Primary School logic:
    # Day 1: ~31220 to ~63000
    # Day 2: ~117000 to ...
    
    t = int(seconds_from_start)
    if t > 100000: 
        day = 2
        t = t - 86400 # Adjust for readability if it's cumulative
    
    hours = (t // 3600) % 24
    mins = (t % 3600) // 60
    return f"Day {day} {hours:02d}:{mins:02d}"

# ------------------------------------------------------------------
# 2. CORE EXPORT FUNCTION
# ------------------------------------------------------------------
def build_and_export_slice(df, output_dir, label, name_map):
    safe_mkdir(output_dir)
    
    # --- A. Build Graph ---
    G = nx.Graph()
    edge_counts = df.groupby(['source', 'target']).size().reset_index(name='weight')
    for _, row in edge_counts.iterrows():
        G.add_edge(int(row['source']), int(row['target']), weight=row['weight'])
        
    if len(G) == 0: return

    # --- B. Communities ---
    partition = community_louvain.best_partition(G, weight='weight', random_state=42)
    degree = dict(G.degree(weight='weight'))
    
    # --- C. Density ---
    comm_nodes = {}
    for n, c in partition.items():
        comm_nodes.setdefault(c, []).append(n)
        
    comm_stats = {}
    for c, nodes in comm_nodes.items():
        sub = G.subgraph(nodes)
        possible = len(nodes)*(len(nodes)-1)/2
        actual = sub.number_of_edges()
        comm_stats[c] = actual/possible if possible>0 else 0

    # --- D. Nodes ---
    node_rows = []
    for n in G.nodes():
        cid = partition[n]
        node_rows.append({
            "node": n,
            "centrality": degree.get(n, 0),
            "community": cid,
            "density": comm_stats.get(cid, 0),
            "name": name_map.get(n, f"{n}"),
            "type": "", 
            "betwness": 0, "closeness": 0, "eign": 0, "volatility": 0
        })
    pd.DataFrame(node_rows).to_csv(output_dir / "facebook_data_transformed_new.csv", index=False)

    # --- E. Edges ---
    edge_rows = [{"source": u, "target": v, "type": ""} for u, v in G.edges()]
    pd.DataFrame(edge_rows).to_csv(output_dir / "node_to_node_link_data.csv", index=False)

    # --- F. Coarse Graph ---
    coarse_G = nx.Graph()
    for u, v, d in G.edges(data=True):
        c1, c2 = partition[u], partition[v]
        if c1 != c2:
            w = d['weight']
            if coarse_G.has_edge(c1, c2): coarse_G[c1][c2]['weight'] += w
            else: coarse_G.add_edge(c1, c2, weight=w)
    
    coarse_rows = [{"source": u, "target": v, "weight": d['weight']} for u,v,d in coarse_G.edges(data=True)]
    pd.DataFrame(coarse_rows).to_csv(output_dir / "link_data.csv", index=False)
    
    if len(coarse_G) > 0:
        pos = nx.spring_layout(coarse_G, seed=42, weight='weight')
        pos_rows = [{"node": c, "x_pos": p[0], "y_pos": p[1]} for c, p in pos.items()]
    else:
        pos_rows = [{"node": c, "x_pos": 0, "y_pos": 0} for c in comm_nodes]
    pd.DataFrame(pos_rows).to_csv(output_dir / "coarse_graph_pos.csv", index=False)

    # --- G. Helpers ---
    conn = {int(n): [int(x) for x in G.neighbors(n)] for n in G.nodes()}
    (output_dir / "connection_list.json").write_text(json.dumps(conn))
    (output_dir / "new_extent_without_outliers_for_colorcoding.json").write_text(json.dumps({
        "degree_range": [1.0, 20.0], "closeness_range": [0.0, 1.0], 
        "betwness_range": [0.0, 0.1], "eign_range": [0.0, 1.0], 
        "volatility_range": [0.0, 5.0]
    }))
    
    # --- H. Stats ---
    pd.DataFrame([{"community": c, "count": len(ns)} for c, ns in comm_nodes.items()]) \
      .to_csv(output_dir / "commuity_count.csv", index=False)
    for f in ["commuity_density.csv", "commuity_h_degree.csv", "heatmap_data.csv"]:
        pd.DataFrame(columns=["a","b"]).to_csv(output_dir / f, index=False)

# ------------------------------------------------------------------
# 3. VOLATILITY & SORTING HELPERS
# ------------------------------------------------------------------
def calculate_temporal_volatility(slice_dir_list):
    print(f"   ⚡ Calculating volatility for {len(slice_dir_list)} sequential slices...")
    slice_edges = [] 
    for d in slice_dir_list:
        try:
            df = pd.read_csv(d / "node_to_node_link_data.csv")
            edge_set = {frozenset((r['source'], r['target'])) for _, r in df.iterrows()}
            slice_edges.append({'dir': d, 'edges': edge_set, 'df': df})
        except:
            slice_edges.append({'dir': d, 'edges': set(), 'df': pd.DataFrame()})

    for i in range(len(slice_edges)):
        curr = slice_edges[i]
        prev_set = slice_edges[i-1]['edges'] if i > 0 else set()
        next_set = slice_edges[i+1]['edges'] if i < len(slice_edges)-1 else set()
        
        types = []
        for _, row in curr['df'].iterrows():
            e = frozenset((row['source'], row['target']))
            is_inc = e not in prev_set
            is_out = e not in next_set
            if is_inc and is_out: t = "outandin"
            elif is_inc: t = "incoming"
            elif is_out: t = "outgoing"
            else: t = "" 
            types.append(t)
        curr['df']['type'] = types
        curr['df'].to_csv(curr['dir'] / "node_to_node_link_data.csv", index=False)

def sort_community_counts(root_dir):
    print("   📊 Sorting community counts...")
    for slice_dir in root_dir.iterdir():
        if not slice_dir.is_dir(): continue
        csv_path = slice_dir / "commuity_count.csv"
        if csv_path.exists():
            try:
                df = pd.read_csv(csv_path)
                if "count" in df.columns:
                    df.sort_values("count", ascending=True).to_csv(csv_path, index=False)
            except: pass

# ------------------------------------------------------------------
# 4. MAIN EXECUTION
# ------------------------------------------------------------------
def main():
    if not INPUT_CSV.exists():
        print(f"❌ Error: {INPUT_CSV} not found.")
        return

    print(f"🧹 Cleaning output directory: {OUTPUT_DIR}")
    if OUTPUT_DIR.exists():
        for item in OUTPUT_DIR.iterdir():
            if item.is_dir(): shutil.rmtree(item)
    else:
        safe_mkdir(OUTPUT_DIR)

    print("📖 Reading Primary School Data...")
    try:
        # Load and sort by time
        df = pd.read_csv(INPUT_CSV, sep=None, engine='python', header=None, 
                         names=['time', 'source', 'target', 'class_u', 'class_v'])
        df = df.sort_values('time').reset_index(drop=True)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    # Name Map
    name_map = {}
    for _, row in df.iterrows():
        name_map[int(row['source'])] = f"{row['source']} ({row['class_u']})"
        name_map[int(row['target'])] = f"{row['target']} ({row['class_v']})"

    # --- DENSITY SLICING (The Academic Pivot) ---
    print(f"🔪 Slicing by VISUAL COMPLEXITY ({EDGES_PER_SLICE} edges/slice)...")
    
    # 1. Create Bins by Index (Density)
    df['bin'] = df.index // EDGES_PER_SLICE
    unique_bins = sorted(df['bin'].unique())
    
    base_slices_info = [] 
    
    for b in unique_bins:
        subset = df[df['bin'] == b][['source', 'target', 'time']]
        
        # 2. Generate Semantic Label from Actual Time Range
        start_ts = subset['time'].min()
        end_ts = subset['time'].max()
        
        start_str = format_time_label(start_ts)
        end_str = format_time_label(end_ts).split(" ")[-1] # Just HH:MM for end
        
        # Label: "Day 1 09:30-10:15"
        label = f"{start_str}-{end_str}"
        safe_dirname = f"t{b:02d}"
        path = OUTPUT_DIR / safe_dirname
        
        if not subset.empty:
            build_and_export_slice(subset, path, label, name_map)
            base_slices_info.append({
                'label': label, 
                'dir': safe_dirname, 
                'df': subset, 
                'path': path,
                'start_ts': start_ts
            })
            print(f"   - Slice {b}: {label} ({len(subset)} edges)")

    # --- AGGREGATION (EPOCHS) ---
    print(f"🌳 Generating Epoch Aggregates (Grouping {EPOCH_GROUP_SIZE} slices)...")
    json_slices_output = []
    epoch_paths_info = [] 
    
    for i in range(0, len(base_slices_info), EPOCH_GROUP_SIZE):
        chunk = base_slices_info[i : i + EPOCH_GROUP_SIZE]
        if not chunk: continue
        
        # Get Time Range for Epoch
        start_label = chunk[0]['label'].split("-")[0].strip() # "Day 1 08:30"
        end_label = chunk[-1]['label'].split("-")[-1].strip() # "10:15"
        
        epoch_idx = i // EPOCH_GROUP_SIZE + 1
        epoch_label = f"Epoch {epoch_idx} ({start_label}-{end_label})"
        epoch_dir = f"Epoch_{epoch_idx}"
        epoch_path = OUTPUT_DIR / epoch_dir
        
        combined_df = pd.concat([c['df'] for c in chunk])
        build_and_export_slice(combined_df, epoch_path, epoch_label, name_map)
        
        epoch_paths_info.append({'path': epoch_path})
        
        json_slices_output.append({
            "label": epoch_label,
            "dir": epoch_dir,
            "children": [{"label": c['label'], "dir": c['dir']} for c in chunk]
        })

    # --- INTEGRATION & CLEANUP ---
    calculate_temporal_volatility([x['path'] for x in base_slices_info])
    calculate_temporal_volatility([x['path'] for x in epoch_paths_info])
    sort_community_counts(OUTPUT_DIR)

    with open(OUTPUT_DIR / "author_mapping.txt", "w") as f:
        for nid in sorted(name_map.keys()):
            f.write(f"{name_map[nid]}: {nid}\n")

    config = {
        "primary_school": {
            "label": "Primary School",
            "enabled": True,
            "slices": json_slices_output
        }
    }
    
    print("\n✅ SUCCESS! Copy this into 'data/datasets.config.json':\n")
    print(json.dumps(config, indent=2))

if __name__ == "__main__":
    main()