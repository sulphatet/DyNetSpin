#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#"""
#Created on Thu Feb  3 12:39:26 2022

#@author: garima
#"""

import networkx as nx

import community
import matplotlib.pyplot as plt
import pandas as pd
import math
import itertools
import json
import numpy as np
import os

# Function to parse the .txt file
def parse_graph_data(file_path):
    with open(file_path, 'r') as f:
        data = f.read().strip()
        
    # Split data into blocks starting with "article"
    blocks = [block.strip() for block in data.split("article") if block.strip()]
    articles = []

    for block in blocks:
        lines = block.split("\n")

        try:
            if lines[0].strip()[0] == "b":
                lines = lines[1:]
            article_id = lines[0].strip()
            
            # Determine the year from the ID and account for 1900s and 2000s
            year_suffix = int(article_id.split("--")[0][-2:])
            year = 1900 + year_suffix if year_suffix > 50 else 2000 + year_suffix
            
            doi = lines[1].strip()
            title = lines[3].strip()
            authors = [line.split(": ")[1] for line in lines if line.startswith("author:")]

            articles.append({
                "id": article_id,
                "year": year,
                "doi": doi,
                "title": title,
                "authors": authors,
            })
        except:
            print(lines)
            pass
            
    return articles

# Function to create time slices
def create_timeslices(min_year, max_year, agg):
    slices = []
    for year in range(min_year, max_year + 1, agg):
        slices.append((year, year + agg - 1))
    return slices

# Function to create author mappings for consistent node IDs
def create_author_mapping(articles):
    authors_set = set()
    for article in articles:
        authors_set.update(article["authors"])
    
    # Assign a unique ID to each author
    author_mapping = {author: idx for idx, author in enumerate(sorted(authors_set))}
    # Save the author_mapping dictionary to a text file
    with open('infovis_author_mapping.txt', 'w') as file:
        for author, idx in author_mapping.items():
            file.write(f"{author}: {idx}\n")

    return author_mapping

def compute_volatility(graphs):
    # Compute node volatility across all timeslices
    # Volatility = number of times node "enters" or "leaves" between consecutive slices
    node_volatility = {}

    # Sort timeslices
    sorted_slices = sorted(graphs.keys(), key=lambda x: int(x.split("-")[0]))

    # Track presence of nodes across slices
    for i in range(1, len(sorted_slices)):
        prev_ts = sorted_slices[i-1]
        curr_ts = sorted_slices[i]

        prev_nodes = set(graphs[prev_ts].nodes())
        curr_nodes = set(graphs[curr_ts].nodes())

        # Nodes that entered: not in prev, in curr
        entered_nodes = (curr_nodes - prev_nodes)
        # Nodes that left: in prev, not in curr
        left_nodes = (prev_nodes - curr_nodes)

        for n in entered_nodes:
            node_volatility[n] = node_volatility.get(n, 0) + 1
        for n in left_nodes:
            node_volatility[n] = node_volatility.get(n, 0) + 1

    # If a node never changes presence between slices, its volatility might not be in dict
    # Ensure all nodes appear in the dictionary with at least 0
    all_nodes = set()
    for ts in graphs:
        all_nodes.update(graphs[ts].nodes())
    for n in all_nodes:
        if n not in node_volatility:
            node_volatility[n] = 0

    return node_volatility


def create_graphs(articles, time_slices, author_mapping):
    graphs = {}
    # Build graphs for each time slice
    for start, end in time_slices:
        G = nx.Graph()
        
        # Add edges for the current time slice
        for article in articles:
            if start <= article["year"] <= end:
                if len(article["authors"]) > 1:
                    for pair in itertools.combinations(article["authors"], 2):
                        author1_id = author_mapping[pair[0]]
                        author2_id = author_mapping[pair[1]]
                        if author1_id != author2_id:
                            G.add_edge(author1_id, author2_id)

        # Add node attributes
        for author, author_id in author_mapping.items():
            if author_id in G.nodes:
                G.nodes[author_id]["name"] = author

        # Store the graph
        graphs[f"{start}-{end}"] = G
        print(f"Time slice {start}-{end}, Graph edges: {G.edges(data=True)}")

    # ----------------------------------------------------------------
    # NEW: Mark incoming/outgoing nodes for each time slice
    # ----------------------------------------------------------------
    sorted_slices = sorted(graphs.keys(), key=lambda x: int(x.split("-")[0]))
    
    for i, ts in enumerate(sorted_slices):
        current_graph = graphs[ts]
        current_nodes = set(current_graph.nodes())
        
        # If there is a previous slice, mark nodes that appear here but not there as 'incoming'
        if i > 0:
            prev_ts = sorted_slices[i-1]
            prev_nodes = set(graphs[prev_ts].nodes())
            incoming_nodes = current_nodes - prev_nodes
            for n in incoming_nodes:
                current_graph.nodes[n]['type'] = 'incoming'
        else:
            pass
        
        # If there is a next slice, mark nodes that disappear in the next slice as 'outgoing'
        if i < len(sorted_slices) - 1:
            next_ts = sorted_slices[i+1]
            next_nodes = set(graphs[next_ts].nodes())
            outgoing_nodes = current_nodes - next_nodes
            for n in outgoing_nodes:
                # If a node is also incoming in the same timeslice, you can choose to merge or overwrite
                if 'type' in current_graph.nodes[n]:
                    # pass
                    current_graph.nodes[n]['type'] = 'outandin' # current_graph.nodes[n]['type'] + ', outgoing'
                else:
                    current_graph.nodes[n]['type'] = 'outgoing'
    
    # ----------------------------------------------------------------
    # Existing logic for marking incoming/outgoing EDGES (if desired)
    # ----------------------------------------------------------------
    # Convert each graph's edges to a set of tuples for easy comparison
    edges_per_slice = {}
    for ts in sorted_slices:
        G = graphs[ts]
        # Use a frozenset for edges to handle undirected nature (u,v) same as (v,u)
        edge_set = set(frozenset((u,v)) for u,v in G.edges())
        edges_per_slice[ts] = edge_set

    # For each slice, determine incoming and outgoing EDGES
    for i, ts in enumerate(sorted_slices):
        current_graph = graphs[ts]
        current_edges = edges_per_slice[ts]

        # Check previous timeslice for incoming edges
        if i > 0:
            prev_ts = sorted_slices[i-1]
            prev_edges = edges_per_slice[prev_ts]
            # Incoming: present in current but not in previous
            incoming_edges = current_edges - prev_edges
            for e in incoming_edges:
                u, v = tuple(e)
                if current_graph.has_edge(u, v):
                    current_graph[u][v]['type'] = 'incoming'

        # Check next timeslice for outgoing edges
        if i < len(sorted_slices)-1:
            next_ts = sorted_slices[i+1]
            next_edges = edges_per_slice[next_ts]
            # Outgoing: present in current but not in next
            outgoing_edges = current_edges - next_edges
            for e in outgoing_edges:
                u, v = tuple(e)
                # If it's already incoming, leave as incoming for this slice
                if current_graph.has_edge(u, v) and 'type' in current_graph[u][v]:
                    current_graph[u][v]['type'] = 'outandin'
                if current_graph.has_edge(u, v) and 'type' not in current_graph[u][v]:
                    current_graph[u][v]['type'] = 'outgoing'

    return graphs



def heatmap_data_generator(partition, link_df_sym):
    source = list(set(partition.values()))
    target = list(set(partition.values()))
    combined =[source, target]
    community_combinations = pd.DataFrame(columns = ['source', 'target'], data=list(itertools.product(*combined)))
    community_combinations = community_combinations.merge(link_df_sym, how='left').fillna(0)
    return community_combinations

def heighest_degree(new_data, partition):
    no_of_communities =  len(set(partition.values()))
    #initialize lists
    community = []
    heigest_degree = []
    #get index_of_hdegree
    index_of_hdegree =0
    #update index of data_frame
    newdata= new_data.reset_index(drop=True)
    for i in range(0,  no_of_communities):
        community.append(i)
        heigest_degree.append(newdata._get_value(index_of_hdegree, 'centrality'))
        #print(new_data._get_value(sum_size, 'node'))
        size_of_each_community =len([k for k,v in partition.items() if v == i])
        #print(size_of_each_community)
        index_of_hdegree =index_of_hdegree + size_of_each_community
    dict = {'community': community, 'h_degree': heigest_degree} 
    df = pd.DataFrame(dict)
    return df
        
        

def density_of_subgraph(G_sub):
    n = len(G_sub.nodes())
    max_edges= n*(n-1)/2
    edges_present = len(G_sub.edges())
    density = edges_present / max_edges
    return density


def ordering_nodes(df):
    df = df.sort_values(by=["community", "centrality"], ascending=[True,True])
    return df

def nodes_in_communities(partition):
    unique_communitites= list(set(partition.values()))
    number_of_nodes=[]
    for community in unique_communitites:
        count = sum(x==community for x in partition.values())
        number_of_nodes.append(count)
    dict = {'community': unique_communitites, 'count': number_of_nodes} 
    df = pd.DataFrame(dict)
    return df

def density_in_communities(partition,G):
    unique_communitites= list(set(partition.values()))
    density=[]
    for community in unique_communitites:
        subgraph = G.subgraph([k for k,v in partition.items() if v == community])
        d= density_of_subgraph(subgraph)
        density.append(d)
    dict = {'community': unique_communitites, 'density': density} 
    df = pd.DataFrame(dict)
    return df
    
        
        
    
    
def data_transformation(G, partition):
    node= list(partition.keys())
    centrality =[]
    community = list(partition.values())
    density_comm= []
   
    

    for i in range(0, len(node)):
        centrality.append(G.degree(node[i]))
        
    dict = {'node': node, 'centrality': centrality, 'community':community} 
 
    df = pd.DataFrame(dict)
    
    df = ordering_nodes(df)
        
    no_of_communities =  len(set(partition.values()))
        
    #populate id, centrality and community list
    for i in range(0,  no_of_communities):
        size_of_each_community =len([k for k,v in partition.items() if v == i])
        print(size_of_each_community)

        subgraph = G.subgraph([k for k,v in partition.items() if v == i])
        d= density_of_subgraph(subgraph)
        
        density_list = [d] * size_of_each_community
        density_comm.extend(density_list)
    
    df['density'] = density_comm
        
    return df


def get_labels(G):
    label_dict = {}
    for u,v,a in G.edges(data=True):  
        label_dict[u]= u
    return label_dict


#positions of coarse graph 
def coarse_graph_node_positions_to_df(pos):
    node=[]
    x_pos=[]
    y_pos=[]

    for i in  range(0, len(pos)):
        node.append(i)
        x_pos.append(pos[i][0])
        y_pos.append(pos[i][1])
    dict = {'node': node, 'x_pos': x_pos, 'y_pos':y_pos} 
    df = pd.DataFrame(dict)
    return df


#visualize coarse graph()
def visualize(G, label_dict, pos):   
    nx.draw(G, pos, labels=label_dict)
    plt.show()
    
def link_data_community(induced_coarse_graph):
    source=[]
    target=[]
    weight=[]
    #printing weights of edges 


    print(f"Edges in induced_coarse_graph: {list(induced_coarse_graph.edges(data=True))}")

    for u,v,a in induced_coarse_graph.edges(data=True):
        if (u!=v):
            source.append(u)
            target.append(v)
            weight.append( a['WEIGHT'])
            print (u,v,a)
    
    dict = {'source': source, 'target': target, 'weight':weight} 
    df = pd.DataFrame(dict)
    return df

def link_data(graph):
    source=[]
    target=[]
    edge_type=[]
    for u,v,a in graph.edges(data=True):
        if (u!=v):
            source.append(u)
            target.append(v)
            # Include the type if it exists, else empty
            edge_type.append(a['type'] if 'type' in a else '')
    
    dict_data = {'source': source, 'target': target, 'type': edge_type} 
    df = pd.DataFrame(dict_data)
    return df


def link_data_symmetry(induced_coarse_graph):
    source=[]
    target=[]
    weight=[]
    #printing weights of edges 
    for u,v,a in induced_coarse_graph.edges(data=True):
        if (u!=v):
            source.append(u)
            target.append(v)
            weight.append( a['WEIGHT'])
            source.append(v)
            target.append(u)
            weight.append( a['WEIGHT'])
    
    dict = {'source': source, 'target': target, 'weight':weight} 
    df = pd.DataFrame(dict)
    return df

def adding_centrality_measures_to_data(new_data,G):
    # Calculate centrality measures
    betw = nx.betweenness_centrality(G)
    clo = nx.closeness_centrality(G)
    
    # Try eigenvector centrality with more iterations and handle potential failure
    try:
        eig = nx.eigenvector_centrality(G, max_iter=1000, tol=1e-6)
    except nx.PowerIterationFailedConvergence:
        # Fallback: Use degree centrality instead
        print("Warning: Eigenvector centrality failed to converge. Using degree centrality instead.")
        eig = nx.degree_centrality(G)
    
    # Create dataframes for each centrality measure
    betw_df = pd.DataFrame(list(betw.items()), columns=['node', 'betwness'])
    clo_df = pd.DataFrame(list(clo.items()), columns=['node', 'closeness'])
    eig_df = pd.DataFrame(list(eig.items()), columns=['node', 'eign'])
    
    # Generate random volatility values within the range of eigenvector centrality
    min_eig = min(eig.values())
    max_eig = max(eig.values())
    volatility = {node: np.random.uniform(min_eig, max_eig) for node in G.nodes()}
    vol_df = pd.DataFrame(list(volatility.items()), columns=['node', 'volatility'])
    
    # Merge centrality measures with new_data
    new_data = pd.merge(betw_df, new_data, on='node')
    new_data = pd.merge(clo_df, new_data, on='node')
    new_data = pd.merge(eig_df, new_data, on='node')
    new_data = pd.merge(vol_df, new_data, on='node')
    
    # Reorder nodes if a specific function exists
    new_data = ordering_nodes(new_data)
    
    return new_data
     
def create_dictionary_of_connections(G):
    connections = {}
    for node in list(G.nodes()):
        neighbour_list =[]
        for neighbour in G.neighbors(node):
            neighbour_list.append(neighbour)
        connections[node] = neighbour_list
    return connections 

def findOutlierRangeForInputCemtrality(centrality):
    range_list=[]
    
    sorted(centrality)

    quartile1 = centrality.quantile(.25)
    quartile3 = centrality.quantile(.75)
    IQR= quartile3 - quartile1

    lowerBondValue= quartile1 - (1.5* IQR)
    upperBondValue = quartile3 + (1.5* IQR)
    
    if lowerBondValue <= min(centrality):
        range_list.append(min(centrality))
    else: 
        range_list.append(lowerBondValue)
        
    if upperBondValue >= max(centrality):
        range_list.append(max(centrality))
    else: 
        range_list.append(upperBondValue)
        
    return range_list

def dictAfterOutlierRemovalFromDifferentCentralitities(data):
    degree_range = findOutlierRangeForInputCemtrality(data['centrality'])
    eign_range = findOutlierRangeForInputCemtrality(data['eign'])
    closeness_range = findOutlierRangeForInputCemtrality(data['closeness'])
    volatility_range = findOutlierRangeForInputCemtrality(data['volatility'])
    betwness_range = findOutlierRangeForInputCemtrality(data['betwness'])
    dict_range ={}
    dict_range['degree_range'] = degree_range
    dict_range['eign_range'] = eign_range
    dict_range['closeness_range'] = closeness_range
    dict_range['volatility_range'] = volatility_range
    dict_range['betwness_range'] = betwness_range
    return dict_range

def reorder_communities_by_size_and_merge(new_data, partition, authors_keys_file=None):
    """
    Reorders rows of new_data according to ascending size of each community.
    Optionally merges with an external authors_keys file if provided.
    
    :param new_data: DataFrame with columns ['node','community','centrality', etc.]
    :param partition: dict from node -> community ID
    :param authors_keys_file: path to an external authors_keys file (str) or None
    :return: a new DataFrame with rows reordered by community size, optionally merged with authors_keys
    """

    # Step 1: count nodes in each community
    number_of_nodes_in_communities = nodes_in_communities(partition)
    # Step 2: reorder communities by ascending size
    number_of_nodes_in_communities = number_of_nodes_in_communities.sort_values(by=["count"], ascending=True)
    list_of_communities_based_on_size = list(number_of_nodes_in_communities["community"])
    
    # Step 3: reorder new_data rows to reflect community size ordering
    new_data_based_on_community_size = pd.DataFrame()
    for comm_id in list_of_communities_based_on_size:
        chunk = new_data[new_data["community"] == comm_id]
        new_data_based_on_community_size = pd.concat([new_data_based_on_community_size, chunk], ignore_index=True)

    # Step 4: optionally merge with an external authors_keys file
    if authors_keys_file and os.path.exists(authors_keys_file):
        df_authors_keys = pd.read_csv(authors_keys_file, delimiter='|', dtype=str)
        # If the original file had a weird column name like '923', rename it
        if '923' in df_authors_keys.columns:
            df_authors_keys = df_authors_keys.rename(columns={'923': 'node'})
        # Merge based on 'node'
        new_data_based_on_community_size = pd.merge(new_data_based_on_community_size,
                                                    df_authors_keys,
                                                    on='node',
                                                    how='left')

    return new_data_based_on_community_size
    
# Function to export graph data to CSV files
def export_graphs(graphs, output_dir, node_volatility):
    os.makedirs(output_dir, exist_ok=True)

    for timeslice, G in graphs.items():
        slice_dir = os.path.join(output_dir, timeslice)
        os.makedirs(slice_dir, exist_ok=True)


        #apply community detection algorithm
        partition = community.community_louvain.best_partition(G)

        #coarse graph
        induced_coarse_graph = community.induced_graph(partition, G, weight='WEIGHT')

        print(f"Partition for {timeslice}: {partition}")
        print(f"Induced coarse graph edges: {induced_coarse_graph.edges(data=True)}")

        #inset here
        #positions of spring layout
        pos = nx.spring_layout(induced_coarse_graph, k=10,weight='WEIGHT') 
        #labes of nodes
        label_dict = get_labels(induced_coarse_graph) 
        #result = label_dict.to_json(orient="records")  
        #visualize coarse_graph 
        visualize(induced_coarse_graph,label_dict, pos)   

        connection_dict = create_dictionary_of_connections(G)
        with open(f"{slice_dir}/connection_list.json", "w") as outfile:
            json.dump(connection_dict, outfile)

        #second
        #converting link data to a dataframe
        link_df=link_data_community(induced_coarse_graph)
        link_df_sym=link_data_symmetry(induced_coarse_graph)

        link_df.to_csv(f'{slice_dir}/link_data.csv')
        #find node to node link data
        node_to_node_link_df=link_data(G)
        node_to_node_link_df.to_csv(f'{slice_dir}/node_to_node_link_data.csv')

        #first 
        df= coarse_graph_node_positions_to_df(pos)
        #saving caorse graph to csv file
        df.to_csv(f'{slice_dir}/coarse_graph_pos.csv')
        #saving node data
        new_data = data_transformation(G, partition)

        new_data = adding_centrality_measures_to_data(new_data,G)
        new_data['volatility'] = new_data['node'].map(node_volatility)

        # Add author's name column
        # 'node' is the ID, we can fetch author name from G.nodes[node]['name']
        new_data['name'] = new_data['node'].apply(lambda x: G.nodes[x]['name'] if 'name' in G.nodes[x] else '')

        def get_node_type(n):
            return G.nodes[n].get('type', '')
        
        new_data['type'] = new_data['node'].apply(get_node_type)

        # Standard scaling using Pandas and NumPy
        mean = new_data['volatility'].mean()
        std = new_data['volatility'].std()

        # new_data['volatility'] = (new_data['volatility'] - mean) / std

        new_data.to_csv(f'{slice_dir}/facebook_data_transformed_new.csv')

        extent_of_centralitties_after_removing_outliers = dictAfterOutlierRemovalFromDifferentCentralitities(new_data)
        #extent_of_centralitties_after_removing_outliers = pd.DataFrame(extent_of_centralitties_after_removing_outliers)
        #extent_of_centralitties_after_removing_outliers.to_csv('new_extent_without_outliers_for_colorcoding.csv')
        with open(f'{slice_dir}/new_extent_without_outliers_for_colorcoding.json', "w") as outfile:
            json.dump(extent_of_centralitties_after_removing_outliers, outfile)


        number_of_nodes_in_communities = nodes_in_communities(partition)
        number_of_nodes_in_communities = number_of_nodes_in_communities.sort_values(by=["count"], ascending=[True])
        number_of_nodes_in_communities.to_csv(f'{slice_dir}/commuity_count.csv')


        commuity_density = density_in_communities(partition,G)
        commuity_density.to_csv(f'{slice_dir}/commuity_density.csv')

        h_degree_in_communities = heighest_degree(new_data, partition)
        h_degree_in_communities.to_csv(f'{slice_dir}/commuity_h_degree.csv')

        heatmap_data = heatmap_data_generator(partition, link_df_sym)
        heatmap_data.to_csv(f'{slice_dir}/heatmap_data.csv')

        new_data_by_size = reorder_communities_by_size_and_merge(new_data, 
                                                                 partition, 
                                                                 authors_keys_file=None)
        new_data_by_size.to_csv(f'{slice_dir}/facebook_data_transformed_new_by_size.csv', index=False)
        

        # return


# Main execution
def main():
    input_file = "InputData/infovis-citation-data.txt"  # Replace with your file path
    output_dir = "data"

    # Step 1: Parse data
    articles = parse_graph_data(input_file)

    # Step 2: Create time slices
    min_year = min(article["year"] for article in articles)
    max_year = max(article["year"] for article in articles)
    time_slices = create_timeslices(min_year, max_year, agg=5)  # Adjust aggregation as needed

    # Create a consistent author mapping
    author_mapping = create_author_mapping(articles)

    # Step 3: Create graphs for each time slice
    graphs = create_graphs(articles, time_slices, author_mapping)

    # first_slice = list(graphs.keys())[0]
    # print(f"Graph for time slice {first_slice}:")
    # print(graphs[first_slice].nodes(data=True))
    # print(graphs[first_slice].edges())

    # Compute volatility for each node
    node_volatility = compute_volatility(graphs)

    # Step 4: Export graphs to CSV files
    export_graphs(graphs, output_dir, node_volatility)

if __name__ == "__main__":
    main()

# #read graph data
# G =  nx.read_edgelist("InputData/facebook_combined.txt")
 