#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
uci_parse.py
--------------------------------------------
Download and convert the SNAP "CollegeMsg" temporal
messaging network (UCI online social network) into a
SpinTrix-compatible multi-timeslice dataset.

INPUT
------
SNAP URL:
  https://snap.stanford.edu/data/CollegeMsg.txt.gz
Format: SRC  DST  UNIXTS  (whitespace-separated; directed messages)

OUTPUT
------
data/<dataset_slug>/
  author_mapping.txt
  <slice_label>/facebook_data_transformed_new.csv
  <slice_label>/node_to_node_link_data.csv
  <slice_label>/link_data.csv
  <slice_label>/coarse_graph_pos.csv
  <slice_label>/connection_list.json
  <slice_label>/new_extent_without_outliers_for_colorcoding.json
  <slice_label>/commuity_count.csv
  <slice_label>/commuity_density.csv
  <slice_label>/commuity_h_degree.csv
  <slice_label>/heatmap_data.csv

CONFIGURABLE
------------
--dataset-slug     name of output folder under data/   (default: uci_college)
--slices N         number of temporal slices            (default: 4)
--min-messages M   drop nodes with <M messages total    (default: 1)
--no-download      assume file already present locally
--raw-path PATH    manually supply path to CollegeMsg.txt(.gz)

NOTES
-----
* Communities are computed per slice via Louvain (python-louvain)
  on an undirected, weighted graph where weight = message count u<->v.
* Node volatility & types (incoming/outgoing/outandin) are computed
  AFTER all slices are built (global pass).
* Density for each community is edge-density of the node-induced subgraph
  (unweighted).
* Spring layout for coarse community graph seeded deterministically.
* Synthetic slice labels are generated from *elapsed days* from the earliest
  timestamp, zero-padded, e.g., "000-048".  Use these labels in your JS
  `years` array. First slice is your T0.

Author: (you)
"""

import os
import gzip
import json
import math
import argparse
import collections
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import networkx as nx
#import community as community_louvain  # python-louvain
import community.community_louvain as community_louvain

import requests
from tqdm import tqdm

# ------------------------------------------------------------------
# CONSTANTS
# ------------------------------------------------------------------
SNAP_URL = "https://snap.stanford.edu/data/CollegeMsg.txt.gz"
DEFAULT_DATASET_SLUG = "uci_college"
RANDOM_SEED = 42  # reproducibility for layouts / louvain where possible


# ------------------------------------------------------------------
# UTIL
# ------------------------------------------------------------------
def log(msg):
    print(msg, flush=True)


def download_if_needed(url: str, out_path: Path, force: bool = False):
    """Download a URL to out_path if file missing OR force==True."""
    if out_path.exists() and not force:
        log(f"✓ Found existing {out_path.name}, skipping download.")
        return
    log(f"↓ Downloading {url} → {out_path} …")
    r = requests.get(url, stream=True)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 20):
            if chunk:
                f.write(chunk)
    log("✓ Download complete.")


def read_college_msg(path: Path) -> pd.DataFrame:
    """
    Read CollegeMsg.txt or CollegeMsg.txt.gz into DataFrame
    columns: source, target, unix_ts
    """
    if path.suffix == ".gz":
        opener = gzip.open
    else:
        opener = open

    sources = []
    targets = []
    ts_list = []
    with opener(path, "rt") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) != 3:
                continue
            u, v, ts = parts
            sources.append(int(u))
            targets.append(int(v))
            ts_list.append(int(ts))
    df = pd.DataFrame({"source": sources, "target": targets, "unix_ts": ts_list})
    df.sort_values("unix_ts", inplace=True, ignore_index=True)
    return df


def compute_slice_edges(df: pd.DataFrame, n_slices: int):
    """
    Assign each edge to one of N equal‑span *timestamp* bins.
    Returns df with added 'slice' int column (0..n_slices-1).
    """
    min_ts = df["unix_ts"].min()
    max_ts = df["unix_ts"].max()
    # Slight epsilon so max falls in last bin
    bins = np.linspace(min_ts, max_ts + 1, n_slices + 1)
    df["slice"] = np.digitize(df["unix_ts"], bins, right=False) - 1
    df["slice"] = df["slice"].clip(lower=0, upper=n_slices - 1)
    return df, bins


def slice_label_from_days(day_start: int, day_end: int) -> str:
    """
    Build zero‑padded numeric label "000-048" from day indices.
    Enough to sort lexicographically & numerically.
    """
    return f"{day_start:03d}-{day_end:03d}"


def build_slice_labels(df: pd.DataFrame, bins) -> list[str]:
    """
    Convert timestamp bins to elapsed‐day labels.
    """
    min_ts = df["unix_ts"].min()
    # convert bin edges to day offsets
    day_edges = ((bins - min_ts) / 86400.0).astype(int)
    labels = []
    for i in range(len(day_edges) - 1):
        labels.append(slice_label_from_days(int(day_edges[i]), int(day_edges[i + 1] - 1)))
    return labels


def deg_centrality_raw(G: nx.Graph) -> dict:
    """Return raw integer degree for each node."""
    return dict(G.degree())


def normalized_dict_values(d: dict) -> dict:
    """Normalize values in dict to 0..1 scale (avoid div0)."""
    if not d:
        return {}
    mx = max(d.values()) or 1.0
    return {k: v / mx for k, v in d.items()}


def density_of_subgraph(G_sub: nx.Graph) -> float:
    n = G_sub.number_of_nodes()
    if n <= 1:
        return 0.0
    e = G_sub.number_of_edges()
    max_e = n * (n - 1) / 2
    return float(e) / max_e if max_e > 0 else 0.0


def find_outlier_range(arr: np.ndarray) -> list[float]:
    if arr.size == 0:
        return [0.0, 0.0]
    q1, q3 = np.percentile(arr, [25, 75])
    iqr = q3 - q1
    lb = max(arr.min(), q1 - 1.5 * iqr)
    ub = min(arr.max(), q3 + 1.5 * iqr)
    return [float(lb), float(ub)]


def safe_mkdir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------
# COMMUNITY → coarse graph helpers
# ------------------------------------------------------------------
def induced_coarse_graph(partition: dict, G: nx.Graph) -> nx.Graph:
    """
    Build a weighted community graph: nodes=community ids,
    edge weight = count of edges that cross communities.
    """
    coarse = nx.Graph()
    for n, c in partition.items():
        coarse.add_node(c)
    # accumulate weights
    for u, v, data in G.edges(data=True):
        cu = partition[u]
        cv = partition[v]
        if cu == cv:
            continue
        w = data.get("weight", 1)
        if coarse.has_edge(cu, cv):
            coarse[cu][cv]["weight"] += w
        else:
            coarse.add_edge(cu, cv, weight=w)
    return coarse


def louvain_partition(G: nx.Graph, seed=RANDOM_SEED) -> dict:
    """python-louvain wrapper; returns node→community id."""
    if G.number_of_nodes() == 0:
        return {}
    # python-louvain uses a random process; set seed
    return community_louvain.best_partition(G, random_state=seed, weight="weight")


# ------------------------------------------------------------------
# VOLATILITY & NODE TYPE (incoming/outgoing/outandin)
# ------------------------------------------------------------------
@dataclass
class SliceMeta:
    label: str
    nodes: set
    edges: set  # frozenset pairs (u,v) with u<v


def derive_node_types(slice_meta_list: list[SliceMeta]) -> dict[str, dict[int, str]]:
    """
    For each slice label, produce node type classification dict:
      "incoming"  – node absent previous slice
      "outgoing"  – node absent next slice
      "outandin"  – both incoming & outgoing (isolated to single slice)
      ""          – present both sides
    Returns: {slice_label -> {nodeID -> typeStr}}
    """
    out = {}
    for i, sm in enumerate(slice_meta_list):
        prev_nodes = slice_meta_list[i - 1].nodes if i > 0 else set()
        next_nodes = slice_meta_list[i + 1].nodes if i < len(slice_meta_list) - 1 else set()

        types = {}
        for n in sm.nodes:
            inc = n not in prev_nodes
            outg = n not in next_nodes
            if inc and outg:
                types[n] = "outandin"
            elif inc:
                types[n] = "incoming"
            elif outg:
                types[n] = "outgoing"
            else:
                types[n] = ""
        out[sm.label] = types
    return out


def derive_edge_types(slice_meta_list: list[SliceMeta]) -> dict[str, dict[tuple, str]]:
    """
    Same as above but for edges (undirected frozensets).
    """
    out = {}
    for i, sm in enumerate(slice_meta_list):
        prev_edges = slice_meta_list[i - 1].edges if i > 0 else set()
        next_edges = slice_meta_list[i + 1].edges if i < len(slice_meta_list) - 1 else set()

        types = {}
        for e in sm.edges:
            inc = e not in prev_edges
            outg = e not in next_edges
            if inc and outg:
                types[e] = "outandin"
            elif inc:
                types[e] = "incoming"
            elif outg:
                types[e] = "outgoing"
            else:
                types[e] = ""
        out[sm.label] = types
    return out


def compute_volatility(slice_meta_list: list[SliceMeta]) -> dict[int, int]:
    """
    Node volatility = # of appearance/disappearance events across slice boundaries.
    """
    sorted_nodes = set().union(*[sm.nodes for sm in slice_meta_list])
    appear_disappear = {n: 0 for n in sorted_nodes}

    for i in range(1, len(slice_meta_list)):
        prev_nodes = slice_meta_list[i - 1].nodes
        curr_nodes = slice_meta_list[i].nodes
        for n in curr_nodes - prev_nodes:
            appear_disappear[n] += 1
        for n in prev_nodes - curr_nodes:
            appear_disappear[n] += 1
    return appear_disappear


# ------------------------------------------------------------------
# EXPORT PER SLICE
# ------------------------------------------------------------------
def export_slice(
    label: str,
    slice_df: pd.DataFrame,
    out_dir: Path,
    min_messages: int,
    global_name_map: dict[int, str],
):
    """
    Build a per-slice NetworkX graph, run communities, compute centralities,
    and export all per-slice files *except* final volatility & type fields
    (those are patched in global pass).
    Returns slice metadata (nodes, edges) + partition.
    """
    log(f"   • slice {label}: {len(slice_df)} messages")

    if slice_df.empty:
        safe_mkdir(out_dir)
        # empty placeholder files to keep pipeline from choking
        for fn in [
            "facebook_data_transformed_new.csv",
            "node_to_node_link_data.csv",
            "link_data.csv",
            "coarse_graph_pos.csv",
            "connection_list.json",
            "new_extent_without_outliers_for_colorcoding.json",
            "commuity_count.csv",
            "commuity_density.csv",
            "commuity_h_degree.csv",
            "heatmap_data.csv",
        ]:
            (out_dir / fn).write_text("")
        return SliceMeta(label=label, nodes=set(), edges=set()), {}

    # ------------------------------------------------------------------
    # Aggregate directed messages into undirected weighted edges
    # (weight = total # of messages in either direction between u & v)
    # ------------------------------------------------------------------
    agg_counts = (
        slice_df.groupby(["source", "target"]).size().reset_index(name="w")
    )

    # Add reversed edges, then group min(u,v), max(u,v) to get undirected counts
    agg_counts_rev = agg_counts.rename(columns={"source": "target", "target": "source"})
    agg_both = pd.concat([agg_counts, agg_counts_rev], ignore_index=True)
    agg_both["u"] = agg_both[["source", "target"]].min(axis=1)
    agg_both["v"] = agg_both[["source", "target"]].max(axis=1)
    und = agg_both.groupby(["u", "v"])["w"].sum().reset_index()

    # filter out self-loops
    und = und[und["u"] != und["v"]].reset_index(drop=True)

    # Drop low-activity nodes if requested
    if min_messages > 1:
        # Node message participation
        counts_u = und.groupby("u")["w"].sum()
        counts_v = und.groupby("v")["w"].sum()
        counts = counts_u.add(counts_v, fill_value=0)
        keep_nodes = set(counts[counts >= min_messages].index.astype(int))
        und = und[und["u"].isin(keep_nodes) & und["v"].isin(keep_nodes)].reset_index(drop=True)
    else:
        keep_nodes = set(und["u"]).union(und["v"])

    # ------------------------------------------------------------------
    # Build graph
    # ------------------------------------------------------------------
    G = nx.Graph()
    for _, row in und.iterrows():
        u = int(row["u"]); v = int(row["v"]); w = int(row["w"])
        G.add_edge(u, v, weight=w)

    # Ensure isolated nodes present (if they sent/received but filtered out edges)
    # Build from raw slice participants
    raw_nodes = set(slice_df["source"]).union(set(slice_df["target"]))
    for n in raw_nodes:
        if n not in G:
            G.add_node(int(n))

    # ------------------------------------------------------------------
    # Community detection
    # ------------------------------------------------------------------
    if G.number_of_edges() > 0 and G.number_of_nodes() > 1:
        partition = community_louvain.best_partition(G)

    else:
        # trivial
        partition = {n: 0 for n in G.nodes()}

    # Guarantee dense community IDs 0..K-1
    uniq = sorted(set(partition.values()))
    remap = {old: new for new, old in enumerate(uniq)}
    partition = {n: remap[c] for n, c in partition.items()}

    # community membership sets for later metrics
    comm_sets = collections.defaultdict(set)
    for n, c in partition.items():
        comm_sets[c].add(n)

    # ------------------------------------------------------------------
    # Centralities
    # ------------------------------------------------------------------
    deg_raw = deg_centrality_raw(G)
    betw = nx.betweenness_centrality(G, weight="weight") if G.number_of_edges() else {n: 0 for n in G}
    clos = nx.closeness_centrality(G) if G.number_of_nodes() > 1 else {n: 0 for n in G}
    try:
        eig = nx.eigenvector_centrality(G, max_iter=1000, tol=1e-6, weight="weight")
    except nx.PowerIterationFailedConvergence:
        eig = normalized_dict_values(deg_raw)

    # ------------------------------------------------------------------
    # Density per community
    # ------------------------------------------------------------------
    comm_density = {}
    for cid, members in comm_sets.items():
        subG = G.subgraph(members)
        comm_density[cid] = density_of_subgraph(subG)

    # ------------------------------------------------------------------
    # Coarse community graph
    # ------------------------------------------------------------------
    coarse = induced_coarse_graph(partition, G)
    if coarse.number_of_nodes() > 0:
        pos = nx.spring_layout(coarse, seed=RANDOM_SEED, weight="weight")  # deterministic
    else:
        pos = {}

    # ------------------------------------------------------------------
    # connection_list.json  (adjacency on *node* graph)
    # ------------------------------------------------------------------
    conn = {int(n): [int(nei) for nei in G.neighbors(n)] for n in G.nodes()}

    # ------------------------------------------------------------------
    # node_to_node_link_data.csv (no type yet; patch later)
    # ------------------------------------------------------------------
    node_edges_rows = []
    for u, v, data in G.edges(data=True):
        node_edges_rows.append({"source": int(u), "target": int(v), "type": ""})
    node_edges_df = pd.DataFrame(node_edges_rows)

    # ------------------------------------------------------------------
    # link_data.csv  (coarse community edges)
    # ------------------------------------------------------------------
    coarse_rows = []
    for u, v, data in coarse.edges(data=True):
        coarse_rows.append({"source": int(u), "target": int(v), "weight": int(data.get("weight", 1))})
    coarse_df = pd.DataFrame(coarse_rows)

    # ------------------------------------------------------------------
    # coarse_graph_pos.csv
    # ------------------------------------------------------------------
    # pos coords (if empty coarse graph, create trivial 0,0)
    if pos:
        pos_rows = [{"node": int(cid), "x_pos": float(x), "y_pos": float(y)} for cid, (x, y) in pos.items()]
    else:
        pos_rows = [{"node": 0, "x_pos": 0.0, "y_pos": 0.0}]
    pos_df = pd.DataFrame(pos_rows)

    # ------------------------------------------------------------------
    # facebook_data_transformed_new.csv  (core node table – types patched later)
    # ------------------------------------------------------------------
    node_rows = []
    for n in G.nodes():
        cid = partition[n]
        node_rows.append({
            "node":       int(n),
            "centrality": int(deg_raw.get(n, 0)),  # degree
            "community":  int(cid),
            "density":    float(comm_density.get(cid, 0.0)),  # repeated per node
            "name":       global_name_map.get(n, f"User_{n}"),
            "type":       "",     # placeholder – will patch
            "betwness":   float(betw.get(n, 0.0)),
            "closeness":  float(clos.get(n, 0.0)),
            "eign":       float(eig.get(n, 0.0)),
            "volatility": 0.0,    # placeholder – will patch
        })
    nodes_df = pd.DataFrame(node_rows).sort_values(by=["community", "centrality"], ascending=[True, True])

    # ------------------------------------------------------------------
    # commuity_count.csv
    # ------------------------------------------------------------------
    cc_rows = []
    for cid, members in comm_sets.items():
        cc_rows.append({"community": int(cid), "count": len(members)})
    cc_df = pd.DataFrame(cc_rows).sort_values(by="community")

    # ------------------------------------------------------------------
    # commuity_density.csv
    # ------------------------------------------------------------------
    cd_rows = []
    for cid, dens in comm_density.items():
        cd_rows.append({"community": int(cid), "density": float(dens)})
    cd_df = pd.DataFrame(cd_rows).sort_values(by="community")

    # ------------------------------------------------------------------
    # commuity_h_degree.csv  (max degree per community)
    # ------------------------------------------------------------------
    hd_rows = []
    for cid, members in comm_sets.items():
        max_deg = max([deg_raw.get(n, 0) for n in members]) if members else 0
        hd_rows.append({"community": int(cid), "h_degree": int(max_deg)})
    hd_df = pd.DataFrame(hd_rows).sort_values(by="community")

    # ------------------------------------------------------------------
    # heatmap_data.csv  (community × community weight, symmetric rows)
    # ------------------------------------------------------------------
    # create full cartesian product so matrix draws square
    all_cids = sorted(comm_sets.keys())
    heat_rows = []
    w_lookup = {(r["source"], r["target"]): r["weight"] for r in coarse_rows}
    w_lookup.update({(r["target"], r["source"]): r["weight"] for r in coarse_rows})
    for c1 in all_cids:
        for c2 in all_cids:
            w = w_lookup.get((c1, c2), 0)
            heat_rows.append({"source": int(c1), "target": int(c2), "weight": int(w)})
    heat_df = pd.DataFrame(heat_rows)

    # ------------------------------------------------------------------
    # write files
    # ------------------------------------------------------------------
    safe_mkdir(out_dir)
    nodes_df.to_csv(out_dir / "facebook_data_transformed_new.csv", index=False)
    node_edges_df.to_csv(out_dir / "node_to_node_link_data.csv", index=False)
    coarse_df.to_csv(out_dir / "link_data.csv", index=False)
    pos_df.to_csv(out_dir / "coarse_graph_pos.csv", index=False)
    (out_dir / "connection_list.json").write_text(json.dumps(conn))
    # extent placeholder (patched after volatility)
    (out_dir / "new_extent_without_outliers_for_colorcoding.json").write_text("{}")
    cc_df.to_csv(out_dir / "commuity_count.csv", index=False)
    cd_df.to_csv(out_dir / "commuity_density.csv", index=False)
    hd_df.to_csv(out_dir / "commuity_h_degree.csv", index=False)
    heat_df.to_csv(out_dir / "heatmap_data.csv", index=False)

    # slice meta
    sm = SliceMeta(
        label=label,
        nodes=set(G.nodes()),
        edges=set(frozenset((int(u), int(v))) for u, v in G.edges())
    )
    return sm, partition


# ------------------------------------------------------------------
# PATCH VOLATILITY + TYPES + EXTENTS
# ------------------------------------------------------------------
def patch_slice_tables(
    out_root: Path,
    slice_metas: list[SliceMeta],
    node_types_by_slice: dict[str, dict[int, str]],
    edge_types_by_slice: dict[str, dict[frozenset, str]],
    volatility: dict[int, int],
):
    """
    Re-open each slice’s node & edge CSVs to add type + volatility,
    recompute densities (in case some nodes filtered) and extents.
    """
    for sm in slice_metas:
        sdir = out_root / sm.label
        if not sdir.exists():
            continue

        # --- facebook_data_transformed_new.csv ---
        nodes_df = pd.read_csv(sdir / "facebook_data_transformed_new.csv")
        e_df = pd.read_csv(sdir / "node_to_node_link_data.csv") if (sdir / "node_to_node_link_data.csv").stat().st_size > 0 else pd.DataFrame(columns=["source","target","type"])

        # patch types & volatility
        types = node_types_by_slice.get(sm.label, {})
        nodes_df["type"] = nodes_df["node"].map(types).fillna("")
        nodes_df["volatility"] = nodes_df["node"].map(volatility).fillna(0)

        # recompute community density (safer to do again here)
        dens_map = {}
        for cid, sub in nodes_df.groupby("community"):
            nodes = set(sub["node"])
            if e_df.empty:
                dens_map[cid] = 0.0
                continue
            sub_e = e_df[(e_df["source"].isin(nodes)) & (e_df["target"].isin(nodes))]
            n = len(nodes)
            dens_map[cid] = len(sub_e) / (n * (n - 1) / 2) if n > 1 else 0.0
        nodes_df["density"] = nodes_df["community"].map(dens_map).fillna(0.0)

        nodes_df.to_csv(sdir / "facebook_data_transformed_new.csv", index=False)

        # --- node_to_node_link_data.csv ---
        if not e_df.empty:
            # patch edge types
            e_types = edge_types_by_slice.get(sm.label, {})
            # unify undirected key
            def etype(row):
                key = frozenset((int(row["source"]), int(row["target"])))
                return e_types.get(key, "")
            e_df["type"] = e_df.apply(etype, axis=1)
            e_df.to_csv(sdir / "node_to_node_link_data.csv", index=False)

        # --- extents file ---
        ext = {}
        for col, key in [
            ("centrality", "degree_range"),
            ("closeness",  "closeness_range"),
            ("betwness",   "betwness_range"),
            ("eign",       "eign_range"),
            ("volatility", "volatility_range"),
        ]:
            arr = nodes_df[col].to_numpy(dtype=float)
            ext[key] = find_outlier_range(arr) if arr.size else [0.0, 0.0]
        (sdir / "new_extent_without_outliers_for_colorcoding.json").write_text(json.dumps(ext))


# ------------------------------------------------------------------
# AUTHOR MAPPING
# ------------------------------------------------------------------
def write_author_mapping(out_root: Path, node_ids: list[int], name_map: dict[int, str]):
    """
    Write author_mapping.txt required by your JS loader.
    Format: "<name>: <id>"
    """
    with open(out_root / "author_mapping.txt", "w", encoding="utf-8") as f:
        for nid in sorted(node_ids):
            nm = name_map.get(nid, f"User_{nid}")
            f.write(f"{nm}: {nid}\n")


# ------------------------------------------------------------------
# MAIN
# ------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Build SpinTrix dataset from SNAP CollegeMsg.")
    parser.add_argument("--dataset-slug", default=DEFAULT_DATASET_SLUG,
                        help="Output folder under data/ (default: uci_college).")
    parser.add_argument("--slices", type=int, default=4,
                        help="Number of temporal slices (default: 4).")
    parser.add_argument("--min-messages", type=int, default=1,
                        help="Drop nodes with <M messages across a slice (default: 1 = keep all).")
    parser.add_argument("--raw-path", type=Path, default=None,
                        help="Path to local CollegeMsg.txt(.gz); if absent, download.")
    parser.add_argument("--no-download", action="store_true",
                        help="Don't attempt download; fail if file missing.")
    args = parser.parse_args()

    out_root = Path("data") / args.dataset_slug
    safe_mkdir(out_root)

    # --------------------------------------------------------------
    # 1) Acquire dataset
    # --------------------------------------------------------------
    raw_path = args.raw_path
    if raw_path is None:
        raw_path = out_root / "CollegeMsg.txt.gz"
        if not args.no_download:
            download_if_needed(SNAP_URL, raw_path, force=False)
        elif not raw_path.exists():
            raise FileNotFoundError(f"{raw_path} missing and --no-download set.")

    # --------------------------------------------------------------
    # 2) Load edge list
    # --------------------------------------------------------------
    log(f"Loading CollegeMsg from {raw_path} …")
    df = read_college_msg(raw_path)
    log(f"Loaded {len(df)} temporal edges; nodes ~{len(set(df['source']).union(df['target']))}.")

    # --------------------------------------------------------------
    # 3) Assign slices
    # --------------------------------------------------------------
    df, bins = compute_slice_edges(df, args.slices)
    slice_labels = build_slice_labels(df, bins)  # e.g., ["000-048", ...]
    df["slice_label"] = df["slice"].map(lambda i: slice_labels[i])

    log("Slice counts:")
    for i, lab in enumerate(slice_labels):
        log(f"  {lab}: {len(df[df['slice']==i])} edges")

    # --------------------------------------------------------------
    # 4) Global name map + author mapping
    # --------------------------------------------------------------
    all_nodes = sorted(set(df["source"]).union(set(df["target"])))
    name_map = {nid: f"User_{nid}" for nid in all_nodes}
    write_author_mapping(out_root, all_nodes, name_map)

    # --------------------------------------------------------------
    # 5) Build each slice & export base tables
    # --------------------------------------------------------------
    slice_metas = []
    partitions_by_label = {}

    for i, lab in enumerate(slice_labels):
        df_slice = df[df["slice"] == i].copy()
        sdir = out_root / lab
        sm, part = export_slice(
            label=lab,
            slice_df=df_slice,
            out_dir=sdir,
            min_messages=args.min_messages,
            global_name_map=name_map,
        )
        slice_metas.append(sm)
        partitions_by_label[lab] = part

    # --------------------------------------------------------------
    # 6) Derive global volatility + types
    # --------------------------------------------------------------
    log("\nDeriving node/edge types + volatility across slices …")
    node_types_by_slice = derive_node_types(slice_metas)
    edge_types_by_slice = derive_edge_types(slice_metas)
    volatility = compute_volatility(slice_metas)

    # --------------------------------------------------------------
    # 7) Patch node/edge CSVs w/ type + volatility + extents
    # --------------------------------------------------------------
    patch_slice_tables(out_root, slice_metas, node_types_by_slice, edge_types_by_slice, volatility)

    log("\n✓ SpinTrix dataset built.")
    log(f"  Output root: {out_root.resolve()}")
    log(f"  Slice labels: {slice_labels}")
    log("\nAdd this dataset to your JS:")
    log(f'  const datasets = ["data_vispub","{args.dataset_slug}", ...];')
    log(f"  const years    = {slice_labels};")
    log(f'  const T0_YEAR  = "{slice_labels[0]}";')


def run_build_uci_spinetrix(
    dataset_slug="uci_college",
    n_slices=4,
    min_messages=1,
    raw_path=None,
    download=True
):
    out_root = Path("data") / dataset_slug
    out_root.mkdir(parents=True, exist_ok=True)

    if raw_path is None:
        raw_path = out_root / "CollegeMsg.txt.gz"
        if download:
            download_if_needed(SNAP_URL, raw_path)
        elif not raw_path.exists():
            raise FileNotFoundError(f"{raw_path} not found!")

    print(f"Loading CollegeMsg from {raw_path} …")
    df = read_college_msg(raw_path)
    print(f"Loaded {len(df)} temporal edges; nodes ~{len(set(df['source']).union(df['target']))}.")

    # Slicing
    df, bins = compute_slice_edges(df, n_slices)
    slice_labels = build_slice_labels(df, bins)
    df["slice_label"] = df["slice"].map(lambda i: slice_labels[i])

    print("Slice counts:")
    for i, lab in enumerate(slice_labels):
        print(f"  {lab}: {len(df[df['slice']==i])} edges")

    all_nodes = sorted(set(df["source"]).union(set(df["target"])))
    name_map = {nid: f"User_{nid}" for nid in all_nodes}
    write_author_mapping(out_root, all_nodes, name_map)

    slice_metas = []
    partitions_by_label = {}

    for i, lab in enumerate(slice_labels):
        df_slice = df[df["slice"] == i].copy()
        sdir = out_root / lab
        sm, part = export_slice(
            label=lab,
            slice_df=df_slice,
            out_dir=sdir,
            min_messages=min_messages,
            global_name_map=name_map,
        )
        slice_metas.append(sm)
        partitions_by_label[lab] = part

    # Global attributes
    node_types_by_slice = derive_node_types(slice_metas)
    edge_types_by_slice = derive_edge_types(slice_metas)
    volatility = compute_volatility(slice_metas)

    patch_slice_tables(out_root, slice_metas, node_types_by_slice, edge_types_by_slice, volatility)

    print("\n✓ SpinTrix dataset built.")
    print(f"  Output root: {out_root.resolve()}")
    print(f"  Slice labels: {slice_labels}")
    return slice_labels

run_build_uci_spinetrix()