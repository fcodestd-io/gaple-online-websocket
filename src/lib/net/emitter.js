export class Emitter {
	constructor() { this._h = {}; }
	on(type, cb) {
		(this._h[type] ||= []).push(cb);
		return () => { this._h[type] = this._h[type].filter((f) => f !== cb); };
	}
	emit(type, ...args) { (this._h[type] || []).slice().forEach((cb) => cb(...args)); }
}
