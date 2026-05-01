#!/usr/bin/env python3
# process_hp_edges.py
import re
import os
import pandas as pd
import argparse
from pathlib import Path

NUMERIC_DIR_RE = re.compile(r'^\d+$')  # matches "1999", "2000", ...

def process_edge_types(data_directory: Path):
    """
    Processes numeric timeslice directories (e.g. '1999', '2000', ...) in a data directory
    to calculate and add temporal edge types ('incoming', 'outgoing', 'outandin')
    to the edge data file "node_to_node_link_data.csv".
    """
    if not data_directory.is_dir():
        print(f"Error: Directory not found at '{data_directory}'")
        return

    # Find and sort all numeric timeslice directories
    try:
        timeslice_dirs = sorted(
            [d for d in data_directory.iterdir() if d.is_dir() and NUMERIC_DIR_RE.match(d.name)],
            key=lambda x: int(x.name)
        )
    except Exception as e:
        print(f"Error while listing timeslice directories: {e}")
        return

    if not timeslice_dirs:
        print(f"No numeric timeslice directories (e.g. '1999', '2000', ...) found in '{data_directory}'")
        return

    print(f"Found {len(timeslice_dirs)} numeric timeslices. Loading edge data...")

    # Load edge sets and raw dataframes
    edge_sets_by_slice = {}
    edge_files_by_slice = {}

    for slice_dir in timeslice_dirs:
        edge_file = slice_dir / "node_to_node_link_data.csv"

        if not edge_file.exists():
            print(f"Warning: Skipping '{slice_dir.name}'. Could not find 'node_to_node_link_data.csv'.")
            continue

        try:
            df = pd.read_csv(edge_file)
            if 'source' not in df.columns or 'target' not in df.columns:
                print(f"Warning: Skipping '{slice_dir.name}'. 'source' or 'target' column missing in {edge_file.name}.")
                continue

            edge_files_by_slice[slice_dir.name] = df
            # use frozenset for undirected edges (same as original)
            edge_sets_by_slice[slice_dir.name] = {
                frozenset((row['source'], row['target'])) for _, row in df.iterrows()
            }
            print(f"  - Loaded {len(edge_sets_by_slice[slice_dir.name])} edges from {slice_dir.name}")
        except Exception as e:
            print(f"Warning: Skipping '{slice_dir.name}'. Error reading file: {e}")

    if not edge_sets_by_slice:
        print("No valid edge CSVs were loaded. Exiting.")
        return

    # Only keep the slice keys we actually loaded (in sorted order)
    sorted_slice_keys = [d.name for d in timeslice_dirs if d.name in edge_sets_by_slice]

    print("\nCalculating edge types and updating files...")
    for i, slice_key in enumerate(sorted_slice_keys):
        current_edges = edge_sets_by_slice.get(slice_key, set())

        prev_slice_key = sorted_slice_keys[i - 1] if i > 0 else None
        prev_edges = edge_sets_by_slice.get(prev_slice_key, set())

        next_slice_key = sorted_slice_keys[i + 1] if i < len(sorted_slice_keys) - 1 else None
        next_edges = edge_sets_by_slice.get(next_slice_key, set())

        df_current = edge_files_by_slice[slice_key]
        types = []

        for _, row in df_current.iterrows():
            edge = frozenset((row['source'], row['target']))

            is_incoming = edge not in prev_edges
            is_outgoing = edge not in next_edges

            edge_type = ""
            if is_incoming and is_outgoing:
                edge_type = "outandin"
            elif is_incoming:
                edge_type = "incoming"
            elif is_outgoing:
                edge_type = "outgoing"

            types.append(edge_type)

        df_current['type'] = types

        output_path = data_directory / slice_key / "node_to_node_link_data.csv"
        try:
            df_current.to_csv(output_path, index=False)
            print(f"  - Updated '{output_path}'")
        except Exception as e:
            print(f"  - Failed to write '{output_path}': {e}")

    print("\nProcessing complete. 🧙‍♂️")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Calculate temporal types for edges across numeric timeslices (e.g. '1999', '2000', ...)."
    )
    parser.add_argument(
        "data_directory",
        type=str,
        help="Path to the main data directory containing numeric-timeslice subfolders."
    )
    args = parser.parse_args()

    process_edge_types(Path(args.data_directory))
