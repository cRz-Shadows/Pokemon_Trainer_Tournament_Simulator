import json
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
import time
from timeit import default_timer as timer
from tqdm import tqdm

leader_level_caps = {
    "Brock": 14,
    "Misty": 21,
    "Surge": 24,
    "Erika": 29,
    "Koga": 43,
    "Sabrina": 43,
    "Blaine": 47,
    "Giovanni": 50,

    "Lorelei": 56,
    "Bruno": 58,
    "Agatha": 60,
    "Lance": 62,

    "Blue-(Charizard)": 65,
    "Blue-(Blastoise)": 65,
    "Blue-(Venusaur)": 65,
}

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
def runSimulation(matchups, threadNo, trainer_lines, pokemon_lines, teamNumbers, leader_teamNumbers, setLevel):
    # print("Running simulation on", threadNo)
    global teams
    global results
    global builds
    global noErase
    global ErasingMatchups
    leader = get_keys_from_value(teamNumbers, matchups[-1][0])[0]
    setLevel = leader_level_caps[leader]
    score = 0
    output_result = ""

    for i in range(3):
        points = 0
        scores = []
        for matchup in matchups:

            if matchup == matchups[-1]:
                if points < len(matchups)-1:
                    break # can't sweep if it didn't beat everything individually

            # get number of each team from the teamNumbers dict
            team1No = get_keys_from_value(teamNumbers, matchup[0])[0]
            team2No = get_keys_from_value(teamNumbers, [matchup[1]])[0]

            game = str(len(matchup[0])) + "v" + str(len(matchup[1]))

            # Process the first group of builds
            write_builds_to_file(trainer_lines, matchup[0], f"./WorkerFiles/{threadNo}1.txt", setLevel) # trainer is always first in the matchup
            # Process the second group of builds
            write_builds_to_file(pokemon_lines, [matchup[1]], f"./WorkerFiles/{threadNo}2.txt", setLevel) # pokemon is always first in the matchup
            while True:
                mycommand = "cd ../pokemon-showdown && node ./dist/sim/examples/Simulation-test-1 " + threadNo + " " + str(team1No) + " " + str(team2No)
                result = subprocess.getoutput(mycommand)
                # if the battle fails we retry, sometimes showdown fails for some unexpected reason
                if not (result.startswith("node:internal") or result.startswith("TypeError") or result.startswith("runtime")) or result.endswith("Node.js v21.6.1"):
                    try:
                        if not (result[:40].split("\n")[2].startswith("TypeError")):
                            break
                    except:
                        break

            if result.endswith("|win|Bot 2"):
                points += 1

            output_result += result + "\n]]]]]\n"

        scores.append(points / len(matchups))
        score = sum(scores) / len(scores)
        if score < 1:
            break

    with open(f"./WorkerFiles/{threadNo}2.txt") as f2:
        pokemon_species = f2.readlines()[0].strip().replace("|", "")

    leader_str = str(leader)
    with lock3:
        if str(leader) not in results:
            results[leader_str] = {pokemon_species: -1}
            builds[leader_str] = {pokemon_species: -1}
        elif pokemon_species not in results[leader_str]:
            results[leader_str][pokemon_species] = -1
            builds[leader_str][pokemon_species] = -1
        # If both exist and score is higher, update them
        if score > results[leader_str][pokemon_species]:
            results[leader_str][pokemon_species] = round(score, 3)
            builds[leader_str][pokemon_species] = team2No
            # Write file
            output_directory = f"./Pokemon_Simulation_Outputs/{leader_str}"
            os.makedirs(output_directory, exist_ok=True)
            with open(f"{output_directory}/{pokemon_species}.txt", "w") as o:
                o.write(output_result)

    if score == 1:
        with lock2:
            if pokemon_species not in noErase[leader_str]:
                ErasingMatchups = True
                print("removing", leader, pokemon_species)
                teams = [matchup for matchup in tqdm(teams)
                        if not (leader == get_keys_from_value(leader_teamNumbers, matchup[-1][0])[0] 
                                and pokemon_species.lower() == ([matchup[0][1]][0][0]) )]
                noErase[leader_str].append(pokemon_species)
                ErasingMatchups = False

    # print("finished running simulation on", threadNo)
    return(teams)
    
def get_keys_from_value(d, val):
    return [k for k, v in d.items() if v == val]

leaders_filename = "Inputs/" + "GymLeaderPokemon.txt"
pokemon_filename = "Inputs/" + "PokemonBuilds.txt"    

noOfThreads = 1 # Change this to fit your CPU

#read in teams
with open('Inputs/tournament_battles.json', 'r') as infile:
    teams = json.load(infile)

with open('Inputs/PokemonVsLeaderTeams.json', 'r') as infile:
    teamNumbers = json.load(infile)

leader_teams = {
    "Brock": [["Geodude", 1], ["Onix", 7]],
    "Misty": [["Staryu", 15], ["Starmie", 21]],
    "Surge": [["Voltorb", 29], ["Pikachu", 36], ["Raichu", 44]],
    "Erika": [["Victreebel", 52], ["Tangela", 60], ["Vileplume", 66]],
    "Koga": [["Koffing", 74], ["Muk", 82], ["Koffing", 90], ["Weezing", 98]],
    "Sabrina": [["Kadabra", 106], ["Mr. Mime", 114], ["Venomoth", 122], ["Alakazam", 130]],
    "Blaine": [["Growlithe", 138], ["Ponyta", 146], ["Rapidash", 154], ["Arcanine", 162]],
    "Giovanni": [["Rhyhorn", 170], ["Dugtrio", 178], ["Nidoqueen", 186], ["Nidoking", 194], ["Rhydon", 202]],

    "Lorelei": [["Dewgong", 1860], ["Cloyster", 1068], ["Slowbro", 1876], ["Jynx", 1884], ["Lapras", 1892]],
    "Bruno": [["onix", 1900], ["Hirmonchan", 1908], ["Hitmonlee", 1916], ["Onix", 1900], ["Machamp", 1924]],
    "Agatha": [["Gengar", 1932], ["Golbat", 1940], ["Haunter", 1948], ["Arbok", 1956], ["Gengar", 1964]],
    "Lance": [["Gyarados", 1972], ["Dragonair", 1980], ["Dragonair", 1980], ["Aerodactyl", 1988], ["Dragonite", 1996]],

    "Blue-(Charizard)": [["Pidgeot", 3386], ["Alakazam", 3394], ["Rhydon", 3402], ["Exeggutor", 3410], ["Gyarados", 3417], ["Charizard", 3425]],
    "Blue-(Blastoise)": [["Pidgeot", 3386], ["Alakazam", 3394], ["Rhydon", 3402], ["Arcanine", 3448], ["Exeggutor", 3441], ["Blastoise", 3464]],
    "Blue-(Venusaur)": [["Pidgeot", 3386], ["Alakazam", 3394], ["Rhydon", 3402], ["Gyarados", 3433], ["Arcanine", 3456], ["Venusaur", 3472]],
}
leader_teamNumbers = {k: v for k, v in teamNumbers.items() if any(k.startswith(name) for name in leader_teams.keys())}

print(len(teams))
setLevel = None # If not None, all pokemon will be set to this level
n = 2000 # number of battles to stop running after
# teams = teams[:n] # comment this out to simulate all battles

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

results = {}
builds = {}
noErase = {trainer: [] for trainer in leader_teams.keys()}
lock = threading.Lock()
lock2 = threading.Lock()
lock3 = threading.Lock()
condition = threading.Condition(lock)
ErasingMatchups = False

thread_names = [str(i+1) for i in range(noOfThreads)]
total_simulations = len(teams)

simulation_counter = 0
simulations_since_last_update = 0
simulations_since_last_results_update = 0
simulations_since_last_save = 0

with open(leaders_filename) as f1:
    trainer_lines = f1.readlines()
with open(pokemon_filename) as f2:
    pokemon_lines = f2.readlines()

# ! Read backups from crash
# with open(f"./Pokemon_Simulation_Outputs/scores.json", "r") as infile:
#     results = json.load(infile)
# with open(f"./Pokemon_Simulation_Outputs/builds.json", "r") as infile:
#     builds = json.load(infile)
# with open(f"./Pokemon_Simulation_Outputs/teams.json", "r") as infile:
#     teams = json.load(infile)
# with open(f"./Pokemon_Simulation_Outputs/noErase.json", "r") as infile:
#     noErase = json.load(infile)
# !-------------------

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
        global simulations_since_last_results_update
        global simulations_since_last_save
        with condition:
            # print("releasing thread", thread_name)
            thread_names.append(thread_name)
            condition.notify()  # Notify one waiting thread that a thread name has become available
            simulation_counter += 1
            simulations_since_last_update += 1
            simulations_since_last_results_update += 1
            simulations_since_last_save += 1
            if simulations_since_last_update >= 50 and len(teams) != 0 and simulation_counter > 0 and not ErasingMatchups:
                simulations_since_last_update = 0
                current_runtime = time.time() - start
                simulations_run = total_simulations - len(teams)
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
            if simulations_since_last_results_update >= 1000 and len(teams) != 0 and simulation_counter != 0 and not ErasingMatchups:
                simulations_since_last_results_update = 0
                print(results)
            if simulations_since_last_save >= 5000:
                with lock2:
                    with lock3:
                        if simulations_since_last_save >= 5000 and len(teams) != 0 and simulation_counter != 0 and not ErasingMatchups:
                            simulations_since_last_save = 0
                            start_write_time = round(time.time())
                            print("Writing Backup Files... | Start time:", start_write_time)
                            with open(f"./Pokemon_Simulation_Outputs/scores.json", "w") as file:
                                json.dump(results, file, indent=4)
                            with open(f"./Pokemon_Simulation_Outputs/builds.json", "w") as file:
                                json.dump(builds, file, indent=4)
                            with open(f"./Pokemon_Simulation_Outputs/teams.json", "w") as file:
                                json.dump(teams, file, indent=4)
                            with open(f"./Pokemon_Simulation_Outputs/noErase.json", "w") as file:
                                json.dump(noErase, file, indent=4)
                            end_write_time = round(time.time())
                            print("Done writing backup files | End time:", end_write_time, "| Took ", end_write_time - start_write_time, "seconds")

    # Submit the task
    future = executor.submit(runSimulation, team, thread_name, trainer_lines, pokemon_lines, teamNumbers, leader_teamNumbers, setLevel)
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
print(results)  # For debugging or tracking progress
    
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

print(results)
with open(f"scores.json", "w") as file:
    json.dump(results, file, indent=4)

print(builds)
with open(f"builds.json", "w") as file:
    json.dump(builds, file, indent=4)

pokemon_scores = {}
for trainer, pokemons in results.items():
    for pokemon, score in pokemons.items():
        if pokemon not in pokemon_scores:
            pokemon_scores[pokemon] = {'total_score': 0, 'count': 0}
        pokemon_scores[pokemon]['total_score'] += score
        pokemon_scores[pokemon]['count'] += 1
average_scores = {pokemon: {'score': info['total_score'], 'average_score': info['total_score'] / info['count']} for pokemon, info in pokemon_scores.items()}

print(average_scores)
with open(f"average_scores.json", "w") as file:
    json.dump(average_scores, file, indent=4)
            
print("ran in " + str(end-start) + " Seconds Overall")
print(str((end - start)/n) + " Seconds Per Sim On Average")