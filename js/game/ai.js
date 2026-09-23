/* Bot players. One decision pass per second: economy, construction, research, training, attack, defence.
   The bot plays by the same rules as the human (same costs, same units); difficulty changes its
   targets, tempo and a small gather-rate modifier, not what it is allowed to do. */
const DIFF = {
  easy:   { boats: 2, galleys: 1, peaceAge: 3, grudge: 240, tick: 1.4, villagers: 12, army: 16, attackGap: 240, firstAttack: 480, gather: -0.15, farms: 4, towers: 0, techs: false, walls: false },
  normal: { boats: 4, galleys: 2, peaceAge: 2, grudge: 360, tick: 1.0, villagers: 20, army: 12, attackGap: 150, firstAttack: 330, gather: 0,     farms: 6, towers: 1, techs: true,  walls: true, wallAge: 1, stoneAge: 2, wallVillagers: 14 },
  hard:   { boats: 6, galleys: 3, peaceAge: 1, grudge: 480, tick: 0.7, villagers: 28, army: 9,  attackGap: 100, firstAttack: 240, gather: 0.15,  farms: 9, towers: 2, techs: true,  walls: true, wallAge: 0, stoneAge: 1, wallVillagers: 12 },
};
/* Setup-screen tuning, applied on top of difficulty. Normal changes nothing.
   Temper: how soon and how often a bot picks fights. peaceShift moves the age at which it stops waiting to be
   provoked; ageEvery is how many seconds of play count as an age for that purpose; the rest scale how long it holds
   a grudge, how big an army it waits for, how long between attacks, and when the first one can come.
   Pace: how quickly a bot climbs the ages. vill scales the workforce it wants before saving for the next age;
   minTime[a] is the earliest game time (seconds) at which it will start advancing into age a. focus pulls workers
   towards whatever the next age still needs; hoard skips optional soldiers while saving, unless under attack;
   workers scales the difficulty's villager target; gather is added to its gather rate, as difficulty does. */
const TEMPER = {
  chill:      { peaceShift: 1,  ageEvery: 1500, grudge: 0.6, army: 1.3, gap: 1.5, first: 1.5 },
  normal:     { peaceShift: 0,  ageEvery: 900,  grudge: 1,   army: 1,   gap: 1,   first: 1 },
  aggressive: { peaceShift: -1, ageEvery: 600,  grudge: 1.5, army: 0.8, gap: 0.7, first: 0.7 },
};
const AGE_PACE = {
  chill:      { vill: 1.25, minTime: [0, 600, 1320, 2100], focus: 0, hoard: false, workers: 1, gather: 0 },
  normal:     { vill: 1,    minTime: [0, 0, 0, 0], focus: 0, hoard: false, workers: 1, gather: 0 },
  aggressive: { vill: 0.75, minTime: [0, 0, 0, 0], focus: 0.6, hoard: true, workers: 1.3, gather: 0.2 },
};
const AI = {
  create(p) {
    const D = DIFF[p.difficulty] || DIFF.normal;
    const s = (typeof Game !== 'undefined' && Game.settings) || {};
    p.ai = { D, T: TEMPER[s.temper] || TEMPER.normal, P: AGE_PACE[s.pace] || AGE_PACE.normal, t: Math.random() * D.tick, lastAttack: -Infinity, attacking: false, attackTarget: null, attackStart: 0, lastHouse: -99, threat: null, threatT: -99, rng: RNG.make(RNG.seedFrom('ai' + p.id + Game.seed)) };
    for (const k of RESOURCES) p.mods.gather[k] += D.gather + p.ai.P.gather;
  },
  tick(p, dt) {
    const S = p.ai; S.t -= dt; if (S.t > 0 || !p.alive) return;
    S.t = S.D.tick;
    const th = p.buildings('townhall').find((b) => b.built) || null;
    const vill = p.units('villager'), mil = p.units().filter((u) => u.type !== 'villager' && !u.def.naval);
    S.home = th || p.buildings().find((b) => b.built) || null;
    if (!S.home && !vill.length) return;
    AI.plan(p, S, th, vill);
    AI.defend(p, S, mil);
    AI.bell(p, S, th, mil);
    AI.economy(p, S, th, vill);
    AI.construct(p, S, th, vill);
    AI.walls(p, S, vill);
    AI.repair(p, S, vill);
    AI.research(p, S);
    AI.trainMilitary(p, S);
    AI.naval(p, S, th, vill);
    AI.attack(p, S, mil);
  },

  /* Decide what we are saving for. While a goal is set, optional spending only uses the surplus. */
  plan(p, S, th, vill) {
    S.goal = null;
    const nx = AGES[p.age + 1];
    if (!th || !nx) return;
    const D = S.D;
    if (!AI.readyToAge(p, S, vill, 0.7, 13)) return;
    if (th.queue.some((q) => q.kind === 'age')) return;
    const have = nx.advance.need.filter((t) => p.buildings(t).some((b) => b.built)).length;
    if (have < nx.advance.needCount && !nx.advance.need.some((t) => p.buildings(t).some((b) => !b.built))) {
      // queue the cheapest missing prerequisite instead of saving
      S.needBuilding = nx.advance.need.find((t) => BUILDINGS[t].age <= p.age && !p.buildings(t).length) || null;
    } else S.needBuilding = null;
    S.goal = nx.advance.cost;
  },
  /* Can we pay this without dipping into what we are saving? Under attack, spend freely. */
  spendable(p, S, cost) {
    if (!p.canAfford(cost)) return false;
    if (!S.goal || Game.time - S.threatT < 25) return true;
    for (const k in cost) if (p.res[k] - cost[k] < (S.goal[k] || 0)) return false;
    return true;
  },

  /* ---- economy ---- */
  economy(p, S, th, vill) {
    const D = S.D;
    // Villager production
    if (th && vill.length < AI.workers(S, p) && th.queue.length < 2 && p.pop() < p.popCap()) Sim.enqueue(th, { kind: 'unit', id: 'villager' });
    // Rebuild a town hall if it is lost
    if (!th && vill.length && p.canAfford(BUILDINGS.townhall.cost) && !p.buildings('townhall').length) AI.placeNear(p, 'townhall', S.home || { x: vill[0].x, y: vill[0].y }, vill);
    // Desired split by age
    const split = p.age === 0 ? { food: 0.5, wood: 0.42, gold: 0.08, stone: 0 } : p.age === 1 ? { food: 0.42, wood: 0.3, gold: 0.2, stone: 0.08 } : { food: 0.38, wood: 0.26, gold: 0.26, stone: 0.1 };
    // Shift towards what we are short of
    for (const k of RESOURCES) { if (p.res[k] > 700) split[k] *= 0.5; if (p.res[k] < 80) split[k] *= 1.6; }
    if (p.age === 0 && p.res.food < 400 && vill.length >= 10) split.food *= 1.3;
    const P = S.P || AGE_PACE.normal;
    if (S.goal && P.focus) for (const k in S.goal) if (split[k] != null && p.res[k] < S.goal[k]) split[k] = Math.max(split[k], 0.1) * (1 + P.focus);
    const total = Object.values(split).reduce((a, b) => a + b, 0); for (const k in split) split[k] /= total;
    const counts = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle = [];
    for (const u of vill) {
      if (!u.order) idle.push(u);
      else if (u.order.type === 'gather' && u.order.res) counts[RES_KIND[rk(u.order.res)]]++;
      else if (u.order.type === 'gather' && u.carry.kind) counts[u.carry.kind]++;
    }
    const working = Object.values(counts).reduce((a, b) => a + b, 0) + idle.length || 1;
    // settlers on another island get their own turn, so a busy home town never leaves them standing about
    if (World.islands && S.home) { const hr = World.regionAt(S.home.x, S.home.y); let n = 0; for (let i = idle.length - 1; i >= 0 && n < 3; i--) { const u = idle[i]; if (World.regionAt(u.x, u.y) === hr) continue; n++; idle.splice(i, 1); if (AI.assignAway(p, S, u)) { const k = u.order && u.order.res ? RES_KIND[rk(u.order.res)] : null; if (k) counts[k]++; } } }
    // Reassign at most two villagers a tick, idle ones first
    let moves = 0;
    for (const u of idle) { if (moves++ >= 3) break; const k = AI.mostNeeded(split, counts, working); if (AI.assign(p, S, u, k)) counts[k]++; }
    // Occasionally rebalance one worker from an over-served resource
    if (!idle.length && S.rng() < 0.35) {
      let over = null, best = 0; for (const k of RESOURCES) { const excess = counts[k] / working - split[k]; if (excess > best + 0.08) { best = excess; over = k; } }
      const need = AI.mostNeeded(split, counts, working);
      if (over && need !== over) { const u = vill.find((v) => v.order && v.order.type === 'gather' && v.order.res && RES_KIND[rk(v.order.res)] === over && rk(v.order.res) !== 'farm'); if (u && AI.assign(p, S, u, need)) { counts[over]--; counts[need]++; } }
    }
  },
  mostNeeded(split, counts, working) { let best = 'food', bd = -Infinity; for (const k of RESOURCES) { const d = split[k] - counts[k] / working; if (d > bd && split[k] > 0) { bd = d; best = k; } } return best; },
  dropoffs(p, kind) { return p.buildings().filter((b) => b.built && b.def.dropoff && b.def.dropoff.includes(kind)); },
  /* Send one villager after a resource kind, building a camp or farm when that is the sensible thing. */
  assign(p, S, u, kind) {
    const home = S.home; if (!home) return false;
    // a villager ferried to another island works what is there
    if (World.islands && World.regionAt(u.x, u.y) !== World.regionAt(home.x, home.y)) return AI.assignAway(p, S, u);
    const resKind = { food: 'berry', wood: 'tree', gold: 'gold', stone: 'stone' }[kind];
    const kinds = kind === 'food' ? ['berry', 'fish'] : [resKind];
    const drops = AI.dropoffs(p, kind);
    const nearDrop = (r) => drops.some((d) => U.dist(d.x, d.y, r.x, r.y) <= 9);
    // something already serviced by a drop-off
    let r = null, bd = Infinity;
    const reg = World.islands ? World.regionAt(u.x, u.y) : 0, mine = (rr) => !reg || World.resRegion(rr) === reg;
    for (const rr of World.res) { if (!kinds.includes(rr.kind) || rr.amount <= 0 || !mine(rr)) continue; if ((rr.workers || 0) >= (rr.kind === 'tree' ? 2 : 5)) continue; if (!nearDrop(rr)) continue; const d = U.dist2(rr.x, rr.y, u.x, u.y); if (d < bd) { bd = d; r = rr; } }
    if (r && Sim.assignGather(u, r, null, 12)) return true;
    if (kind === 'food') {
      const farm = Sim.freeFarm(u, 40); if (farm) { Sim.setOrder(u, { type: 'gather', res: farm }); return true; }
      const pendingFarm = p.buildings('farm').find((b) => !b.built);
      if (pendingFarm) { Sim.setOrder(u, { type: 'build', bld: pendingFarm }); return true; }
      if (p.canAfford(BUILDINGS.farm.cost)) { const anchor = drops.find((d) => d.type === 'granary') || home; if (AI.placeNear(p, 'farm', anchor, [u])) return true; }
      // nothing to eat: chop instead
      return kind !== 'wood' ? AI.assign(p, S, u, 'wood') : false;
    }
    // no serviced deposit: find the closest deposit to home and put a camp beside it
    let far = null; bd = Infinity;
    for (const rr of World.res) { if (rr.kind !== resKind || rr.amount <= 0 || !mine(rr)) continue; const d = U.dist2(rr.x, rr.y, home.x, home.y); if (d < bd) { bd = d; far = rr; } }
    if (!far) return kind === 'wood' ? false : AI.assign(p, S, u, 'wood');
    const campType = kind === 'wood' ? 'lumbercamp' : 'miningcamp';
    const pending = p.buildings(campType).find((b) => !b.built && U.dist(b.x, b.y, far.x, far.y) < 10);
    if (pending) { Sim.setOrder(u, { type: 'build', bld: pending }); return true; }
    if (Math.sqrt(bd) <= 10 && drops.length && Sim.assignGather(u, far, null, 12)) return true;
    if (p.canAfford(BUILDINGS[campType].cost) && p.buildings(campType).filter((b) => !b.built).length === 0) { if (AI.placeNear(p, campType, { x: far.x + 0.5, y: far.y + 0.5 }, [u], 2)) return true; }
    return Sim.assignGather(u, far, null, 14); // long walk, but better than idling
  },

  /* ---- construction ---- */
  construct(p, S, th, vill) {
    if (!S.home || !vill.length) return;
    const D = S.D, home = S.home;
    // Keep sites staffed
    for (const b of p.buildings()) if (!b.built) {
      const builders = vill.filter((v) => v.order && v.order.type === 'build' && v.order.bld === b).length;
      const want = b.type === 'townhall' || b.type === 'monument' ? 4 : b.def.size >= 3 ? 2 : 1;
      if (builders < want) { const v = AI.pickBuilder(vill, b); if (v) Sim.setOrder(v, { type: 'build', bld: b }); }
    }
    const pending = p.buildings().filter((b) => !b.built).length;
    if (pending >= 2) return;
    const essential = new Set(['house', 'farm', 'granary', 'lumbercamp', 'miningcamp']);
    const has = (t) => p.count(t) > 0, want = (t) => BUILDINGS[t].age <= p.age && (essential.has(t) || t === S.needBuilding ? p.canAfford(BUILDINGS[t].cost) : AI.spendable(p, S, BUILDINGS[t].cost));
    // Houses
    if (p.popCap() - p.pop() <= 4 && p.popCap() < Game.settings.popCap && Game.time - S.lastHouse > 12 && want('house')) { if (AI.placeNear(p, 'house', home, vill)) { S.lastHouse = Game.time; return; } }
    // Age-gated build order
    const order = [];
    if (S.needBuilding && !has(S.needBuilding)) order.push(S.needBuilding);
    if (vill.length >= 6 && !has('barracks')) order.push('barracks');
    if (p.age === 0 && vill.length >= 8 && !has('granary') && !has('lumbercamp') && !has('miningcamp')) order.push('lumbercamp');
    if (p.age >= 1) { if (!has('blacksmith')) order.push('blacksmith'); if (!has('range')) order.push('range'); if (!has('stables')) order.push('stables'); if (p.count('tower') < D.towers) order.push('tower'); }
    if (p.age >= 2) { if (!has('library')) order.push('library'); if (!has('keep') && D.towers > 0) order.push('keep'); if (p.count('barracks') < 2 && p.res.wood > 400) order.push('barracks'); }
    if (p.age >= 3) { if (!has('workshop')) order.push('workshop'); if (!has('monument') && p.res.stone > 1300 && p.res.gold > 1100 && p.difficulty !== 'easy') order.push('monument'); }
    // Farms as berries run out
    const berries = World.res.some((r) => (r.kind === 'berry' || r.kind === 'fish') && r.amount > 0 && U.dist(r.x, r.y, home.x, home.y) < 16);
    const farmTarget = D.farms + (p.age >= 2 ? 3 : 0);
    if (!berries && p.count('farm') < farmTarget && vill.length >= 6) order.unshift('farm');
    for (const t of order) {
      if (!want(t)) continue;
      let anchor = home;
      if (t === 'tower' || t === 'keep') anchor = AI.frontier(p, home, 6);
      if (t === 'farm') anchor = p.buildings('granary').find((b) => b.built) || home;
      if (AI.placeNear(p, t, anchor, vill, t === 'farm' ? 1 : 2)) return;
    }
    // Age up
    const nx = AGES[p.age + 1];
    if (th && nx && AI.readyToAge(p, S, vill, 0.75, 14) && !p.ageUpBlocker()) Sim.enqueue(th, { kind: 'age' });
  },
  workers(S, p) { const w = (S.P || AGE_PACE.normal).workers; return Math.round(S.D.villagers * (p && p.age === 0 ? Math.min(1, w) : w)); }, // the bigger workforce comes once the town is past the Dawn Age
  /* Enough villagers for this bot's pace, and not earlier than its pace allows. */
  readyToAge(p, S, vill, share, cap) {
    const P = S.P || AGE_PACE.normal, D = S.D;
    if (Game.time < (P.minTime[p.age + 1] || 0)) return false;
    return vill.length >= Math.min(Math.ceil(Math.min(D.villagers * share, cap) * P.vill), AI.workers(S, p)); // ceil keeps Normal identical to before
  },
  pickBuilder(vill, b) {
    let best = null, bd = Infinity;
    for (const v of vill) { if (v.order && (v.order.type === 'build' || v.order.type === 'attack')) continue; if (v.order && v.order.type === 'gather' && v.order.res && rk(v.order.res) === 'farm') continue; const d = U.dist2(v.x, v.y, b.x, b.y); if (d < bd && (!World.islands || Sim.canReach(v, b))) { bd = d; best = v; } }
    return best;
  },
  /* A point some tiles from home in the direction of the nearest enemy. */
  frontier(p, home, dist) {
    let tgt = null, bd = Infinity;
    for (const b of Game.buildings) { if (b.dead || b.owner === p.id) continue; const d = U.dist2(b.x, b.y, home.x, home.y); if (d < bd) { bd = d; tgt = b; } }
    if (!tgt) return home;
    const a = Math.atan2(tgt.y - home.y, tgt.x - home.x);
    return { x: home.x + Math.cos(a) * dist, y: home.y + Math.sin(a) * dist };
  },
  /* Find a spot near an anchor with a free ring around it, pay, place, and send builders. */
  placeNear(p, type, anchor, vill, minGap) {
    const def = BUILDINGS[type]; if (!p.canAfford(def.cost)) return false;
    const gap = minGap == null ? 1 : minGap;
    const S = p.ai, rng = S ? S.rng : Math.random;
    const cx = Math.round(anchor.x - def.size / 2), cy = Math.round(anchor.y - def.size / 2);
    let spot = null;
    for (let r = (type === 'farm' ? 2 : 2); r <= 14 && !spot; r++) {
      const cands = [];
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const tx = cx + dx, ty = cy + dy; if (AI.siteOk(def, tx, ty, gap)) cands.push([tx, ty]); }
      if (cands.length) spot = cands[Math.floor(rng() * cands.length)];
    }
    if (!spot) return false;
    const b = Game.placeBuilding(p, type, spot[0], spot[1]); if (!b) return false;
    const builders = []; const sorted = vill.slice().sort((a, c) => U.dist2(a.x, a.y, b.x, b.y) - U.dist2(c.x, c.y, b.x, b.y));
    for (const v of sorted) { if (builders.length >= (def.size >= 3 ? 2 : 1)) break; if (v.order && v.order.type === 'build') continue; builders.push(v); }
    for (const v of builders) Sim.setOrder(v, { type: 'build', bld: b });
    return true;
  },
  siteOk(def, tx, ty, gap) {
    if (!World.canPlace(def, tx, ty, true)) return false;
    // keep a walkable ring so the site never seals anything in
    let walkable = 0;
    for (let x = tx - gap; x < tx + def.size + gap; x++) for (let y = ty - gap; y < ty + def.size + gap; y++) {
      if (x >= tx && x < tx + def.size && y >= ty && y < ty + def.size) continue;
      if (!World.inBounds(x, y)) return false;
      const b = World.bld[World.idx(x, y)]; if (b && !b.def.passable && !def.passable) return false;
      if (World.passable(x, y)) walkable++;
    }
    return walkable >= def.size * 2 + 2;
  },

  /* ---- research ---- */
  research(p, S) {
    if (!S.D.techs) return;
    if (p.res.food < 250 || p.res.gold < 120) return;
    const options = [];
    for (const b of p.buildings()) { if (!b.built || b.queue.length || !b.def.techs) continue; for (const id of b.def.techs) { const t = TECHS[id]; if (p.techs.has(id) || t.age > p.age || (t.requires && !p.techs.has(t.requires))) continue; if (!p.canAfford(t.cost)) continue; options.push([b, id]); } }
    if (!options.length) return;
    // prefer economy early, military once there is an army
    options.sort((a, b) => AI.techScore(p, b[1]) - AI.techScore(p, a[1]));
    Sim.enqueue(options[0][0], { kind: 'tech', id: options[0][1] });
  },
  techScore(p, id) { const t = TECHS[id]; let s = 10 - t.age; if (t.effect.gather || t.effect.carry || t.effect.farmYield) s += p.units('villager').length >= 12 ? 4 : 1; if (t.effect.atk || t.effect.armor || t.effect.range) s += p.units().filter((u) => u.type !== 'villager').length >= 6 ? 4 : 0; if (id === 'homespun') s += 3; return s; },

  /* ---- military ---- */
  trainMilitary(p, S) {
    const D = S.D, vill = p.units('villager').length;
    if (vill < 7 && p.age === 0) return;               // economy first
    if (S.goal && (S.P || AGE_PACE.normal).hoard && Game.time - S.threatT > 25 && p.units().filter((u) => u.type !== 'villager' && !u.def.naval).length >= 4) return; // racing for the next age
    const pop = p.pop(), cap = p.popCap(); if (pop >= cap) return;
    const mil = p.buildings().filter((b) => b.built && b.def.trains && b.type !== 'townhall' && b.type !== 'dock' && b.queue.length < 2);
    for (const b of mil) {
      const opts = b.def.trains.filter((id) => UNITS[id].age <= p.age && p.mayTrain(id));
      if (!opts.length) continue;
      // best available from this building, with some variety
      let id = opts[opts.length - 1]; if (S.rng() < 0.3) id = opts[0];
      const d = UNITS[id];
      // keep a little for villagers and houses while still small
      const reserveFood = vill < AI.workers(S, p) ? 60 : 0;
      if (p.res.food - reserveFood < (d.cost.food || 0) || !AI.spendable(p, S, d.cost)) continue;
      Sim.enqueue(b, { kind: 'unit', id });
    }
  },
  attack(p, S, mil) {
    const D = S.D, idleMil = mil.filter((u) => !u.order || u.order.type === 'attackmove');
    if (S.invasion) { AI.invade(p, S, mil); return; }
    if (S.attacking) {
      const t = S.attackTarget;
      const done = !t || t.dead || Game.time - S.attackStart > 150 || mil.length < 3;
      if (done) {
        // next target in the same area, or go home
        const next = t && t.dead ? AI.pickTarget(p, S, t) : null;
        if (next && mil.length >= 4 && Game.time - S.attackStart < 240) { S.attackTarget = next; for (const u of mil) if (!u.order || u.order.type !== 'attack') Sim.setOrder(u, { type: 'attackmove', x: Math.floor(next.x), y: Math.floor(next.y) }); return; }
        S.attacking = false; S.attackTarget = null;
        const home = AI.frontier(p, S.home || { x: World.w / 2, y: World.h / 2 }, 4);
        for (const u of mil) if (u.order && u.order.type === 'attackmove') Sim.setOrder(u, { type: 'attackmove', x: Math.floor(home.x), y: Math.floor(home.y) });
      } else {
        // stragglers rejoin
        for (const u of idleMil) if (!u.order && World.regionAt(u.x, u.y) === World.regionAt(t.x, t.y)) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(t.x), y: Math.floor(t.y) });
      }
      return;
    }
    // early on a bot only goes after whoever has hurt it; it grows bolder with each age
    const pace = AI.PACE[Math.min(p.age, AI.PACE.length - 1)], provoked = AI.provokers(p).length > 0;
    const T = S.T || TEMPER.normal;
    const armyNeed = Math.ceil(D.army * pace.army * T.army * (provoked && !AI.warlike(p) ? 0.75 : 1));
    const ready = mil.length >= armyNeed && Game.time - S.lastAttack >= D.attackGap * pace.gap * T.gap && (Game.time >= D.firstAttack * T.first || provoked);
    if (!ready) {
      // gather the army at the frontier so it is not scattered
      if (S.home && S.rng() < 0.2) { const f = AI.frontier(p, S.home, 5); for (const u of mil) if (!u.order && U.dist(u.x, u.y, f.x, f.y) > 6) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(f.x), y: Math.floor(f.y) }); }
      return;
    }
    const target = AI.pickTarget(p, S, null); if (!target) return;
    // across the water: ship the army over first
    if (World.islands && S.home && World.regionAt(target.x, target.y) !== World.regionAt(S.home.x, S.home.y)) { S.invasion = { target, phase: 'ships', t: Game.time }; S.lastAttack = Game.time; return; }
    if (AI.warlike(p) && !S.warned) { S.warned = true; if (Game.players[Game.human] && Game.players[Game.human].alive && p.id !== Game.human) UI.message(`${p.name} no longer waits to be provoked.`, 'bad'); }
    S.attacking = true; S.attackTarget = target; S.attackStart = Game.time; S.lastAttack = Game.time;
    for (const u of mil) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(target.x), y: Math.floor(target.y) });
    Game.onAIAttack(p, target);
  },
  /* How long between attacks and how big an army, by age: patient in the Dawn Age, relentless at the end. */
  PACE: [{ gap: 1.5, army: 1 }, { gap: 1.25, army: 1 }, { gap: 1, army: 1 }, { gap: 0.75, army: 0.9 }],
  /* Past its peace age (or after enough time that it should have been) a bot attacks anyone. */
  warlike(p) { const D = p.ai.D, T = p.ai.T || TEMPER.normal; return Math.max(p.age, Math.floor(Game.time / T.ageEvery)) >= D.peaceAge + T.peaceShift; },
  grudgeFor(p) { return p.ai.D.grudge * (p.ai.T || TEMPER.normal).grudge; },
  /* Players who have hurt this bot recently enough to be remembered. */
  provokers(p) { const out = []; for (const id in p.grudge) if (Game.time - p.grudge[id] < AI.grudgeFor(p) && Game.players[id] && Game.players[id].alive) out.push(+id); return out; },
  hostileTo(p, q) { return AI.warlike(p) || (p.grudge[q] != null && Game.time - p.grudge[q] < AI.grudgeFor(p)); },
  /* ---- the sea ---- */
  naval(p, S, th, vill) {
    if (!S.home || !World.region) return;
    const D = S.D, home = S.home, homeReg = World.regionAt(home.x, home.y);
    const docks = p.buildings('dock'), dock = docks.find((b) => b.built);
    // islands need a dock; on a continent only if there is good water close by
    if (!docks.length && vill.length >= 7 && p.canAfford(BUILDINGS.dock.cost) && (World.islands || (p.age >= 1 && S.rng() < 0.05))) AI.placeDock(p, home, homeReg, vill);
    if (!dock) return;
    const units = p.units(), boats = units.filter((u) => u.type === 'fishboat'), galleys = units.filter((u) => u.type === 'galley'), trans = units.filter((u) => u.type === 'transport');
    const q = (id) => dock.queue.filter((x) => x.id === id).length;
    const roomy = p.pop() < p.popCap() && dock.queue.length < 2;
    const fish = World.res.some((r) => r.kind === 'fish' && r.amount > 0 && U.dist(r.x, r.y, dock.x, dock.y) < 30);
    if (roomy && fish && boats.length + q('fishboat') < D.boats && AI.spendable(p, S, UNITS.fishboat.cost)) Sim.enqueue(dock, { kind: 'unit', id: 'fishboat' });
    else if (roomy && World.islands && p.age >= 1 && galleys.length + q('galley') < D.galleys && AI.spendable(p, S, UNITS.galley.cost)) Sim.enqueue(dock, { kind: 'unit', id: 'galley' });
    for (const b of boats) if (!b.order) { const f = Sim.nearestFree(b, 'fish', b.x, b.y, 36); if (f) Sim.assignGather(b, f, null, 36); }
    // galleys keep station off the home shore and fight whatever comes near
    for (const g of galleys) if (!g.order && !S.invasion && U.dist(g.x, g.y, dock.x, dock.y) > 9) Sim.setOrder(g, { type: 'attackmove', x: Math.floor(dock.x), y: Math.floor(dock.y) + 3 });
    if (World.islands) AI.colonise(p, S, home, homeReg, dock, vill, trans);
  },
  /* A dock on the home shore, as close to the town as the coast allows. */
  placeDock(p, home, homeReg, vill) {
    const def = BUILDINGS.dock; let best = null, bd = Infinity;
    for (let x = Math.floor(home.x) - 24; x <= home.x + 24; x++) for (let y = Math.floor(home.y) - 24; y <= home.y + 24; y++) {
      if (!World.canPlace(def, x, y, true)) continue;
      let ours = false; for (let ax = x - 1; ax <= x + def.size && !ours; ax++) for (let ay = y - 1; ay <= y + def.size; ay++) if (World.passable(ax, ay) && World.regionAt(ax, ay) === homeReg) { ours = true; break; }
      if (!ours) continue;
      const d = U.dist2(x, y, home.x, home.y); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) return false;
    const b = Game.placeBuilding(p, 'dock', best[0], best[1]); if (!b) return false;
    const builders = vill.filter((v) => !(v.order && v.order.type === 'build')).sort((a, c) => U.dist2(a.x, a.y, b.x, b.y) - U.dist2(c.x, c.y, b.x, b.y)).slice(0, 2);
    for (const v of builders) Sim.setOrder(v, { type: 'build', bld: b });
    return true;
  },
  /* Short of stone or gold at home: ferry a few villagers to the nearest island that has it. */
  colonise(p, S, home, homeReg, dock, vill, trans) {
    const c = S.colony;
    if (c) {
      const ship = c.ship;
      if (!ship || ship.dead) { S.colony = null; return; }
      if (c.phase === 'board') {
        const waiting = c.men.filter((m) => !m.dead && m.order && m.order.type === 'board').length;
        if (!waiting && ship.cargo.length) { Sim.setOrder(ship, { type: 'unload', x: c.res.x, y: c.res.y, region: c.region }); c.phase = 'sail'; c.t = Game.time; }
        else if (!waiting && !ship.cargo.length) S.colony = null;
        else if (Game.time - c.t > 60) { for (const m of c.men) if (m.order && m.order.type === 'board') Sim.idle(m); }
      } else if (c.phase === 'sail') {
        if (!ship.cargo.length) {
          const landed = c.men.filter((m) => !m.dead && !m.inside && World.regionAt(m.x, m.y) === c.region);
          for (const m of landed) AI.assignAway(p, S, m);
          S.colonyRegion = c.region; S.colony = null; S.lastColony = Game.time;
          const back = World.landingNear(home.x, home.y, homeReg, 20); if (back) Sim.setOrder(ship, { type: 'move', x: back[0], y: back[1] });
        } else if (Game.time - c.t > 150) { Sim.setOrder(ship, { type: 'unload', x: ship.x, y: ship.y, region: 0 }); S.colony = null; }
      }
      return;
    }
    if (p.age < 1 || vill.length < 12 || S.invasion || Game.time - (S.lastColony || -999) < 240) return;
    const left = (kind, reg) => World.res.some((r) => r.kind === kind && r.amount > 0 && World.resRegion(r) === reg);
    const want = !left('gold', homeReg) ? 'gold' : !left('stone', homeReg) ? 'stone' : null;
    if (!want) return;
    const away = vill.filter((v) => World.regionAt(v.x, v.y) !== homeReg).length;
    if (away >= 8) return;
    // the nearest deposit of it off the home island
    let res = null, bd = Infinity;
    for (const r of World.res) { if (r.kind !== want || r.amount <= 0) continue; const g = World.resRegion(r); if (!g || g === homeReg) continue; const d = U.dist2(r.x, r.y, home.x, home.y); if (d < bd) { bd = d; res = r; } }
    if (!res) return;
    if (!p.canAfford({ wood: BUILDINGS.miningcamp.cost.wood + 20 })) return;
    const ship = trans.find((t) => !t.order && !t.cargo.length);
    if (!ship) { if (!trans.length && !dock.queue.some((q) => q.id === 'transport') && p.canAfford(UNITS.transport.cost)) Sim.enqueue(dock, { kind: 'unit', id: 'transport' }); return; }
    const men = vill.filter((v) => World.regionAt(v.x, v.y) === homeReg && !(v.order && (v.order.type === 'build' || (v.order.type === 'gather' && v.order.res && rk(v.order.res) === 'farm')))).sort((a, b) => U.dist2(a.x, a.y, ship.x, ship.y) - U.dist2(b.x, b.y, ship.x, ship.y)).slice(0, 5);
    if (men.length < 3) return;
    for (const m of men) Sim.setOrder(m, { type: 'board', ship });
    // lay out the camp now, while the wood is in hand; the settlers build it when they land
    if (!p.buildings('miningcamp').some((b) => U.dist(b.x, b.y, res.x, res.y) < 10)) AI.placeNear(p, 'miningcamp', { x: res.x + 0.5, y: res.y + 0.5 }, [], 2);
    S.colony = { ship, men, res, region: World.resRegion(res), phase: 'board', t: Game.time };
  },
  /* Work for a villager on an island away from home: whatever it has, with a camp beside it. */
  assignAway(p, S, u) {
    const reg = World.regionAt(u.x, u.y), order = ['gold', 'stone', 'wood'].sort((a, b) => p.res[a] - p.res[b]);
    for (const kind of order) {
      const rkind = kind === 'wood' ? 'tree' : kind;
      let r = null, bd = Infinity;
      for (const rr of World.res) { if (rr.kind !== rkind || rr.amount <= 0 || World.resRegion(rr) !== reg) continue; const d = U.dist2(rr.x, rr.y, u.x, u.y); if (d < bd) { bd = d; r = rr; } }
      if (!r) continue;
      const camp = kind === 'wood' ? 'lumbercamp' : 'miningcamp';
      const drop = p.buildings().some((b) => b.def.dropoff && b.def.dropoff.includes(kind) && U.dist(b.x, b.y, r.x, r.y) < 12 && Sim.canReach(u, b));
      if (!drop) { const pending = p.buildings(camp).find((b) => !b.built && World.regionAt(b.x, b.y) === reg); if (pending) { Sim.setOrder(u, { type: 'build', bld: pending }); return true; } if (AI.placeNear(p, camp, { x: r.x + 0.5, y: r.y + 0.5 }, [u], 2)) return true; }
      if (Sim.assignGather(u, r, null, 12)) return true;
    }
    return false;
  },
  /* Seaborne attack: build transports, load the army at the home shore, land it beside the target. */
  invade(p, S, mil) {
    const v = S.invasion, t = v.target, home = S.home;
    if (!t || t.dead || !home) { S.invasion = null; return; }
    const homeReg = World.regionAt(home.x, home.y), tReg = World.regionAt(t.x, t.y);
    const dock = p.buildings('dock').find((b) => b.built);
    const army = mil.filter((u) => World.regionAt(u.x, u.y) === homeReg && u.def.cls !== 'siege');
    const trans = p.units('transport').filter((s) => !s.dead);
    const age = Game.time - v.t;
    if (v.phase === 'ships') {
      const need = Math.min(3, Math.max(1, Math.ceil(army.length / 8)));
      if (trans.length < need && dock) { if (!dock.queue.some((q) => q.id === 'transport') && p.canAfford(UNITS.transport.cost) && p.pop() < p.popCap()) Sim.enqueue(dock, { kind: 'unit', id: 'transport' }); }
      if (!dock && age > 90) { S.invasion = null; return; }
      if (trans.length >= need || (trans.length && age > 100)) {
        const shore = World.landingNear(home.x, home.y, homeReg, 22);
        v.ships = trans.slice(0, need);
        if (shore) for (const s of v.ships) if (!s.cargo.length) Sim.setOrder(s, { type: 'move', x: shore[0], y: shore[1] });
        let i = 0; for (const u of army) { const s = v.ships[i % v.ships.length]; if (s.cargo.length + army.filter((a) => a.order && a.order.ship === s).length < s.def.capacity) Sim.setOrder(u, { type: 'board', ship: s }); i++; }
        v.phase = 'board'; v.t = Game.time;
      }
      if (age > 240) S.invasion = null;
      return;
    }
    const ships = (v.ships || []).filter((s) => !s.dead);
    if (!ships.length) { S.invasion = null; return; }
    if (v.phase === 'board') {
      const boarding = mil.filter((u) => u.order && u.order.type === 'board').length;
      if ((!boarding && ships.some((s) => s.cargo.length)) || age > 50) {
        for (const s of ships) if (s.cargo.length) Sim.setOrder(s, { type: 'unload', x: t.x, y: t.y, region: tReg, after: { type: 'attackmove', x: Math.floor(t.x), y: Math.floor(t.y) } });
        for (const u of mil) if (u.order && u.order.type === 'board') Sim.idle(u);
        for (const g of p.units('galley')) Sim.setOrder(g, { type: 'attackmove', x: Math.floor(t.x), y: Math.floor(t.y) });
        v.phase = 'sail'; v.t = Game.time;
        if (!ships.some((s) => s.cargo.length)) S.invasion = null;
      }
      return;
    }
    if (v.phase === 'sail') {
      if (ships.every((s) => !s.cargo.length) || age > 150) {
        if (Game.players[t.owner] && t.owner === Game.human) Game.onAIAttack(p, t);
        S.invasion = null; S.attacking = true; S.attackTarget = t; S.attackStart = Game.time; S.lastAttack = Game.time;
        const shore = World.landingNear(home.x, home.y, homeReg, 22);
        for (const s of ships) if (!s.cargo.length && shore) Sim.setOrder(s, { type: 'move', x: shore[0], y: shore[1] });
      }
    }
  },
  /* Nearest enemy building it is willing to hit, with a preference for the human player and soft targets first. */
  pickTarget(p, S, near) {
    const from = near || S.home || { x: World.w / 2, y: World.h / 2 };
    let best = null, bs = Infinity;
    for (const b of Game.buildings) {
      if (b.dead || b.owner === p.id || !Game.players[b.owner].alive || !AI.hostileTo(p, b.owner)) continue;
      let s = U.dist(b.x, b.y, from.x, from.y);
      if (b.owner === Game.human) s *= 0.7;
      if (b.def.attack) s *= 1.6; if (b.type === 'townhall') s *= 1.2; if (b.type === 'house' || b.type === 'farm') s *= 0.9;
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  },
  /* Raiders at the gates and not enough soldiers to meet them: ring the bell. All clear after twelve quiet seconds. */
  bell(p, S, th, mil) {
    if (!th || !S.home) return;
    const home = S.home;
    let enemies = 0; for (const u of Game.units) if (!u.dead && u.owner !== p.id && u.type !== 'villager' && U.dist(u.x, u.y, home.x, home.y) < 16) enemies++;
    if (enemies) S.lastEnemy = Game.time;
    const ownNear = mil.filter((u) => U.dist(u.x, u.y, home.x, home.y) < 16).length;
    if (!th.bell && enemies >= 2 && ownNear < enemies) Sim.ringBell(th);
    else if (th.bell && Game.time - (S.lastEnemy == null ? -99 : S.lastEnemy) > 12) Sim.ringBell(th);
  },
  /* A ring of wall around the town with a gate in each side, filled in a few pieces at a time and mended when breached. */
  walls(p, S, vill) {
    const D = S.D; if (!D.walls || p.age < D.wallAge || !S.home || !vill.length) return;
    S.wallT = (S.wallT || 0) + 1; if (S.wallT % 3) return;
    // walls come out of surplus: the town proper comes first, and a reserve stays for houses and workshops
    if (S.needBuilding || p.buildings().some((b) => !b.built && !b.def.wall) || p.count('barracks') === 0 || p.buildings().filter((b) => !b.def.wall).length < 8) return;
    if (!S.ring) {
      if (vill.length < D.wallVillagers) return;
      const own = p.buildings().filter((b) => !b.def.wall);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of own) { x0 = Math.min(x0, b.tx); y0 = Math.min(y0, b.ty); x1 = Math.max(x1, b.tx + b.size - 1); y1 = Math.max(y1, b.ty + b.size - 1); }
      const m = 4; x0 = U.clamp(x0 - m, 1, World.w - 2); y0 = U.clamp(y0 - m, 1, World.h - 2); x1 = U.clamp(x1 + m, 1, World.w - 2); y1 = U.clamp(y1 + m, 1, World.h - 2);
      if (x1 - x0 < 8 || y1 - y0 < 8) return;
      S.ring = { x0, y0, x1, y1 }; S.gateTiles = null;
    }
    const stone = p.age >= D.stoneAge && p.res.stone >= 250;
    const wallType = stone ? 'stonewall' : 'palisade', gateType = stone ? 'stonegate' : 'palisadegate';
    const r = S.ring;
    // gates first: one per side, on the open tile nearest the middle of that side
    if (!S.gateTiles) {
      S.gateTiles = [];
      const mx = Math.round((r.x0 + r.x1) / 2), my = Math.round((r.y0 + r.y1) / 2);
      const sides = [[(x) => [x, r.y0], mx, r.x0, r.x1], [(x) => [x, r.y1], mx, r.x0, r.x1], [(y) => [r.x0, y], my, r.y0, r.y1], [(y) => [r.x1, y], my, r.y0, r.y1]];
      for (const [f, mid, lo, hi] of sides) {
        for (let d = 0; d <= hi - lo; d++) { let found = null; for (const k of [mid - d, mid + d]) { if (k < lo + 1 || k > hi - 1) continue; const [x, y] = f(k); if (World.canPlace(BUILDINGS[gateType], x, y, true) && World.passable(x, y)) { found = [x, y]; break; } } if (found) { S.gateTiles.push(found); break; } }
      }
      if (S.gateTiles.length < 2) { S.ring = null; S.gateTiles = null; return; } // no way to leave a door open here; try another day
    }
    const gateKey = new Set(S.gateTiles.map(([x, y]) => x + ',' + y));
    let gates = 0;
    for (const [x, y] of S.gateTiles) {
      const b = World.bld[World.idx(x, y)];
      if (b && !b.dead) { if (b.owner === p.id && b.def.gate) gates++; continue; }
      if (p.canAfford(BUILDINGS[gateType].cost) && World.canPlace(BUILDINGS[gateType], x, y, true) && Game.placeBuilding(p, gateType, x, y)) gates++;
    }
    if (gates < Math.min(2, S.gateTiles.length)) return;      // never seal the town without doors
    const reserve = stone ? { stone: 150 } : { wood: 220 };
    if (!AI.spendable(p, S, reserve)) return;
    const tiles = [];
    for (let x = r.x0; x <= r.x1; x++) { tiles.push([x, r.y0]); tiles.push([x, r.y1]); }
    for (let y = r.y0 + 1; y < r.y1; y++) { tiles.push([r.x0, y]); tiles.push([r.x1, y]); }
    let placed = 0; const cap = (stone ? p.res.stone : p.res.wood) > 500 ? 10 : 5;
    for (const [x, y] of tiles) {
      if (placed >= cap || !p.canAfford(reserve)) break;
      if (gateKey.has(x + ',' + y)) continue;
      const b = World.bld[World.idx(x, y)];
      if (b && !b.dead) continue;                               // ours, or something else standing there
      const def = BUILDINGS[wallType];
      if (!World.canPlace(def, x, y, true) || !p.canAfford(def.cost)) continue;
      if (Game.placeBuilding(p, wallType, x, y)) placed++;
    }
    // two villagers on wall duty while there are pieces to raise
    const unbuilt = p.buildings().filter((b) => b.def.wall && !b.built).sort((a, c) => (c.def.gate ? 1 : 0) - (a.def.gate ? 1 : 0));
    if (!unbuilt.length) return;
    const onDuty = vill.filter((v) => v.order && v.order.type === 'build' && v.order.bld && v.order.bld.def.wall).length;
    for (let k = onDuty; k < 2; k++) { const target = unbuilt[0].def.gate ? unbuilt[0] : unbuilt[Math.floor(Math.random() * unbuilt.length)]; const v = AI.pickBuilder(vill, target); if (v) Sim.setOrder(v, { type: 'build', bld: target }); }
  },
  /* Mend anything badly damaged once no enemy is near it. */
  repair(p, S, vill) {
    if (!vill.length || S.attackingHome) return;
    for (const b of p.buildings()) {
      if (!b.built || b.hp > b.maxHp * 0.6) continue;
      if (Game.units.some((u) => !u.dead && u.owner !== p.id && u.type !== 'villager' && U.dist(u.x, u.y, b.x, b.y) < 10)) continue;
      if (vill.some((v) => v.order && v.order.type === 'build' && v.order.bld === b)) continue;
      const v = AI.pickBuilder(vill, b); if (v) { Sim.setOrder(v, { type: 'build', bld: b }); return; }
    }
  },
  /* Someone is hitting our buildings or villagers: respond with whatever is idle nearby. */
  defend(p, S, mil) {
    let threat = null;
    for (const b of p.buildings()) if (b.lastHit != null && Game.time - b.lastHit < 4 && b.lastAttacker && !b.lastAttacker.dead && b.lastAttacker.kind === 'unit') threat = b.lastAttacker;
    if (!threat) for (const u of p.units('villager')) if (u.lastHit != null && Game.time - u.lastHit < 3 && u.lastAttacker && !u.lastAttacker.dead && u.lastAttacker.kind === 'unit') threat = u.lastAttacker;
    if (!threat) return;
    S.threat = threat; S.threatT = Game.time;
    const defenders = mil.filter((u) => (!u.order || u.order.type === 'attackmove' || (u.order.type === 'attack' && u.order.target && u.order.target.kind === 'building')) && World.regionAt(u.x, u.y) === World.regionAt(threat.x, threat.y));
    for (const u of defenders) if (U.dist(u.x, u.y, threat.x, threat.y) < 30 || !S.attacking) Sim.setOrder(u, { type: 'attack', target: threat });
    // villagers flee from soldiers if they are far from home... simply keep working (like the classics)
    if (!mil.length && S.home && p.canAfford(UNITS.spearman.cost)) { const br = p.buildings('barracks').find((b) => b.built && b.queue.length < 3); if (br) Sim.enqueue(br, { kind: 'unit', id: 'spearman' }); }
  },
};
