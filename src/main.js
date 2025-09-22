import { Game } from './core/Game.js';

function bootstrap() {
  // Get canvas element (assuming it exists in index.html)
  const canvas = document.getElementById('gameCanvas') || document.querySelector('canvas');
  if (!canvas) {
    console.error('Canvas element not found. Make sure index.html has a canvas with id="gameCanvas"');
    return;
  }

  // Initialize game
  const game = new Game({ container: document.body, canvas });
  
  // Make game globally accessible for debugging
  window.game = game;
  
  // Start the game
  game.start().catch(error => {
    console.error('Failed to start game:', error);
  });
}

// Bootstrap when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
