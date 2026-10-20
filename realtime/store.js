// Penyimpanan bersama untuk server realtime: key-value, kunci (lock), dan pub/sub.
//
// - RedisStore  : produksi di Vercel. Beberapa instance function berbagi state lewat Redis.
// - MemoryStore : dev lokal atau tanpa Redis. Hanya benar untuk SATU instance.
//
// Antarmuka (semua async): get, set, setNX, del, lock, unlock, publish, subscribe, unsubscribe.
import { randomUUID } from 'node:crypto';
import * as ioredis from 'ioredis';

const Redis = ioredis.Redis ?? ioredis.default ?? ioredis;

const UNLOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
	return redis.call('del', KEYS[1])
end
return 0`;

export class MemoryStore {
	constructor() {
		this.kv = new Map();
		this.subs = new Map(); // channel -> Set<handler>
	}
	_live(key) {
		const e = this.kv.get(key);
		if (!e) return null;
		if (e.exp && e.exp <= Date.now()) { this.kv.delete(key); return null; }
		return e;
	}
	async get(key) { return this._live(key)?.v ?? null; }
	async set(key, value, ttlMs) { this.kv.set(key, { v: value, exp: ttlMs ? Date.now() + ttlMs : 0 }); }
	async setNX(key, value, ttlMs) {
		if (this._live(key)) return false;
		await this.set(key, value, ttlMs);
		return true;
	}
	async del(key) { this.kv.delete(key); }
	async lock(key, ttlMs) {
		if (this._live(key)) return null;
		const token = randomUUID();
		this.kv.set(key, { v: token, exp: Date.now() + ttlMs });
		return token;
	}
	async unlock(key, token) { if (this._live(key)?.v === token) this.kv.delete(key); }
	async publish(channel, message) {
		for (const h of [...(this.subs.get(channel) ?? [])]) setImmediate(() => h(message));
	}
	async subscribe(channel, handler) {
		if (!this.subs.has(channel)) this.subs.set(channel, new Set());
		this.subs.get(channel).add(handler);
	}
	async unsubscribe(channel, handler) {
		const s = this.subs.get(channel);
		if (!s) return;
		s.delete(handler);
		if (!s.size) this.subs.delete(channel);
	}
}

export class RedisStore {
	/** @param {string} url mis. rediss://default:sandi@host:port */
	constructor(url, { Client = Redis } = {}) {
		this.r = new Client(url, { maxRetriesPerRequest: 3, connectTimeout: 10000 });
		this.sub = this.r.duplicate(); // koneksi khusus SUBSCRIBE
		this.handlers = new Map(); // channel -> Set<handler>
		for (const c of [this.r, this.sub]) c.on('error', (e) => console.error('[gaple] redis:', e.message));
		this.sub.on('message', (channel, message) => {
			for (const h of [...(this.handlers.get(channel) ?? [])]) {
				try { h(message); } catch (e) { console.error('[gaple] handler pub/sub:', e); }
			}
		});
	}
	get(key) { return this.r.get(key); }
	async set(key, value, ttlMs) { await this.r.set(key, value, 'PX', ttlMs); }
	async setNX(key, value, ttlMs) { return (await this.r.set(key, value, 'PX', ttlMs, 'NX')) === 'OK'; }
	async del(key) { await this.r.del(key); }
	async lock(key, ttlMs) {
		const token = randomUUID();
		return (await this.r.set(key, token, 'PX', ttlMs, 'NX')) === 'OK' ? token : null;
	}
	async unlock(key, token) { await this.r.eval(UNLOCK_SCRIPT, 1, key, token); }
	async publish(channel, message) { await this.r.publish(channel, message); }
	async subscribe(channel, handler) {
		let s = this.handlers.get(channel);
		if (!s) {
			s = new Set();
			this.handlers.set(channel, s);
			await this.sub.subscribe(channel);
		}
		s.add(handler);
	}
	async unsubscribe(channel, handler) {
		const s = this.handlers.get(channel);
		if (!s) return;
		s.delete(handler);
		if (!s.size) {
			this.handlers.delete(channel);
			await this.sub.unsubscribe(channel);
		}
	}
}

/** Pakai Redis kalau REDIS_URL ada (otomatis diisi Vercel saat menghubungkan Redis dari Marketplace). */
export function createStore(env = process.env) {
	const url = env.REDIS_URL || env.KV_URL;
	if (url) return new RedisStore(url);
	console.warn('[gaple] REDIS_URL kosong: state room disimpan di memori satu instance (hanya aman untuk dev/demo).');
	return new MemoryStore();
}
