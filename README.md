# Pokémon Simulator Environment

Here we have an environment for running large amounts of Pokémon simulations in the command line. The Pokémon-showdown directory contains a modified version of https://github.com/smogon/pokemon-showdown, whose modifications are detailed below. In the Data directory, you can find various python files which can be used to build a set of battles from predefined text files of builds written in Pokémon Showdown output format, run large sets of multithreaded simulations, and parse and analyse the results of battles, producing a matrix of results. Additionally, Predefined teams for each trainer we used can be found in Data/Inputs. These are formatted inside of GymLeaderTeams.txt by referencing the species name and the line number of each pokemon build from GymLeaderPokemon.txt, for each member of the team.



## Requirements
* Python (tested on version 3.10.12, buy any python 3 version SHOULD suffice)
* Node.js (tested on node version 21.1.0 / npm version 8.10.2, but any SHOULD suffice)
* The following python libraries:
    * json
    * itertools
    * re
    * collections
    * matplotlib
    * numpy
    * PIL
    * csv
    * subprocess
    * threading
    * time
    * timeit



## Running Simulations Yourself
See [manual.md](https://github.com/cRz-Shadows/Pokemon_Trainer_Tournament_Simulator/blob/main/manual.md) for a more detailed guide if required.

TLDR:
If you wish to run a set of simulations, everything you need is located in the 'Data' directory. You can create or use a predefined input file in 'Inputs' subdirectory, then run BuildBattles.py to generate a json file of matchups to feed to the simulator. If you desire you can modify BuildBattles.py to generate matchups in whatever way you like. Make sure you build pokemon showdown by navigating to the "pokemon-showdown" directory and running "node build", then "npm install pokemon-showdown" before trying to run any simulations. From there just just have to run runSimulations.py. Before running this, you should scroll down to line 61 of runSimulations.py and adjust the number of threads to use. Running a ryzen 9 7950X, 50 threads seemed to be the sweet spot for me, but I would recommend starting small and upping it to what your CPU can handle. Battles with errors can be found and rerun using get_battles_to_rerun.py, findErrors.py and removeErrors.py, if required. Analysis can be performed using parseOutput.py (for a png matrix output) and parseOutput_CSV.py (for a csv matrix output).



## Modifications to Pokémon Showdown

* The code for our heuristics based bot can be found in "/pokemon-showdown/sim/examples/Simulation-test-1.ts". This is the file to edit if you with to modify the AI. Note that this AI extends "/pokemon-showdown/sim/tools/random-player-ai.ts". All calls to "chooseMove()," "chooseSwitch()," "choosePokemon()," and "chooseTeamPreview()" have also been modified in this file to pass in requests so that the bot can use that data when selecting what to do.

* In the file "/pokemon-showdown/sim/pokemon.ts," the "getSwitchRequestData()" function has been modified to include additional information for each Pokémon in each request message sent through the battle stream. Specifically, the modifications added information on the Pokémon's current boost table, its position on the battlefield, its maximum possible HP, any status effects applied to it, the species name, and whether it is trapped.

* In the file "/pokemon-showdown/sim/side.ts," the "getRequestData()" function has been modified to include information on any current side conditions on the battlefield, such as tailwind or trick room. Additionally, information on the foe has been added.

* In the file "/pokemon-showdown/sim/dex-moves.ts," The DataMove class' constructor has been modified to allow for checking how many times a multi-hit move hits.



## Check Out My Other Projects
* Pokemon Crystal Legacy: https://www.youtube.com/watch?v=oeJBVY3z_uE&t=55s
* Pokemon Crystal Legacy Github: https://github.com/cRz-Shadows/Pokemon_Crystal_Legacy



## Discussion and Community
* YouTube: https://www.youtube.com/@smithplayspokemon
* Discord: https://discord.gg/Wupx8tHRVS
* Twitter: https://twitter.com/TheSmithPlays
* Instagram: https://www.instagram.com/thesmithplays/
