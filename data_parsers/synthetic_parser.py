#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate the full export bundle — for three synthetic benchmark
graphs instead of a publication CSV.

Datasets
--------
S : nx.chordal_cycle_graph(20)                 (  20 nodes)
M : nx.duplication_divergence_graph(120, 0.4)  ( 120 nodes)
L : nx.duplication_divergence_graph(10_000, 0.2) (10 000 nodes)

For every 5-year interval from 2000-2004 … 2020-2024 we build a *fresh*
Erdős-Rényi G(n, p) with exactly the same node set as its parent benchmark and
with edge-probability p chosen so that the expected density equals the density
of the benchmark graph.

The script then pipes every timeslice through the *exact* export pipeline that
`parse_vispub_csv_ids.py` already uses, giving

    synthetic_data/{S|M|L}/
        ├─ 2000-2004/
        │   ├─ connection_list.json
        │   ├─ link_data.csv
        │   ├─ node_to_node_link_data.csv
        │   ├─ coarse_graph_pos.csv
        │   ├─ facebook_data_transformed_new.csv
        │   ├─ new_extent_without_outliers_for_colorcoding.json
        │   ├─ commuity_count.csv
        │   ├─ commuity_density.csv
        │   ├─ commuity_h_degree.csv
        │   └─ heatmap_data.csv
        ├─ 2005-2009/
        └─ …

(plus an `author_mapping.txt` in the root of each dataset that simply maps
“node<i>” → <i>).

Usage
-----
    python generate_synthetic_network_slices.py

Requires
--------
    pip install networkx pandas python-louvain numpy matplotlib
"""
import os
import itertools
import numpy as np
import networkx as nx

# --- pull the heavy-lifting helpers straight from your original script ----------
from data_parsers.parse_vispub import (                 # type: ignore
    create_timeslices,
    mark_incoming_outgoing_nodes,
    mark_incoming_outgoing_edges,
    compute_node_volatility,
    export_graphs,
)

# ------------------------------------------------------------------------------
# helpers specific to this synthetic generator
# ------------------------------------------------------------------------------

def graph_density(G: nx.Graph) -> float:
    """Return 2m / (n(n-1)) — the standard undirected density."""
    n = G.number_of_nodes()
    if n <= 1:
        return 0.0
    m = G.number_of_edges()
    return 2 * m / (n * (n - 1))


def random_slice_graph(n_nodes: int, p: float, rng: np.random.Generator) -> nx.Graph:
    """Erdős-Rényi G(n,p) with integer nodes 0 … n-1."""
    G = nx.Graph()
    G.add_nodes_from(range(n_nodes))
    # iterate upper-triangular once; faster than nx.fast_gnp_random_graph for big n
    for u, v in itertools.combinations(range(n_nodes), 2):
        if rng.random() < p:
            G.add_edge(u, v)
    return G


def build_time_slices_for_dataset(
    base_graph: nx.Graph,
    time_slices,
    seed: int | None = None,
) -> dict[str, nx.Graph]:
    """
    For every (start, end) interval produce a *fresh* random graph that
    keeps the same vertex set but scrambles the edges.
    """
    n_nodes = base_graph.number_of_nodes()
    p = graph_density(base_graph)
    rng = np.random.default_rng(seed)
    graphs = {}
    for start, end in time_slices:
        tag = f"{start}-{end}"
        graphs[tag] = random_slice_graph(n_nodes, p, rng)
    return graphs


def dump_author_mapping(n_nodes: int, out_dir: str) -> None:
    """
    Mimic the original ‘author_mapping.txt’ but with synthetic names “node<i>”.
    """
    path = os.path.join(out_dir, "author_mapping.txt")
    with open(path, "w", encoding="utf-8") as fh:
        for i in range(n_nodes):
            fh.write(f"node{i}: {i}\n")


# ------------------------------------------------------------------------------
# main
# ------------------------------------------------------------------------------

def main() -> None:
    # --------------------------------------------------------------------------
    # 1) define datasets
    # --------------------------------------------------------------------------
    datasets = {
        "S": nx.chordal_cycle_graph(20),
        "M": nx.duplication_divergence_graph(120, 0.4, seed=42),
        "L": nx.duplication_divergence_graph(2_500, 0.2, seed=42),
    }

    # --------------------------------------------------------------------------
    # 2) time windows: five-year chunks from 2000 through 2024
    # --------------------------------------------------------------------------
    TIME_SLICES = create_timeslices(2000, 2024, agg=5)

    # --------------------------------------------------------------------------
    # 3) process each synthetic benchmark
    # --------------------------------------------------------------------------
    for tag, base_graph in datasets.items():
        print(f"[•] Generating dataset {tag}  (|V| = {base_graph.number_of_nodes():,})")

        raw_seed = hash(tag)                    # may be negative / > 2**32
        safe_seed = raw_seed & 0xFFFFFFFF       # force into 0 … 4 294 967 295
        # 3-a) build a *fresh* random graph per slice
        graphs = build_time_slices_for_dataset(base_graph, TIME_SLICES, seed=safe_seed)

        # 3-b) the rest of the pipeline is *identical* to the VisPub parser
        mark_incoming_outgoing_nodes(graphs)
        mark_incoming_outgoing_edges(graphs)
        node_volatility = compute_node_volatility(graphs)

        # 3-c) write exports
        out_root = os.path.join("synthetic_data", tag)
        os.makedirs(out_root, exist_ok=True)
        dump_author_mapping(base_graph.number_of_nodes(), out_root)
        export_graphs(graphs, out_root, node_volatility)

        print(f"    ↳ finished →  {out_root}")

    print("\n✔ All synthetic datasets exported.")


if __name__ == "__main__":
    main()
