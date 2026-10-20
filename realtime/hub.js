// Logika room online. Seluruh state room disimpan di store (Redis di produksi), bukan di memori proses,
// karena di Vercel koneksi pemain bisa mendarat di instance function yang berbeda-beda.
//
// Cara kerja singkat:
//  - Tiap perubahan (buat/gabung/main/keluar...) dijalankan di `mutate`: kunci room -> baca -> ubah -> simpan.
//  - Hasilnya dikirim ke pemain di instance ini, lalu di-publish lewat pub/sub supaya instance lain
//    meneruskannya ke pemain mereka.
//  - Pemain dikenali lewat `token` rahasia (bukan lewat objek socket), jadi bisa sambung ulang ke
//    kursi yang sama setelah koneksi putus (mis. karena batas durasi function Vercel).
//  - Pemain yang terputus lebih dari `graceMs` dimainkan sementara oleh COM sampai dia kembali.
import { GapleGame, botMove } from '../src/lib/shared/gaple-engine.js';

export class HubError extends Error {
	constructor(msg, code = 'error') {
		super(msg);
		this.code = code;
	}
}

const MAX_PLAYERS = 4;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I biar tidak salah baca
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const LOCK_TTL_MS = 4000;

const keyOf = (id) => `gaple:room:${id}`;
const lockOf = (id) => `gaple:lock:${id}`;
const chanOf = (id) => `gaple:chan:${id}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const cleanName = (s) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 12) || 'Pemain';
const randomId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const newRoomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function tokenOf(m) {
	const t = String(m.token ?? '');
	if (!TOKEN_RE.test(t)) throw new HubError('Sesi tidak valid. Muat ulang halaman.', 'bad_token');
	return t;
}

// ------------------------------------------------------------------ fungsi murni atas state room
// state = { id, ver, hostToken, slots: [{ token, name, bot, connected, dc, cid, left? }], game }

/** Host = pembuat room kalau sedang terhubung, kalau tidak pemain terhubung pertama. */
export function hostSeat(st) {
	const i = st.slots.findIndex((s) => s.token === st.hostToken);
	if (i >= 0 && !st.slots[i].bot && st.slots[i].connected) return i;
	const j = st.slots.findIndex((s) => !s.bot && s.connected);
	return j >= 0 ? j : i;
}

export function roomInfo(st) {
	return {
		id: st.id,
		max: MAX_PLAYERS,
		started: !!st.game,
		host: hostSeat(st),
		players: st.slots.map((s, seat) => ({ seat, name: s.name, connected: s.connected }))
	};
}

/** Samakan penanda bot/terhubung di dalam game dengan data kursi. */
function syncGame(st) {
	st.game.players.forEach((p, i) => {
		const s = st.slots[i];
		if (!s) return;
		p.bot = !!s.bot;
		p.connected = s.bot ? false : !!s.connected;
	});
}

/** Di lobi, buang kursi pemain yang sudah terputus lebih lama dari masa tunggu. */
function purgeStale(st, graceMs) {
	if (st.game) return;
	const t = Date.now();
	st.slots = st.slots.filter((s) => s.connected || t - s.dc < graceMs);
}

function startGame(st) {
	const g = new GapleGame(st.slots.map((s) => ({ name: s.name, bot: false })));
	st.game = g;
	syncGame(st);
	return g.startRound();
}

// ------------------------------------------------------------------ hub
export class GameHub {
	/**
	 * @param {object} o
	 * @param {import('./store.js').MemoryStore} o.store
	 * @param {number} [o.graceMs]    lama menunggu pemain terputus sebelum COM mengambil gilirannya
	 * @param {number} [o.roomTtlMs]  umur room sejak aktivitas terakhir
	 * @param {[number, number]} [o.botDelay] jeda langkah COM: [dasar, acak] dalam ms
	 */
	constructor({ store, graceMs = 25000, roomTtlMs = 3 * 60 * 60 * 1000, botDelay = [1000, 600] }) {
		this.store = store;
		this.graceMs = graceMs;
		this.roomTtlMs = roomTtlMs;
		this.botDelay = botDelay;
		this.local = new Map(); // roomId -> Set<ws> (hanya socket di instance ini)
		this.busHandlers = new Map(); // roomId -> handler pub/sub
		this.timers = new Map(); // roomId -> timer langkah COM
	}

	onConnection(ws) {
		ws.cid = randomId();
		ws.ctx = null;
	}

	async handle(ws, m) {
		try {
			switch (m.t) {
				case 'ping': return;
				case 'create': return await this._create(ws, m);
				case 'join': return await this._join(ws, m, false);
				case 'resume': return await this._join(ws, m, true);
				case 'start': return await this._action(ws, (st, seat) => {
					if (st.game || hostSeat(st) !== seat) return null;
					if (st.slots.length < 2) throw new HubError('Minimal 2 pemain untuk mulai.');
					return { state: st, events: startGame(st) };
				});
				case 'play': return await this._action(ws, (st, seat) => {
					const ev = st.game?.play(seat, Number(m.tile), m.end === 'left' ? 'left' : 'right');
					return ev ? { state: st, events: ev } : null;
				});
				case 'next': return await this._action(ws, (st, seat) => {
					if (!st.game || hostSeat(st) !== seat) return null;
					const ev = st.game.nextRound();
					return ev ? { state: st, events: ev } : null;
				});
				case 'leave': return await this._leave(ws);
			}
		} catch (e) {
			if (e instanceof HubError) send(ws, { t: 'error', msg: e.message, code: e.code });
			else {
				console.error('[gaple] error:', e);
				send(ws, { t: 'error', msg: 'Terjadi kesalahan di server.', code: 'internal' });
			}
		}
	}

	/** Dipanggil saat socket tertutup: pemain ditandai terputus (kursinya tetap ada). */
	async onClose(ws) {
		const ctx = ws.ctx;
		if (!ctx) return;
		ws.ctx = null;
		this._detach(ws, ctx);
		try {
			const res = await this.mutate(ctx.roomId, (st) => {
				if (!st) return null;
				const s = st.slots.find((x) => x.token === ctx.token);
				if (!s || s.bot || s.cid !== ctx.cid) return null; // sudah diganti koneksi baru
				s.connected = false;
				s.dc = Date.now();
				return { state: st };
			});
			if (res && !res.noop && !res.deleted) await this._afterMutate(ctx.roomId, res);
		} catch (e) {
			console.error('[gaple] onClose:', e);
		}
	}

	// ---------------------------------------------------------------- handler pesan
	async _create(ws, m) {
		if (ws.ctx) throw new HubError('Kamu sudah ada di room.');
		const token = tokenOf(m);
		let st = null;
		for (let i = 0; i < 8 && !st; i++) {
			const id = newRoomCode();
			const cand = {
				id, ver: 1, hostToken: token, game: null,
				slots: [{ token, name: cleanName(m.name), bot: false, connected: true, dc: 0, cid: ws.cid }]
			};
			if (await this.store.setNX(keyOf(id), JSON.stringify(cand), this.roomTtlMs)) st = cand;
		}
		if (!st) throw new HubError('Gagal membuat room, coba lagi.');
		await this._attach(ws, st.id, token);
		this._sendState(ws, st, []);
	}

	async _join(ws, m, resume) {
		if (ws.ctx) {
			if (resume) return;
			throw new HubError('Kamu sudah ada di room.');
		}
		const token = tokenOf(m);
		const id = String(m.room ?? '').trim().toUpperCase();
		const gone = resume ? 'gone' : 'error';
		if (!/^[A-Z0-9]{4}$/.test(id)) throw new HubError('ID room tidak valid.', gone);

		const res = await this.mutate(id, (st) => {
			if (!st) throw new HubError(resume ? 'Room sudah tidak ada.' : 'Room tidak ditemukan. Cek lagi ID-nya.', gone);
			purgeStale(st, this.graceMs);
			const mine = st.slots.find((s) => s.token === token);
			if (mine) {
				if (mine.bot) throw new HubError('Kursimu sudah diambil alih COM.', 'gone');
				mine.connected = true; mine.dc = 0; mine.cid = ws.cid; // sambung ulang ke kursi yang sama
				return { state: st };
			}
			if (resume) throw new HubError('Sesi tidak ditemukan di room ini.', 'gone');
			if (st.game) throw new HubError('Permainan di room ini sudah dimulai.');
			if (st.slots.length >= MAX_PLAYERS) throw new HubError('Room sudah penuh (maks 4 pemain).');
			st.slots.push({ token, name: cleanName(m.name), bot: false, connected: true, dc: 0, cid: ws.cid });
			return { state: st, events: st.slots.length === MAX_PLAYERS ? startGame(st) : [] }; // penuh -> otomatis mulai
		});
		await this._attach(ws, id, token);
		await this._afterMutate(id, res);
	}

	/** Aksi pemain di dalam room. fn(state, seat) mengembalikan {state, events} atau null. */
	async _action(ws, fn) {
		const ctx = ws.ctx;
		if (!ctx) return;
		const res = await this.mutate(ctx.roomId, (st) => {
			if (!st) return null;
			purgeStale(st, this.graceMs);
			const seat = st.slots.findIndex((s) => s.token === ctx.token);
			return seat < 0 ? null : fn(st, seat);
		});
		if (res.noop) {
			if (!res.state) this._kick(ws, 'left');
			return;
		}
		await this._afterMutate(ctx.roomId, res);
	}

	async _leave(ws) {
		const ctx = ws.ctx;
		ws.ctx = null;
		if (!ctx) return send(ws, { t: 'left' });
		this._detach(ws, ctx);
		const res = await this.mutate(ctx.roomId, (st) => {
			if (!st) return null;
			const seat = st.slots.findIndex((s) => s.token === ctx.token);
			if (seat < 0) return null;
			if (!st.game) st.slots.splice(seat, 1); // lobi: kursi dihapus
			else Object.assign(st.slots[seat], { bot: true, connected: false, left: true }); // sedang main: COM ambil alih
			if (!st.slots.some((s) => !s.bot)) return { state: null }; // tidak ada manusia tersisa
			if (st.hostToken === ctx.token) {
				const next = st.slots.find((s) => !s.bot && s.connected) ?? st.slots.find((s) => !s.bot);
				st.hostToken = next.token;
			}
			return { state: st };
		});
		send(ws, { t: 'left' });
		if (res && !res.noop && !res.deleted) await this._afterMutate(ctx.roomId, res);
	}

	// ---------------------------------------------------------------- state bersama
	async _lock(roomId) {
		for (let i = 0; i < 40; i++) {
			const t = await this.store.lock(lockOf(roomId), LOCK_TTL_MS);
			if (t) return t;
			await sleep(40 + Math.random() * 30);
		}
		throw new HubError('Server sedang sibuk, coba lagi.', 'busy');
	}

	/**
	 * Baca-ubah-simpan satu room di bawah kunci. fn(state) mengubah state di tempat dan mengembalikan
	 * {state, events}, {state: null} (hapus room), atau null (tidak ada perubahan).
	 */
	async mutate(roomId, fn) {
		const lock = await this._lock(roomId);
		try {
			const raw = await this.store.get(keyOf(roomId));
			const st = raw ? JSON.parse(raw) : null;
			if (st?.game) st.game = GapleGame.fromJSON(st.game);
			const res = fn(st);
			if (!res) return { noop: true, state: raw ? JSON.parse(raw) : null };
			if (res.state === null) {
				await this.store.del(keyOf(roomId));
				return { deleted: true, state: null };
			}
			const next = res.state;
			next.ver = (st?.ver ?? 0) + 1;
			if (next.game) syncGame(next);
			const json = JSON.stringify(next);
			await this.store.set(keyOf(roomId), json, this.roomTtlMs);
			return { state: JSON.parse(json), events: res.events ?? [] };
		} finally {
			await this.store.unlock(lockOf(roomId), lock);
		}
	}

	async _afterMutate(roomId, res) {
		this._deliverLocal(roomId, res.state, res.events ?? []);
		await this.store.publish(chanOf(roomId), JSON.stringify({ state: res.state, events: res.events ?? [] }));
	}

	// ---------------------------------------------------------------- pengiriman ke pemain
	async _attach(ws, roomId, token) {
		ws.ctx = { roomId, token, cid: ws.cid, lastVer: 0, lastInfo: '' };
		let set = this.local.get(roomId);
		if (!set) {
			set = new Set();
			this.local.set(roomId, set);
			const handler = (raw) => {
				try {
					const msg = JSON.parse(raw);
					this._deliverLocal(roomId, msg.state, msg.events ?? []);
				} catch (e) { console.error('[gaple] pesan bus:', e); }
			};
			this.busHandlers.set(roomId, handler);
			await this.store.subscribe(chanOf(roomId), handler);
		}
		set.add(ws);
	}

	_detach(ws, ctx) {
		const set = this.local.get(ctx.roomId);
		if (!set) return;
		set.delete(ws);
		if (set.size) return;
		this.local.delete(ctx.roomId);
		clearTimeout(this.timers.get(ctx.roomId));
		this.timers.delete(ctx.roomId);
		const handler = this.busHandlers.get(ctx.roomId);
		this.busHandlers.delete(ctx.roomId);
		if (handler) this.store.unsubscribe(chanOf(ctx.roomId), handler).catch(() => {});
	}

	_kick(ws, reason) {
		const ctx = ws.ctx;
		if (!ctx) return;
		ws.ctx = null;
		this._detach(ws, ctx);
		if (reason === 'left') send(ws, { t: 'left' });
		try { ws.close(reason === 'replaced' ? 4001 : 1000); } catch { /* sudah tertutup */ }
	}

	_deliverLocal(roomId, st, events) {
		if (!st) return;
		const set = this.local.get(roomId);
		if (set) {
			const game = st.game ? GapleGame.fromJSON(st.game) : null;
			for (const ws of [...set]) this._sendState(ws, st, events, game);
		}
		this._scheduleAuto(roomId, st);
	}

	/** Kirim kondisi room terbaru ke satu pemain (versi lama/duplikat dilewati). */
	_sendState(ws, st, events, game = st.game ? GapleGame.fromJSON(st.game) : null) {
		const ctx = ws.ctx;
		if (!ctx || st.ver <= ctx.lastVer) return;
		const seat = st.slots.findIndex((s) => s.token === ctx.token);
		if (seat < 0) return this._kick(ws, 'left');
		if (st.slots[seat].cid !== ctx.cid) return this._kick(ws, 'replaced'); // koneksi lain mengambil kursi ini
		ctx.lastVer = st.ver;
		const info = JSON.stringify([roomInfo(st), seat]);
		if (info !== ctx.lastInfo) {
			ctx.lastInfo = info;
			send(ws, { t: 'room', room: roomInfo(st), you: seat });
		}
		if (game) {
			if (events.length) send(ws, { t: 'events', events });
			send(ws, { t: 'view', view: game.viewFor(seat) });
		}
	}

	// ---------------------------------------------------------------- langkah otomatis (COM)
	/** Pemain COM, atau pemain yang terputus lebih lama dari masa tunggu, dimainkan otomatis. */
	_isAuto(slot) {
		return slot.bot || (!slot.connected && Date.now() - slot.dc >= this.graceMs);
	}

	_scheduleAuto(roomId, st) {
		clearTimeout(this.timers.get(roomId));
		this.timers.delete(roomId);
		const g = st.game;
		if (!g || g.phase !== 'playing' || !this.local.has(roomId)) return;
		const slot = st.slots[g.turn];
		if (!slot) return;
		let delay;
		if (slot.bot) delay = this.botDelay[0] + Math.random() * this.botDelay[1];
		else if (!slot.connected) delay = Math.max(0, slot.dc + this.graceMs - Date.now()) + this.botDelay[0] * 0.8 + Math.random() * this.botDelay[1];
		else return;
		const ver = st.ver;
		this.timers.set(roomId, setTimeout(() => {
			this.timers.delete(roomId);
			this._autoStep(roomId, ver).catch((e) => console.error('[gaple] autoStep:', e));
		}, delay));
	}

	/** Beberapa instance bisa menjadwalkan langkah yang sama; hanya satu yang lolos (cek versi di bawah kunci). */
	async _autoStep(roomId, expectedVer) {
		const res = await this.mutate(roomId, (st) => {
			if (!st || st.ver !== expectedVer || !st.game || st.game.phase !== 'playing') return null;
			const seat = st.game.turn;
			if (!this._isAuto(st.slots[seat])) return null;
			const m = botMove(st.game, seat);
			const ev = m && st.game.play(seat, m.tileId, m.end);
			return ev ? { state: st, events: ev } : null;
		});
		if (res.noop) {
			if (res.state) this._scheduleAuto(roomId, res.state); // versi sudah berubah: jadwalkan ulang dari kondisi terbaru
			return;
		}
		await this._afterMutate(roomId, res);
	}
}
