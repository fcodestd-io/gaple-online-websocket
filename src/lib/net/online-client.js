import { Emitter } from './emitter.js';

const CONNECT_TIMEOUT_MS = 15000;
const PING_EVERY_MS = 20000;
const RESUME_WAIT_MS = 8000;
// Jeda antar percobaan sambung ulang (total sekitar 40 detik).
const RETRY_DELAYS = [500, 1000, 2000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];
const SESSION_KEY = 'gaple_online_session';

/** WebSocket dilayani function Vercel di /api/ws (saat dev: server Vite di path yang sama). */
function wsUrl() {
	return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Token rahasia pemain. getRandomValues tetap tersedia di http://IP-lokal (randomUUID tidak). */
function newToken() {
	const b = new Uint8Array(24);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Sesi disimpan per tab, supaya refresh halaman atau koneksi putus bisa kembali ke kursi yang sama.
export function loadSession() {
	try {
		const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
		return s && typeof s.token === 'string' && typeof s.room === 'string' ? s : null;
	} catch { return null; }
}
export function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } }
function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* abaikan */ } }

/**
 * Controller mode online. Antarmukanya sama dengan LocalController.
 * Koneksi di Vercel Functions bisa putus kapan saja (batas durasi function), jadi klien otomatis
 * menyambung ulang dan meminta kursinya kembali dengan token yang sama.
 */
export class OnlineClient extends Emitter {
	constructor() {
		super();
		this.ws = null;
		this.room = null;
		this.you = -1;
		this.lastView = null;
		this.token = newToken();
		this.closing = false; // true = penutupan disengaja, jangan sambung ulang
		this.joined = false;
		this.reconnecting = false;
		this._resumeWaiter = null;
		this._pinger = null;
	}
	get isHost() { return !!this.room && this.room.host === this.you; }
	get roomId() { return this.room?.id ?? ''; }

	connect() { return this._open(); }

	_open() {
		return new Promise((resolve, reject) => {
			let ws;
			try { ws = new WebSocket(wsUrl()); } catch { return reject(new Error('Alamat server online tidak valid.')); }
			this.ws = ws;
			let opened = false;
			// Function yang baru "bangun" bisa butuh beberapa detik untuk menerima koneksi pertama.
			const timer = setTimeout(() => {
				if (opened) return;
				try { ws.close(); } catch { /* sudah tertutup */ }
				reject(new Error('Server online tidak merespons. Coba lagi sebentar.'));
			}, CONNECT_TIMEOUT_MS);
			ws.onopen = () => { opened = true; clearTimeout(timer); this._startPing(); resolve(); };
			ws.onerror = () => { clearTimeout(timer); if (!opened) reject(new Error('Tidak bisa terhubung ke server online.')); };
			ws.onclose = (e) => {
				clearTimeout(timer);
				if (opened && ws === this.ws) { this._stopPing(); this._onClose(e.code); }
			};
			ws.onmessage = (e) => {
				if (ws !== this.ws) return;
				let m;
				try { m = JSON.parse(e.data); } catch { return; }
				this._handle(m);
			};
		});
	}

	_startPing() {
		this._stopPing();
		this._pinger = setInterval(() => this.send({ t: 'ping' }), PING_EVERY_MS);
	}
	_stopPing() { clearInterval(this._pinger); this._pinger = null; }

	_onClose(code) {
		if (this.closing) return;
		if (code === 4001) { clearSession(); this.emit('replaced'); return; } // kursi diambil koneksi lain
		if (this.reconnecting) { this._resumeWaiter?.(false); return; }
		if (!this.joined) { this.emit('close'); return; }
		this._reconnect();
	}

	async _reconnect() {
		if (this.reconnecting) return;
		this.reconnecting = true;
		this.emit('reconnecting', true);
		for (const d of RETRY_DELAYS) {
			await sleep(d);
			if (this.closing) return;
			try { await this._open(); } catch { continue; }
			this.send({ t: 'resume', room: this.room?.id, token: this.token });
			if (await this._waitResume()) return;
		}
		if (this.closing) return;
		this.reconnecting = false;
		this.emit('reconnecting', false);
		this.emit('close');
	}

	/** Menunggu server mengonfirmasi kursi kita (pesan `room`). false bila koneksi putus lagi/gagal. */
	_waitResume() {
		return new Promise((resolve) => {
			const timer = setTimeout(() => done(false), RESUME_WAIT_MS);
			const done = (ok) => { clearTimeout(timer); this._resumeWaiter = null; resolve(ok); };
			this._resumeWaiter = done;
		});
	}

	_handle(m) {
		switch (m.t) {
			case 'room':
				this.room = m.room; this.you = m.you; this.joined = true;
				saveSession({ room: m.room.id, token: this.token });
				if (this.reconnecting) {
					this.reconnecting = false;
					this._resumeWaiter?.(true);
					this.emit('reconnecting', false);
				}
				this.emit('room', m.room);
				break;
			case 'events': this.emit('events', m.events); break;
			case 'view': this.lastView = m.view; this.emit('view', m.view); break;
			case 'error':
				if (m.code === 'gone') { this.closing = true; clearSession(); this._resumeWaiter?.(false); }
				this.emit('error', m.msg, m.code);
				break;
			case 'left': this.joined = false; this.emit('left'); break;
		}
	}

	send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
	create(name) { this.send({ t: 'create', name, token: this.token }); }
	join(room, name) { this.send({ t: 'join', room, name, token: this.token }); }
	/** Kembali ke kursi lama setelah refresh halaman. */
	resume(session) { this.token = session.token; this.send({ t: 'resume', room: session.room, token: session.token }); }
	start() { this.send({ t: 'start' }); }
	play(tile, end) { this.send({ t: 'play', tile, end }); }
	nextRound() { this.send({ t: 'next' }); }
	leave() { this.closing = true; clearSession(); this.send({ t: 'leave' }); }
	destroy() {
		this.closing = true;
		this._stopPing();
		this._resumeWaiter?.(false);
		try { this.ws?.close(); } catch { /* sudah tertutup */ }
	}
}
