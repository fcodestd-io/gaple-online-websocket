# Gaple Online

Game domino Gaple dengan **SvelteKit (JavaScript)**, **Phaser 4**, dan **WebSocket**. Dua mode:

- **Lawan komputer**: 2 sampai 4 pemain (termasuk kamu), jalan penuh di browser.
- **Online**: satu pemain membuat room, pemain lain memasukkan ID room. Host menekan *Mulai sekarang* (minimal 2 pemain) atau permainan otomatis mulai saat room penuh (4 pemain).

## Menjalankan

Butuh Node.js 22.17 atau lebih baru (Vercel memakai 24.x) dan pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:5173 (WebSocket ikut di port yang sama, path /api/ws)
```

Cek build produksi secara lokal:

```bash
pnpm build
pnpm preview      # http://localhost:4173, WebSocket juga ikut
```

Saat dev/preview, state room disimpan di memori proses (tanpa Redis). Main online dari HP/laptop lain di jaringan yang sama: buka `http://IP-KOMPUTER:5173` (`pnpm dev` sudah memakai `--host`).

## Deploy ke Vercel (semuanya di Vercel)

Satu project Vercel melayani dua hal:

- **Situs** (SvelteKit + Phaser) lewat `@sveltejs/adapter-vercel`. Halaman `/` di-prerender jadi file statis.
- **WebSocket** lewat Vercel Function `api/ws.js` di `wss://domain-kamu/api/ws` (fitur WebSocket Vercel Functions, saat ini beta).

Langkah:

1. Push repo ke Git dan commit `pnpm-lock.yaml` hasil `pnpm install`.
2. Di Vercel: **Add New → Project**, pilih repo. Framework otomatis terdeteksi sebagai SvelteKit. Pastikan **Fluid compute** aktif (bawaan untuk project baru).
3. Di project itu buka **Storage** (atau Marketplace) dan tambahkan **Redis** (Upstash atau Redis Cloud). Vercel otomatis mengisi variabel `REDIS_URL`. Redeploy supaya variabel terbaca.
4. Selesai. Buka domain production, lalu pilih *Main online*.

Kenapa Redis wajib: di Vercel, koneksi dua pemain dalam satu room bisa mendarat di instance function yang berbeda, dan koneksi diputus di batas durasi function. Karena itu state room disimpan di Redis, dan antar-instance saling memberi kabar lewat pub/sub Redis. Tanpa `REDIS_URL`, server memakai memori satu instance: cukup untuk dev lokal, tapi di Vercel room bisa "hilang" saat pemain berbeda instance.

Opsional: variabel `ALLOWED_ORIGINS` (pisah koma, mis. `gaple.example.com,*.vercel.app`) untuk membatasi situs mana yang boleh membuka WebSocket. Kosong = semua boleh.

Perilaku yang perlu diketahui:

- Koneksi WebSocket otomatis diputus Vercel saat mencapai durasi maksimum function (bawaan 300 detik). Klien menyambung ulang sendiri dan kembali ke kursi yang sama (token tersimpan di `sessionStorage`), jadi pemain hampir tidak merasakannya. Refresh halaman juga kembali ke room yang sama.
- Pemain yang terputus lebih dari 25 detik dimainkan sementara oleh COM dan mengambil alih lagi begitu kembali. Menekan *Keluar* menggantikan kursinya dengan COM secara permanen.
- Room dihapus otomatis 3 jam setelah aktivitas terakhir, atau saat tidak ada pemain manusia tersisa.
- Preview deployment di URL `*.vercel.app` bisa dilindungi *Deployment Protection* sehingga WebSocket dari teman ditolak (401). Bagikan domain production.

## Aturan yang dipakai

- 28 kartu, tiap pemain dibagi 7. Pada 2 atau 3 pemain, sisa kartu tidak dipakai.
- Pembuka: pemilik balak tertinggi (6-6, lalu 5-5, dst). Tanpa balak, kartu dengan jumlah titik terbesar.
- Kartu dipasang di ujung kiri atau kanan yang angkanya sama. Tidak ada kartu cocok = otomatis lewat.
- Ronde selesai saat ada yang kartunya habis, atau semua pemain lewat berturut-turut (papan terkunci, sisa jumlah titik terkecil menang, sama = seri).
- Pemenang ronde mendapat total titik di kartu lawan. Siapa pun yang mencapai 100 poin menjuarai pertandingan.
- Pemain online yang keluar/terputus di tengah permainan diganti COM.

## Struktur

```
api/ws.js                    Vercel Function WebSocket (wss://domain/api/ws)
realtime/hub.js              room, lobi, sambung ulang, COM pengganti; state disimpan di store
realtime/store.js            Redis (produksi) atau memori (dev) + kunci + pub/sub
realtime/ws.js               menempelkan WebSocket ke http.Server (Vercel Function / server dev Vite)
src/lib/shared/gaple-engine.js   aturan game + AI COM (dipakai server dan browser)
src/lib/game/                Phaser: GameScene, controller vs COM
src/lib/net/online-client.js klien WebSocket: sesi, sambung ulang otomatis
src/routes/+page.svelte      menu, ruang tunggu, hasil ronde
static/assets/images|audio   semua aset (PNG, WAV, MP3)
scripts/generate_assets.py   pembuat aset (opsional): pnpm assets
```

Konfigurasi SvelteKit 3 (adapter dll.) ada di `vite.config.js`, tidak ada lagi `svelte.config.js`. Alias `#lib/...` didefinisikan lewat `"imports"` di `package.json`.

## Protokol WebSocket (`/api/ws`, JSON)

Klien ke server: `create {name, token}`, `join {room, name, token}`, `resume {room, token}`, `start`, `play {tile, end}`, `next`, `leave`, `ping`.
Server ke klien: `room`, `view`, `events`, `error {msg, code}`, `left`.

`token` adalah rahasia acak milik pemain (dibuat di browser) yang mengenali kursinya saat sambung ulang; tidak pernah dikirim ke pemain lain.
Server tidak pernah mengirim kartu pemain lain, kecuali saat ronde selesai.
