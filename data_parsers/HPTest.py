#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HPTest.py
--------------------------------------------
Create compatible CSV / JSON files from the Harry Potter dataset,
modeling it as a character-to-character interaction network.

* This version correctly models a PEER-TO-PEER network.
* Houses are used ONLY for grouping (as a 'community' attribute).
* There are NO house nodes in the graph.

* Automatically downloads and extracts the dataset.
* 6 slices are used, one for each book (hpbook1.txt - hpbook6.txt).
* Nodes are characters (students).
* Edges represent direct peer support interactions between characters.
* Generates the same 7-file output structure as the vispub example.
* Ensures all output files are created for every slice, even if empty, to prevent visualization errors.

Requires: pandas, networkx, numpy, requests
"""
import os
import json
import math
import collections
import argparse
import requests
import zipfile
import io
import sys
from pathlib import Path

import pandas as pd
import numpy  as np
import networkx as nx

# ---------------------------------------------------------------------------
# 0 ▸  PARAMETERS & SETUP
# ---------------------------------------------------------------------------
DATA_URL     = "https://www.stats.ox.ac.uk/~snijders/siena/bossaert_meidert_harrypotter.zip"
RAW_ROOT     = Path("harry_potter_raw")
OUT_ROOT     = Path("data") / "harry_potter" # SpinTrix output folder

TIME_SLICES  = [f"Book {i}" for i in range(1, 7)]
HOUSE_NAME_MAP = {1: "Gryffindor", 2: "Hufflepuff", 3: "Ravenclaw", 4: "Slytherin"}
# Sequential community index (0-3) for visualization layout
COMMUNITY_INDEX_MAP = {house_id: i for i, house_id in enumerate(HOUSE_NAME_MAP.keys())}


# ---------------------------------------------------------------------------
# 1 ▸  DOWNLOAD AND EXTRACT DATA
# ---------------------------------------------------------------------------
def download_and_extract_data():
    """Downloads and extracts the dataset if it doesn't exist."""
    if RAW_ROOT.exists():
        print(f"✓ Raw data directory '{RAW_ROOT}' already exists. Skipping download.")
        return
    print(f"Downloading dataset from {DATA_URL} ...")
    try:
        response = requests.get(DATA_URL, stream=True)
        response.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(response.content))
        print(f"Extracting to '{RAW_ROOT}' directory ...")
        z.extractall(RAW_ROOT)
        print("✓ Download and extraction complete.")
    except requests.exceptions.RequestException as e:
        print(f"✖ ERROR: Failed to download data: {e}"); sys.exit(1)
    except zipfile.BadZipFile:
        print("✖ ERROR: Downloaded file is not a valid zip file."); sys.exit(1)

# ---------------------------------------------------------------------------
# 2 ▸  LOAD AND PREPARE ATTRIBUTE DATA
# ---------------------------------------------------------------------------
def load_attributes():
    """Loads student names and house attributes into a single lookup dictionary."""
    print("\nLoading student attributes and names ...")
    try:
        names_df = pd.read_csv(RAW_ROOT / "hpnames.txt", delim_whitespace=True, skiprows=1, header=None, names=["id", "name"])
        name_map = dict(zip(names_df["id"], names_df["name"]))

        attrs_df = pd.read_csv(RAW_ROOT / "hpattributes.txt", delim_whitespace=True, skiprows=1, header=None, names=["id", "schoolyear", "gender", "house_id"])
        
        student_attrs = {}
        for _, row in attrs_df.iterrows():
            uid = int(row["id"])
            student_attrs[uid] = {
                "name": name_map.get(uid, f"Unknown_{uid}"),
                "house_id": int(row["house_id"]),
                "community": COMMUNITY_INDEX_MAP[int(row["house_id"])]
            }
        return student_attrs
    except FileNotFoundError as e:
        print(f"✖ ERROR: Could not find attribute file: {e}. Ensure data was extracted correctly."); sys.exit(1)

# ---------------------------------------------------------------------------
# 3 ▸  PROCESS TIME SLICES (BOOKS)
# ---------------------------------------------------------------------------
def process_book_file(book_num, student_attrs):
    """Reads an adjacency matrix from a book file and returns an edge list."""
    filepath = RAW_ROOT / f"hpbook{book_num}.txt"
    print(f"   - Parsing {filepath}...")
    try:
        # Manually parse to be robust against file format inconsistencies.
        with open(filepath, 'r') as f:
            lines = [line.strip() for line in f if line.strip()]
        
        if not lines:
            print("   - WARNING: File is empty.")
            return pd.DataFrame()

        matrix = np.array([line.split() for line in lines], dtype=int)
        
        expected_dim = len(student_attrs)
        if matrix.shape[0] != expected_dim or matrix.shape[1] != expected_dim:
            print(f"   - WARNING: Matrix shape {matrix.shape} does not match student count {expected_dim}. Skipping.")
            return pd.DataFrame()

        # The matrix row/col 'i' corresponds to the i-th student in a sorted list of IDs.
        student_ids = sorted(student_attrs.keys()) # e.g., [1, 2, ..., 64]
        
        edges = []
        # np.where is an efficient way to find the coordinates of all '1's.
        source_indices, target_indices = np.where(matrix == 1)
        
        for i in range(len(source_indices)):
            # Map matrix index (0-63) to the actual student ID (1-64)
            source_id = student_ids[source_indices[i]]
            target_id = student_ids[target_indices[i]]
            
            # Ensure it's an interaction between two different people
            if source_id != target_id:
                edges.append({"source": source_id, "target": target_id})
        
        print(f"   - Found {len(edges)} interactions.")
        return pd.DataFrame(edges)
        
    except FileNotFoundError:
        print(f"   - WARNING: Book file not found: {filepath}")
        return pd.DataFrame()
    except Exception as e:
        print(f"   - ERROR: Failed to process {filepath}: {e}")
        return pd.DataFrame()

# ---------------------------------------------------------------------------
# 4 ▸  UTILITY FUNCTIONS
# ---------------------------------------------------------------------------
def safe_mkdir(p:Path):
    p.mkdir(parents=True, exist_ok=True)

def find_outlier_range(arr):
    if len(arr) < 2: return [0.0, 1.0]
    q1,q3 = np.percentile(arr, [25,75])
    iqr   = q3-q1
    lb    = max(arr.min(), q1-1.5*iqr)
    ub    = min(arr.max(), q3+1.5*iqr)
    return [float(lb), float(ub)]

# ---------------------------------------------------------------------------
# 5 ▸  MAIN BUILD SCRIPT
# ---------------------------------------------------------------------------
def build_all_slices(student_attrs, anonymize=False):
    """Main function to build and export all data slices."""
    node_presence = collections.defaultdict(list)
    graphs = {}

    # First pass: build all graphs
    for slice_idx, slice_name in enumerate(TIME_SLICES):
        book_num = slice_idx + 1
        print(f"\n=== Building graph for slice: {slice_name} ===")
        
        edge_df = process_book_file(book_num, student_attrs)
        
        G = nx.Graph()
        if not edge_df.empty:
            active_students = set(edge_df["source"]) | set(edge_df["target"])

            for uid in active_students:
                if uid not in student_attrs: continue
                attrs = student_attrs[uid]
                node_name = str(uid) if anonymize else attrs["name"]
                G.add_node(uid, name=node_name, community=attrs["community"])

            for _, row in edge_df.iterrows():
                G.add_edge(row["source"], row["target"])
        
        graphs[slice_name] = G
        print(f"   - Graph created with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges.")
        for n in G.nodes():
            node_presence[n].append(slice_idx)

    # Second pass: annotate and export
    print("\n=== Annotating and Exporting Slices ===")
    volatility = { n: len(pres)-1 for n,pres in node_presence.items() }

    for slice_idx, slice_name in enumerate(TIME_SLICES):
        book_num = slice_idx + 1
        out_dir = OUT_ROOT / f"Book_{book_num}"
        safe_mkdir(out_dir)
        print(f"--- Processing {slice_name} -> {out_dir}")

        G = graphs[slice_name]
        
        # 1. Define partition (student_id -> community_idx)
        partition = {n: d['community'] for n, d in G.nodes(data=True)}

        # 2. Mark incoming/outgoing nodes
        prev_nodes = set(graphs[TIME_SLICES[slice_idx-1]].nodes()) if slice_idx > 0 else set()
        next_nodes = set(graphs[TIME_SLICES[slice_idx+1]].nodes()) if slice_idx < len(TIME_SLICES)-1 else set()
        for n in G.nodes():
            is_incoming = n not in prev_nodes
            is_outgoing = n not in next_nodes
            if is_incoming and is_outgoing: G.nodes[n]['type'] = 'outandin'
            elif is_incoming: G.nodes[n]['type'] = 'incoming'
            elif is_outgoing: G.nodes[n]['type'] = 'outgoing'
            else: G.nodes[n]['type'] = ''

        # 3. Compute centralities
        if G.number_of_nodes() > 0:
            btw_cent = nx.betweenness_centrality(G)
            clo_cent = nx.closeness_centrality(G)
            try: eig_cent = nx.eigenvector_centrality(G, max_iter=1000)
            except: eig_cent = {n: 0 for n in G.nodes()}
        else:
            btw_cent, clo_cent, eig_cent = {}, {}, {}


        # 4. Export facebook_data_transformed_new.csv
        node_records = []
        for n, d in G.nodes(data=True):
            node_records.append({
                "node": int(n), "centrality": G.degree(n), "community": d["community"],
                "density": 0, "name": d["name"], "type": d.get('type', ''),
                "betwness": btw_cent.get(n,0), "closeness": clo_cent.get(n,0),
                "eign": eig_cent.get(n,0), "volatility": volatility.get(n,0)
            })
        nodes_df = pd.DataFrame(node_records)
        nodes_df.to_csv(out_dir/"facebook_data_transformed_new.csv", index=False)
        
        # 5. Export connection_list.json
        conn = {int(n): [int(v) for v in G.neighbors(n)] for n in G.nodes()}
        (out_dir/"connection_list.json").write_text(json.dumps(conn))

        # 6. Export node_to_node_link_data.csv
        edges_df = pd.DataFrame([{'source': u, 'target': v, 'type': ''} for u, v in G.edges()])
        edges_df.to_csv(out_dir/"node_to_node_link_data.csv", index=False)

        # 7. Build and export coarse graph (house-to-house interactions)
        coarse_graph = nx.Graph()
        for u, v in G.edges():
            c1 = partition.get(u)
            c2 = partition.get(v)
            if c1 is not None and c2 is not None and c1 != c2:
                if coarse_graph.has_edge(c1, c2):
                    coarse_graph[c1][c2]['weight'] += 1
                else:
                    coarse_graph.add_edge(c1, c2, weight=1)
        
        link_data_df = pd.DataFrame([{'source': u, 'target': v, 'weight': d['weight']} for u,v,d in coarse_graph.edges(data=True)])
        link_data_df.to_csv(out_dir/"link_data.csv", index=False)
        
        # 8. Export coarse_graph_pos.csv
        k = len(COMMUNITY_INDEX_MAP)
        pos = {i: (math.cos(2*math.pi*i/k), math.sin(2*math.pi*i/k)) for i in range(k)}
        pos_df = pd.DataFrame([{'node': n, 'x_pos': x, 'y_pos': y} for n, (x,y) in pos.items()])
        pos_df.to_csv(out_dir/"coarse_graph_pos.csv", index=False)

        # 9. Export commuity_count.csv (with typo)
        # This now ensures all communities are present, even with zero count.
        all_communities_df = pd.DataFrame({'community': range(len(HOUSE_NAME_MAP))})
        if not nodes_df.empty:
            counts = nodes_df.groupby('community').size().reset_index(name='count')
            count_df = pd.merge(all_communities_df, counts, on='community', how='left').fillna(0)
        else:
            count_df = all_communities_df
            count_df['count'] = 0
        count_df['count'] = count_df['count'].astype(int)
        # Sort by community ID to ensure predictable order for JS
        count_df = count_df.sort_values(by='community')
        count_df.to_csv(out_dir/"commuity_count.csv", index=False)

        # 10. Export new_extent_without_outliers_for_colorcoding.json
        extents = {}
        for col,k in [("centrality","degree_range"), ("closeness","closeness_range"),
                      ("betwness","betwness_range"), ("eign","eign_range"),
                      ("volatility","volatility_range")]:
            if not nodes_df.empty:
                extents[k] = find_outlier_range(nodes_df[col].to_numpy())
            else:
                extents[k] = [0.0, 0.0]
        (out_dir/"new_extent_without_outliers_for_colorcoding.json").write_text(json.dumps(extents))

    print(f"\n✓ All slices exported to '{OUT_ROOT}'")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build a SpinTrix-compatible dataset from the Harry Potter character interaction network.")
    parser.add_argument("--anonymize", action="store_true", help="If set, use student IDs as names instead of their character names.")
    args = parser.parse_args()

    download_and_extract_data()
    student_attributes = load_attributes()
    build_all_slices(student_attributes, args.anonymize)
