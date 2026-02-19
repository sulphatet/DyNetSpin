#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_enron_spinetrix.py
--------------------------------------------
Create SpinTrix-compatible CSV / JSON files from the Enron email dataset,
now correctly based on the proven vispub.py parser structure.

* This script models the Enron email corpus as a peer-to-peer network.
* It automatically downloads the dataset.
* The data is sliced yearly from 1998 to 2002.
* Communities are detected for each year using the Louvain method. This version
  removes the complex 'relabeling' logic to match the working reference
  script, ensuring community IDs are always a simple 0,1,2... sequence
  for each slice, which resolves visualization errors.
* The export logic is a direct adaptation of the vispub script.

Requires: pandas, networkx, numpy, requests, python-louvain
"""
import os
import json
import math
import collections
import argparse
import requests
import sys
from pathlib import Path
from datetime import datetime

import pandas as pd
import numpy  as np
import networkx as nx
import community as community_louvain # pip install python-louvain

# ---------------------------------------------------------------------------
# 0 ▸  PARAMETERS & SETUP
# ---------------------------------------------------------------------------
DATA_URL = "https://www.cis.jhu.edu/~parky/Enron/execs.email.linesnum"
RAW_FILE = Path("enron_raw.txt")
OUT_ROOT = Path("data") / "tinyenron" # Corrected output folder

YEARS_TO_PROCESS = range(1998, 2003) # 1998 through 2002

# ---------------------------------------------------------------------------
# 1 ▸  DOWNLOAD & PREPARE DATA
# ---------------------------------------------------------------------------
def download_data():
    """Downloads the dataset if it doesn't exist locally."""
    if RAW_FILE.exists():
        print(f"✓ Raw data file '{RAW_FILE}' already exists. Skipping download.")
        return
    print(f"Downloading dataset from {DATA_URL} ...")
    try:
        response = requests.get(DATA_URL, stream=True)
        response.raise_for_status()
        with open(RAW_FILE, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192): f.write(chunk)
        print("✓ Download complete.")
    except requests.exceptions.RequestException as e:
        print(f"✖ ERROR: Failed to download data: {e}"); sys.exit(1)

def load_and_prepare_data():
    """Loads the raw data and filters it for the relevant time period."""
    print("\nLoading and preparing Enron email data ...")
    try:
        df = pd.read_csv(RAW_FILE, sep=' ', header=None, names=['timestamp', 'from_id', 'to_id'])
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='s')
        df['year'] = df['datetime'].dt.year
        df_filtered = df[df['year'].isin(YEARS_TO_PROCESS)].copy()
        print(f"✓ Loaded {len(df_filtered)} emails from {YEARS_TO_PROCESS[0]}-{YEARS_TO_PROCESS[-1]}.")
        return df_filtered
    except FileNotFoundError:
        print(f"✖ ERROR: Raw data file not found: {RAW_FILE}."); sys.exit(1)
    except Exception as e:
        print(f"✖ ERROR: Failed to process raw data file: {e}"); sys.exit(1)

# ---------------------------------------------------------------------------
# 2 ▸  GRAPH CREATION & PROCESSING
# ---------------------------------------------------------------------------
def create_graphs(df):
    """Creates a dictionary of graphs, one for each year."""
    graphs = {}
    for year in YEARS_TO_PROCESS:
        slice_df = df[df['year'] == year]
        G = nx.Graph()
        if not slice_df.empty:
            slice_df = slice_df[slice_df['from_id'] != slice_df['to_id']]
            edges = zip(slice_df['from_id'], slice_df['to_id'])
            G.add_edges_from(edges)
        graphs[str(year)] = G
    return graphs

def mark_incoming_outgoing_nodes(graphs):
    """Marks nodes as 'incoming' or 'outgoing' across slices."""
    sorted_keys = sorted(graphs.keys())
    for i, ts_key in enumerate(sorted_keys):
        G = graphs[ts_key]
        current_nodes = set(G.nodes())
        prev_nodes = set(graphs[sorted_keys[i-1]].nodes()) if i > 0 else set()
        next_nodes = set(graphs[sorted_keys[i+1]].nodes()) if i < len(sorted_keys)-1 else set()
        
        for n in current_nodes:
            is_incoming = n not in prev_nodes
            is_outgoing = n not in next_nodes
            if is_incoming and is_outgoing: G.nodes[n]['type'] = 'outandin'
            elif is_incoming: G.nodes[n]['type'] = 'incoming'
            elif is_outgoing: G.nodes[n]['type'] = 'outgoing'

def compute_node_volatility(graphs):
    """Computes a simple volatility score for each node."""
    sorted_keys = sorted(graphs.keys())
    node_volatility = collections.defaultdict(int)
    all_nodes = set()
    for ts_key in sorted_keys:
        all_nodes.update(graphs[ts_key].nodes())

    for i in range(1, len(sorted_keys)):
        prev_nodes = set(graphs[sorted_keys[i-1]].nodes())
        curr_nodes = set(graphs[sorted_keys[i]].nodes())
        entered = curr_nodes - prev_nodes
        left = prev_nodes - curr_nodes
        for n in entered: node_volatility[n] += 1
        for n in left: node_volatility[n] += 1
    
    return {n: node_volatility.get(n, 0) for n in all_nodes}

# ---------------------------------------------------------------------------
# 3 ▸  UTILITY FUNCTIONS
# ---------------------------------------------------------------------------
def safe_mkdir(p:Path):
    """Creates a directory if it doesn't exist."""
    p.mkdir(parents=True, exist_ok=True)

def find_outlier_range(arr):
    """Calculates the statistical range excluding outliers."""
    if len(arr) < 2: return [0.0, 1.0]
    q1,q3 = np.percentile(arr, [25,75])
    iqr   = q3-q1
    lb    = max(arr.min(), q1-1.5*iqr)
    ub    = min(arr.max(), q3+1.5*iqr)
    return [float(lb), float(ub)]

# ---------------------------------------------------------------------------
# 4 ▸  EXPORTING (ADAPTED FROM VISPUB SCRIPT)
# ---------------------------------------------------------------------------
def export_graphs(graphs, node_volatility):
    """Detects communities and exports all required files for each slice."""
    print("\n=== Exporting Data for Each Slice ===")
    
    for ts_key, G in graphs.items():
        slice_dir = OUT_ROOT / ts_key
        safe_mkdir(slice_dir)
        print(f"--- Processing {ts_key} -> {slice_dir}")

        # 1. Detect communities. This ensures IDs are always 0, 1, 2... for each slice.
        if G.nodes():
            partition = community_louvain.best_partition(G)
        else:
            partition = {}
        
        # 2. Build induced coarse graph
        coarse_graph = community_louvain.induced_graph(partition, G)

        # 3. Compute centralities
        if G.nodes():
            btw_cent = nx.betweenness_centrality(G)
            clo_cent = nx.closeness_centrality(G)
            try: eig_cent = nx.eigenvector_centrality(G, max_iter=1000)
            except: eig_cent = {n: 0 for n in G.nodes()}
        else:
            btw_cent, clo_cent, eig_cent = {}, {}, {}

        # 4. Create main node data dataframe
        node_records = []
        for n in G.nodes():
            node_records.append({
                "node": int(n), "centrality": G.degree(n), "community": partition.get(n, -1),
                "name": str(n), "type": G.nodes[n].get('type', ''),
                "betwness": btw_cent.get(n,0), "closeness": clo_cent.get(n,0),
                "eign": eig_cent.get(n,0), "volatility": node_volatility.get(n,0)
            })
        nodes_df = pd.DataFrame(node_records)
        nodes_df.to_csv(slice_dir/"facebook_data_transformed_new.csv", index=False)

        # 5. Export connection_list.json
        conn = {int(n): [int(v) for v in G.neighbors(n)] for n in G.nodes()}
        (slice_dir/"connection_list.json").write_text(json.dumps(conn))

        # 6. Export node_to_node_link_data.csv
        edges_df = pd.DataFrame([{'source': u, 'target': v, 'type': ''} for u, v in G.edges()])
        edges_df.to_csv(slice_dir/"node_to_node_link_data.csv", index=False)

        # 7. Export coarse graph files (link_data.csv, coarse_graph_pos.csv)
        link_data_df = pd.DataFrame([{'source': u, 'target': v, 'weight': d.get('weight',1)} for u,v,d in coarse_graph.edges(data=True)])
        link_data_df.to_csv(slice_dir/"link_data.csv", index=False)
        
        # Use a consistent circular layout for the coarse graph positions.
        all_community_ids = sorted(list(set(partition.values())))
        k = len(all_community_ids) if len(all_community_ids) > 0 else 1
        pos = {comm_id: (math.cos(2*math.pi*i/k), math.sin(2*math.pi*i/k)) for i, comm_id in enumerate(all_community_ids)}
        pos_df = pd.DataFrame([{'node': n, 'x_pos': x, 'y_pos': y} for n, (x,y) in pos.items()])
        pos_df.to_csv(slice_dir/"coarse_graph_pos.csv", index=False)

        # 8. Export commuity_count.csv (with typo and sorted)
        if not nodes_df.empty:
            count_df = nodes_df.groupby('community').size().reset_index(name='count')
            all_comms_df = pd.DataFrame({'community': all_community_ids})
            count_df = pd.merge(all_comms_df, count_df, on='community', how='left').fillna(0)
            count_df['count'] = count_df['count'].astype(int)
        else:
            count_df = pd.DataFrame({'community': all_community_ids, 'count': [0]*len(all_community_ids)})
        
        count_df = count_df.sort_values(by='community')
        count_df.to_csv(slice_dir/"commuity_count.csv", index=False)

        # 9. Export new_extent_without_outliers_for_colorcoding.json
        extents = {}
        for col,k in [("centrality","degree_range"), ("closeness","closeness_range"),
                      ("betwness","betwness_range"), ("eign","eign_range"),
                      ("volatility","volatility_range")]:
            if not nodes_df.empty:
                extents[k] = find_outlier_range(nodes_df[col].to_numpy())
            else:
                extents[k] = [0.0, 0.0]
        (slice_dir/"new_extent_without_outliers_for_colorcoding.json").write_text(json.dumps(extents))

# ---------------------------------------------------------------------------
# 5 ▸  MAIN EXECUTION
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    download_data()
    enron_df = load_and_prepare_data()
    graphs = create_graphs(enron_df)
    mark_incoming_outgoing_nodes(graphs)
    node_volatility = compute_node_volatility(graphs)
    export_graphs(graphs, node_volatility)
