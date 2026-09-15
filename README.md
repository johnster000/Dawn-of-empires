# Dawn of Empires

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
- **Economy** — berries, shore fish, forests, stone outcrops and gold veins, plus farms that never run out. Drop-off camps,
  housing, population caps, rally points, idle-villager cycling.
- **15 buildings** — Town Hall, House, Farm, Granary, Lumber Camp, Mining Camp, Barracks, Archery Range, Stables,
  Blacksmith, Watchtower, Hall of Scholars, Keep, Siege Workshop and the Monument (an alternative victory).
- **8 units** — Villager, Spearman, Swordsman, Archer, Crossbowman, Horseman, Knight and Catapult, with a
  rock-paper-scissors of bonuses (spears beat horses, horses beat archers, archers beat infantry, siege beats walls).
- **19 technologies** — weapon, armour and range lines at the Blacksmith; wheelbarrow, axes, picks, ploughs and
  conscription at the Hall of Scholars; Loom at the Town Hall.
- **Bot opponents** — up to five rivals on three difficulties. They gather, build, save up for the next age,
  research, raise armies, raid, defend and rebuild, using exactly the same rules as the player.
- **Procedural maps** — four terrains (Meadow, Desert, Tundra, Highlands), three sizes, seeded so a map can be
  replayed. Fog of war with soft edges, a diamond minimap, and an optional revealed map.
- **Settings** — number of rivals, difficulty, starting resources, starting age, population cap, game speed,
  player colour, map seed.
- **Feedback** — floating alerts with click-to-jump, minimap pings, a synthesized soundscape (no audio files), and a
  final scoreboard.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Select | Left click, drag a box, Shift to add, double-click for all of a type | Tap |
| Command | Right click: move, gather, build, repair or attack by target | Tap ground or target with units selected |
| Camera | Arrow keys, middle-drag or Space-drag, wheel to zoom, click the minimap | Drag to pan, pinch to zoom |
| Hotkeys | Letters on the command buttons (Q W E R T Y / A S D F G / Z X C V B); **H** Town Hall, **.** idle villager, **Enter** last event, **Ctrl+1–9** / **1–9** groups, **Delete**, **Esc** | — |

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

---

Dawn of Empires is an original work by Cycle Start Studios. It takes its genre from the classic real-time strategy
games of the late nineties but shares none of their names, art, text or code.
