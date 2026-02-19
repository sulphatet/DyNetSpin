import pandas as pd
import numpy as np
from pathlib import Path

def spiral_layout(comm_sizes):
    """
    Generate 2D positions (x,y) in a spiral based on community size.
    Bigger communities get larger radius.
    """
    n = len(comm_sizes)
    theta_gap = 2 * np.pi / n
    positions = {}
    for i, (comm_id, size) in enumerate(comm_sizes):
        radius = 1 + i * 1.5  # You can tune this spacing
        angle = i * theta_gap
        x = radius * np.cos(angle)
        y = radius * np.sin(angle)
        positions[comm_id] = (x, y)
    return positions

def override_layout(slice_dir):
    fb_path = slice_dir / "facebook_data_transformed_new.csv"
    pos_path = slice_dir / "coarse_graph_pos.csv"

    if not fb_path.exists():
        print(f"Skipping {slice_dir} (missing facebook_data_transformed_new.csv)")
        return

    df = pd.read_csv(fb_path)
    comm_counts = df['community'].value_counts().sort_values().items()
    spiral_pos = spiral_layout(list(comm_counts))

    pos_df = pd.DataFrame([{'node': c, 'x': x, 'y': y} for c, (x, y) in spiral_pos.items()])
    pos_df.to_csv(pos_path, index=False)
    print(f"✔ Rewritten spiral layout in {slice_dir.name}")

def main():
    root_dir = Path("data/enron")
    for slice_dir in sorted(root_dir.iterdir()):
        if slice_dir.is_dir():
            override_layout(slice_dir)

if __name__ == "__main__":
    main()
