#!/usr/bin/env python3
"""
Check and write a global name->node mapping across time slices, handling duplicate names sensibly.

Usage:
    python fix_author_mapping.py /path/to/parent_dir

Example:
    python fix_author_mapping.py data/enron

What it does:
- Looks for immediate subfolders of the given parent directory (each is a timeslice).
- In each timeslice, opens `node link csv`.
- Reads two columns: name and node id (supports column names: 'name' and either 'node' or 'id', case-insensitive).
- Aggregates evidence across timeslices and chooses a **canonical** one-to-one mapping:
    * For each name that appears with multiple node ids, pick the node id with the **highest frequency** across all files (ties -> pick the **smallest id**). The alternates are recorded as conflicts.
    * For each node that appears with multiple names, keep the **most frequent name** (ties -> lexicographically smallest) and record alternates as conflicts.
- Writes `author_mapping.txt` at the parent directory level, lines sorted by node id:
      Name: node
- Also writes `author_conflicts.txt` summarizing any duplicate-name / duplicate-node situations and where they occurred.
- Exits with code 0 even if conflicts exist (since they are handled), but prints a warning.

Notes:
- Duplicate rows within a file that are internally consistent are ignored.
- Missing timeslices or missing CSVs are reported as warnings and skipped.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, Tuple, Set, Optional, List, DefaultDict
from collections import defaultdict, Counter

CSV_FILENAME = "facebook_data_transformed_new.csv"

class MappingError(Exception):
    pass

def discover_timeslices(parent: Path) -> Dict[Path, Path]:
    """Return mapping of timeslice_dir -> csv_path for those that contain the CSV."""
    timeslices = {}
    for child in sorted([p for p in parent.iterdir() if p.is_dir()]):
        csv_path = child / CSV_FILENAME
        if csv_path.exists() and csv_path.is_file():
            timeslices[child] = csv_path
        else:
            print(f"[warning] Missing {CSV_FILENAME} in: {child}", file=sys.stderr)
    if not timeslices:
        print("[warning] No timeslices with CSVs found.", file=sys.stderr)
    return timeslices


def pick_columns(header: Set[str]) -> Tuple[str, str]:
    """Pick (name_col, node_col) from the header set (case-insensitive)."""
    lower = {h.lower(): h for h in header}
    name_col = lower.get("name")
    node_col = lower.get("node") or lower.get("id")
    if not name_col or not node_col:
        raise MappingError(
            f"Required columns not found. Have: {sorted(header)}; need 'name' and 'node' or 'id'."
        )
    return name_col, node_col


def read_pairs(csv_path: Path) -> List[Tuple[str, int, str]]:
    """Return a list of (name, node, timeslice_label) for unique rows in a file."""
    pairs: Set[Tuple[str, int]] = set()
    out: List[Tuple[str, int, str]] = []
    timeslice_label = csv_path.parent.name
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise MappingError(f"No header row in {csv_path}")
        name_col, node_col = pick_columns(set(reader.fieldnames))
        line_no = 1  # header is line 1
        for row in reader:
            line_no += 1
            raw_name = row.get(name_col)
            raw_node = row.get(node_col)
            if raw_name is None or raw_node is None:
                print(f"[warning] Skipping row with missing fields at {csv_path}:{line_no}", file=sys.stderr)
                continue
            name = raw_name.strip()
            if name == "":
                print(f"[warning] Empty name at {csv_path}:{line_no}", file=sys.stderr)
                continue
            try:
                node = int(raw_node)
            except (ValueError, TypeError):
                raise MappingError(f"Non-integer node id '{raw_node}' at {csv_path}:{line_no}")
            if (name, node) not in pairs:
                pairs.add((name, node))
                out.append((name, node, timeslice_label))
    return out


def collect_evidence(timeslices: Dict[Path, Path]):
    """Aggregate occurrences for (name,node) and track per-timeslice appearances."""
    # Counters
    name_node_counts: DefaultDict[str, Counter] = defaultdict(Counter)  # name -> Counter({node: count})
    node_name_counts: DefaultDict[int, Counter] = defaultdict(Counter)  # node -> Counter({name: count})
    pair_timeslices: DefaultDict[Tuple[str, int], List[str]] = defaultdict(list)

    for tdir, csv_path in timeslices.items():
        try:
            rows = read_pairs(csv_path)
        except MappingError as e:
            raise MappingError(f"{csv_path}: {e}") from e
        for name, node, tlabel in rows:
            name_node_counts[name][node] += 1
            node_name_counts[node][name] += 1
            pair_timeslices[(name, node)].append(tlabel)

    return name_node_counts, node_name_counts, pair_timeslices


def choose_canonical_mapping(name_node_counts: Dict[str, Counter], node_name_counts: Dict[int, Counter]) -> Tuple[Dict[str, int], Dict[int, str], Dict[str, List[int]], Dict[int, List[str]]]:
    """Resolve to a bijection by sensible heuristics.

    Returns:
      name_to_node, node_to_name, name_alternates, node_alternates
    """
    # Step 1: for each name, choose its best node (most frequent; tie -> smallest node id)
    preliminary_name_to_node: Dict[str, int] = {}
    name_alternates: Dict[str, List[int]] = {}
    for name, ctr in name_node_counts.items():
        if not ctr:
            continue
        # pick most common node id for this name
        max_count = max(ctr.values())
        best_nodes = [nid for nid, c in ctr.items() if c == max_count]
        chosen = min(best_nodes)
        preliminary_name_to_node[name] = chosen
        # record alternates (other node ids seen for same name)
        name_alternates[name] = sorted([nid for nid in ctr.keys() if nid != chosen])

    # Step 2: invert, but if multiple names picked the same node, keep the most frequent name for that node
    node_to_name: Dict[int, str] = {}
    node_alternates: Dict[int, List[str]] = defaultdict(list)

    for name, node in preliminary_name_to_node.items():
        if node not in node_to_name:
            node_to_name[node] = name
        else:
            current = node_to_name[node]
            # pick which name is stronger for this node: higher count on node, tie -> lexicographically smaller
            cur_strength = node_name_counts[node][current]
            new_strength = node_name_counts[node][name]
            if new_strength > cur_strength or (new_strength == cur_strength and name < current):
                node_alternates[node].append(current)
                node_to_name[node] = name
            else:
                node_alternates[node].append(name)

    # Step 3: ensure name->node reflects the final node_to_name choices (bijective)
    # Some names may have lost their chosen node due to collisions; give them their next best available node (by their Counter order)
    # Build reverse mapping of taken nodes
    taken_nodes: Set[int] = set(node_to_name.keys())

    for name, ctr in name_node_counts.items():
        final_node = None
        # If this name already owns its node in node_to_name, keep it
        prelim = preliminary_name_to_node.get(name)
        if prelim is not None and node_to_name.get(prelim) == name:
            final_node = prelim
        else:
            # Try next best options in descending count, then ascending node id
            for count in sorted(set(ctr.values()), reverse=True):
                candidates = sorted([nid for nid, c in ctr.items() if c == count])
                for nid in candidates:
                    if nid not in taken_nodes:
                        node_to_name[nid] = name
                        taken_nodes.add(nid)
                        final_node = nid
                        break
                if final_node is not None:
                    break
        if final_node is None:
            # As a last resort, keep the preliminary choice (will overwrite someone else) but prefer smallest id deterministically
            # This scenario is rare; it means there are fewer unique node ids than names observed.
            fallback = preliminary_name_to_node[name]
            # reassign, marking the replaced name as alternate
            replaced = node_to_name.get(fallback)
            if replaced and replaced != name:
                node_alternates[fallback].append(replaced)
            node_to_name[fallback] = name
        
    # Finally, rebuild name_to_node from node_to_name to ensure perfect bijection
    name_to_node = {nm: nd for nd, nm in node_to_name.items()}

    return name_to_node, node_to_name, name_alternates, node_alternates


def write_author_mapping(parent: Path, name_to_node: Dict[str, int]) -> Path:
    out_path = parent / "author_mapping.txt"
    items = sorted(name_to_node.items(), key=lambda kv: kv[1])
    with out_path.open("w", encoding="utf-8") as f:
        for name, node in items:
            f.write(f"{name}: {node}\n")
    return out_path


def write_conflicts(parent: Path,
                    name_alternates: Dict[str, List[int]],
                    node_alternates: Dict[int, List[str]],
                    pair_timeslices) -> Path:
    out_path = parent / "author_conflicts.txt"
    with out_path.open("w", encoding="utf-8") as f:
        f.write("Duplicate name -> multiple node ids (kept the most frequent):\n")
        for name in sorted(name_alternates):
            alts = name_alternates[name]
            if not alts:
                continue
            f.write(f"- {name} also appeared with node ids: {', '.join(map(str, alts))}\n")
            for alt in alts:
                ts = ", ".join(sorted(set(pair_timeslices.get((name, alt), []))))
                if ts:
                    f.write(f"    · node {alt} timeslices: {ts}\n")
        f.write("\nNode id -> multiple names (kept the most frequent):\n")
        for node in sorted(node_alternates):
            alts = node_alternates[node]
            if not alts:
                continue
            f.write(f"- node {node} also labeled as: {', '.join(sorted(set(alts)))}\n")
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a consistent name<->node mapping across time slices, handling duplicates sensibly, and write author_mapping.txt + author_conflicts.txt")
    ap.add_argument("parent_dir", type=Path, help="Parent directory containing time-slice subfolders")
    args = ap.parse_args()

    parent: Path = args.parent_dir
    if not parent.exists() or not parent.is_dir():
        print(f"[error] Not a directory: {parent}", file=sys.stderr)
        return 2

    try:
        timeslices = discover_timeslices(parent)
        if not timeslices:
            print("[error] No timeslices with the required CSV found.", file=sys.stderr)
            return 3
        name_node_counts, node_name_counts, pair_timeslices = collect_evidence(timeslices)
        name_to_node, node_to_name, name_alternates, node_alternates = choose_canonical_mapping(name_node_counts, node_name_counts)
    except MappingError as e:
        print("[error] Problem while reading CSVs:\n" + str(e), file=sys.stderr)
        return 4

    out_path = write_author_mapping(parent, name_to_node)
    conf_path = write_conflicts(parent, name_alternates, node_alternates, pair_timeslices)

    n_map = len(name_to_node)
    n_name_dups = sum(1 for v in name_alternates.values() if v)
    n_node_dups = sum(1 for v in node_alternates.values() if v)

    if n_name_dups or n_node_dups:
        print(f"[warning] Resolved duplicates: {n_name_dups} duplicated names; {n_node_dups} nodes with multiple labels. See {conf_path}.", file=sys.stderr)
    print(f"Wrote {out_path} with {n_map} mappings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
