'use strict';

const assert = require('./../../assert');
const common = require('./../../common');

let battle;

describe('Dancer', function () {
	afterEach(function () {
		battle.destroy();
	});

	it('should only copy dance moves used by other Pokemon', function () {
		battle = common.createBattle([[
			{species: 'Oricorio', ability: 'dancer', moves: ['swordsdance']},
		], [
			{species: 'Oricorio', ability: 'dancer', moves: ['howl']},
		]]);
		battle.makeChoices('move swordsdance', 'move howl');
		assert.statStage(battle.p1.active[0], 'atk', 2);
		assert.statStage(battle.p2.active[0], 'atk', 3);
	});

	it('should activate in order of lowest to highest raw speed', function () {
		battle = common.createBattle({gameType: 'doubles'}, [[
			{species: 'Shedinja', level: 98, ability: 'dancer', item: 'focussash', moves: ['sleeptalk']},
			{species: 'Shedinja', level: 99, ability: 'dancer', moves: ['sleeptalk']},
		], [
			{species: 'Shedinja', ability: 'wonderguard', moves: ['fierydance']},
			{species: 'Shedinja', ability: 'dancer', moves: ['sleeptalk']},
		]]);
		const [, fastDancer] = battle.p1.active;
		const [wwDanceSource, foeDancer] = battle.p2.active;
		fastDancer.boostBy({spe: 6});
		battle.makeChoices('move sleeptalk, move sleeptalk', 'move fierydance 1, move sleeptalk');
		assert.fainted(wwDanceSource);
		assert.fainted(foeDancer);
	});

	it('should activate in order of lowest to highest raw speed inside Trick Room', function () {
		battle = common.createBattle({gameType: 'doubles'}, [[
			{species: 'Shedinja', level: 98, ability: 'dancer', item: 'focussash', moves: ['sleeptalk']},
			{species: 'Shedinja', level: 99, ability: 'dancer', moves: ['sleeptalk']},
		], [
			{species: 'Shedinja', ability: 'wonderguard', moves: ['fierydance', 'trickroom']},
			{species: 'Shedinja', ability: 'dancer', moves: ['sleeptalk']},
		]]);
		const [, fastDancer] = battle.p1.active;
		const [wwDanceSource, foeDancer] = battle.p2.active;
		fastDancer.boostBy({spe: 6});
		battle.makeChoices('move sleeptalk, move sleeptalk', 'move trickroom, move sleeptalk');
		battle.makeChoices('move sleeptalk, move sleeptalk', 'move fierydance 1, move sleeptalk');
		assert.fainted(wwDanceSource);
		assert.fainted(foeDancer);
	});

	it('should not copy a move that failed or was blocked by Protect', function () {
		// hardcoded to RNG seed
		battle = common.createBattle({gameType: 'doubles', seed: [1, 2, 3, 4]}, [[
			{species: 'Oricorio', level: 98, ability: 'dancer', item: 'laggingtail', moves: ['dragondance', 'protect', 'teeterdance']},
			{species: 'Oricorio', level: 99, ability: 'dancer', moves: ['featherdance']},
		], [
			{species: 'Oricorio', ability: 'dancer', moves: ['fierydance', 'protect', 'teeterdance']},
			{species: 'Shedinja', ability: 'wonderguard', moves: ['finalgambit']},
		]]);
		const [p1active, p2active] = [battle.p1.active, battle.p2.active];
		battle.resetRNG();
		p1active[0].boostBy({atk: 6, spe: 6});
		p2active[0].boostBy({atk: -6});
		p2active[1].boostBy({spe: 6});
		battle.makeChoices('move dragondance, move featherdance 1', 'move fierydance -2, move finalgambit 1');
		assert.fullHP(p2active[0]);
		assert.statStage(p1active[0], 'atk', 6);
		assert.statStage(p1active[1], 'atk', 0);
		assert.statStage(p2active[0], 'atk', -6);
		assert.statStage(p2active[0], 'spe', 0);
		// Next turn
		battle.makeChoices('move dragondance, move featherdance 1', 'move protect');
		assert.statStage(p1active[0], 'atk', 6);
		assert.statStage(p1active[1], 'atk', 0);
		// Next turn: Teeter Dance should be copied as long as it hits one thing
		battle.makeChoices('move protect, move featherdance 1', 'move teeterdance');
		// Next turn: Teeter Dance should NOT be copied if everything it hits is already confused
		assert.constant(() => p1active[0].volatiles['confusion'], () => battle.makeChoices('move teeterdance, move featherdance 1', 'move fierydance 1'));
	});

	it('should not copy a move that missed', function () {
		battle = common.createBattle({gameType: 'singles', seed: [1, 2, 3, 4]}, [[
			{species: 'Oricorio', ability: 'dancer', item: 'choicescarf', moves: ['revelationdance']},
		], [
			{species: 'Oricorio', ability: 'dancer', item: 'brightpowder', moves: ['dig']},
		]]);
		const [failDanceSource, evadesPokemon] = [battle.p1.active[0], battle.p2.active[0]];
		failDanceSource.boostBy({accuracy: -6});
		evadesPokemon.boostBy({evasion: 6});
		battle.makeChoices('move revelationdance', 'move dig');
		assert.fullHP(failDanceSource);
		battle.makeChoices('move revelationdance', 'move dig');
		assert.fullHP(failDanceSource);
	});

	it('should copy a move that hit, but did 0 damage', function () {
		battle = common.createBattle([[
			{species: 'Oricorio', ability: 'dancer', moves: ['fierydance']},
		], [
			{species: 'Shedinja', ability: 'dancer', item: 'focussash', moves: ['meanlook']},
		]]);
		const dancer = battle.p1.active[0];
		assert.hurts(dancer, () => battle.makeChoices('move fierydance', 'move meanlook'));
	});

	it('should not activate if the holder fainted', function () {
		battle = common.createBattle([[
			{species: 'Oricoriopompom', ability: 'dancer', moves: ['revelationdance']},
		], [
			{species: 'oricorio', ability: 'dancer', level: 1, moves: ['sleeptalk']},
			{species: 'oricorio', ability: 'dancer', level: 1, moves: ['sleeptalk']},
		]]);
		battle.makeChoices();
		assert(!battle.log.includes('|-activate|p2: Oricorio|ability: Dancer'));
	});

	it('should target the user of a Dance move unless it was an ally attacking an opponent', function () {
		battle = common.createBattle({gameType: 'doubles'}, [[
			{species: 'Oricorio', level: 98, ability: 'dancer', item: 'laggingtail', moves: ['sleeptalk', 'protect', 'teeterdance']},
			{species: 'Oricorio', level: 99, ability: 'heatproof', moves: ['fierydance', 'sleeptalk']},
		], [
			{species: 'Oricorio', ability: 'heatproof', moves: ['fierydance', 'sleeptalk']},
			{species: 'Suicune', ability: 'heatproof', moves: ['sleeptalk']},
		]]);

		const opponentTargetingAlly = battle.p2.active[0];
		assert.hurts(opponentTargetingAlly, () => battle.makeChoices('move sleeptalk, move sleeptalk', 'move fierydance 2, move sleeptalk'));

		const opponentTargetingOpponent = battle.p2.active[0];
		assert.hurts(opponentTargetingOpponent, () => battle.makeChoices('move sleeptalk, move sleeptalk', 'move fierydance -2, move sleeptalk'));

		const allyTargetingDancer = battle.p1.active[1];
		assert.hurts(allyTargetingDancer, () => battle.makeChoices('move sleeptalk, move fierydance -1', 'move sleeptalk, move sleeptalk'));

		const allyTargetingOpponent = battle.p1.active[1];
		const allyHP = allyTargetingOpponent.hp;
		const opponentTargetedByAlly = battle.p2.active[1];
		const opponentNotTargetedByAlly = battle.p2.active[0];
		const opponentHP = opponentNotTargetedByAlly.hp;
		assert.hurts(opponentTargetedByAlly, () => battle.makeChoices('move sleeptalk, move fierydance 2', 'move sleeptalk, move sleeptalk'));
		assert.equal(allyTargetingOpponent.hp, allyHP);
		assert.equal(opponentNotTargetedByAlly.hp, opponentHP);
	});

	it('should adopt the target selected by copycat', function () {
		battle = common.createBattle({gameType: 'doubles', seed: [1, 2, 3, 4]}, [[
			{species: 'oricoriopau', ability: 'dancer', moves: ['featherdance']},
			{species: 'flamigo', moves: ['copycat']},
		], [
			{species: 'fletchinder', level: 1, moves: ['sleeptalk']},
			{species: 'squawkabilly', level: 1, moves: ['sleeptalk']},
		]]);
		battle.makeChoices('move featherdance 1, move copycat', 'auto');
		const flamigo = battle.p1.active[1];
		const [fletchinder, squawkabilly] = battle.p2.active;
		assert.equal(flamigo.boosts.atk, 0);
		assert.equal(fletchinder.boosts.atk, -2);
		assert.equal(squawkabilly.boosts.atk, -4);
	});
});
