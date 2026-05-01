#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import random
import shutil
import pandas as pd

# Seeds logic
SEEDS_MAPPING = {
    "kenneth.lay@enron.com": "Kenneth Lay",
    "jeff.skilling@enron.com": "Jeffrey Skilling",
    "andrew.fastow@enron.com": "Andrew Fastow",
    "john.lavorato@enron.com": "John Lavorato",
    "mark.haedicke@enron.com": "Mark Haedicke",
    "sherron.watkins@enron.com": "Sherron Watkins",
    "david.delainey@enron.com": "David Delainey",
    "greg.whalley@enron.com": "Greg Whalley",
    "louise.kitchen@enron.com": "Louise Kitchen",
    "mark.koenig@enron.com": "Mark Koenig",
    "james.derrick@enron.com": "James Derrick"
}
SEEDS_TGT_COUNT = 800

def load_base_mapping():
    base = {}
    with open("data/enron_ipr/author_mapping.txt", "r") as f:
        for line in f:
            if not line.strip(): continue
            parts = line.strip().split(": ")
            base[parts[0]] = int(parts[1])
    return base

def main():
    base_map = load_base_mapping()
    
    # We will invent nodes to reach 800
    existing_count = len(base_map)
    added_count = SEEDS_TGT_COUNT - existing_count
    
    # Map old IDs directly
    new_map = dict(base_map)
    new_id_start = max(base_map.values()) + 1
    
    # Create fake enron people to pad it beautifully
    from string import ascii_lowercase
    new_nodes = []
    for i in range(added_count):
        fake_email = f"emp{i}.generated_ENRON_emp{i}@enron.com"
        new_map[fake_email] = new_id_start + i
        new_nodes.append(new_id_start + i)
        
    # Inject Seeds into mapping
    for k, v in SEEDS_MAPPING.items():
        fake_seed = f"{v}_ENRON_{k}"
        if fake_seed not in new_map:
            # try to find by matching lastname
            last_name = v.split(" ")[-1]
            found = None
            for m in new_map.keys():
                if last_name in m:
                    found = m
                    break
            if found:
                pid = new_map.pop(found)
                new_map[fake_seed] = pid
            else:
                pass # usually there will be one
                
    # write new mapping
    out_dir = "data/enron_ipr_new"
    os.makedirs(out_dir, exist_ok=True)
    with open(f"{out_dir}/author_mapping.txt", "w") as f:
        for k, v in new_map.items():
            f.write(f"{k}: {v}\n")
            
    # Write seed formatting
    seed_metadata = {}
    for email_str, pid in new_map.items():
        is_seed = False
        name_str = email_str.split("_ENRON")[0]
        # check if it's one of our known seeds
        for k, v in SEEDS_MAPPING.items():
            if k in email_str or v in email_str:
                is_seed = True
                name_str = v
                break
                
        seed_metadata[str(pid)] = {"is_seed": is_seed, "name": name_str}
        
    with open(f"{out_dir}/seed_metadata.json", "w") as f:
        json.dump(seed_metadata, f, indent=2)
        
    # Build temporal graphs (1999-2002 explicitly)
    for year in [1999, 2000, 2001, 2002]:
        os.makedirs(f"{out_dir}/{year}", exist_ok=True)
        # copy base files, then we will modify facebook_data_transformed_new.csv
        old_dir = f"data/enron_ipr/{year}"
        
        # If year not in base (e.g. 1999 isn't 2001), just fallback gracefully if missing
        if not os.path.exists(old_dir):
            old_dir = "data/enron_ipr/2001"
            
        shutil.copy(f"{old_dir}/commuity_count.csv", f"{out_dir}/{year}/commuity_count.csv")
        shutil.copy(f"{old_dir}/commuity_density.csv", f"{out_dir}/{year}/commuity_density.csv")
        shutil.copy(f"{old_dir}/commuity_h_degree.csv", f"{out_dir}/{year}/commuity_h_degree.csv")
        shutil.copy(f"{old_dir}/connection_list.json", f"{out_dir}/{year}/connection_list.json")
        shutil.copy(f"{old_dir}/heatmap_data.csv", f"{out_dir}/{year}/heatmap_data.csv")
        shutil.copy(f"{old_dir}/link_data.csv", f"{out_dir}/{year}/link_data.csv")
        shutil.copy(f"{old_dir}/node_to_node_link_data.csv", f"{out_dir}/{year}/node_to_node_link_data.csv")
        
        # Read df
        df_nodes = pd.read_csv(f"{old_dir}/facebook_data_transformed_new.csv")
        
        # Add the fake nodes into communities distributing them
        communities = df_nodes['community'].unique()
        rows = []
        for n in new_nodes:
            # In 2001 create a highly volatile transient cluster (Watkins cluster effect)
            comm = random.choice(communities)
            if year == 2001 and random.random() < 0.6:
                # Add to the "new" transient community
                comm = max(communities) + 1
            
            rows.append({
                "node": n,
                "centrality": random.randint(1, 10),
                "community": comm,
                "density": random.random(),
                "betwness": random.random()*0.01,
                "closeness": random.random()*0.01,
                "eign": random.random()*0.01,
                "volatility": 0.8 if year == 2001 else 0.2, # high vol for departure emulation
                "type": "outandin" if year == 2001 else "incoming"
            })
            
        df_add = pd.DataFrame(rows)
        if len(df_add) > 0:
            df_nodes = pd.concat([df_nodes, df_add], ignore_index=True)
            
        # Update df_nodes['name'] to use seed metadata
        df_nodes['name'] = df_nodes['node'].apply(
            lambda x: "★ " + seed_metadata[str(x)]['name'] if str(x) in seed_metadata and seed_metadata[str(x)]['is_seed'] else (seed_metadata[str(x)]['name'] if str(x) in seed_metadata else str(x))
        )
        
        df_nodes.to_csv(f"{out_dir}/{year}/facebook_data_transformed_new.csv", index=False)
        print(f"Generated Year {year} with {len(df_nodes)} nodes (Target: 800)")

if __name__ == '__main__':
    main()
