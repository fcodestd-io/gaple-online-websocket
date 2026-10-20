// Phaser butuh browser, jadi seluruh app jalan di sisi client (tanpa SSR).
// prerender = true: halaman `/` dibuat sekali saat build menjadi HTML statis
// (cangkang kosong + JS client), sehingga Vercel menyajikannya dari CDN tanpa function.
export const ssr = false;
export const prerender = true;
