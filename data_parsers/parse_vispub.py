
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Python parser that:
  - Reads a CSV (with columns: Conference, Year, Title, AuthorNames-Deduped, etc.)
  - Creates a global author -> integer node ID mapping, saved to 'author_mapping.txt'
  - Builds co-author graphs in 5-year slices
  - Marks incoming/outgoing nodes/edges
  - Computes betweenness, closeness, eigenvector centralities + random volatility
  - Exports data for each timeslice:
      connection_list.json, link_data.csv, node_to_node_link_data.csv,
      coarse_graph_pos.csv, facebook_data_transformed_new.csv,
      new_extent_without_outliers_for_colorcoding.json, commuity_count.csv,
      commuity_density.csv, commuity_h_degree.csv, heatmap_data.csv, etc.

Usage:
  python parse_vispub.py

Requires:
  pip install pandas networkx community matplotlib numpy
"""

import os
import pandas as pd
import networkx as nx
import community  # pip install python-louvain
import itertools
import json
import numpy as np
import matplotlib.pyplot as plt

###########################
# 1) TIME-SLICING
###########################

def create_timeslices(min_year, max_year, agg=5):
    """
    Create 5-year intervals (or 'agg'-year intervals) from min_year..max_year.
    e.g. if min_year=2000, max_year=2009, agg=5 => slices = [(2000,2004), (2005,2009)]
    """
    slices = []
    for y in range(min_year, max_year+1, agg):
        slices.append((y, y+agg-1))
    return slices

###########################
# 2) BUILD AUTHOR→ID MAP
###########################

def build_author_mapping_from_csv(df):
    """
    Scan the CSV's 'AuthorNames-Deduped' column, gather all unique authors,
    assign each a unique integer ID, and save to 'author_mapping.txt'.
    Returns a dict {authorName -> intID}.
    """
    authors_set = set()

    for idx, row in df.iterrows():
        # Possibly in your CSV: "AuthorNames-Deduped"
        if "AuthorNames-Deduped" in row and not pd.isna(row["AuthorNames-Deduped"]):
            authors_list = [a.strip() for a in row["AuthorNames-Deduped"].split(";") if a.strip()]
            authors_set.update(authors_list)

    # Build sorted list
    sorted_authors = sorted(list(authors_set))
    author_mapping = {author: i for i,author in enumerate(sorted_authors)}

    # Save to author_mapping.txt
    with open("author_mapping.txt","w",encoding="utf-8") as f:
        for author, idx in author_mapping.items():
            f.write(f"{author}: {idx}\n")

    return author_mapping

###########################
# 3) CREATE GRAPHS
###########################

def create_graphs_from_csv(df, time_slices, author_mapping):
    """
    For each (start,end) timeslice, create a Graph of co-authors.
    Node = integer ID from author_mapping.

    We assume:
      - CSV has columns ["Year", "AuthorNames-Deduped", ...]
      - Each row is a 'paper'.
      - We'll place that paper in the slice whose start<=Year<=end.
      - If multiple authors, add edges for all pairs.
    Returns dict timesliceTag->nx.Graph
    """
    graphs = {}
    for (start,end) in time_slices:
        tag = f"{start}-{end}"
        G = nx.Graph()
        graphs[tag] = G

    for idx,row in df.iterrows():
        paper_year = int(row["Year"])
        authors_str = row.get("AuthorNames-Deduped","")
        if pd.isna(authors_str) or not authors_str.strip():
            continue
        authors_list = [a.strip() for a in authors_str.split(";") if a.strip()]

        # find which slice
        for (start,end) in time_slices:
            if start <= paper_year <= end:
                timeslice_tag = f"{start}-{end}"
                G = graphs[timeslice_tag]
                # if multiple authors
                if len(authors_list)>1:
                    for a1,a2 in itertools.combinations(authors_list,2):
                        # fetch integer IDs
                        id1 = author_mapping[a1]
                        id2 = author_mapping[a2]
                        if id1!=id2:
                            G.add_edge(id1,id2)
                            
                            # set / keep the 'name' attribute on both nodes
                            G.nodes[id1].setdefault("name", a1)
                            G.nodes[id2].setdefault("name", a2)
                else:
                    # single-author => ensure the node is present
                    for a in authors_list:
                        aid = author_mapping[a]
                        if aid not in G:
                            G.add_node(aid)
                            G.nodes[aid]["name"] = a
                break  # done with that paper
    return graphs

def mark_incoming_outgoing_nodes(graphs):
    """
    For consecutive timeslices, mark node as 'incoming','outgoing','outandin' 
    if it wasn't in the prev slice or won't be in the next slice, etc.
    """
    sorted_keys = sorted(graphs.keys(), key=lambda x: int(x.split("-")[0]))
    for i, ts_key in enumerate(sorted_keys):
        G = graphs[ts_key]
        current_nodes = set(G.nodes())
        # if previous timeslice
        if i>0:
            prev_key = sorted_keys[i-1]
            prev_nodes = set(graphs[prev_key].nodes())
            incoming = current_nodes - prev_nodes
            for n in incoming:
                G.nodes[n]["type"] = "incoming"
        # if next timeslice
        if i < len(sorted_keys)-1:
            next_key = sorted_keys[i+1]
            next_nodes = set(graphs[next_key].nodes())
            outgoing = current_nodes - next_nodes
            for n in outgoing:
                if "type" in G.nodes[n] and G.nodes[n]["type"]=="incoming":
                    G.nodes[n]["type"] = "outandin"
                else:
                    G.nodes[n]["type"] = "outgoing"

def mark_incoming_outgoing_edges(graphs):
    """
    Compare edges between consecutive slices, mark 'incoming','outgoing'.
    """
    sorted_keys = sorted(graphs.keys(), key=lambda x: int(x.split("-")[0]))
    edge_sets = {}
    for ts_key in sorted_keys:
        G = graphs[ts_key]
        e_set = set(frozenset((u,v)) for u,v in G.edges())
        edge_sets[ts_key] = e_set

    for i, ts_key in enumerate(sorted_keys):
        G = graphs[ts_key]
        curr_set = edge_sets[ts_key]
        # if previous
        if i>0:
            prev_key = sorted_keys[i-1]
            prev_set = edge_sets[prev_key]
            incoming_edges = curr_set - prev_set
            for e in incoming_edges:
                (u,v) = tuple(e)
                if G.has_edge(u,v):
                    G[u][v]["type"] = "incoming"
        # if next
        if i< len(sorted_keys)-1:
            next_key = sorted_keys[i+1]
            next_set = edge_sets[next_key]
            outgoing_edges = curr_set - next_set
            for e in outgoing_edges:
                (u,v) = tuple(e)
                if G.has_edge(u,v) and "type" not in G[u][v]:
                    G[u][v]["type"] = "outgoing"

def compute_node_volatility(graphs):
    """
    Count how many times a node 'appears' or 'disappears' across timeslices.
    """
    sorted_keys = sorted(graphs.keys(), key=lambda x: int(x.split("-")[0]))
    node_volatility = {}
    for i in range(1,len(sorted_keys)):
        prev_key = sorted_keys[i-1]
        curr_key = sorted_keys[i]
        prev_nodes = set(graphs[prev_key].nodes())
        curr_nodes = set(graphs[curr_key].nodes())
        entered = curr_nodes - prev_nodes
        left    = prev_nodes - curr_nodes
        for n in entered:
            node_volatility[n] = node_volatility.get(n,0)+1
        for n in left:
            node_volatility[n] = node_volatility.get(n,0)+1

    # ensure all nodes in dataset are in volatility
    all_nodes = set()
    for ts_key in sorted_keys:
        all_nodes.update(graphs[ts_key].nodes())
    for n in all_nodes:
        if n not in node_volatility:
            node_volatility[n] = 0
    return node_volatility

#################### NEW ‑‑ stable community IDs ####################
def relabel_partition(prev_partition, curr_partition, next_unused_label):
    """
    Re‑assign community labels so that communities that share the most
    nodes with a community in the previous timeslice inherit the SAME
    label.  That keeps colours / positions stable across slices.

    Returns
    -------
    new_partition      – dict  node ➜ *stable* community id
    next_unused_label  – int   counter you pass to the next slice
    """
    if prev_partition is None:                 # first slice – keep as is
        return curr_partition.copy(), max(curr_partition.values()) + 1

    from collections import defaultdict
    prev_inv = defaultdict(set)
    curr_inv = defaultdict(set)
    for n, c in prev_partition.items():
        prev_inv[c].add(n)
    for n, c in curr_partition.items():
        curr_inv[c].add(n)

    mapping, used = {}, set()
    for cid_curr, nodes_curr in curr_inv.items():
        # find previous community with biggest overlap
        best_prev, best_overlap = None, 0
        for cid_prev, nodes_prev in prev_inv.items():
            overlap = len(nodes_curr & nodes_prev)
            if overlap > best_overlap:
                best_prev, best_overlap = cid_prev, overlap
        if best_overlap > 0 and best_prev not in used:
            mapping[cid_curr] = best_prev
            used.add(best_prev)
        else:                                  # brand‑new community
            mapping[cid_curr] = next_unused_label
            next_unused_label += 1

    new_partition = {n: mapping[c] for n, c in curr_partition.items()}
    return new_partition, next_unused_label


###################################
# 4) EXPORT
###################################

def export_graphs(graphs, output_dir, node_volatility):
    """
    For each timeslice, do:
      - community detection
      - induced coarse graph
      - compute positions
      - create connection_list.json of nodeID->neighborIDs
      - create link_data.csv (coarse graph edges)
      - create node_to_node_link_data.csv (original edges)
      - create coarse_graph_pos.csv
      - create facebook_data_transformed_new.csv (with all centralities + volatility)
      - new_extent_without_outliers_for_colorcoding.json
      - commuity_count.csv, commuity_density.csv, commuity_h_degree.csv, heatmap_data.csv
    """
    import community  # python-louvain
    os.makedirs(output_dir, exist_ok=True)

    for ts_key, G in graphs.items():
        slice_dir = os.path.join(output_dir, ts_key)
        os.makedirs(slice_dir, exist_ok=True)

        # 1) detect communities
        partition = community.best_partition(G)  # dict node->commID

        # 2) build induced coarse graph
        induced_coarse_graph = community.induced_graph(partition, G, weight="weight")

        # 3) spring layout
        pos = nx.spring_layout(induced_coarse_graph, k=10, weight="weight")

        # 4) connection_list.json => adjacency for node IDs
        conn_dict = create_dictionary_of_connections(G)
        with open(os.path.join(slice_dir,"connection_list.json"),"w") as f:
            json.dump(conn_dict, f)

        # 5) link_data.csv => edges in coarse
        #  graph
        link_df = link_data_community(induced_coarse_graph)
        link_df.to_csv(os.path.join(slice_dir,"link_data.csv"), index=False)

        # symmetrical edges if needed
        link_df_sym = link_data_symmetry(induced_coarse_graph)

        # 6) node_to_node_link_data.csv => edges in original G
        node_to_node_link_df = link_data(G)
        node_to_node_link_df.to_csv(os.path.join(slice_dir,"node_to_node_link_data.csv"), index=False)

        # 7) coarse_graph_pos.csv => layout of coarse graph
        dfpos = coarse_graph_node_positions_to_df(pos)
        dfpos.to_csv(os.path.join(slice_dir,"coarse_graph_pos.csv"), index=False)

        # 8) Build a node DataFrame with centralities + partition + volatility
        new_data = data_transformation(G, partition)  # node,centrality,community,density
        # add betweenness, closeness, eigen, random volatility
        new_data = add_centralities_measures_and_volatility(new_data, G, node_volatility)

        # store node 'type' (incoming/outgoing) if any
        # store node 'name' if any
        node_types = []
        node_names = []
        for n in new_data["node"]:
            node_types.append(G.nodes[n].get("type",""))  # e.g. "incoming","outgoing","outandin"
            node_names.append(G.nodes[n].get("name", str(n)))  # if "name" is stored, else fallback to str(n)
        new_data["type"] = node_types
        new_data["name"] = node_names

        # final -> facebook_data_transformed_new.csv
        new_data.to_csv(os.path.join(slice_dir,"facebook_data_transformed_new.csv"), index=False)

        # 9) new_extent_without_outliers_for_colorcoding.json
        extents = dictAfterOutlierRemovalFromDifferentCentralitities(new_data)
        with open(os.path.join(slice_dir,"new_extent_without_outliers_for_colorcoding.json"),"w") as f:
            json.dump(extents, f,
                default=lambda x: int(x) if isinstance(x, np.int64) else float(x))

        # 10) community counts => commuity_count.csv
        df_comm_count = nodes_in_communities(partition).sort_values(by="count")
        df_comm_count.to_csv(os.path.join(slice_dir,"commuity_count.csv"), index=False)

        # 11) community density => commuity_density.csv
        df_comm_density = density_in_communities(partition, G)
        df_comm_density.to_csv(os.path.join(slice_dir,"commuity_density.csv"), index=False)

        # 12) highest degree => commuity_h_degree.csv
        df_h_degree = heighest_degree(new_data, partition)
        df_h_degree.to_csv(os.path.join(slice_dir,"commuity_h_degree.csv"), index=False)

        # 13) heatmap => heatmap_data.csv
        df_heatmap = heatmap_data_generator(partition, link_df_sym)
        df_heatmap.to_csv(os.path.join(slice_dir,"heatmap_data.csv"), index=False)

        # optionally reorder by size or do "facebook_data_transformed_new_by_size.csv"
        # done timeslice


#######################
# HELPER FUNCTIONS
#######################

def create_dictionary_of_connections(G):
    """
    Return dict { nodeID -> [neighborNodeIDs,...] }.
    So 'connection_list.json' will have node IDs as keys and integer node IDs as neighbors.
    """
    connections = {}
    for n in G.nodes():
        neighbors = list(G.neighbors(n))
        connections[n] = neighbors
    return connections

def link_data_community(induced_coarse_graph):
    rows = []
    for u,v,a in induced_coarse_graph.edges(data=True):
        if u!=v:
            w = a.get('weight',1)
            rows.append({'source':u,'target':v,'weight':w})
    return pd.DataFrame(rows)

def link_data_symmetry(induced_coarse_graph):
    rows = []
    for u,v,a in induced_coarse_graph.edges(data=True):
        if u!=v:
            w = a.get('weight',1)
            rows.append({'source':u,'target':v,'weight':w})
            rows.append({'source':v,'target':u,'weight':w})
    return pd.DataFrame(rows)

def link_data(G):
    rows = []
    for u,v,a in G.edges(data=True):
        if u!=v:
            et = a.get('type','')
            rows.append({'source':u,'target':v,'type':et})
    return pd.DataFrame(rows)

def coarse_graph_node_positions_to_df(pos):
    rows = []
    for node,(x,y) in pos.items():
        rows.append({'node':node,'x_pos':x,'y_pos':y})
    return pd.DataFrame(rows)

def data_transformation(G, partition):
    """
    original 'data_transformation' logic: 
      node->community, centrality=degree, plus a 'density' column repeated from subgraph density.
    """
    node_list = list(partition.keys())
    degs = []
    comms = []
    for n in node_list:
        degs.append(G.degree(n))
        comms.append(partition[n])

    df = pd.DataFrame({'node':node_list,'centrality':degs,'community':comms})
    df = ordering_nodes(df)

    # fill 'density' by subgraph approach
    from collections import defaultdict
    cdict = defaultdict(list)
    for n,c in partition.items():
        cdict[c].append(n)
    # compute each community's density
    dens_map = {}
    for c,members in cdict.items():
        subG = G.subgraph(members)
        dens_map[c] = density_of_subgraph(subG)

    densities = []
    for i, row in df.iterrows():
        c = row['community']
        densities.append(dens_map[c])
    df['density'] = densities

    return df

def add_centralities_measures_and_volatility(new_data, G, node_volatility):
    """
    1) betweenness, closeness, eigen
    2) add node_volatility if present
    """
    # betweenness, closeness
    betw = nx.betweenness_centrality(G)
    clo  = nx.closeness_centrality(G)
    # eigen fallback
    try:
        eig = nx.eigenvector_centrality(G, max_iter=1000, tol=1e-6)
    except nx.PowerIterationFailedConvergence:
        eig = nx.degree_centrality(G)

    # merge
    betw_df = pd.DataFrame({'node':list(betw.keys()), 'betwness':list(betw.values())})
    clo_df  = pd.DataFrame({'node':list(clo.keys()),  'closeness':list(clo.values())})
    eig_df  = pd.DataFrame({'node':list(eig.keys()),  'eign':list(eig.values())})

    # add them
    new_data = pd.merge(new_data, betw_df, on='node', how='left')
    new_data = pd.merge(new_data, clo_df,  on='node', how='left')
    new_data = pd.merge(new_data, eig_df,  on='node', how='left')

    # volatility
    vol_column = []
    for n in new_data["node"]:
        vol = node_volatility.get(n,0)
        vol_column.append(vol)
    new_data["volatility"] = vol_column

    new_data = ordering_nodes(new_data)
    return new_data


def ordering_nodes(df):
    if "community" in df.columns and "centrality" in df.columns:
        df = df.sort_values(by=["community","centrality"], ascending=[True,True])
    return df.reset_index(drop=True)

def density_of_subgraph(G_sub):
    n = len(G_sub.nodes())
    if n<=1:
        return 0
    e = len(G_sub.edges())
    max_e = n*(n-1)/2
    return e/max_e if max_e>0 else 0

def findOutlierRangeForInputCemtrality(series):
    Q1 = series.quantile(0.25)
    Q3 = series.quantile(0.75)
    IQR = Q3-Q1
    lower = Q1-1.5*IQR
    upper = Q3+1.5*IQR
    lb = max(lower, series.min())
    ub = min(upper, series.max())
    return [lb, ub]

def dictAfterOutlierRemovalFromDifferentCentralitities(df):
    """
    Build dict with keys like "degree_range","eign_range","closeness_range","volatility_range","betwness_range".
    """
    out = {}
    col_map = {
        'centrality':'degree_range',
        'betwness':'betwness_range',
        'closeness':'closeness_range',
        'eign':'eign_range',
        'volatility':'volatility_range',
    }
    for c, ckey in col_map.items():
        if c in df.columns:
            out[ckey] = findOutlierRangeForInputCemtrality(df[c])
    return out

def nodes_in_communities(partition):
    from collections import Counter
    c = Counter(partition.values())
    rows = []
    for comm_id, count in c.items():
        rows.append({'community':comm_id, 'count':count})
    return pd.DataFrame(rows)

def density_in_communities(partition, G):
    from collections import defaultdict
    cdict = defaultdict(list)
    for n,comm in partition.items():
        cdict[comm].append(n)
    rows=[]
    for c,members in cdict.items():
        subG = G.subgraph(members)
        d = density_of_subgraph(subG)
        rows.append({'community':c,'density':d})
    return pd.DataFrame(rows)

def heighest_degree(new_data, partition):
    """
    Similar to your code: find top row in each community after sorting desc by centrality
    """
    no_of_comms = len(set(partition.values()))
    df_sorted = new_data.sort_values(by=["community","centrality"], ascending=[True,False]).reset_index(drop=True)
    out=[]
    for c in range(no_of_comms):
        sub = df_sorted[df_sorted["community"]==c]
        if len(sub)==0:
            out.append({'community':c,'h_degree':0})
        else:
            out.append({'community':c,'h_degree':sub.iloc[0]["centrality"]})
    return pd.DataFrame(out)

def heatmap_data_generator(partition, link_df_sym):
    import itertools
    comms = sorted(set(partition.values()))
    combos = list(itertools.product(comms, comms))
    dfcomb = pd.DataFrame({'source':[c[0] for c in combos],'target':[c[1] for c in combos]})
    merged = dfcomb.merge(link_df_sym, how='left').fillna(0)
    return merged

def visualize(G, label_dict, pos):
    """
    If you want to show a quick layout in matplotlib. Otherwise optional.
    """
    #nx.draw(G, pos, labels=label_dict)
    #plt.show()
    pass

#############################
# MAIN
#############################

def main():
    # 1) Load your CSV
    # Example columns: Conference,Year,Title,AuthorNames-Deduped, ...
    input_csv = "InputData/infoVis2.csv"
    df = pd.read_csv(input_csv)

    # 2) Possibly filter by year or conference
    # df = df[df["Year"]>=2000]

    # 3) Build a global author->ID mapping, save "author_mapping.txt"
    author_mapping = build_author_mapping_from_csv(df)

    # 4) Figure out timeslice range
    minY = int(df["Year"].min())
    maxY = int(df["Year"].max())
    agg = 5
    time_slices = create_timeslices(minY,maxY,agg)

    # 5) Build graphs (co-author) using integer IDs
    graphs = create_graphs_from_csv(df, time_slices, author_mapping)

    # 6) Mark incoming/outgoing nodes, edges
    mark_incoming_outgoing_nodes(graphs)
    mark_incoming_outgoing_edges(graphs)

    # 7) Compute node volatility
    node_volatility = compute_node_volatility(graphs)

    # 8) Export data to e.g. "data" folder
    output_dir = "data"
    export_graphs(graphs, output_dir, node_volatility)

if __name__=="__main__":
    main()
