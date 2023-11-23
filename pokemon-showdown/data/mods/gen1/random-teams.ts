import RandomGen2Teams from '../gen2/random-teams';
import {Utils} from '../../../lib';
import {MoveCounter} from '../gen8/random-teams';

interface HackmonsCupEntry {
	types: string[];
	baseStats: StatsTable;
}

export class RandomGen1Teams extends RandomGen2Teams {
	// Challenge Cup or CC teams are basically fully random teams.
	randomCCTeam() {
		this.enforceNoDirectCustomBanlistChanges();

		const team = [];

		const randomN = this.randomNPokemon(this.maxTeamSize, this.forceMonotype);

		for (const pokemon of randomN) {
			const species = this.dex.species.get(pokemon);
			const learnset = this.dex.species.getLearnset(species.id);

			// Level balance: calculate directly from stats rather than using some silly lookup table.
			const mbstmin = 1307;
			const stats = species.baseStats;

			// Modified base stat total assumes 15 DVs, 255 EVs in every stat
			let mbst = (stats["hp"] * 2 + 30 + 63 + 100) + 10;
			mbst += (stats["atk"] * 2 + 30 + 63 + 100) + 5;
			mbst += (stats["def"] * 2 + 30 + 63 + 100) + 5;
			mbst += (stats["spa"] * 2 + 30 + 63 + 100) + 5;
			mbst += (stats["spd"] * 2 + 30 + 63 + 100) + 5;
			mbst += (stats["spe"] * 2 + 30 + 63 + 100) + 5;

			let level;
			if (this.adjustLevel) {
				level = this.adjustLevel;
			} else {
				level = Math.floor(100 * mbstmin / mbst); // Initial level guess will underestimate

				while (level < 100) {
					mbst = Math.floor((stats["hp"] * 2 + 30 + 63 + 100) * level / 100 + 10);
					// Since damage is roughly proportional to lvl
					mbst += Math.floor(((stats["atk"] * 2 + 30 + 63 + 100) * level / 100 + 5) * level / 100);
					mbst += Math.floor((stats["def"] * 2 + 30 + 63 + 100) * level / 100 + 5);
					mbst += Math.floor(((stats["spa"] * 2 + 30 + 63 + 100) * level / 100 + 5) * level / 100);
					mbst += Math.floor((stats["spd"] * 2 + 30 + 63 + 100) * level / 100 + 5);
					mbst += Math.floor((stats["spe"] * 2 + 30 + 63 + 100) * level / 100 + 5);

					if (mbst >= mbstmin) break;
					level++;
				}
			}

			// Random DVs.
			const ivs = {
				hp: 0,
				atk: this.random(16),
				def: this.random(16),
				spa: this.random(16),
				spd: 0,
				spe: this.random(16),
			};
			ivs["hp"] = (ivs["atk"] % 2) * 16 + (ivs["def"] % 2) * 8 + (ivs["spe"] % 2) * 4 + (ivs["spa"] % 2) * 2;
			ivs["atk"] *= 2;
			ivs["def"] *= 2;
			ivs["spa"] *= 2;
			ivs["spd"] = ivs["spa"];
			ivs["spe"] *= 2;

			// Maxed EVs.
			const evs = {hp: 255, atk: 255, def: 255, spa: 255, spd: 255, spe: 255};

			// Four random unique moves from movepool. don't worry about "attacking" or "viable".
			// Since Gens 1 and 2 learnsets are shared, we need to weed out Gen 2 moves.
			const pool: string[] = [];
			if (learnset) {
				for (const move in learnset) {
					if (this.dex.moves.get(move).gen !== 1) continue;
					if (learnset[move].some(learned => learned.startsWith('1'))) {
						pool.push(move);
					}
				}
			}

			team.push({
				name: species.baseSpecies,
				species: species.name,
				moves: this.multipleSamplesNoReplace(pool, 4),
				gender: false,
				ability: 'No Ability',
				evs: evs,
				ivs: ivs,
				item: '',
				level,
				happiness: 0,
				shiny: false,
				nature: 'Serious',
			});
		}

		return team;
	}

	// Random team generation for Gen 1 Random Battles.
	randomTeam() {
		this.enforceNoDirectCustomBanlistChanges();

		// Get what we need ready.
		const seed = this.prng.seed;
		const ruleTable = this.dex.formats.getRuleTable(this.format);
		const pokemon: RandomTeamsTypes.RandomSet[] = [];

		// For Monotype
		const isMonotype = !!this.forceMonotype || ruleTable.has('sametypeclause');
		const typePool = this.dex.types.names();
		const type = this.forceMonotype || this.sample(typePool);

		/** Pokémon that are not wholly incompatible with the team, but still pretty bad */
		const rejectedButNotInvalidPool: string[] = [];
		const nuTiers = ['UU', 'UUBL', 'NFE', 'LC', 'NU'];
		const uuTiers = ['NFE', 'UU', 'UUBL', 'NU'];

		// Now let's store what we are getting.
		const typeCount: {[k: string]: number} = {};
		const weaknessCount: {[k: string]: number} = {Electric: 0, Psychic: 0, Water: 0, Ice: 0, Ground: 0};
		let uberCount = 0;
		let nuCount = 0;

		const pokemonPool = this.getPokemonPool(type, pokemon, isMonotype);
		while (pokemonPool.length && pokemon.length < this.maxTeamSize) {
			const species = this.dex.species.get(this.sampleNoReplace(pokemonPool));
			if (!species.exists || !species.randomBattleMoves) continue;
			// Only one Ditto is allowed per battle in Generation 1,
			// as it can cause an endless battle if two Dittos are forced
			// to face each other.
			if (species.id === 'ditto' && this.battleHasDitto) continue;

			// Dynamically scale limits for different team sizes. The default and minimum value is 1.
			const limitFactor = Math.round(this.maxTeamSize / 6) || 1;

			const tier = species.tier;
			switch (tier) {
			case 'LC':
			case 'NFE':
				// Don't add pre-evo mon if already 4 or more non-OUs
				// Regardless, pre-evo mons are slightly less common.
				if (nuCount >= 4 * limitFactor || this.randomChance(1, 3)) continue;
				break;
			case 'Uber':
				// Only allow a single Uber.
				if (uberCount >= 1 * limitFactor) continue;
				break;
			default:
				// OUs are fine. Otherwise 50% chance to skip mon if already 4 or more non-OUs.
				if (uuTiers.includes(tier) && pokemonPool.length > 1 && (nuCount >= 4 * limitFactor && this.randomChance(1, 2))) {
					continue;
				}
			}

			let skip = false;

			if (!isMonotype && !this.forceMonotype) {
				// Limit 2 of any type as well. Diversity and minor weakness count.
				// The second of a same type has halved chance of being added.
				for (const typeName of species.types) {
					if (typeCount[typeName] >= 2 * limitFactor ||
						(typeCount[typeName] >= 1 * limitFactor && this.randomChance(1, 2) && pokemonPool.length > 1)) {
						skip = true;
						break;
					}
				}

				if (skip) {
					rejectedButNotInvalidPool.push(species.id);
					continue;
				}
			}

			// We need a weakness count of spammable attacks to avoid being swept by those.
			// Spammable attacks are: Thunderbolt, Psychic, Surf, Blizzard, Earthquake.
			const pokemonWeaknesses = [];
			for (const typeName in weaknessCount) {
				const increaseCount = this.dex.getImmunity(typeName, species) && this.dex.getEffectiveness(typeName, species) > 0;
				if (!increaseCount) continue;
				if (weaknessCount[typeName] >= 2 * limitFactor) {
					skip = true;
					break;
				}
				pokemonWeaknesses.push(typeName);
			}

			if (skip) {
				rejectedButNotInvalidPool.push(species.id);
				continue;
			}

			// The set passes the limitations.
			pokemon.push(this.randomSet(species));

			// Now let's increase the counters.
			// Type counter.
			for (const typeName of species.types) {
				if (typeCount[typeName]) {
					typeCount[typeName]++;
				} else {
					typeCount[typeName] = 1;
				}
			}

			// Weakness counter.
			for (const weakness of pokemonWeaknesses) {
				weaknessCount[weakness]++;
			}

			// Increment tier bias counters.
			if (tier === 'Uber') {
				uberCount++;
			} else if (nuTiers.includes(tier)) {
				nuCount++;
			}

			// Ditto check
			if (species.id === 'ditto') this.battleHasDitto = true;
		}

		// if we don't have enough Pokémon, go back to rejects, which are already known to not be invalid.
		while (pokemon.length < this.maxTeamSize && rejectedButNotInvalidPool.length) {
			const species = this.sampleNoReplace(rejectedButNotInvalidPool);
			pokemon.push(this.randomSet(species));
		}

		if (pokemon.length < this.maxTeamSize && pokemon.length < 12 && !isMonotype) {
			throw new Error(`Could not build a random team for ${this.format} (seed=${seed})`);
		}

		return pokemon;
	}

	shouldCullMove(move: Move, types: Set<string>, moves: Set<string>, counter: MoveCounter): {cull: boolean} {
		switch (move.id) {
		// bit redundant to have both, but neither particularly better than the other
		case 'hydropump':
			return {cull: moves.has('surf')};
		case 'surf':
			return {cull: moves.has('hydropump')};

		// other redundancies that aren't handled within the movesets themselves
		case 'selfdestruct':
			return {cull: moves.has('rest')};
		case 'rest':
			return {cull: moves.has('selfdestruct')};
		case 'sharpen': case 'swordsdance':
			return {cull: counter.get('Special') > counter.get('Physical') || !counter.get('Physical') || moves.has('growth')};
		case 'growth':
			return {cull: counter.get('Special') < counter.get('Physical') || !counter.get('Special') || moves.has('swordsdance')};
		case 'poisonpowder': case 'stunspore': case 'sleeppowder': case 'toxic':
			return {cull: counter.get('Status') > 1};
		}
		return {cull: false};
	}

	/**
	 * Random set generation for Gen 1 Random Battles.
	 */
	randomSet(species: string | Species): RandomTeamsTypes.RandomSet {
		species = this.dex.species.get(species);
		if (!species.exists) species = this.dex.species.get('pikachu'); // Because Gen 1.

		const movePool = species.randomBattleMoves ? species.randomBattleMoves.slice() : [];
		const moves = new Set<string>();
		const types = new Set(species.types);

		const counter = new MoveCounter();

		// Moves that boost Attack:
		const PhysicalSetup = ['swordsdance', 'sharpen'];
		// Moves which boost Special Attack:
		const SpecialSetup = ['amnesia', 'growth'];

		// Either add all moves or add none
		if (species.comboMoves && species.comboMoves.length <= this.maxMoveCount && this.randomChance(1, 2)) {
			for (const m of species.comboMoves) moves.add(m);
		}

		// Add one of the semi-mandatory moves
		// Often, these are used so that the Pokemon only gets one of the less useful moves
		if (moves.size < this.maxMoveCount && species.exclusiveMoves) {
			moves.add(this.sample(species.exclusiveMoves));
		}

		// Add the mandatory move. SD Mew and Amnesia Snorlax are exceptions.
		if (moves.size < this.maxMoveCount && species.essentialMove) {
			moves.add(species.essentialMove);
		}

		while (moves.size < this.maxMoveCount && movePool.length) {
			// Choose next 4 moves from learnset/viable moves and add them to moves list:
			while (moves.size < this.maxMoveCount && movePool.length) {
				const moveid = this.sampleNoReplace(movePool);
				moves.add(moveid);
			}

			// Only do move choosing if we have backup moves in the pool...
			if (movePool.length) {
				for (const setMoveid of moves) {
					const move = this.dex.moves.get(setMoveid);
					const moveid = move.id;
					if (!move.damage && !move.damageCallback) counter.add(move.category);
					if (PhysicalSetup.includes(moveid)) counter.add('physicalsetup');
					if (SpecialSetup.includes(moveid)) counter.add('specialsetup');
				}

				for (const moveid of moves) {
					if (moveid === species.essentialMove) continue;
					const move = this.dex.moves.get(moveid);
					if (
						(!species.essentialMove || moveid !== species.essentialMove) &&
						this.shouldCullMove(move, types, moves, counter).cull
					) {
						moves.delete(moveid);
						break;
					}
					counter.add(move.category);
				}
			} // End of the check for more than 4 moves on moveset.
		}

		const levelScale: {[k: string]: number} = {
			LC: 88,
			NFE: 80,
			PU: 77,
			NU: 77,
			NUBL: 76,
			UU: 74,
			UUBL: 71,
			OU: 68,
			Uber: 65,
		};

		const customScale: {[k: string]: number} = {
			Mewtwo: 62,
			Caterpie: 100, Metapod: 100, Weedle: 100, Kakuna: 100, Magikarp: 100,
			Ditto: 100,
		};
		const level = this.adjustLevel || customScale[species.name] || levelScale[species.tier] || 80;

		const evs = {hp: 255, atk: 255, def: 255, spa: 255, spd: 255, spe: 255};
		const ivs = {hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30};

		// Should be able to use Substitute four times from full HP without fainting
		if (moves.has('substitute')) {
			while (evs.hp > 3) {
				const hp = Math.floor(Math.floor(2 * species.baseStats.hp + ivs.hp + Math.floor(evs.hp / 4) + 100) * level / 100 + 10);
				if (hp % 4 !== 0) break;
				evs.hp -= 4;
			}
		}

		return {
			name: species.name,
			species: species.name,
			moves: Array.from(moves),
			ability: 'No Ability',
			evs,
			ivs,
			item: '',
			level,
			shiny: false,
			gender: false,
		};
	}

	randomHCTeam(): PokemonSet[] {
		this.enforceNoDirectCustomBanlistChanges();

		const team = [];

		const movePool = [...this.dex.moves.all()];
		const typesPool = ['Bird', ...this.dex.types.names()];

		const randomN = this.randomNPokemon(this.maxTeamSize);
		const hackmonsCup: {[k: string]: HackmonsCupEntry} = {};

		for (const forme of randomN) {
			// Choose forme
			const species = this.dex.species.get(forme);
			if (!hackmonsCup[species.id]) {
				hackmonsCup[species.id] = {
					types: [this.sample(typesPool), this.sample(typesPool)],
					baseStats: {
						hp: Utils.clampIntRange(this.random(256), 1),
						atk: Utils.clampIntRange(this.random(256), 1),
						def: Utils.clampIntRange(this.random(256), 1),
						spa: Utils.clampIntRange(this.random(256), 1),
						spd: 0,
						spe: Utils.clampIntRange(this.random(256), 1),
					},
				};
				if (this.forceMonotype && !hackmonsCup[species.id].types.includes(this.forceMonotype)) {
					hackmonsCup[species.id].types[1] = this.forceMonotype;
				}
				hackmonsCup[species.id].baseStats.spd = hackmonsCup[species.id].baseStats.spa;
			}
			if (hackmonsCup[species.id].types[0] === hackmonsCup[species.id].types[1]) {
				hackmonsCup[species.id].types.splice(1, 1);
			}

			// Random unique moves
			const moves = [];
			do {
				const move = this.sampleNoReplace(movePool);
				if (move.gen <= this.gen && !move.isNonstandard && !move.name.startsWith('Hidden Power ')) {
					moves.push(move.id);
				}
			} while (moves.length < this.maxMoveCount);

			// Random EVs
			const evs = {
				hp: this.random(256),
				atk: this.random(256),
				def: this.random(256),
				spa: this.random(256),
				spd: 0,
				spe: this.random(256),
			};
			evs['spd'] = evs['spa'];

			// Random DVs
			const ivs: StatsTable = {
				hp: 0,
				atk: this.random(16),
				def: this.random(16),
				spa: this.random(16),
				spd: 0,
				spe: this.random(16),
			};
			ivs["hp"] = (ivs["atk"] % 2) * 16 + (ivs["def"] % 2) * 8 + (ivs["spe"] % 2) * 4 + (ivs["spa"] % 2) * 2;
			for (const iv in ivs) {
				if (iv === 'hp' || iv === 'spd') continue;
				ivs[iv as keyof StatsTable] *= 2;
			}
			ivs['spd'] = ivs['spa'];

			// Level balance
			const mbstmin = 425;
			const baseStats = hackmonsCup[species.id].baseStats;
			const calcStat = (statName: StatID, lvl?: number) => {
				if (lvl) {
					return Math.floor(Math.floor(2 * baseStats[statName] + ivs[statName] + Math.floor(evs[statName] / 4)) * lvl / 100 + 5);
				}
				return Math.floor(2 * baseStats[statName] + ivs[statName] + Math.floor(evs[statName] / 4)) + 5;
			};
			let mbst = 0;
			for (const statName of Object.keys(baseStats)) {
				mbst += calcStat(statName as StatID);
				if (statName === 'hp') mbst += 5;
			}
			let level;
			if (this.adjustLevel) {
				level = this.adjustLevel;
			} else {
				level = Math.floor(100 * mbstmin / mbst);
				while (level < 100) {
					for (const statName of Object.keys(baseStats)) {
						mbst += calcStat(statName as StatID, level);
						if (statName === 'hp') mbst += 5;
					}
					if (mbst >= mbstmin) break;
					level++;
				}
				if (level > 100) level = 100;
			}

			team.push({
				name: species.baseSpecies,
				species: species.name,
				gender: species.gender,
				item: '',
				ability: 'No Ability',
				moves,
				evs,
				ivs,
				nature: '',
				level,
				shiny: false,
				// Hacky but the only way to communicate stats/level generation properly
				hc: hackmonsCup[species.id],
			});
		}

		return team;
	}
}

export default RandomGen1Teams;
