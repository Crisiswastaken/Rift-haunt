# Hands mode: what's wrong and the fix plan (2026-10-31)

Evidence: the screen recording of the 11:12 session, its game log (`logs/2026-10-31T05-42-17`) and the earlier session
(`logs/2026-10-31T05-38-54`). Both logs replay through the real `HandPen` + `Recognizer` stroke for stroke, so every
number below is measured on real play, not guessed. Research notes and harnesses: `/tmp/haunt-code`, `/tmp/haunt-rec`,
`/tmp/haunt-research`, `/tmp/tv-bench` (temporary).

## What actually happened

| Complaint | What the footage and logs show | Cause |
|---|---|---|
| "Tracking is way off" | The hand was found in 1733 of 1733 play frames, ~28 ms behind the camera. The cursor sits on the knuckles, ~130 px below the fingertip, and only covered ~20% of the screen width | The pen is the **palm** (mean of landmarks 0,5,9,13,17), not the fingertip (`handpen.ts:115`); heavy rest filter + deadzone freezes slow moves (`filters.ts`) |
| "Doesn't read my finger drawing" | 5 windows, ~22 finger flicks: fingertip moved 3.5-5x the palm, pen speed peaked 0.19-0.69 vs the 0.7 needed, nothing drawn | Speed-only stroke start on the palm (`handpen.ts:231`, `config.ts:152`) |
| | 4 line-downs read as bolt / V | The hand's return move is part of the stroke; `let dev = 1` (`recognizer.ts:188`) blocks lines when there's any hook |
| | V split into two lines at its corner | Stroke ends after 0.12 s of slowing; corner pauses are 0.27-0.43 s |
| "Fist still draws" | 3 strokes drawn with a fist on every frame (11.1 s, 26.9 s, 41.5 s) | Hand shape is ignored. `gesture.ts` already classifies point / fist / open but only feeds the debug panel |
| "Pull my finger out again, acts like it never existed" | Not hand loss. Pointing again after a fist moves the fingertip, the palm barely moves, so the pen stays still | Same as row 1-2 |
| Lost combos | Arm dropping out of frame cast a V and a line with no ghost (25.9 s, 67.2 s); reads of shapes nobody shows break the combo | Missing-hand path casts the stroke; off-screen shapes are cast |
| (latent) | Shoulders are below the frame in 100% of session-2 frames but report visibility 0.96+, so the face-based fallback never runs | `body.ts:184` trusts out-of-frame joints |

Not the problem: detection rate, model speed (25-30 ms on CPU), lag, light (no losses despite the backlight).

## The fix, in order

### 1. Point to draw, fist to move (kills accidental strokes)
`handpen.ts` `step()`, using `gesture.ts` `pose()`:
- **Pen down:** POINT on 2 frames in a row (>= 50 ms). Index straightness >= .85 and >= .2 straighter than middle/ring
  (existing thresholds; keep pointing at .7 / .08).
- **Pen up:** FIST or OPEN on 3 frames in a row (>= 100 ms); trim the stroke back to the first fist frame. Fist =
  index <= .65 and middle, ring <= .70 (ignore thumb and little finger; today's rule needs all four, which misses fists).
- Single fist/blur blips and short dropouts hold the pen (real strokes blur into "fist" for 1-3 frames).
- **Still-pointing fallback** for players who never make a fist: pointing but still (< .15 screens/s) for 450 ms ends
  the stroke; it re-arms on speed > .4 or a fist -> point.
- **Hand leaves the frame mid-stroke:** drop the stroke, don't cast it.
- **Feedback:** cursor dim when the pen is up, glowing when down. The practice ghost teaches "point to draw, fist to move".

Replay check: the 4 fist strokes in session 2 go, the 28 others stay.

### 2. Fingertip is the pen (finger flicks get read)
- Pen point = index tip (landmark 8). When not pointing, palm + the last tip offset, so making a fist doesn't jump the cursor.
- A stroke starts at the tip position when pen-down is confirmed (the finger has finished uncurling, so no start jump).
- Same units across and down (today a horizontal swipe needs 1.57x the speed of a vertical one).
- Drop the 0.5 Hz rest filter + deadzone freeze; draw the ink from the light 6 Hz track the `Smoother` already runs
  (the heavy aim filter flattens the bolt and heart: -26 and -16 points of read rate).
- Reset all filter state, speed included, after a gap of more than 100 ms.

### 3. Reach box from the face when shoulders are off-screen (cursor reaches the whole screen)
- A shoulder only counts if it's inside the frame (y <= .95). Otherwise anchor at the nose, size from ear-to-ear.
- Freeze the box during a stroke. Retune its size on the replays so a seated player's fingertip range spans ~80% of the
  screen.

### 4. Stroke clean-up before reading (shapes read first time)
Measured on 83 real strokes: whole shapes read 74% -> 98%, accidental casts 6/7 -> 0/7, no hits lost.
- Hands mode: a read of a shape nobody is showing is dropped silently (no cast, combo kept) (`game.ts` `stroke()`).
- Cut a return over the stroke's own path (turn > 140 deg) before reading: real line-downs 11/21 -> 17/21.
- If the whole stroke isn't a wanted shape, try trimming an end hook (turn > 45 deg in the first/last 40%).
- Lines only within 35 deg of level or upright.
- Fix `let dev = 1` (`recognizer.ts:188`).

### 5. Tracking pipeline (fast, never-lost hand)
- Hand model gets the whole frame at 640x360 instead of a crop placed by the body model. The palm detector finds the
  hand on 95% of full frames, so a lost hand comes back in 1-2 frames; a wrong crop can hide it forever.
- Hand model on the GPU in its worker, CPU fallback (8.8 ms vs 18-29 ms, same landmarks). Pose stays on the CPU.
  The README notes GPU found the hand less often under game load, so check with the D panel and keep CPU if it's worse.
- Run the hand model on every camera frame. Warn the player when the camera drops below 25 fps (dim room).

### 6. Make the real-footage test real
`tests/hands-replay.test.ts` has been skipped (no fixtures). Add trimmed copies of both logs (landmarks only) with the
hand-labelled strokes and assert: nothing cast while in a fist, a V stays one stroke, line-down never reads as bolt,
no off-screen shapes cast, hit rate floor. Every change above is tuned against this before a live test.

## Not doing
- MediaPipe GestureRecognizer: on these recordings it catches only 31-52% of sideways / at-camera pointing.
- Pinch, dwell, speed-only: worse for a webcam (pinch is a few pixels) or the Midas-touch problem.
- Other models (Holistic, TF.js): same models or worse; Holistic has the body-crop bug we're removing.
- MediaStreamTrackProcessor frame path (~8 ms): later, if latency is still felt.

## Risks
- "Zero accidental strokes" holds only if the player closes the fist to move. Pointing while moving between shapes still
  draws; the 450 ms pause rule and dropping off-screen shapes are the fallback.
- All thresholds come from one player, two sessions. There are no bolts or hearts in the recordings.
- GPU delegate behaviour while the game renders is unmeasured.
