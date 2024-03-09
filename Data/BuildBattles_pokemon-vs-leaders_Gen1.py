# pylint: disable=unspecified-encoding
import json
import random
from itertools import combinations, islice
from tqdm import tqdm

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

leader_gym_numbers = {
    "Brock": 1,
    "Misty": 2,
    "Surge": 3,
    "Erika": 4,
    "Koga": 5,
    "Sabrina": 6,
    "Blaine": 7,
    "Giovanni": 8,

    "Lorelei": 9,
    "Bruno": 9,
    "Agatha": 9,
    "Lance": 9,

    "Blue-(Charizard)": 9,
    "Blue-(Blastoise)": 9,
    "Blue-(Venusaur)": 9,
}

# load move data
with open('UsefulDatasets/gen_1_moves.json', 'r') as file:
    move_data = json.load(file)

# load pokemon move data
with open('UsefulDatasets/gen_1_pokemon_learnsets.json', 'r') as file:
    pokemon_data = json.load(file)
    # pokemon_data = dict(islice(pokemon_data.items(), 5))

# load tm availability
with open('UsefulDatasets/red-blue_tm_availability.json', 'r') as file:
    tm_availability = json.load(file)

# load pokemon availability
with open('UsefulDatasets/red-blue_pokemon_availability.json', 'r') as file:
    pokemon_availability = json.load(file)

# load pokemon move data
with open('UsefulDatasets/gen_1_pokemon_evolutions.json', 'r') as file:
    pokemon_evos = json.load(file)

def find_line_number(pokemon_dict, line_number_dict, species, moves):
    """
    Find the line number for a specific pokemon species and moveset.

    :param pokemon_dict: Dictionary of pokemons and their movesets.
    :param line_number_dict: Dictionary of pokemons and the line numbers of their builds.
    :param species: The pokemon species to search for.
    :param moves: A set of moves to search for.
    :return: The line number if found, otherwise None.
    """
    species = species.lower()
    moves = set(m.lower() for m in moves)

    if species in pokemon_dict:
        for index, move_set in enumerate(pokemon_dict[species]):
            if moves == move_set:
                return line_number_dict[species][index]
    return None

# Function to check if there are two damage-dealing moves of the same type
def check_moves1(moves_list):
    damage_dealing_types = {}
    for move in moves_list:
        move_formatted = move.lower().replace('_', '').replace('-', '').replace(' ', '').replace('.', '')
        if move_formatted in move_data and move_data[move_formatted]['Power'] != "\u2014":
            move_type = move_data[move_formatted]['Type']
            if move_type in damage_dealing_types:
                return False
            damage_dealing_types[move_type] = False
    # print(moves_list)
    return True

# check if the pokemon has a move with higher damage of the same type
def check_moves2(available_moves, moves_list):
    moves_list = [move.lower().replace('_', '').replace('-', '').replace(' ', '').replace('.', '') for move in moves_list]
    for move1 in moves_list:
        for move2 in available_moves:
            move2_formatted = move2.lower().replace('_', '').replace('-', '').replace(' ', '').replace('.', '')
            if move1 in move_data and move2_formatted in move_data:
                move1_info = move_data[move1]
                move2_info = move_data[move2_formatted]
                if move1_info['Power'] != "\u2014" and move2_info['Power'] != "\u2014":
                    if int(move1_info['Power']) > int(move2_info['Power']) and move1_info['Type'] == move2_info['Type']: # has an objectively better move available
                        return False
    return True

# check that there is a damage dealing move
def check_moves3(moves_list):
    moves_list = [move.lower().replace('_', '').replace('-', '').replace(' ', '').replace('.', '') for move in moves_list]
    for move in moves_list:
        if move in move_data:
            move_info = move_data[move]
            if move_info['Power'] != "\u2014":
                    return True
    return False

# Function to get combinations
def get_move_combinations(pokemon_list, level_cap, gym_number):
    result = {}
    for species, pokemonMoves in tqdm(pokemon_list.items()):
        # Need to check if the species has an evolution that's available at this gym
        if (pokemon_availability[species] <= gym_number) and (gym_number != 0) and (pokemon_availability[species] != 0) \
        and ([pokemon_availability[mon] for mon in pokemon_evos[species] if pokemon_availability[mon] <= gym_number and pokemon_availability[mon] != 0] == []):
            level_up_moves = [i[0] for i in [move for move in pokemonMoves['learned_moves'] if move[1] <= level_cap]]
            TMHM_moves = [i for i in [move for move in pokemonMoves['tm_moves'] if tm_availability[move] <= gym_number and tm_availability[move] != 0]]
            available_moves = set(level_up_moves + TMHM_moves)
            if len(available_moves) > 4:
                combinations_list = list(set(i) for i in combinations(available_moves, 4))
            else:
                combinations_list = [set(available_moves)]

            result[species] = []
            if species not in all_builds.keys(): all_builds[species] = []
            if species in all_builds.keys():
                for moveset in combinations_list:
                    # remove useless movesets (e.g. ones that have two damaging moves of the same type and mon has more than six moves total)
                    # don't include moveset if for some move in the moveset, the pokemon has a move with a higher damage of the same type and it isn't a multi turn move
                    # Add the new set only if it's not already present
                    if len(combinations_list) > 4 and check_moves1(moveset) \
                    and check_moves2(available_moves, moveset) \
                    and check_moves3(moveset):
                        if moveset not in all_builds[species]:
                            all_builds[species].append(moveset)
                        result[species].append(moveset)
                    elif all_builds[species] == []:
                        all_builds[species] = [moveset]
                        result[species].append(moveset)
        if species == 'blastoise':
            break
    return result

def read_ideal_builds(trainer, gym_number):
    filename = "UsefulDatasets/gen_1_ideal_builds/ideal_builds_" + trainer.lower() + ".json"
    try:
        with open(filename, 'r') as file:
            data = json.load(file)
        filtered_data = {key: [set([i.lower() for i in value])] for key, value in data.items() if value and value != 0} # remove empty movesets

        for species, value in filtered_data.items():
            moveset = value[0]
            if (pokemon_availability[species] <= gym_number) and (gym_number != 0) and (pokemon_availability[species] != 0) \
                and ([pokemon_availability[mon] for mon in pokemon_evos[species] if pokemon_availability[mon] <= gym_number and pokemon_availability[mon] != 0] == []):
                    if species not in all_builds.keys(): all_builds[species] = []
                    if moveset not in all_builds[species]:
                        all_builds[species].append(moveset)
                    elif all_builds[species] == []:
                        all_builds[species] = [moveset]
            else: filtered_data = {k: v for k, v in filtered_data.items() if k != species}
        return(filtered_data)
    except:
        print("Couldn't find ideal builds for", trainer)
        return({})

# Get the combinations
combinations_results = {}
ideal_builds = {}
all_builds = {} # collect builds to place in file
print("Getting pokemon movesets")
for trainer in leader_teams.keys():
    print(trainer)
    team = leader_teams[trainer]
    level_cap = leader_level_caps[trainer]
    gym_number = leader_gym_numbers[trainer]
    # Get the combinations
    combinations_results[trainer] = get_move_combinations(pokemon_data, level_cap, gym_number)
    ideal_builds[trainer] = read_ideal_builds(trainer, gym_number)

for species in all_builds.keys():
    print(species, len(all_builds[species]))

# create pokemon builds file PokemonBuilds
line_number_dict = {}
line_counter = 1
with open('Inputs/PokemonBuilds.txt', 'w') as file:
    for pokemon, builds in all_builds.items():
        line_number_dict[pokemon] = []
        for build in builds:
            line_number_dict[pokemon].append(line_counter)
            file.write(f"|{pokemon.capitalize()}\n")
            line_counter += 1
            file.write("Level: 50\n")
            line_counter += 1
            for move in build:
                file.write(f"- {move.capitalize()}\n")
                line_counter += 1

# Create teams list file PokemonVsLeaderTeams.json
trainer_teams = {}
trainer_teams_lookup = {}
print("Creating team file")
for leader, team in tqdm(leader_teams.items()):
    trainer_teams[leader] = team
    trainer_teams_lookup[leader] = [leader]
    for i, pokemon in enumerate(team, start=1):
        new_leader = f"{leader}_{i}_({pokemon[0]})"
        trainer_teams[new_leader] = [pokemon]
        trainer_teams_lookup[leader] += [new_leader]
pokemon_teams = {}
for species, builds in tqdm(all_builds.items()):
    for i, build in enumerate(builds, start=1):
        line_number = find_line_number(all_builds, line_number_dict, species, build)
        key = f"{species.capitalize()}-{i}"
        pokemon_teams[key] = [[species.lower(), line_number]]
new_teams = {**trainer_teams, **pokemon_teams}
with open('Inputs/PokemonVsLeaderTeams.json', 'w') as file:
    file.write("{\n")
    last_key = list(new_teams.keys())[-1]  # Get the last key for formatting
    for leader, team in tqdm(new_teams.items()):
        # Convert team list to JSON string
        team_str = json.dumps(team).replace("], ", "],")
        if leader == last_key:
            file.write(f'    "{leader}": {team_str}\n')  # No comma for last item
        else:
            file.write(f'    "{leader}": {team_str},\n')
    file.write("}")

 # How many times to run each battle
RUN_N_TIMES = 1

# make matchups
finalMatchups = []
IdealMatchups = []
for trainer in leader_teams.keys():
    print(trainer)
    trainersTeamsCurrentTrainer = trainer_teams_lookup[trainer] # list containing full team, and a team for each individual pokemon
    trainersTeamsCurrentTrainer = trainersTeamsCurrentTrainer[1:] + trainersTeamsCurrentTrainer[:1]
    MonTeams = combinations_results[trainer]
    # need to figure out line numbers for each pokemon build in MonTeams and make a team for it
    print("Building Final Matchups")
    for species, pokemonBuildSet in tqdm(MonTeams.items()):
        for build in pokemonBuildSet:
            line_number = find_line_number(all_builds, line_number_dict, species, build)
            if line_number == None: print("Can't find line number for useful build:", species, build)
            MonTeam = [species, line_number]
            temp_matchups = []
            for trainerTeam in trainersTeamsCurrentTrainer:
                for _ in range(RUN_N_TIMES):
                    temp_matchups.append([new_teams[trainerTeam], MonTeam])
            finalMatchups.append(temp_matchups)

    print("Building Ideal Matchups")
    MonTeams = ideal_builds[trainer]
    # need to figure out line numbers for each pokemon build in MonTeams and make a team for it
    for species, pokemonBuildSet in tqdm(MonTeams.items()):
        for build in pokemonBuildSet:
            line_number = find_line_number(all_builds, line_number_dict, species, build)
            if line_number == None: print("Can't find line number for ideal build:", species, build)
            MonTeam = [species, line_number]
            temp_matchups = []
            for trainerTeam in trainersTeamsCurrentTrainer:
                for _ in range(RUN_N_TIMES):
                    temp_matchups.append([new_teams[trainerTeam], MonTeam])
            IdealMatchups.append(temp_matchups)

# Write the matchups to the output JSON file
random.shuffle(finalMatchups)
Output = IdealMatchups + finalMatchups
print(len(Output))

with open('Inputs/tournament_battles.json', 'w') as file:
    json.dump(Output, file, indent=2)
