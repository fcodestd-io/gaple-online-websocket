import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-vercel';
import { defineConfig } from 'vite';

// SvelteKit 3: konfigurasi (adapter dll.) dipasang langsung di plugin, bukan lagi di svelte.config.js.
// Saat dev/preview, WebSocket (/api/ws) menempel di server Vite. Di Vercel, path yang sama dilayani
// oleh function api/ws.js, jadi alamat di klien tidak berubah.
const gapleWs = {
	name: 'gaple-ws',
	async configureServer(server) {
		if (!server.httpServer) return;
		const { attachWebSocket } = await import('./realtime/ws.js');
		attachWebSocket(server.httpServer, '/api/ws');
	},
	async configurePreviewServer(server) {
		const { attachWebSocket } = await import('./realtime/ws.js');
		attachWebSocket(server.httpServer, '/api/ws');
	}
};

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() }), gapleWs],
	build: { chunkSizeWarningLimit: 2000 }
});
