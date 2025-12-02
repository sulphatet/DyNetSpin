#!/usr/bin/env python3
"""
fix_counts_size_base.py

Post-process a SpinTrix dataset folder so that each slice’s
`commuity_count.csv` is sorted by community size ascending.

Usage:
  python fix_counts_size_base.py /path/to/data/reddit
  python fix_counts_size_base.py /path/to/data/your_dataset
"""

import argparse
from pathlib import Path
import pandas as pd
import sys

def fix_counts(root_dir: Path):
    if not root_dir.is_dir():
        print(f"✖️  {root_dir} is not a directory", file=sys.stderr)
        return

    for slice_dir in sorted(root_dir.iterdir()):
        if not slice_dir.is_dir():
            continue

        csv_path = slice_dir / "commuity_count.csv"
        if not csv_path.exists():
            print(f"– skipping {slice_dir.name}: no commuity_count.csv")
            continue

        # load, sort, re-write
        df = pd.read_csv(csv_path)
        if "count" not in df.columns:
            print(f"⚠️  {slice_dir.name}/commuity_count.csv has no 'count' column; skipping")
            continue

        df_sorted = df.sort_values(by="count", ascending=True)
        df_sorted.to_csv(csv_path, index=False)
        print(f"✓ fixed {slice_dir.name}/commuity_count.csv")

def main():
    p = argparse.ArgumentParser(
        description="Sort SpinTrix commuity_count.csv files by ascending size"
    )
    p.add_argument("dataset_dir", type=Path,
                   help="path to your SpinTrix output folder (e.g. data/reddit)")
    args = p.parse_args()

    fix_counts(args.dataset_dir)

if __name__ == "__main__":
    main()
