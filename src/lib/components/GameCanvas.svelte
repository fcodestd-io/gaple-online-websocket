<script>
	import { onMount, onDestroy } from 'svelte';

	export let controller;
	let el;
	let game = null;
	let gone = false;

	onMount(async () => {
		const { createGame } = await import('#lib/game/create-game.js');
		if (gone) return;
		game = createGame(el, controller);
	});
	onDestroy(() => {
		gone = true;
		game?.destroy(true);
	});
</script>

<div class="canvas" bind:this={el}></div>

<style>
	.canvas { position: absolute; inset: 0; }
	.canvas :global(canvas) { display: block; }
</style>
