import { Emitter } from '../net/emitter.js';
import { GapleGame, botMove } from '../shared/gaple-engine.js';

const BOT_NAMES = ['Budi', 'Siti', 'Joko'];

/** Controller mode vs COM: engine jalan di browser, tanpa server. */
export class LocalController extends Emitter {
	constructor({ name, count }) {
		super();
		this.name = name;
		this.count = count;
		this.isHost = true;
		this.lastView = null;
		this.timer = null;
		this.game = null;
	}
	start() {
		const list = [{ name: this.name, bot: false }];
		for (let i = 1; i < this.count; i++) list.push({ name: BOT_NAMES[i - 1], bot: true });
		this.game = new GapleGame(list);
		this._flush(this.game.startRound());
	}
	_flush(events) {
		this.lastView = this.game.viewFor(0);
		this.emit('events', events);
		this.emit('view', this.lastView);
		this._schedule();
	}
	_schedule() {
		clearTimeout(this.timer);
		const g = this.game;
		if (g.phase !== 'playing' || !g.players[g.turn].bot) return;
		this.timer = setTimeout(() => {
			const m = botMove(g, g.turn);
			if (!m) return;
			const ev = g.play(g.turn, m.tileId, m.end);
			if (ev) this._flush(ev);
		}, 900 + Math.random() * 700);
	}
	play(tileId, end) {
		const ev = this.game?.play(0, tileId, end);
		if (ev) this._flush(ev);
	}
	nextRound() {
		const ev = this.game?.nextRound();
		if (ev) this._flush(ev);
	}
	leave() { this.destroy(); }
	destroy() { clearTimeout(this.timer); }
}
