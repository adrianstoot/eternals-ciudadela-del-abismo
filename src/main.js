import { AbyssCitadelGame } from './game/Game.js';

const game = new AbyssCitadelGame();
window.__GAME__ = game;
game.init();
