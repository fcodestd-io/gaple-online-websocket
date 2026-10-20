// Engine Gaple (domino 28 kartu). Dipakai bersama oleh server (online) dan browser (vs COM).
export const TILES = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) TILES.push({ id: TILES.length, a, b });
export const pipSum = (id) => TILES[id].a + TILES[id].b;
const HAND_SIZE = 7;

export class GapleGame {
	/** @param {{name:string, bot?:boolean}[]} players 2-4 pemain */
	constructor(players, { target = 100, rng = Math.random } = {}) {
		this.n = players.length;
		this.rng = rng;
		this.target = target;
		this.players = players.map((p) => ({ name: p.name, bot: !!p.bot, connected: true, score: 0 }));
		this.round = 0;
		this.phase = 'idle'; // idle | playing | roundover
		this.hands = [];
		this.chain = [];
		this.left = null;
		this.right = null;
		this.turn = 0;
		this.passes = 0;
		this.startTile = null;
		this.result = null;
		this.matchWinner = null;
	}

	/** Pulihkan game dari hasil JSON.stringify(game). Dipakai server untuk menyimpan state room di Redis. */
	static fromJSON(data) {
		const g = new GapleGame(data.players.map((p) => ({ name: p.name, bot: p.bot })), { target: data.target });
		return Object.assign(g, data);
	}

	startRound() {
		this.round++;
		const deck = TILES.map((t) => t.id);
		for (let i = deck.length - 1; i > 0; i--) {
			const j = Math.floor(this.rng() * (i + 1));
			[deck[i], deck[j]] = [deck[j], deck[i]];
		}
		this.hands = Array.from({ length: this.n }, (_, i) => deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE).sort((a, b) => a - b));
		this.chain = [];
		this.left = this.right = null;
		this.passes = 0;
		this.result = null;
		this.phase = 'playing';
		// pembuka: pemilik balak tertinggi; kalau tidak ada balak, kartu dengan angka terbesar
		let best = -1, bestScore = -1;
		this.hands.forEach((h, seat) =>
			h.forEach((id) => {
				const t = TILES[id];
				const sc = t.a === t.b ? 100 + t.a : t.a + t.b;
				if (sc > bestScore) { bestScore = sc; best = id; this.turn = seat; }
			})
		);
		this.startTile = best;
		return [{ type: 'deal', round: this.round, starter: this.turn }];
	}

	legalMoves(seat) {
		if (this.phase !== 'playing') return [];
		if (this.chain.length === 0) return seat === this.turn ? [{ tileId: this.startTile, end: 'right' }] : [];
		const out = [];
		for (const id of this.hands[seat]) {
			const t = TILES[id];
			if (t.a === this.left || t.b === this.left) out.push({ tileId: id, end: 'left' });
			if (t.a === this.right || t.b === this.right) out.push({ tileId: id, end: 'right' });
		}
		return out;
	}

	/** @returns {object[]|null} daftar event, atau null kalau langkah tidak sah */
	play(seat, tileId, end) {
		if (this.phase !== 'playing' || seat !== this.turn) return null;
		if (!this.legalMoves(seat).some((m) => m.tileId === tileId && m.end === end)) return null;
		const t = TILES[tileId];
		let p, q;
		if (this.chain.length === 0) {
			p = t.a; q = t.b;
			this.chain.push({ id: tileId, p, q });
			this.left = p; this.right = q;
		} else if (end === 'right') {
			if (t.a === this.right) { p = t.a; q = t.b; } else { p = t.b; q = t.a; }
			this.chain.push({ id: tileId, p, q });
			this.right = q;
		} else {
			if (t.b === this.left) { p = t.a; q = t.b; } else { p = t.b; q = t.a; }
			this.chain.unshift({ id: tileId, p, q });
			this.left = p;
		}
		this.hands[seat] = this.hands[seat].filter((x) => x !== tileId);
		this.passes = 0;
		const events = [{ type: 'play', seat, tileId, end, p, q }];
		if (this.hands[seat].length === 0) { events.push(this._finish('domino', seat)); return events; }
		this._advance(events);
		return events;
	}

	_advance(events) {
		this.turn = (this.turn + 1) % this.n;
		while (this.legalMoves(this.turn).length === 0) {
			events.push({ type: 'pass', seat: this.turn });
			this.passes++;
			if (this.passes >= this.n) { events.push(this._finish('blocked', null)); return; }
			this.turn = (this.turn + 1) % this.n;
		}
	}

	_finish(reason, winnerSeat) {
		const sums = this.hands.map((h) => h.reduce((s, id) => s + pipSum(id), 0));
		let winner = winnerSeat;
		if (reason === 'blocked') {
			const min = Math.min(...sums);
			const lows = sums.map((s, i) => (s === min ? i : -1)).filter((i) => i >= 0);
			winner = lows.length === 1 ? lows[0] : null; // seri: tidak ada poin
		}
		let points = 0;
		if (winner !== null) {
			points = sums.reduce((a, b) => a + b, 0) - sums[winner];
			this.players[winner].score += points;
		}
		this.phase = 'roundover';
		const top = Math.max(...this.players.map((p) => p.score));
		this.matchWinner = top >= this.target ? this.players.findIndex((p) => p.score === top) : null;
		this.result = { reason, winner, points, sums, round: this.round };
		return { type: 'round_end', ...this.result, matchWinner: this.matchWinner };
	}

	nextRound() {
		if (this.phase !== 'roundover') return null;
		if (this.matchWinner !== null) {
			this.players.forEach((p) => (p.score = 0));
			this.matchWinner = null;
			this.round = 0;
		}
		return this.startRound();
	}

	viewFor(seat) {
		const reveal = this.phase === 'roundover';
		return {
			n: this.n,
			mySeat: seat,
			round: this.round,
			phase: this.phase,
			turn: this.turn,
			target: this.target,
			left: this.left,
			right: this.right,
			chain: this.chain.map((c) => ({ id: c.id, p: c.p, q: c.q })),
			players: this.players.map((p, i) => ({
				name: p.name, bot: p.bot, connected: p.connected, score: p.score,
				count: this.hands[i].length,
				hand: reveal || i === seat ? this.hands[i].slice() : undefined
			})),
			legal: this.phase === 'playing' && seat === this.turn ? this.legalMoves(seat) : [],
			result: this.result,
			matchWinner: this.matchWinner
		};
	}
}

/** Pilihan langkah COM: buang angka besar, simpan kartu yang masih bisa nyambung. */
export function botMove(game, seat) {
	const moves = game.legalMoves(seat);
	if (!moves.length) return null;
	let best = null, bestScore = -Infinity;
	for (const m of moves) {
		const t = TILES[m.tileId];
		let L = game.left, R = game.right;
		if (game.chain.length === 0) { L = t.a; R = t.b; }
		else if (m.end === 'right') R = t.a === R ? t.b : t.a;
		else L = t.b === L ? t.a : t.b;
		const keep = game.hands[seat].filter((id) => {
			if (id === m.tileId) return false;
			const x = TILES[id];
			return x.a === L || x.b === L || x.a === R || x.b === R;
		}).length;
		const score = t.a + t.b + (t.a === t.b ? 2 : 0) + keep * 2.5 + game.rng() * 1.5;
		if (score > bestScore) { bestScore = score; best = m; }
	}
	return best;
}
