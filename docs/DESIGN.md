# Dawn of Empires — Design Notes

## Elevator pitch
A browser-native isometric real-time strategy game in the spirit of the late-nineties classics: start with a handful
of villagers, build an economy, climb through four ages of technology and defeat your rivals. Playable in one sitting
(20–40 minutes), on a laptop or a phone, with no install and no account.

## Pillars
1. **Readable at a glance.** Outlined, hard-edged sprites, strong team colours, one silhouette per unit type. Every
   building changes with the age so a glance at a base tells you where an opponent stands.
2. **Honest opponents.** Bots use the same units, costs and rules as the player. Difficulty changes their targets and
   tempo (and a small gather modifier), never what they are allowed to do.
3. **The classic loop, trimmed.** Villagers, drop-offs, houses, ages, counters and sieges are all here; naval warfare,
   diplomacy, trade and relic hunting are not. Fewer systems, each one finished.
4. **Old-school, not grim.** Menus in the studio's house style; the world in grainy, pre-rendered-looking
   sprites. Combat is brisk and bloodless (a fallen soldier fades; a razed building leaves rubble).

## Art direction
Two different registers, on purpose:

- **Interface** — Cycle Start Studios' house style shared with Pocket Dungeons: dark stone panels, gold trim,
  parchment text, serif capitals (`--panel #1c1720`, `--gold #c9962e`, `--text #e8dcc4`).
- **The world** — late-nineties pre-rendered strategy graphics. Everything is still drawn procedurally, but a
  post-process makes it read like scanned 256-colour sprites: hard alpha (no anti-aliased fringes), film grain,
  channel posterisation, a one-pixel dark outline, and translucent shadows cast to the lower right from a key light
  in the upper left. Walls and roofs carry material textures per age (plank/thatch, plaster-and-timber/shingle,
  stone/tile, ashlar/slate). The ground is one grainy texture with soft dirt patches, stretched onto the isometric
  grid with nearest-neighbour sampling; fog of war uses the same hard tile diamonds. Sprites are rasterised at one
  texel per CSS pixel and stamped without smoothing, so zooming in reveals chunky pixels rather than blur.
- **Off the grid** — the map is a grid for logic, never for the eye. Coastlines and dirt come from smooth fields
  sampled per texel; every tree, bush and rock sits a random distance off its tile centre; trees are individually
  sized so a stand of them reads as one canopy with a dark floor beneath; felled trees leave stumps; ferns and
  shrubs grow along forest edges; fish shoals ring the shallows.

## Systems as implemented

### World
- Square grid, 2:1 isometric projection (64×32 tiles), 8-way A* with corner cutting disallowed.
- Terrain from value noise: water, shore, ground; four palettes/generation profiles. Edges biased to land so no start
  is cut off. Each start gets guaranteed forest, stone, gold and berries within 5–12 tiles.
- Fog of war for the human player (explored / visible per tile), updated three times a second from sight radii.
- Map sizes 64², 88², 112². Up to six players spaced evenly on a ring.

### Economy
- Villagers gather ~0.45–0.55 per second, carry 10 (+5 per cart technology), deposit at the nearest matching drop-off.
- Trees 100 wood, stone and gold 350, berry bushes 125 food, shore fish 250 food (gathered from the bank). Farms are
  infinite, one worker each, 2×2, walkable.
- Builders stack with diminishing returns: rate = (1 + 0.6·(n−1)) / n per builder.
- Houses +5 population, Town Hall +5, cap configurable 50–200.

### Ages
| Age | Roof / wall | Advance cost | Requirement |
| --- | --- | --- | --- |
| Dawn (I) | thatch / timber | — | — |
| Hearth (II) | shingle / plaster | 400 food | 2 of Granary, Lumber Camp, Mining Camp, Barracks, Farm |
| Forge (III) | red tile / stone | 800 food, 200 gold | 2 of Range, Stables, Blacksmith, Watchtower |
| Empire (IV) | slate / pale stone, gold trim | 1000 food, 700 gold | 2 of Hall of Scholars, Keep, Blacksmith, Watchtower |

### Combat
- Damage = max(1, attack × bonus − armour). Ranged attacks are projectiles that land ~0.35 s later.
- Counters: Spearman ×2 vs cavalry; Archers ×1.5 vs infantry; cavalry ×1.5 vs archers and siege; Swordsman ×1.5 and
  Catapult ×4 vs buildings; Catapult splashes 50% to units within one tile.
- Idle soldiers acquire targets within sight. Attack-move engages anything met en route and then resumes.
- Towers and Keeps shoot the nearest enemy unit in range; Fletching upgrades extend them.
- A player is defeated when they hold no buildings and no villagers. A finished Monument wins after 5 minutes.
- Units never overlap: each tick, overlapping units are nudged apart (busy units hold their ground).
- Walls: palisade (250 hp, 4 wood) and stone (900 hp, 5 stone), placed as straight runs. Gates are passable only for
  their owner and can replace an existing wall piece. An attacker whose path is blocked switches to the nearest
  enemy structure in reach, then returns to its original target.
- Garrison: Town Hall 15, Watchtower 5, Keep 10 (villagers, infantry, archers). Towers fire one extra arrow per two
  garrisoned; a Town Hall with three or more inside starts shooting. The Town Bell shelters every villager within
  earshot and, rung again, sends each back to the task they left.
- Saving: the whole match serialises by id (units, buildings, orders, garrisons, resources, fog) on top of the
  seed-regenerated map; autosave every 60 s of game time, plus text export/import.

### Bot AI (one pass per second)
1. **Plan** — decide what to save for (the next age once 13+ villagers are up and prerequisites exist).
2. **Defend** — anything hitting our buildings or villagers pulls in every idle soldier nearby.
3. **Economy** — train villagers to the difficulty's target; assign idle villagers by a per-age split (food/wood/gold/
   stone), skewed by what's short; place camps next to far deposits and farms when berries run out.
4. **Construct** — houses when 4 pop from cap; a scripted order (barracks → camps → range/stables/smith/tower →
   library/keep → workshop/monument); keep sites staffed; age up when eligible.
5. **Research** — cheapest useful technology from the surplus above the savings goal.
6. **Military** — train the best available unit at every military building from surplus; gather at the frontier.
7. **Attack** — when the army reaches its threshold and the cooldown has passed, attack-move at the nearest enemy
   building (soft targets and the human preferred), roll to the next target, go home after 2.5 minutes or when
   reduced to two units.

## Roadmap
Things deliberately left out of the first release, roughly in the order they should land:

1. **Bots that wall and garrison** — the AI does not yet build walls or ring the bell.
2. **Villager safety** — flee from soldiers, auto-repair.
3. **Formations and stances** — line/box formation on move, aggressive/defensive/stand-ground, patrol.
4. **More units** — a Dawn Age scout, a healer/monk line, a ram for early sieges, an Empire Age elite per line.
5. **Market** — trade one resource for another, tribute to allies.
6. **Teams and allies** — team victory, shared vision, allied bots that coordinate attacks.
7. **Map variety** — rivers with fords, cliffs/elevation with height advantage, relics or huntable animals.
8. **Scenario/campaign mode** — a short chain of authored maps with objectives that teaches the game.
9. **Replay/spectate and a PWA manifest** — installable on phones, offline play.

## What is original here
Names (Dawn/Hearth/Forge/Empire ages, Hall of Scholars, Keep, Monument), all art, sounds, text, balance and code are
original. The genre conventions (villagers, drop-offs, houses, ages, unit counters) are shared by dozens of games.
