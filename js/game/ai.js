/* Bot players. One decision pass per second: economy, construction, research, training, attack, defence.
   The bot plays by the same rules as the human (same costs, same units); difficulty changes its
   targets, tempo and a small gather-rate modifier, not what it is allowed to do. */
const DIFF = {
  easy:   { tick: 1.4, villagers: 12, army: 16, attackGap: 240, firstAttack: 480, gather: -0.15, farms: 4, towers: 0, techs: false, walls: false },
  normal: { tick: 1.0, villagers: 20, army: 12, attackGap: 150, firstAttack: 330, gather: 0,     farms: 6, towers: 1, techs: true,  walls: true, wallAge: 1, stoneAge: 2, wallVillagers: 14 },
  hard:   { tick: 0.7, villagers: 28, army: 9,  attackGap: 100, firstAttack: 240, gather: 0.15,  farms: 9, towers: 2, techs: true,  walls: true, wallAge: 0, stoneAge: 1, wallVillagers: 12 },
};
const AI = {
  create(p) {
    const D = DIFF[p.difficulty] || DIFF.normal;
    p.ai = { D, t: Math.random() * D.tick, lastAttack: -Infinity, attacking: false, attackTarget: null, attackStart: 0, lastHouse: -99, threat: null, threatT: -99, rng: RNG.make(RNG.seedFrom('ai' + p.id + Game.seed)) };
    for (const k of RESOURCES) p.mods.gather[k] += D.gather;
  },
  tick(p, dt) {
    const S = p.ai; S.t -= dt; if (S.t > 0 || !p.alive) return;
    S.t = S.D.tick;
    const th = p.buildings('townhall').find((b) => b.built) || null;
    const vill = p.units('villager'), mil = p.units().filter((u) => u.type !== 'villager');
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
    AI.attack(p, S, mil);
  },

  /* Decide what we are saving for. While a goal is set, optional spending only uses the surplus. */
  plan(p, S, th, vill) {
    S.goal = null;
    const nx = AGES[p.age + 1];
    if (!th || !nx) return;
    const D = S.D;
    if (vill.length < Math.min(D.villagers * 0.7, 13)) return;
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
    if (th && vill.length < D.villagers && th.queue.length < 2 && p.pop() < p.popCap()) Sim.enqueue(th, { kind: 'unit', id: 'villager' });
    // Rebuild a town hall if it is lost
    if (!th && vill.length && p.canAfford(BUILDINGS.townhall.cost) && !p.buildings('townhall').length) AI.placeNear(p, 'townhall', S.home || { x: vill[0].x, y: vill[0].y }, vill);
    // Desired split by age
    const split = p.age === 0 ? { food: 0.5, wood: 0.42, gold: 0.08, stone: 0 } : p.age === 1 ? { food: 0.42, wood: 0.3, gold: 0.2, stone: 0.08 } : { food: 0.38, wood: 0.26, gold: 0.26, stone: 0.1 };
    // Shift towards what we are short of
    for (const k of RESOURCES) { if (p.res[k] > 700) split[k] *= 0.5; if (p.res[k] < 80) split[k] *= 1.6; }
    if (p.age === 0 && p.res.food < 400 && vill.length >= 10) split.food *= 1.3;
    const total = Object.values(split).reduce((a, b) => a + b, 0); for (const k in split) split[k] /= total;
    const counts = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle = [];
    for (const u of vill) {
      if (!u.order) idle.push(u);
      else if (u.order.type === 'gather' && u.order.res) counts[RES_KIND[rk(u.order.res)]]++;
      else if (u.order.type === 'gather' && u.carry.kind) counts[u.carry.kind]++;
    }
    const working = Object.values(counts).reduce((a, b) => a + b, 0) + idle.length || 1;
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
    const resKind = { food: 'berry', wood: 'tree', gold: 'gold', stone: 'stone' }[kind];
    const kinds = kind === 'food' ? ['berry', 'fish'] : [resKind];
    const drops = AI.dropoffs(p, kind);
    const nearDrop = (r) => drops.some((d) => U.dist(d.x, d.y, r.x, r.y) <= 9);
    // something already serviced by a drop-off
    let r = null, bd = Infinity;
    for (const rr of World.res) { if (!kinds.includes(rr.kind) || rr.amount <= 0) continue; if ((rr.workers || 0) >= (rr.kind === 'tree' ? 2 : 5)) continue; if (!nearDrop(rr)) continue; const d = U.dist2(rr.x, rr.y, u.x, u.y); if (d < bd) { bd = d; r = rr; } }
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
    for (const rr of World.res) { if (rr.kind !== resKind || rr.amount <= 0) continue; const d = U.dist2(rr.x, rr.y, home.x, home.y); if (d < bd) { bd = d; far = rr; } }
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
    if (th && nx && vill.length >= Math.min(D.villagers * 0.75, 14) && !p.ageUpBlocker()) Sim.enqueue(th, { kind: 'age' });
  },
  pickBuilder(vill, b) {
    let best = null, bd = Infinity;
    for (const v of vill) { if (v.order && (v.order.type === 'build' || v.order.type === 'attack')) continue; if (v.order && v.order.type === 'gather' && v.order.res && rk(v.order.res) === 'farm') continue; const d = U.dist2(v.x, v.y, b.x, b.y); if (d < bd) { bd = d; best = v; } }
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
    const pop = p.pop(), cap = p.popCap(); if (pop >= cap) return;
    const mil = p.buildings().filter((b) => b.built && b.def.trains && b.type !== 'townhall' && b.queue.length < 2);
    for (const b of mil) {
      const opts = b.def.trains.filter((id) => UNITS[id].age <= p.age);
      if (!opts.length) continue;
      // best available from this building, with some variety
      let id = opts[opts.length - 1]; if (S.rng() < 0.3) id = opts[0];
      const d = UNITS[id];
      // keep a little for villagers and houses while still small
      const reserveFood = vill < D.villagers ? 60 : 0;
      if (p.res.food - reserveFood < (d.cost.food || 0) || !AI.spendable(p, S, d.cost)) continue;
      Sim.enqueue(b, { kind: 'unit', id });
    }
  },
  attack(p, S, mil) {
    const D = S.D, idleMil = mil.filter((u) => !u.order || u.order.type === 'attackmove');
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
        for (const u of idleMil) if (!u.order) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(t.x), y: Math.floor(t.y) });
      }
      return;
    }
    const ready = mil.length >= D.army && Game.time - S.lastAttack >= D.attackGap && Game.time >= D.firstAttack;
    if (!ready) {
      // gather the army at the frontier so it is not scattered
      if (S.home && S.rng() < 0.2) { const f = AI.frontier(p, S.home, 5); for (const u of mil) if (!u.order && U.dist(u.x, u.y, f.x, f.y) > 6) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(f.x), y: Math.floor(f.y) }); }
      return;
    }
    const target = AI.pickTarget(p, S, null); if (!target) return;
    S.attacking = true; S.attackTarget = target; S.attackStart = Game.time; S.lastAttack = Game.time;
    for (const u of mil) Sim.setOrder(u, { type: 'attackmove', x: Math.floor(target.x), y: Math.floor(target.y) });
    Game.onAIAttack(p, target);
  },
  /* Nearest enemy building, with a preference for the human player and for soft targets first. */
  pickTarget(p, S, near) {
    const from = near || S.home || { x: World.w / 2, y: World.h / 2 };
    let best = null, bs = Infinity;
    for (const b of Game.buildings) {
      if (b.dead || b.owner === p.id || !Game.players[b.owner].alive) continue;
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
    const defenders = mil.filter((u) => !u.order || u.order.type === 'attackmove' || (u.order.type === 'attack' && u.order.target && u.order.target.kind === 'building'));
    for (const u of defenders) if (U.dist(u.x, u.y, threat.x, threat.y) < 30 || !S.attacking) Sim.setOrder(u, { type: 'attack', target: threat });
    // villagers flee from soldiers if they are far from home... simply keep working (like the classics)
    if (!mil.length && S.home && p.canAfford(UNITS.spearman.cost)) { const br = p.buildings('barracks').find((b) => b.built && b.queue.length < 3); if (br) Sim.enqueue(br, { kind: 'unit', id: 'spearman' }); }
  },
};
