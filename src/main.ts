/* Boot: load the art and the type, then hand over to the game. */
import './style.css';
import { loadArt } from './assets';
import { Music } from './audio/music';
import { PointerPen } from './input/pointer';
import { Game } from './game/game';
import { Hud } from './ui/hud';

async function boot() {
  const stage = document.getElementById('stage')!;
  const view = document.getElementById('view') as HTMLCanvasElement;
  const hud = new Hud(stage);
  hud.show('loading', 'loading');
  // canvas text (score pops) needs the face loaded first; don't hold the game up if the font can't be fetched
  const font = Promise.race([document.fonts.load('700 32px Fredoka'), new Promise(r => setTimeout(r, 2500))]).catch(() => {});
  const [art] = await Promise.all([loadArt(q => hud.progress(q)), font]);
  const game = new Game(view, art, hud, new PointerPen(stage), new Music());
  // for poking at in the console (and the test bots): in development, or with ?debug
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { haunt: Game }).haunt = game;
  game.title();
  game.run();
}

boot().catch(e => {
  const p = document.querySelector('#loading p');
  if (p) p.textContent = `Couldn't load the game: ${e instanceof Error ? e.message : e}`;
  console.error(e);
});
