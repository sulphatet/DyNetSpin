#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Enron IPR Pipeline — Seed-Anchored PPR Communities
# ----------------------------------------------------
# Community detection replaced with anchor-based assignment:
#   each non-seed node is assigned to the seed with the highest
#   personalised PageRank score (argmax over all seeds).
# Community identity is therefore stable across slices by construction.

import os
import email
from email.utils import parsedate_to_datetime
import pandas as pd
import networkx as nx
import json
import itertools

KAGGLE_ZIP_PATH = "data/raw/archive.zip"
OUTPUT_DIR = "data/enron_ipr_new"

SEEDS_MAPPING = {
    "kenneth.lay@enron.com":     "Kenneth Lay",
    "jeff.skilling@enron.com":   "Jeffrey Skilling",
    "greg.whalley@enron.com":    "Greg Whalley",
    "david.delainey@enron.com":  "David Delainey",
    "richard.causey@enron.com":  "Richard Causey",
    "andrew.fastow@enron.com":   "Andrew Fastow",
    "jeff.mcmahon@enron.com":    "Jeff McMahon",
    "ben.glisan@enron.com":      "Ben Glisan",
    "john.lavorato@enron.com":   "John Lavorato",
    "louise.kitchen@enron.com":  "Louise Kitchen",
    "greg.piper@enron.com":      "Greg Piper",
    "mark.haedicke@enron.com":   "Mark Haedicke",
    "james.derrick@enron.com":   "James Derrick",
    "rick.buy@enron.com":        "Rick Buy",
    "vince.kaminski@enron.com":  "Vince Kaminski",
    "cindy.olson@enron.com":     "Cindy Olson",
    "sherron.watkins@enron.com": "Sherron Watkins",
    "mark.koenig@enron.com":     "Mark Koenig",
    "rebecca.mark@enron.com":    "Rebecca Mark",
    "mark.palmer@enron.com":     "Mark Palmer",
}

SEEDS_TGT_COUNT = 800
PPR_ALPHA = 0.85


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean_address(addr):
    if not isinstance(addr, str):
        return None
    addr = str(addr).lower().strip()
    addr = addr.replace('<', '').replace('>', '').replace('"', '').replace("'", '')
    if '@enron.com' in addr:
        return addr
    return None


def compute_seed_communities(G_t, seed_pids, alpha=PPR_ALPHA):
    """
    Assign every node in G_t to the seed whose personalised PageRank
    score is highest for that node (argmax).

    Parameters
    ----------
    G_t       : nx.Graph  — the slice graph (node IDs are integer pids)
    seed_pids : list[int] — pids of seeds present in G_t
    alpha     : float     — PPR damping factor

    Returns
    -------
    partition : dict {node_id: seed_pid}
        Seeds map to themselves.
        Nodes unreachable from every seed are omitted.
    """
    active_seeds = [s for s in seed_pids if s in G_t.nodes()]
    if not active_seeds:
        # Fallback: all nodes in one dummy community (shouldn't happen)
        return {n: -1 for n in G_t.nodes()}

    # Run one PPR per seed
    seed_ppr = {}
    for seed_pid in active_seeds:
        pers = {n: 0.0 for n in G_t.nodes()}
        pers[seed_pid] = 1.0
        try:
            ppr = nx.pagerank(
                G_t,
                alpha=alpha,
                personalization=pers,
                weight='WEIGHT',
                tol=1e-6,
                max_iter=200,
            )
            seed_ppr[seed_pid] = ppr
        except nx.PowerIterationFailedConvergence:
            print(f"  PPR did not converge for seed {seed_pid} — skipping.")

    if not seed_ppr:
        return {n: active_seeds[0] for n in G_t.nodes()}

    # Assign each node to its argmax seed
    partition = {}
    for node in G_t.nodes():
        if node in seed_ppr:
            # Seeds belong to themselves
            partition[node] = node
            continue
        best_seed = None
        best_score = -1.0
        for seed_pid, ppr in seed_ppr.items():
            score = ppr.get(node, 0.0)
            if score > best_score:
                best_score = score
                best_seed = seed_pid
        if best_seed is not None and best_score > 0.0:
            partition[node] = best_seed
        # Nodes with zero score from every seed are left out of the partition.
        # They will be absent from downstream data frames (same behaviour as
        # Leiden nodes that fall into tiny singleton communities).

    return partition


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_kaggle_to_dataframe():
    cache_path = "data/raw/enron_edgelist_cache.csv"
    if os.path.exists(cache_path):
        print("Loading cached edgelist...")
        df = pd.read_csv(cache_path)
        return df.dropna(subset=['From', 'To'])

    print("Parsing Kaggle dataset from archive.zip...")
    edges = []
    count = 0

    for chunk in pd.read_csv(KAGGLE_ZIP_PATH, chunksize=10000):
        for msg_str in chunk['message']:
            count += 1
            if count % 50000 == 0:
                print(f"  Processed {count} emails…")

            msg = email.message_from_string(msg_str)
            date_str = msg.get('Date')
            sender   = msg.get('From')
            to       = msg.get('To')
            cc       = msg.get('Cc')

            if not date_str or not sender:
                continue
            try:
                dt   = parsedate_to_datetime(date_str)
                year = dt.year
            except Exception:
                continue

            sender_clean = clean_address(sender)
            if not sender_clean:
                continue

            recipients = []
            if to: recipients.extend(to.replace('\n', '').split(','))
            if cc: recipients.extend(cc.replace('\n', '').split(','))

            for rec in recipients:
                rec_clean = clean_address(rec)
                if rec_clean and rec_clean != sender_clean:
                    edges.append({'From': sender_clean, 'To': rec_clean, 'Year': year})

    df = pd.DataFrame(edges)
    df.to_csv(cache_path, index=False)
    return df


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline():
    df = parse_kaggle_to_dataframe()

    print(f"Total raw edges: {len(df)}")
    df = df[df['Year'].isin([1999, 2000, 2001, 2002])]
    print(f"Edges in 1999–2002: {len(df)}")

    edge_weights = df.groupby(['From', 'To', 'Year']).size().reset_index(name='Weight')

    # Build union graph for PPR pool selection
    G_union = nx.DiGraph()
    for _, row in edge_weights.iterrows():
        u, v, w = row['From'], row['To'], row['Weight']
        if G_union.has_edge(u, v):
            G_union[u][v]['weight'] += w
        else:
            G_union.add_edge(u, v, weight=w)

    seeds = list(SEEDS_MAPPING.keys())
    valid_seeds = [s for s in seeds if s in G_union.nodes()]
    print(f"Seeds found in union graph: {len(valid_seeds)} / {len(seeds)}")
    missing = set(seeds) - set(valid_seeds)
    if missing:
        print("  Missing seeds (not in corpus):")
        for m in sorted(missing):
            print(f"    {m}")
    if not valid_seeds:
        print("No seeds found — aborting.")
        return

    # --- Iterated PPR to select core 800 nodes ---
    personalization = {n: 0.0 for n in G_union.nodes()}
    for s in valid_seeds:
        personalization[s] = 1.0 / len(valid_seeds)

    print("Iterated PPR — pass 1…")
    ppr1   = nx.pagerank(G_union, alpha=PPR_ALPHA, personalization=personalization,
                         weight='weight', tol=1e-6)
    top500 = sorted(ppr1, key=ppr1.__getitem__, reverse=True)[:500]

    personalization2 = {n: 0.0 for n in G_union.nodes()}
    for s in top500:
        personalization2[s] = 1.0 / len(top500)

    print("Iterated PPR — pass 2…")
    ppr2   = nx.pagerank(G_union, alpha=PPR_ALPHA, personalization=personalization2,
                         weight='weight', tol=1e-6)
    top800 = sorted(ppr2, key=ppr2.__getitem__, reverse=True)[:SEEDS_TGT_COUNT]

    selected_nodes = set(top800)
    author_mapping = {n: i for i, n in enumerate(sorted(selected_nodes))}

    print(f"Core node pool: {len(selected_nodes)}")

    # Warn if any valid seed fell outside the top-800
    dropped_seeds = [s for s in valid_seeds if s not in selected_nodes]
    if dropped_seeds:
        print("  WARNING — these seeds were not in top-800 and will be absent:")
        for d in dropped_seeds:
            print(f"    {d}")

    # --- Persist node metadata ---
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(os.path.join(OUTPUT_DIR, "author_mapping.txt"), "w") as f:
        for p_email, pid in author_mapping.items():
            if p_email in SEEDS_MAPPING:
                f.write(f"{SEEDS_MAPPING[p_email]}_ENRON_{p_email}: {pid}\n")
            else:
                f.write(f"{p_email.split('@')[0]}_ENRON_{p_email}: {pid}\n")

    seed_metadata = {}
    for p_email, pid in author_mapping.items():
        if p_email in SEEDS_MAPPING:
            seed_metadata[str(pid)] = {"is_seed": True,  "name": SEEDS_MAPPING[p_email]}
        else:
            parts      = p_email.split('@')[0].split('.')
            clean_name = " ".join(p.capitalize() for p in parts)
            seed_metadata[str(pid)] = {"is_seed": False, "name": clean_name}

    with open(os.path.join(OUTPUT_DIR, "seed_metadata.json"), "w") as f:
        json.dump(seed_metadata, f, indent=2)

    # --- Build per-year slice graphs ---
    graphs_by_year = {}
    for year in [1999, 2000, 2001, 2002]:
        df_year = edge_weights[edge_weights['Year'] == year]
        G_t = nx.Graph()
        for _, row in df_year.iterrows():
            u, v, w = row['From'], row['To'], row['Weight']
            if u in selected_nodes and v in selected_nodes:
                uid, vid = author_mapping[u], author_mapping[v]
                if G_t.has_edge(uid, vid):
                    G_t[uid][vid]['WEIGHT'] += w
                else:
                    G_t.add_edge(uid, vid, WEIGHT=w)
        graphs_by_year[year] = G_t

    # --- Volatility (node appearance/disappearance across slices) ---
    node_volatility = {}
    sorted_slices   = sorted(graphs_by_year.keys())
    for i in range(1, len(sorted_slices)):
        prev = set(graphs_by_year[sorted_slices[i - 1]].nodes())
        curr = set(graphs_by_year[sorted_slices[i]].nodes())
        for n in (curr - prev) | (prev - curr):
            node_volatility[n] = node_volatility.get(n, 0) + 1

    max_vol = max(node_volatility.values()) if node_volatility else 1

    for i, ts in enumerate(sorted_slices):
        G_t        = graphs_by_year[ts]
        curr_nodes = set(G_t.nodes())
        prev_nodes = set(graphs_by_year[sorted_slices[i - 1]].nodes()) if i > 0           else set()
        next_nodes = set(graphs_by_year[sorted_slices[i + 1]].nodes()) if i < len(sorted_slices) - 1 else set()

        for n in curr_nodes:
            is_in  = n not in prev_nodes
            is_out = n not in next_nodes
            if   is_in  and is_out: ntype = "outandin"
            elif is_in:             ntype = "incoming"
            elif is_out:            ntype = "outgoing"
            else:                   ntype = "neither"
            G_t.nodes[n]["type"]       = ntype
            G_t.nodes[n]["volatility"] = node_volatility.get(n, 0) / max_vol

    # --- Seed pid list (integer IDs) for community assignment ---
    seed_pids = [author_mapping[e] for e in valid_seeds if e in author_mapping]

    # --- Per-year export ---
    print("\nCommunity Detection & File Export")
    from coarse_graph import (coarse_graph_node_positions_to_df,
                              create_dictionary_of_connections,
                              dictAfterOutlierRemovalFromDifferentCentralitities)

    for year in sorted_slices:
        G_t       = graphs_by_year[year]
        slice_dir = os.path.join(OUTPUT_DIR, str(year))
        os.makedirs(slice_dir, exist_ok=True)

        if len(G_t.edges()) == 0:
            print(f"Year {year}: empty graph — skipping.")
            continue

        print(f"\nYear {year}: {len(G_t.nodes())} nodes, {len(G_t.edges())} edges")

        # ----------------------------------------------------------------
        # COMMUNITY ASSIGNMENT — seed-anchored PPR (replaces Leiden/Louvain)
        # Community ID for each node == the integer pid of its argmax seed.
        # Seeds belong to themselves; identity is stable across slices.
        # ----------------------------------------------------------------
        partition = compute_seed_communities(G_t, seed_pids, alpha=PPR_ALPHA)

        # Diagnostic summary
        active_anchors = set(partition.values())
        print(f"  Communities (one per active seed): {len(active_anchors)}")
        for sp in sorted(active_anchors):
            members = [n for n, c in partition.items() if c == sp]
            anchor_email = next((e for e, pid in author_mapping.items() if pid == sp), str(sp))
            anchor_label = SEEDS_MAPPING.get(anchor_email, anchor_email)
            print(f"    {anchor_label:25s} (pid {sp}): {len(members):4d} nodes")

        # ----------------------------------------------------------------
        # Remap community IDs to contiguous 0..N-1 integers.
        # coarse_graph_node_positions_to_df (and downstream JS) expects
        # community IDs to be 0-indexed.  Sorting seed pids is deterministic,
        # so the same seed always gets the same index across slices.
        # ----------------------------------------------------------------
        sorted_anchors = sorted(active_anchors)          # stable ordering
        anchor_to_idx  = {sp: i for i, sp in enumerate(sorted_anchors)}
        idx_to_anchor  = {i: sp for sp, i in anchor_to_idx.items()}  # inverse

        # partition_idx  : {node -> 0..N-1 community index}  — used in all file output
        # partition       : {node -> seed_pid}               — used only for anchor name lookups
        partition_idx = {n: anchor_to_idx[c] for n, c in partition.items()}
        active_idx    = set(partition_idx.values())       # == {0, 1, …, N-1}

        # ----------------------------------------------------------------
        # Induced coarse graph  (community → community edges)
        # ----------------------------------------------------------------
        induced_coarse_graph = nx.Graph()
        induced_coarse_graph.add_nodes_from(active_idx)
        for u, v, d in G_t.edges(data=True):
            # Only edges where both endpoints are assigned
            if u not in partition_idx or v not in partition_idx:
                continue
            c_u, c_v = partition_idx[u], partition_idx[v]
            w = d.get('WEIGHT', 1)
            if induced_coarse_graph.has_edge(c_u, c_v):
                induced_coarse_graph[c_u][c_v]['WEIGHT'] += w
            else:
                induced_coarse_graph.add_edge(c_u, c_v, WEIGHT=w)

        pos    = nx.spring_layout(induced_coarse_graph, k=10, weight='WEIGHT', seed=42)
        df_pos = coarse_graph_node_positions_to_df(pos)
        df_pos.to_csv(f'{slice_dir}/coarse_graph_pos.csv', index=False)

        # connection_list
        connection_dict = create_dictionary_of_connections(G_t)
        with open(f"{slice_dir}/connection_list.json", "w") as f:
            json.dump(connection_dict, f)

        # link_data  (coarse graph edges)
        source, target, weight = [], [], []
        source_sym, target_sym, weight_sym = [], [], []
        for u, v, d in induced_coarse_graph.edges(data=True):
            if u != v:
                source.append(u);   target.append(v);   weight.append(d['WEIGHT'])
                source_sym.append(u); target_sym.append(v); weight_sym.append(d['WEIGHT'])
                source_sym.append(v); target_sym.append(u); weight_sym.append(d['WEIGHT'])

        pd.DataFrame({'source': source, 'target': target, 'weight': weight}) \
          .to_csv(f'{slice_dir}/link_data.csv', index=False)

        # heatmap_data
        link_df_sym = pd.DataFrame({'source': source_sym, 'target': target_sym, 'weight': weight_sym})
        c_sources   = list(active_idx)
        if len(link_df_sym) > 0:
            comb_df      = pd.DataFrame(list(itertools.product(c_sources, c_sources)),
                                        columns=['source', 'target'])
            heatmap_data = comb_df.merge(link_df_sym, how='left', on=['source', 'target']).fillna(0)
        else:
            heatmap_data = pd.DataFrame(columns=['source', 'target', 'weight'])
        heatmap_data.to_csv(f'{slice_dir}/heatmap_data.csv', index=False)

        # node-to-node link data
        n_src, n_tgt = zip(*[(u, v) for u, v in G_t.edges() if u != v]) \
                       if G_t.edges() else ([], [])
        pd.DataFrame({'source': list(n_src), 'target': list(n_tgt)}) \
          .to_csv(f'{slice_dir}/node_to_node_link_data.csv', index=False)

        # ----------------------------------------------------------------
        # Node feature table
        # ----------------------------------------------------------------
        # pid_to_label: seed pid -> human-readable name (for anchor_name col)
        pid_to_label = {pid: SEEDS_MAPPING[email]
                        for email, pid in author_mapping.items()
                        if email in SEEDS_MAPPING}

        node         = list(partition_idx.keys())
        community_id = [partition_idx[n] for n in node]   # 0..N-1
        centrality   = [G_t.degree(n)    for n in node]
        # anchor_name: resolve via original pid-keyed partition -> human label
        anchor_names = [pid_to_label.get(partition[n], str(partition[n])) for n in node]

        df_nodes = pd.DataFrame({
            'node':        node,
            'centrality':  centrality,
            'community':   community_id,
            'anchor_name': anchor_names,
        })

        # Subgraph density per community
        densities = []
        for c in community_id:
            subg_nodes = [k for k, v in partition_idx.items() if v == c]
            subg       = G_t.subgraph(subg_nodes)
            n_sg       = len(subg.nodes())
            densities.append(
                len(subg.edges()) / (n_sg * (n_sg - 1) / 2) if n_sg > 1 else 0.0
            )
        df_nodes['density'] = densities

        # Centrality measures
        try:
            eig = nx.eigenvector_centrality(G_t, max_iter=1000, tol=1e-6)
        except Exception:
            eig = nx.degree_centrality(G_t)

        betw = nx.betweenness_centrality(G_t)
        clo  = nx.closeness_centrality(G_t)

        df_nodes['eign']       = df_nodes['node'].map(eig)
        df_nodes['betwness']   = df_nodes['node'].map(betw)
        df_nodes['closeness']  = df_nodes['node'].map(clo)
        df_nodes['volatility'] = df_nodes['node'].apply(lambda n: G_t.nodes[n].get("volatility", 0.5))
        df_nodes['name']       = df_nodes['node'].apply(
            lambda x: seed_metadata[str(x)]['name'] if str(x) in seed_metadata else str(x)
        )
        df_nodes['type']       = df_nodes['node'].apply(lambda n: G_t.nodes[n].get("type", "neither"))

        df_nodes.to_csv(f'{slice_dir}/facebook_data_transformed_new.csv', index=False)

        try:
            dict_outliers = dictAfterOutlierRemovalFromDifferentCentralitities(df_nodes)
            with open(f'{slice_dir}/new_extent_without_outliers_for_colorcoding.json', "w") as f:
                json.dump(dict_outliers, f)
        except Exception:
            pass

        # Community summary files  (use active_idx — contiguous 0..N-1)
        unique_communities = list(active_idx)
        counts = [sum(v == c for v in partition_idx.values()) for c in unique_communities]
        pd.DataFrame({'community': unique_communities, 'count': counts}) \
          .sort_values('count') \
          .to_csv(f'{slice_dir}/commuity_count.csv', index=False)

        dens2 = []
        for c in unique_communities:
            subg = G_t.subgraph([k for k, v in partition_idx.items() if v == c])
            n_n  = len(subg.nodes())
            dens2.append(len(subg.edges()) / (n_n * (n_n - 1) / 2) if n_n > 1 else 0.0)
        pd.DataFrame({'community': unique_communities, 'density': dens2}) \
          .to_csv(f'{slice_dir}/commuity_density.csv', index=False)

        # h_degree (lowest-degree node per community)
        df_hd    = df_nodes.sort_values(['community', 'centrality']).reset_index(drop=True)
        h_degree, c_list = [], []
        for c in unique_communities:
            c_list.append(c)
            c_members = df_hd[df_hd['community'] == c]
            h_degree.append(c_members.iloc[0]['centrality'] if len(c_members) > 0 else 0)
        pd.DataFrame({'community': c_list, 'h_degree': h_degree}) \
          .to_csv(f'{slice_dir}/commuity_h_degree.csv', index=False)

    print("\nPipeline complete. Output in:", OUTPUT_DIR)


if __name__ == '__main__':
    run_pipeline()