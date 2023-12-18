/**
 * Battle Stream Example
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * Example of how to create AIs battling against each other.
 * Run this using `node build && node dist/sim/examples/simulation-test-1`.
 *
 * @license MIT
 * @author Guangcong Luo <guangcongluo@gmail.com>
 */

import {BattleStream, getPlayerStreams, Teams} from '..';
import {RandomPlayerAI} from '../tools/random-player-ai';
import * as fs from 'fs';
import {ObjectReadWriteStream} from '../../lib/streams';
import {Dex, toID} from '../dex';
import {PRNG, PRNGSeed} from '../prng';
import {AIOptions, Runner} from '../tools/runner';
import { PokemonSet } from '../teams';
import { Field } from '../field';
import { PassThrough } from 'stream';

interface trackerPokemon {
	species: string | undefined
	currentHp: number
	currentHpPercent: number
	boosts: {}
	stats: {}
	moves: [],
	n_remaining_mons: number,
	sideConditions: {}
	firstTurn: number
	protectCount: number
}

// a class for tracking useful information about the pokemon currently on the field
// note this only currently works for singles battles, though could be modified to work for doubles
class activeTracker {
    private _p1_active: trackerPokemon;
    private _p2_active: trackerPokemon;

    constructor() {
        this._p1_active = {
			species: undefined,
			currentHp: 0,
			currentHpPercent: 0,
			boosts: {},
			stats: {},
			moves: [],
			n_remaining_mons: 0,
			sideConditions: {},
			firstTurn: 0,
			protectCount: 0
		  };
        this._p2_active = {
			species: undefined,
			currentHp: 0,
			currentHpPercent: 0,
			boosts: {},
			stats: {},
			moves: [],
			n_remaining_mons: 0,
			sideConditions: {},
			firstTurn: 0,
			protectCount: 0
		  };
    }

    get p1_active(): trackerPokemon{
        return this._p1_active;
    }

    set p1_active(pokemon: trackerPokemon) {
        this._p1_active = pokemon;
    }

    get p2_active(): trackerPokemon {
        return this._p2_active;
    }

    set p2_active(pokemon: trackerPokemon ) {
        this._p2_active = pokemon;
    }
}


/**
Structure of 'request' in random-player-ai, pokemon will have however many pokemon objects as there are on the team
{
	active: [ { moves: [Array] } ],
	side: { name: 'Bot 1', id: 'p1', pokemon: [ [Object], [Object] ], sideConditions: {} } 
} 

Structure of request.side.pokemon
	i.e. can use request.side.pokemon.condition to get current hp
{
	ident: 'p1: Calyrex',
	details: 'Calyrex-Ice',
	condition: '341/341',
	active: true,
	stats: { atk: 429, def: 337, spa: 185, spd: 296, spe: 218 },
	moves: [ 'substitute', 'glaciallance', 'swordsdance', 'leechseed' ],
	baseAbility: 'asoneglastrier',
	item: 'leftovers',
	pokeball: 'pokeball',
	ability: 'asoneglastrier'
	boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
	trapped: false,
},

Structure of request.side.foe.pokemon
[
  {
    m: {},
    baseSpecies: '[Species:darmanitangalar]',
    species: '[Species:darmanitangalar]',
    speciesState: { id: 'darmanitangalar' },
    gender: 'M',
    dynamaxLevel: 10,
    gigantamax: false,
    moveSlots: [ [Object], [Object], [Object], [Object] ],
    position: 0,
    details: 'Darmanitan-Galar, M',
    status: '',
    statusState: {},
    volatiles: {},
    hpType: 'Dark',
    hpPower: 60,
    baseHpType: 'Dark',
    baseHpPower: 60,
    baseStoredStats: { atk: 379, def: 146, spa: 86, spd: 147, spe: 317, hp: 351 },
    storedStats: { atk: 379, def: 146, spa: 86, spd: 147, spe: 317 },
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    baseAbility: 'gorillatactics',
    ability: 'gorillatactics',
    abilityState: { id: 'gorillatactics', choiceLock: '', target: '[Pokemon:p1a]' },
    item: 'choicescarf',
    itemState: { id: 'choicescarf', target: '[Pokemon:p1a]' },
    lastItem: '',
    usedItemThisTurn: false,
    ateBerry: false,
    trapped: false,
    maybeTrapped: false,
    maybeDisabled: false,
    illusion: null,
    transformed: false,
    fainted: false,
    faintQueued: false,
    subFainted: null,
    types: [ 'Ice' ],
    addedType: '',
    knownType: true,
    apparentType: 'Ice',
    switchFlag: false,
    forceSwitchFlag: false,
    skipBeforeSwitchOutEventFlag: false,
    draggedIn: null,
    newlySwitched: false,
    beingCalledBack: false,
    lastMove: null,
    lastMoveUsed: null,
    moveThisTurn: '',
    statsRaisedThisTurn: false,
    statsLoweredThisTurn: false,
    hurtThisTurn: null,
    lastDamage: 0,
    attackedBy: [],
    isActive: true,
    activeTurns: 1,
    activeMoveActions: 0,
    previouslySwitchedIn: 1,
    truantTurn: false,
    isStarted: true,
    duringMove: false,
    weighthg: 1200,
    speed: 475,
    abilityOrder: 0,
    canMegaEvo: null,
    canUltraBurst: null,
    canGigantamax: null,
    maxhp: 351,
    baseMaxhp: 351,
    hp: 351,
    set: {
      name: 'Darmanitan',
      species: 'Darmanitan-Galar',
      item: 'Choice Scarf',
      ability: 'Gorilla Tactics',
      gender: '',
      nature: 'Jolly',
      evs: [Object],
      ivs: [Object],
      level: 100,
      moves: [Array]
    }
  },

Structure of Dex.species.get("pokemon name")
Species {
  exists: true,
  tags: [ 'Restricted Legendary' ],
  num: 898,
  name: 'Calyrex-Ice',
  baseSpecies: 'Calyrex',
  forme: 'Ice',
  types: [ 'Psychic', 'Ice' ],
  gender: 'N',
  baseStats: { hp: 100, atk: 165, def: 150, spa: 85, spd: 130, spe: 50 },
  abilities: { '0': 'As One (Glastrier)' },
  heightm: 2.4,
  weightkg: 809.1,
  color: 'White',
  eggGroups: [ 'Undiscovered' ],
  changesFrom: 'Calyrex',
}

Structure of request.side.sideConditions
sideConditions: {
    toxicspikes: {
      id: 'toxicspikes',
      target: [Object],
      source: [Object],
      sourceSlot: 'p2a',
      layers: 1
    }

/*********************************************************************
 * Class to represent a rule based player AI
 * 	overrides the chooseMove, chooseSwitch, chooseTeamPreview, and shouldDynamax functions in random-player-ai
 *********************************************************************/
export class HeuristicsPlayerAI extends RandomPlayerAI {
	private readonly activeTracker: activeTracker;

	private ENTRY_HAZARDS = ["spikes", "stealthrock", "stickyweb", "toxicspikes"]
	private ANTI_HAZARDS_MOVES = ["rapidspin", "defog", "tidyup"]
	private SELF_RECOVERY_MOVES = ["healorder", "milkdrink", "recover", "rest", "roost", "slackoff", "softboiled"]
	private WEATHER_SETUP_MOVES = {"chillyreception":"Snow", "hail":"Hail", "raindance":"RainDance", "sandstorm":"Sandstorm",
		"snowscape":"Snow", "sunnyday":"SunnyDay"}
    private SPEED_TIER_COEFICIENT = 0.1
    private HP_FRACTION_COEFICIENT = 0.4
    private SWITCH_OUT_MATCHUP_THRESHOLD = -2
	private SELF_KO_MOVE_MATCHUP_THRESHOLD = 0.3
	private TRICK_ROOM_THRESHOLD = 85
	private RECVOERY_MOVE_THRESHOLD = 0.4
	private ACCURACY_SWITCH_THRESHOLD = -3

	constructor(playerStream: ObjectReadWriteStream<string>, options: AIOptions, activeTracker: activeTracker) {
		super(playerStream, options);
		this.activeTracker = activeTracker;
	}

	// estimates a given matchup and returns a score
	protected _estimateMatchup(request, nonActiveMon?): number {
		this._updateActiveTracker(request)
		const mon_opponent = this._getCurrentPlayer(request)
		var mon = mon_opponent[0].species!
		var opponent = mon_opponent[1].species!
		if (nonActiveMon) mon = nonActiveMon.details!
		const {Dex} = require('pokemon-showdown');
		let score = 1;
    	score = this.bestDamageMultiplier(mon, opponent)
		score -= this.bestDamageMultiplier(opponent, mon)
		if (Dex.species.get(mon).baseStats.spe > Dex.species.get(opponent).baseStats.spe) {
			score += this.SPEED_TIER_COEFICIENT;
		} else if (Dex.species.get(opponent).baseStats.spe > Dex.species.get(mon).baseStats.spe) {
			score -= this.SPEED_TIER_COEFICIENT;
		}
		if (request.side.id == "p1") {
			if (nonActiveMon) score += this._getCurrentHp(nonActiveMon.condition) * this.HP_FRACTION_COEFICIENT;
			else score += this.activeTracker.p1_active!.currentHp * this.HP_FRACTION_COEFICIENT;
			score -= this.activeTracker.p2_active!.currentHp * this.HP_FRACTION_COEFICIENT;
		} else {
			if (nonActiveMon) score += this._getCurrentHp(nonActiveMon.condition) * this.HP_FRACTION_COEFICIENT;
			else score += this.activeTracker.p2_active!.currentHp * this.HP_FRACTION_COEFICIENT;
			score -= this.activeTracker.p1_active!.currentHp * this.HP_FRACTION_COEFICIENT;
		}
		return score;
	}

	// estimate matchup function for team preview
	protected _estimateMatchupTeamPreview(nonActiveMon, nonActiveOpp): number  {
		const monName = nonActiveMon.details
		const oppName = nonActiveOpp.species
		const {Dex} = require('pokemon-showdown');
		let score = 1;
    	score = this.bestDamageMultiplier(monName, oppName)
		score -= this.bestDamageMultiplier(oppName, monName)
		if (Dex.species.get(monName).baseStats.spe > Dex.species.get(oppName).baseStats.spe) {
			score += this.SPEED_TIER_COEFICIENT;
		} else if (Dex.species.get(oppName).baseStats.spe > Dex.species.get(monName).baseStats.spe) {
			score -= this.SPEED_TIER_COEFICIENT;
		}
		// calculating max hp for opponent since there is no maxHp in dex or currenthp in request.side.foe.pokemon
		const oppHp = Math.floor((((2 * Number(Dex.species.get(nonActiveOpp.species).baseStats.hp))
			+ Number(nonActiveOpp.ivs.hp) + Math.floor(Number(nonActiveOpp.evs.hp) / 4) ) * Number(nonActiveOpp.level)) / 100) 
			+ Number(nonActiveOpp.level) + 10
		score += this._getCurrentHp(nonActiveMon.condition) * this.HP_FRACTION_COEFICIENT;
		score -= oppHp * this.HP_FRACTION_COEFICIENT;
		return score;
	}

	protected shouldDynamax(request, canDynamax: boolean): boolean {
		this._updateActiveTracker(request)
		if (canDynamax) {
			const mon_opponent = this._getCurrentPlayer(request)
			const mon = mon_opponent[0]
			const opponent = mon_opponent[1]
			// if active mon is the last full HP mon
			if (
				request.side.pokemon.filter((m) => parseInt(m.condition.split('/')[0], 10) == 1).length == 1
				&& mon.currentHp == 1
			) {
				return true
			}
			// Matchup advantage and full hp on full hp
			if ((this._estimateMatchup(request)>0) && mon.currentHpPercent == 1 && opponent.currentHpPercent == 1) {
				return true
			}
			// last pokemon
			if (
				request.side.pokemon.filter((m) => Number(this._getHpFraction(m.condition)) != 0).length == 1
				&& mon.currentHpPercent == 1
			) {
				return true
			}
		}
		return false
	}

	protected _should_switch_out(request) {
		this._updateActiveTracker(request)
		const mon_opponent = this._getCurrentPlayer(request)
		const mon = mon_opponent[0]
		const opponent = mon_opponent[1]
		const availableSwitches = (request.side.pokemon).filter((m) => ((m.active == false) && this._getHpFraction(m.condition) != 0))

		// If there is a decent switch in and not trapped...
		if (availableSwitches.filter(m => this._estimateMatchup(request) > 0).length && request.side.pokemon.trapped == false) {
			// ...and a 'good' reason to switch out
			if (mon.boosts["accuracy"] <= this.ACCURACY_SWITCH_THRESHOLD) {
				return true
			}
            if (mon.boosts["def"] <= -3 || mon.boosts["spd"] <= -3) {
                return true
			}
			if (mon.boosts["atk"] <= -3 && mon.stats["atk"] >= mon.stats["spa"]) {
				return true
			}
			if (mon.boosts["spa"] <= -3 && mon.stats["atk"] <= mon.stats["spa"]) {
				return true
			}
			if (this._estimateMatchup(request) < this.SWITCH_OUT_MATCHUP_THRESHOLD) {
                return true
			}
		}
		return false
	}

	protected _stat_estimation(mon, stat) {
		// Stats boosts value
        if (mon.boosts[stat] > 1) {
            const  boost = (2 + mon.boosts[stat]) / 2
			return ((2 * Dex.species.get(mon.species).baseStats[stat] + 31) + 5) * boost
		} else {
            const boost = 2 / (2 - mon.boosts[stat])
			return ((2 * Dex.species.get(mon.species).baseStats[stat] + 31) + 5) * boost
		}
	}

	protected chooseMove(request, active, moves: {choice: string, move}[], canDynamax, possibleMoves): [string, boolean] {
		this._updateActiveTracker(request)
		const mon_opponent = this._getCurrentPlayer(request)
		const mon = mon_opponent[0]
		const opponent = mon_opponent[1]
		
		// update protect count if it's on cooldown
		if (mon.protectCount > 0) {
			mon.protectCount -= 1
		}

		const currentWeather = request.side.pokemon[0].battle.field.weather
		const allMoves = possibleMoves

		// if the move is out of pp or is disabled, we ignore it when figuring out what move to use
		for (var move of possibleMoves) {
			if (move.pp == 0 || move.disabled == true) {
				possibleMoves = possibleMoves.filter((m) => (m.id || m.move) !== (move.id || move.move));
			}
		}
		
		// Rough estimation of damage ratio
        const physical_ratio = this._stat_estimation(mon, "atk") / this._stat_estimation(opponent, "def")
        const special_ratio = this._stat_estimation(mon, "spa") / this._stat_estimation(opponent, "spd")

		// list of all side conditions on each player's side
		const monSideConditionList = Object.keys(mon.sideConditions).map(move => mon.sideConditions[move].id)
		const oppSideConditionList = Object.keys(opponent.sideConditions).map(move => opponent.sideConditions[move].id)

		// if the pokemon has moves and shouldn't switch out, or is the last pokemon left
		if (possibleMoves && !(this._should_switch_out(request)) 
		|| (request.side.pokemon.filter((m) => Number(this._getHpFraction(m.condition)) != 0).length == 1 && mon.currentHpPercent == 1)) {
			const n_remaining_mons = mon.n_remaining_mons
            const n_opp_remaining_mons = opponent.n_remaining_mons

			// Fake Out
				// If pokemon's first turn out and opponent isn't immune use fake out
			for (var move of possibleMoves) {
				if ((move.id || move.move) == "fakeout" && mon.firstTurn == 1 && !("Ghost" in Dex.species.get(opponent.species).types)) {
					mon.firstTurn = 0
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}
			mon.firstTurn = 0

			// Explosion/Self destruct
				// use if health < 0.3 and opponent isn't immune
			for (var move of possibleMoves) {
				if (((move.id || move.move) == "explosion" || (move.id || move.move) == "selfdestruct") 
				&& mon.currentHpPercent<this.SELF_KO_MOVE_MATCHUP_THRESHOLD && opponent.currentHpPercent>0.5
				&& !("Ghost" in Dex.species.get(opponent.species).types)) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Deal with non weather related field changing effects
			for (var move of possibleMoves) {
				// Tailwind
				if ((move.id || move.move) == "tailwind" && !monSideConditionList.includes(move.id || move.move)) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
				// Trick room
					// if pokemon has trick room and we have at least 3 pokemon slower than the trick room threshold
				if ((move.id || move.move) == "trickroom" && !monSideConditionList.includes(move.id || move.move)
				&& request.side.pokemon.map(m => m.stats.spd).filter(spd => spd <= this.TRICK_ROOM_THRESHOLD).length >= 3) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
				// Aurora veil
				if ((move.id || move.move) == "auroraveil" && !monSideConditionList.includes(move.id || move.move)
				&& currentWeather == ("Hail" || "Snow")) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
				// Light Screen
				if ((move.id || move.move) == "lightscreen" && !monSideConditionList.includes(move.id || move.move)
				&& Dex.species.get(opponent.species).baseStats.spa > Dex.species.get(opponent.species).baseStats.atk) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
                // Reflect
				if ((move.id || move.move) == "reflect" && !monSideConditionList.includes(move.id || move.move)
				&& Dex.species.get(opponent.species).baseStats.atk > Dex.species.get(opponent.species).baseStats.spa) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Entry hazard...
            for (var move of possibleMoves) {
                // ...setup
                if (
                    n_opp_remaining_mons >= 3
                    && (this.ENTRY_HAZARDS.includes(move.id || move.move))
					&& this.ENTRY_HAZARDS.filter(word => oppSideConditionList
						.includes(word)).length === 0 // opponent doesn't already have an entry hazard
				) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
                // ...removal
                else if (
					n_remaining_mons >= 2
                    && this.ANTI_HAZARDS_MOVES.includes(move.id || move.move)
                    && this.ENTRY_HAZARDS.filter(word => monSideConditionList
						.includes(word)).length > 0 // mon has an entry hazard
                ) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Court Change
				// use if either the opponent has some good side condition you want or you want to give them an entry hazard
				// and you have no good side conditions to give them, and they have no entry hazards
			for (var move of possibleMoves) {
				if (
					(move.id || move.move) == "courtchange" 
					&& (!(this.ENTRY_HAZARDS.filter(word => monSideConditionList.includes(word)).length === 0)
					|| oppSideConditionList.includes("tailwind" || "lightscreen" || "reflect"))
					&& !monSideConditionList.includes("tailwind" || "lightscreen" || "reflect")
					&& this.ENTRY_HAZARDS.filter(word => oppSideConditionList.includes(word)).length === 0) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Self recovery moves
				// use recovery moves if health is less than RECVOERY_MOVE_THRESHOLD
			for (var move of possibleMoves) {
				if (this.SELF_RECOVERY_MOVES.includes(move.id || move.move) && mon.currentHpPercent < this.RECVOERY_MOVE_THRESHOLD) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Strength sap 
			for (var move of possibleMoves) {
				if ((move.id || move.move) == "strengthsap" && mon.currentHpPercent < 0.5 && Dex.species.get(opponent.species).baseStats.atk > 80) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			// Weather setup moves
			for (var move of possibleMoves) {
				if ((move.id || move.move) in this.WEATHER_SETUP_MOVES && currentWeather != this.WEATHER_SETUP_MOVES[(move.id || move.move)].toLowerCase()) {
					// dealing with Kyogre and Groudon's upgraded weather conditions
					if (!(currentWeather == "PrimordialSea" && this.WEATHER_SETUP_MOVES[(move.id || move.move)]== "RainDance")
					&& !(currentWeather == "DesolateLand" && this.WEATHER_SETUP_MOVES[(move.id || move.move)] == "SunnyDay")) {
						return [this._getMoveSlot((move.id || move.move), allMoves), false]
					}
				}
			}

			// Setup moves
            if (mon.currentHpPercent == 1 && this._estimateMatchup(request) > 0) {
				const SETUP_MOVES = JSON.parse(fs.readFileSync("../Data/UsefulDatasets/setup_moves.json", 'utf-8'));
                for (var move of possibleMoves) {
					// if move is a setup move and the pokemon has a stat that can be boosted by the move
					if ((move.id || move.move) in SETUP_MOVES
						&& Math.min(...(Object.keys(this._getNonZeroStats((move.id || move.move)))).map(key => mon.boosts[key])) < 6
					) {
						if ((move.id || move.move) == "curse" && (("Ghost") in Dex.species.get(mon.species).types)){
							continue; // curse isn't a set up move for ghost types
						}
						else {
							return [this._getMoveSlot((move.id || move.move), allMoves), false]
						}
					}
				}
			}

			// Status Inflicting Moves
			const STATUS_INFLICTING_MOVES = JSON.parse(fs.readFileSync("../Data/UsefulDatasets/status_inflicting_moves.json", 'utf-8'));
			for (var move of possibleMoves) {
				const activeOpp = request.side.foe.pokemon.filter(mon => mon.isActive == true)[0];
				// make sure the opponent doesn't already have a status condition
				if ((Object.keys(activeOpp.volatiles).includes("curse") || activeOpp.status != '')
				&& opponent.currentHpPercent > 0.6 && mon.currentHpPercent > 0.5) {
					const cond = STATUS_INFLICTING_MOVES[(move.id || move.move)]
					switch (cond) {
						case "burn":
							if (!("Fire" in Dex.species.get(opponent.species).types) && Dex.species.get(opponent.species).baseStats.atk > 80) {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "paralysis":
							if (!("Electric" in Dex.species.get(opponent.species).types) && Dex.species.get(opponent.species).baseStats.spe > Dex.species.get(mon.species).baseStats.spe) {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "sleep":
							if (!("Grass" in Dex.species.get(opponent.species).types && (move.id || move.move) === "spore" || "sleeppowder")
							&& Dex.species.get(opponent.species).baseStats.spe > Dex.species.get(mon.species).baseStats.spe
							&& request.side.foe.pokemon.ability != "insomnia"
							&& request.side.foe.pokemon.ability != "sweetveil") {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "confusion":
							if (!(("Poison" || "Steel") in Dex.species.get(opponent.species).types)
							&& request.side.foe.pokemon.ability != "magicguard"
							&& request.side.foe.pokemon.ability != "owntempo"
							&& request.side.foe.pokemon.ability != "oblivious") {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "poison":
							if (!(("Poison" || "Steel") in Dex.species.get(opponent.species).types)
							&& request.side.foe.pokemon.ability != "immunity"
							&& request.side.foe.pokemon.ability != "magicguard") {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "cursed":
							if ((("Ghost") in Dex.species.get(mon.species).types)
							&& request.side.foe.pokemon.ability != "magicguard") {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
						case "leech":
							if (!("Grass" in Dex.species.get(opponent.species).types)
							&& request.side.foe.pokemon.ability != "magicguard") {
								return [this._getMoveSlot((move.id || move.move), allMoves), false]
							}
							break;
					}
				}
            }

			// Accuracy lowering moves
				// if you have a good matchup, and the opponent isn't below -1 accuracy
			for (var move of possibleMoves) {
				if (mon.currentHpPercent == 1 && this._estimateMatchup(request) > 0
				&& opponent.boosts["accuracy"] > this.ACCURACY_SWITCH_THRESHOLD) {
					return [this._getMoveSlot((move.id || move.move), allMoves), false]
				}
			}

			//Protect style moves
				// Use if protect wasn't used last turn and opponent is poisoned, burned, or if your mon is leech seeded
			for (var move of possibleMoves) {
				const activeOpp = request.side.foe.pokemon.filter(mon => mon.isActive == true)[0];
				if ((move.id || move.move) == ("protect" || "banefulbunker" || "obstruct" || "craftyshield" || "detect" || "quickguard" || "spikyshield" || "silktrap")) {
					// stall out side conditions
					if (((oppSideConditionList.includes("tailwind" || "lightscreen" || "reflect" || "trickroom")
					&& !monSideConditionList.includes("tailwind" || "lightscreen" || "reflect")) 
					|| (Object.keys(activeOpp.volatiles).includes("curse") || activeOpp.status != '')) // opp has no status conditions
					&& (mon.protectCount == 0) && (request.side.foe.pokemon.ability != "unseenfist")) {
						mon.protectCount = 2
						return [this._getMoveSlot((move.id || move.move), allMoves), false]
					}
				}
			}

			// Damage dealing moves
			const moveValues: { [move: string]: number } = {};
			for (const move of possibleMoves) {
				moveValues[(move.id || move.move)] = Dex.moves.get(move.id || move.move).basePower
				* (Dex.moves.get((move.id || move.move)).type in Dex.species.get(mon.species).types ? 1.5 : 1)
				* (Dex.moves.get((move.id || move.move)).category === "Physical" ? physical_ratio : special_ratio)
				* Number(Dex.moves.get((move.id || move.move)).accuracy)
				* this._expectedHits((move.id || move.move))
				* this.bestDamageMultiplier(move.id || move.move, opponent.species!, true);

				// if fakeout wasn't used earlier, it will fail
				if ((move.id || move.move) == "fakeout") {
					moveValues[(move.id || move.move)] = 0
                }

				if (
					(request.side.foe.pokemon.ability == "lightningrod") && Dex.moves.get((move.id || move.move)).type == "electric"
					|| (request.side.foe.pokemon.ability == "flashfire") && Dex.moves.get((move.id || move.move)).type == "fire"
					|| (request.side.foe.pokemon.ability == "levitate") && Dex.moves.get((move.id || move.move)).type == "ground"
					|| (request.side.foe.pokemon.ability == "sapsipper") && Dex.moves.get((move.id || move.move)).type == "grass"
					|| (request.side.foe.pokemon.ability == "motordrive") && Dex.moves.get((move.id || move.move)).type == "electric"
					|| (request.side.foe.pokemon.ability == "stormdrain") && Dex.moves.get((move.id || move.move)).type == "water"
					|| (request.side.foe.pokemon.ability == "voltabsorb") && Dex.moves.get((move.id || move.move)).type == "electric"
					|| (request.side.foe.pokemon.ability == "waterabsorb") && Dex.moves.get((move.id || move.move)).type == "water"
					|| (request.side.foe.pokemon.ability == "immunity") && Dex.moves.get((move.id || move.move)).type == "poison"
					|| (request.side.foe.pokemon.ability == "eartheater") && Dex.moves.get((move.id || move.move)).type == "ground"
					|| (request.side.foe.pokemon.ability == "suctioncup") && (move.id || move.move) == ("roar" || "whirlwind")
				) {
					moveValues[(move.id || move.move)] = 0;
				}
			}
			const bestMoveValue = Math.max(...Object.values(moveValues));
			if (!('recharge' in moveValues)) {
				const bestMove = Object.keys(moveValues).find(m => moveValues[m] === bestMoveValue);
				return [this._getMoveSlot(bestMove!, allMoves), this.shouldDynamax(request, canDynamax)]
			} else {
				return ["move 1", this.shouldDynamax(request, canDynamax)]
			}
		}

		// healing wish (dealing with it here because you'd only use it if you should switch out anyway)
		for (var move of possibleMoves) {
			if ((move.id || move.move) == "healingwish" && mon.currentHpPercent<this.SELF_KO_MOVE_MATCHUP_THRESHOLD) {
				return [this._getMoveSlot((move.id || move.move), allMoves), false]
			}
		}

		// switch out
		if (this._should_switch_out(request)) {
			const availableSwitches = (request.side.pokemon).filter((m) => ((m.active == false) && this._getHpFraction(m.condition) != 0))
			let bestEstimation = Math.max(...availableSwitches.map(pokemon => this._estimateMatchup(request, pokemon)))
			let bestMatchup = availableSwitches.find(pokemon => this._estimateMatchup(request, pokemon) === bestEstimation)
			return ["switch ".concat(this._getPokemonPos(request, bestMatchup)), canDynamax]
		}
		mon.firstTurn = 0
		// otherwise can't find a good option so use a random move
		return [this.prng.sample(moves).choice, false]
	}

	// gets the slot number of the pasased in move
	protected _getMoveSlot(move: string, possibleMoves) {
		const bestMoveSlotIndex = possibleMoves.findIndex(item => (item.id || item.move) === move) + 1
		var bestMoveSlot
		if (bestMoveSlotIndex == 1) bestMoveSlot = "move 1"
		if (bestMoveSlotIndex == 2) bestMoveSlot = "move 2"
		if (bestMoveSlotIndex == 3) bestMoveSlot = "move 3"
		if (bestMoveSlotIndex == 4) bestMoveSlot = "move 4"
		return bestMoveSlot
	}

	// gets the slot number of the bestMatchup pokemon in the team
	protected _getPokemonPos(request, bestMatchup) {
		return (request.side.pokemon).filter((pokemon) => (pokemon.details == bestMatchup.details && this._getHpFraction(pokemon.condition) != 0 && pokemon.active == false))[0].position+1
	}

	// returns an approximate number of hits for a given move for estimation purposes
	protected _expectedHits(move: string): number {
		const minMaxHits = Dex.moves.get(move).multihit
		if (move == "triplekick" || move == "tripleaxel") {
            //Triple Kick and Triple Axel have an accuracy check for each hit, and also
            //rise in BP for each hit
            return 1 + 2 * 0.9 + 3 * 0.81
		}
		if (move == "populationbomb") {
            // population bomb hits until it misses, 90% accuracy
            return 7
		}
        if (minMaxHits == undefined || minMaxHits[0] == minMaxHits[1]) {
			// non multihit move
            return 1
		}
        else {
            // It hits 2-5 times
            return (2 + 3) / 3 + (4 + 5) / 6
		}
	}

	// Chooses the best pokemon to switch to
	protected chooseSwitch(request, active: AnyObject | undefined, switches: {slot: number, pokemon: AnyObject}[]): number {
		this._updateActiveTracker(request)
		const availableSwitches = (request.side.pokemon).filter((m) => ((m.active == false) && this._getHpFraction(m.condition) != 0))
		if (!availableSwitches) return 1
		let bestEstimation = Math.max(...availableSwitches.map(pokemon => this._estimateMatchup(request, pokemon)))
		let bestMatchup = availableSwitches.find(pokemon => this._estimateMatchup(request, pokemon) === bestEstimation)
		this._getCurrentPlayer(request)[0].firstTurn = 1
		return Number(this._getPokemonPos(request, bestMatchup))
	}

	protected chooseTeamPreview(request, team: AnyObject[]): string {
		this._updateActiveTracker(request)
		return "team 1"; // Uncomment to make the bot choose the best mon based on the opponent's team
		const mons = request.side.pokemon
		const opponentPokemon = request.side.foe.pokemon.map(m => m.set)
		var bestMon
		var bestAverage
		var matchups
		var average
		for (var mon of mons) {
			matchups = opponentPokemon.map(opp => this._estimateMatchupTeamPreview(mon, opp))
			average = matchups.reduce((total, value) => total + value, 0) / matchups.length
			if (bestAverage == undefined || average > bestAverage) {
				bestMon = mon
				bestAverage = average
			}
		}
		// If you have a pokemon with some setup move that will benefit other pokemon on the team, use that first
		for (var mon of mons) {
			for (var move of mon.moves) {
				if ((move.id || move.move) in this.WEATHER_SETUP_MOVES
					|| (move.id || move.move) in this.ENTRY_HAZARDS
					|| (move.id || move.move) == "tailwind"
					|| (move.id || move.move) == "trickroom"
					|| (move.id || move.move) == "auroraveil"
					|| (move.id || move.move) == "lightscreen"
					|| (move.id || move.move) == "reflect"
				) {
					bestMon = mon
				}
			}
		}
		this._getCurrentPlayer(request)[0].firstTurn = 1
		return "team ".concat(bestMon.position+1);
	}

	// returns the type with the best damage multiplier against the opponent
	protected bestDamageMultiplier(attacker: string, defender: string, isMove: boolean = false): number {
		const typeMatchups = JSON.parse(fs.readFileSync("../Data/UsefulDatasets/type-chart.json", 'utf-8'));
		var attackerTypes;
		if (isMove) {
			attackerTypes = [Dex.moves.get(attacker).type, "???"]
		} else {
			attackerTypes = Dex.species.get(attacker).types
		}
		const defenderTypes = Dex.species.get(defender).types
		let multiplier = 1;
		let bestMultiplier = 1
		let counter = 0
		for (const attackerType of attackerTypes) {
			for (const defenderType of defenderTypes) {
				if (!(attackerType=="???") && !(defenderType=="???")
				&& !(attackerType==undefined) && !(defenderType==undefined)
				&& !(attackerType=="") && !(defenderType=="")) {
					multiplier *= Number(typeMatchups[attackerType][defenderType]);
				}
			}
			if (counter == 0) {
				bestMultiplier = multiplier
			}
			counter += 1
		}
		return Math.max(multiplier, bestMultiplier);
	}

	// The move options provided by the simulator have been converted from the name
	// which we're tracking, so we need to convert them back.
	private fixMove(m) {
		const id = toID(m.move);
		if (id.startsWith('return')) return 'return';
		if (id.startsWith('frustration')) return 'frustration';
		if (id.startsWith('hiddenpower')) return 'hiddenpower';
		return id;
	}

	// takes hp in the form '457/457' and returns a decimal representing the amount left (with 1 as full hp and 0 as fainted)
	private _getHpFraction(condition : string): number {
		if (condition == "0 fnt") return 0
		const [numerator, denominator] = condition.split('/' || ' ').map(x => parseInt(x, 10));
		return numerator / denominator;
	}

	// takes hp in the form '457/457' and returns the amount of hp left
	private _getCurrentHp(condition : string): number {
		if (condition == "0 fnt") return 0
		return Number(condition.split('/' || ' ')[0]);
	}

	// takes a move name and returns the stats that are boosted by that move
	private _getNonZeroStats(name: string): { [key: string]: number } {
		const SETUP_MOVES = JSON.parse(fs.readFileSync("../Data/UsefulDatasets/setup_moves.json", 'utf-8'));
		if (name in SETUP_MOVES) {
			return Object.entries(SETUP_MOVES[name])
		  		.filter(([, value]) => value !== 0)
		  		.reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});
		}
		else {
			return {}
		}
	  }

	// fast way to update activeTracker, should be called before making decisions in choose functions
	private _updateActiveTracker(request) {
		// find active player
		if (request.side.id == "p1") {
			var mon = this.activeTracker.p1_active!
		} else {
			mon = this.activeTracker.p2_active!
		}
		// find active pokemon and update data
		for (var pokemon of request.side.pokemon) {
			if (pokemon.active == true) {
				mon.species = pokemon.species
				mon.currentHp = this._getCurrentHp(pokemon.condition)
				mon.currentHpPercent = this._getHpFraction(pokemon.condition)
				mon.boosts = pokemon.boosts
				mon.stats = pokemon.stats
				mon.moves = pokemon.moves
				mon.n_remaining_mons = request.side.pokemon.filter((m) => Number(this._getHpFraction(m.condition)) != 0).length
				mon.sideConditions = request.side.sideConditions
			}
		}
	}

	// returns the current pokemon for the player making the request, and the opponent
	private _getCurrentPlayer(request) {
		if (request.side.id == "p1") {
			var mon = this.activeTracker.p1_active!
			var opponent = this.activeTracker.p2_active!
			return [mon, opponent]
		} else {
			mon = this.activeTracker.p2_active!
			opponent = this.activeTracker.p1_active!
			return [mon, opponent]
		}
	}
}

/*********************************************************************
 * Run Simulation
 *********************************************************************/
async function main() {
	var threadNo = process.argv.slice(2)[0]
	var team1No = process.argv.slice(3)[0]
	var team2No = process.argv.slice(4)[0]

	var testTeam1 = "../Data/WorkerFiles/" + threadNo + "1.txt"
	var testTeam2 = "../Data/WorkerFiles/" + threadNo + "2.txt"

	// const battleStream = new BattleStream()
	// const streams = getPlayerStreams(battleStream);

	var f = fs.readFileSync(testTeam1, 'utf8');
	var g = fs.readFileSync(testTeam2, 'utf8');

	// var team1 = Teams.pack(Teams.import(f))
	// var team2 = Teams.pack(Teams.import(g))
	var maybeteam1 = Teams.import(f)
	var maybeteam2 = Teams.import(g)
	let team1: PokemonSet[] | undefined;
	let team2: PokemonSet[] | undefined;
	if (maybeteam1 !== null) {
		team1 = maybeteam1;
	}
	if (maybeteam2 !== null) {
		team2 = maybeteam2;
	}

	console.log("[[[[[")
	console.log(team1No + " vs " + team2No)

	const spec = {
		formatid: "gen9customgame",
	};
	const dex = Dex.forFormat(spec.formatid);

	const tracker = new activeTracker()
	const createAI = (s: ObjectReadWriteStream<string>, o: AIOptions) => new HeuristicsPlayerAI(s, o, tracker);

	try {
		// We run these sequentially instead of async so that the team generator
		// and the AI can coordinate usage properly.
		await new Runner({
			p1options: {team: team1, createAI},
			p2options: {team: team2, createAI},
			format: spec.formatid,
			output: true,
		}).run();
	} catch (err) {
		console.error(err);
	}
}

main();