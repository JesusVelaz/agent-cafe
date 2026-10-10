# Café turntable

Let people turn the café to four angles and look at it from every side, while agents keep working. Only agents and cats are clickable.

Prototyped in a throwaway copy of the renderer first (an artifact with the real scene and demo agents); this spec records what that preview settled.

## Experience

- **Turning.** Drag sideways on the café to spin it; on release it eases onto the nearest of four angles (a 5 px threshold keeps drags apart from clicks). Turn buttons sit in the stage's corner, and Q / E turn it when focus isn't in a text field. The angle is remembered across reloads. Reduced motion snaps instead of easing.
- **What turns.** Everything in the world: building, both floors, furniture, street, cars, walkers, the barista, agents, cats. Sky, clouds, weather, lighting grade, name tags, bubbles and the floor signs stay screen-fixed.
- **Walls follow the camera.** The two far sides of the building are drawn; the two near sides are cut away (exactly today's open diorama). The two sides nobody could see before get their own decor: the street side is a shop front (big windows and a door), the patio side has windows, a print, a sconce and a clock. Walls fade in and out during a turn.
- **The loft fades** when it is on your side of the building: solid from today's angle, about 77 % from the side views, 50 % when it is the nearest corner. Agents and cats upstairs are drawn solid on top.
- **Clicks.** Agents keep today's behaviour (select, open their thread, hover tooltip). Cats are clickable: a click pets them, with hearts floating up for 1.6 s. Nothing else is interactive.
- **No zoom** in this version.

## Renderer

- **Camera.** `iso()` turns world coordinates about the plot's centre (10, 8.5) by the camera angle before projecting. At angle 0 the projection is untouched. Turning about the plot (not the building) keeps the whole plot in today's 480 × 400 frame at every angle. Helpers: `depth(x, y)` (camera-space x + y; replaces every `x + y` sort key), `facing(nx, ny)` / `faceVisible` for vertical faces, `viewFace(dir)` for sprites, `turn` / `unturn` for screen-space passes (cloud shadows).
- **Boxes.** `box()` names its corners by where they land on screen, so the nearest corner is always C and the two visible faces keep their screen-relative shading. This alone makes most furniture correct from every side.
- **Fronts and backs.** Detail painted on one face (books, counter slats, cabinet doors, drawer lines, the espresso machine's front, sofa buttons) is drawn only when that face is visible. The sofa and armchair draw their parts nearest-last when turned. Chair backs go in front of or behind the sitter by camera. Cars put their wheels, windows and lamps on the sides you can see.
- **Walls.** Four sides (`L`, `R` as today, plus `F` street and `E` patio) as data; decor names its side. Wall colours follow their screen role (the wall reading as today's left wall takes the darker paint). String lights and the roof planter appear only with their wall.
- **Draw order.**
  1. outdoor things beyond a shown wall
  2. ground floor
  3. shown walls with decor (in a layer composited at partial opacity mid-turn)
  4. the nook under the loft
  5. ground-floor things behind the loft
  6. the loft (its own layer when faded, actors on top)
  7. everything else

  At angle 0 this reduces to today's order.
- **Sprites.** Agents, barista, walkers, the dog and cats rotate their world facing through the camera before choosing front/back frames and mirroring.
- **Frame rate.** 15 fps when still, 60 fps while a turn is under way.

## State and wiring

- Store: `viewAngle` (0–3 quarter turns), persisted in localStorage, with `turnView(±1)`.
- `CafeRenderer` owns the live camera angle (easing toward `viewAngle × 90°`), the drag, and hit-testing for agents then cats. `renderScene` returns cat hits alongside agent hits.
- `Cats.pet(id)` records the moment; the scene draws hearts from it.
- `CafeScene` renders the turn buttons and wires Q / E.

## Testing

- **Golden checksum** of today's render (several themes, agents and cats in view), recorded before any change: angle 0 must stay pixel-identical.
- Unit tests: camera maths (angle 0 is the identity; four quarter turns come back round), `viewFace`, face visibility per quarter, wall sides shown per quarter, loft opacity curve, store persistence, `Cats.pet`.
- `SNAP` snapshots gain `ANGLE=` for eyeballing every angle and a mid-turn frame.

## Known limits

- Halfway through a turn (45°) the café briefly reads as a near top-down view. It lasts a few frames.
- Small details not yet reviewed from behind: the till screen and desk monitors.
