#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Example script that:
  - Reads a CSV with columns: [id, author, base_model, base_model_relation, createdAt, ...]
  - Creates a global author -> integer clusterID mapping (instead of Louvain).
  - Builds a graph of nodes = model 'id' (converted to numeric if needed).
    Edges are from each parent in 'base_model' => child row 'id'.
  - Slices data by year cumulatively (once a model appears, it remains in subsequent years).
  - For each year, exports CSV/JSON files needed by your D3.js pipeline.
  - Instead of computing communities via Louvain, we define each node's community
    as "the cluster ID of that node's author".
"""

import os
import ast
import json
import math
import itertools
import datetime
import numpy as np
import pandas as pd
import networkx as nx
import community  # for induced_graph, but we'll skip best_partition
import matplotlib.pyplot as plt

# ------------------------------------------------------------------------------
# 1) LOADING DATA, YEAR SLICES
# ------------------------------------------------------------------------------
def load_dataset(csv_path):
    """
    Expects the CSV to have at least:
      - 'id' (unique model ID, or something we map to numeric)
      - 'author' (the "cluster" or "community" we're using)
      - 'base_model' (a list of parent IDs, e.g. "['xxx','yyy']" or empty)
      - 'base_model_relation'
      - 'createdAt' => parse as datetime => extract 'year'
    Returns a DataFrame with a 'year' column.
    """
    df = pd.read_csv(csv_path)
    df['createdAt'] = pd.to_datetime(df['createdAt'], errors='coerce')
    df = df.dropna(subset=['createdAt'])
    df['year'] = df['createdAt'].dt.year
    return df

def build_author_mapping(df):
    """
    Collect all unique authors in the entire dataset, assign each an integer 'authorClusterID'.
    Returns a dict { authorName -> clusterID }.
    """
    authors = df['author'].dropna().unique()
    sorted_authors = sorted(authors)
    authorMapping = {auth: idx for idx, auth in enumerate(sorted_authors)}
    return authorMapping

def build_id_mapping(df):
    """
    If your 'id' column is a string (like 'Qwen/QwQ-32B') and you want
    numeric node IDs, do that here. If you prefer to keep them as strings
    in the graph, you can skip this. This is only needed if your pipeline
    demands numeric node IDs.
    """
    unique_ids = df['id'].unique()
    sorted_ids = sorted(unique_ids)
    IDMapping = {str_id: i for i, str_id in enumerate(sorted_ids)}
    return IDMapping

def build_graph_for_df(df_slice, IDMapping):
    """
    Build a Graph from df_slice. Each row => node (using numeric ID if desired).
    Edges from each parent in 'base_model' => child's ID.

    If you want to store node attributes from the row, we do row.to_dict().
    """
    G = nx.Graph()
    # 1) Add nodes
    for idx, row in df_slice.iterrows():
        model_str_id = row['id']
        # Map to integer if desired:
        node_id = IDMapping[model_str_id]
        # Add node with row attributes
        G.add_node(node_id, **row.to_dict())

    # 2) Edges
    for idx, row in df_slice.iterrows():
        child_str_id = row['id']
        child_num_id = IDMapping[child_str_id]

        raw_parents = row.get('base_model', None)
        if not raw_parents:
            continue

        # parse base_model as a list
        if isinstance(raw_parents, str):
            try:
                parents_list = ast.literal_eval(raw_parents)
                if not isinstance(parents_list, list):
                    parents_list = []
            except:
                parents_list = []
        elif isinstance(raw_parents, list):
            parents_list = raw_parents
        else:
            parents_list = []

        edge_type = row.get('base_model_relation', '')

        # For each parent
        for p_str_id in parents_list:
            if p_str_id in IDMapping:
                p_num_id = IDMapping[p_str_id]
                G.add_edge(p_num_id, child_num_id, type=edge_type)

    return G

def get_cumulative_graphs(df, IDMapping):
    """
    For each unique year, build a cumulative sub-DataFrame of all rows up to that year,
    then build a Graph. 
    Returns dict {str(year) -> Graph}.
    """
    all_years = sorted(df['year'].unique())
    graphs_by_year = {}
    for y in all_years:
        print(y)
        df_slice = df[df['year'] <= y]
        G = build_graph_for_df(df_slice, IDMapping)
        graphs_by_year[str(y)] = G
    return graphs_by_year

# ------------------------------------------------------------------------------
# 2) VOLATILITY
# ------------------------------------------------------------------------------
def compute_volatility(graph_dict):
    """
    Count #times a node appears or disappears across consecutive years
    """
    node_volatility = {}
    sorted_years = sorted(graph_dict.keys(), key=int)
    for i in range(1, len(sorted_years)):
        prev_y = sorted_years[i-1]
        curr_y = sorted_years[i]
        prev_nodes = set(graph_dict[prev_y].nodes())
        curr_nodes = set(graph_dict[curr_y].nodes())
        entered = curr_nodes - prev_nodes
        left = prev_nodes - curr_nodes
        for n in entered:
            node_volatility[n] = node_volatility.get(n,0)+1
        for n in left:
            node_volatility[n] = node_volatility.get(n,0)+1

    # ensure every node is in there
    all_nodes = set()
    for y in sorted_years:
        all_nodes.update(graph_dict[y].nodes())
    for n in all_nodes:
        if n not in node_volatility:
            node_volatility[n] = 0

    return node_volatility

# ------------------------------------------------------------------------------
# 3) PARTITION NODES BY THEIR AUTHOR
# ------------------------------------------------------------------------------
def build_author_partition(G, authorMapping):
    """
    For each node in G, look up G.nodes[node]['author'] => authorMapping => clusterID.
    We'll store partition[node] = clusterID.
    This is instead of using community_louvain.best_partition(G).
    """
    partition = {}
    for node in G.nodes():
        # e.g. node attributes might have 'author' from the row
        row_author = G.nodes[node].get('author', None)
        if row_author in authorMapping:
            partition[node] = authorMapping[row_author]
        else:
            # If missing or unknown author => maybe -1 or make a new ID
            partition[node] = -1
    return partition

# ------------------------------------------------------------------------------
# 4) EXPORTING EXACTLY LIKE YOUR OLD CODE
# ------------------------------------------------------------------------------
def create_dictionary_of_connections(G):
    conn = {}
    for n in G.nodes():
        neighbors = list(G.neighbors(n))
        conn[n] = neighbors
    return conn

def link_data_community(induced_coarse_graph):
    rows = []
    for u,v,a in induced_coarse_graph.edges(data=True):
        if u!=v:
            w = a.get('WEIGHT',1)
            rows.append({'source':u,'target':v,'weight':w})
    return pd.DataFrame(rows)

def link_data_symmetry(induced_coarse_graph):
    rows = []
    for u,v,a in induced_coarse_graph.edges(data=True):
        if u!=v:
            w = a.get('WEIGHT',1)
            rows.append({'source':u,'target':v,'weight':w})
            rows.append({'source':v,'target':u,'weight':w})
    return pd.DataFrame(rows)

def link_data(G):
    rows = []
    for u,v,a in G.edges(data=True):
        if u!=v:
            t = a.get('type','')
            rows.append({'source':u,'target':v,'type':t})
    return pd.DataFrame(rows)

def density_of_subgraph(G_sub):
    n = len(G_sub.nodes())
    if n<2:
        return 0
    max_e = n*(n-1)/2
    e = len(G_sub.edges())
    return e/max_e if max_e>0 else 0

def nodes_in_communities(partition):
    from collections import Counter
    c = Counter(partition.values())
    rows=[]
    for commID, count in c.items():
        rows.append({'community': commID,'count': count})
    return pd.DataFrame(rows)

def density_in_communities(partition, G):
    from collections import defaultdict
    d = defaultdict(list)
    for node, commID in partition.items():
        d[commID].append(node)
    out=[]
    for commID, members in d.items():
        subG = G.subgraph(members)
        den = density_of_subgraph(subG)
        out.append({'community':commID,'density':den})
    return pd.DataFrame(out)

def reorder_by_size(df_node, partition):
    """
    Reorder rows in df_node by ascending size of each community.
    """
    # count how many nodes per comm
    from collections import Counter
    c = Counter(partition.values())
    # define a function that returns the size of a node's community
    def comm_size_of(node):
        comm = partition[node]
        return c[comm]
    # sort by (community size, then maybe degree)
    df_node['comm_size'] = df_node['node'].apply(lambda n: comm_size_of(n))
    df_node.sort_values(by=['comm_size','community','centrality'], ascending=[True,True,True], inplace=True)
    df_node.drop(columns=['comm_size'], inplace=True)
    df_node.reset_index(drop=True, inplace=True)
    return df_node

def export_graphs(graphs, output_dir, node_volatility, authorMapping):
    """
    For each year => create folder => do:
     - partition by author
     - induced_coarse_graph
     - build link_data, node_to_node_link_data, etc.
     - compute centralities, store in 'facebook_data_transformed_new.csv'
     - produce the usual CSV/JSON
    """
    os.makedirs(output_dir, exist_ok=True)
    year_keys = sorted(graphs.keys(), key=int)
    for y in year_keys:
        G = graphs[y]
        slice_dir = os.path.join(output_dir, y)
        os.makedirs(slice_dir, exist_ok=True)

        # PARTITION = by author
        partition = build_author_partition(G, authorMapping)

        # Build induced coarse graph => cluster -> cluster
        induced_coarse_graph = community.induced_graph(partition, G)

        # adjacency => connection_list.json
        conn_dict = create_dictionary_of_connections(G)
        with open(f"{slice_dir}/connection_list.json","w") as f:
            json.dump(conn_dict, f, indent=2)

        # link_data.csv => edges in coarse graph
        link_df = link_data_community(induced_coarse_graph)
        link_df.to_csv(f"{slice_dir}/link_data.csv", index=False)

        link_df_sym = link_data_symmetry(induced_coarse_graph)

        # node_to_node_link_data.csv => edges in G
        node2node = link_data(G)
        node2node.to_csv(f"{slice_dir}/node_to_node_link_data.csv", index=False)

        # coarse_graph_pos.csv => layout for cluster graph
        pos = nx.circular_layout(induced_coarse_graph)
        pos_rows = []
        for nd,(xx,yy) in pos.items():
            pos_rows.append({'node':nd,'x_pos':xx,'y_pos':yy})
        pd.DataFrame(pos_rows).to_csv(f"{slice_dir}/coarse_graph_pos.csv", index=False)

        # compute centralities => 'facebook_data_transformed_new.csv'
        betw = {n: 0.0 for n in G.nodes()}  # dummy values

        # Keep closeness, but warn if graph is huge
        if G.number_of_nodes() < 3000:
            clo = nx.closeness_centrality(G)
        else:
            clo = {n: 0.0 for n in G.nodes()}  # fallback or approximation

        try:
            eig = nx.eigenvector_centrality(G, max_iter=1000, tol=1e-6)
        except nx.PowerIterationFailedConvergence:
            eig = {n: 0.0 for n in G.nodes()}

        # build node-level data
        rows_node = []
        for node in G.nodes():
            rows_node.append({
                'node': node,
                'centrality': G.degree(node),
                'community': partition[node],
                'betwness': betw[node],
                'closeness': clo[node],
                'eign': eig[node],
                'volatility': node_volatility.get(node,0)
            })
        df_nodes = pd.DataFrame(rows_node)

        # store it
        df_nodes.to_csv(f"{slice_dir}/facebook_data_transformed_new.csv", index=False)

        # new_extent_without_outliers_for_colorcoding.json
        def find_outlier_range(s):
            q1 = s.quantile(.25)
            q3 = s.quantile(.75)
            iqr = q3 - q1
            lower = max(s.min(), q1-1.5*iqr)
            upper = min(s.max(), q3+1.5*iqr)
            return [float(lower), float(upper)]
        outlier_dict = {
            'degree_range': find_outlier_range(df_nodes['centrality']),
            'eign_range': find_outlier_range(df_nodes['eign']),
            'closeness_range': find_outlier_range(df_nodes['closeness']),
            'volatility_range': find_outlier_range(df_nodes['volatility']),
            'betwness_range': find_outlier_range(df_nodes['betwness'])
        }
        with open(f"{slice_dir}/new_extent_without_outliers_for_colorcoding.json","w") as f:
            json.dump(outlier_dict, f, indent=2)

        # commuity_count.csv
        df_count = nodes_in_communities(partition).sort_values(by='count')
        df_count.to_csv(f"{slice_dir}/commuity_count.csv", index=False)

        # commuity_density.csv
        df_density = density_in_communities(partition, G)
        df_density.to_csv(f"{slice_dir}/commuity_density.csv", index=False)

        # commuity_h_degree.csv
        #   e.g. pick the highest 'centrality' node in each cluster
        result_hd = []
        grouped = df_nodes.groupby('community')
        for commID, group in grouped:
            if len(group)>0:
                best_idx = group['centrality'].idxmax()
                best_val = group.loc[best_idx, 'centrality']
                result_hd.append({'community': commID, 'h_degree': best_val})
        df_hd = pd.DataFrame(result_hd)
        df_hd.to_csv(f"{slice_dir}/commuity_h_degree.csv", index=False)

        # heatmap_data.csv => can do something similar to your old code
        # combos = list(itertools.product(partition.values(), partition.values()))
        # combos_df = pd.DataFrame({'source':[c[0] for c in combos],'target':[c[1] for c in combos]})
        # # or do a custom approach
        # combos_df['weight'] = 0
        # combos_df.to_csv(f"{slice_dir}/heatmap_data.csv", index=False)

        # Minimal heatmap_data.csv just to prevent errors
        dummy_heatmap = pd.DataFrame({
            'source': [0],
            'target': [0],
            'weight': [1.0]
        })
        dummy_heatmap.to_csv(f"{slice_dir}/heatmap_data.csv", index=False)

        # facebook_data_transformed_new_by_size.csv => reorder by cluster size


        df_by_size = reorder_by_size(df_nodes, partition)
        df_by_size.to_csv(f"{slice_dir}/facebook_data_transformed_new_by_size.csv", index=False)

# ------------------------------------------------------------------------------
# 5) MAIN
# ------------------------------------------------------------------------------
def main():
    input_csv = "models_for_model_atlas.csv"
    output_dir = "data"

    # 1) Load dataset
    df = load_dataset(input_csv)
    print("Dataset Loaded")

    # 2) Build an author->intID for clusters
    authorMapping = build_author_mapping(df)
    print("Author mappings loaded")

    # 3) Build an ID mapping if needed (if your 'id' column is string-based)
    IDMapping = build_id_mapping(df)
    print("ID MApps")

    # 4) Build year-sliced graphs (cumulative)
    graphs_by_year = get_cumulative_graphs(df, IDMapping)
    print("graphs made")

    # 5) Node volatility
    node_vol = compute_volatility(graphs_by_year)
    print("Volatility computed")

    # 6) Export
    export_graphs(graphs_by_year, output_dir, node_vol, authorMapping)

if __name__ == "__main__":
    main()
