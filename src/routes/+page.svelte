<script>
	import { onMount, onDestroy } from 'svelte';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import { LocalController } from '#lib/game/local-controller.js';
	import { OnlineClient, loadSession } from '#lib/net/online-client.js';

	// screen: menu | local | online | lobby | game
	let screen = 'menu';
	let mode = '';
	let name = '';
	let localCount = 3;
	let joinId = '';
	let error = '';
	let busy = false;
	let reconnecting = false;
	let copied = false;
	let ctrl = null;
	let view = null;
	let room = null;
	let you = -1;
	let unsubs = [];

	$: isHost = mode === 'local' || (!!room && you >= 0 && room.host === you);
	$: result = view?.result ?? null;
	$: over = !!view && view.phase === 'roundover' && !!result;
	$: slots = room ? Array.from({ length: room.max }, (_, i) => room.players[i] ?? null) : [];

	onMount(() => {
		try { name = localStorage.getItem('gaple_name') || ''; } catch {}
		// refresh halaman di tengah game online: kembali ke kursi yang sama
		const saved = loadSession();
		if (saved) goOnline('resume', saved);
	});
	onDestroy(() => cleanup());

	const displayName = () => name.trim().slice(0, 12) || 'Pemain';
	function saveName() {
		try { localStorage.setItem('gaple_name', name.trim().slice(0, 12)); } catch {}
	}

	function cleanup() {
		unsubs.forEach((f) => f());
		unsubs = [];
		ctrl?.destroy();
		ctrl = null; view = null; room = null; you = -1; busy = false; reconnecting = false;
	}
	function toMenu() {
		if (mode === 'online') ctrl?.leave?.();
		cleanup();
		screen = 'menu'; error = '';
	}
	function go(next) { error = ''; screen = next; }

	function startLocal() {
		saveName(); cleanup(); mode = 'local'; error = '';
		const c = new LocalController({ name: displayName(), count: localCount });
		ctrl = c;
		unsubs.push(c.on('view', (v) => (view = v)));
		screen = 'game';
		c.start();
	}

	async function goOnline(action, session = null) {
		saveName(); error = '';
		if (action === 'join' && joinId.trim().length < 4) { error = 'Masukkan 4 karakter ID room.'; return; }
		cleanup(); mode = 'online'; busy = true;
		const c = new OnlineClient();
		try { await c.connect(); } catch (e) { error = e.message; busy = false; return; }
		ctrl = c;
		unsubs.push(
			c.on('room', (r) => { room = r; you = c.you; busy = false; if (screen !== 'game') screen = 'lobby'; }),
			c.on('view', (v) => { view = v; if (screen !== 'game') screen = 'game'; }),
			c.on('error', (m, code) => { error = m; busy = false; if (code === 'gone') { cleanup(); screen = 'menu'; } }),
			c.on('reconnecting', (v) => (reconnecting = v)),
			c.on('replaced', () => { cleanup(); screen = 'menu'; error = 'Sesi ini dibuka di tab lain.'; }),
			c.on('close', () => { cleanup(); screen = 'menu'; error = 'Koneksi ke server terputus.'; })
		);
		if (action === 'create') c.create(displayName());
		else if (action === 'resume') c.resume(session);
		else c.join(joinId.trim().toUpperCase(), displayName());
	}

	async function copyId() {
		try { await navigator.clipboard.writeText(room.id); copied = true; setTimeout(() => (copied = false), 1500); } catch {}
	}

	function titleOf(v, r) {
		if (v.matchWinner !== null) return v.matchWinner === v.mySeat ? 'Kamu juara pertandingan!' : `${v.players[v.matchWinner].name} juara pertandingan`;
		if (r.winner === null) return 'Seri, tidak ada poin';
		return r.winner === v.mySeat ? 'Kamu menang ronde ini!' : `${v.players[r.winner].name} menang ronde ini`;
	}
</script>

<svelte:head><title>Gaple Online</title></svelte:head>

{#if screen === 'game' && ctrl}
	<div class="game">
		<header class="bar">
			<button class="btn ghost small" on:click={toMenu}>Keluar</button>
			{#if mode === 'online' && room}
				<button class="chip" on:click={copyId} title="Salin ID room">Room {room.id}</button>
			{:else}
				<span class="chip plain">Lawan komputer</span>
			{/if}
			{#if view}<span class="chip plain">Ronde {view.round} · target {view.target} poin</span>{/if}
		</header>
		<div class="stage">
			{#if reconnecting}<div class="reconn" role="status">Menyambung ulang…</div>{/if}
			<GameCanvas controller={ctrl} />
			{#if over}
				<div class="overlay">
					<div class="card result" role="dialog" aria-label="Hasil ronde">
						<h2>{titleOf(view, result)}</h2>
						<p class="sub">
							{result.reason === 'domino' ? 'Kartu habis, domino!' : 'Papan terkunci: sisa angka terkecil menang.'}
							{#if result.winner !== null}<br />+{result.points} poin untuk {view.players[result.winner].name}.{/if}
						</p>
						<table>
							<thead><tr><th>Pemain</th><th>Sisa angka</th><th>Skor</th></tr></thead>
							<tbody>
								{#each view.players as p, i}
									<tr class:win={result.winner === i}>
										<td>{p.name}{i === view.mySeat ? ' (kamu)' : ''}</td>
										<td>{result.sums[i]}</td>
										<td>{p.score}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<div class="row">
							{#if isHost}
								<button class="btn" on:click={() => ctrl.nextRound()}>
									{view.matchWinner !== null ? 'Main lagi dari nol' : 'Ronde berikutnya'}
								</button>
							{:else}
								<span class="wait">Menunggu host melanjutkan…</span>
							{/if}
							<button class="btn ghost" on:click={toMenu}>Keluar</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<main class="home">
		<img class="logo" src="/assets/images/logo.png" alt="Gaple" width="380" height="115" />

		{#if screen === 'menu'}
			<section class="card">
				<label class="field">
					<span>Namamu</span>
					<input bind:value={name} maxlength="12" placeholder="Pemain" autocomplete="nickname" on:change={saveName} />
				</label>
				<div class="modes">
					<button class="mode" on:click={() => go('local')}>
						<strong>Lawan komputer</strong>
						<span>Main sendiri melawan 1 sampai 3 COM.</span>
					</button>
					<button class="mode" on:click={() => go('online')}>
						<strong>Main online</strong>
						<span>Buat room atau gabung pakai ID, sampai 4 pemain.</span>
					</button>
				</div>
			</section>
		{:else if screen === 'local'}
			<section class="card">
				<h2>Lawan komputer</h2>
				<p class="sub">Jumlah pemain, termasuk kamu</p>
				<div class="seg" role="radiogroup" aria-label="Jumlah pemain">
					{#each [2, 3, 4] as n}
						<button role="radio" aria-checked={localCount === n} class:on={localCount === n} on:click={() => (localCount = n)}>{n} pemain</button>
					{/each}
				</div>
				<div class="row">
					<button class="btn" on:click={startLocal}>Mulai main</button>
					<button class="btn ghost" on:click={() => go('menu')}>Kembali</button>
				</div>
			</section>
		{:else if screen === 'online'}
			<section class="card">
				<h2>Main online</h2>
				<button class="btn wide" disabled={busy} on:click={() => goOnline('create')}>Buat room baru</button>
				<p class="sub">atau gabung ke room temanmu</p>
				<form class="join" on:submit|preventDefault={() => goOnline('join')}>
					<input bind:value={joinId} maxlength="4" placeholder="ID room" aria-label="ID room" autocapitalize="characters" />
					<button class="btn" disabled={busy}>Gabung</button>
				</form>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<div class="row"><button class="btn ghost" on:click={() => go('menu')}>Kembali</button></div>
			</section>
		{:else if screen === 'lobby' && room}
			<section class="card">
				<h2>Ruang tunggu</h2>
				<p class="sub">Bagikan ID ini ke temanmu</p>
				<button class="roomid" on:click={copyId} title="Salin ID room">
					{room.id}<small>{copied ? 'Tersalin' : 'Ketuk untuk salin'}</small>
				</button>
				<ul class="slots">
					{#each slots as s, i}
						<li class:empty={!s}>
							<img src={`/assets/images/avatar_${(i % 4) + 1}.png`} alt="" width="36" height="36" />
							<span>{s ? s.name : 'Menunggu pemain…'}</span>
							{#if s && room.host === i}<em>host</em>{/if}
							{#if s && i === you}<em>kamu</em>{/if}
							{#if s && !s.connected}<em>terputus</em>{/if}
						</li>
					{/each}
				</ul>
				<p class="sub">{room.players.length} dari {room.max} pemain. Otomatis mulai kalau sudah penuh.</p>
				{#if reconnecting}<p class="sub" role="status">Menyambung ulang…</p>{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<div class="row">
					{#if isHost}
						<button class="btn" disabled={room.players.length < 2} on:click={() => ctrl.start()}>Mulai sekarang</button>
					{:else}
						<span class="wait">Menunggu host memulai…</span>
					{/if}
					<button class="btn ghost" on:click={toMenu}>Keluar</button>
				</div>
			</section>
		{/if}
		{#if error && (screen === 'menu' || screen === 'local')}<p class="error" role="alert">{error}</p>{/if}
	</main>
{/if}

<style>
	.home { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px 16px; }
	.logo { max-width: min(380px, 80vw); height: auto; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45)); }
	.card {
		width: min(460px, 100%);
		background: rgba(6, 37, 27, 0.86);
		border: 2px solid var(--brass-deep);
		border-radius: 18px;
		padding: 24px;
		display: flex; flex-direction: column; gap: 14px;
		box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(243, 195, 77, 0.18);
	}
	h2 { font-family: var(--serif); font-size: 1.6rem; margin: 0; color: var(--brass); }
	.sub { margin: 0; color: #a9d3c2; line-height: 1.5; }
	.field { display: flex; flex-direction: column; gap: 6px; }
	.field span { color: #a9d3c2; font-size: 0.95rem; }
	input {
		background: #041a13; border: 2px solid #2e6b55; border-radius: 10px; padding: 11px 14px; font-size: 1.05rem; width: 100%;
	}
	input:focus { border-color: var(--brass); outline: none; }
	.modes { display: grid; gap: 12px; }
	.mode {
		text-align: left; background: linear-gradient(180deg, #14584a, #0e4a3e); border: 2px solid #2e6b55; border-radius: 14px;
		padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; transition: transform 0.12s, border-color 0.12s;
	}
	.mode strong { font-family: var(--serif); font-size: 1.25rem; color: var(--ivory); }
	.mode span { color: #a9d3c2; font-size: 0.95rem; }
	.mode:hover { border-color: var(--brass); transform: translateY(-2px); }
	.btn {
		background: linear-gradient(180deg, #ffd666, var(--brass-deep)); color: #2a1a05; border: 0; border-radius: 12px;
		padding: 12px 20px; font-weight: 700; font-size: 1.02rem; box-shadow: 0 3px 0 #6d531a;
	}
	.btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #6d531a; }
	.btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.btn.ghost { background: transparent; color: var(--ivory); border: 2px solid #2e6b55; box-shadow: none; }
	.btn.ghost:hover { border-color: var(--brass); }
	.btn.small { padding: 7px 14px; font-size: 0.95rem; }
	.btn.wide { width: 100%; }
	.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
	.seg { display: flex; gap: 8px; }
	.seg button { flex: 1; background: #041a13; border: 2px solid #2e6b55; border-radius: 10px; padding: 11px 6px; }
	.seg button.on { background: var(--brass); color: #2a1a05; border-color: var(--brass); font-weight: 700; }
	.join { display: flex; gap: 10px; }
	.join input { text-transform: uppercase; letter-spacing: 0.25em; text-align: center; font-family: var(--serif); font-size: 1.3rem; }
	.error { margin: 0; color: var(--danger); background: rgba(230, 106, 82, 0.12); border-radius: 8px; padding: 8px 12px; }
	.wait { color: #a9d3c2; }
	.roomid {
		background: #041a13; border: 2px dashed var(--brass-deep); border-radius: 14px; padding: 12px; display: flex; flex-direction: column;
		align-items: center; font-family: var(--serif); font-size: 3rem; letter-spacing: 0.3em; padding-left: 0.3em; color: var(--brass);
	}
	.roomid small { font-family: var(--sans); font-size: 0.8rem; letter-spacing: 0; color: #a9d3c2; }
	.slots { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
	.slots li { display: flex; align-items: center; gap: 10px; background: #0b2f25; border-radius: 10px; padding: 8px 12px; }
	.slots li.empty { opacity: 0.5; border: 1px dashed #2e6b55; background: transparent; }
	.slots em { margin-left: auto; font-style: normal; font-size: 0.85rem; color: var(--brass); }
	.slots em + em { margin-left: 8px; }

	.game { height: 100dvh; display: flex; flex-direction: column; }
	.bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; background: #041a13; border-bottom: 2px solid var(--brass-deep); }
	.chip { background: #0b2f25; border: 1px solid #2e6b55; border-radius: 999px; padding: 6px 14px; font-weight: 700; color: var(--brass); }
	.chip.plain { color: var(--ivory); font-weight: 400; }
	.stage { position: relative; flex: 1; min-height: 0; }
	.reconn { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 20; padding: 6px 16px; border-radius: 999px; background: #06251bee; border: 1px solid #f3c34d; color: #fff3c4; font-size: 14px; }
	.overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(2, 14, 10, 0.62); padding: 12px; z-index: 5; }
	.result { text-align: center; }
	.result .row { justify-content: center; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 8px 6px; border-bottom: 1px solid #1f5644; text-align: left; }
	th:not(:first-child), td:not(:first-child) { text-align: right; }
	th { color: #a9d3c2; font-weight: 400; }
	tr.win td { color: var(--brass); font-weight: 700; }
</style>
