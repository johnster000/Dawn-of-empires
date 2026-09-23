# Anvil & Acre — Design Notes

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
- Map sizes 64², 88², 112², 144². Up to six players spaced evenly on a ring.
- **Islands** map type: all water, one noisy island per player on the ring (radius sized so channels stay at least
  seven tiles wide), a neutral isle in the middle and one between each pair of neighbours. Home islands get four
  stone and four gold; the neutral isles carry two or three deposits each. Deep-water shoals (no land within one tile)
  are only reachable by boat.
- Land and water regions are flood-filled four-way after generation. A path is never searched between two regions,
  and land units ordered across the water are told to take a transport instead of being sent walking.

### Economy
- Villagers gather ~0.45–0.55 per second, carry 10 (+5 per cart technology), deposit at the nearest matching drop-off.
- Trees 100 wood, stone and gold 350, berry bushes 125 food, shore fish 250 food (gathered from the bank). Farms are
  infinite, one worker each, 2×2, walkable.
- Builders stack with diminishing returns: rate = (1 + 0.6·(n−1)) / n per builder.
- Houses +5 population, Town Hall +5, cap configurable 50–200.
- Docks (2×2) sit on water against the shore, take in food, and build boats. Fishing Boats reuse the villager gather
  loop with water standing spots and carry 20. Transports hold eight: land units walk to the shore beside them and
  step aboard; unloading sails to the nearest water tile touching the target island and puts everyone ashore on
  distinct tiles. A sunk transport takes its passengers with it. War Galleys are ranged ships with a bonus against
  ships. Ships and walkers never shove each other.

### Peoples
| People | Unique warrior (Hearth Age) | Bonus |
|---|---|---|
| Romans | Praetorian — armoured shield infantry, slow | Builders work 15% faster |
| Huns | Steppe Archer — mounted archer, range 3 | Stables train 20% faster |
| Norse | Hirdman — quick axeman, ×1.5 vs buildings | Wood +10%, boats train 25% faster |
| Egyptians | Medjay — javelin skirmisher, ×1.5 vs cavalry | Stone and gold +10% |
| Gauls | Gaesatae — unarmoured, fast, hard-hitting | Farms +15% |
| Greeks | Phalangite — pikeman, ×2.5 vs cavalry | Research 20% faster |

Bonuses are ordinary technology-style effects on the player's modifiers. Bots are dealt distinct peoples.

### Ages
| Age | Roof / wall | Advance cost | Requirement |
| --- | --- | --- | --- |
| Dawn (I) | thatch / timber | — | — |
| Hearth (II) | shingle / plaster | 400 food | 2 of Granary, Lumber Camp, Mining Camp, Barracks, Farm |
| Forge (III) | red tile / stone | 800 food, 200 gold | 2 of Range, Stables, Blacksmith, Watchtower |
| Empire (IV) | slate / pale stone, gold trim | 1000 food, 700 gold | 2 of Hall of Scholars, Keep, Blacksmith, Watchtower |

### Interface
- Resources are selectable: they light up under the pointer and a click shows the kind, how much is left, how many
  loads that is, who is working it, and how many more villagers can reach it. The panel clears itself when the last
  of it is carried away.
- The minimap is a 2:1 diamond in a 2:1 frame. A square frame left half of it empty.
- The interface bar along the bottom lets the pointer through its gaps; as a solid strip it swallowed right clicks,
  middle drags and the wheel over a third of the screen.
- Winning and choosing to play on lifts the fog of war: the match is decided, so there is nothing left to hide.

### Combat
- Damage = max(1, attack × bonus − armour). Ranged attacks are projectiles that land ~0.35 s later.
- Counters: Spearman ×2 vs cavalry; Archers ×1.5 vs infantry; cavalry ×1.5 vs archers and siege; Swordsman ×1.5 and
  Catapult ×4 vs buildings; Catapult splashes 50% to units within one tile.
- Idle soldiers acquire targets within sight. Attack-move engages anything met en route and then resumes.
- Towers and Keeps shoot the nearest enemy unit in range; Fletching upgrades extend them.
- A player is defeated when they hold no buildings and no villagers. A finished Monument wins after 5 minutes.
- Units never overlap: each tick, overlapping units are nudged apart (busy units hold their ground, walkers are also
  pushed sideways so crowds slide past each other instead of jamming head-on).
- Gathering uses claimed standing spots. A resource can only be worked from the passable tiles around it; each worker
  claims one, and when a resource has none free the worker is sent to the nearest one of its kind that does. Sending
  ten villagers at one tree therefore spreads them over the nearby stand instead of piling them on a single tile.
- Every unit carries a jam watchdog: no real progress for about two seconds re-routes it, and continued failure sends
  it to another target (a different tree, or whatever structure blocks its path). The count decays rather than
  resetting, so a unit that jitters on the spot cannot hide from it by twitching.
- A unit standing on its next waypoint skips to the one after it. Requiring it to reach the exact tile centre pinned
  units inside crowds, where neighbours shove away the last fraction of a tile every tick and the unit walks on the
  spot forever. This was the cause of villagers appearing to run in circles around each other.
- Arrival at a building (drop-off, building site, garrison, a wall being attacked) is judged at 1.6 tiles rather than
  1.0. A unit has width and gets shoved by its neighbours, so a crowd settles a little over a tile out; anything
  tighter and the ones on the outside never register as having arrived, rack up failures and abandon the job.
- Whoever is sent somewhere gets their own tile. Two units handed the same one shove each other over it forever, so
  the ring of destination tiles widens until there are enough to go round; and a unit whose tile someone has settled
  on takes the nearest free one instead of circling the spot.
- Pathing: an 8-way A* on reusable typed arrays, with a straight-line shortcut for hops of up to three tiles and a
  per-tick budget of full searches (past it a unit gets a shallow best-effort route and refines it later).
- Villagers flee soldiers within five tiles: into a garrisonable building if one is no further off than the threat,
  otherwise eight tiles directly away. They return to the exact job they left once five seconds pass with no soldier
  near. Shelter taken this way empties itself when the danger passes; shelter taken by the bell waits for the bell.
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
7. **Walls** (Normal from the Hearth Age, Hard from the start) — once the core town stands, a ring four tiles beyond
   the buildings with a gate on each side, palisade first and stone when affordable, placed a few pieces at a time
   from surplus wood and mended when breached. Two villagers are kept on wall duty.
8. **Bell and repairs** — two or more raiders near home with fewer defenders present rings the Town Bell; twelve quiet
   seconds ring the all-clear. Badly damaged buildings are repaired once no enemy is near.
9. **Attack** — when the army reaches its threshold and the cooldown has passed, attack-move at the nearest enemy
   building it is willing to hit (soft targets and the human preferred), roll to the next target, go home after
   2.5 minutes or when reduced to two units. **Temper:** every player remembers who last hurt it. Before its peace
   age (Hearth on hard, Forge on normal, Empire on easy; each 15 minutes of play also counts as an age) a bot only
   attacks players who hurt it within the last 4–8 minutes; afterwards it attacks anyone, and the gap between
   attacks shrinks with each age (×1.5, ×1.25, ×1, ×0.75).
10. **Sea** — a dock on the home shore (always on islands), fishing boats to the difficulty's target, galleys on
   station from the Hearth Age. Short of gold or stone at home, a bot lays out a mining camp on the nearest isle that
   has it and ferries three to five villagers over; settlers work whatever their island holds. An attack on another
   island becomes an invasion: build up to three transports, board the army at the home shore, land beside the
   target with galleys in escort, then attack as usual.

## Roadmap
Things deliberately left out of the first release, roughly in the order they should land:

1. **Formations and stances** — line/box formation on move, aggressive/defensive/stand-ground, patrol.
2. **More units** — a Dawn Age scout, a healer/monk line, a ram for early sieges, an Empire Age elite per line.
3. **Market** — trade one resource for another, tribute to allies.
4. **Teams and allies** — team victory, shared vision, allied bots that coordinate attacks.
5. **Map variety** — rivers with fords, cliffs/elevation with height advantage, relics or huntable animals.
   (Islands shipped.)
6. **Building redesign** — a distinct silhouette per building; proposal awaiting approval.
7. **Scenario/campaign mode** — a short chain of authored maps with objectives that teaches the game.
8. **Replay/spectate and a PWA manifest** — installable on phones, offline play.

## What is original here
All artwork, audio, text, balance and code are original: every graphic is drawn procedurally at runtime and every
sound is synthesized at runtime, from code in this repository. There are no third-party assets, fonts or libraries.

Names are ours too: the four ages, the Hall of Scholars, the Monument, and the whole technology list. An earlier
draft of the tech tree used sixteen names taken from another game in the genre; they were replaced in September 2026
with original historical terms, and the matching internal ids were changed with them. Keep it that way. If a name is
lifted from a specific game rather than from history, it is a liability even when the mechanic behind it is not.

The genre conventions themselves (villagers, drop-off camps, houses, ages, unit counters, walls and gates) are ideas
rather than protected expression, and are shared by dozens of published games.
