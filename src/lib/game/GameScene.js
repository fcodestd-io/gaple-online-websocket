import Phaser from 'phaser';
import { TILES } from '../shared/gaple-engine.js';

const W = 1280, H = 720;
const BOARD_SCALE = 0.8; // kartu di papan: 102 x 51
const BOARD_AVAIL = 900; // lebar maksimal satu baris papan
const ROW_GAP = 84;
const BOARD_CY = 330;
const HAND_Y = 634;
const FONT = 'Georgia, "Times New Roman", serif';

const PANEL = {
	bottom: { x: 130, y: 652 },
	top: { x: 640, y: 52 },
	left: { x: 112, y: 52 },
	right: { x: 1168, y: 52 }
};

/** Posisi duduk relatif terhadap pemain (searah jarum jam). */
function sideFor(n, rel) {
	if (rel === 0) return 'bottom';
	if (n === 2) return 'top';
	if (n === 3) return rel === 1 ? 'left' : 'right';
	return rel === 1 ? 'left' : rel === 2 ? 'top' : 'right';
}

export default class GameScene extends Phaser.Scene {
	constructor() { super('Game'); }

	init(data) {
		this.ctrl = data.controller;
		this.view = null;
		this.selected = null;
		this.lastPlay = null;
		this.animTile = null;
		this.unsub = [];
		this.renderTweens = [];
	}

	preload() {
		const loading = this.add.text(W / 2, H / 2, 'Memuat…', { fontFamily: FONT, fontSize: '28px', color: '#f6edd8' }).setOrigin(0.5);
		this.load.on('progress', (p) => loading.setText(`Memuat… ${Math.round(p * 100)}%`));
		this.load.setPath('/assets/images/');
		['table', 'tile_back', 'tile_glow', 'end_marker', 'icon_sound', 'icon_mute',
			'avatar_1', 'avatar_2', 'avatar_3', 'avatar_4', 'avatar_com'].forEach((k) => this.load.image(k, `${k}.png`));
		for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) this.load.image(`t_${a}_${b}`, `tiles/t_${a}_${b}.png`);
		this.load.setPath('/assets/audio/');
		['place', 'pass', 'click', 'deal', 'turn', 'win', 'lose'].forEach((k) => this.load.audio('sfx_' + k, `${k}.wav`));
		this.load.audio('bgm', 'bgm.mp3');
	}

	create() {
		this.add.image(W / 2, H / 2, 'table');
		this.boardLayer = this.add.container(0, 0);
		this.oppLayer = this.add.container(0, 0);
		this.handLayer = this.add.container(0, 0);
		this.hudLayer = this.add.container(0, 0);

		this.toast = this.add.text(W / 2, 505, '', {
			fontFamily: FONT, fontSize: '26px', color: '#fff3c4', backgroundColor: '#06251bcc', padding: { x: 18, y: 8 }
		}).setOrigin(0.5).setAlpha(0).setDepth(50);

		this.muteBtn = this.add.image(1236, 676, this.sound.mute ? 'icon_mute' : 'icon_sound')
			.setScale(0.8).setDepth(60).setInteractive({ useHandCursor: true });
		this.muteBtn.on('pointerdown', () => {
			this.sound.mute = !this.sound.mute;
			this.muteBtn.setTexture(this.sound.mute ? 'icon_mute' : 'icon_sound');
		});

		if (this.cache.audio.exists('bgm')) {
			this.bgm = this.sound.add('bgm', { loop: true, volume: 0.2 });
			this.bgm.play();
		}

		// klik area kosong = batalkan pilihan kartu
		this.input.on('pointerdown', (_p, over) => {
			if (this.selected !== null && over.length === 0) { this.selected = null; this.render(); }
		});

		this.unsub.push(
			this.ctrl.on('view', (v) => this.applyView(v)),
			this.ctrl.on('events', (e) => this.handleEvents(e))
		);
		const cleanup = () => { this.unsub.forEach((f) => f()); this.unsub = []; };
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
		this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

		if (this.ctrl.lastView) {
			this.applyView(this.ctrl.lastView, true);
			if (!this.ctrl.lastView.chain.length) this.sfx('deal');
		}
	}

	// ------------------------------------------------------------------ data masuk
	sfx(name, volume = 0.8) {
		try { this.sound.play('sfx_' + name, { volume }); } catch { /* audio belum aktif */ }
	}

	isMyTurn() {
		const v = this.view;
		return !!v && v.phase === 'playing' && v.turn === v.mySeat;
	}

	handleEvents(events) {
		const v = this.view;
		for (const e of events) {
			if (e.type === 'deal') this.sfx('deal');
			else if (e.type === 'play') { this.sfx('place'); this.lastPlay = { seat: e.seat, end: e.end }; }
			else if (e.type === 'pass') {
				this.sfx('pass');
				const mine = v && e.seat === v.mySeat;
				this.showToast(mine ? 'Kamu lewat (tidak ada kartu cocok)' : `${v?.players[e.seat]?.name ?? 'Pemain'} lewat`);
			} else if (e.type === 'round_end') {
				this.time.delayedCall(350, () => this.sfx(e.winner === null ? 'pass' : e.winner === (this.view?.mySeat) ? 'win' : 'lose'));
			}
		}
	}

	applyView(v, initial = false) {
		const prev = this.view;
		this.view = v;
		if (prev && prev.turn !== v.turn && v.phase === 'playing' && v.turn === v.mySeat) this.sfx('turn', 0.6);
		if (!this.isMyTurn()) this.selected = null;
		this.animTile = prev && v.chain.length > prev.chain.length ? this.lastPlay : null;
		if (initial) this.animTile = null;
		this.render();
	}

	showToast(text) {
		this.toast.setText(text).setAlpha(1);
		this.tweens.killTweensOf(this.toast);
		this.tweens.add({ targets: this.toast, alpha: 0, delay: 1300, duration: 500 });
	}

	// ------------------------------------------------------------------ gambar
	tween(cfg) {
		const t = this.tweens.add(cfg);
		this.renderTweens.push(t);
		return t;
	}

	render() {
		if (!this.view) return;
		this.renderTweens.forEach((t) => t.stop());
		this.renderTweens = [];
		[this.boardLayer, this.oppLayer, this.handLayer, this.hudLayer].forEach((l) => l.removeAll(true));
		this.drawBoard();
		this.drawOpponents();
		this.drawHand();
		this.drawStatus();
	}

	makeTile(x, y, p, q, scale) {
		const lo = Math.min(p, q), hi = Math.max(p, q);
		const img = this.add.image(x, y, `t_${lo}_${hi}`).setScale(scale);
		if (p === q) img.setRotation(Math.PI / 2); // balak tegak
		else if (p > q) img.setRotation(Math.PI);
		return img;
	}

	seatAnchor(seat) {
		const v = this.view;
		const rel = (seat - v.mySeat + v.n) % v.n;
		return rel === 0 ? { x: W / 2, y: HAND_Y } : PANEL[sideFor(v.n, rel)];
	}

	drawBoard() {
		const v = this.view;
		const chain = v.chain;
		this.endBadges = {};
		if (!chain.length) return;

		const items = chain.map((c) => ({ c, w: (c.p === c.q ? 64 : 128) * BOARD_SCALE }));
		const rows = [];
		let cur = [], curW = 0;
		for (const it of items) {
			if (cur.length && curW + it.w > BOARD_AVAIL) { rows.push({ items: cur, w: curW }); cur = []; curW = 0; }
			cur.push(it); curW += it.w;
		}
		rows.push({ items: cur, w: curW });
		const y0 = BOARD_CY - ((rows.length - 1) * ROW_GAP) / 2;
		rows.forEach((row, ri) => {
			let x = W / 2 - row.w / 2;
			row.items.forEach((it) => { it.x = x + it.w / 2; it.y = y0 + ri * ROW_GAP; x += it.w; });
		});

		items.forEach((it, idx) => {
			const img = this.makeTile(it.x, it.y, it.c.p, it.c.q, BOARD_SCALE);
			this.boardLayer.add(img);
			const a = this.animTile;
			const isNew = a && (chain.length === 1 || (a.end === 'left' && idx === 0) || (a.end === 'right' && idx === items.length - 1));
			if (isNew) {
				const from = this.seatAnchor(a.seat);
				img.setPosition(from.x, from.y).setScale(BOARD_SCALE * 0.6).setAlpha(0.5);
				this.tween({ targets: img, x: it.x, y: it.y, scale: BOARD_SCALE, alpha: 1, duration: 260, ease: 'Cubic.easeOut' });
			}
		});

		// penanda ujung papan
		const first = items[0], last = items[items.length - 1];
		const sel = this.selected;
		const selSides = sel === null ? [] : v.legal.filter((m) => m.tileId === sel).map((m) => m.end);
		[['left', first.x - first.w / 2 - 36, first.y, v.left], ['right', last.x + last.w / 2 + 36, last.y, v.right]].forEach(([side, x, y, val]) => {
			const ring = this.add.image(x, y, 'end_marker').setScale(0.82);
			const num = this.add.text(x, y, String(val), { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: '#fff3c4' }).setOrigin(0.5);
			this.boardLayer.add([ring, num]);
			if (selSides.includes(side)) {
				ring.setTint(0xffe28a).setInteractive({ useHandCursor: true });
				ring.on('pointerdown', () => this.commit(sel, side));
				this.tween({ targets: ring, scale: 1.05, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
			}
		});
	}

	drawHand() {
		const v = this.view;
		const hand = v.players[v.mySeat].hand || [];
		const legalIds = new Set(v.legal.map((m) => m.tileId));
		const myTurn = this.isMyTurn();
		const gap = 84;
		const x0 = W / 2 - ((hand.length - 1) * gap) / 2;
		hand.forEach((id, i) => {
			const t = TILES[id];
			const x = x0 + i * gap;
			const lift = this.selected === id ? -26 : 0;
			const legal = myTurn && legalIds.has(id);
			let glow = null;
			if (legal) {
				glow = this.add.image(x, HAND_Y + lift, 'tile_glow').setRotation(Math.PI / 2).setAlpha(0.9);
				this.handLayer.add(glow);
				this.tween({ targets: glow, alpha: 0.45, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
			}
			const img = this.add.image(x, HAND_Y + lift, `t_${t.a}_${t.b}`).setRotation(Math.PI / 2);
			if (myTurn && !legal) img.setTint(0x7b7b7b);
			this.handLayer.add(img);
			if (legal) {
				img.setInteractive({ useHandCursor: true });
				img.on('pointerover', () => { if (this.selected !== id) { img.y = HAND_Y - 12; glow && (glow.y = HAND_Y - 12); } });
				img.on('pointerout', () => { if (this.selected !== id) { img.y = HAND_Y; glow && (glow.y = HAND_Y); } });
				img.on('pointerdown', () => this.onTileClick(id));
			}
		});
	}

	onTileClick(id) {
		const v = this.view;
		const moves = v.legal.filter((m) => m.tileId === id);
		if (!moves.length) return;
		// satu pilihan, atau kedua ujung angkanya sama: langsung main
		if (moves.length === 1) return this.commit(id, moves[0].end);
		if (v.left === v.right) return this.commit(id, 'right');
		this.sfx('click', 0.6);
		this.selected = this.selected === id ? null : id;
		this.render();
	}

	commit(id, end) {
		this.selected = null;
		this.ctrl.play(id, end);
	}

	drawOpponents() {
		const v = this.view;
		for (let seat = 0; seat < v.n; seat++) {
			const rel = (seat - v.mySeat + v.n) % v.n;
			const side = sideFor(v.n, rel);
			const p = v.players[seat];
			this.drawPanel(seat, PANEL[side]);
			if (rel === 0) continue;
			const open = !!p.hand; // akhir ronde: kartu lawan dibuka
			const tiles = open ? p.hand : Array.from({ length: p.count });
			const cnt = tiles.length;
			tiles.forEach((id, i) => {
				let img;
				if (side === 'top') {
					const sp = open ? 68 : 34;
					const x = W / 2 - ((cnt - 1) * sp) / 2 + i * sp;
					img = open ? this.add.image(x, 122, `t_${TILES[id].a}_${TILES[id].b}`).setScale(0.5) : this.add.image(x, 112, 'tile_back').setScale(0.45);
				} else {
					const sp = open ? 42 : 29;
					const x = side === 'left' ? 60 : 1220;
					const y = 132 + i * sp;
					img = open ? this.add.image(x, y, `t_${TILES[id].a}_${TILES[id].b}`).setScale(0.5) : this.add.image(x, y, 'tile_back').setScale(0.4);
					img.setRotation(Math.PI / 2);
				}
				this.oppLayer.add(img);
			});
		}
	}

	drawPanel(seat, pos) {
		const v = this.view, p = v.players[seat];
		const active = v.phase === 'playing' && v.turn === seat;
		const g = this.add.graphics();
		g.fillStyle(0x06251b, 0.82).fillRoundedRect(pos.x - 95, pos.y - 32, 190, 64, 16);
		g.lineStyle(active ? 3 : 1.5, active ? 0xf3c34d : 0x2e6b55, 1).strokeRoundedRect(pos.x - 95, pos.y - 32, 190, 64, 16);
		const av = this.add.image(pos.x - 62, pos.y, p.bot ? 'avatar_com' : `avatar_${(seat % 4) + 1}`).setDisplaySize(48, 48);
		const name = seat === v.mySeat ? `${p.name} (kamu)` : p.name;
		const nm = this.add.text(pos.x - 32, pos.y - 21, name.length > 14 ? name.slice(0, 13) + '…' : name, { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#f6edd8' });
		const sc = this.add.text(pos.x - 32, pos.y + 3, `Skor ${p.score}${p.bot ? (p.connected ? ' · COM' : ' · diganti COM') : (p.connected === false ? ' · terputus' : '')}`, { fontFamily: FONT, fontSize: '15px', color: active ? '#f3c34d' : '#a9d3c2' });
		this.hudLayer.add([g, av, nm, sc]);
		if (active) this.tween({ targets: g, alpha: 0.6, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
	}

	drawStatus() {
		const v = this.view;
		let msg;
		if (v.phase === 'roundover') msg = `Ronde ${v.round} selesai`;
		else if (this.isMyTurn()) {
			if (!v.chain.length) { const t = TILES[v.legal[0].tileId]; msg = `Kamu jalan duluan: mainkan ${t.a}-${t.b}`; }
			else if (this.selected !== null) msg = 'Pilih ujung papan (lingkaran emas)';
			else msg = 'Giliranmu: pilih kartu yang menyala';
		} else msg = `Giliran ${v.players[v.turn].name}…`;
		const t = this.add.text(W / 2, 190, msg, { fontFamily: FONT, fontSize: '26px', color: '#f6edd8', stroke: '#06251b', strokeThickness: 5 }).setOrigin(0.5);
		this.hudLayer.add(t);
	}
}
