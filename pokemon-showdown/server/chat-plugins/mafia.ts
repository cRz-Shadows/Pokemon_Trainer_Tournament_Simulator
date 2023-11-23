import {Utils, FS} from '../../lib';

interface MafiaData {
	// keys for all of these are IDs
	alignments: {[k: string]: MafiaDataAlignment};
	roles: {[k: string]: MafiaDataRole};
	themes: {[k: string]: MafiaDataTheme};
	IDEAs: {[k: string]: MafiaDataIDEA};
	terms: {[k: string]: MafiaDataTerm};
	aliases: {[k: string]: ID};
}
interface MafiaDataAlignment {
	name: string;
	plural: string;
	color?: string;
	buttonColor?: string;
	memo: string[];
	image?: string;
}
interface MafiaDataRole {
	name: string;
	memo: string[];
	alignment?: string;
	image?: string;
}
interface MafiaDataTheme {
	name: string;
	desc: string;
	// roles
	[players: number]: string;
}
interface MafiaDataIDEA {
	name: string;
	roles: string[];
	picks: string[];
	choices: number;
}
interface MafiaDataTerm {
	name: string;
	memo: string[];
}

interface MafiaLogTable {
	[date: string]: {[userid: string]: number};
}
type MafiaLogSection = 'leaderboard' | 'mvps' | 'hosts' | 'plays' | 'leavers';
type MafiaLog = {[section in MafiaLogSection]: MafiaLogTable};

interface MafiaRole {
	name: string;
	safeName: string;
	id: string;
	memo: string[];
	alignment: string;
	image: string;
}

interface MafiaVote {
	// number of people on this vote
	count: number;
	// number of votes, accounting for doublevoter etc
	trueCount: number;
	lastVote: number;
	dir: 'up' | 'down';
	voters: ID[];
}

interface MafiaIDEAData {
	name: string;
	// do we trust the roles to parse properly
	untrusted?: true;
	roles: string[];
	// eg, GestI has 3 choices
	choices: number;
	// eg, GestI has 2 things to pick, role and alignment
	picks: string[];
}
interface MafiaIDEAModule {
	data: MafiaIDEAData | null;
	timer: NodeJS.Timer | null;
	discardsHidden: boolean;
	discardsHTML: string;
	// users that haven't picked a role yet
	waitingPick: string[];
}
interface MafiaIDEAPlayerData {
	choices: string[];
	originalChoices: string[];
	picks: {[choice: string]: string | null};
}

const DATA_FILE = 'config/chat-plugins/mafia-data.json';
const LOGS_FILE = 'config/chat-plugins/mafia-logs.json';

// see: https://play.pokemonshowdown.com/fx/
const VALID_IMAGES = [
	'cop', 'dead', 'doctor', 'fool', 'godfather', 'goon', 'hooker', 'mafia', 'mayor', 'villager', 'werewolf',
];

let MafiaData: MafiaData = Object.create(null);
let logs: MafiaLog = {leaderboard: {}, mvps: {}, hosts: {}, plays: {}, leavers: {}};

Punishments.addRoomPunishmentType({
	type: 'MAFIAGAMEBAN',
	desc: 'banned from playing mafia games',
});
Punishments.addRoomPunishmentType({
	type: 'MAFIAHOSTBAN',
	desc: 'banned from hosting mafia games',
});

const hostQueue: ID[] = [];

const IDEA_TIMER = 60 * 1000;

function readFile(path: string) {
	try {
		const json = FS(path).readIfExistsSync();
		if (!json) {
			return false;
		}
		return Object.assign(Object.create(null), JSON.parse(json));
	} catch (e: any) {
		if (e.code !== 'ENOENT') throw e;
	}
}
function writeFile(path: string, data: AnyObject) {
	FS(path).writeUpdate(() => (
		JSON.stringify(data)
	));
}

// data assumptions -
// the alignments "town" and "solo" always exist (defaults)
// <role>.alignment is always a valid key in data.alignments
// roles and alignments have no common keys (looked up together in the role parser)
// themes and IDEAs have no common keys (looked up together when setting themes)

// Load data
MafiaData = readFile(DATA_FILE) || {alignments: {}, roles: {}, themes: {}, IDEAs: {}, terms: {}, aliases: {}};
if (!MafiaData.alignments.town) {
	MafiaData.alignments.town = {
		name: 'town', plural: 'town', memo: [`This alignment is required for the script to function properly.`],
	};
}
if (!MafiaData.alignments.solo) {
	MafiaData.alignments.solo = {
		name: 'solo', plural: 'solo', memo: [`This alignment is required for the script to function properly.`],
	};
}

logs = readFile(LOGS_FILE) || {leaderboard: {}, mvps: {}, hosts: {}, plays: {}, leavers: {}};

const tables: MafiaLogSection[] = ['leaderboard', 'mvps', 'hosts', 'plays', 'leavers'];
for (const section of tables) {
	// Check to see if we need to eliminate an old month's data.
	const month = new Date().toLocaleString("en-us", {month: "numeric", year: "numeric"});
	if (!logs[section]) logs[section] = {};
	if (!logs[section][month]) logs[section][month] = {};
	if (Object.keys(logs[section]).length >= 3) {
		// eliminate the oldest month(s)
		const keys = Utils.sortBy(Object.keys(logs[section]), key => {
			const [monthStr, yearStr] = key.split('/');
			return [parseInt(yearStr), parseInt(monthStr)];
		});
		while (keys.length > 2) {
			const curKey = keys.shift();
			if (!curKey) break; // should never happen
			delete logs[section][curKey];
		}
	}
}
writeFile(LOGS_FILE, logs);

class MafiaPlayer extends Rooms.RoomGamePlayer<Mafia> {
	safeName: string;
	role: MafiaRole | null;
	voting: ID;
	/** false - can't hammer (priest), true - can only hammer (actor) */
	hammerRestriction: null | boolean;
	lastVote: number;
	treestump: boolean;
	restless: boolean;
	silenced: boolean;
	nighttalk: boolean;
	revealed: string;
	IDEA: MafiaIDEAPlayerData | null;
	/** false - used an action, true - idled, null - no response */
	action: null | boolean | string;
	actionArr: string[];
	constructor(user: User, game: Mafia) {
		super(user, game);
		this.safeName = Utils.escapeHTML(this.name);
		this.role = null;
		this.voting = '';
		this.hammerRestriction = null;
		this.lastVote = 0;
		this.treestump = false;
		this.restless = false;
		this.silenced = false;
		this.nighttalk = false;
		this.revealed = '';
		this.IDEA = null;
		this.action = null;
		this.actionArr = [];
	}

	getRole(button = false) {
		if (!this.role) return;
		let color = MafiaData.alignments[this.role.alignment].color;
		if (button && MafiaData.alignments[this.role.alignment].buttonColor) {
			color = MafiaData.alignments[this.role.alignment].buttonColor;
		}
		return `<span style="font-weight:bold;color:${color}">${this.role.safeName}</span>`;
	}

	updateHtmlRoom() {
		const user = Users.get(this.id);
		if (!user?.connected) return;
		if (this.game.ended) return user.send(`>view-mafia-${this.game.room.roomid}\n|deinit`);
		for (const conn of user.connections) {
			void Chat.resolvePage(`view-mafia-${this.game.room.roomid}`, user, conn);
		}
	}
	updateHtmlVotes() {
		const user = Users.get(this.id);
		if (!user?.connected) return;
		const votes = this.game.voteBoxFor(this.id);
		user.send(`>view-mafia-${this.game.room.roomid}\n|selectorhtml|#mafia-votes|` + votes);
	}
}

class Mafia extends Rooms.RoomGame<MafiaPlayer> {
	started: boolean;
	theme: MafiaDataTheme | null;
	hostid: ID;
	host: string;
	cohostids: ID[];
	cohosts: string[];
	dead: {[userid: string]: MafiaPlayer};

	subs: ID[];
	autoSub: boolean;
	requestedSub: ID[];
	hostRequestedSub: ID[];
	played: ID[];

	hammerCount: number;
	votes: {[userid: string]: MafiaVote};
	voteModifiers: {[userid: string]: number};
	hammerModifiers: {[userid: string]: number};
	hasPlurality: ID | null;

	enableNL: boolean;
	voteLock: boolean;
	votingAll: boolean;
	forceVote: boolean;
	closedSetup: boolean;
	noReveal: boolean;
	selfEnabled: boolean | 'hammer';
	takeIdles: boolean;

	originalRoles: MafiaRole[];
	originalRoleString: string;
	roles: MafiaRole[];
	roleString: string;

	phase: 'signups' | 'locked' | 'IDEApicking' | 'IDEAlocked' | 'day' | 'night';
	dayNum: number;

	timer: NodeJS.Timer | null;
	dlAt: number;

	IDEA: MafiaIDEAModule;
	constructor(room: ChatRoom, host: User) {
		super(room);

		this.gameid = 'mafia' as ID;
		this.title = 'Mafia';
		this.playerCap = 20;
		this.allowRenames = false;
		this.started = false;
		this.ended = false;

		this.theme = null;

		this.hostid = host.id;
		this.host = Utils.escapeHTML(host.name);
		this.cohostids = [];
		this.cohosts = [];

		this.dead = Object.create(null);
		this.subs = [];
		this.autoSub = true;
		this.requestedSub = [];
		this.hostRequestedSub = [];
		this.played = [];

		this.hammerCount = 0;
		this.votes = Object.create(null);
		this.voteModifiers = Object.create(null);
		this.hammerModifiers = Object.create(null);
		this.hasPlurality = null;

		this.enableNL = true;
		this.voteLock = false;
		this.votingAll = true;
		this.forceVote = false;
		this.closedSetup = false;
		this.noReveal = true;
		this.selfEnabled = false;
		this.takeIdles = true;

		this.originalRoles = [];
		this.originalRoleString = '';
		this.roles = [];
		this.roleString = '';

		this.phase = "signups";
		this.dayNum = 0;
		this.timer = null;
		this.dlAt = 0;

		this.IDEA = {
			data: null,
			timer: null,
			discardsHidden: false,
			discardsHTML: '',
			waitingPick: [],
		};

		this.sendHTML(this.roomWindow());
	}

	join(user: User) {
		if (this.phase !== 'signups') return user.sendTo(this.room, `|error|The game of ${this.title} has already started.`);
		this.canJoin(user, true);
		if (this.playerCount >= this.playerCap) return user.sendTo(this.room, `|error|The game of ${this.title} is full.`);
		if (!this.addPlayer(user)) return user.sendTo(this.room, `|error|You have already joined the game of ${this.title}.`);
		if (this.subs.includes(user.id)) this.subs.splice(this.subs.indexOf(user.id), 1);
		this.playerTable[user.id].updateHtmlRoom();
		this.sendRoom(`${this.playerTable[user.id].name} has joined the game.`);
	}

	leave(user: User) {
		if (!(user.id in this.playerTable)) {
			return user.sendTo(this.room, `|error|You have not joined the game of ${this.title}.`);
		}
		if (this.phase !== 'signups') return user.sendTo(this.room, `|error|The game of ${this.title} has already started.`);
		this.playerTable[user.id].destroy();
		delete this.playerTable[user.id];
		this.playerCount--;
		let subIndex = this.requestedSub.indexOf(user.id);
		if (subIndex !== -1) this.requestedSub.splice(subIndex, 1);
		subIndex = this.hostRequestedSub.indexOf(user.id);
		if (subIndex !== -1) this.hostRequestedSub.splice(subIndex, 1);
		this.sendRoom(`${user.name} has left the game.`);
		for (const conn of user.connections) {
			void Chat.resolvePage(`view-mafia-${this.room.roomid}`, user, conn);
		}
	}

	static isGameBanned(room: Room, user: User) {
		return Punishments.hasRoomPunishType(room, toID(user), 'MAFIAGAMEBAN');
	}

	static gameBan(room: Room, user: User, reason: string, duration: number) {
		Punishments.roomPunish(room, user, {
			type: 'MAFIAGAMEBAN',
			id: toID(user),
			expireTime: Date.now() + (duration * 24 * 60 * 60 * 1000),
			reason,
		});
	}

	static ungameBan(room: Room, user: User) {
		Punishments.roomUnpunish(room, toID(user), 'MAFIAGAMEBAN', false);
	}

	static isHostBanned(room: Room, user: User) {
		return Mafia.isGameBanned(room, user) || Punishments.hasRoomPunishType(room, toID(user), 'MAFIAGAMEBAN');
	}

	static hostBan(room: Room, user: User, reason: string, duration: number) {
		Punishments.roomPunish(room, user, {
			type: 'MAFIAHOSTBAN',
			id: toID(user),
			expireTime: Date.now() + (duration * 24 * 60 * 60 * 1000),
			reason,
		});
	}

	static unhostBan(room: Room, user: User) {
		Punishments.roomUnpunish(room, toID(user), 'MAFIAHOSTBAN', false);
	}

	makePlayer(user: User) {
		return new MafiaPlayer(user, this);
	}

	setRoles(user: User, roleString: string, force = false, reset = false) {
		let roles = roleString.split(',').map(x => x.trim());

		if (roles.length === 1) {
			// Attempt to set roles from a theme
			let themeName: string = toID(roles[0]);
			if (themeName in MafiaData.aliases) themeName = MafiaData.aliases[themeName];

			if (themeName in MafiaData.themes) {
				// setting a proper theme
				const theme = MafiaData.themes[themeName];
				if (!theme[this.playerCount]) {
					return user.sendTo(
						this.room,
						`|error|The theme "${theme.name}" does not have a role list for ${this.playerCount} players.`
					);
				}
				const themeRoles: string = theme[this.playerCount];
				roles = themeRoles.split(',').map(x => x.trim());
				this.theme = theme;
			} else if (themeName in MafiaData.IDEAs) {
				// setting an IDEA's rolelist as a theme, a la Great Idea
				const IDEA = MafiaData.IDEAs[themeName];
				roles = IDEA.roles;
				this.theme = null;
			} else {
				return user.sendTo(this.room, `|error|${roles[0]} is not a valid theme or IDEA.`);
			}
		} else {
			this.theme = null;
		}

		if (roles.length < this.playerCount) {
			return user.sendTo(this.room, `|error|You have not provided enough roles for the players.`);
		} else if (roles.length > this.playerCount) {
			user.sendTo(
				this.room,
				`|error|You have provided too many roles, ${roles.length - this.playerCount} ${Chat.plural(roles.length - this.playerCount, 'roles', 'role')} will not be assigned.`
			);
		}

		if (force) {
			this.originalRoles = roles.map(r => ({
				name: r,
				safeName: Utils.escapeHTML(r),
				id: toID(r),
				alignment: 'solo',
				image: '',
				memo: [`To learn more about your role, PM the host (${this.host}).`],
			}));
			Utils.sortBy(this.originalRoles, role => role.name);
			this.roles = this.originalRoles.slice();
			this.originalRoleString = this.originalRoles.map(
				r => `<span style="font-weight:bold;color:${MafiaData.alignments[r.alignment].color || '#FFF'}">${r.safeName}</span>`
			).join(', ');
			this.roleString = this.originalRoleString;
			this.sendRoom(`The roles have been ${reset ? 're' : ''}set.`);
			if (reset) this.distributeRoles();
			return;
		}

		const newRoles: MafiaRole[] = [];
		const problems: string[] = [];
		const alignments: string[] = [];
		const cache: {[k: string]: MafiaRole} = Object.create(null);
		for (const roleName of roles) {
			const roleId = roleName.toLowerCase().replace(/[^\w\d\s]/g, '');
			if (roleId in cache) {
				newRoles.push({...cache[roleId]});
			} else {
				const role = Mafia.parseRole(roleName);
				if (role.problems.length) {
					problems.push(...role.problems);
				}
				if (!alignments.includes(role.role.alignment)) alignments.push(role.role.alignment);
				cache[roleId] = role.role;
				newRoles.push(role.role);
			}
		}
		if (alignments.length < 2 && alignments[0] !== 'solo') {
			problems.push(`There must be at least 2 different alignments in a game!`);
		}
		if (problems.length) {
			for (const problem of problems) {
				user.sendTo(this.room, `|error|${problem}`);
			}
			return user.sendTo(this.room, `|error|To forcibly set the roles, use /mafia force${reset ? "re" : ""}setroles`);
		}

		this.IDEA.data = null;

		this.originalRoles = newRoles;
		Utils.sortBy(this.originalRoles, role => [role.alignment, role.name]);
		this.roles = this.originalRoles.slice();
		this.originalRoleString = this.originalRoles.map(
			r => `<span style="font-weight:bold;color:${MafiaData.alignments[r.alignment].color || '#FFF'}">${r.safeName}</span>`
		).join(', ');
		this.roleString = this.originalRoleString;

		if (!reset) this.phase = 'locked';
		this.updatePlayers();
		this.sendRoom(`The roles have been ${reset ? 're' : ''}set.`);
		if (reset) this.distributeRoles();
	}

	resetGame() {
		this.clearVotes();
		this.dayNum = 0;
		this.phase = 'night';
		for (const hostid of [...this.cohostids, this.hostid]) {
			const host = Users.get(hostid);
			if (host?.connected) host.send(`>${this.room.roomid}\n|notify|It's night in your game of Mafia!`);
		}
		for (const player of Object.values(this.playerTable)) {
			const user = Users.get(player.id);
			if (user?.connected) {
				user.sendTo(this.room.roomid, `|notify|It's night in the game of Mafia! Send in an action or idle.`);
			}
		}
		for (const player in this.playerTable) {
			this.playerTable[player].actionArr.splice(0, this.playerTable[player].actionArr.length);
		}
		if (this.timer) this.setDeadline(0);
		this.sendDeclare(`The game has been reset.`);
		this.distributeRoles();
		if (this.takeIdles) {
			this.sendDeclare(`Night ${this.dayNum}. Submit whether you are using an action or idle. If you are using an action, DM your action to the host.`);
		} else {
			this.sendDeclare(`Night ${this.dayNum}. PM the host your action, or idle.`);
		}
		return;
	}
	static parseRole(roleString: string) {
		const roleName = roleString.replace(/solo/, '').trim();

		const role = {
			name: roleName,
			safeName: Utils.escapeHTML(roleName),
			id: toID(roleName),
			image: '',
			memo: ['During the Day, you may vote for someone to be eliminated.'],
			alignment: '',
		};
		const problems: string[] = [];

		// if a role has a modifier with an alignment and a proper alignment,
		// the proper alignment overrides the modifier's alignment
		let modAlignment = '';

		const roleWords = roleString
			.replace(/\(.+?\)/g, '') // remove (notes within brackets)
			.split(' ')
			.map(toID);

		let iters = 0;
		outer: while (roleWords.length) {
			const currentWord = roleWords.slice();

			while (currentWord.length) {
				if (iters++ === 1000) throw new Error(`Infinite loop.`);

				let currentSearch = currentWord.join('');
				if (currentSearch in MafiaData.aliases) currentSearch = MafiaData.aliases[currentSearch];

				if (currentSearch in MafiaData.roles) {
					// we found something with our current search, remove it from the main role and restart
					const mod = MafiaData.roles[currentSearch];

					if (mod.memo) role.memo.push(...mod.memo);
					if (mod.alignment && !modAlignment) modAlignment = mod.alignment;
					if (mod.image && !role.image) role.image = mod.image;

					roleWords.splice(0, currentWord.length);
					continue outer;
				} else if (currentSearch in MafiaData.alignments) {
					if (role.alignment && role.alignment !== currentSearch) {
						problems.push(`The role ${roleString} has multiple possible alignments (${role.alignment} and ${currentSearch})`);
					}
					role.alignment = currentSearch;

					roleWords.splice(0, currentWord.length);
					continue outer;
				}

				// we didnt find something, take the last word off our current search and continue
				currentWord.pop();
			}
			// no matches, take the first word off and continue
			roleWords.shift();
		}

		role.alignment = role.alignment || modAlignment;
		if (!role.alignment) {
			// Default to town
			role.alignment = 'town';
		}
		if (problems.length) {
			// multiple possible alignment, default to solo
			role.alignment = 'solo';
			role.memo.push(`Your role has multiple conflicting alignments, ask the host for details.`);
		} else {
			const alignment = MafiaData.alignments[role.alignment];
			if (alignment) {
				role.memo.push(...MafiaData.alignments[role.alignment].memo);
				if (alignment.image && !role.image) role.image = alignment.image;
			} else {
				problems.push(`Alignment desync: role ${role.name}'s alignment ${role.alignment} doesn't exist in data. Please report this to a mod.`);
			}
		}

		return {role, problems};
	}

	start(user: User, day = false) {
		if (!user) return;
		if (this.phase !== 'locked' && this.phase !== 'IDEAlocked') {
			if (this.phase === 'signups') return user.sendTo(this.room, `You need to close the signups first.`);
			if (this.phase === 'IDEApicking') {
				return user.sendTo(this.room, `You must wait for IDEA picks to finish before starting.`);
			}
			return user.sendTo(this.room, `The game is already started!`);
		}
		if (this.playerCount < 2) return user.sendTo(this.room, `You need at least 2 players to start.`);
		if (this.phase === 'IDEAlocked') {
			for (const p in this.playerTable) {
				if (!this.playerTable[p].role) return user.sendTo(this.room, `|error|Not all players have a role.`);
			}
		} else {
			if (!Object.keys(this.roles).length) return user.sendTo(this.room, `You need to set the roles before starting.`);
			if (Object.keys(this.roles).length < this.playerCount) {
				return user.sendTo(this.room, `You have not provided enough roles for the players.`);
			}
		}
		this.started = true;
		this.sendDeclare(`The game of ${this.title} is starting!`);
		// Mafia#played gets set in distributeRoles
		this.distributeRoles();
		if (day) {
			this.day(null, true);
		} else {
			this.night(false, true);
		}
		if (this.IDEA.data && !this.IDEA.discardsHidden) {
			this.room.add(`|html|<div class="infobox"><details><summary>IDEA discards:</summary>${this.IDEA.discardsHTML}</details></div>`).update();
		}
	}

	distributeRoles() {
		const roles = Utils.shuffle(this.roles.slice());
		if (roles.length) {
			for (const p in this.playerTable) {
				const role = roles.shift()!;
				this.playerTable[p].role = role;
				const u = Users.get(p);
				this.playerTable[p].revealed = '';
				if (u?.connected) {
					u.send(`>${this.room.roomid}\n|notify|Your role is ${role.safeName}. For more details of your role, check your Role PM.`);
				}
			}
		}
		this.dead = {};
		this.played = [this.hostid, ...this.cohostids, ...(Object.keys(this.playerTable) as ID[])];
		this.sendDeclare(`The roles have been distributed.`);
		this.updatePlayers();
	}

	getPartners(alignment: string, player: MafiaPlayer) {
		if (!player?.role || ['town', 'solo', 'traitor'].includes(player.role.alignment)) return "";
		const partners = [];
		for (const p in this.playerTable) {
			if (p === player.id) continue;
			const role = this.playerTable[p].role;
			if (role && role.alignment === player.role.alignment) partners.push(this.playerTable[p].name);
		}
		return partners.join(", ");
	}

	day(extension: number | null = null, initial = false) {
		if (this.phase !== 'night' && !initial) return;
		if (this.dayNum === 0 && extension !== null) return this.sendUser(this.hostid, `|error|You cannot extend on day 0.`);
		if (this.timer) this.setDeadline(0);
		if (extension === null) {
			if (!isNaN(this.hammerCount)) this.hammerCount = Math.floor(Object.keys(this.playerTable).length / 2) + 1;
			this.clearVotes();
		}
		this.phase = 'day';
		if (extension !== null && !initial) {
			// Day stays same
			this.setDeadline(extension);
		} else {
			this.dayNum++;
		}
		if (isNaN(this.hammerCount)) {
			this.sendDeclare(`Day ${this.dayNum}. Hammering is disabled.`);
		} else {
			this.sendDeclare(`Day ${this.dayNum}. The hammer count is set at ${this.hammerCount}`);
		}
		for (const p in this.playerTable) {
			this.playerTable[p].action = null;
		}
		this.sendPlayerList();
		this.updatePlayers();
	}

	night(early = false, initial = false) {
		if (this.phase !== 'day' && !initial) return;
		if (this.timer) this.setDeadline(0, true);
		this.phase = 'night';
		for (const hostid of [...this.cohostids, this.hostid]) {
			const host = Users.get(hostid);
			if (host?.connected) host.send(`>${this.room.roomid}\n|notify|It's night in your game of Mafia!`);
		}
		for (const player of Object.values(this.playerTable)) {
			const user = Users.get(player.id);
			if (user?.connected) {
				user.sendTo(this.room.roomid, `|notify|It's night in the game of Mafia! Send in an action or idle.`);
			}
		}
		if (this.takeIdles) {
			this.sendDeclare(`Night ${this.dayNum}. Submit whether you are using an action or idle. If you are using an action, DM your action to the host.`);
		} else {
			this.sendDeclare(`Night ${this.dayNum}. PM the host your action, or idle.`);
		}
		const hasPlurality = this.getPlurality();
		if (!early && hasPlurality) {
			this.sendRoom(`Plurality is on ${this.playerTable[hasPlurality] ? this.playerTable[hasPlurality].name : 'No Vote'}`);
		}
		if (!early && !initial) this.sendRoom(`|raw|<div class="infobox">${this.voteBox()}</div>`);
		if (initial && !isNaN(this.hammerCount)) this.hammerCount = Math.floor(Object.keys(this.playerTable).length / 2) + 1;
		this.updatePlayers();
	}

	vote(userid: ID, target: ID) {
		if (!this.votingAll) return this.sendUser(userid, `|error|Voting is not allowed.`);
		if (this.phase !== 'day') return this.sendUser(userid, `|error|You can only vote during the day.`);
		let player = this.playerTable[userid];
		if (!player && this.dead[userid] && this.dead[userid].restless) player = this.dead[userid];
		if (!player) return;
		if (!(target in this.playerTable) && target !== 'novote') {
			return this.sendUser(userid, `|error|${target} is not a valid player.`);
		}
		if (!this.enableNL && target === 'novote') return this.sendUser(userid, `|error|No Vote is not allowed.`);
		if (target === player.id && !this.selfEnabled) return this.sendUser(userid, `|error|Self voting is not allowed.`);
		if (this.voteLock && player.voting) {
			return this.sendUser(userid, `|error|You cannot switch your vote because votes are locked.`);
		}
		const hammering = this.hammerCount - 1 <= (this.votes[target] ? this.votes[target].count : 0);
		if (target === player.id && !hammering && this.selfEnabled === 'hammer') {
			return this.sendUser(userid, `|error|You may only vote yourself when placing the hammer vote.`);
		}
		if (player.hammerRestriction !== null) {
			this.sendUser(userid, `${this.hammerCount - 1} <= ${(this.votes[target] ? this.votes[target].count : 0)}`);
			if (player.hammerRestriction && !hammering) {
				return this.sendUser(userid, `|error|You can only vote when placing the hammer vote.`);
			}
			if (!player.hammerRestriction && hammering) return this.sendUser(userid, `|error|You cannot place the hammer vote.`);
		}
		if (player.lastVote + 2000 >= Date.now()) {
			return this.sendUser(
				userid,
				`|error|You must wait another ${Chat.toDurationString((player.lastVote + 2000) - Date.now()) || '1 second'} before you can change your vote.`
			);
		}
		const previousVote = player.voting;
		if (previousVote) this.unvote(userid, true);
		let vote = this.votes[target];
		if (!vote) {
			this.votes[target] = {
				count: 1, trueCount: this.getVoteValue(userid), lastVote: Date.now(), dir: 'up', voters: [userid],
			};
			vote = this.votes[target];
		} else {
			vote.count++;
			vote.trueCount += this.getVoteValue(userid);
			vote.lastVote = Date.now();
			vote.dir = 'up';
			vote.voters.push(userid);
		}
		player.voting = target;
		const name = player.voting === 'novote' ? 'No Vote' : this.playerTable[player.voting].name;
		const targetUser = Users.get(userid);
		if (previousVote) {
			this.sendTimestamp(`${(targetUser ? targetUser.name : userid)} has shifted their vote from ${previousVote === 'novote' ? 'No Vote' : this.playerTable[previousVote].name} to ${name}`);
		} else {
			this.sendTimestamp(
				name === 'No Vote' ?
					`${(targetUser ? targetUser.name : userid)} has abstained from voting.` :
					`${(targetUser ? targetUser.name : userid)} has voted ${name}.`
			);
		}
		player.lastVote = Date.now();
		this.hasPlurality = null;
		if (this.getHammerValue(target) <= vote.trueCount) {
			// HAMMER
			this.sendDeclare(`Hammer! ${target === 'novote' ? 'Nobody' : Utils.escapeHTML(name)} was voted out!`);
			this.sendRoom(`|raw|<div class="infobox">${this.voteBox()}</div>`);
			if (target !== 'novote') this.eliminate(target, 'kill');
			this.night(true);
			return;
		}
		this.updatePlayersVotes();
	}

	unvote(userid: ID, force = false) {
		if (this.phase !== 'day' && !force) return this.sendUser(userid, `|error|You can only vote during the day.`);
		let player = this.playerTable[userid];

		// autoselfvote blocking doesn't apply to restless spirits
		if (player && this.forceVote && !force) {
			return this.sendUser(userid, `|error|You can only shift your vote, not unvote.`);
		}

		if (!player && this.dead[userid] && this.dead[userid].restless) player = this.dead[userid];
		if (!player?.voting) return this.sendUser(userid, `|error|You are not voting for anyone.`);
		if (this.voteLock && player?.voting) {
			return this.sendUser(userid, `|error|You cannot unvote because votes are locked.`);
		}
		if (player.lastVote + 2000 >= Date.now() && !force) {
			return this.sendUser(
				userid,
				`|error|You must wait another ${Chat.toDurationString((player.lastVote + 2000) - Date.now()) || '1 second'} before you can change your vote.`
			);
		}
		const vote = this.votes[player.voting];
		vote.count--;
		vote.trueCount -= this.getVoteValue(userid);
		if (vote.count <= 0) {
			delete this.votes[player.voting];
		} else {
			vote.lastVote = Date.now();
			vote.dir = 'down';
			vote.voters.splice(vote.voters.indexOf(userid), 1);
		}
		const targetUser = Users.get(userid);
		if (!force) {
			this.sendTimestamp(
				player.voting === 'novote' ?
					`${(targetUser ? targetUser.name : userid)} is no longer abstaining from voting.` :
					`${(targetUser ? targetUser.name : userid)} has unvoted ${this.playerTable[player.voting].name}.`
			);
		}
		player.voting = '';
		player.lastVote = Date.now();
		this.hasPlurality = null;
		this.updatePlayersVotes();
	}

	/**
	 * Returns HTML code that contains information about the current vote.
	 */
	voteBox() {
		if (!this.started) return `<strong>The game has not started yet.</strong>`;
		let buf = `<strong>Votes (Hammer: ${this.hammerCount || "Disabled"})</strong><br />`;
		const plur = this.getPlurality();
		const list = Utils.sortBy(Object.entries(this.votes), ([key, vote]) => [
			key === plur,
			-vote.count,
		]);
		for (const [key, vote] of list) {
			buf += `${vote.count}${plur === key ? '*' : ''} ${this.playerTable[key]?.safeName || 'No Vote'} (${vote.voters.map(a => this.playerTable[a]?.safeName || a).join(', ')})<br />`;
		}
		return buf;
	}
	voteBoxFor(userid: ID) {
		let buf = '';
		buf += `<h3>Votes (Hammer: ${this.hammerCount || 'Disabled'}) <button class="button" name="send" value="/msgroom ${this.roomid},/mafia refreshvotes"><i class="fa fa-refresh"></i> Refresh</button></h3>`;
		const plur = this.getPlurality();
		for (const key of Object.keys(this.playerTable).concat((this.enableNL ? ['novote'] : [])) as ID[]) {
			if (this.votes[key]) {
				buf += `<p style="font-weight:bold">${this.votes[key].count}${plur === key ? '*' : ''} ${this.playerTable[key] ? `${this.playerTable[key].safeName} ${this.playerTable[key].revealed ? `[${this.playerTable[key].revealed}]` : ''}` : 'No Vote'} (${this.votes[key].voters.map(a => this.playerTable[a] ? this.playerTable[a].safeName : a).join(', ')}) `;
			} else {
				buf += `<p style="font-weight:bold">0 ${this.playerTable[key] ? `${this.playerTable[key].safeName} ${this.playerTable[key].revealed ? `[${this.playerTable[key].revealed}]` : ''}` : 'No Vote'} `;
			}
			const isPlayer = (this.playerTable[userid]);
			const isSpirit = (this.dead[userid] && this.dead[userid].restless);
			if (this.votingAll && !(this.voteLock && (isPlayer?.voting || (isSpirit && this.dead[userid].voting))) &&
			(isPlayer || isSpirit)) {
				if (isPlayer && this.playerTable[userid].voting === key || isSpirit && this.dead[userid].voting === key) {
					buf += `<button class="button" name="send" value="/msgroom ${this.roomid},/mafia unvote">Unvote ${this.playerTable[key] ? this.playerTable[key].safeName : 'No Vote'}</button>`;
				} else if ((this.selfEnabled && !isSpirit) || userid !== key) {
					buf += `<button class="button" name="send" value="/msgroom ${this.roomid},/mafia vote ${key}">Vote ${this.playerTable[key] ? this.playerTable[key].safeName : 'No Vote'}</button>`;
				}
			} else if (userid === this.hostid || this.cohostids.includes(userid)) {
				const vote = this.votes[key];
				if (vote && vote.count !== vote.trueCount) buf += `(${vote.trueCount})`;
				if (this.hammerModifiers[key]) buf += `(${this.getHammerValue(key)} to hammer)`;
			}
			buf += `</p>`;
		}
		return buf;
	}
	applyVoteModifier(user: User, target: ID, mod: number) {
		const targetPlayer = this.playerTable[target] || this.dead[target];
		if (!targetPlayer) return this.sendUser(user, `|error|${target} is not in the game of mafia.`);
		const oldMod = this.voteModifiers[target];
		if (mod === oldMod || ((isNaN(mod) || mod === 1) && oldMod === undefined)) {
			if (isNaN(mod) || mod === 1) return this.sendUser(user, `|error|${target} already has no vote modifier.`);
			return this.sendUser(user, `|error|${target} already has a vote modifier of ${mod}`);
		}
		const newMod = isNaN(mod) ? 1 : mod;
		if (targetPlayer.voting) {
			this.votes[targetPlayer.voting].trueCount += oldMod - newMod;
			if (this.getHammerValue(targetPlayer.voting) <= this.votes[targetPlayer.voting].trueCount) {
				this.sendRoom(`${targetPlayer.voting} has been voted out due to a modifier change! They have not been eliminated.`);
				this.night(true);
			}
		}
		if (newMod === 1) {
			delete this.voteModifiers[target];
			return this.sendUser(user, `${targetPlayer.name} has had their vote modifier removed.`);
		} else {
			this.voteModifiers[target] = newMod;
			return this.sendUser(user, `${targetPlayer.name} has been given a vote modifier of ${newMod}`);
		}
	}
	applyHammerModifier(user: User, target: ID, mod: number) {
		if (!(target in this.playerTable || target === 'novote')) {
			return this.sendUser(user, `|error|${target} is not in the game of mafia.`);
		}
		const oldMod = this.hammerModifiers[target];
		if (mod === oldMod || ((isNaN(mod) || mod === 0) && oldMod === undefined)) {
			if (isNaN(mod) || mod === 0) return this.sendUser(user, `|error|${target} already has no hammer modifier.`);
			return this.sendUser(user, `|error|${target} already has a hammer modifier of ${mod}`);
		}
		const newMod = isNaN(mod) ? 0 : mod;
		if (this.votes[target]) {
			// do this manually since we havent actually changed the value yet
			if (this.hammerCount + newMod <= this.votes[target].trueCount) {
				// make sure these strings are the same
				this.sendRoom(`${target} has been voted due to a modifier change! They have not been eliminated.`);
				this.night(true);
			}
		}
		if (newMod === 0) {
			delete this.hammerModifiers[target];
			return this.sendUser(user, `${target} has had their hammer modifier removed.`);
		} else {
			this.hammerModifiers[target] = newMod;
			return this.sendUser(user, `${target} has been given a hammer modifier of ${newMod}`);
		}
	}
	clearVoteModifiers(user: User) {
		for (const player of [...Object.keys(this.playerTable), ...Object.keys(this.dead)] as ID[]) {
			if (this.voteModifiers[player]) this.applyVoteModifier(user, player, 1);
		}
	}
	clearHammerModifiers(user: User) {
		for (const player of ['novote', ...Object.keys(this.playerTable)] as ID[]) {
			if (this.hammerModifiers[player]) this.applyHammerModifier(user, player, 0);
		}
	}

	getVoteValue(userid: ID) {
		const mod = this.voteModifiers[userid];
		return (mod === undefined ? 1 : mod);
	}
	getHammerValue(userid: ID) {
		const mod = this.hammerModifiers[userid];
		return (mod === undefined ? this.hammerCount : this.hammerCount + mod);
	}
	resetHammer() {
		this.setHammer(Math.floor(Object.keys(this.playerTable).length / 2) + 1);
	}

	setHammer(count: number) {
		this.hammerCount = count;
		if (isNaN(count)) {
			this.sendDeclare(`Hammering has been disabled, and votes have been reset.`);
		} else {
			this.sendDeclare(`The hammer count has been set at ${this.hammerCount}, and votes have been reset.`);
		}
		this.clearVotes();
	}

	shiftHammer(count: number) {
		this.hammerCount = count;
		if (isNaN(count)) {
			this.sendDeclare(`Hammering has been disabled. Votes have not been reset.`);
		} else {
			this.sendDeclare(`The hammer count has been shifted to ${this.hammerCount}. Votes have not been reset.`);
		}
		const hammered = [];
		for (const vote in this.votes) {
			if (this.votes[vote].trueCount >= this.getHammerValue(vote as ID)) {
				hammered.push(vote === 'novote' ? 'Nobody' : vote);
			}
		}
		if (hammered.length) {
			this.sendDeclare(`${Chat.count(hammered, "players have")} been hammered: ${hammered.join(', ')}. They have not been removed from the game.`);
			this.night(true);
		}
	}

	getPlurality() {
		if (this.hasPlurality) return this.hasPlurality;
		if (!Object.keys(this.votes).length) return null;
		let max = 0;
		let topVotes: [ID, MafiaVote][] = [];
		for (const [key, vote] of Object.entries(this.votes)) {
			if (vote.count > max) {
				max = vote.count;
				topVotes = [[key as ID, vote]];
			} else if (vote.count === max) {
				topVotes.push([key as ID, vote]);
			}
		}
		if (topVotes.length <= 1) {
			[this.hasPlurality] = topVotes[0];
			return this.hasPlurality;
		}
		topVotes = Utils.sortBy(topVotes, ([key, vote]) => [
			vote.dir === 'down',
			vote.dir === 'up' ? vote.lastVote : -vote.lastVote,
		]);
		[this.hasPlurality] = topVotes[0];
		return this.hasPlurality;
	}

	eliminate(toEliminate: string, ability: string) {
		if (!(toEliminate in this.playerTable || toEliminate in this.dead)) return;
		if (!this.started) {
			// Game has not started, simply kick the player
			const player = this.playerTable[toEliminate];
			this.sendDeclare(`${player.safeName} was kicked from the game!`);
			if (this.hostRequestedSub.includes(player.id)) {
				this.hostRequestedSub.splice(this.hostRequestedSub.indexOf(player.id), 1);
			}
			if (this.requestedSub.includes(player.id)) {
				this.requestedSub.splice(this.requestedSub.indexOf(player.id), 1);
			}
			delete this.playerTable[player.id];
			this.playerCount--;
			player.updateHtmlRoom();
			player.destroy();
			return;
		}
		if (toEliminate in this.playerTable) {
			this.dead[toEliminate] = this.playerTable[toEliminate];
		} else {
			this.playerCount++; // so that the playercount decrement later isn't unnecessary
		}

		const player = this.dead[toEliminate];
		let msg = `${player.safeName}`;
		switch (ability) {
		case 'treestump':
			this.dead[player.id].treestump = true;
			this.dead[player.id].restless = false;
			msg += ` has been treestumped`;
			break;
		case 'spirit':
			this.dead[player.id].treestump = false;
			this.dead[player.id].restless = true;
			msg += ` became a restless spirit`;
			break;
		case 'spiritstump':
			this.dead[player.id].treestump = true;
			this.dead[player.id].restless = true;
			msg += ` became a restless treestump`;
			break;
		case 'kick':
			this.dead[player.id].treestump = false;
			this.dead[player.id].restless = false;
			msg += ` was kicked from the game`;
			break;
		default:
			this.dead[player.id].treestump = false;
			this.dead[player.id].restless = false;
			msg += ` was eliminated`;
		}
		if (player.voting) this.unvote(player.id, true);
		this.sendDeclare(`${msg}! ${!this.noReveal && toID(ability) === 'kill' ? `${player.safeName}'s role was ${player.getRole()}.` : ''}`);
		if (player.role && !this.noReveal && toID(ability) === 'kill') player.revealed = player.getRole()!;
		const targetRole = player.role;
		if (targetRole) {
			for (const [roleIndex, role] of this.roles.entries()) {
				if (role.id === targetRole.id) {
					this.roles.splice(roleIndex, 1);
					break;
				}
			}
		}
		this.clearVotes(player.id);
		delete this.playerTable[player.id];
		let subIndex = this.requestedSub.indexOf(player.id);
		if (subIndex !== -1) this.requestedSub.splice(subIndex, 1);
		subIndex = this.hostRequestedSub.indexOf(player.id);
		if (subIndex !== -1) this.hostRequestedSub.splice(subIndex, 1);

		this.playerCount--;
		this.updateRoleString();
		this.updatePlayers();
		player.updateHtmlRoom();
	}

	revealRole(user: User, toReveal: MafiaPlayer, revealAs: string) {
		if (!this.started) {
		    return user.sendTo(this.room, `|error|You may only reveal roles once the game has started.`);
		}
		if (!toReveal.role) {
		    return user.sendTo(this.room, `|error|The user ${toReveal.id} is not assigned a role.`);
		}
		toReveal.revealed = revealAs;
		this.sendDeclare(`${toReveal.safeName}'s role ${toReveal.id in this.playerTable ? `is` : `was`} ${revealAs}.`);
		this.updatePlayers();
	}

	revive(user: User, toRevive: string, force = false) {
		if (this.phase === 'IDEApicking') {
			return user.sendTo(this.room, `|error|You cannot add or remove players while IDEA roles are being picked.`);
		}
		if (toRevive in this.playerTable) {
			user.sendTo(this.room, `|error|The user ${toRevive} is already a living player.`);
			return;
		}
		if (toRevive in this.dead) {
			const deadPlayer = this.dead[toRevive];
			if (deadPlayer.treestump) deadPlayer.treestump = false;
			if (deadPlayer.restless) deadPlayer.restless = false;
			this.sendDeclare(`${deadPlayer.safeName} was revived!`);
			this.playerTable[deadPlayer.id] = deadPlayer;
			const targetRole = deadPlayer.role;
			if (targetRole) {
				this.roles.push(targetRole);
			} else {
				// Should never happen
				deadPlayer.role = {
					name: `Unknown`,
					safeName: `Unknown`,
					id: `unknown`,
					alignment: 'solo',
					image: '',
					memo: [
						`You were revived, but had no role. Please let a Mafia Room Owner know this happened. To learn about your role, PM the host (${this.host}).`,
					],
				};
				this.roles.push(deadPlayer.role);
			}
			Utils.sortBy(this.roles, r => [r.alignment, r.name]);
			delete this.dead[deadPlayer.id];
		} else {
			const targetUser = Users.get(toRevive);
			if (!targetUser) return;
			this.canJoin(targetUser, false, force);
			const player = this.makePlayer(targetUser);
			if (this.started) {
				player.role = {
					name: `Unknown`,
					safeName: `Unknown`,
					id: `unknown`,
					alignment: 'solo',
					image: '',
					memo: [`You were added to the game after it had started. To learn about your role, PM the host (${this.host}).`],
				};
				this.roles.push(player.role);
				this.played.push(targetUser.id);
			} else {
				this.originalRoles = [];
				this.originalRoleString = '';
				this.roles = [];
				this.roleString = '';
			}
			if (this.subs.includes(targetUser.id)) this.subs.splice(this.subs.indexOf(targetUser.id), 1);
			this.playerTable[targetUser.id] = player;
			this.sendDeclare(Utils.html`${targetUser.name} has been added to the game by ${user.name}!`);
		}
		this.playerCount++;
		this.updateRoleString();
		this.updatePlayers();
		return true;
	}

	setDeadline(minutes: number, silent = false) {
		if (isNaN(minutes)) return;
		if (!minutes) {
			if (!this.timer) return;
			clearTimeout(this.timer);
			this.timer = null;
			this.dlAt = 0;
			if (!silent) this.sendTimestamp(`**The deadline has been cleared.**`);
			return;
		}
		if (minutes < 1 || minutes > 20) return;
		if (this.timer) clearTimeout(this.timer);
		this.dlAt = Date.now() + (minutes * 60000);
		if (minutes > 3) {
			this.timer = setTimeout(() => {
				this.sendTimestamp(`**3 minutes left!**`);
				this.timer = setTimeout(() => {
					this.sendTimestamp(`**1 minute left!**`);
					this.timer = setTimeout(() => {
						this.sendTimestamp(`**Time is up!**`);
						this.night();
					}, 60000);
				}, 2 * 60000);
			}, (minutes - 3) * 60000);
		} else if (minutes > 1) {
			this.timer = setTimeout(() => {
				this.sendTimestamp(`**1 minute left!**`);
				this.timer = setTimeout(() => {
					this.sendTimestamp(`**Time is up!**`);
					if (this.phase === 'day') this.night();
				}, 60000);
			}, (minutes - 1) * 60000);
		} else {
			this.timer = setTimeout(() => {
				this.sendTimestamp(`**Time is up!**`);
				if (this.phase === 'day') this.night();
			}, minutes * 60000);
		}
		this.sendTimestamp(`**The deadline has been set for ${minutes} minute${minutes === 1 ? '' : 's'}.**`);
	}

	sub(player: string, replacement: string) {
		const oldPlayer = this.playerTable[player];
		if (!oldPlayer) return; // should never happen

		const newUser = Users.get(replacement);
		if (!newUser) return; // should never happen
		const newPlayer = this.makePlayer(newUser);
		newPlayer.role = oldPlayer.role;
		newPlayer.IDEA = oldPlayer.IDEA;
		if (oldPlayer.voting) {
			// Dont change plurality
			const vote = this.votes[oldPlayer.voting];
			vote.voters.splice(vote.voters.indexOf(oldPlayer.id), 1);
			vote.voters.push(newPlayer.id);
			newPlayer.voting = oldPlayer.voting;
			oldPlayer.voting = '';
		}
		this.playerTable[newPlayer.id] = newPlayer;
		// Transfer votes on the old player to the new one
		if (this.votes[oldPlayer.id]) {
			this.votes[newPlayer.id] = this.votes[oldPlayer.id];
			delete this.votes[oldPlayer.id];
			for (const p in this.playerTable) {
				if (this.playerTable[p].voting === oldPlayer.id) this.playerTable[p].voting = newPlayer.id;
			}
			for (const p in this.dead) {
				if (this.dead[p].restless && this.dead[p].voting === oldPlayer.id) this.dead[p].voting = newPlayer.id;
			}
		}
		if (this.hasPlurality === oldPlayer.id) this.hasPlurality = newPlayer.id;
		for (let i = 1; i < this.dayNum; i++) {
			newPlayer.actionArr[i] = oldPlayer.actionArr[i];
		}
		if (newUser?.connected) {
			for (const conn of newUser.connections) {
				void Chat.resolvePage(`view-mafia-${this.room.roomid}`, newUser, conn);
			}
			newUser.send(`>${this.room.roomid}\n|notify|You have been substituted in the mafia game for ${oldPlayer.safeName}.`);
		}
		if (this.started) this.played.push(newPlayer.id);
		this.sendDeclare(`${oldPlayer.safeName} has been subbed out. ${newPlayer.safeName} has joined the game.`);
		delete this.playerTable[oldPlayer.id];
		oldPlayer.destroy();
		this.updatePlayers();

		if (this.room.roomid === 'mafia' && this.started) {
			const month = new Date().toLocaleString("en-us", {month: "numeric", year: "numeric"});
			if (!logs.leavers[month]) logs.leavers[month] = {};
			if (!logs.leavers[month][player]) logs.leavers[month][player] = 0;
			logs.leavers[month][player]++;
			writeFile(LOGS_FILE, logs);
		}
	}

	nextSub(userid: ID | null = null) {
		if (!this.subs.length ||
			(!this.hostRequestedSub.length && ((!this.requestedSub.length || !this.autoSub)) && !userid)) {
			return;
		}
		const nextSub = this.subs.shift();
		if (!nextSub) return;
		const sub = Users.get(nextSub, true);
		if (!sub?.connected || !sub.named || !this.room.users[sub.id]) return; // should never happen, just to be safe
		const toSubOut = userid || this.hostRequestedSub.shift() || this.requestedSub.shift();
		if (!toSubOut) {
			// Should never happen
			this.subs.unshift(nextSub);
			return;
		}
		if (this.hostRequestedSub.includes(toSubOut)) {
			this.hostRequestedSub.splice(this.hostRequestedSub.indexOf(toSubOut), 1);
		}
		if (this.requestedSub.includes(toSubOut)) {
			this.requestedSub.splice(this.requestedSub.indexOf(toSubOut), 1);
		}
		this.sub(toSubOut, sub.id);
	}

	customIdeaInit(user: User, choices: number, picks: string[], rolesString: string) {
		this.originalRoles = [];
		this.originalRoleString = '';
		this.roles = [];
		this.roleString = '';

		const roles = Utils.stripHTML(rolesString);
		let roleList = roles.split('\n');
		if (roleList.length === 1) {
			roleList = roles.split(',').map(r => r.trim());
		}

		this.IDEA.data = {
			name: `${this.host}'s custom IDEA`, // already escaped
			untrusted: true,
			roles: roleList,
			picks,
			choices,
		};
		return this.ideaDistributeRoles(user);
	}
	ideaInit(user: User, moduleID: ID) {
		this.originalRoles = [];
		this.originalRoleString = '';
		this.roles = [];
		this.roleString = '';

		if (moduleID in MafiaData.aliases) moduleID = MafiaData.aliases[moduleID];
		this.IDEA.data = MafiaData.IDEAs[moduleID];
		if (!this.IDEA.data) return user.sendTo(this.room, `|error|${moduleID} is not a valid IDEA.`);
		return this.ideaDistributeRoles(user);
	}

	ideaDistributeRoles(user: User) {
		if (!this.IDEA.data) return user.sendTo(this.room, `|error|No IDEA module loaded`);
		if (this.phase !== 'locked' && this.phase !== 'IDEAlocked') {
			return user.sendTo(this.room, `|error|The game must be in a locked state to distribute IDEA roles.`);
		}

		const neededRoles = this.IDEA.data.choices * this.playerCount;
		if (neededRoles > this.IDEA.data.roles.length) {
			return user.sendTo(this.room, `|error|Not enough roles in the IDEA module.`);
		}

		const roles = [];
		const selectedIndexes: number[] = [];
		for (let i = 0; i < neededRoles; i++) {
			let randomIndex;
			do {
				randomIndex = Math.floor(Math.random() * this.IDEA.data.roles.length);
			} while (selectedIndexes.includes(randomIndex));
			roles.push(this.IDEA.data.roles[randomIndex]);
			selectedIndexes.push(randomIndex);
		}
		Utils.shuffle(roles);
		this.IDEA.waitingPick = [];
		for (const p in this.playerTable) {
			const player = this.playerTable[p];
			player.role = null;
			player.IDEA = {
				choices: roles.splice(0, this.IDEA.data.choices),
				originalChoices: [], // MAKE SURE TO SET THIS
				picks: {},
			};
			player.IDEA.originalChoices = player.IDEA.choices.slice();
			for (const pick of this.IDEA.data.picks) {
				player.IDEA.picks[pick] = null;
				this.IDEA.waitingPick.push(p);
			}
			const u = Users.get(p);
			if (u?.connected) u.send(`>${this.room.roomid}\n|notify|Pick your role in the IDEA module.`);
		}

		this.phase = 'IDEApicking';
		this.updatePlayers();

		this.sendDeclare(`${this.IDEA.data.name} roles have been distributed. You will have ${IDEA_TIMER / 1000} seconds to make your picks.`);
		this.IDEA.timer = setTimeout(() => { this.ideaFinalizePicks(); }, IDEA_TIMER);

		return ``;
	}

	ideaPick(user: User, selection: string[]) {
		let buf = '';
		if (this.phase !== 'IDEApicking') return 'The game is not in the IDEA picking phase.';
		if (!this.IDEA?.data) {
			return this.sendRoom(`Trying to pick an IDEA role with no module running, target: ${JSON.stringify(selection)}. Please report this to a mod.`);
		}
		const player = this.playerTable[user.id];
		if (!player.IDEA) {
			return this.sendRoom(`Trying to pick an IDEA role with no player IDEA object, user: ${user.id}. Please report this to a mod.`);
		}
		selection = selection.map(toID);
		if (selection.length === 1 && this.IDEA.data.picks.length === 1) selection = [this.IDEA.data.picks[0], selection[0]];
		if (selection.length !== 2) return user.sendTo(this.room, `|error|Invalid selection.`);

		// input is formatted as ['selection', 'role']
		// eg: ['role', 'bloodhound']
		// ['alignment', 'alien']
		// ['selection', ''] deselects
		if (selection[1]) {
			const roleIndex = player.IDEA.choices.map(toID).indexOf(selection[1] as ID);
			if (roleIndex === -1) {
				return user.sendTo(this.room, `|error|${selection[1]} is not an available role, perhaps it is already selected?`);
			}
			selection[1] = player.IDEA.choices.splice(roleIndex, 1)[0];
		} else {
			selection[1] = '';
		}
		const selected = player.IDEA.picks[selection[0]];
		if (selected) {
			buf += `You have deselected ${selected}. `;
			player.IDEA.choices.push(selected);
		}

		if (player.IDEA.picks[selection[0]] && !selection[1]) {
			this.IDEA.waitingPick.push(player.id);
		} else if (!player.IDEA.picks[selection[0]] && selection[1]) {
			this.IDEA.waitingPick.splice(this.IDEA.waitingPick.indexOf(player.id), 1);
		}

		player.IDEA.picks[selection[0]] = selection[1];
		if (selection[1]) buf += `You have selected ${selection[0]}: ${selection[1]}.`;
		player.updateHtmlRoom();
		if (!this.IDEA.waitingPick.length) {
			if (this.IDEA.timer) clearTimeout(this.IDEA.timer);
			this.ideaFinalizePicks();
			return;
		}
		return user.sendTo(this.room, buf);
	}

	ideaFinalizePicks() {
		if (!this.IDEA?.data) {
			return this.sendRoom(`Tried to finalize IDEA picks with no IDEA module running, please report this to a mod.`);
		}
		const randed = [];
		for (const p in this.playerTable) {
			const player = this.playerTable[p];
			if (!player.IDEA) {
				return this.sendRoom(`Trying to pick an IDEA role with no player IDEA object, user: ${player.id}. Please report this to a mod.`);
			}
			let randPicked = false;
			const role = [];
			for (const choice of this.IDEA.data.picks) {
				if (!player.IDEA.picks[choice]) {
					randPicked = true;
					const randomChoice = player.IDEA.choices.shift();
					if (randomChoice) {
						player.IDEA.picks[choice] = randomChoice;
					} else {
						throw new Error(`No roles left to randomly assign from IDEA module choices.`);
					}
					this.sendUser(player.id, `You were randomly assigned ${choice}: ${randomChoice}`);
				}
				role.push(`${choice}: ${player.IDEA.picks[choice]}`);
			}
			if (randPicked) randed.push(p);
			// if there's only one option, it's their role, parse it properly
			let roleName = '';
			if (this.IDEA.data.picks.length === 1) {
				const pick = player.IDEA.picks[this.IDEA.data.picks[0]];
				if (!pick) throw new Error('Pick not found when parsing role selected in IDEA module.');
				const parsedRole = Mafia.parseRole(pick);
				if (parsedRole.problems.length) {
					this.sendRoom(`Problems found when parsing IDEA role ${player.IDEA.picks[this.IDEA.data.picks[0]]}. Please report this to a mod.`);
				}
				player.role = parsedRole.role;
			} else {
				roleName = role.join('; ');
				player.role = {
					name: roleName,
					safeName: Utils.escapeHTML(roleName),
					id: toID(roleName),
					alignment: 'solo',
					memo: [`(Your role was set from an IDEA.)`],
					image: '',
				};
				// hardcoding this because it makes GestI so much nicer
				if (!this.IDEA.data.untrusted) {
					for (const pick of role) {
						if (pick.substr(0, 10) === 'alignment:') {
							const parsedRole = Mafia.parseRole(pick.substr(9));
							if (parsedRole.problems.length) {
								this.sendRoom(`Problems found when parsing IDEA role ${pick}. Please report this to a mod.`);
							}
							player.role.alignment = parsedRole.role.alignment;
						}
					}
				}
			}
		}
		this.IDEA.discardsHTML = `<b>Discards:</b><br />`;
		for (const p of Object.keys(this.playerTable).sort()) {
			const IDEA = this.playerTable[p].IDEA;
			if (!IDEA) return this.sendRoom(`No IDEA data for player ${p} when finalising IDEAs. Please report this to a mod.`);
			this.IDEA.discardsHTML += `<b>${this.playerTable[p].safeName}:</b> ${IDEA.choices.join(', ')}<br />`;
		}

		this.phase = 'IDEAlocked';
		if (randed.length) {
			this.sendDeclare(`${randed.join(', ')} did not pick a role in time and were randomly assigned one.`);
		}
		this.sendDeclare(`IDEA picks are locked!`);
		this.sendRoom(`To start, use /mafia start, or to reroll use /mafia ideareroll`);
		this.updatePlayers();
	}

	sendPlayerList() {
		this.room.add(`|c:|${(Math.floor(Date.now() / 1000))}|~|**Players (${this.playerCount})**: ${Object.values(this.playerTable).map(p => p.name).sort().join(', ')}`).update();
	}

	updatePlayers() {
		for (const p in this.playerTable) {
			this.playerTable[p].updateHtmlRoom();
		}
		for (const p in this.dead) {
			if (this.dead[p].restless || this.dead[p].treestump) this.dead[p].updateHtmlRoom();
		}
		// Now do the host
		this.updateHost();
	}

	updatePlayersVotes() {
		for (const p in this.playerTable) {
			this.playerTable[p].updateHtmlVotes();
		}
		for (const p in this.dead) {
			if (this.dead[p].restless || this.dead[p].treestump) this.dead[p].updateHtmlVotes();
		}
	}

	updateHost(...hosts: ID[]) {
		if (!hosts.length) hosts = [...this.cohostids, this.hostid];

		for (const hostid of hosts) {
			const host = Users.get(hostid);
			if (!host?.connected) return;
			for (const conn of host.connections) {
				void Chat.resolvePage(`view-mafia-${this.room.roomid}`, host, conn);
			}
		}
	}

	updateRoleString() {
		this.roleString = this.roles.map(
			r => `<span style="font-weight:bold;color:${MafiaData.alignments[r.alignment].color || '#FFF'}">${r.safeName}</span>`
		).join(', ');
	}

	sendRoom(message: string) {
		this.room.add(message).update();
	}
	sendHTML(message: string) {
		this.room.add(`|uhtml|mafia|${message}`).update();
	}
	sendDeclare(message: string) {
		this.room.add(`|raw|<div class="broadcast-blue">${message}</div>`).update();
	}
	sendStrong(message: string) {
		this.room.add(`|raw|<strong>${message}</strong>`).update();
	}
	sendTimestamp(message: string) {
		this.room.add(`|c:|${(Math.floor(Date.now() / 1000))}|~|${message}`).update();
	}
	logAction(user: User, message: string) {
		if (user.id === this.hostid || this.cohostids.includes(user.id)) return;
		this.room.sendModsByUser(user, `(${user.name}: ${message})`);
	}
	secretLogAction(user: User, message: string) {
		if (user.id === this.hostid || this.cohostids.includes(user.id)) return;
		this.room.roomlog(`(${user.name}: ${message})`);
	}
	roomWindow() {
		if (this.ended) return `<div class="infobox">The game of ${this.title} has ended.</div>`;
		let output = `<div class="broadcast-blue">`;
		if (this.phase === 'signups') {
			output += `<h1 style="text-align: center">A game of ${this.title} was created</h2><p style="text-align: center"><button class="button" name="send" value="/mafia join">Join the game</button> <button class="button" name="send" value="/join view-mafia-${this.room.roomid}">Spectate the game</button> <button class="button" name="send" value="/help mafia">Mafia Commands</button></p>`;
		} else {
			output += `<p style="font-weight: bold">A game of ${this.title} is in progress.</p><p><button class="button" name="send" value="/msgroom ${this.room.roomid},/mafia sub in">Become a substitute</button> <button class="button" name="send" value="/join view-mafia-${this.room.roomid}">Spectate the game</button> <button class="button" name="send" value="/help mafia">Mafia Commands</button></p>`;
		}
		output += `</div>`;
		return output;
	}

	canJoin(user: User, self = false, force = false) {
		if (!user?.connected) return `User not found.`;
		const targetString = self ? `You are` : `${user.id} is`;
		if (!this.room.users[user.id]) return `${targetString} not in the room.`;
		for (const id of [user.id, ...user.previousIDs]) {
			if (this.playerTable[id] || this.dead[id]) throw new Chat.ErrorMessage(`${targetString} already in the game.`);
			if (!force && this.played.includes(id)) {
				throw new Chat.ErrorMessage(`${self ? `You were` : `${user.id} was`} already in the game.`);
			}
			if (Mafia.isGameBanned(this.room, user)) {
				throw new Chat.ErrorMessage(`${self ? `You are` : `${user.id} is`} banned from joining mafia games.`);
			}
			if (this.hostid === id) throw new Chat.ErrorMessage(`${targetString} the host.`);
			if (this.cohostids.includes(id)) throw new Chat.ErrorMessage(`${targetString} a cohost.`);
		}
		if (!force) {
			for (const alt of user.getAltUsers(true)) {
				if (this.playerTable[alt.id] || this.played.includes(alt.id)) {
					throw new Chat.ErrorMessage(`${self ? `You already have` : `${user.id} already has`} an alt in the game.`);
				}
				if (this.hostid === alt.id || this.cohostids.includes(alt.id)) {
					throw new Chat.ErrorMessage(`${self ? `You have` : `${user.id} has`} an alt as a game host.`);
				}
			}
		}
	}

	sendUser(user: User | string | null, message: string) {
		const userObject = (typeof user === 'string' ? Users.get(user) : user);
		if (!userObject?.connected) return;
		userObject.sendTo(this.room, message);
	}

	setSelfVote(user: User, setting: boolean | 'hammer') {
		const from = this.selfEnabled;
		if (from === setting) {
			return user.sendTo(
				this.room,
				`|error|Selfvoting is already ${setting ? `set to Self${setting === 'hammer' ? 'hammering' : 'voting'}` : 'disabled'}.`
			);
		}
		if (from) {
			this.sendDeclare(`Self${from === 'hammer' ? 'hammering' : 'voting'} has been ${setting ? `changed to Self${setting === 'hammer' ? 'hammering' : 'voting'}` : 'disabled'}.`);
		} else {
			this.sendDeclare(`Self${setting === 'hammer' ? 'hammering' : 'voting'} has been ${setting ? 'enabled' : 'disabled'}.`);
		}
		this.selfEnabled = setting;
		if (!setting) {
			for (const player of Object.values(this.playerTable)) {
				if (player.voting === player.id) this.unvote(player.id, true);
			}
		}
		this.updatePlayers();
	}
	setNoVote(user: User, setting: boolean) {
		if (this.enableNL === setting) {
			return user.sendTo(this.room, `|error|No Vote is already ${setting ? 'enabled' : 'disabled'}.`);
		}
		this.enableNL = setting;
		this.sendDeclare(`No Vote has been ${setting ? 'enabled' : 'disabled'}.`);
		if (!setting) this.clearVotes('novote');
		this.updatePlayers();
	}
	setVotelock(user: User, setting: boolean) {
		if (!this.started) return user.sendTo(this.room, `The game has not started yet.`);
		if ((this.voteLock) === setting) {
			return user.sendTo(this.room, `|error|Votes are already ${setting ? 'set to lock' : 'set to not lock'}.`);
		}
		this.voteLock = setting;
		this.clearVotes();
		this.sendDeclare(`Votes are cleared and ${setting ? 'set to lock' : 'set to not lock'}.`);
		this.updatePlayers();
	}
	setVoting(user: User, setting: boolean) {
		if (!this.started) return user.sendTo(this.room, `The game has not started yet.`);
		if (this.votingAll === setting) {
			return user.sendTo(this.room, `|error|Voting is already ${setting ? 'allowed' : 'disallowed'}.`);
		}
		this.votingAll = setting;
		this.clearVotes();
		this.sendDeclare(`Voting is now ${setting ? 'allowed' : 'disallowed'}.`);
		this.updatePlayers();
	}
	clearVotes(target = '') {
		if (target) delete this.votes[target];

		if (!target) this.votes = Object.create(null);

		for (const player of Object.values(this.playerTable)) {
			if (this.forceVote) {
				if (!target || (player.voting === target)) {
					player.voting = player.id;
					this.votes[player.id] = {
						count: 1, trueCount: this.getVoteValue(player.id), lastVote: Date.now(), dir: 'up', voters: [player.id],
					};
				}
			} else {
				if (!target || (player.voting === target)) player.voting = '';
			}
		}
		for (const player of Object.values(this.dead)) {
			if (player.restless && (!target || player.voting === target)) player.voting = '';
		}
		this.hasPlurality = null;
	}

	onChatMessage(message: string, user: User) {
		const subIndex = this.hostRequestedSub.indexOf(user.id);
		if (subIndex !== -1) {
			this.hostRequestedSub.splice(subIndex, 1);
			for (const hostid of [...this.cohostids, this.hostid]) {
				this.sendUser(hostid, `${user.id} has spoken and been removed from the host sublist.`);
			}
		}

		// Hosts can always talk
		if (this.hostid === user.id || this.cohostids.includes(user.id) || !this.started) {
			return;
		}

		let dead = false;
		let player = this.playerTable[user.id];
		if (!player) {
			player = this.dead[user.id];
			dead = !!player;
		}

		const staff = user.can('mute', null, this.room);

		if (!player) {
			if (staff) {
				// Uninvolved staff can talk anytime
				return;
			} else {
				return `You cannot talk while a game of ${this.title} is going on.`;
			}
		}

		if (player.silenced) {
			return `You are silenced and cannot speak.${staff ? " You can remove this with /mafia unsilence." : ''}`;
		}

		if (dead) {
			if (!player.treestump) {
				return `You are dead.${staff ? " You can treestump yourself with /mafia treestump." : ''}`;
			}
		}

		if (this.phase === 'night') {
			if (!player.nighttalk) {
				return `You cannot talk at night.${staff ? " You can bypass this using /mafia nighttalk." : ''}`;
			}
		}
	}

	onConnect(user: User) {
		user.sendTo(this.room, `|uhtml|mafia|${this.roomWindow()}`);
	}

	onJoin(user: User) {
		if (user.id in this.playerTable) {
			return this.playerTable[user.id].updateHtmlRoom();
		}
		if (user.id === this.hostid || this.cohostids.includes(user.id)) return this.updateHost(user.id);
	}

	removeBannedUser(user: User) {
		// Player was banned, attempt to sub now
		// If we can't sub now, make subbing them out the top priority
		if (!(user.id in this.playerTable)) return;
		this.requestedSub.unshift(user.id);
		this.nextSub();
	}

	forfeit(user: User) {
		// Add the player to the sub list.
		if (!(user.id in this.playerTable)) return;
		this.requestedSub.push(user.id);
		this.nextSub();
	}

	end() {
		this.ended = true;
		this.sendHTML(this.roomWindow());
		this.updatePlayers();
		if (this.room.roomid === 'mafia' && this.started) {
			// Intead of using this.played, which shows players who have subbed out as well
			// We check who played through to the end when recording playlogs
			const played = Object.keys(this.playerTable).concat(Object.keys(this.dead));
			const month = new Date().toLocaleString("en-us", {month: "numeric", year: "numeric"});
			if (!logs.plays[month]) logs.plays[month] = {};
			for (const player of played) {
				if (!logs.plays[month][player]) logs.plays[month][player] = 0;
				logs.plays[month][player]++;
			}
			if (!logs.hosts[month]) logs.hosts[month] = {};
			for (const hostid of [...this.cohostids, this.hostid]) {
				if (!logs.hosts[month][hostid]) logs.hosts[month][hostid] = 0;
				logs.hosts[month][hostid]++;
			}
			writeFile(LOGS_FILE, logs);
		}
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.destroy();
	}

	destroy() {
		// Slightly modified to handle dead players
		if (this.timer) clearTimeout(this.timer);
		if (this.IDEA.timer) clearTimeout(this.IDEA.timer);
		this.room.game = null;
		// @ts-ignore readonly
		this.room = null;
		for (const i in this.playerTable) {
			this.playerTable[i].destroy();
		}
		for (const i in this.dead) {
			this.dead[i].destroy();
		}
	}
}

export const pages: Chat.PageTable = {
	mafia(query, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		if (!query.length) return this.close();
		let roomid = query.shift();
		if (roomid === 'groupchat') roomid += `-${query.shift()}-${query.shift()}`;
		const room = Rooms.get(roomid);
		const game = room?.getGame(Mafia);
		if (!room?.users[user.id] || !game || game.ended) {
			return this.close();
		}
		const isPlayer = user.id in game.playerTable;
		const isHost = user.id === game.hostid || game.cohostids.includes(user.id);
		this.title = game.title;
		let buf = `<div class="pad broadcast-blue">`;
		buf += `<button class="button" name="send" value="/join view-mafia-${room.roomid}" style="float:left"><i class="fa fa-refresh"></i> Refresh</button>`;
		buf += `<br/><br/><h1 style="text-align:center;">${game.title}</h1><h3>Host: ${game.host}</h3>${game.cohostids[0] ? `<h3>Cohosts: ${game.cohosts.sort().join(', ')}</h3>` : ''}`;
		buf += `<p style="font-weight:bold;">Players (${game.playerCount}): ${Object.values(game.playerTable).map(p => p.safeName).sort().join(', ')}</p>`;
		if (game.started && Object.keys(game.dead).length > 0) {
			buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Dead Players</summary>`;
			for (const d in game.dead) {
				const dead = game.dead[d];
				buf += `<p style="font-weight:bold;">${dead.safeName} ${dead.revealed ? '(' + dead.revealed + ')' : ''}`;
				if (dead.treestump) buf += ` (is a Treestump)`;
				if (dead.restless) buf += ` (is a Restless Spirit)`;
				if (isHost && !dead.revealed) {
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia revealrole ${dead.id}";">Reveal</button>`;
				}
				buf += `</p>`;
			}
			buf += `</details></p>`;
		}
		buf += `<hr/>`;
		if (isPlayer && game.phase === 'IDEApicking') {
			buf += `<p><b>IDEA information:</b><br />`;
			const IDEA = game.playerTable[user.id].IDEA;
			if (!IDEA) {
				return game.sendRoom(`IDEA picking phase but no IDEA object for user: ${user.id}. Please report this to a mod.`);
			}
			for (const key in IDEA.picks) {
				const pick = IDEA.picks[key];
				buf += `<b>${key}:</b> `;
				if (!pick) {
					buf += `<button class="button disabled" style="font-weight:bold; color:#575757; font-weight:bold; background-color:#d3d3d3;">clear</button>`;
				} else {
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia ideapick ${key},">clear</button>`;
				}
				const selectedIndex = pick ? IDEA.originalChoices.indexOf(pick) : -1;
				for (let i = 0; i < IDEA.originalChoices.length; i++) {
					const choice = IDEA.originalChoices[i];
					if (i === selectedIndex) {
						buf += `<button class="button disabled" style="font-weight:bold; color:#575757; font-weight:bold; background-color:#d3d3d3;">${choice}</button>`;
					} else {
						buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia ideapick ${key}, ${toID(choice)}">${choice}</button>`;
					}
				}
				buf += `<br />`;
			}
			buf += `</p>`;
			buf += `<p><details><summary class="button" style="display:inline-block"><b>Role details:</b></summary><p>`;
			for (const role of IDEA.originalChoices) {
				const roleObject = Mafia.parseRole(role);
				buf += `<details><summary>${role}</summary>`;
				buf += `<table><tr><td style="text-align:center;"><td style="text-align:left;width:100%"><ul>${roleObject.role.memo.map(m => `<li>${m}</li>`).join('')}</ul></td></tr></table>`;
				buf += `</details>`;
			}
			buf += `</p></details></p>`;
		}
		if (game.IDEA.data) {
			buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">${game.IDEA.data.name} information</summary>`;
			if (game.IDEA.discardsHTML && (!game.IDEA.discardsHidden || isHost)) {
				buf += `<details><summary class="button" style="text-align:left; display:inline-block">Discards:</summary><p>${game.IDEA.discardsHTML}</p></details>`;
			}
			buf += `<details><summary class="button" style="text-align:left; display:inline-block">Role list</summary><p>${game.IDEA.data.roles.join('<br />')}</p></details>`;
			buf += `</details></p>`;
		} else {
			if (!game.closedSetup || isHost) {
				if (game.theme) {
					buf += `<p><span style="font-weight:bold;">Theme</span>: ${game.theme.name}</p>`;
					buf += `<p>${game.theme.desc}</p>`;
				}
				if (game.noReveal) {
					buf += `<p><span style="font-weight:bold;">Original Rolelist${game.closedSetup ? ' (CS)' : ''}</span>: ${game.originalRoleString}</p>`;
				} else {
					buf += `<p><span style="font-weight:bold;">Rolelist${game.closedSetup ? ' (CS)' : ''}</span>: ${game.roleString}</p>`;
				}
			}
		}
		if (isPlayer) {
			const role = game.playerTable[user.id].role;
			let previousActionsPL = `<br/>`;
			if (role) {
				buf += `<h3>${game.playerTable[user.id].safeName}, you are a ${game.playerTable[user.id].getRole()}</h3>`;
				if (!['town', 'solo'].includes(role.alignment)) {
					buf += `<p><span style="font-weight:bold">Partners</span>: ${game.getPartners(role.alignment, game.playerTable[user.id])}</p>`;
				}
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Role Details</summary>`;
				buf += `<table><tr><td style="text-align:center;"><img width="75" height="75" src="//${Config.routes.client}/fx/mafia-${role.image || 'villager'}.png"></td><td style="text-align:left;width:100%"><ul>${role.memo.map(m => `<li>${m}</li>`).join('')}</ul></td></tr></table>`;
				buf += `</details></p>`;
				if (game.dayNum > 1) {
					for (let i = 1; i < game.dayNum; i++) {
						previousActionsPL += `<b>Night ${i}</b><br/>`;
						previousActionsPL += `${game.playerTable[user.id].actionArr?.[i] ? `${game.playerTable[user.id].actionArr[i]}` : ''}<br/>`;
					}
					buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Previous Actions</summary>${previousActionsPL}</span></details></p>`;
				}
			}
		}
		if (game.phase === "day") {
			buf += `<span id="mafia-votes">`;
			buf += game.voteBoxFor(user.id);
			buf += `</span>`;
		} else if (game.phase === "night" && isPlayer) {
			if (!game.takeIdles) {
				buf += `<p style="font-weight:bold;">PM the host (${game.host}) the action you want to use tonight, and who you want to use it on. Or PM the host "idle".</p>`;
			} else {
				buf += `<b>Night Actions:</b>`;
				if (game.playerTable[user.id].action === null) {
					buf += `<button class="button disabled" style="font-weight:bold; color:#575757; font-weight:bold; background-color:#d3d3d3;">Clear</button>`;
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia idle">Idle</button>`;
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia action">Action</button><br/>`;
				} else {
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia noresponse">Clear</button>`;
					if (game.playerTable[user.id].action) {
						buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia idle">Idle</button>`;
						buf += `<button class="button disabled" style="font-weight:bold; color:#575757; font-weight:bold; background-color:#d3d3d3;">Action</button>`;
						if (game.playerTable[user.id].action === true) {
							buf += `<form data-submitsend="/msgroom ${game.room.roomid},/mafia action {submission}"><label><b>Submission:</b> <input name="submission" class="textbox" placeholder="Action Details" /></label> <button class="button">Confirm</button></form>`;
						} else {
							buf += `<form data-submitsend="/msgroom ${game.room.roomid},/mafia action"><label><b>Submission:</b> ${game.playerTable[user.id].action} <button class="button">Clear Submission</button></label></form>`;
						}
					} else {
						buf += `<button class="button disabled" style="font-weight:bold; color:#575757; font-weight:bold; background-color:#d3d3d3;">Idle</button>`;
						buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia action">Action</button><br/>`;
					}
				}
			}
		}
		if (isHost) {
			if (game.phase === "night" && isHost && game.takeIdles) {
				buf += `<h3>Night Responses</h3>`;
				let actions = `<br/>`;
				let idles = `<br/>`;
				let noResponses = `<br/>`;
				for (const p in game.playerTable) {
					const player = game.playerTable[p];
					if (player.action) {
						actions += `<b>${player.safeName}</b>${player.action === true ? '' : `: ${player.action}`}<br/>`;
					} else if (player.action === false) {
						idles += `<b>${player.safeName}</b><br/>`;
					} else {
						noResponses += `<b>${player.safeName}</b><br/>`;
					}
				}
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Idles</summary>${idles}</span></details></p>`;
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Actions</summary>${actions}</span></details></p>`;
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">No Response</summary>${noResponses}</span></details></p>`;
			}
			let previousActions = `<br/>`;
			if (game.dayNum > 1) {
				for (let i = 1; i < game.dayNum; i++) {
					previousActions += `<b>Night ${i}</b><br/>`;
					for (const p in game.playerTable) {
						const player = game.playerTable[p];
						previousActions += `<b>${player.safeName}</b>:${player.actionArr[i] ? `${player.actionArr[i]}` : ''}<br/>`;
					}
					previousActions += `<br/>`;
				}
			}
			buf += `<h3>Host options</h3>`;
			buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">General Options</summary>`;
			buf += `<h3>General Options</h3>`;
			if (!game.started) {
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia closedsetup ${game.closedSetup ? 'off' : 'on'}">${game.closedSetup ? 'Disable' : 'Enable'} Closed Setup</button>`;
				if (game.phase === 'locked' || game.phase === 'IDEAlocked') {
					buf += ` <button class="button" name="send" value="/msgroom ${room.roomid},/mafia start">Start Game</button>`;
				} else {
					buf += ` <button class="button" name="send" value="/msgroom ${room.roomid},/mafia close">Close Signups</button>`;
				}
			} else if (game.phase === 'day') {
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia night">Go to Night ${game.dayNum}</button>`;
			} else if (game.phase === 'night') {
				if (game.dayNum !== 0) {
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia day">Go to Day ${game.dayNum + 1}</button> <button class="button" name="send" value="/msgroom ${room.roomid},/mafia extend">Return to Day ${game.dayNum}</button>`;
				} else {
					buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia day">Go to Day ${game.dayNum + 1}</button>`;
				}
			}
			buf += ` <button class="button" name="send" value="/msgroom ${room.roomid},/mafia selfvote ${game.selfEnabled === true ? 'off' : 'on'}">${game.selfEnabled === true ? 'Disable' : 'Enable'} self voting</button> `;
			buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia ${game.enableNL ? 'disable' : 'enable'}nl">${game.enableNL ? 'Disable' : 'Enable'} No Vote</button> `;
			buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia reveal ${game.noReveal ? 'on' : 'off'}">${game.noReveal ? 'Enable' : 'Disable'} revealing of roles</button> `;
			buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia autosub ${game.autoSub ? 'off' : 'on'}">${game.autoSub ? "Disable" : "Enable"} automatic subbing of players</button> `;
			buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia end">End Game</button>`;
			buf += `<p>To set a deadline, use <strong>/mafia deadline [minutes]</strong>.<br />To clear the deadline use <strong>/mafia deadline off</strong>.</p><hr/></details></p>`;
			buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Player Options</summary>`;
			buf += `<h3>Player Options</h3>`;
			for (const p in game.playerTable) {
				const player = game.playerTable[p];
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block"><span style="font-weight:bold;">`;
				buf += `${player.safeName} (${player.role ? player.getRole(true) : ''})`;
				buf += game.voteModifiers[p] !== undefined ? `(votes worth ${game.getVoteValue(p as ID)})` : '';
				buf += player.hammerRestriction !== null ? `(${player.hammerRestriction ? 'actor' : 'priest'})` : '';
				buf += player.silenced ? '(silenced)' : '';
				buf += player.nighttalk ? '(insomniac)' : '';
				buf += `</summary>`;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia kill ${player.id}">Kill</button> `;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia treestump ${player.id}">Make a Treestump (Kill)</button> `;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia spirit ${player.id}">Make a Restless Spirit (Kill)</button> `;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia spiritstump ${player.id}">Make a Restless Treestump (Kill)</button> `;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia sub next, ${player.id}">Force sub</button></span></details></p>`;
			}
			for (const d in game.dead) {
				const dead = game.dead[d];
				buf += `<p style="font-weight:bold;">${dead.safeName} (${dead.role ? dead.getRole() : ''})`;
				if (dead.treestump) buf += ` (is a Treestump)`;
				if (dead.restless) buf += ` (is a Restless Spirit)`;
				if (game.voteModifiers[d] !== undefined) buf += ` (votes worth ${game.getVoteValue(d as ID)})`;
				buf += dead.hammerRestriction !== null ? `(${dead.hammerRestriction ? 'actor' : 'priest'})` : '';
				buf += dead.silenced ? '(silenced)' : '';
				buf += dead.nighttalk ? '(insomniac)' : '';
				buf += `: <button class="button" name="send" value="/msgroom ${room.roomid},/mafia revive ${dead.id}">Revive</button></p>`;
			}
			buf += `<hr/></details></p>`;
			if (game.dayNum > 1) {
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">Previous Night Actions</summary>${previousActions}</span></details></p>`;
			}
			buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">How to setup roles</summary>`;
			buf += `<h3>Setting the roles</h3>`;
			buf += `<p>To set the roles, use /mafia setroles [comma seperated list of roles] OR /mafia setroles [theme] in ${room.title}.</p>`;
			buf += `<p>If you set the roles from a theme, the role parser will get all the correct roles for you. (Not all themes are supported).</p>`;
			buf += `<p>The following key words determine a role's alignment (If none are found, the default alignment is town):</p>`;
			buf += `<p style="font-weight:bold">${Object.values(MafiaData.alignments).map(a => `<span style="color:${a.color || '#FFF'}">${a.name}</span>`).join(', ')}</p>`;
			buf += `<p>Please note that anything inside (parentheses) is ignored by the role parser.</p>`;
			buf += `<p>If you have roles that have conflicting alignments or base roles, you can use /mafia forcesetroles [comma seperated list of roles] to forcibly set the roles.</p>`;
			buf += `<p>Please note that you will have to PM all the players their alignment, partners (if any), and other information about their role because the server will not provide it.</p>`;
			buf += `<hr/></details></p>`;
			buf += `<p style="font-weight:bold;">Players who will be subbed unless they talk: ${game.hostRequestedSub.join(', ')}</p>`;
			buf += `<p style="font-weight:bold;">Players who are requesting a sub: ${game.requestedSub.join(', ')}</p>`;
		}
		buf += `<p style="font-weight:bold;">Sub List: ${game.subs.join(', ')}</p>`;
		if (!isHost) {
			if (game.phase === 'signups') {
				if (isPlayer) {
					buf += `<p><button class="button" name="send" value="/msgroom ${room.roomid},/mafia leave">Leave game</button></p>`;
				} else {
					buf += `<p><button class="button" name="send" value="/msgroom ${room.roomid},/mafia join">Join game</button></p>`;
				}
			} else if ((!isPlayer && game.subs.includes(user.id)) || (isPlayer && !game.requestedSub.includes(user.id))) {
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">${isPlayer ? 'Request to be subbed out' : 'Cancel sub request'}</summary>`;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia sub out">${isPlayer ? 'Confirm request to be subbed out' : 'Confirm cancelation of sub request'}</button></details></p>`;
			} else {
				buf += `<p><details><summary class="button" style="text-align:left; display:inline-block">${isPlayer ? 'Cancel sub request' : 'Join the game as a sub'}</summary>`;
				buf += `<button class="button" name="send" value="/msgroom ${room.roomid},/mafia sub in">${isPlayer ? 'Confirm cancelation of sub request' : 'Confirm that you want to join the game'}</button></details></p>`;
			}
		}
		buf += `</div>`;
		return buf;
	},
	mafialadder(query, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		const mafiaRoom = Rooms.get('mafia');
		if (!query.length || !mafiaRoom) return this.close();
		const headers: {[k: string]: {title: string, type: string, section: MafiaLogSection}} = {
			leaderboard: {title: 'Leaderboard', type: 'Points', section: 'leaderboard'},
			mvpladder: {title: 'MVP Ladder', type: 'MVPs', section: 'mvps'},
			hostlogs: {title: 'Host Logs', type: 'Hosts', section: 'hosts'},
			playlogs: {title: 'Play Logs', type: 'Plays', section: 'plays'},
			leaverlogs: {title: 'Leaver Logs', type: 'Leavers', section: 'leavers'},
		};
		const date = new Date();
		if (query[1] === 'prev') date.setMonth(date.getMonth() - 1);
		const month = date.toLocaleString("en-us", {month: "numeric", year: "numeric"});
		const ladder = headers[query[0]];
		if (!ladder) return this.close();
		if (['hosts', 'plays', 'leavers'].includes(ladder.section)) this.checkCan('mute', null, mafiaRoom);
		this.title = `Mafia ${ladder.title} (${date.toLocaleString("en-us", {month: 'long'})} ${date.getFullYear()})`;
		let buf = `<div class="pad ladder">`;
		buf += `${query[1] === 'prev' ? '' : `<button class="button" name="send" value="/join view-mafialadder-${query[0]}" style="float:left"><i class="fa fa-refresh"></i> Refresh</button> <button class="button" name="send" value="/join view-mafialadder-${query[0]}-prev" style="float:left">View last month's ${ladder.title}</button>`}`;
		buf += `<br /><br />`;
		const section = ladder.section;
		if (!logs[section][month] || !Object.keys(logs[section][month]).length) {
			buf += `${ladder.title} for ${date.toLocaleString("en-us", {month: 'long'})} ${date.getFullYear()} not found.</div>`;
			return buf;
		}
		const entries = Utils.sortBy(Object.entries(logs[section][month]), ([key, value]) => (
			-value
		));
		buf += `<table style="margin-left: auto; margin-right: auto"><tbody><tr><th colspan="2"><h2 style="margin: 5px auto">Mafia ${ladder.title} for ${date.toLocaleString("en-us", {month: 'long'})} ${date.getFullYear()}</h1></th></tr>`;
		buf += `<tr><th>User</th><th>${ladder.type}</th></tr>`;
		for (const [key, value] of entries) {
			buf += `<tr><td>${key}</td><td>${value}</td></tr>`;
		}
		return buf + `</table></div>`;
	},
};

export const commands: Chat.ChatCommands = {
	mafia: {
		''(target, room, user) {
			room = this.requireRoom();
			const game = room.getGame(Mafia);
			if (game) {
				if (!this.runBroadcast()) return;
				return this.sendReply(`|html|${game.roomWindow()}`);
			}
			return this.parse('/help mafia');
		},

		forcehost: 'host',
		nexthost: 'host',
		host(target, room, user, connection, cmd) {
			room = this.requireRoom();
			if (room.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			this.checkChat();
			if (room.type !== 'chat') return this.errorReply(`This command is only meant to be used in chat rooms.`);
			if (room.game) return this.errorReply(`There is already a game of ${room.game.title} in progress in this room.`);

			const nextHost = room.roomid === 'mafia' && cmd === 'nexthost';
			if (nextHost || !room.auth.has(user.id)) this.checkCan('show', null, room);

			let targetUser!: User | null;
			let targetUsername!: string;
			if (nextHost) {
				if (!hostQueue.length) return this.errorReply(`Nobody is on the host queue.`);
				const skipped = [];
				let hostid;
				while ((hostid = hostQueue.shift())) {
					({targetUser, targetUsername} = this.splitUser(hostid, {exactName: true}));
					if (!targetUser?.connected ||
						!room.users[targetUser.id] || Mafia.isHostBanned(room, targetUser)) {
						skipped.push(hostid);
						targetUser = null;
					} else {
						// found a host
						break;
					}
				}
				if (skipped.length) {
					this.sendReply(`${skipped.join(', ')} ${Chat.plural(skipped.length, 'were', 'was')} not online, not in the room, or are host banned and were removed from the host queue.`);
				}
				if (!targetUser) return this.errorReply(`Nobody on the host queue could be hosted.`);
			} else {
				({targetUser, targetUsername} = this.splitUser(target, {exactName: true}));
				if (room.roomid === 'mafia' && hostQueue.length && toID(targetUsername) !== hostQueue[0]) {
					if (!cmd.includes('force')) {
						return this.errorReply(`${targetUsername} isn't the next host on the queue. Use /mafia forcehost if you're sure.`);
					}
				}
			}

			if (!targetUser?.connected) {
				return this.errorReply(`The user "${targetUsername}" was not found.`);
			}

			if (!nextHost && targetUser.id !== user.id) this.checkCan('mute', null, room);

			if (!room.users[targetUser.id]) {
				return this.errorReply(`${targetUsername} is not in this room, and cannot be hosted.`);
			}
			if (Mafia.isHostBanned(room, targetUser)) {
				return this.errorReply(`${targetUsername} is banned from hosting mafia games.`);
			}

			room.game = new Mafia(room, targetUser);

			for (const conn of targetUser.connections) {
				void Chat.resolvePage(`view-mafia-${room.roomid}`, targetUser, conn);
			}
			room.addByUser(user, `${targetUser.name} was appointed the mafia host by ${user.name}.`);
			if (room.roomid === 'mafia') {
				const queueIndex = hostQueue.indexOf(targetUser.id);
				if (queueIndex > -1) hostQueue.splice(queueIndex, 1);
				room.add(`|c:|${(Math.floor(Date.now() / 1000))}|~|**Mafiasignup!**`).update();
			}
			this.modlog('MAFIAHOST', targetUser, null, {noalts: true, noip: true});
		},
		hosthelp: [
			`/mafia host [user] - Create a game of Mafia with [user] as the host. Requires whitelist + % @ # &, drivers+ can host other people.`,
		],

		q: 'queue',
		queue(target, room, user) {
			room = this.requireRoom('mafia' as RoomID);
			if (room.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			const [command, targetUserID] = target.split(',').map(toID);

			switch (command) {
			case 'forceadd':
			case 'add':
				this.checkChat();
				// any rank can selfqueue
				if (targetUserID === user.id) {
					if (!room.auth.has(user.id)) this.checkCan('show', null, room);
				} else {
					this.checkCan('mute', null, room);
				}
				if (!targetUserID) return this.parse(`/help mafia queue`);
				const targetUser = Users.get(targetUserID);
				if ((!targetUser?.connected) && !command.includes('force')) {
					return this.errorReply(`User ${targetUserID} not found. To forcefully add the user to the queue, use /mafia queue forceadd, ${targetUserID}`);
				}
				if (hostQueue.includes(targetUserID)) return this.errorReply(`User ${targetUserID} is already on the host queue.`);
				if (targetUser && Mafia.isHostBanned(room, targetUser)) {
					 return this.errorReply(`User ${targetUserID} is banned from hosting mafia games.`);
				}
				hostQueue.push(targetUserID);
				room.add(`User ${targetUserID} has been added to the host queue by ${user.name}.`).update();
				break;
			case 'del':
			case 'delete':
			case 'remove':
				// anyone can self remove
				if (targetUserID !== user.id) this.checkCan('mute', null, room);
				const index = hostQueue.indexOf(targetUserID);
				if (index === -1) return this.errorReply(`User ${targetUserID} is not on the host queue.`);
				hostQueue.splice(index, 1);
				room.add(`User ${targetUserID} has been removed from the host queue by ${user.name}.`).update();
				break;
			case '':
			case 'show':
			case 'view':
				if (!this.runBroadcast()) return;
				this.sendReplyBox(`<strong>Host Queue:</strong> ${hostQueue.join(', ')}`);
				break;
			default:
				this.parse('/help mafia queue');
			}
		},
		queuehelp: [
			`/mafia queue - Shows the upcoming users who are going to host.`,
			`/mafia queue add, (user) - Adds the user to the hosting queue. Requires whitelist + % @ # &`,
			`/mafia queue remove, (user) - Removes the user from the hosting queue. Requires whitelist + % @ # &`,
		],

		qadd: 'queueadd',
		qforceadd: 'queueadd',
		queueforceadd: 'queueadd',
		queueadd(target, room, user, connection, cmd) {
			this.parse(`/mafia queue ${cmd.includes('force') ? `forceadd` : `add`}, ${target}`);
		},

		qdel: 'queueremove',
		qdelete: 'queueremove',
		qremove: 'queueremove',
		queueremove(target, room, user) {
			this.parse(`/mafia queue remove, ${target}`);
		},

		join(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkChat(null, room);
			game.join(user);
		},
		joinhelp: [`/mafia join - Join the game.`],

		leave(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			game.leave(user);
		},
		leavehelp: [`/mafia leave - Leave the game. Can only be done while signups are open.`],

		playercap(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (game.phase !== 'signups') return this.errorReply(`Signups are already closed.`);
			if (toID(target) === 'none') target = '20';
			const num = parseInt(target);
			if (isNaN(num) || num > 20 || num < 2) return this.parse('/help mafia playercap');
			if (num < game.playerCount) {
				return this.errorReply(`Player cap has to be equal or more than the amount of players in game.`);
			}
			if (num === game.playerCap) return this.errorReply(`Player cap is already set at ${game.playerCap}.`);
			game.playerCap = num;
			game.sendDeclare(`Player cap has been set to ${game.playerCap}`);
			game.logAction(user, `set playercap to ${num}`);
		},
		playercaphelp: [
			`/mafia playercap [cap|none]- Limit the number of players being able to join the game. Player cap cannot be more than 20 or less than 2. Requires host % @ # &`,
		],

		close(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (game.phase !== 'signups') return this.errorReply(`Signups are already closed.`);
			if (game.playerCount < 2) return this.errorReply(`You need at least 2 players to start.`);
			game.phase = 'locked';
			game.sendHTML(game.roomWindow());
			game.updatePlayers();
			game.logAction(user, `closed signups`);
		},
		closehelp: [`/mafia close - Closes signups for the current game. Requires host % @ # &`],

		cs: 'closedsetup',
		closedsetup(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (!['on', 'off'].includes(action)) return this.parse('/help mafia closedsetup');
			if (game.started) {
				return this.errorReply(`You can't ${action === 'on' ? 'enable' : 'disable'} closed setup because the game has already started.`);
			}
			if ((action === 'on' && game.closedSetup) || (action === 'off' && !game.closedSetup)) {
				return this.errorReply(`Closed setup is already ${game.closedSetup ? 'enabled' : 'disabled'}.`);
			}
			game.closedSetup = action === 'on';
			game.sendDeclare(`The game is ${action === 'on' ? 'now' : 'no longer'} a closed setup.`);
			game.updateHost();
			game.logAction(user, `${game.closedSetup ? 'enabled' : 'disabled'} closed setup`);
		},
		closedsetuphelp: [
			`/mafia closedsetup [on|off] - Sets if the game is a closed setup. Closed setups don't show the role list to players. Requires host % @ # &`,
		],

		reveal(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (!['on', 'off'].includes(action)) return this.parse('/help mafia reveal');
			if ((action === 'off' && game.noReveal) || (action === 'on' && !game.noReveal)) {
				return user.sendTo(
					room,
					`|error|Revealing of roles is already ${game.noReveal ? 'disabled' : 'enabled'}.`
				);
			}
			game.noReveal = action === 'off';
			game.sendDeclare(`Revealing of roles has been ${action === 'off' ? 'disabled' : 'enabled'}.`);
			game.updatePlayers();
			game.logAction(user, `${game.noReveal ? 'disabled' : 'enabled'} reveals`);
		},
		revealhelp: [`/mafia reveal [on|off] - Sets if roles reveal on death or not. Requires host % @ # &`],

		takeidles(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (!['on', 'off'].includes(action)) return this.parse('/help mafia takeidles');
			if ((action === 'off' && !game.takeIdles) || (action === 'on' && game.takeIdles)) {
				return this.errorReply(`Actions and idles are already ${game.takeIdles ? '' : 'not '}being accepted.`);
			}
			game.takeIdles = action === 'on';
			game.sendDeclare(`Actions and idles are ${game.takeIdles ? 'now' : 'no longer'} being accepted.`);
			game.updatePlayers();
		},
		takeidleshelp: [`/mafia takeidles [on|off] - Sets if idles are accepted by the script or not. Requires host % @ # &`],

		resetroles: 'setroles',
		forceresetroles: 'setroles',
		forcesetroles: 'setroles',
		setroles(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const reset = cmd.includes('reset');
			if (reset) {
				if (game.phase !== 'day' && game.phase !== 'night') return this.errorReply(`The game has not started yet.`);
			} else {
				if (game.phase !== 'locked' && game.phase !== 'IDEAlocked') {
					return this.errorReply(game.phase === 'signups' ? `You need to close signups first.` : `The game has already started.`);
				}
			}
			if (!target) return this.parse('/help mafia setroles');

			game.setRoles(user, target, cmd.includes('force'), reset);
			game.logAction(user, `${reset ? 're' : ''}set roles`);
		},
		setroleshelp: [
			`/mafia setroles [comma separated roles] - Set the roles for a game of mafia. You need to provide one role per player.`,
			`/mafia forcesetroles [comma separated roles] - Forcibly set the roles for a game of mafia. No role PM information or alignment will be set.`,
			`/mafia resetroles [comma separated roles] - Reset the roles in an ongoing game.`,
		],

		resetgame: 'gamereset',
		forceresetgame: 'gamereset',
		gamereset(target, room, user, connection) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (target) return this.parse('/help mafia resetgame');
			if (game.phase !== 'day' && game.phase !== 'night') return this.errorReply(`The game has not started yet.`);
			if (game.IDEA.data) return this.errorReply(`You cannot use this command in IDEA.`);
			game.resetGame();
			game.logAction(user, 'reset the game state');
		},
		resetgamehelp: [
			`/mafia resetgame - Resets game data. Does not change settings from the host (besides deadlines) or add/remove any players. Requires host % @ # &`,
		],

		idea(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkCan('show', null, room);
			if (!user.can('mute', null, room) && game.hostid !== user.id && !game.cohostids.includes(user.id)) {
				return this.errorReply(`/mafia idea - Access denied.`);
			}
			if (game.started) return this.errorReply(`You cannot start an IDEA after the game has started.`);
			if (game.phase !== 'locked' && game.phase !== 'IDEAlocked') {
				return this.errorReply(`You need to close the signups first.`);
			}
			game.ideaInit(user, toID(target));
			game.logAction(user, `started an IDEA`);
		},
		ideahelp: [
			`/mafia idea [idea] - starts the IDEA module [idea]. Requires + % @ # &, voices can only start for themselves`,
			`/mafia ideareroll - rerolls the IDEA module. Requires host % @ # &`,
			`/mafia ideapick [selection], [role] - selects a role`,
			`/mafia ideadiscards - shows the discarded roles`,
		],

		customidea(target, room, user) {
			room = this.requireRoom();
			this.checkCan('mute', null, room);
			const game = this.requireGame(Mafia);
			if (game.started) return this.errorReply(`You cannot start an IDEA after the game has started.`);
			if (game.phase !== 'locked' && game.phase !== 'IDEAlocked') {
				return this.errorReply(`You need to close the signups first.`);
			}
			const [options, roles] = Utils.splitFirst(target, '\n');
			if (!options || !roles) return this.parse('/help mafia idea');
			const [choicesStr, ...picks] = options.split(',').map(x => x.trim());
			const choices = parseInt(choicesStr);
			if (!choices || choices <= picks.length) return this.errorReply(`You need to have more choices than picks.`);
			if (picks.some((value, index, arr) => arr.indexOf(value, index + 1) > 0)) {
				return this.errorReply(`Your picks must be unique.`);
			}
			game.customIdeaInit(user, choices, picks, roles);
		},
		customideahelp: [
			`/mafia customidea choices, picks (new line here, shift+enter)`,
			`(comma or newline separated rolelist) - Starts an IDEA module with custom roles. Requires % @ # &`,
			`choices refers to the number of roles you get to pick from. In GI, this is 2, in GestI, this is 3.`,
			`picks refers to what you choose. In GI, this should be 'role', in GestI, this should be 'role, alignment'`,
		],
		ideapick(target, room, user) {
			room = this.requireRoom();
			const args = target.split(',');
			const game = this.requireGame(Mafia);
			if (!(user.id in game.playerTable)) {
				return user.sendTo(room, '|error|You are not a player in the game.');
			}
			if (game.phase !== 'IDEApicking') {
				return this.errorReply(`The game is not in the IDEA picking phase.`);
			}
			game.ideaPick(user, args);
		},

		ideareroll(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			game.ideaDistributeRoles(user);
			game.logAction(user, `rerolled an IDEA`);
		},
		idearerollhelp: [`/mafia ideareroll - rerolls the roles for the current IDEA module. Requires host % @ # &`],

		discards: 'ideadiscards',
		ideadiscards(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (!game.IDEA.data) return this.errorReply(`There is no IDEA module in the mafia game.`);
			if (target) {
				if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
				if (this.meansNo(target)) {
					if (game.IDEA.discardsHidden) return this.errorReply(`IDEA discards are already hidden.`);
					game.IDEA.discardsHidden = true;
				} else if (this.meansYes(target)) {
					if (!game.IDEA.discardsHidden) return this.errorReply(`IDEA discards are already visible.`);
					game.IDEA.discardsHidden = false;
				} else {
					return this.parse('/help mafia ideadiscards');
				}
				game.logAction(user, `${game.IDEA.discardsHidden ? 'hid' : 'unhid'} IDEA discards`);
				return this.sendReply(`IDEA discards are now ${game.IDEA.discardsHidden ? 'hidden' : 'visible'}.`);
			}
			if (game.IDEA.discardsHidden) return this.errorReply(`Discards are not visible.`);
			if (!game.IDEA.discardsHTML) return this.errorReply(`The IDEA module does not have finalised discards yet.`);
			if (!this.runBroadcast()) return;
			this.sendReplyBox(`<details><summary>IDEA discards:</summary>${game.IDEA.discardsHTML}</details>`);
		},
		ideadiscardshelp: [
			`/mafia ideadiscards - shows the discarded roles`,
			`/mafia ideadiscards off - hides discards from the players. Requires host % @ # &`,
			`/mafia ideadiscards on - shows discards to the players. Requires host % @ # &`,
		],

		daystart: 'start',
		nightstart: 'start',
		start(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (target) {
				this.parse(`/mafia close`);
				this.parse(`/mafia setroles ${target}`);
				this.parse(`/mafia ${cmd}`);
				return;
			}
			game.start(user, cmd === 'daystart');
			game.logAction(user, `started the game`);
		},
		starthelp: [`/mafia start - Start the game of mafia. Signups must be closed. Requires host % @ # &`],

		extend: 'day',
		night: 'day',
		day(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (cmd === 'night') {
				game.night();
			} else {
				let extension = parseInt(toID(target));
				if (isNaN(extension)) {
					extension = 0;
				} else {
					if (extension < 1) extension = 1;
					if (extension > 10) extension = 10;
				}
				if (cmd === 'extend') {
					for (const p in game.playerTable) {
						const player = game.playerTable[p];
						player.actionArr[game.dayNum] = '';
					}
				}
				game.day(cmd === 'extend' ? extension : null);
			}
			game.logAction(user, `set day/night`);
		},
		dayhelp: [
			`/mafia day - Move to the next game day. Requires host % @ # &`,
			`/mafia night - Move to the next game night. Requires host % @ # &`,
			`/mafia extend (minutes) - Return to the previous game day. If (minutes) is provided, set the deadline for (minutes) minutes. Requires host % @ # &`,
		],

		prod(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (game.phase !== 'night') return;
			for (const player of Object.values(game.playerTable)) {
				const playerid = Users.get(player.id);
				if (playerid?.connected && player.action === null) {
					playerid.sendTo(room, `|notify|Send in an action or idle!`);
					playerid.sendTo(room, `Send in an action or idle, or else you will get subbed out!`);
				}
			}
			game.sendDeclare(`Unsubmitted players have been reminded to submit an action or idle.`);
		},
		prodhelp: [
			`/mafia prod - Notifies players that they must submit an action or idle if they haven't yet. Requires host % @ # &`,
		],

		v: 'vote',
		vote(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkChat(null, room);
			if (!(user.id in game.playerTable) &&
				(!(user.id in game.dead) || !game.dead[user.id].restless)) {
				return this.errorReply(`You are not in the game of ${game.title}.`);
			}
			game.vote(user.id, toID(target));
		},
		votehelp: [`/mafia vote [player|novote] - Vote the specified player or abstain from voting.`],

		uv: 'unvote',
		unv: 'unvote',
		unnovote: 'unvote',
		unvote(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkChat(null, room);
			if (!(user.id in game.playerTable) &&
				(!(user.id in game.dead) || !game.dead[user.id].restless)) {
				return this.errorReply(`You are not in the game of ${game.title}.`);
			}
			game.unvote(user.id);
		},
		unvotehelp: [`/mafia unvote - Withdraw your vote. Fails if you're not voting anyone`],

		nv: 'novote',
		novote() {
			this.parse('/mafia vote novote');
		},

		enableself: 'selfvote',
		selfvote(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (!action) return this.parse(`/help mafia selfvote`);
			if (this.meansYes(action)) {
				game.setSelfVote(user, true);
			} else if (this.meansNo(action)) {
				game.setSelfVote(user, false);
			} else if (action === 'hammer') {
				game.setSelfVote(user, 'hammer');
			} else {
				return this.parse(`/help mafia selfvote`);
			}
			game.logAction(user, `changed selfvote`);
		},
		selfvotehelp: [
			`/mafia selfvote [on|hammer|off] - Allows players to self vote themselves either at hammer or anytime. Requires host % @ # &`,
		],

		treestump: 'kill',
		spirit: 'kill',
		spiritstump: 'kill',
		kick: 'kill',
		kill(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (game.phase === 'IDEApicking') {
				return this.errorReply(`You cannot add or remove players while IDEA roles are being picked.`); // needs to be here since eliminate doesn't pass the user
			}
			if (!target) return this.parse('/help mafia kill');
			const player = game.playerTable[toID(target)];
			const dead = game.dead[toID(target)];
			let repeat;
			if (dead) {
				switch (cmd) {
				case 'treestump':
					repeat = dead.treestump && !dead.restless;
					break;
				case 'spirit':
					repeat = !dead.treestump && dead.restless;
					break;
				case 'spiritstump':
					repeat = dead.treestump && dead.restless;
					break;
				case 'kill': case 'kick':
					repeat = !dead.treestump && !dead.restless;
					break;
				}
			}
			if (dead && repeat) return this.errorReply(`${dead.safeName} has already been ${cmd}ed.`);
			if (player || dead) {
				game.eliminate(toID(target), cmd);
				game.logAction(user, `${cmd}ed ${(dead || player).safeName}`);
			} else {
				this.errorReply(`${target.trim()} is not a player.`);
			}
		},
		killhelp: [
			`/mafia kill [player] - Kill a player, eliminating them from the game. Requires host % @ # &`,
			`/mafia treestump [player] - Kills a player, but allows them to talk during the day still.`,
			`/mafia spirit [player] - Kills a player, but allows them to vote still.`,
			`/mafia spiritstump [player] Kills a player, but allows them to talk and vote during the day.`,
		],

		revealas: 'revealrole',
		revealrole(target, room, user, connection, cmd) {
			const args = target.split(',');
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			let revealAs = '';
			let revealedRole = null;
			if (cmd === 'revealas') {
				if (!args[0]) {
					return this.parse('/help mafia revealas');
				} else {
					revealedRole = Mafia.parseRole(args.pop()!);
					const color = MafiaData.alignments[revealedRole.role.alignment].color;
					revealAs = `<span style="font-weight:bold;color:${color}">${revealedRole.role.safeName}</span>`;
				}
			}
			if (!args[0]) return this.parse('/help mafia revealas');
			for (const targetUsername of args) {
				let player = game.playerTable[toID(targetUsername)];
				if (!player) player = game.dead[toID(targetUsername)];
				if (player) {
					game.revealRole(user, player, `${cmd === 'revealas' ? revealAs : player.getRole()}`);
					game.logAction(user, `revealed ${player.name}`);
					if (cmd === 'revealas') {
						game.secretLogAction(user, `fakerevealed ${player.name} as ${revealedRole!.role.name}`);
					}
				} else {
					this.errorReply(`${targetUsername} is not a player.`);
				}
			}
		},
		revealrolehelp: [
			`/mafia revealrole [player] - Reveals the role of a player. Requires host % @ # &`,
			`/mafia revealas [player], [role] - Fakereveals the role of a player as a certain role. Requires host % @ # &`,
		],

		unidle: 'idle',
		unaction: 'idle',
		noresponse: 'idle',
		action: 'idle',
		idle(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			const player = game.playerTable[user.id];
			if (!player) return this.errorReply(`You are not in the game of ${game.title}.`);
			if (game.phase !== 'night') return this.errorReply(`You can only submit an action or idle during the night phase.`);
			if (!game.takeIdles) {
				return this.errorReply(`The host is not accepting idles through the script. Send your action or idle to the host.`);
			}
			switch (cmd) {
			case 'idle':
				player.action = false;
				user.sendTo(room, `You have idled.`);
				player.actionArr[game.dayNum] = 'idle';
				break;
			case 'action':
				player.action = true;
				if (target) {
					player.action = target;
					try {
						this.checkBanwords(room, target);
					} catch {
						throw new Chat.ErrorMessage(`Your action submission contained a word banned by this room.`);
					}
					user.sendTo(room, `You have decided to use an action, with the following details: ${target}`);
				} else {
					user.sendTo(room, `You have decided to use an action. Please submit details about your action.`);
				}
				player.actionArr[game.dayNum] = target;
				break;
			case 'noresponse': case 'unidle': case 'unaction':
				player.action = null;
				user.sendTo(room, `You are no longer submitting an action or idle.`);
				player.actionArr[game.dayNum] = '';
				break;
			}
			player.updateHtmlRoom();
		},
		actionhelp: 'idlehelp',
		idlehelp: [
			`/mafia idle - Tells the host if you are idling.`,
			`/mafia action [details] - Tells the host you are using an action with the given submission details.`,
		],

		forceadd: 'revive',
		add: 'revive',
		revive(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!toID(target)) return this.parse('/help mafia revive');
			let didSomething = false;
			if (game.revive(user, toID(target), cmd === 'forceadd')) {
				didSomething = true;
			}
			if (didSomething) game.logAction(user, `added players`);
		},
		revivehelp: [
			`/mafia revive [player] - Revive a player who died or add a new player to the game. Requires host % @ # &`,
		],

		dl: 'deadline',
		deadline(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			target = toID(target);
			if (target && game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (target === 'off') {
				game.setDeadline(0);
			} else {
				const num = parseInt(target);
				if (isNaN(num)) {
					// hack to let hosts broadcast
					if (game.hostid === user.id || game.cohostids.includes(user.id)) {
						this.broadcastMessage = this.message.toLowerCase().replace(/[^a-z0-9\s!,]/g, '');
					}
					if (!this.runBroadcast()) return false;

					if ((game.dlAt - Date.now()) > 0) {
						return this.sendReply(`|raw|<strong>The deadline is in ${Chat.toDurationString(game.dlAt - Date.now()) || '0 seconds'}.</strong>`);
					} else {
						return this.parse(`/help mafia deadline`);
					}
				}
				if (num < 1 || num > 20) return this.errorReply(`The deadline must be between 1 and 20 minutes.`);
				game.setDeadline(num);
			}
			game.logAction(user, `changed deadline`);
		},
		deadlinehelp: [
			`/mafia deadline [minutes|off] - Sets or removes the deadline for the game. Cannot be more than 20 minutes.`,
		],

		applyvotemodifier: 'applyhammermodifier',
		applyhammermodifier(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);
			const [player, mod] = target.split(',');
			if (cmd === 'applyhammermodifier') {
				game.applyHammerModifier(user, toID(player), parseInt(mod));
				game.secretLogAction(user, `changed a hammer modifier`);
			} else {
				game.applyVoteModifier(user, toID(player), parseInt(mod));
				game.secretLogAction(user, `changed a vote modifier`);
			}
		},
		clearvotemodifiers: 'clearhammermodifiers',
		clearhammermodifiers(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);
			if (cmd === 'clearhammermodifiers') {
				game.clearHammerModifiers(user);
				game.secretLogAction(user, `cleared hammer modifiers`);
			} else {
				game.clearVoteModifiers(user);
				game.secretLogAction(user, `cleared vote modifiers`);
			}
		},

		hate: 'love',
		unhate: 'love',
		unlove: 'love',
		removehammermodifier: 'love',
		love(target, room, user, connection, cmd) {
			let mod;
			switch (cmd) {
			case 'hate':
				mod = -1;
				break;
			case 'love':
				mod = 1;
				break;
			case 'unhate': case 'unlove': case 'removehammermodifier':
				mod = 0;
				break;
			}
			this.parse(`/mafia applyhammermodifier ${target}, ${mod}`);
		},
		doublevoter: 'mayor',
		voteless: 'mayor',
		unvoteless: 'mayor',
		unmayor: 'mayor',
		removevotemodifier: 'mayor',
		mayor(target, room, user, connection, cmd) {
			let mod;
			switch (cmd) {
			case 'doublevoter': case 'mayor':
				mod = 2;
				break;
			case 'voteless':
				mod = 0;
				break;
			case 'unvoteless': case 'unmayor': case 'removevotemodifier':
				mod = 1;
				break;
			}
			this.parse(`/mafia applyvotemodifier ${target}, ${mod}`);
		},

		unsilence: 'silence',
		silence(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);

			target = toID(target);
			const targetPlayer = game.playerTable[target] || game.dead[target];
			const silence = cmd === 'silence';
			if (!targetPlayer) return this.errorReply(`${target} is not in the game of mafia.`);
			if (silence === targetPlayer.silenced) {
				return this.errorReply(`${targetPlayer.name} is already ${!silence ? 'not' : ''} silenced.`);
			}
			targetPlayer.silenced = silence;
			this.sendReply(`${targetPlayer.name} has been ${!silence ? 'un' : ''}silenced.`);
			game.logAction(user, `${!silence ? 'un' : ''}silenced a player`);
		},
		silencehelp: [
			`/mafia silence [player] - Silences [player], preventing them from talking at all. Requires host % @ # &`,
			`/mafia unsilence [player] - Removes a silence on [player], allowing them to talk again. Requires host % @ # &`,
		],

		insomniac: 'nighttalk',
		uninsomniac: 'nighttalk',
		unnighttalk: 'nighttalk',
		nighttalk(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);

			target = toID(target);
			const targetPlayer = game.playerTable[target] || game.dead[target];
			const nighttalk = !cmd.startsWith('un');
			if (!targetPlayer) return this.errorReply(`${target} is not in the game of mafia.`);
			if (nighttalk === targetPlayer.nighttalk) {
				return this.errorReply(`${targetPlayer.name} is already ${!nighttalk ? 'not' : ''} able to talk during the night.`);
			}
			targetPlayer.nighttalk = nighttalk;
			this.sendReply(`${targetPlayer.name} can ${!nighttalk ? 'no longer' : 'now'} talk during the night.`);
			game.logAction(user, `${!nighttalk ? 'un' : ''}insomniacd a player`);
		},
		nighttalkhelp: [
			`/mafia nighttalk [player] - Makes [player] an insomniac, allowing them to talk freely during the night. Requires host % @ # &`,
			`/mafia unnighttalk [player] - Removes [player] as an insomniac, preventing them from talking during the night. Requires host % @ # &`,
		],
		actor: 'priest',
		unactor: 'priest',
		unpriest: 'priest',
		priest(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);

			target = toID(target);
			const targetPlayer = game.playerTable[target] || game.dead[target];
			if (!targetPlayer) return this.errorReply(`${target} is not in the game of mafia.`);

			const actor = cmd.endsWith('actor');
			const remove = cmd.startsWith('un');
			if (remove) {
				if (targetPlayer.hammerRestriction === null) {
					return this.errorReply(`${targetPlayer.name} already has no voting restrictions.`);
				}
				if (actor !== targetPlayer.hammerRestriction) {
					return this.errorReply(`${targetPlayer.name} is ${targetPlayer.hammerRestriction ? 'an actor' : 'a priest'}.`);
				}
				targetPlayer.hammerRestriction = null;
				return this.sendReply(`${targetPlayer}'s hammer restriction was removed.`);
			}

			if (actor === targetPlayer.hammerRestriction) {
				return this.errorReply(`${targetPlayer.name} is already ${targetPlayer.hammerRestriction ? 'an actor' : 'a priest'}.`);
			}
			targetPlayer.hammerRestriction = actor;
			this.sendReply(`${targetPlayer.name} is now ${targetPlayer.hammerRestriction ? "an actor (can only hammer)" : "a priest (can't hammer)"}.`);
			if (actor) {
				// target is an actor, remove their vote because it's now impossible
				game.unvote(targetPlayer.id, true);
			}
			game.logAction(user, `made a player actor/priest`);
		},
		priesthelp: [
			`/mafia (un)priest [player] - Makes [player] a priest, preventing them from placing the hammer vote. Requires host % @ # &`,
			`/mafia (un)actor [player] - Makes [player] an actor, preventing them from placing non-hammer votes. Requires host % @ # &`,
		],

		shifthammer: 'hammer',
		resethammer: 'hammer',
		hammer(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (!game.started) return this.errorReply(`The game has not started yet.`);
			const hammer = parseInt(target);
			if (toID(cmd) !== `resethammer` && ((isNaN(hammer) && !this.meansNo(target)) || hammer < 1)) {
				return this.errorReply(`${target} is not a valid hammer count.`);
			}
			switch (cmd.toLowerCase()) {
			case 'shifthammer':
				game.shiftHammer(hammer);
				break;
			case 'hammer':
				game.setHammer(hammer);
				break;
			default:
				game.resetHammer();
				break;
			}
			game.logAction(user, `changed the hammer`);
		},
		hammerhelp: [
			`/mafia hammer [hammer] - sets the hammer count to [hammer] and resets votes`,
			`/mafia hammer off - disables hammering`,
			`/mafia shifthammer [hammer] - sets the hammer count to [hammer] without resetting votes`,
			`/mafia resethammer - sets the hammer to the default, resetting votes`,
		],

		vl: 'votelock',
		votelock(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (this.meansYes(action)) {
				game.setVotelock(user, true);
			} else if (this.meansNo(action)) {
				game.setVotelock(user, false);
			} else {
				return this.parse('/help mafia votelock');
			}
			game.logAction(user, `changed votelock status`);
		},
		votelockhelp: [
			`/mafia votelock [on|off] - Allows or disallows players to change their vote. Requires host % @ # &`,
		],

		voting: 'votesall',
		votesall(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			const action = toID(target);
			if (this.meansYes(action)) {
				game.setVoting(user, true);
			} else if (this.meansNo(action)) {
				game.setVoting(user, false);
			} else {
				return this.parse('/help mafia voting');
			}
			game.logAction(user, `changed voting status`);
		},
		votinghelp: [
			`/mafia voting [on|off] - Allows or disallows players to vote. Requires host % @ # &`,
		],

		enablenv: 'enablenl',
		disablenv: 'enablenl',
		disablenl: 'enablenl',
		enablenl(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (cmd === 'enablenl' || cmd === 'enablenv') {
				game.setNoVote(user, true);
			} else {
				game.setNoVote(user, false);
			}
			game.logAction(user, `changed novote status`);
		},
		enablenlhelp: [
			`/mafia [enablenv|disablenv] - Allows or disallows players abstain from voting. Requires host % @ # &`,
		],

		forcevote(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			target = toID(target);
			if (this.meansYes(target)) {
				if (game.forceVote) return this.errorReply(`Forcevoting is already enabled.`);
				game.forceVote = true;
				if (game.started) game.resetHammer();
				game.sendDeclare(`Forcevoting has been enabled. Your vote will start on yourself, and you cannot unvote!`);
			} else if (this.meansNo(target)) {
				if (!game.forceVote) return this.errorReply(`Forcevoting is already disabled.`);
				game.forceVote = false;
				game.sendDeclare(`Forcevoting has been disabled. You can vote normally now!`);
			} else {
				this.parse('/help mafia forcevote');
			}
			game.logAction(user, `changed forcevote status`);
		},
		forcevotehelp: [
			`/mafia forcevote [yes/no] - Forces players' votes onto themselves, and prevents unvoting. Requires host % @ # &`,
		],

		votes(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (!game.started) return this.errorReply(`The game of mafia has not started yet.`);

			// hack to let hosts broadcast
			if (game.hostid === user.id || game.cohostids.includes(user.id)) {
				this.broadcastMessage = this.message.toLowerCase().replace(/[^a-z0-9\s!,]/g, '');
			}
			if (!this.runBroadcast()) return false;

			this.sendReplyBox(game.voteBox());
		},

		pl: 'players',
		players(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);

			// hack to let hosts broadcast
			if (game.hostid === user.id || game.cohostids.includes(user.id)) {
				this.broadcastMessage = this.message.toLowerCase().replace(/[^a-z0-9\s!,]/g, '');
			}
			if (!this.runBroadcast()) return false;

			if (this.broadcasting) {
				game.sendPlayerList();
			} else {
				this.sendReplyBox(`Players (${game.playerCount}): ${Object.values(game.playerTable).map(p => p.safeName).sort().join(', ')}`);
			}
		},

		originalrolelist: 'rolelist',
		orl: 'rolelist',
		rl: 'rolelist',
		rolelist(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.closedSetup) return this.errorReply(`You cannot show roles in a closed setup.`);
			if (!this.runBroadcast()) return false;
			if (game.IDEA.data) {
				const buf = `<details><summary>IDEA roles:</summary>${game.IDEA.data.roles.join(`<br />`)}</details>`;
				return this.sendReplyBox(buf);
			}
			const showOrl = (['orl', 'originalrolelist'].includes(cmd) || game.noReveal);
			const roleString = Utils.sortBy((showOrl ? game.originalRoles : game.roles), role => (
				role.alignment
			)).map(role => role.safeName).join(', ');

			this.sendReplyBox(`${showOrl ? `Original Rolelist: ` : `Rolelist: `}${roleString}`);
		},

		playerroles(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) {
				return this.errorReply(`Only the host can view roles.`);
			}
			if (!game.started) return this.errorReply(`The game has not started.`);
			const players = [...Object.values(game.playerTable), ...Object.values(game.dead)];
			this.sendReplyBox(players.map(
				p => `${p.safeName}: ${p.role ? (p.role.alignment === 'solo' ? 'Solo ' : '') + p.role.safeName : 'No role'}`
			).join('<br/>'));
		},

		spectate: 'view',
		view(target, room, user, connection) {
			room = this.requireRoom();
			this.requireGame(Mafia);
			if (!this.runBroadcast()) return;
			if (this.broadcasting) {
				return this.sendReplyBox(`<button name="joinRoom" value="view-mafia-${room.roomid}" class="button"><strong>Spectate the game</strong></button>`);
			}
			return this.parse(`/join view-mafia-${room.roomid}`);
		},

		refreshvotes(target, room, user, connection) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			const votes = game.voteBoxFor(user.id);
			user.send(`>view-mafia-${game.room.roomid}\n|selectorhtml|#mafia-votes|` + votes);
		},
		forcesub: 'sub',
		sub(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			const args = target.split(',');
			const action = toID(args.shift());
			switch (action) {
			case 'in':
				if (user.id in game.playerTable) {
					// Check if they have requested to be subbed out.
					if (!game.requestedSub.includes(user.id)) {
						return this.errorReply(`You have not requested to be subbed out.`);
					}
					game.requestedSub.splice(game.requestedSub.indexOf(user.id), 1);
					this.errorReply(`You have cancelled your request to sub out.`);
					game.playerTable[user.id].updateHtmlRoom();
				} else {
					this.checkChat(null, room);
					if (game.subs.includes(user.id)) return this.errorReply(`You are already on the sub list.`);
					if (game.played.includes(user.id)) return this.errorReply(`You cannot sub back into the game.`);
					// Change this to game.canJoin(user, true, true) if you're trying to test something sub related locally.
					game.canJoin(user, true);
					game.subs.push(user.id);
					game.nextSub();
					// Update spectator's view
					this.parse(`/join view-mafia-${room.roomid}`);
				}
				break;
			case 'out':
				if (user.id in game.playerTable) {
					if (game.requestedSub.includes(user.id)) {
						return this.errorReply(`You have already requested to be subbed out.`);
					}
					game.requestedSub.push(user.id);
					game.playerTable[user.id].updateHtmlRoom();
					game.nextSub();
				} else {
					if (game.hostid === user.id || game.cohostids.includes(user.id)) {
						return this.errorReply(`The host cannot sub out of the game.`);
					}
					if (!game.subs.includes(user.id)) return this.errorReply(`You are not on the sub list.`);
					game.subs.splice(game.subs.indexOf(user.id), 1);
					// Update spectator's view
					this.parse(`/join view-mafia-${room.roomid}`);
				}
				break;
			case 'next':
				if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
				const toSub = args.shift();
				if (!(toID(toSub) in game.playerTable)) return this.errorReply(`${toSub} is not in the game.`);
				if (!game.subs.length) {
					if (game.hostRequestedSub.includes(toID(toSub))) {
						return this.errorReply(`${toSub} is already on the list to be subbed out.`);
					}
					user.sendTo(
						room,
						`|error|There are no subs to replace ${toSub}, they will be subbed if a sub is available before they speak next.`
					);
					game.hostRequestedSub.unshift(toID(toSub));
				} else {
					game.nextSub(toID(toSub));
				}
				game.logAction(user, `requested a sub for a player`);
				break;
			case 'remove':
				if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
				for (const toRemove of args) {
					const toRemoveIndex = game.subs.indexOf(toID(toRemove));
					if (toRemoveIndex === -1) {
						user.sendTo(room, `|error|${toRemove} is not on the sub list.`);
						continue;
					}
					game.subs.splice(toRemoveIndex, 1);
					user.sendTo(room, `${toRemove} has been removed from the sublist`);
					game.logAction(user, `removed a player from the sublist`);
				}
				break;
			case 'unrequest':
				if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
				const toUnrequest = toID(args.shift());
				const userIndex = game.requestedSub.indexOf(toUnrequest);
				const hostIndex = game.hostRequestedSub.indexOf(toUnrequest);
				if (userIndex < 0 && hostIndex < 0) return user.sendTo(room, `|error|${toUnrequest} is not requesting a sub.`);
				if (userIndex > -1) {
					game.requestedSub.splice(userIndex, 1);
					user.sendTo(room, `${toUnrequest}'s sub request has been removed.`);
				}
				if (hostIndex > -1) {
					game.hostRequestedSub.splice(userIndex, 1);
					user.sendTo(room, `${toUnrequest} has been removed from the host sublist.`);
				}
				break;
			default:
				if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
				const toSubOut = action;
				const toSubIn = toID(args.shift());
				if (!(toSubOut in game.playerTable)) return this.errorReply(`${toSubOut} is not in the game.`);

				const targetUser = Users.get(toSubIn);
				if (!targetUser) return this.errorReply(`The user "${toSubIn}" was not found.`);
				game.canJoin(targetUser, false, cmd === 'forcesub');
				if (game.subs.includes(targetUser.id)) {
					game.subs.splice(game.subs.indexOf(targetUser.id), 1);
				}
				if (game.hostRequestedSub.includes(toSubOut)) {
					game.hostRequestedSub.splice(game.hostRequestedSub.indexOf(toSubOut), 1);
				}
				if (game.requestedSub.includes(toSubOut)) {
					game.requestedSub.splice(game.requestedSub.indexOf(toSubOut), 1);
				}
				game.sub(toSubOut, toSubIn);
				game.logAction(user, `substituted a player`);
			}
		},
		subhelp: [
			`/mafia sub in - Request to sub into the game, or cancel a request to sub out.`,
			`/mafia sub out - Request to sub out of the game, or cancel a request to sub in.`,
			`/mafia sub next, [player] - Forcibly sub [player] out of the game. Requires host % @ # &`,
			`/mafia sub remove, [user] - Remove [user] from the sublist. Requres host % @ # &`,
			`/mafia sub unrequest, [player] - Remove's a player's request to sub out of the game. Requires host % @ # &`,
			`/mafia sub [player], [user] - Forcibly sub [player] for [user]. Requires host % @ # &`,
		],

		autosub(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('mute', null, room);
			if (this.meansYes(toID(target))) {
				if (game.autoSub) return this.errorReply(`Automatic subbing of players is already enabled.`);
				game.autoSub = true;
				user.sendTo(room, `Automatic subbing of players has been enabled.`);
				game.nextSub();
			} else if (this.meansNo(toID(target))) {
				if (!game.autoSub) return this.errorReply(`Automatic subbing of players is already disabled.`);
				game.autoSub = false;
				user.sendTo(room, `Automatic subbing of players has been disabled.`);
			} else {
				return this.parse(`/help mafia autosub`);
			}
			game.logAction(user, `changed autosub status`);
		},
		autosubhelp: [
			`/mafia autosub [yes|no] - Sets if players will automatically sub out if a user is on the sublist. Requires host % @ # &`,
		],

		cohost: 'subhost',
		forcecohost: 'subhost',
		forcesubhost: 'subhost',
		subhost(target, room, user, connection, cmd) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkChat();
			if (!target) return this.parse(`/help mafia ${cmd}`);
			this.checkCan('mute', null, room);
			const {targetUser} = this.requireUser(target);
			if (!room.users[targetUser.id]) return this.errorReply(`${targetUser.name} is not in this room, and cannot be hosted.`);
			if (game.hostid === targetUser.id) return this.errorReply(`${targetUser.name} is already the host.`);
			if (game.cohostids.includes(targetUser.id)) return this.errorReply(`${targetUser.name} is already a cohost.`);
			if (targetUser.id in game.playerTable) return this.errorReply(`The host cannot be ingame.`);
			if (targetUser.id in game.dead) {
				if (!cmd.includes('force')) {
					return this.errorReply(`${targetUser.name} could potentially be revived. To continue anyway, use /mafia force${cmd} ${target}.`);
				}
				if (game.dead[targetUser.id].voting) game.unvote(targetUser.id);
				game.dead[targetUser.id].destroy();
				delete game.dead[targetUser.id];
			}
			if (game.subs.includes(targetUser.id)) game.subs.splice(game.subs.indexOf(targetUser.id), 1);
			if (cmd.includes('cohost')) {
				game.cohostids.push(targetUser.id);
				game.cohosts.push(Utils.escapeHTML(targetUser.name));
				game.sendDeclare(Utils.html`${targetUser.name} has been added as a cohost by ${user.name}`);
				for (const conn of targetUser.connections) {
					void Chat.resolvePage(`view-mafia-${room.roomid}`, targetUser, conn);
				}
				this.modlog('MAFIACOHOST', targetUser, null, {noalts: true, noip: true});
			} else {
				const oldHostid = game.hostid;
				const oldHost = Users.get(game.hostid);
				if (oldHost) oldHost.send(`>view-mafia-${room.roomid}\n|deinit`);
				const queueIndex = hostQueue.indexOf(targetUser.id);
				if (queueIndex > -1) hostQueue.splice(queueIndex, 1);
				game.host = Utils.escapeHTML(targetUser.name);
				game.hostid = targetUser.id;
				game.played.push(targetUser.id);
				for (const conn of targetUser.connections) {
					void Chat.resolvePage(`view-mafia-${room.roomid}`, targetUser, conn);
				}
				game.sendDeclare(Utils.html`${targetUser.name} has been substituted as the new host, replacing ${oldHostid}.`);
				this.modlog('MAFIASUBHOST', targetUser, `replacing ${oldHostid}`, {noalts: true, noip: true});
			}
		},
		subhosthelp: [`/mafia subhost [user] - Substitues the user as the new game host.`],
		cohosthelp: [
			`/mafia cohost [user] - Adds the user as a cohost. Cohosts can talk during the game, as well as perform host actions.`,
		],

		uncohost: 'removecohost',
		removecohost(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			this.checkChat();
			if (!target) return this.parse('/help mafia subhost');
			this.checkCan('mute', null, room);
			const targetID = toID(target);

			const cohostIndex = game.cohostids.indexOf(targetID);
			if (cohostIndex < 0) {
				if (game.hostid === targetID) {
					return this.errorReply(`${target} is the host, not a cohost. Use /mafia subhost to replace them.`);
				}
				return this.errorReply(`${target} is not a cohost.`);
			}
			game.cohostids.splice(cohostIndex, 1);
			game.sendDeclare(Utils.html`${target} was removed as a cohost by ${user.name}`);
			this.modlog('MAFIAUNCOHOST', target, null, {noalts: true, noip: true});
		},

		end(target, room, user) {
			room = this.requireRoom();
			const game = this.requireGame(Mafia);
			if (game.hostid !== user.id && !game.cohostids.includes(user.id)) this.checkCan('show', null, room);
			game.end();
			this.modlog('MAFIAEND', null);
		},
		endhelp: [`/mafia end - End the current game of mafia. Requires host + % @ # &`],

		role: 'data',
		alignment: 'data',
		theme: 'data',
		term: 'data',
		dt: 'data',
		data(target, room, user, connection, cmd) {
			if (room?.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			if (cmd === 'role' && !target && room) {
				// Support /mafia role showing your current role if you're in a game
				const game = room.getGame(Mafia);
				if (!game) {
					return this.errorReply(`There is no game of mafia running in this room. If you meant to display information about a role, use /mafia role [role name]`);
				}
				if (!(user.id in game.playerTable)) return this.errorReply(`You are not in the game of ${game.title}.`);
				const role = game.playerTable[user.id].role;
				if (!role) return this.errorReply(`You do not have a role yet.`);
				return this.sendReplyBox(`Your role is: ${role.safeName}`);
			}

			// hack to let hosts broadcast
			const game = room?.getGame(Mafia);
			if (game && (game.hostid === user.id || game.cohostids.includes(user.id))) {
				this.broadcastMessage = this.message.toLowerCase().replace(/[^a-z0-9\s!,]/g, '');
			}
			if (!this.runBroadcast()) return false;

			if (!target) return this.parse(`/help mafia data`);

			target = toID(target);
			if (target in MafiaData.aliases) target = MafiaData.aliases[target];

			let result: MafiaDataAlignment | MafiaDataRole | MafiaDataTheme | MafiaDataIDEA | MafiaDataTerm | null = null;
			let dataType = cmd;

			const cmdTypes: {[k: string]: keyof MafiaData} = {
				role: 'roles', alignment: 'alignments', theme: 'themes', term: 'terms', idea: 'IDEAs',
			};

			if (cmd in cmdTypes) {
				const toSearch = MafiaData[cmdTypes[cmd]];
				// @ts-ignore guaranteed not an alias
				result = toSearch[target];
			} else {
				// search everything
				for (const [cmdType, dataKey] of Object.entries(cmdTypes)) {
					if (target in MafiaData[dataKey]) {
						// @ts-ignore guaranteed not an alias
						result = MafiaData[dataKey][target];
						dataType = cmdType;
						break;
					}
				}
			}
			if (!result) return this.errorReply(`"${target}" is not a valid mafia alignment, role, theme, or IDEA.`);

			// @ts-ignore
			let buf = `<h3${result.color ? ' style="color: ' + result.color + '"' : ``}>${result.name}</h3><b>Type</b>: ${dataType}<br/>`;
			if (dataType === 'theme') {
				if ((result as MafiaDataTheme).desc) {
					buf += `<b>Description</b>: ${(result as MafiaDataTheme).desc}<br/><details><summary class="button" style="font-weight: bold; display: inline-block">Setups:</summary>`;
				}
				for (const i in result) {
					const num = parseInt(i);
					if (isNaN(num)) continue;
					buf += `${i}: `;
					const count: {[k: string]: number} = {};
					const roles = [];
					for (const role of (result as MafiaDataTheme)[num].split(',').map((x: string) => x.trim())) {
						count[role] = count[role] ? count[role] + 1 : 1;
					}
					for (const role in count) {
						roles.push(count[role] > 1 ? `${count[role]}x ${role}` : role);
					}
					buf += `${roles.join(', ')}<br/>`;
				}
			} else if (dataType === 'idea') {
				if ((result as MafiaDataIDEA).picks && (result as MafiaDataIDEA).choices) {
					buf += `<b>Number of Picks</b>: ${(result as MafiaDataIDEA).picks.length} (${(result as MafiaDataIDEA).picks.join(', ')})<br/>`;
					buf += `<b>Number of Choices</b>: ${(result as MafiaDataIDEA).choices}<br/>`;
				}
				buf += `<details><summary class="button" style="font-weight: bold; display: inline-block">Roles:</summary>`;
				for (const idearole of (result as MafiaDataIDEA).roles) {
					buf += `${idearole}<br/>`;
				}
			} else {
				// @ts-ignore
				if (result.memo) buf += `${result.memo.join('<br/>')}`;
			}
			return this.sendReplyBox(buf);
		},
		datahelp: [
			`/mafia data [alignment|role|modifier|theme|term] - Get information on a mafia alignment, role, modifier, theme, or term.`,
		],

		winfaction: 'win',
		unwinfaction: 'win',
		unwin: 'win',
		win(target, room, user, connection, cmd) {
			const isUnwin = cmd.startsWith('unwin');
			room = this.requireRoom('mafia' as RoomID);
			if (!room || room.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			this.checkCan('mute', null, room);
			const args = target.split(',');
			let points = parseInt(args[0]);
			if (isUnwin) {
				points *= -1;
			}
			if (isNaN(points)) {
				points = 10;
				if (isUnwin) {
					points *= -1;
				}
			} else {
				if (points > 100 || points < -100) {
					return this.errorReply(`You cannot give or take more than 100 points at a time.`);
				}
				// shift out the point count
				args.shift();
			}
			if (!args.length) return this.parse('/help mafia win');
			const month = new Date().toLocaleString("en-us", {month: "numeric", year: "numeric"});
			if (!logs.leaderboard[month]) logs.leaderboard[month] = {};

			let toGiveTo = [];
			let buf = `${points < 0 ? points * -1 : points} point${Chat.plural(points, 's were', ' was')} ${points <= 0 ? 'taken from ' : 'awarded to '} `;
			if (cmd === 'winfaction' || cmd === 'unwinfaction') {
				const game = this.requireGame(Mafia);
				for (let faction of args) {
					faction = toID(faction);
					const inFaction = [];
					for (const player of [...Object.values(game.playerTable), ...Object.values(game.dead)]) {
						if (player.role && toID(player.role.alignment) === faction) {
							toGiveTo.push(player.id);
							inFaction.push(player.id);
						}
					}
					if (inFaction.length) buf += ` the ${faction} faction: ${inFaction.join(', ')};`;
				}
			} else {
				toGiveTo = args;
				buf += toGiveTo.join(', ');
			}
			if (!toGiveTo.length) return this.parse('/help mafia win');
			let gavePoints = false;
			for (let u of toGiveTo) {
				u = toID(u);
				if (!u) continue;
				if (!gavePoints) gavePoints = true;
				if (!logs.leaderboard[month][u]) logs.leaderboard[month][u] = 0;
				logs.leaderboard[month][u] += points;
				if (logs.leaderboard[month][u] === 0) delete logs.leaderboard[month][u];
			}
			if (!gavePoints) return this.parse('/help mafia win');
			writeFile(LOGS_FILE, logs);
			this.modlog(`MAFIAPOINTS`, null, `${points < 0 ? points * -1 : points} points were ${points < 0 ? 'taken from' : 'awarded to'} ${Chat.toListString(toGiveTo)}`);
			room.add(buf).update();
		},
		winhelp: [
			`/mafia (un)win (points), [user1], [user2], [user3], ... - Award the specified users points to the mafia leaderboard for this month. The amount of points can be negative to take points. Defaults to 10 points.`,
			`/mafia (un)winfaction (points), [faction] - Award the specified points to all the players in the given faction.`,
		],

		unmvp: 'mvp',
		mvp(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			if (!room || room.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			this.checkCan('mute', null, room);
			const args = target.split(',');
			if (!args.length) return this.parse('/help mafia mvp');
			const month = new Date().toLocaleString("en-us", {month: "numeric", year: "numeric"});
			if (!logs.mvps[month]) logs.mvps[month] = {};
			if (!logs.leaderboard[month]) logs.leaderboard[month] = {};
			let gavePoints = false;
			for (let u of args) {
				u = toID(u);
				if (!u) continue;
				if (!gavePoints) gavePoints = true;
				if (!logs.leaderboard[month][u]) logs.leaderboard[month][u] = 0;
				if (!logs.mvps[month][u]) logs.mvps[month][u] = 0;
				if (cmd === 'unmvp') {
					logs.mvps[month][u]--;
					logs.leaderboard[month][u] -= 10;
					if (logs.mvps[month][u] === 0) delete logs.mvps[month][u];
					if (logs.leaderboard[month][u] === 0) delete logs.leaderboard[month][u];
				} else {
					logs.mvps[month][u]++;
					logs.leaderboard[month][u] += 10;
				}
			}
			if (!gavePoints) return this.parse('/help mafia mvp');
			writeFile(LOGS_FILE, logs);
			this.modlog(`MAFIA${cmd.toUpperCase()}`, null, `MVP and 10 points were ${cmd === 'unmvp' ? 'taken from' : 'awarded to'} ${Chat.toListString(args)}`);
			room.add(`MVP and 10 points were ${cmd === 'unmvp' ? 'taken from' : 'awarded to'}: ${Chat.toListString(args)}`).update();
		},
		mvphelp: [
			`/mafia mvp [user1], [user2], ... - Gives a MVP point and 10 leaderboard points to the users specified.`,
			`/mafia unmvp [user1], [user2], ... - Takes away a MVP point and 10 leaderboard points from the users specified.`,
		],

		hostlogs: 'leaderboard',
		playlogs: 'leaderboard',
		leaverlogs: 'leaderboard',
		mvpladder: 'leaderboard',
		lb: 'leaderboard',
		leaderboard(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			if (!room || room.settings.mafiaDisabled) return this.errorReply(`Mafia is disabled for this room.`);
			if (['hostlogs', 'playlogs', 'leaverlogs'].includes(cmd)) {
				this.checkCan('mute', null, room);
			} else {
				// Deny broadcasting host/playlogs
				if (!this.runBroadcast()) return;
			}
			if (cmd === 'lb') cmd = 'leaderboard';
			if (this.broadcasting) {
				return this.sendReplyBox(`<button name="joinRoom" value="view-mafialadder-${cmd}" class="button"><strong>${cmd}</strong></button>`);
			}
			return this.parse(`/join view-mafialadder-${cmd}`);
		},
		leaderboardhelp: [
			`/mafia [leaderboard|mvpladder] - View the leaderboard or MVP ladder for the current or last month.`,
			`/mafia [hostlogs|playlogs|leaverlogs] - View the host, play, or leaver logs for the current or last month. Requires % @ # &`,
		],

		gameban: 'hostban',
		hostban(target, room, user, connection, cmd) {
			if (!target) return this.parse('/help mafia hostban');
			room = this.requireRoom();
			this.checkCan('warn', null, room);

			const {targetUser, rest} = this.requireUser(target);
			const [string1, string2] = this.splitOne(rest);
			let duration, reason;
			if (parseInt(string1)) {
				duration = parseInt(string1);
				reason = string2;
			} else {
				duration = parseInt(string2);
				reason = string1;
			}

			if (!duration) duration = 2;
			if (!reason) reason = '';
			if (reason.length > 300) {
				return this.errorReply("The reason is too long. It cannot exceed 300 characters.");
			}

			const userid = toID(targetUser);
			if (Punishments.hasRoomPunishType(room, userid, `MAFIA${this.cmd.toUpperCase()}`)) {
				return this.errorReply(`User '${targetUser.name}' is already ${this.cmd}ned in this room.`);
			} else if (Punishments.hasRoomPunishType(room, userid, `MAFIAGAMEBAN`)) {
				return this.errorReply(`User '${targetUser.name}' is already gamebanned in this room, which also means they can't host.`);
			} else if (Punishments.hasRoomPunishType(room, userid, `MAFIAHOSTBAN`)) {
				user.sendTo(room, `User '${targetUser.name}' is already hostbanned in this room, but they will now be gamebanned.`);
				this.parse(`/mafia unhostban ${targetUser.name}`);
			}

			if (cmd === 'hostban') {
				Mafia.hostBan(room, targetUser, reason, duration);
			} else {
				Mafia.gameBan(room, targetUser, reason, duration);
			}

			this.modlog(`MAFIA${cmd.toUpperCase()}`, targetUser, reason);
			this.privateModAction(`${targetUser.name} was banned from ${cmd === 'hostban' ? 'hosting' : 'playing'} mafia games by ${user.name}.`);
		},
		hostbanhelp: [
			`/mafia (un)hostban [user], [reason], [duration] - Ban a user from hosting games for [duration] days. Requires % @ # &`,
			`/mafia (un)gameban [user], [reason], [duration] - Ban a user from playing games for [duration] days. Requires % @ # &`,
		],

		ban: 'gamebanhelp',
		banhelp: 'gamebanhelp',
		gamebanhelp() {
			this.parse('/mafia hostbanhelp');
		},

		ungameban: 'unhostban',
		unhostban(target, room, user, connection, cmd) {
			if (!target) return this.parse('/help mafia hostban');
			room = this.requireRoom();
			this.checkCan('warn', null, room);

			const {targetUser} = this.requireUser(target, {allowOffline: true});
			if (!Mafia.isGameBanned(room, targetUser) && cmd === 'ungameban') {
				return this.errorReply(`User '${targetUser.name}' isn't banned from playing mafia games.`);
			} else if (!Mafia.isHostBanned(room, targetUser) && cmd === 'unhostban') {
				return this.errorReply(`User '${targetUser.name}' isn't banned from hosting mafia games.`);
			}

			if (cmd === 'unhostban') Mafia.unhostBan(room, targetUser);
			else Mafia.ungameBan(room, targetUser);

			this.privateModAction(`${targetUser.name} was unbanned from ${cmd === 'unhostban' ? 'hosting' : 'playing'} mafia games by ${user.name}.`);
			this.modlog(`MAFIA${cmd.toUpperCase()}`, targetUser, null, {noip: 1, noalts: 1});
		},

		overwriterole: 'addrole',
		addrole(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);
			const overwrite = cmd === 'overwriterole';

			const [name, alignment, image, ...memo] = target.split('|').map(e => e.trim());
			const id = toID(name);

			if (!id || !memo.length) return this.parse(`/help mafia addrole`);

			if (alignment && !(alignment in MafiaData.alignments)) return this.errorReply(`${alignment} is not a valid alignment.`);
			if (image && !VALID_IMAGES.includes(image)) return this.errorReply(`${image} is not a valid image.`);

			if (!overwrite && id in MafiaData.roles) {
				return this.errorReply(`${name} is already a role. Use /mafia overwriterole to overwrite.`);
			}
			if (id in MafiaData.alignments) return this.errorReply(`${name} is already an alignment.`);
			if (id in MafiaData.aliases) {
				return this.errorReply(`${name} is already an alias (pointing to ${MafiaData.aliases[id]}).`);
			}

			const role: MafiaDataRole = {name, memo};
			if (alignment) role.alignment = alignment;
			if (image) role.image = image;

			MafiaData.roles[id] = role;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDROLE`, null, id, {noalts: true, noip: true});
			this.sendReply(`The role ${id} was added to the database.`);
		},
		addrolehelp: [
			`/mafia addrole name|alignment|image|memo1|memo2... - adds a role to the database. Name, memo are required. Requires % @ # &`,
		],

		overwritealignment: 'addalignment',
		addalignment(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);
			const overwrite = cmd === 'overwritealignment';

			const [name, plural, color, buttonColor, image, ...memo] = target.split('|').map(e => e.trim());
			const id = toID(name);

			if (!id || !plural || !memo.length) return this.parse(`/help mafia addalignment`);

			if (image && !VALID_IMAGES.includes(image)) return this.errorReply(`${image} is not a valid image.`);

			if (!overwrite && id in MafiaData.alignments) {
				return this.errorReply(`${name} is already an alignment. Use /mafia overwritealignment to overwrite.`);
			}
			if (id in MafiaData.roles) return this.errorReply(`${name} is already a role.`);
			if (id in MafiaData.aliases) {
				return this.errorReply(`${name} is already an alias (pointing to ${MafiaData.aliases[id]})`);
			}

			const alignment: MafiaDataAlignment = {name, plural, memo};
			if (color) alignment.color = color;
			if (buttonColor) alignment.buttonColor = buttonColor;
			if (image) alignment.image = image;

			MafiaData.alignments[id] = alignment;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDALIGNMENT`, null, id, {noalts: true, noip: true});
			this.sendReply(`The alignment ${id} was added to the database.`);
		},
		addalignmenthelp: [
			`/mafia addalignment name|plural|color|button color|image|memo1|memo2... - adds a memo to the database. Name, plural, memo are required. Requires % @ # &`,
		],

		overwritetheme: 'addtheme',
		addtheme(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);
			const overwrite = cmd === 'overwritetheme';

			const [name, desc, ...rolelists] = target.split('|').map(e => e.trim());
			const id = toID(name);

			if (!id || !desc || !rolelists.length) return this.parse(`/help mafia addtheme`);

			if (!overwrite && id in MafiaData.themes) {
				return this.errorReply(`${name} is already a theme. Use /mafia overwritetheme to overwrite.`);
			}
			if (id in MafiaData.IDEAs) return this.errorReply(`${name} is already an IDEA.`);
			if (id in MafiaData.aliases) {
				return this.errorReply(`${name} is already an alias (pointing to ${MafiaData.aliases[id]})`);
			}

			const rolelistsMap: {[players: number]: string} = {};
			const uniqueRoles = new Set<string>();

			for (const rolelist of rolelists) {
				const [players, roles] = Utils.splitFirst(rolelist, ':', 2).map(e => e.trim());
				const playersNum = parseInt(players);

				for (const role of roles.split(',')) {
					uniqueRoles.add(role.trim());
				}
				rolelistsMap[playersNum] = roles;
			}
			const problems = [];
			for (const role of uniqueRoles) {
				const parsedRole = Mafia.parseRole(role);
				if (parsedRole.problems.length) problems.push(...parsedRole.problems);
			}
			if (problems.length) return this.errorReply(`Problems found when parsing roles:\n${problems.join('\n')}`);

			const theme: MafiaDataTheme = {name, desc, ...rolelistsMap};
			MafiaData.themes[id] = theme;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDTHEME`, null, id, {noalts: true, noip: true});
			this.sendReply(`The theme ${id} was added to the database.`);
		},
		addthemehelp: [
			`/mafia addtheme name|description|players:rolelist|players:rolelist... - adds a theme to the database. Requires % @ # &`,
		],

		overwriteidea: 'addidea',
		addidea(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);
			const overwrite = cmd === 'overwriteidea';

			let [meta, ...roles] = target.split('\n');
			roles = roles.map(e => e.trim());
			if (!meta || !roles.length) return this.parse(`/help mafia addidea`);
			const [name, choicesStr, ...picks] = meta.split('|');
			const id = toID(name);
			const choices = parseInt(choicesStr);

			if (!id || !choices || !picks.length) return this.parse(`/help mafia addidea`);
			if (choices <= picks.length) return this.errorReply(`You need to have more choices than picks.`);

			if (!overwrite && id in MafiaData.IDEAs) {
				return this.errorReply(`${name} is already an IDEA. Use /mafia overwriteidea to overwrite.`);
			}
			if (id in MafiaData.themes) return this.errorReply(`${name} is already a theme.`);
			if (id in MafiaData.aliases) {
				return this.errorReply(`${name} is already an alias (pointing to ${MafiaData.aliases[id]})`);
			}

			const checkedRoles: string[] = [];
			const problems = [];
			for (const role of roles) {
				if (checkedRoles.includes(role)) continue;
				const parsedRole = Mafia.parseRole(role);
				if (parsedRole.problems.length) problems.push(...parsedRole.problems);
				checkedRoles.push(role);
			}
			if (problems.length) return this.errorReply(`Problems found when parsing roles:\n${problems.join('\n')}`);

			const IDEA: MafiaDataIDEA = {name, choices, picks, roles};
			MafiaData.IDEAs[id] = IDEA;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDIDEA`, null, id, {noalts: true, noip: true});
			this.sendReply(`The IDEA ${id} was added to the database.`);
		},
		addideahelp: [
			`/mafia addidea name|choices (number)|pick1|pick2... (new line here)`,
			`(newline separated rolelist) - Adds an IDEA to the database. Requires % @ # &`,
		],

		overwriteterm: 'addterm',
		addterm(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);
			const overwrite = cmd === 'overwriteterm';

			const [name, ...memo] = target.split('|').map(e => e.trim());
			const id = toID(name);
			if (!id || !memo.length) return this.parse(`/help mafia addterm`);

			if (!overwrite && id in MafiaData.terms) {
				return this.errorReply(`${name} is already a term. Use /mafia overwriteterm to overwrite.`);
			}
			if (id in MafiaData.aliases) {
				return this.errorReply(`${name} is already an alias (pointing to ${MafiaData.aliases[id]})`);
			}

			const term: MafiaDataTerm = {name, memo};
			MafiaData.terms[id] = term;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDTERM`, null, id, {noalts: true, noip: true});
			this.sendReply(`The term ${id} was added to the database.`);
		},
		addtermhelp: [`/mafia addterm name|memo1|memo2... - Adds a term to the database. Requires % @ # &`],

		overwritealias: 'addalias',
		addalias(target, room, user, connection, cmd) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);

			const [from, to] = target.split(',').map(toID);
			if (!from || !to) return this.parse(`/help mafia addalias`);

			if (from in MafiaData.aliases) {
				return this.errorReply(`${from} is already an alias (pointing to ${MafiaData.aliases[from]})`);
			}
			let foundTarget = false;
			for (const entry of ['alignments', 'roles', 'themes', 'IDEAs', 'terms'] as (keyof MafiaData)[]) {
				const dataEntry = MafiaData[entry];
				if (from in dataEntry) return this.errorReply(`${from} is already a ${entry.slice(0, -1)}`);
				if (to in dataEntry) foundTarget = true;
			}
			if (!foundTarget) return this.errorReply(`No database entry exists with the key ${to}.`);

			MafiaData.aliases[from] = to;
			writeFile(DATA_FILE, MafiaData);
			this.modlog(`MAFIAADDALIAS`, null, `${from}: ${to}`, {noalts: true, noip: true});
			this.sendReply(`The alias ${from} was added, pointing to ${to}.`);
		},
		addaliashelp: [
			`/mafia addalias from,to - Adds an alias to the database, redirecting (from) to (to). Requires % @ # &`,
		],

		deletedata(target, room, user) {
			room = this.requireRoom('mafia' as RoomID);
			this.checkCan('mute', null, room);

			let [source, entry] = target.split(',');
			entry = toID(entry);
			if (!(source in MafiaData)) {
				return this.errorReply(`Invalid source. Valid sources are ${Object.keys(MafiaData).join(', ')}`);
			}
			// @ts-ignore checked above
			const dataSource = MafiaData[source];
			if (!(entry in dataSource)) return this.errorReply(`${entry} does not exist in ${source}.`);

			let buf = '';
			if (dataSource === MafiaData.alignments) {
				if (entry === 'solo' || entry === 'town') return this.errorReply(`You cannot delete the solo or town alignments.`);

				for (const key in MafiaData.roles) {
					if (MafiaData.roles[key].alignment === entry) {
						buf += `Removed alignment of role ${key}.`;
						delete MafiaData.roles[key].alignment;
					}
				}
			}

			if (dataSource !== MafiaData.aliases) {
				// remove any aliases
				for (const key in MafiaData.aliases) {
					if (MafiaData.aliases[key] === entry) {
						buf += `Removed alias ${key}`;
						delete MafiaData.aliases[key];
					}
				}
			}
			delete dataSource[entry];

			writeFile(DATA_FILE, MafiaData);
			if (buf) this.sendReply(buf);
			this.modlog(`MAFIADELETEDATA`, null, `${entry} from ${source}`, {noalts: true, noip: true});
			this.sendReply(`The entry ${entry} was deleted from the ${source} database.`);
		},
		deletedatahelp: [`/mafia deletedata source,entry - Removes an entry from the database. Requires % @ # &`],
		listdata(target, room, user) {
			if (!(target in MafiaData)) {
				return this.errorReply(`Invalid source. Valid sources are ${Object.keys(MafiaData).join(', ')}`);
			}
			const dataSource = MafiaData[target as keyof MafiaData];
			if (dataSource === MafiaData.aliases) {
				const aliases = Object.entries(MafiaData.aliases)
					.map(([from, to]) => `${from}: ${to}`)
					.join('<br/>');
				return this.sendReplyBox(`Mafia aliases:<br/>${aliases}`);
			} else {
				const entries = Object.entries(dataSource)
					.map(([key, data]) => `<button class="button" name="send" value="/mafia dt ${key}">${data.name}</button>`)
					.join('');
				return this.sendReplyBox(`Mafia ${target}:<br/>${entries}`);
			}
		},

		disable(target, room, user) {
			room = this.requireRoom();
			this.checkCan('gamemanagement', null, room);
			if (room.settings.mafiaDisabled) {
				return this.errorReply("Mafia is already disabled.");
			}
			room.settings.mafiaDisabled = true;
			room.saveSettings();
			this.modlog('MAFIADISABLE', null);
			return this.sendReply("Mafia has been disabled for this room.");
		},
		disablehelp: [`/mafia disable - Disables mafia in this room. Requires # &`],

		enable(target, room, user) {
			room = this.requireRoom();
			this.checkCan('gamemanagement', null, room);
			if (!room.settings.mafiaDisabled) {
				return this.errorReply("Mafia is already enabled.");
			}
			room.settings.mafiaDisabled = false;
			room.saveSettings();
			this.modlog('MAFIAENABLE', null);
			return this.sendReply("Mafia has been enabled for this room.");
		},
		enablehelp: [`/mafia enable - Enables mafia in this room. Requires # &`],
	},
	mafiahelp(target, room, user) {
		if (!this.runBroadcast()) return;
		let buf = `<strong>Commands for the Mafia Plugin</strong><br/>Most commands are used through buttons in the game screen.<br/><br/>`;
		buf += `<details><summary class="button">General Commands</summary>`;
		buf += [
			`<br/><strong>General Commands for the Mafia Plugin</strong>:<br/>`,
			`/mafia host [user] - Create a game of Mafia with [user] as the host. Roomvoices can only host themselves. Requires + % @ # &`,
			`/mafia nexthost - Host the next user in the host queue. Only works in the Mafia Room. Requires + % @ # &`,
			`/mafia forcehost [user] - Bypass the host queue and host [user]. Only works in the Mafia Room. Requires % @ # &`,
			`/mafia sub [in|out] - Request to sub into the game, or cancel a request to sub out.`,
			`/mafia spectate - Spectate the game of mafia.`,
			`/mafia votes - Display the current vote count, and who's voting who.`,
			`/mafia players - Display the current list of players, will highlight players.`,
			`/mafia [rl|orl] - Display the role list or the original role list for the current game.`,
			`/mafia data [alignment|role|modifier|theme|term] - Get information on a mafia alignment, role, modifier, theme, or term.`,
			`/mafia subhost [user] - Substitues the user as the new game host. Requires % @ # &`,
			`/mafia (un)cohost [user] - Adds/removes the user as a cohost. Cohosts can talk during the game, as well as perform host actions. Requires % @ # &`,
			`/mafia [enable|disable] - Enables/disables mafia in this room. Requires # &`,
		].join('<br/>');
		buf += `</details><details><summary class="button">Player Commands</summary>`;
		buf += [
			`<br/><strong>Commands that players can use</strong>:<br/>`,
			`/mafia [join|leave] - Joins/leaves the game. Can only be done while signups are open.`,
			`/mafia vote [player|novote] - Vote the specified player or abstain from voting.`,
			`/mafia unvote - Withdraw your vote. Fails if you're not voting anyone`,
			`/mafia deadline - View the deadline for the current game.`,
			`/mafia sub in - Request to sub into the game, or cancel a request to sub out.`,
			`/mafia sub out - Request to sub out of the game, or cancel a request to sub in.`,
			`/mafia idle - Tells the host if you are idling.`,
			`/mafia action [details] - Tells the host you are using an action with the given submission details.`,
		].join('<br/>');
		buf += `</details><details><summary class="button">Host Commands</summary>`;
		buf += [
			`<br/><strong>Commands for game hosts and Cohosts to use</strong>:<br/>`,
			`/mafia playercap [cap|none]- Limit the number of players able to join the game. Player cap cannot be more than 20 or less than 2. Requires host % @ # &`,
			`/mafia close - Closes signups for the current game. Requires host % @ # &`,
			`/mafia closedsetup [on|off] - Sets if the game is a closed setup. Closed setups don't show the role list to players. Requires host % @ # &`,
			`/mafia takeidles [on|off] - Sets if idles are accepted by the script or not. Requires host % @ # &`,
			`/mafia prod - Notifies players that they must submit an action or idle if they haven't yet. Requires host % @ # &`,
			`/mafia reveal [on|off] - Sets if roles reveal on death or not. Requires host % @ # &`,
			`/mafia selfvote [on|hammer|off] - Allows players to self vote either at hammer or anytime. Requires host % @ # &`,
			`/mafia [enablenl|disablenl] - Allows or disallows players abstain from voting. Requires host % @ # &`,
			`/mafia votelock [on|off] - Allows or disallows players to change their vote. Requires host % @ # &`,
			`/mafia voting [on|off] - Allows or disallows voting. Requires host % @ # &`,
			`/mafia forcevote [yes/no] - Forces players' votes onto themselves, and prevents unvoting. Requires host % @ # &`,
			`/mafia setroles [comma seperated roles] - Set the roles for a game of mafia. You need to provide one role per player. Requires host % @ # &`,
			`/mafia forcesetroles [comma seperated roles] - Forcibly set the roles for a game of mafia. No role PM information or alignment will be set. Requires host % @ # &`,
			`/mafia start - Start the game of mafia. Signups must be closed. Requires host % @ # &`,
			`/mafia [day|night] - Move to the next game day or night. Requires host % @ # &`,
			`/mafia extend (minutes) - Return to the previous game day. If (minutes) is provided, set the deadline for (minutes) minutes. Requires host % @ # &`,
			`/mafia kill [player] - Kill a player, eliminating them from the game. Requires host % @ # &`,
			`/mafia treestump [player] - Kills a player, but allows them to talk during the day still. Requires host % @ # &`,
			`/mafia spirit [player] - Kills a player, but allows them to vote still. Requires host % @ # &`,
			`/mafia spiritstump [player] - Kills a player, but allows them to talk and vote during the day. Requires host % @ # &`,
			`/mafia kick [player] - Kicks a player from the game without revealing their role. Requires host % @ # &`,
			`/mafia revive [player] - Revive a player who died or add a new player to the game. Requires host % @ # &`,
			`/mafia revealrole [player] - Reveals the role of a player. Requires host % @ # &`,
			`/mafia revealas [player], [role] - Fakereveals the role of a player as a certain role. Requires host % @ # &`,
			`/mafia (un)silence [player] - Silences [player], preventing them from talking at all. Requires host % @ # &`,
			`/mafia (un)nighttalk [player] - Allows [player] to talk freely during the night. Requires host % @ # &`,
			`/mafia (un)[priest|actor] [player] - Makes [player] a priest (can't hammer) or actor (can only hammer). Requires host % @ # &`,
			`/mafia deadline [minutes|off] - Sets or removes the deadline for the game. Cannot be more than 20 minutes.`,
			`/mafia sub next, [player] - Forcibly sub [player] out of the game. Requires host % @ # &`,
			`/mafia sub remove, [user] - Forcibly remove [user] from the sublist. Requres host % @ # &`,
			`/mafia sub unrequest, [player] - Remove's a player's request to sub out of the game. Requires host % @ # &`,
			`/mafia sub [player], [user] - Forcibly sub [player] for [user]. Requires host % @ # &`,
			`/mafia autosub [yes|no] - Sets if players will automatically sub out if a user is on the sublist. Defaults to yes. Requires host % @ # &`,
			`/mafia (un)[love|hate] [player] - Makes it take 1 more (love) or less (hate) vote to hammer [player]. Requires host % @ # &`,
			`/mafia (un)[mayor|voteless] [player] - Makes [player]'s' vote worth 2 votes (mayor) or makes [player]'s vote worth 0 votes (voteless). Requires host % @ # &`,
			`/mafia hammer [hammer] - sets the hammer count to [hammer] and resets votes`,
			`/mafia hammer off - disables hammering`,
			`/mafia shifthammer [hammer] - sets the hammer count to [hammer] without resetting votes`,
			`/mafia resethammer - sets the hammer to the default, resetting votes`,
			`/mafia playerroles - View all the player's roles in chat. Requires host`,
			`/mafia resetgame - Resets game data. Does not change settings from the host besides deadlines or add/remove any players. Requires host % @ # &`,
			`/mafia end - End the current game of mafia. Requires host + % @ # &`,
		].join('<br/>');
		buf += `</details><details><summary class="button">IDEA Module Commands</summary>`;
		buf += [
			`<br/><strong>Commands for using IDEA modules</strong><br/>`,
			`/mafia idea [idea] - starts the IDEA module [idea]. Requires + % @ # &, voices can only start for themselves`,
			`/mafia ideareroll - rerolls the IDEA module. Requires host % @ # &`,
			`/mafia ideapick [selection], [role] - selects a role`,
			`/mafia ideadiscards - shows the discarded roles`,
			`/mafia ideadiscards [off|on] - hides discards from the players. Requires host % @ # &`,
			`/mafia customidea choices, picks (new line here, shift+enter)`,
			`(comma or newline separated rolelist) - Starts an IDEA module with custom roles. Requires % @ # &`,
		].join('<br/>');
		buf += `</details>`;
		buf += `</details><details><summary class="button">Mafia Room Specific Commands</summary>`;
		buf += [
			`<br/><strong>Commands that are only useable in the Mafia Room</strong>:<br/>`,
			`/mafia queue add, [user] - Adds the user to the host queue. Requires + % @ # &, voices can only add themselves.`,
			`/mafia queue remove, [user] - Removes the user from the queue. You can remove yourself regardless of rank. Requires % @ # &.`,
			`/mafia queue - Shows the list of users who are in queue to host.`,
			`/mafia win (points) [user1], [user2], [user3], ... - Award the specified users points to the mafia leaderboard for this month. The amount of points can be negative to take points. Defaults to 10 points.`,
			`/mafia winfaction (points), [faction] - Award the specified points to all the players in the given faction. Requires % @ # &`,
			`/mafia (un)mvp [user1], [user2], ... - Gives a MVP point and 10 leaderboard points to the users specified.`,
			`/mafia [leaderboard|mvpladder] - View the leaderboard or MVP ladder for the current or last month.`,
			`/mafia [hostlogs|playlogs] - View the host logs or play logs for the current or last month. Requires % @ # &`,
			`/mafia (un)hostban [user], [duration] - Ban a user from hosting games for [duration] days. Requires % @ # &`,
			`/mafia (un)gameban [user], [duration] - Ban a user from playing games for [duration] days. Requires % @ # &`,
		].join('<br/>');
		buf += `</details>`;

		return this.sendReplyBox(buf);
	},
};

export const roomSettings: Chat.SettingsHandler = room => ({
	label: "Mafia",
	permission: 'editroom',
	options: [
		[`disabled`, room.settings.mafiaDisabled || 'mafia disable'],
		[`enabled`, !room.settings.mafiaDisabled || 'mafia enable'],
	],
});

process.nextTick(() => {
	Chat.multiLinePattern.register('/mafia (custom|add|overwrite)idea');
});
