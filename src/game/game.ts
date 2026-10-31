/* The game: the run's flow (title, mouse or hands, practice, Ready / Set / Draw, play, pause, game over), casting,
   hearts, score and combo, the beat, and the frame loop that draws the graveyard with you and the ghosts in it. */
import { HANDS, PACE, RULES, SYMBOLS, TARGET, type Pt, type SymbolId } from '../config';
import type { Art } from '../assets';
import type { Music } from '../audio/music';
import { Recognizer } from '../input/recognizer';
import type { Pen, PointerPen } from '../input/pointer';
import { Compositor } from '../render/compositor';
import { Gl, Painter } from '../render/gl';
import { Scene } from '../scene/scene';
import type { Hud } from '../ui/hud';
import { Director, MOUSE } from './director';
import { Fx, Ink } from './fx';
import { Ghost, type World } from './ghost';
import { recorder } from '../debug/recorder';
import { Hands } from './hands';
import { Board } from '../ui/board';
import { EV } from '../../api/_lib/rules';

/** camera: starting the camera and hand tracking; practice: one ghost to banish before a hands run */
type Mode = 'title' | 'camera' | 'practice' | 'ready' | 'play' | 'paused' | 'over';
export type Input = 'mouse' | 'hands';

const BEST_KEY = 'haunt.best';
const SEEN_KEY = 'haunt.played';
const INPUT_KEY = 'haunt.input';
/** Ready, Set, Draw! and then the ghosts come */
const CUES: [number, string][] = [[.15, 'Ready'], [.95, 'Set'], [1.75, 'Draw!']];
const READY_T = 2.2;
/** the most device pixels per CSS pixel the game is drawn at */
const MAX_DPR = 1.5;
/** ?dpr=N tries another one in hands mode (for measuring) */
const HANDS_DPR = Number(new URLSearchParams(location.search).get('dpr')) || 1;

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}

export class Game {
  readonly w: World = { W: 0, H: 0, U: 0, tx: 0, ty: 0, t: 0, dt: 0, speed: 1, ghosts: [] };
  /** everything is drawn with WebGL into one canvas: the scene with the ghosts in it, then the top layer */
  private gl: Gl;
  /** the top layer: symbols, effects, your stroke */
  private paint: Painter;
  /** the pink flush when a ghost reaches you, made once per screen size */
  private flush: HTMLCanvasElement | null = null;
  private scene: Scene;
  private comp: Compositor;
  private fx = new Fx();
  private ink: Ink;
  private director = new Director();
  private rec = new Recognizer();
  private mode: Mode = 'title';
  private resumeTo: Mode = 'play';
  private input: Input = store(INPUT_KEY) === 'hands' ? 'hands' : 'mouse';
  private hands: Hands;
  /** the scene layer you're drawn after: in front of the far graves, behind the near ghosts and the grass */
  private front: number;
  /** why the game is paused: you paused it, or you walked out of view */
  private pauseFor: 'you' | 'away' = 'you';
  private awaySince = 0;
  private backSince = 0;
  /** the first hands run of a visit starts with a practice ghost */
  private practiced = false;
  private practice: Ghost | null = null;
  /** for the debug recording */
  private loggedMode = '';
  private loggedT = 0;
  private frameDt = 0;

  /** seconds since boot, less time paused (drives the scene and the timers) */
  private clock = 0;
  /** seconds of play this run (drives the difficulty) */
  private runT = 0;
  private readyT = 0;
  private stopUntil = 0;
  private endAt = Infinity;
  private hurtT = -9;
  private graceUntil = 0;
  private hearts = RULES.hearts;
  private healing = 0;
  private score = 0;
  private chain = 0;
  private banished = 0;
  private best = Number(store(BEST_KEY) ?? 0) || 0;
  private coachUntil = 0;
  /** bolt strikes still to land: each banishes its ghost when the bolt hits */
  private pending: { g: Ghost; at: number }[] = [];
  /** the leaderboard, this run's ticket for it, and what happened in the run (api/_lib/rules.ts checks it) */
  private board = new Board();
  private ticket: Promise<string | null> = Promise.resolve(null);
  private log: number[][] = [];
  /** the leaderboard is up, over the title or the game-over screen */
  private boardFrom: 'title' | 'over' | null = null;
  private last = performance.now();

  constructor(private view: HTMLCanvasElement, private art: Art, private hud: Hud, private mouse: PointerPen, private music: Music) {
    this.gl = new Gl(view);
    this.paint = new Painter(this.gl);
    this.scene = new Scene(this.gl, art.layers, art.glow, art.firefly);
    this.comp = new Compositor(this.gl, this.scene, art);
    this.ink = new Ink(art.rig.body);
    this.front = this.scene.indexOf('09_graves_front');
    this.hands = new Hands(this.gl, () => this.w);
    for (const pen of this.pens) {
      pen.enabled = () => this.mode === 'play' || this.mode === 'ready' || this.mode === 'practice';
      pen.onStroke = pts => this.stroke(pts);
    }

    hud.on('play', () => void this.play(this.input));
    hud.on('play-hands', () => void this.play('hands'));
    hud.on('play-mouse', () => void this.play('mouse'));
    hud.on('switch', () => void this.play(this.input === 'hands' ? 'mouse' : 'hands'));
    hud.on('retry', () => void this.play('hands'));
    hud.on('skip', () => this.endPractice());
    hud.on('pause', () => this.pause());
    hud.on('resume', () => this.resume());
    hud.on('home', () => this.title());
    hud.on('board', () => this.openBoard());
    hud.on('board-back', () => this.closeBoard());
    hud.on('mute', () => hud.setMuted(music.toggleMute()));
    hud.setMuted(music.muted);
    // browsers only let sound start from a click or a key
    const wake = () => music.start();
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
    addEventListener('keydown', e => {
      // typing a name for the leaderboard isn't a shortcut
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      if (e.key === 'Escape' && this.boardFrom) { this.closeBoard(); return; }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.mode === 'paused') this.resume(); else this.pause();
      }
      if (e.key === 'm' || e.key === 'M') hud.setMuted(music.toggleMute());
      // D in hands mode: what the tracking is doing (frame rates, lag, which hand, the finger readings)
      if ((e.key === 'd' || e.key === 'D') && this.hands.on) hud.debug(!hud.debugging);
      // Enter plays from the title and the game-over screen (when a button isn't the one being pressed)
      if (e.key === 'Enter' && (this.mode === 'title' || this.mode === 'over') && !this.boardFrom && !(e.target as HTMLElement).closest?.('button')) void this.play(this.input);
    });
    // stepping away pauses the run
    addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pause(); music.sleep(); } else music.wake();
    });
    addEventListener('resize', () => this.resize());
    this.resize();
    hud.setBest(this.best);
    hud.setInput(this.input, store(INPUT_KEY) !== null);
  }

  private get pens(): Pen[] { return [this.mouse, this.hands.pen]; }

  run() {
    const frame = (now: number) => {
      const dt = Math.min(.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private resize() {
    const w = this.w, r = this.view.getBoundingClientRect();
    w.W = r.width; w.H = r.height; w.U = Math.min(w.W, w.H * 16 / 9);
    w.tx = w.W * TARGET.x; w.ty = w.H * TARGET.y;
  }

  /* ---------- flow ---------- */

  title() {
    this.mode = 'title';
    this.boardFrom = null;
    void this.board.offer(null);
    for (const p of this.pens) p.reset();
    this.clearGhosts(false);
    this.fx.clear(); this.ink.clear();
    this.hud.coach(null);
    this.hud.skip(false);
    this.hud.setBest(this.best);
    this.hud.setInput(this.input, store(INPUT_KEY) !== null);
    this.hud.show('title', 'title');
    // two ghosts keep you company on the title, hovering either side
    const w = this.w;
    w.ghosts.push(
      new Ghost([], w, { home: { x: w.W * .17, y: w.H * .5 }, depth: .75 }),
      new Ghost([], w, { home: { x: w.W * .84, y: w.H * .4 }, depth: .75 }),
    );
  }

  /** play with the mouse or with your hands; hands start the camera first (and stay on until you switch back) */
  private async play(input: Input) {
    if (this.mode === 'camera') return;
    this.boardFrom = null;
    this.input = input;
    store(INPUT_KEY, input);
    this.hud.setInput(input);
    if (input === 'mouse') {
      if (this.hands.on) this.hands.stop();
      this.start();
      return;
    }
    if (!this.hands.on) {
      this.mode = 'camera';
      for (const p of this.pens) p.reset();
      this.hud.show('camera', 'camera');
      this.hud.cameraStatus('Starting the camera…');
      const err = await this.hands.start(s => this.hud.cameraStatus(s));
      if (this.mode !== 'camera') return;
      if (err) { this.hud.cameraError(err); return; }
    }
    this.start();
  }

  private start() {
    // whatever is still floating about goes out in a poof
    this.clearGhosts(true);
    this.fx.clear(); this.ink.clear();
    for (const p of this.pens) p.reset();
    this.director.reset(this.input === 'hands' ? { speed: PACE.hands.speed, gap: PACE.hands.gap, maxAlive: PACE.hands.maxAlive } : MOUSE);
    this.pending = [];
    this.awaySince = this.backSince = 0;
    this.runT = 0; this.readyT = 0;
    this.endAt = Infinity; this.graceUntil = 0; this.hurtT = -9;
    this.hearts = RULES.hearts; this.healing = 0;
    this.score = 0; this.chain = 0; this.banished = 0;
    this.log = [];
    this.ticket = this.board.ticket(this.input);
    this.w.speed = 1;
    this.hud.setHearts(this.hearts);
    this.hud.setScore(0);
    this.hud.setCombo(0);
    this.hud.show(null, 'play');
    this.mode = 'ready';
    if (!store(SEEN_KEY)) this.coachUntil = READY_T + 9;
    else this.coachUntil = 0;
    store(SEEN_KEY, '1');
    // the first hands run: one ghost to practise on, hovering, before the real ones come
    if (this.input === 'hands' && !this.practiced) {
      this.mode = 'practice';
      this.coachUntil = 0;
      this.practice = new Ghost(['dash'], this.w, { home: { x: this.w.W * .27, y: this.w.H * .4 }, depth: .8 });
      this.w.ghosts.push(this.practice);
      this.hud.skip(true);
    }
  }

  /** practice over (banished, or skipped): on to Ready / Set / Draw with a clean slate */
  private endPractice() {
    if (this.mode !== 'practice') return;
    this.practiced = true;
    if (this.practice?.live) this.practice.banish(this.w);
    this.practice = null;
    this.score = 0; this.chain = 0; this.banished = 0;
    this.log = [];
    this.hud.setScore(0);
    this.hud.setCombo(0);
    this.hud.skip(false);
    this.hud.coach(null);
    this.readyT = 0;
    this.mode = 'ready';
  }

  /** what to tell you while you practise, from what the camera sees */
  private practiceCoach(now: number) { return this.hands.coach(now); }

  private pause(why: 'you' | 'away' = 'you') {
    if (this.mode !== 'play' && this.mode !== 'ready' && this.mode !== 'practice') return;
    this.resumeTo = this.mode;
    this.mode = 'paused';
    this.pauseFor = why;
    this.backSince = 0;
    for (const p of this.pens) p.reset();
    this.hud.pauseReason(why);
    this.hud.show('pause', 'paused');
  }

  private resume() {
    if (this.mode !== 'paused') return;
    this.mode = this.resumeTo;
    this.awaySince = 0;
    this.last = performance.now();
    this.hud.show(null, 'play');
  }

  private gameOver() {
    this.mode = 'over';
    for (const p of this.pens) p.reset();
    this.hud.coach(null);
    this.hud.setCombo(0);
    // the ones still out stop where they are and gloat
    for (const g of this.w.ghosts) if (g.kind === 'heart') g.leave(this.w); else if (g.live) g.hover(this.w);
    const isBest = this.score > this.best;
    if (isBest) { this.best = this.score; store(BEST_KEY, String(this.best)); }
    this.hud.over({ score: this.score, banished: this.banished, seconds: this.runT, best: this.best, isBest });
    this.hud.show('over', 'over');
    void this.board.offer({ ticket: this.ticket, mode: this.input, score: this.score, seconds: this.runT, log: this.log });
  }

  /** the leaderboard, over the title or the game-over screen; it opens on the way you play */
  private openBoard() {
    if (this.mode !== 'title' && this.mode !== 'over') return;
    this.boardFrom = this.mode;
    this.hud.show('board', this.mode);
    void this.board.show(this.input);
  }

  private closeBoard() {
    if (!this.boardFrom) return;
    this.hud.show(this.boardFrom, this.boardFrom);
    this.boardFrom = null;
  }

  /** what happened, for the leaderboard: [hundredths of a second into the run, what, ...] (api/_lib/rules.ts) */
  private note(...e: number[]) {
    if (this.mode === 'play') this.log.push([Math.round(this.runT * 100), ...e]);
  }

  private clearGhosts(poof: boolean) {
    if (poof) for (const g of this.w.ghosts) g.banish(this.w);
    else this.w.ghosts = [];
  }

  /* ---------- casting ---------- */

  private stroke(pts: Pt[]) {
    const w = this.w;
    // only ghosts whose symbols have had a moment to show
    const live = w.ghosts.filter(g => g.live && g.front && w.t - g.born > .15);
    const wanted = new Set<SymbolId>(live.map(g => g.front!));
    const read = this.rec.read(pts, Math.max(24, w.U * .03), wanted);
    if (recorder && this.input === 'hands') {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      recorder.log('stroke', { mode: this.mode, read: read?.id ?? null, any: this.rec.read(pts, Math.max(24, w.U * .03))?.id ?? null, wanted: [...wanted],
        n: pts.length, box: [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)], screen: [w.W, w.H] });
    }
    if (this.mode !== 'play' && this.mode !== 'practice') { this.ink.finish(pts, null); return; }
    // hands: a shape nobody is showing is a stray move, not a miss: no cast, the combo stays
    if (!read || (this.input === 'hands' && !wanted.has(read.id))) { this.ink.finish(pts, null); return; }
    const id = read.id, color = SYMBOLS[id].color;
    this.ink.finish(pts, color);

    if (id === 'bolt' && wanted.has('bolt')) { this.storm(live); return; }
    const hit = live.filter(g => g.front === id);
    if (!hit.length) {
      // drew something real that nothing is showing: show what it read as, and the combo breaks
      const c = centroid(pts);
      this.fx.mark(this.art.glyphs[id], c.x, c.y, w.U * .075);
      this.setChain(0);
      this.note(EV.miss);
      return;
    }
    // logged before the banishing, which can bring a heart ghost's heart (logged after it)
    this.note(EV.hit, hit.length, hit.filter(g => g.slots.length === 1).length);
    this.setChain(this.chain + 1);
    const mult = this.mult();
    let kills = 0, gained = 0;
    for (const g of hit) {
      const s = g.strip(w, this.art)!;
      this.fx.knock(this.art.glyphs[s.id], s.x, s.y, s.size);
      const p = RULES.points * mult;
      gained += p;
      this.fx.score(`+${p}`, color, s.x, s.y - s.size * .25, w.U * .024);
      if (g.slots.length) g.flinch(w);
      else { kills++; this.banish(g); }
    }
    if (kills > 1) {
      const bonus = RULES.multiKill * (kills - 1) * mult;
      gained += bonus;
      this.fx.score(`${kills} at once! +${bonus}`, '#ffe08a', w.W / 2, w.H * .24, w.U * .03);
    }
    // a beat of hit-stop on a banish, a little longer for several
    if (kills) this.stopUntil = this.clock + (kills > 1 ? .09 : .055);
    this.addScore(gained);
  }

  /** the bolt: a felt bolt slams onto every ghost out there, one after another, and each one goes */
  private storm(live: Ghost[]) {
    const w = this.w, bolt = this.art.glyphs.bolt;
    this.setChain(this.chain + 1);
    const mult = this.mult(), order = [...live].sort((a, b) => a.x - b.x);
    this.note(EV.bolt, order.reduce((n, g) => n + g.slots.length, 0), order.length);
    let gained = 0;
    order.forEach((g, i) => {
      const delay = .06 + i * .07, n = g.slots.length, at = g.glyphAt(w, this.art, 0);
      this.fx.strike(bolt, g.x, g.y - g.box(w).w * .1, g.box(w).w * 1.6, delay);
      this.pending.push({ g, at: this.clock + delay + .1 });
      const pts = n * RULES.points * mult;
      gained += pts;
      this.fx.score(`+${pts}`, SYMBOLS.bolt.color, at.x, at.y, w.U * .024);
    });
    this.addScore(gained);
  }

  private banish(g: Ghost) {
    g.banish(this.w);
    this.banished++;
    if (g.kind === 'heart') this.heal(g);
  }

  /** a heart ghost's heart flies up to the HUD; at full hearts it's worth points instead */
  private heal(g: Ghost) {
    // a bolt's last strike can land after the run is over: too late for anything
    if (this.mode !== 'play') return;
    if (this.hearts + this.healing >= RULES.hearts) {
      this.note(EV.bonus);
      this.addScore(50);
      this.fx.score('+50', SYMBOLS.heart.color, g.x, g.y - g.box(this.w).w * .6, this.w.U * .026);
      return;
    }
    const slot = this.hearts + this.healing;
    this.note(EV.heal);
    this.healing++;
    this.fx.heart(this.art.heart, g.x, g.y, this.w.U * .05, () => this.hud.heartSlot(slot), () => {
      this.healing--;
      // too late: the last heart already went
      if (this.mode === 'over' || this.endAt !== Infinity) return;
      this.hearts = Math.min(RULES.hearts, this.hearts + 1);
      this.hud.setHearts(this.hearts);
    });
  }

  private hurt() {
    if (this.clock < this.graceUntil || this.mode !== 'play') return;
    this.note(EV.hurt);
    this.hearts--;
    this.graceUntil = this.clock + RULES.grace;
    this.hurtT = this.clock;
    this.setChain(0);
    this.hud.setHearts(this.hearts);
    this.hud.shake();
    if (this.hearts <= 0) this.endAt = this.clock + .9;
  }

  /** the beat builds with the difficulty, and turns up the dread when you're down to your last hearts */
  private beatLevel() {
    if (this.mode === 'title' || this.mode === 'over' || this.mode === 'camera') return 0;
    if (this.mode === 'ready' || this.mode === 'practice') return 1;
    if (this.hearts <= 2) return 4;
    const D = Director.level(this.runT);
    return D > .55 ? 3 : D > .25 ? 2 : 1;
  }

  private mult() { return Math.min(RULES.maxMult, 1 + Math.floor((this.chain - 1) / RULES.comboStep)); }

  private setChain(n: number) {
    this.chain = n;
    this.hud.setCombo(n);
  }

  private addScore(n: number) {
    if (!n) return;
    this.score += n;
    this.hud.setScore(this.score, true);
  }

  /* ---------- the frame ---------- */

  private step(dt: number) {
    const w = this.w, now = performance.now() / 1000;
    this.music.level = this.beatLevel();
    this.music.muffled = this.mode === 'paused';
    this.frameDt = dt;
    if (this.hands.on) this.handsStep(now, dt);
    // paused, everything holds still, the scene included
    if (this.mode === 'paused') { w.dt = 0; return; }
    this.clock += dt;
    // hit-stop freezes the ghosts for a beat; the scene and your stroke keep going
    w.dt = this.clock < this.stopUntil ? 0 : dt;
    w.t += w.dt;

    if (this.mode === 'ready') {
      const before = this.readyT;
      this.readyT += dt;
      for (const [at, text] of CUES) if (before < at && this.readyT >= at) this.hud.cue(text);
      if (this.readyT >= READY_T) this.mode = 'play';
    }
    if (this.mode === 'practice') {
      this.hud.coach(this.practiceCoach(now));
      if (this.practice && !this.practice.live) { this.hud.coach('Nice one. Here they come!'); this.endPractice(); }
    }
    if (this.mode === 'play') {
      this.runT += w.dt;
      if (this.endAt === Infinity) this.director.update(w, this.runT, this.hearts);
      if (this.clock >= this.endAt) this.gameOver();
    }
    // the first run gets a word of help until the first ghost goes
    const coach = this.mode === 'play' && this.readyT + this.runT < this.coachUntil && this.banished === 0;
    if (this.mode !== 'practice') this.hud.coach(coach ? 'Draw the shape you see above a ghost' : null);

    for (const p of this.pending) if (this.clock >= p.at && p.g.live) this.banish(p.g);
    this.pending = this.pending.filter(p => this.clock < p.at);

    for (let i = w.ghosts.length - 1; i >= 0; i--) {
      const g = w.ghosts[i], ev = g.update(w);
      if (ev === 'reached') this.hurt();
      else if (ev === 'remove') w.ghosts.splice(i, 1);
    }
    this.fx.update(w.dt);
    this.ink.update(dt);
  }

  /** hands mode, every frame: the pen's timeouts, your framing, the ghosts' aim, walking off, the cursor and menus */
  private handsStep(now: number, dt: number) {
    const h = this.hands, w = this.w;
    if (recorder && (this.mode !== this.loggedMode || now - this.loggedT >= 1)) {
      if (this.mode !== this.loggedMode) recorder.log('mode', { mode: this.mode });
      else recorder.log('stats', { report: h.report(), render: Math.round(1 / Math.max(1e-3, dt)), target: [Math.round(w.tx), Math.round(w.ty)],
        frame: [Math.round(h.player.ox), Math.round(h.player.oy), Math.round(h.player.s * 1000) / 1000], ghosts: w.ghosts.length, hearts: this.hearts });
      this.loggedMode = this.mode; this.loggedT = now;
    }
    h.pen.tick(now);
    h.player.frame(w.W, w.H, dt);
    // the ghosts fly at you: your chin, eased so they don't jerk about when you move
    const at = this.mode !== 'title' ? h.player.target(now) : null, k = 1 - Math.exp(-dt * 3);
    w.tx += ((at?.x ?? w.W * TARGET.x) - w.tx) * k;
    w.ty += ((at?.y ?? w.H * TARGET.y) - w.ty) * k;

    // out of view for a moment pauses the run; back in view for a moment carries on
    const here = h.present(now);
    if (this.mode === 'play' || this.mode === 'ready') {
      if (here) this.awaySince = 0;
      else if (!this.awaySince) this.awaySince = now;
      else if (now - this.awaySince > HANDS.away) this.pause('away');
    } else if (this.mode === 'paused' && this.pauseFor === 'away') {
      if (!here) this.backSince = 0;
      else if (!this.backSince) this.backSince = now;
      else if (now - this.backSince > HANDS.back) this.resume();
    }

    // the cursor, and pressing menu buttons by holding a fingertip on them
    const c = h.pen.cursor, menus = this.mode === 'title' || this.mode === 'over' || this.mode === 'paused' || this.mode === 'camera';
    this.hud.cursor(c.visible, c.x, c.y, c.drawing, c.drawing);
    this.hud.light(h.lowLight());
    this.hud.dwell(menus && c.visible ? c : null, dt, HANDS.dwell);
    if (this.hud.debugging) this.hud.debugText(h.report());
  }

  private render() {
    const w = this.w;
    // the felt is soft-focus: it doesn't need every device pixel, and the GPU is glad of it
    // with the camera on, the tracking needs the GPU too (every frame it reads goes through it): draw at fewer pixels
    const dpr = Math.min(devicePixelRatio || 1, this.hands.on ? HANDS_DPR : MAX_DPR);
    this.gl.resize(w.W, w.H, dpr);
    this.gl.clear(11 / 255, 10 / 255, 31 / 255);
    const fit = this.scene.fit(w.W, w.H);
    // far (small) ghosts first, so nearer ones overlap them
    const order = [...w.ghosts].sort((a, b) => a.box(w).w - b.box(w).w);
    this.comp.prepare(order, w, dpr, this.scene.lights(fit, this.clock));
    const now = performance.now() / 1000;
    this.scene.draw(fit, dpr, this.clock, i => {
      // you stand in front of the far graves, behind the ghosts that are close
      if (i === this.front && this.hands.on) this.hands.player.draw(dpr, now, this.frameDt);
      this.comp.paintAfter(i, dpr);
    });

    // symbols on top of everything, so a ghost behind a tree can still be read
    const p = this.paint;
    p.dpr = dpr;
    for (const g of order) g.drawSymbols(p, w, this.art);
    this.fx.draw(p);
    this.ink.draw(p, this.mouse.live ?? this.hands.pen.live, w.U);

    // a ghost reached you: a soft pink flush at the edges
    const k = Math.max(0, 1 - (this.clock - this.hurtT) / .7);
    if (k > 0) p.image(this.vignette(), 0, 0, w.W, w.H, k);
  }

  private vignette() {
    const w = this.w, cw = Math.max(2, Math.round(w.W / 4)), ch = Math.max(2, Math.round(w.H / 4));
    if (this.flush && this.flush.width === cw && this.flush.height === ch) return this.flush;
    if (this.flush) this.paint.forget(this.flush);
    const c = this.flush = document.createElement('canvas'), g = c.getContext('2d')!;
    c.width = cw; c.height = ch;
    const gr = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * .35, cw / 2, ch / 2, Math.max(cw, ch) * .75);
    gr.addColorStop(0, 'rgba(255, 84, 104, 0)');
    gr.addColorStop(1, 'rgba(255, 84, 104, .4)');
    g.fillStyle = gr;
    g.fillRect(0, 0, cw, ch);
    return c;
  }
}

function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}
