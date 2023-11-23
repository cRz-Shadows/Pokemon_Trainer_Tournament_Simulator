export const Items: {[k: string]: ModdedItemData} = {
	burndrive: {
		inherit: true,
		onBasePower(basePower, user, target, move) {},
		desc: "Changes Genesect to Genesect-Burn.",
	},
	chilldrive: {
		inherit: true,
		onBasePower(basePower, user, target, move) {},
		desc: "Changes Genesect to Genesect-Chill.",
	},
	dousedrive: {
		inherit: true,
		onBasePower(basePower, user, target, move) {},
		desc: "Changes Genesect to Genesect-Douse.",
	},
	shockdrive: {
		inherit: true,
		onBasePower(basePower, user, target, move) {},
		desc: "Changes Genesect to Genesect-Shock.",
	},
	widelens: {
		inherit: true,
		onSourceModifyAccuracy(accuracy) {
			if (typeof accuracy === 'number') {
				return accuracy * 1.3;
			}
		},
		desc: "The accuracy of attacks by the holder is 1.6x.",
	},
	zoomlens: {
		inherit: true,
		onSourceModifyAccuracy(accuracy, target) {
			if (typeof accuracy === 'number' && !this.queue.willMove(target)) {
				this.debug('Zoom Lens boosting accuracy');
				return accuracy * 1.6;
			}
		},
		desc: "The accuracy of attacks by the holder is 1.6x if it moves after its target.",
	},
	bigroot: {
		inherit: true,
		onAfterMoveSecondarySelf(source, target) {
			if (source.hasType('Grass')) {
				this.heal(source.lastDamage / 8, source);
			}
		},
		onResidualOrder: 5,
		onResidualSubOrder: 2,
		onResidual(pokemon) {
			if (pokemon.hasType('Grass')) {
				this.heal(pokemon.baseMaxhp / 16);
			}
		},
		desc: "Holder gains 1.3x HP from draining/Aqua Ring/Ingrain/Leech Seed/Strength Sap; If the user is a Grass type, the holder heals 1/16 of its max HP every turn, and for every damaging move the holder uses 1/8th of the damage dealt is restored.",
		shortDesc: "Holder gains 1.3x from most healing moves; if the user is a Grass type, Leftovers & Shell Bell effects occur.",
	},
	blacksludge: {
		inherit: true,
		onResidualOrder: 5,
		onResidualSubOrder: 2,
		onResidual(pokemon) {
			if (pokemon.hasType('Poison')) {
				this.heal(pokemon.baseMaxhp / (pokemon.getTypes().length === 1 ? 8 : 16));
			} else {
				this.damage(pokemon.baseMaxhp / 8);
			}
		},
		desc: "Each turn, if holder is a Poison type, restores 1/16 max HP; loses 1/8 if not. Pure Poison types restore 1/8 max HP.",
	},
	focusband: {
		inherit: true,
		onDamage(damage, target, source, effect) {
			const types = target.getTypes();
			if (types.length === 1 && types[0] === 'Fighting' &&
					effect && effect.effectType === 'Move' &&
					target.useItem()) {
				if (damage >= target.hp) {
					this.add("-message", target.name + " held on using its Focus Band!");
					return target.hp - 1;
				} else {
					this.add("-message", target.name + "'s Focus Band broke!");
				}
			}
		},
		desc: "Breaks on first hit, but allows pure Fighting types to survive that hit with 1 HP.",
	},
	wiseglasses: {
		inherit: true,
		onBasePower(basePower, user, target, move) {
			if (move.category === 'Special') {
				const types = user.getTypes();
				if (types.length === 1 && types[0] === 'Psychic') {
					return basePower * 1.2;
				}
				return basePower * 1.1;
			}
		},
		desc: "Holder's special attacks have 1.1x power. Pure Psychic types special attacks have 1.2x power.",
		shortDesc: "Holder's SpA have 1.1x power. Pure Psychic types SpA have 1.2x power.",
	},
	muscleband: {
		inherit: true,
		onBasePower(basePower, user, target, move) {
			if (move.category === 'Physical') {
				const types = user.getTypes();
				if (types.length === 1 && types[0] === 'Fighting') {
					return basePower * 1.2;
				}
				return basePower * 1.1;
			}
		},
		desc: "Holder's physical attacks have 1.1x power. Pure Fighting types physical attacks have 1.2x power.",
		shortDesc: "Holder's Atk have 1.1x power. Pure Fighting types Atk have 1.2x power.",
	},
	stick: {
		inherit: true,
		// The Stick is a stand-in for a number of pokemon-exclusive items
		// introduced with Gen Next
		onModifyCritRatio(critRatio, user) {
			if (user.species.id === 'farfetchd') {
				return critRatio + 2;
			}
		},
		onModifyDef(def, pokemon) {
			if (pokemon.species.name === 'Shuckle') {
				return def * 1.5;
			}
		},
		onModifySpA(spa, pokemon) {
			if (pokemon.species.name === 'Unown') {
				return spa * 2;
			}
		},
		onModifySpD(spd, pokemon) {
			if (pokemon.species.name === 'Unown') {
				return spd * 2;
			}
			if (pokemon.species.name === 'Shuckle') {
				return spd * 1.5;
			}
		},
		onModifySpe(spe, pokemon) {
			if (pokemon.species.name === 'Unown') {
				return spe * 2;
			}
		},
		onFoeBasePower(basePower, attacker, defender, move) {
			const GossamerWingUsers = ["Butterfree", "Masquerain", "Beautifly", "Mothim", "Vivillon"];
			if (GossamerWingUsers.includes(defender.species.name)) {
				if (['Rock', 'Electric', 'Ice'].includes(move.type)) {
					this.add('-message', "The attack was weakened by GoassamerWing!");
					return basePower / 2;
				}
			}
		},
		onDamage(damage, defender, attacker, effect) {
			const GossamerWingUsers = ["Butterfree", "Masquerain", "Beautifly", "Mothim", "Vivillon"];
			if (GossamerWingUsers.includes(defender.species.name)) {
				if (effect && effect.id === 'stealthrock') {
					return damage / 2;
				}
			}
		},
		onAfterMoveSecondarySelf(source, target, move) {
			const GossamerWingUsers = ["Butterfree", "Masquerain", "Beautifly", "Mothim", "Vivillon"];
			if (move.effectType === 'Move' && move.category === 'Status' && GossamerWingUsers.includes(source.species.name)) {
				this.heal(source.baseMaxhp / 16);
			}
		},
		// onResidual(pokemon) {
		// 	if (pokemon.species.name === 'Shuckle') {
		// 		this.heal(this.clampIntRange(pokemon.maxhp / 16, 1));
		// 	}
		// },
		desc: "Raises Farfetch\u2019d's critical hit rate two stages.",
	},
};
