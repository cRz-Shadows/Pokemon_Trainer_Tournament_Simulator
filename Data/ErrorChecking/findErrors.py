# -*- coding: utf-8 -*-
"""
Created on Sun Feb  5 17:09:16 2023

@author: craig
"""

import itertools
import json
import statistics
import subprocess
import multiprocessing
import threading
import time
from timeit import default_timer as timer
import numpy as np
from tqdm import tqdm

# =============================================================================
# Parse output and create a JSON file of any battles that have errors
# =============================================================================

filename = "Inputs/Uber_Main.txt"
teamNumbers = {}

with open('Uber_Main_JSON_Files/Weather/' + filename[7:-4] + '_Weather_teamNumbers.json', 'r') as infile:
    teamNumbers = json.load(infile)
noOfTeams = len(teamNumbers)


pokemonCounter = 1
battleCounter = 0
with open("Outputs/Weather_Outputs/Weather_Final_Output_With_Errors.txt") as o:
    lines = o.readlines() # read output file
    
    # get number of total pokemon for building pokemon matrix
    with open (filename) as g:
        mons = g.readlines()
        for line in mons:
            if line.startswith("|"):
                pokemonCounter += 1
                
    linesToDelete = []
    
    switchIns_team1 = 0
    switchIns_team2 = 0
    KOs_team1 = 0
    KOs_team2 = 0
    turns = 0
    weatherChanges = 0
    error=0
    # Main loop for parser
    for n, line in tqdm(enumerate(lines)):
        print(n)
        if line.startswith("TypeError"):
            error=1
        if line.startswith("(node:"):
            error=1
        if line.startswith("C:\Individual_Project"):
            error = 1
        if line.startswith("Error"):
            error = 1
        if line.startswith("[[[[["):
            battleStart = n
            team1 = int(lines[battleStart+1].split(" ")[0])
            team2 = int(lines[battleStart+1].split(" ")[2])
        if line.startswith("]]]]]"):
            try:
                team1
            except NameError:
                error=1
            try:
                team2
            except NameError:
                error=1
            if error == 0:
                pass
            if error != 0:
                # remove battle
                linesToDelete.append((battleStart+1, n+1))
                error = 0
                
with open(filename[7:-4] + '_lines_To_Remove.json', 'w') as outfile:
    outfile.truncate(0)
    json.dump(linesToDelete, outfile)