import Phaser from 'phaser';
import GameScene from './GameScene.js';

export function createGame(parent, controller) {
	const game = new Phaser.Game({
		type: Phaser.AUTO,
		parent,
		width: 1280,
		height: 720,
		backgroundColor: '#0b2a20',
		scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
		scene: []
	});
	game.scene.add('Game', GameScene, true, { controller });
	return game;
}
