# Anvil & Acre

An isometric real-time strategy game in the classic build-up-and-conquer style. Start with a Town Hall and three
villagers, gather food, wood, stone and gold, raise houses and workshops, climb through four ages of technology and
outlast every rival on the map.

**Play it:** open `index.html` in any modern browser, or serve the folder with any static server
(`python3 -m http.server`). Pure HTML5 / JavaScript: no build step, no dependencies, no external assets. Every tree,
building and soldier is drawn procedurally at runtime, then run through a grain-and-posterise pass so the world
looks like the pre-rendered sprites of a late-nineties strategy game. Works on desktop (mouse + keyboard) and on
phones and tablets (tap, drag, pinch).

## What's in the box

- **Four ages** — Dawn, Hearth, Forge and Empire. Each one changes the look of every building (thatch → shingle →
  red tile → slate and gold) and unlocks new buildings, units and technologies.
- **Peoples** — Romans, Huns, Norse, Egyptians, Gauls and Greeks, each with one unique warrior (Praetorian, Steppe
  Archer, Hirdman, Medjay, Gaesatae, Phalangite) and one modest bonus. Pick one or draw at random.
- **Islands and ships** — an Islands map type puts every people on its own island with a little stone and gold, and
  the rich deposits out on neutral isles. Docks build Fishing Boats, Transports that carry eight, and War Galleys;
  bots fish, settle the isles and invade by sea.
- **Economy** — berries, shore and deep-sea fish, forests, stone outcrops and gold veins, plus farms that never run out. Drop-off camps,
  housing, population caps, rally points, idle-villager cycling.
- **20 buildings** — Town Hall, House, Farm, Granary, Lumber Camp, Mining Camp, Dock, Barracks, Archery Range, Stables,
  Blacksmith, Watchtower, Hall of Scholars, Keep, Siege Workshop, the Monument (an alternative victory), and
  palisade and stone walls with gates that only your own people can pass.
- **Garrisons** — villagers and foot soldiers shelter inside the Town Hall, towers and keeps, which then shoot more
  arrows. The Town Bell pulls every villager in and sends them back to work afterwards.
- **Resources tell you what is left** — they light up under the pointer, and a click shows how much remains, how many
  loads that is, who is working it and how many more villagers can reach it.
- **Villagers look after themselves** — they run from soldiers, take cover in the nearest building with room, and go
  back to the job they left once the danger passes. Send a crowd at one tree and they spread over the stand around it
  rather than queueing on one tile.
- **Saving** — autosave every minute, Continue from the title screen, and text export/import to move a match between
  devices.
- **17 units** — Villager, Spearman, Swordsman, Archer, Crossbowman, Horseman, Knight, Catapult, three boats and six
  unique warriors, with a rock-paper-scissors of bonuses (spears beat horses, horses beat archers, archers beat
  infantry, siege beats walls).
- **19 technologies** — weapon, armour and range lines at the Blacksmith; carrying yoke, ox cart, axes, picks,
  ploughs and muster at the Hall of Scholars; Homespun at the Town Hall.
- **Bot opponents** — up to five rivals on three difficulties. They gather, build, save up for the next age,
  research, raise armies, raid, wall their towns, ring the bell, repair, defend and rebuild, using exactly the same
  rules as the player. Early on they only attack whoever has hurt them; each age makes them bolder.
- **Procedural maps** — four terrains (Meadow, Desert, Tundra, Highlands), four sizes up to 144×144, seeded so a map
  can be replayed. Fog of war with soft edges, a diamond minimap, and an optional revealed map.
- **Settings** — map type and size, number of rivals, difficulty, starting resources, starting age, population
  cap, game speed, your people, player colour, map seed.
- **Feedback** — floating alerts with click-to-jump, minimap pings, a synthesized soundscape (no audio files), and a
  final scoreboard.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Select | Left click, drag a box, Shift to add, double-click for all of a type | Tap |
| Command | Right click: move, gather, build, repair or attack by target | Tap ground or target with units selected |
| Camera | Arrow keys, middle-drag or Space-drag, wheel to zoom, click the minimap | Drag to pan, pinch to zoom |
| Hotkeys | Letters on the command buttons (Q W E R T Y / A S D F G / Z X C V B); **H** Town Hall, **.** idle villager, **,** whole army, **Enter** last event, **Ctrl+1–9** / **1–9** groups, **Delete**, **Esc** | Hold a finger still to start a selection box |
| Walls | Pick a wall, then click and drag a run; click a wall piece with a gate to replace it | Tap one end, then the other |

## Project layout

```
index.html              entry point (classic scripts in order, no bundler)
css/style.css           interface styling
js/core/                helpers, A* pathfinding, seeded RNG and value noise
js/data/                ages, terrains, buildings, units, technologies (all balance lives here)
js/engine/              isometric renderer (procedural art, sprite caches, fog), input, audio synth
js/game/                world generation, players/units/buildings and the simulation, bot AI, DOM UI, game controller
docs/DESIGN.md          design notes and roadmap
tests/                  Playwright smoke test, bot-only simulations, profiler, thumbnail renderer
```

## Development

```
python3 -m http.server 8000        # serve, then open http://localhost:8000/
node tests/datacheck.js            # cross-check the data tables
node tests/smoke.js                # end-to-end smoke test with screenshots in tests/shots/
node tests/botsim.js 30 hard tundra  # watch three bots play for 30 game-minutes
node tests/perf.js                 # frame-time on a busy large map
node tests/thumb.js                # regenerate thumb.png
```

The tests expect Playwright's Chromium; adjust the paths at the top of `tests/lib.js` for your machine.

## Design notes

See `docs/DESIGN.md` for the pillars, the systems as implemented and the roadmap.

## Licence and independence

All rights reserved; see `LICENSE`. The game contains no third-party code, artwork, fonts or audio: every graphic is
drawn procedurally at runtime and every sound is synthesized at runtime, both from original code in this repository.

Anvil & Acre is an independent work by Cycle Start Studios. It is not affiliated with, endorsed by, sponsored by,
or connected to any other game, developer or publisher, and uses no trademarks of any other company. It takes the
conventions of the real-time strategy genre, which are ideas rather than protected expression, and shares no names,
art, text, audio or code with any other game.
