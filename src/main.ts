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

/** something went wrong that the game can't carry on from: say so, and offer to start again */
function broken(text: string) {
  const loading = document.getElementById('loading')!, stage = document.getElementById('stage')!;
  for (const s of stage.querySelectorAll<HTMLElement>('.screen')) s.hidden = s !== loading;
  stage.dataset.state = 'loading';
  loading.querySelector('p')!.textContent = text;
  loading.querySelector('.bar')?.remove();
  if (!loading.querySelector('button')) {
    const again = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Try again' });
    again.addEventListener('click', () => location.reload());
    loading.append(again);
  }
}

// the GPU can be reset under us (a driver update, a laptop waking up): the art is gone with it
document.getElementById('view')!.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  broken('The graphics stopped working for a moment.');
});

boot().catch(e => {
  console.error(e);
  const webgl = e instanceof Error && /WebGL/.test(e.message);
  broken(webgl
    ? 'Haunt needs WebGL, and this browser has it turned off. Try another browser, or turn on hardware acceleration.'
    : "The game couldn't load. Check your connection and try again.");
});
