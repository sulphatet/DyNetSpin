#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYNTHETIC VISPUB-STYLE DATASET ─ ONE SCALE-FREE GRAPH × 4 TIMESLICES
--------------------------------------------------------------------

* Barabási–Albert base graph   (2 500 ≤ |V| ≤ 3 500, 4 600 ≤ |E| ≤ 7 100)
* Four time-slices by 20 % random edge deletion
* Optional 5-node clique that appears/disappears
* Centralities, volatility, incoming/outgoing tags
* Community IDs are **renumbered by ascending community size**
  → large communities obtain the highest IDs → are drawn farthest out.
* Exports:
      connection_list.json
      link_data.csv
      node_to_node_link_data.csv
      coarse_graph_pos.csv
      facebook_data_transformed_new.csv
      new_extent_without_outliers_for_colorcoding.json
      commuity_count.csv
      commuity_density.csv
      commuity_h_degree.csv
      heatmap_data.csv
      author_mapping.txt            (root folder)
Usage
------
    python generate_synthetic_dataset.py
"""
from __future__ import annotations

import itertools, json, os, random
from collections import Counter
from typing import Dict, List

import networkx as nx
import numpy as np
import pandas as pd
import community                       # python-louvain

# ──────────────────────────  USER SETTINGS  ──────────────────────────
OUT_DIR          = "data/SyntheticDemo"
BASE_SEED        = 42
EDGE_DELETE_FRAC = 0.20
INJECT_CLIQUE    = True
NODES_RANGE      = (2_500, 3_500)           # inclusive
EDGES_RANGE      = (4_600, 7_100)           # inclusive
YEARS            = ["2000-2004", "2005-2009", "2010-2014", "2015-2019"]
# ─────────────────────────────────────────────────────────────────────

random.seed(BASE_SEED)
np.random.seed(BASE_SEED)


# ╭──────────────────────── 1 ▸ base graph ────────────────────────╮
def make_ba_graph() -> nx.Graph:
    """BA graph within NODES_RANGE ∧ EDGES_RANGE."""
    for _ in range(1_000):
        n = random.randint(*NODES_RANGE)
        for m in (1, 2, 3):                       # BA requires 1 ≤ m < n
            G = nx.barabasi_albert_graph(n, m, seed=BASE_SEED)
            if EDGES_RANGE[0] <= G.number_of_edges() <= EDGES_RANGE[1]:
                return G
    raise RuntimeError("Couldn't hit requested node/edge ranges.")


G_base = make_ba_graph()
print(f"Base  |V|={G_base.number_of_nodes():,}  |E|={G_base.number_of_edges():,}")

for n in G_base:
    G_base.nodes[n]["name"] = f"Author_{n}"


# ╭────────────────────── 2 ▸ build time-slices ───────────────────╮
def make_time_slices(G: nx.Graph, labels: List[str],
                     delete_frac: float) -> Dict[str, nx.Graph]:
    slices: Dict[str, nx.Graph] = {}
    edges = list(G.edges())
    keep = int((1 - delete_frac) * len(edges))
    for tag in labels:
        Gi = nx.Graph()
        Gi.add_nodes_from(G.nodes(data=True))
        Gi.add_edges_from(random.sample(edges, keep))
        slices[tag] = Gi
    return slices


graphs = make_time_slices(G_base, YEARS, EDGE_DELETE_FRAC)


# ╭─────────────────────── 3 ▸ inject clique ──────────────────────╮
if INJECT_CLIQUE:
    clique_nodes = random.sample(list(G_base), 5)
    for ts in random.sample(YEARS, random.randint(1, 3)):
        graphs[ts].add_edges_from(itertools.combinations(clique_nodes, 2))


# ╭────────────────── 4 ▸ incoming / outgoing tags ────────────────╮
def tag_nodes_and_edges(graphs: Dict[str, nx.Graph]) -> None:
    order = YEARS
    # nodes
    for i, ts in enumerate(order):
        cur = set(graphs[ts])
        if i > 0:
            prev = set(graphs[order[i-1]])
            for n in cur - prev:
                graphs[ts].nodes[n]["type"] = "incoming"
        if i < len(order)-1:
            nxt = set(graphs[order[i+1]])
            for n in cur - nxt:
                prev_type = graphs[ts].nodes[n].get("type")
                graphs[ts].nodes[n]["type"] = "outandin" if prev_type == "incoming" else "outgoing"
    # edges
    edge_sets = {ts: {frozenset(e) for e in G.edges()} for ts, G in graphs.items()}
    for i, ts in enumerate(order):
        cur = edge_sets[ts]
        if i > 0:
            for e in cur - edge_sets[order[i-1]]:
                u, v = tuple(e)
                graphs[ts][u][v]["type"] = "incoming"
        if i < len(order)-1:
            for e in cur - edge_sets[order[i+1]]:
                u, v = tuple(e)
                if "type" not in graphs[ts][u][v]:
                    graphs[ts][u][v]["type"] = "outgoing"


tag_nodes_and_edges(graphs)


# ╭───────────────────── 5 ▸ node volatility ──────────────────────╮
def volatility(graphs: Dict[str, nx.Graph]) -> Counter[int]:
    vol = Counter()
    for a, b in zip(YEARS[:-1], YEARS[1:]):
        vol.update(set(graphs[b]) - set(graphs[a]))
        vol.update(set(graphs[a]) - set(graphs[b]))
    return vol


node_vol = volatility(graphs)


# ╭──────────────────── 6 ▸ helper utilities ─────────────────────╮
def dens(G: nx.Graph) -> float:
    n = G.number_of_nodes()
    return 0 if n <= 1 else (2 * G.number_of_edges()) / (n * (n - 1))


def iqr_bounds(s: pd.Series) -> List[float]:
    q1, q3 = s.quantile([.25, .75])
    iqr = q3 - q1
    return [float(max(s.min(), q1 - 1.5 * iqr)),
            float(min(s.max(), q3 + 1.5 * iqr))]


# ╭───────────────────── 7 ▸ per-slice export ────────────────────╮
def export_slice(G: nx.Graph, tag: str, root: str) -> None:
    sd = os.path.join(root, tag)
    os.makedirs(sd, exist_ok=True)

    # community detection + ***SIZE-BASED RENAMING***
    part = community.best_partition(G, random_state=BASE_SEED)
    sizes = Counter(part.values())
    new_id = {old: idx for idx, old in
              enumerate(sorted(sizes, key=sizes.get))}        # small→0 … large→N-1
    part = {n: new_id[c] for n, c in part.items()}

    # coarse graph + layout
    Gc = community.induced_graph(part, G, weight="weight")
    pos = nx.spring_layout(Gc, k=10, weight="weight", seed=BASE_SEED)

    # connection_list.json
    with open(f"{sd}/connection_list.json", "w") as fh:
        json.dump({n: list(G.neighbors(n)) for n in G}, fh)

    # link_data.csv / node_to_node_link_data.csv
    pd.DataFrame([{"source": u, "target": v, "weight": a.get("weight", 1)}
                  for u, v, a in Gc.edges(data=True) if u != v]
                 ).to_csv(f"{sd}/link_data.csv", index=False)

    pd.DataFrame([{"source": u, "target": v, "type": a.get("type", "")}
                  for u, v, a in G.edges(data=True) if u != v]
                 ).to_csv(f"{sd}/node_to_node_link_data.csv", index=False)

    # coarse_graph_pos.csv
    pd.DataFrame([{"node": n, "x_pos": x, "y_pos": y}
                  for n, (x, y) in pos.items()]
                 ).to_csv(f"{sd}/coarse_graph_pos.csv", index=False)

    # node-level table
    df = pd.DataFrame({
        "node":       list(G),
        "centrality": [G.degree(n) for n in G],
        "community":  [part[n] for n in G],
        "name":       [G.nodes[n]["name"] for n in G],
        "type":       [G.nodes[n].get("type", "") for n in G],
        "volatility": [node_vol.get(n, 0) for n in G],
    })
    df["betwness"]  = pd.Series(nx.betweenness_centrality(G))
    df["closeness"] = pd.Series(nx.closeness_centrality(G))
    try:
        df["eign"] = pd.Series(nx.eigenvector_centrality(G, max_iter=500))
    except nx.PowerIterationFailedConvergence:
        df["eign"] = pd.Series(nx.degree_centrality(G))

    comm_den = {c: dens(G.subgraph([n for n, p in part.items() if p == c]))
                for c in set(part.values())}
    df["density"] = df["community"].map(comm_den)

    df = df.sort_values(["community", "centrality"])
    df.to_csv(f"{sd}/facebook_data_transformed_new.csv", index=False)

    # outlier-free extents
    with open(f"{sd}/new_extent_without_outliers_for_colorcoding.json", "w") as fh:
        json.dump({
            "degree_range":     iqr_bounds(df["centrality"]),
            "betwness_range":   iqr_bounds(df["betwness"]),
            "closeness_range":  iqr_bounds(df["closeness"]),
            "eign_range":       iqr_bounds(df["eign"]),
            "volatility_range": iqr_bounds(df["volatility"]),
        }, fh)

    # community-level CSVs
    cnt = Counter(part.values())
    pd.DataFrame([{"community": c, "count": cnt[c]} for c in cnt]
                 ).to_csv(f"{sd}/commuity_count.csv", index=False)
    pd.DataFrame([{"community": c, "density": comm_den[c]} for c in cnt]
                 ).to_csv(f"{sd}/commuity_density.csv", index=False)
    pd.DataFrame([{
        "community": c,
        "h_degree":  df[df["community"] == c]["centrality"].max()
    } for c in cnt]).to_csv(f"{sd}/commuity_h_degree.csv", index=False)

    # heatmap_data.csv
    coarse_edges = [{"source": u, "target": v, "weight": a.get("weight", 1)}
                    for u, v, a in Gc.edges(data=True) if u != v]
    coarse_edges += [{"source": e["target"], "target": e["source"],
                      "weight": e["weight"]} for e in coarse_edges]
    full = pd.DataFrame(itertools.product(cnt, cnt), columns=["source", "target"])
    pd.DataFrame(coarse_edges).merge(full, how="right").fillna(0
        ).to_csv(f"{sd}/heatmap_data.csv", index=False)


# ╭────────────────────── 8 ▸ write everything ───────────────────╮
os.makedirs(OUT_DIR, exist_ok=True)
for ts in YEARS:
    export_slice(graphs[ts], ts, OUT_DIR)

with open(f"{OUT_DIR}/author_mapping.txt", "w") as fh:
    for n in sorted(G_base):
        fh.write(f"{G_base.nodes[n]['name']}: {n}\n")

print("\n✔ Synthetic dataset written to", OUT_DIR)
print("  Slices:", ", ".join(YEARS))
