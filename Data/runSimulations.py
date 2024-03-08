import json
import subprocess
import threading
import time
from timeit import default_timer as timer

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
            if not (result.startswith("node:internal") or result.startswith("TypeError") or result.startswith("runtime")) or result.endswith("Node.js v21.1.0"):
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
noOfThreads = 50

#read in teams
with open('Inputs/tournament_battles.json', 'r') as infile:
    teams = json.load(infile)

with open('Inputs/GymLeaderTeams.json', 'r') as infile:
    teamNumbers = json.load(infile)

print(len(teams))
setLevel = 50 # If not None, all pokemon will be set to this level
n = 100 # number of battles to stop running after
teams = teams[:n] # comment this out to simulate all battles

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

while len(teams) >= noOfThreads:
    for i in range(noOfThreads):
        thread = threading.Thread(
            target=runSimulation, args=(teams[0], str(i+1), filename, teamNumbers, setLevel))
        threads.append(thread)
        teams.pop(0)
    
    for i in threads:
        i.start()
    for i in threads:
        i.join()
    threads.clear()
    print(len(teams)) #for keeping track of where we are

#speed up leftover battles
while len(teams) >= 25:
    for i in range(25):
        thread = threading.Thread(
            target=runSimulation, args=(teams[0], str(i+1), filename, teamNumbers, setLevel))
        threads.append(thread)
        teams.pop(0)
    
    for i in threads:
        i.start()
    for i in threads:
        i.join()
    threads.clear()
    print(len(teams)) #for keeping track of where we are

#speed up leftover battles
while len(teams) >= 10:
    for i in range(10):
        thread = threading.Thread(
            target=runSimulation, args=(teams[0], str(i+1), filename, teamNumbers, setLevel))
        threads.append(thread)
        teams.pop(0)
    
    for i in threads:
        i.start()
    for i in threads:
        i.join()
    threads.clear()
    print(len(teams)) #for keeping track of where we are

# run remaining battles
for i in teams:
    runSimulation(i, "0", filename, teamNumbers, setLevel)
    
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