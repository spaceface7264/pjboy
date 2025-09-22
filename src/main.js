import { Game } from './core/Game.js';

function bootstrap() {
  const container = document.getElementById('gameContainer');
  const canvas = document.getElementById('gameCanvas');
  if (!container || !canvas) {
    throw new Error('Game container or canvas element missing.');
  }

  const game = new Game({ container, canvas });
  game.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
