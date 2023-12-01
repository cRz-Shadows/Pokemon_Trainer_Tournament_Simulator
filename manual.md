# Requirements and Installation
## Requirements
* [Python](https://www.python.org/downloads/) (tested on version 3.10.12, buy any python 3 version SHOULD suffice)
    * I would recommend installing [anaconda](https://docs.anaconda.com/free/anaconda/install/windows/), a package manager for python. This will help with managing your libraries and versions.
    * You should follow [this tutorial](https://www.datacamp.com/tutorial/installing-anaconda-windows) to install anaconda and you should make sure to do the optional "How to Add Anaconda to Path" part. This will add python as a path variable too.
    * Make sure running `python --version` in the terminal gives you the python version number before continuing
* [Node.js](https://nodejs.org/en/download) (tested on node version 21.1.0 / npm version 8.10.2, but any SHOULD suffice)
    * You should also add Node.js as a path variable, the installer should do this, but if not it is the same process as anaconda above.
    * Make sure running `node --version` in the terminal gives you the Node.js version number before continuing
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
* To install these, if you have anaconda, you can start anaconda prompt and run the commands:
    * `pip install matplotlib`
    * `pip install numpy`
    * `pip install Pillow`
    * The rest are standard libraries and are included with python

* Install [Git](https://git-scm.com/downloads).

* If you do not already have a preferred text editor installed, I recommend installing either [VS Code](https://code.visualstudio.com/download) or [Notepad++](https://notepad-plus-plus.org/downloads/).

## Download/Clone The Repository And Basic Setup

* Open command prompt/your native terminal, and use the [`cd`](https://www.geeksforgeeks.org/cd-cmd-command/) command to navigate to wherever you want to place the repository.
* Run `git clone https://github.com/cRz-Shadows/Pokemon_Trainer_Tournament_Simulator` to download the repository.
* You can alternatively use this [direct link](https://github.com/cRz-Shadows/Pokemon_Trainer_Tournament_Simulator/archive/refs/heads/main.zip) to download a zip file of the repository, but make sure you understand how to navigate the terminal with [`cd`](https://www.geeksforgeeks.org/cd-cmd-command/).
* now run `cd Pokemon_Trainer_Tournament_Simulator/pokemon-showdown` to enter pokemon showdown.
* Here you should run `node build`. This will compile pokemon showdown. If this fails for whatever reason, consult the [Pokemon Showdown Command-line Tools Documentation](https://github.com/smogon/pokemon-showdown/blob/master/COMMANDLINE.md)
* Everything should now be compiled
* now run `cd ../Data` to enter the Data directory.

# Running Simulations

## Edit the teams
* You will find two files inside of `Data/Inputs/`, these being `GymLeaderPokemon.txt` and `GymLeaderTeams.json`.
    * `GymLeaderPokemon.txt` contains a list of Pokemon builds in [Pokemon Showdown Export Format](https://github.com/smogon/pokemon-showdown/blob/master/sim/TEAMS.md), each with a `|` character placed in front of the pokemon species to separate each build. You can add more builds to this file by exporting builds from the pokemon showdown [team builder](https://play.pokemonshowdown.com/teambuilder) or [damage calculator](https://calc.pokemonshowdown.com/), then adding the `|` deliminator in front of the pokemon species. See `GymLeaderPokemon.txt` for example formatting.
    * `GymLeaderTeams.json` contains a map of trainer names to teams. Each pokemon in a team is a 2 element list of species, and the line number from `GymLeaderPokemon.txt` in which the first line of that build appears.

## BuildBattles.py
* Navigating to `Data/`, we see `BuildBattles.py`. This file takes in our pokemon trainer teams from before, and creates matchups for each combination. You can modify this to build battles in whatever way you like if you do not want all combinations. You can change the number of times each matchup is run by changing the `RUN_N_TIMES` variable - this is set to 1 by default.

## runSimulations.py
* Navigating to `Data/` we see `runSimulations.py`. This file takes our json file of matchups we created using BuildBattles.py, and uses multithreading to run them as fast as possible. You should change the variable `noOfThreads` on line 61 to something that will suit your CPU. Running a ryzen 9 7950X, 50 threads seemed to be the sweet spot for me, but I would recommend starting small and upping it to what your CPU can handle.

## Visualising The Output
* There are three main ways to visualise the output. The simplest way is by opening `output.txt` inside of the `Data/` directory. If you are running a large set of simulations, this file will be massive and be difficult to search through, so we have a few other methods of analysis.
* `parseOutput.py` parses output.txt and produces a png file in the same directory containing a matrix of results.
* `parseOutput_CSV.py` does the same thing, however prodices a CSV file of results rather than an png of a matrix.

## Error handling - if any appear
* If any battles encounter an error midway through (this can sometimes happen with showdown simulator battles if the ai does something stupid due to a bug or oversight), you can navigate to the `Data/ErrorChecking/` directory, which contains three files to find any errors in the file, make a list of any battles which need rerun due to those errors, and remove battles with errors. These should be run in that order if required.

# Modifying Or Viewing The AI
* The code for our heuristics based bot can be found in "Individual-Project/pokemon-showdown/sim/examples/Simulation-test-1.ts". This is the file to edit if you with to modify the AI. Note that this AI extends "/pokemon-showdown/sim/tools/random-player-ai.ts". All calls to "chooseMove()," "chooseSwitch()," "choosePokemon()," and "chooseTeamPreview()" have also been modified in this file to pass in requests so that the bot can use that data when selecting what to do.
