// Menempelkan server WebSocket ke sebuah http.Server (server dev Vite, atau function Vercel).
import { WebSocketServer } from 'ws';
import { GameHub } from './hub.js';
import { createStore } from './store.js';

const MAX_SILENT_MS = 70000; // klien mengirim ping tiap 20 dtk; diam lebih lama dari ini dianggap putus
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 60;

/**
 * Daftar origin yang boleh membuka koneksi. Entri `*.contoh.com` cocok dengan semua subdomain.
 * Daftar kosong = semua origin diizinkan.
 */
export function originAllowed(origin, allowed) {
	if (!allowed?.length) return true;
	if (!origin) return false;
	let host = '';
	try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
	return allowed.some((a) => {
		const rule = a.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
		return rule.startsWith('*.') ? host.endsWith(rule.slice(1)) : host === rule;
	});
}

/** Satu hub per proses. Store (dan koneksi Redis) baru dibuat saat koneksi pertama masuk. */
export function getHub() {
	return (globalThis.__gapleHub ??= new GameHub({ store: createStore() }));
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {string|null} path  hanya upgrade ke path ini yang ditangani (null = semua upgrade)
 * @param {{ allowedOrigins?: string[], hub?: GameHub }} [opts]
 */
export function attachWebSocket(httpServer, path = '/api/ws', { allowedOrigins = [], hub } = {}) {
	const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

	httpServer.on('upgrade', (req, socket, head) => {
		if (path) {
			let pathname = '';
			try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
			if (pathname !== path) return; // selain path kita (mis. HMR Vite) diurus handler lain
		}
		if (!originAllowed(req.headers.origin, allowedOrigins)) {
			socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});

	wss.on('connection', (ws) => {
		const h = hub ?? getHub();
		h.onConnection(ws);
		ws.lastSeen = Date.now();
		ws.win = Date.now();
		ws.hits = 0;
		ws.on('message', (raw) => {
			const t = Date.now();
			ws.lastSeen = t;
			if (t - ws.win > RATE_WINDOW_MS) { ws.win = t; ws.hits = 0; }
			if (++ws.hits > RATE_MAX) return ws.close(1008, 'terlalu banyak pesan');
			let m;
			try { m = JSON.parse(raw.toString()); } catch { return; }
			if (m && typeof m.t === 'string') h.handle(ws, m);
		});
		ws.on('close', () => h.onClose(ws));
		ws.on('error', () => {});
	});

	// Buang koneksi yang sudah lama diam (mis. HP kehilangan sinyal) supaya kursinya ditandai terputus.
	const sweep = setInterval(() => {
		const t = Date.now();
		for (const ws of wss.clients) if (t - ws.lastSeen > MAX_SILENT_MS) ws.terminate();
	}, 15000);
	sweep.unref?.();
	httpServer.on('close', () => clearInterval(sweep));

	return wss;
}
