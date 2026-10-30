# Halloween 2016 Doodle ("Magic Cat Academy"): reference frames

Source: `Halloween 2016 Doodle - Google Doodles - Google Chrome 2026-10-29 14-39-59.mp4` (4:37, 1920x1080 @ 60fps).
All frames are cropped to the game canvas only (browser chrome removed). PNGs are 1573x885.
The recording zooms partway through, so some frames come from a smaller 1449x815 canvas. The `*_clean_plate` backgrounds were rescaled to 1573x885 for compositing.
Filenames in `06_sequences/` include the video timestamp, e.g. `f_004_00m22_07s.jpg` = 0:22.07.

Level map in the video:
| Level | Setting | Video time |
|---|---|---|
| (1-2) | Kitchen (fireplace, cauldron, pans) | 0:00 – 0:35 (recording starts mid-level, boss = cup/jar ghost) |
| 3 | Potion lab (pink floor, cabinets, chalk-drawn flasks) | 0:37 – 1:55 |
| 4 | Gym (volleyball net, court lines, broom) | 1:57 – 3:29 |
| 5 | Castle wall cutscene -> grey storm sky, giant ghost boss | 3:31 – 4:19 |
| outro | Sunset sky, friends on castle wall, end card | 4:20 – 4:37 |

---

## Folders

- `01_backgrounds/`: one clean plate per level plus a gameplay+HUD frame for each.
  `L1/L2/L3_*_clean_plate.png` are **composites** of two frames, because the cat is always on screen during gameplay. Kitchen: the cat's tail was patched out. Lab and gym: the transition wipe was patched with a pre-level frame.
- `02_ghost_states/`: the small ghost's lifecycle frame by frame (numbered in state order).
- `03_interactions/`: crowds, overlapping ghosts, simultaneous kills, ghost reaching the cat.
- `04_ui_hud/`: Level card, Ready/Set/Draw, combo badge, hearts, Congrats chalkboard, wipe transitions.
- `05_cat_player/`: cat idle and its cast pose for each symbol, hurt, level-clear and exit.
- `06_sequences/`: 6–15 fps JPG bursts of the key animations, for stepping through timing.

---

## Small ghost: observed state machine

```
            ┌──────────┐
  wave ───► │  SPAWN   │  symbols appear first, body fades 0 -> 100% opacity (~0.6–0.8 s)
            └────┬─────┘  spawns at screen edges / top / bottom, never near the cat
                 ▼
            ┌──────────┐
            │ APPROACH │  floats in a straight line toward the cat, slow, gentle bob
            │  (idle)  │  face = smug grin; symbol queue drawn above head
            └────┬─────┘
     player draws │ symbol == FIRST symbol in queue
                 ▼
            ┌──────────┐
            │   HIT    │  first symbol removed, face -> ">_<" squint, little shake/impact lines,
            │ (flinch) │  "+N" score pops above in that symbol's colour; ~0.3 s, then back to APPROACH
            └────┬─────┘
       queue empty│                      reaches cat
                 ▼                           │
            ┌──────────┐               ┌─────▼──────┐
            │   DEATH  │               │  ATTACK    │ ghost overlaps cat -> one heart empties
            │  (poof)  │               │            │ (HUD heart becomes outline), ghost poofs
            └──────────┘               └────────────┘ (only one clear example at 2:20.3; heart drains ~0.2 s after contact)
   body splits into 3–4 white wisp blobs that drift up, shrink to dots and fade (~0.4–0.5 s)
```

Notes:
- **One drawing hits every ghost** whose *front* symbol matches. That's where multi-kills and big combos come from (see `03_interactions/04,05`).
- Queue lengths vary from 1 to 5 symbols, e.g. `^^^^`, `VVVV`, `||||`, `^-|^`. Mixed queues appear in later levels.
- Ghosts lose symbols one at a time. Each hit gives a flinch, and only the last hit gives a poof.
- **Lightning carrier ghost**: has a ⚡ icon in its queue. Drawing the ⚡ shape kills **every ghost on screen**: vertical lightning bolts at each ghost, big multi-score popups, combo jumps (x11 -> x19). See `02/11-13` and `06_sequences/lightning_screen_clear`.
- **Heart ghost**: after you lose a heart, a small cat-faced ghost with a pink ♥ symbol spawns at the screen edge. Drawing a heart kills it, and a heart flies to the HUD and refills. See `02/16-18` and `06_sequences/heart_ghost_cycle`.
- **Far/faded ghosts**: on Level 4 the next wave's symbols and translucent bodies are visible before they fully arrive (`02/19`).
- **Level 5** ghosts are drawn much smaller around the giant boss (`02/20`).

## Ghost-to-ghost interaction

- **No collision or separation.** Ghosts overlap freely and stack into clumps (`03/06,07`). Ghosts further down the screen draw on top, so the draw order is a y-sort.
- Symbol queues also overlap when ghosts bunch up. The game doesn't move them apart.
- **Waves are formations**, often mirrored left/right: L2 at 1:13 and L3 at 2:52 both fade in at once in symmetric pairs (`03/01, 03/09`).
- Ghosts walk **under the HUD combo badge** (`03/12`). The badge is a translucent overlay.
- Ghosts each move independently toward the cat. There's no flocking, so groups converge as they close in.

## Symbols & colour coding

| Symbol | Stroke / icon colour |
|---|---|
| `—` horizontal | red / pink-red |
| `\|` vertical | blue / lavender stroke |
| `^` caret | green |
| `V` | yellow |
| `⚡` lightning | yellow-cream stroke, blue-white bolts |
| `♥` heart | pink |

The player's stroke trails behind the pointer as a thick rounded line, tapered at the start with a white dot at the pen tip. It fades after it's recognised. Score popups use the colour of the symbol that triggered them.

## Cat

idle (slight bob) -> cast pose for each symbol (the symbol is drawn above its head, the wand swings and sparkles) -> back to idle.
Hurt when a ghost reaches it. Level clear: sparkle, summons broom, flies off screen to the right. Between levels it rides the broom.

## Level flow / UI

`Level N` card -> `Ready` -> `Set` pills slide in from the left -> `Draw!` -> gameplay (5 hearts, score top-right, cat-head combo badge `xN` bottom-centre) -> boss -> `Congrats!` chalkboard showing the 5 boss doodles with check marks -> cat exits on broom -> horizontal black wipe -> next level.

## Aesthetic

- Flat painterly illustration with a **heavy grain/noise texture** over every surface. No hard outlines on the backgrounds.
- **Muted, desaturated palettes with one warm or cool light source** (fireplace glow, pink spotlight cone in the lab, cool spotlight cones in the gym).
- Characters are **simple white blobs with heavy black face shapes** (ghosts) or **black silhouette with yellow eyes** (cat). They stand out sharply against the muted backgrounds.
- Dominant colours (median-cut quantized from the plates):
  - Kitchen: `#4e444b #a5a0a5 #b9a39d #d4bbac #958c91 #eacaae`
  - Potion lab: `#52565e #c5908a #5f5c61 #41464e #887677 #af8580`
  - Gym: `#a8afc2 #8c93a6 #b3b8c8 #666f8a #969eb2 #c1c5d3`
  - Storm sky: `#8c8789 #aaa29e #989291 #b8afa9`
  - Sunset sky: `#ddcdc7 #f9e0c6 #e9d4c7 #f4dac5`
- HUD: hot-pink hearts, orange-yellow rounded score digits, dark rounded-rect pills with white text.
