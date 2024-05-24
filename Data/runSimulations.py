import json
import os
import re
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
import time
from timeit import default_timer as timer
from tqdm import tqdm

def write_builds_to_file(lines, build_indices, file_path, setLevel):
    with open(file_path, "w") as f:
        f.truncate(0)  # Clear the file
        for build_index in build_indices:
            # Initialize build_start to the line with "Level: "
            build_start = build_index[1]
            # Move backwards to find the line with the '|' character
            while build_start > 0 and not lines[build_start].startswith('|'):
                build_start -= 1
            # Now build_start should be on the line with the '|' character
            # Include the line with '|', removing the '|' character itself.
            f.write(lines[build_start].replace("|", "").strip() + "\n")
            # Write each subsequent line of the build until another '|' is encountered
            for line in lines[build_start + 1:]:
                if line.startswith('|'):
                    break  # If it's the start of the next build, stop writing
                if setLevel is not None and line.startswith("Level: "):
                    line = f"Level: {setLevel}\n" # Check if setLevel is not None and if the line starts with "Level: "
                f.write(line)
            f.write("\n")  # Add a newline to separate builds

# =============================================================================
# Runs a single simulation for some matchup passed in
# =============================================================================
def runSimulation(matchup, threadNo, filename, teamNumbers, setLevel):
    # get number of each team from the teamNumbers dict
    team1No = get_keys_from_value(teamNumbers, matchup[0])[0]
    team2No = get_keys_from_value(teamNumbers, matchup[1])[0]

    game = str(len(matchup[0])) + "v" + str(len(matchup[1]))
    
    with open(filename) as f:
        lines = f.readlines()
        # Process the first group of builds
        write_builds_to_file(lines, matchup[0], f"./WorkerFiles/{threadNo}1.txt", setLevel)
        # Process the second group of builds
        write_builds_to_file(lines, matchup[1], f"./WorkerFiles/{threadNo}2.txt", setLevel)
        while True:
            #mycommand = "cd ../pokemon-showdown && node build && node ./dist/sim/examples/battle-stream-example"
            mycommand = "cd ../pokemon-showdown && node ./dist/sim/examples/Simulation-test-1 " + threadNo + " " + str(team1No) + " " + str(team2No)
            result = subprocess.getoutput(mycommand)
            # if the battle fails we retry, sometimes showdown fails for some unexpected reason
            if not (result.startswith("node:internal") or result.startswith("TypeError") or result.startswith("runtime") or re.search(r'Node\.js\s+v\d+\.\d+\.\d+$', result[-30:])):
                try:
                    if not (result[:40].split("\n")[2].startswith("TypeError")):
                        break
                except:
                    break
        with open ("./WorkerOutputs/" + threadNo + ".txt", "a") as o: 
            o.write(result + "\n]]]]]\n")
        return(result)
    
def get_keys_from_value(d, val):
    return [k for k, v in d.items() if v == val]

filename = "Inputs/" + "GymLeaderPokemon.txt"
noOfThreads = 1 # change this to fit your CPU

#read in teams
with open('Inputs/tournament_battles.json', 'r') as infile:
    teams = json.load(infile)

with open('Inputs/GymLeaderTeams.json', 'r') as infile:
    teamNumbers = json.load(infile)

print(len(teams))
setLevel = 50 # If not None, all pokemon will be set to this level
n = 100 # number of battles to stop running after
teams = teams[:n] # comment this out to simulate all battles

n = len(teams)
noOfTeams = len(teamNumbers)

with open ("./output.txt", "a") as o: 
    o.truncate(0)

# combine the individual worker outputs into one
infiles = [str(i+1) for i in range(noOfThreads)]
infiles.append("0")
# clear worker outputs
for i in infiles:
    with open("./WorkerOutputs/" + i + ".txt", "w") as output:
        output.truncate(0)

subprocess.getoutput("cd ../pokemon-showdown && node build")
threads = []
start = time.time()

lock = threading.Lock()
lock2 = threading.Lock()
condition = threading.Condition(lock)

thread_names = [str(i+1) for i in range(noOfThreads)]

simulation_counter = 0
simulations_since_last_update = 0

with open(filename) as f1:
    trainer_lines = f1.readlines()

    # Function to submit simulations and manage thread names
def submit_simulation(executor, team):
    global simulation_counter
    global simulations_since_last_update
    with condition:  # Use condition variable to wait for an available thread name
        while not thread_names:
            condition.wait()  # Wait for a thread name to become available
        thread_name = thread_names.pop(0)  # Allocate a thread name
    
    # Define a callback function to release the thread name back to the pool and notify waiting threads
    def release_thread_name(future):
        global simulation_counter
        global simulations_since_last_update
        with condition:
            # print("releasing thread", thread_name)
            thread_names.append(thread_name)
            condition.notify()  # Notify one waiting thread that a thread name has become available
            simulation_counter += 1
            simulations_since_last_update += 1
            if simulations_since_last_update >= 50 and len(teams) != 0 and simulation_counter > 0:
                simulations_since_last_update = 0
                current_runtime = time.time() - start
                average_time_per_simulation = current_runtime / simulation_counter if simulation_counter else float('inf')
                estimated_remaining_time = average_time_per_simulation * len(teams)

                seconds = round(estimated_remaining_time)
                minutes, seconds = divmod(seconds, 60)
                hours, minutes = divmod(minutes, 60)

                # Format the remaining time based on its length
                if hours > 0:
                    formatted_time = f"{hours} hour(s), {minutes} minute(s)"
                elif minutes > 0:
                    formatted_time = f"{minutes} minute(s), {seconds} second(s)"
                else:
                    formatted_time = f"{seconds} second(s)"

                print(len(teams), "Simulations Left | Estimated Remaining Time:", formatted_time, "| Time Elapsed:", round(current_runtime))

    # Submit the task
    future = executor.submit(runSimulation, team, thread_name, filename, teamNumbers, setLevel)
    # runSimulation, team, thread_name, trainer_lines, pokemon_lines, teamNumbers, leader_teamNumbers, setLevel
    # Attach the callback to the future
    future.add_done_callback(release_thread_name)

print(len(teams))
with ThreadPoolExecutor(max_workers=noOfThreads) as executor:
    while teams:
        with lock2:
            if teams:
                team = teams.pop(0)
                # print("assigning teams", len(teams))
            submit_simulation(executor, team)

print(len(teams))  # Keeping track of remaining teams
end = time.time()

with open("output.txt", "a") as outfile:
    for i in infiles:
        with open("./WorkerOutputs/" + i + ".txt", "r") as output:
            for i in output.readlines():
                outfile.write(i)

# clear worker outputs
for i in infiles:
    with open("./WorkerOutputs/" + i + ".txt", "w") as output:
        output.truncate(0)
            
print("ran in " + str(end-start) + " Seconds Overall")
print(str((end - start)/n) + " Seconds Per Sim On Average")