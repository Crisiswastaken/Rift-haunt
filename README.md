# Haunt: a Halloween drawing game

Felt ghosts drift through a misty graveyard toward you. Draw the shape above a ghost to knock it off; knock off the
last one and the ghost bursts into felt wisps. One stroke hits every ghost showing that shape. It's a take on
Google's 2016 Magic Cat Academy doodle, with you in the middle where the cat was.

Play with your **hands**: the webcam cuts you out into the graveyard and you draw in the air with quick swipes.
Or play with the **mouse** (or a pen, or a finger on a touch screen). At the end of a run you can put your score on
the **leaderboard**, one for mouse & touch and one for hands.

```
npm install      # also fetches the hand-tracking models and wasm into public/vision/ (tools/fetch_vision.mjs)
npm run dev      # http://localhost:5173, with a working leaderboard kept in memory
npm test         # recogniser, director, hand-pen, real-footage replay and leaderboard tests
npm run build    # static site in dist/, works from any sub-path
python tools/build_assets.py   # rebuild public/assets from reference/generated
node tools/make_caps.mjs       # rebuild the leaderboard's score ceilings after changing PACE or RULES
```

## How it plays

| | |
|---|---|
| Ghosts | Fade in just inside the left or right edge or the top corners, at random: random gaps, now and then a quiet spell, sometimes one or two more right behind (mirrored, or sharing a front symbol so one stroke takes them all). Each carries 1 to 4 symbols and floats in on gusts. |
| Difficulty | Rises with time, not with how fast you clear: `D = 1 - exp(-t / 110)`, then a slow creep (+0.1 a minute, up to 1.4). Gaps shorten, rows lengthen, a few more come at once (never more than 5), and they get a little quicker (never more than 1.35×). |
| Shapes | Line across and line down from the start, V and roof from 0:15, the circle from 1:00. |
| Hearts | 5. A ghost that reaches you says boo and takes one, then you get a second's grace. |
| Heart ghost | Floats across the top while you're missing a heart. Draw the heart to win one back. |
| Storm ghost | A chance from 1:00 when there's a crowd. Draw its bolt and every ghost out there is struck; later its bolt can be behind another symbol. |
| Big ghost | A chance from 1:40: from the side, 4 or 5 symbols. |
| Score | 10 per symbol, times your combo (one more for every 4 strokes in a row that hit, up to ×5), +50 for each extra ghost banished by the same stroke. A stroke that reads as a shape nobody is showing breaks the combo. |

Hands mode is slower than the mouse (ghosts 0.8× as fast, gaps 1.3× as long, one fewer out at once), because drawing
in the air is. Tuned with a bot that draws one perfect stroke every so often: at 1.15 s a stroke (a quick mouse
player) it holds out for several minutes, at 1.6 s it goes down around four. All the numbers are in `PACE` in
`src/config.ts`.

Esc or P pauses (so does leaving the tab). Enter plays again from the title and game-over screens. M mutes.

## Leaderboard

After a run that scored, the game-over screen offers to put it on the leaderboard under a name (2 to 16 letters,
numbers, spaces and `. _ - '`). There's a board for **mouse & touch** and one for **hands**, a tab each; the run's
board is fixed by how it was played. Each name keeps its best score per board, and the last name used is remembered.

It lives in one serverless function (`api/leaderboard.ts`) and Upstash Redis: no database server to run. Nothing the
browser says is taken on trust, since anything in the page can be changed from the console:

- **A ticket per run.** When a run starts the game asks for one; it's signed by the server (HMAC), names the board,
  is good for one save and expires after 4 hours. Saving a run on the other board, or with a made-up ticket, fails.
- **The run, not the score.** The game sends a log of what happened (each hit with how many symbols and ghosts, each
  miss, each heart lost, bolts, heart ghosts) and the server works the score out again with the game's rules
  (`api/_lib/rules.ts`). It has to come to exactly the score claimed, or the save is turned away. So does a log that
  breaks the rules: more than 8 strokes in a second, heart ghosts from nowhere, a run that didn't end with the
  last heart, or one longer than its ticket has existed.
- **A ceiling.** No run can pass what a flawless player could have done in that time. `tools/oracle.ts` plays the real
  director with a bot that strokes every 0.12 s and never misses, rushing or waiting for multi-kills; the most any of
  180 such runs reached at each moment, plus half again, is the cap (`api/_lib/caps.ts`). For mouse & touch that's
  4,630 at a minute and 30,030 at five; a test checks the caps still sit above fresh flawless runs.
- **Names** are tidied and checked on the server for slurs and profanity, including spaced-out, stretched, accented
  and leetspeak spellings (`api/_lib/names.ts`; the word list is ROT13'd and never sent to the browser). Names only
  ever go onto the page as text.
- **Limits.** Saves only from the game's own pages (and those of `LEADERBOARD_ORIGINS`, tryrift.fun by default), 30
  a minute and 400 an hour per address, kept as a keyed hash, never the address itself (generous, since a mobile
  network can put a great many players behind one address). Reading the board is cached at the edge for 10 s.
- **Clean-up.** With `LEADERBOARD_ADMIN_KEY` set, an entry can be taken off:
  `curl -X DELETE -H "Authorization: Bearer $KEY" "https://<site>/api/leaderboard?mode=hands&name=<name>"`.

Turned-away runs are logged with the reason. Like any game that runs in the browser it can't be made cheat-proof (a
script that plays perfectly is still playing), but editing the score, the page or the request gets nowhere, and
nothing can be claimed past flawless play. Saving is off with `?debug`, which exposes the game in the console.

## Deploying

The game is a static site plus one function, made for Vercel:

1. Import the repo as a Vercel project (it's detected as Vite: `npm run build`, output `dist`; `npm install` fetches
   the hand-tracking models).
2. Add **Upstash Redis** from the project's Storage tab (the free tier is plenty). It sets `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`, which is all the leaderboard needs; without them the game plays and the leaderboard says it
   isn't set up.
3. Optional: `LEADERBOARD_SECRET` to sign tickets with (otherwise one is derived from the Redis token),
   `LEADERBOARD_ADMIN_KEY` (16+ characters) for taking entries off, `LEADERBOARD_ORIGINS` (comma-separated) if the
   game is served through a site other than tryrift.fun.
4. Set `VITE_SITE_URL` in `.env` to the game's address (it's `https://tryrift.fun/halloween/` now) for link previews.

To serve it under a path of another site, rewrite that path to this project (e.g. `/halloween/:path*` to
`https://<this-project>.vercel.app/:path*`): the game and its API both use relative URLs. `vercel.json` sets caching
(a year for the hashed JS and CSS, a week for art and models) and a few security headers.

## Hands mode

- **Drawing:** point your index finger to draw; close your fist (or open your hand) to move without drawing. Your
  fingertip is the pen. The firefly is dim and small while the pen is up (just aiming) and bright and glowing while
  it's down, leaving ink. Holding still while pointing for about half a second also ends a stroke, for players who
  never make a fist. Putting your arm down to your side is never cast.
- **Wrong shapes:** a shape that no ghost is showing is ignored in hands mode: nothing is cast and the combo stays.
- **Light:** when the camera drops below 25 fps (a dim room slows webcams down), a small line says so; add light.
- **Reach:** your hand moves in a box anchored to your shoulders (2.2 x 1.42 shoulder widths) and that box is the whole
  screen, so an arm's sweep reaches every corner whether you stand at arm's length or two metres back.
- **You on screen:** the camera picture, cut out by the body model's person mask, mirrored and moonlit, stands at the
  bottom centre: sized from your shoulders so your face is about 13% of the screen tall, never floating (standing close,
  it's enlarged and lowered until it reaches the bottom). It's taken from a full-resolution crop of the part that's on
  screen, so it stays sharp when you stand back. The ghosts fly at your chin.
- **First time:** one practice ghost hovers with a line across on it, and the coaching line reads what the camera sees:
  "Point your finger to draw · Make a fist to move" until you point, then "Now swipe". Skippable.
- **Menus:** hold the firefly on a button for about a second; a gold ring fills and it presses. Clicks still work.
- **Walk off** for 2.5 s mid-run and it pauses ("Where did you go?"); come back and it carries on.
- **D** shows what the tracking is doing: camera fps, each model's rate and lag, which hand, the speed, whether it's drawing.
- **Privacy:** everything runs in the browser; no frame leaves the device. The camera stops when you switch to the
  mouse.

How it works, after RIFT-Desktop's Fruit Ninja slicer (`rift/games/fruit_ninja.py`), tuned on recordings of a real
player in this game:

- Two MediaPipe models run side by side in workers, both on the CPU (on a real player the hand model found the hand in
  84% of frames on the CPU and 33% on the GPU, and the GPU is left to the game, which draws at a device pixel ratio of 1
  while the camera is on). The body model (pose landmarker lite) reads the whole 640-wide frame: you, your shoulders,
  which hand is up, your arms, and the person mask. The hand model reads the whole frame at 640 wide, so a lost hand is found again in a frame or two;
  only a player more than about two metres away gets a crop around the drawing arm cut from the full 1280 x 720 frame.
- The pen point is the index fingertip while you point (the palm, kept where the fingertip was, otherwise). When the hand model misses a frame (a hand pointed
  at the camera, blurred, or lost in a dim room: up to 40% of frames) the cursor holds and a stroke coasts for a moment, then waits up to .5 s for the hand;
  the body model's arm is never the pen (it sat 100-300 px off the fingertip and drew strokes nobody made).
- RIFT's blade filter smooths it: a glitch gate (its tolerance grows with the gap between frames), a light One Euro
  track for the speed, a heavy aim filter that opens with speed above a jitter floor and stays heavy across the
  direction of motion, a still-hand deadzone and a small lead at speed.
- A stroke starts above 0.7 screens a second and ends after 0.12 s under 0.4 (long enough for the turn in a V); the slow
  tail is dropped. Every gap (coasting, lifting, hiding) stretches with how far apart the frames really come, since a
  dim room can slow a webcam to 15 fps or less.

Every threshold is in `HANDS` in `src/config.ts`.

**Debugging on real footage:** on the dev server every hands-mode session is recorded into `logs/<time>/` (gitignored):
`camera.webm` (the camera) and `log.jsonl` (every model result, the pen's state, every stroke and what it read as, the
rates each second). The video can be played back as Chrome's camera (`--use-file-for-fake-video-capture`, after
converting it to MJPEG with ffmpeg), so a session can be replayed through the real game as often as needed.

## The beat

Dark synthwave, synthesised live with Web Audio (`src/audio/beat.ts`, no audio files): 4/4 at 160 bpm in D minor, a
34-bar cycle (51 s) that never ends. **Riff**: a bright staccato arpeggio of stabs over four-on-the-floor kicks.
**Tear**: the riff melts flat, a noise cloud swells over a gritty low A, glissandi fall, then a beat of silence.
**Soar**: a near-pure sine lead high up, holding long notes and sliding between them over warm pads and a legato saw
bass that pumps against the kick, the drums kept light. **Storm**: the lead's first phrase again with the riff under
it and the drums back in full, ending on a long slide down an octave into the riff. The lead sits on top, the pads and
bass about 5 dB under it and the drums well back, so it wears well over a long run.

It builds with the difficulty: pads, the lead and soft stabs on the title; the bass when a run starts; drums and the
pump from D 0.25; sixteenth hats, stabs doubled an octave up, glass arpeggios and a backbeat under the lead from
D 0.55; and down to two hearts, everything shifts up a semitone, the bass and stabs are driven, and claps and a shaker
come in.
Pausing muffles it. M or the note button mutes it, and that's remembered. Browsers only allow sound after a click or
key, so it starts on the first one.

## How it's built

Vite + TypeScript, no framework. One runtime dependency, MediaPipe, loaded only for hands mode. About 28 KB of gzipped
JS for the game, 1.2 MB of art, and ~27 MB of tracking models and wasm (the body and hand models, 13.6 MB, and MediaPipe's wasm, 13.5 MB) fetched only when you pick hands.

| File | What it does |
|---|---|
| `src/config.ts` | Symbols, the ghost, `PACE` (how the ghosts come), `HANDS` (hand tracking), scoring. |
| `src/game/director.ts` | What spawns, when and where: random gaps, bursts and lulls around a time-based difficulty, the storm and big ghosts by chance with cooldowns, heart ghosts. |
| `src/game/game.ts` | The flow (title, mouse or hands, camera, practice, Ready / Set / Draw, play, pause, game over), casting, hearts, combo, score, the frame loop. |
| `src/game/hands.ts` | Hands mode as one piece: camera, tracking, you, the hand pen. |
| `src/input/hand/` | `camera.ts` (the webcam), `vision.ts` + `vision.worker.ts` + `vision-core.ts` (the body and hand models in two workers), `body.ts` (shoulders, which hand, the box mapped to the screen), `handpen.ts` (point to draw, fist to move), `filters.ts` (RIFT's blade filter), `gesture.ts` (finger poses, for the debug panel). |
| `src/debug/recorder.ts` | Records hands-mode sessions on the dev server (camera video and logs into `logs/`). |
| `src/render/player.ts` | You: the cut-out's textures, framing from your face, presence, where the ghosts aim. |
| `src/render/gl.ts` | A small WebGL renderer: textured quads with three blends, and a second program that draws you through the mask, mirrored and moonlit. The scene, ghosts, you and the top layer all go into one canvas. |
| `src/render/compositor.ts` | Puts each ghost between the scene's layers by how near it is, with haze, lantern light and a halo. |
| `src/game/ghost.ts` | The felt ghost and its state machine (spawn, approach, hit, banish, boo). |
| `src/game/fx.ts` | Knocked-off symbols, score pops, bolt strikes, the heart flying home, your stroke as a felt ribbon. Effects move and fade image assets only. |
| `src/input/recognizer.ts` | Stroke recogniser: straight strokes by angle, the rest by a $P point-cloud match against a family of templates per shape. |
| `src/input/pointer.ts` | `PointerPen` (mouse, pen, touch) and the `Pen` interface both pens implement. |
| `src/scene/scene.ts` | The v6b graveyard: 11 layers, lantern glow, fireflies, a slow parallax drift. |
| `src/audio/beat.ts`, `music.ts` | The score and the live player (lookahead scheduler, mute, muffle). |
| `src/ui/hud.ts` | Hearts, score, combo, cues, screens, the fingertip firefly and hold-to-press. |
| `src/ui/board.ts` | The leaderboard in the game: a ticket per run, the save form, the board with its two tabs. |
| `api/leaderboard.ts`, `api/_lib/` | The leaderboard function: `handler.ts` (the API), `rules.ts` (scoring a run's log), `caps.ts` (generated ceilings), `names.ts` + `name-shape.ts` (names), `store.ts` (Upstash over REST, or memory). |
| `tools/oracle.ts`, `tools/make_caps.mjs` | A flawless player against the real director, and the script that turns its runs into `caps.ts`. |
| `tools/build_assets.py` | Builds `public/assets` from `reference/generated`. |
| `tools/fetch_vision.mjs` | Copies MediaPipe's wasm and downloads the three models into `public/vision/` (runs on `npm install`). |

Draw order: the 11 scene layers back to front, the far ghosts after the mid trees, the middle ones after the back
graves (under the ground fog), you after the front graves, then the near ghosts; a ghost saying boo goes on top. Then
the symbols, effects and your stroke over everything, so a symbol is never hidden.

## Next

- **Parallax from your head:** every layer already has a `depth`; drive the drift in `Scene.draw` from the face
  position `Player` already tracks.
