import json
from itertools import combinations

def generate_tournament_matchups(input_file, output_file):
    # How many times to run each battle
    RUN_N_TIMES = 1

    # Read the JSON data from the input file
    with open(input_file, 'r') as file:
        gym_leaders_data = json.load(file)

    # Extract the teams into a list
    teams = list(gym_leaders_data.values())

    # Generate all possible pairs of teams for the tournament
    # Each matchup is repeated 100 times
    matchups = [[team1, team2] for team1, team2 in combinations(teams, 2) for _ in range(RUN_N_TIMES)]

    print(len(matchups))

    # Write the matchups to the output JSON file
    with open(output_file, 'w') as file:
        json.dump(matchups, file, indent=2)

# Example usage:
# generate_tournament_matchups('Inputs/tournament_battles/Badge7Battles.json', 'Inputs/tournament_battles.json')
generate_tournament_matchups('Inputs/GymLeaderTeams.json', 'Inputs/tournament_battles.json')