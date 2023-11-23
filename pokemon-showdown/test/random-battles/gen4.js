/**
 * Tests for Gen 4 randomized formats
 */
'use strict';

const assert = require('../assert');
const {testSet, testHiddenPower} = require('./tools');

describe('[Gen 4] Random Battle', () => {
	const options = {format: 'gen4randombattle'};

	it('should not generate Shaymin-Sky without Air Slash', () => {
		testSet('shayminsky', options, set => assert(set.moves.includes('airslash'), `got ${set.moves}`));
	});

	it('should prevent double Hidden Power', () => testHiddenPower('magnezone', options));

	it('should give Yanmega Speed Boost if it has Protect', () => {
		testSet('yanmega', options, set => {
			if (set.ability !== 'Speed Boost') return;
			assert(set.moves.includes('protect'), `got ${set.moves}`);
		});
	});
});
