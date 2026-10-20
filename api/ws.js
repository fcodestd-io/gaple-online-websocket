// Function Vercel untuk WebSocket mode online: wss://<domain-kamu>/api/ws
// Pola resmi Vercel: http.Server yang di-export default, upgrade ditangani oleh `ws`.
// State room disimpan di Redis (REDIS_URL), jadi aman walau koneksi pemain mendarat di instance berbeda.
import http from 'node:http';
import { attachWebSocket } from '../realtime/ws.js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

const server = http.createServer((_req, res) => {
	res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', upgrade: 'websocket' });
	res.end('Endpoint ini hanya untuk koneksi WebSocket.\n');
});

attachWebSocket(server, null, { allowedOrigins });

export default server;
