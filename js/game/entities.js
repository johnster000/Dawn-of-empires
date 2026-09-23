/* Players, units and buildings, plus the per-tick simulation of what they do. */

const GATHER_RATE = { berry: 0.5, tree: 0.55, stone: 0.45, gold: 0.45, farm: 0.48, fish: 0.5 };
const RES_KIND = { berry: 'food', tree: 'wood', stone: 'stone', gold: 'gold', farm: 'food', fish: 'food' };
const BASE_CARRY = 10;
/* How close counts as "at" a building. A unit has width and gets shoved by its neighbours, so a crowd around a
   drop-off or a building site settles a little over a tile out; anything tighter than this and the ones on the
   outside never register as having arrived. */
const REACH = 1.6;
/* Resource kind of a gather target: natural resources carry their own kind; a farm is a building. */
const rk = (r) => (r && r.kind === 'building' ? 'farm' : r ? r.kind : null);

class Player {
  constructor(id, opts) {
    this.id = id; this.name = opts.name; this.color = opts.color; this.isAI = !!opts.isAI; this.difficulty = opts.difficulty || 'normal';
    this.res = Object.assign({ food: 200, wood: 200, stone: 100, gold: 100 }, opts.res || {});
    this.age = opts.age || 0; this.techs = new Set(); this.alive = true;
    this.mods = Player.baseMods();
    this.faction = FACTIONS[opts.faction] ? opts.faction : 'romans';
    this.addEffect(FACTIONS[this.faction].effect);
    this.stats = { gathered: { food: 0, wood: 0, stone: 0, gold: 0 }, kills: 0, losses: 0, razed: 0, trained: 0 };
    this.ai = null;
    this.grudge = {}; // player id -> when they last drew blood from us
  }
  static baseMods() { return { atk: {}, armor: {}, range: {}, gather: { food: 0, wood: 0, stone: 0, gold: 0 }, farmYield: 0, villagerSpeed: 0, carry: 0, villagerHp: 0, villagerArmor: 0, towerAtk: 0, towerRange: 0, trainSpeed: 0, trainCls: {}, buildSpeed: 0, researchSpeed: 0 }; }
  addEffect(e) { const m = this.mods; for (const k in e) { if (typeof e[k] === 'number') m[k] = (m[k] || 0) + e[k]; else { m[k] = m[k] || {}; for (const c in e[k]) m[k][c] = (m[k][c] || 0) + e[k][c]; } } }
  /* Switch people (used when a save is restored): start the modifiers again from this people's bonus. */
  setFaction(id) { if (!FACTIONS[id]) return; this.faction = id; this.mods = Player.baseMods(); this.addEffect(FACTIONS[id].effect); const t = [...this.techs]; this.techs.clear(); for (const x of t) this.applyTech(x); }
  /* Unique warriors belong to one people. */
  mayTrain(id) { const d = UNITS[id]; return !!d && (!d.faction || d.faction === this.faction); }
  trainTime(id) { const d = UNITS[id]; return d.cls === 'villager' ? d.time : d.time / (1 + this.mods.trainSpeed + (this.mods.trainCls[d.cls] || 0)); }
  canAfford(cost) { for (const k in cost) if ((this.res[k] || 0) < cost[k]) return false; return true; }
  missing(cost) { const m = []; for (const k in cost) if ((this.res[k] || 0) < cost[k]) m.push(k); return m; }
  pay(cost) { for (const k in cost) this.res[k] -= cost[k]; }
  refund(cost) { for (const k in cost) this.res[k] += cost[k]; }
  popCap() { let c = 0; for (const b of Game.buildings) if (!b.dead && b.built && b.owner === this.id) c += b.def.pop || 0; return Math.min(c, Game.settings.popCap); }
  pop() { let n = 0; for (const u of Game.units) if (!u.dead && u.owner === this.id) { n++; if (u.cargo) n += u.cargo.length; } for (const b of Game.buildings) if (!b.dead && b.owner === this.id) { n += b.garrison.length; for (const q of b.queue) if (q.kind === 'unit') n++; } return n; }
  hasTech(id) { return this.techs.has(id); }
  applyTech(id) {
    const t = TECHS[id]; if (!t || this.techs.has(id)) return;
    this.techs.add(id);
    this.addEffect(t.effect);
    for (const u of Game.units) if (!u.dead && u.owner === this.id) Sim.refreshUnit(u);
  }
  buildings(type) { return Game.buildings.filter((b) => !b.dead && b.owner === this.id && (!type || b.type === type)); }
  units(type) { return Game.units.filter((u) => !u.dead && u.owner === this.id && (!type || u.type === type)); }
  count(type) { let n = 0; for (const b of Game.buildings) if (!b.dead && b.owner === this.id && b.type === type) n++; return n; }
  countUnits(type) { let n = 0; for (const u of Game.units) if (!u.dead && u.owner === this.id && u.type === type) n++; return n; }
  /* Can this player start advancing to the next age? Returns null or a reason string. */
  ageUpBlocker() {
    const next = AGES[this.age + 1]; if (!next) return 'Already in the final age';
    const need = next.advance.need.filter((t) => this.count(t) > 0 && this.buildings(t).some((b) => b.built)).length;
    if (need < next.advance.needCount) return `Needs ${next.advance.needCount} different ${AGES[this.age].name} buildings (${need}/${next.advance.needCount})`;
    for (const b of this.buildings('townhall')) if (b.queue.some((q) => q.kind === 'age')) return 'Already advancing';
    if (!this.canAfford(next.advance.cost)) return 'Not enough ' + this.missing(next.advance.cost).join(', ');
    return null;
  }
}

/* ---------------- factories ---------------- */
const Ent = {
  nextId: 1,
  unit(type, owner, x, y) {
    const def = UNITS[type];
    const u = { id: Ent.nextId++, kind: 'unit', type, def, owner, x, y, hp: def.hp, maxHp: def.hp, dead: false, cargo: def.capacity ? [] : null,
      order: null, path: null, carry: { kind: null, amt: 0 }, cd: 0, face: 0.8, anim: 0, moving: false, scanT: Math.random() * 0.4, idleT: 0, swing: 0, stuck: 0 };
    Sim.refreshUnit(u);
    return u;
  },
  building(type, owner, tx, ty, built) {
    const def = BUILDINGS[type];
    const b = { id: Ent.nextId++, kind: 'building', type, def, owner, tx, ty, size: def.size, x: tx + def.size / 2, y: ty + def.size / 2,
      hp: built ? def.hp : 1, maxHp: def.hp, dead: false, built: !!built, progress: built ? 1 : 0, builders: 0, buildersLast: 0,
      queue: [], qt: 0, rally: null, cd: 0, worker: null, garrison: [], bell: false, amount: def.farm ? Infinity : 0, kindRes: def.farm ? 'farm' : null, monumentT: 0, ageVisual: 0 };
    b.ageVisual = Game.players[owner] ? Game.players[owner].age : 0;
    return b;
  },
};

/* ---------------- simulation ---------------- */
const Sim = {
  /* Recompute derived stats from base + owner's technologies. */
  refreshUnit(u) {
    const p = Game.players[u.owner], m = p.mods, d = u.def, c = d.cls;
    const oldMax = u.maxHp;
    u.atk = d.atk + (m.atk[c] || 0);
    u.armor = d.armor + (m.armor[c] || 0) + (c === 'villager' ? m.villagerArmor : 0);
    u.range = d.range + (m.range[c] || 0);
    u.speed = d.speed * (1 + (c === 'villager' ? m.villagerSpeed : 0));
    u.maxHp = d.hp + (c === 'villager' ? m.villagerHp : 0);
    if (u.maxHp !== oldMax) u.hp += u.maxHp - oldMax;
    u.carryCap = d.carry || BASE_CARRY + m.carry;
  },
  /* Where a unit may be: ships on open water, everyone else on land. */
  pass(u, x, y) { return u.def.naval ? World.sailable(x, y) : World.passable(x, y, u.owner); },
  effectiveRange(u) { return u.range > 0 ? u.range : 0; },

  /* Nobody stands inside anybody else: overlapping units are nudged apart each tick. Units busy at a task hold
     their ground; walkers and idlers give way. */
  radius(u) { return u.def.naval ? 0.45 : u.def.cls === 'cavalry' ? 0.32 : u.def.cls === 'siege' ? 0.38 : 0.24; },
  tileUnits: new Map(),
  /* Is somebody other than `except` standing on this tile? */
  occupied(x, y, except) {
    const b = this.tileUnits.get(y * World.w + x); if (!b) return false;
    for (const v of b) if (v !== except && !v.dead) return true;
    return false;
  },
  /* Somebody who has stopped for good: idle, or busy at a task. A unit on its way somewhere will move on,
     so it is worth waiting for; one that has settled never will. */
  settledOn(x, y, except) {
    const b = this.tileUnits.get(y * World.w + x); if (!b) return false;
    for (const v of b) if (v !== except && !v.dead && (!v.order || Sim.fixed(v))) return true;
    return false;
  },
  fixed(u) { const o = u.order; return !!(o && ((o.type === 'gather' && o.phase === 'gathering') || (o.type === 'build' && !u.moving && !u.path) || (o.type === 'attack' && !u.moving))); },
  separate() {
    const buckets = this.tileUnits = new Map(), W = World.w;
    for (const u of Game.units) { if (u.dead) continue; const k = Math.floor(u.y) * W + Math.floor(u.x); let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(u); }
    for (const u of Game.units) {
      if (u.dead) continue;
      const ux = Math.floor(u.x), uy = Math.floor(u.y), ru = Sim.radius(u);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const b = buckets.get((uy + dy) * W + ux + dx); if (!b) continue;
        for (const v of b) {
          if (v.id <= u.id || v.dead || !u.def.naval !== !v.def.naval) continue; // ships and walkers never shove each other
          let ddx = v.x - u.x, ddy = v.y - u.y; const min = ru + Sim.radius(v), d2 = ddx * ddx + ddy * ddy;
          if (d2 >= min * min) continue;
          let d = Math.sqrt(d2); if (d < 0.01) { const a = (u.id * 0.7 + v.id * 1.3) % 6.283; ddx = Math.cos(a); ddy = Math.sin(a); d = 1; }
          const push = (min - d) * 0.5;
          let nx = ddx / d, ny = ddy / d;
          const fu = Sim.fixed(u), fv = Sim.fixed(v);
          // Two walkers closing head-on get a sideways nudge so they slide past. Everyone else is pushed straight
          // apart: a mutual sideways nudge between units that are not closing on each other spins the pair, and
          // a knot of them ends up orbiting instead of getting anywhere.
          if (!fu && !fv && u.moving && v.moving && Math.cos(u.face) * Math.cos(v.face) + Math.sin(u.face) * Math.sin(v.face) < -0.15) {
            const t = ((u.id + v.id) & 1) ? 1 : -1, k = 0.4;
            const rx = nx * (1 - k) - ny * t * k, ry = ny * (1 - k) + nx * t * k, rl = Math.hypot(rx, ry) || 1; nx = rx / rl; ny = ry / rl;
          }
          const ku = fu && fv ? 0.5 : fu ? 0 : fv ? 1 : 0.5, kv = fu && fv ? 0.5 : fv ? 0 : fu ? 1 : 0.5;
          if (ku) { const nxp = u.x - nx * push * ku, nyp = u.y - ny * push * ku; if (Sim.pass(u, Math.floor(nxp), Math.floor(nyp))) { u.x = nxp; u.y = nyp; } if (!u.order) u.shoved = 1; }
          if (kv) { const nxp = v.x + nx * push * kv, nyp = v.y + ny * push * kv; if (Sim.pass(v, Math.floor(nxp), Math.floor(nyp))) { v.x = nxp; v.y = nyp; } if (!v.order) v.shoved = 1; }
        }
      }
    }
  },

  /* ---- standing spots ----
     A resource can only be worked from the tiles around it, so a crowd sent to one tree would otherwise all walk at
     the same tile and shove each other off it. Every worker claims a distinct tile; when a resource has no free tile
     left the worker is sent to the next one of its kind instead. Claims live in one map keyed by tile. */
  claims: new Map(),
  key(x, y) { return x + ',' + y; },
  release(u) { if (u.spotKey && Sim.claims.get(u.spotKey) === u) Sim.claims.delete(u.spotKey); u.spotKey = null; },
  claim(u, spot) { Sim.release(u); u.spotKey = Sim.key(spot[0], spot[1]); Sim.claims.set(u.spotKey, u); },
  rebuildClaims() { Sim.claims.clear(); for (const u of Game.units) { u.spotKey = null; const o = u.order; if (o && o.type === 'gather' && o.spot) Sim.claim(u, o.spot); } },
  /* The tiles a worker can stand on to reach this resource. */
  resSpots(r, u) {
    const out = [];
    for (const [dx, dy] of U.DIRS) { const x = r.x + dx, y = r.y + dy; if (u && u.def.naval ? World.sailable(x, y) : World.passable(x, y)) out.push([x, y]); }
    return out;
  },
  /* The free standing tile nearest this worker, or null when every one is claimed. */
  freeSpot(u, r) {
    let best = null, bd = Infinity;
    if (u.def.gather && u.def.gather.length && !u.def.gather.includes(rk(r))) return null; // boats only fish
    for (const s of Sim.resSpots(r, u)) {
      const holder = Sim.claims.get(Sim.key(s[0], s[1]));
      if (holder && holder !== u && !holder.dead) continue;
      const d = U.dist2(s[0] + 0.5, s[1] + 0.5, u.x, u.y); if (d < bd) { bd = d; best = s; }
    }
    return best;
  },
  /* The nearest resource of a kind that still has room to work it. Searched outward ring by ring over the tile grid,
     so a map with thousands of trees costs no more than a map with a dozen. */
  nearestFree(u, kind, x, y, radius, except) {
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bd = Infinity;
    for (let r = 0; r <= radius; r++) {
      if (best && bd <= (r - 1) * (r - 1)) break;         // nothing further out can beat what we have
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (!World.inBounds(tx, ty)) continue;
        const res = World.resAt[World.idx(tx, ty)];
        if (!res || res.kind !== kind || res.amount <= 0 || res === except) continue;
        const d = U.dist2(tx + 0.5, ty + 0.5, x, y);
        if (d >= bd || !Sim.freeSpot(u, res)) continue;
        bd = d; best = res;
      }
    }
    return best;
  },
  /* Put a worker on a resource, or on the nearest one of the same kind with room. */
  assignGather(u, r, dropoff, radius) {
    if (!r) return false;
    const kind = rk(r);
    if (kind === 'farm') {
      if (r.worker && r.worker !== u && !r.worker.dead) { const f = Sim.freeFarm(u, radius || 16); if (!f) return false; r = f; }
      Sim.setOrder(u, { type: 'gather', res: r, dropoff }); return true;
    }
    let spot = Sim.freeSpot(u, r);
    if (!spot) { const alt = Sim.nearestFree(u, kind, r.x + 0.5, r.y + 0.5, radius || 12, r); if (!alt) return false; r = alt; spot = Sim.freeSpot(u, r); }
    if (!spot) return false;
    Sim.setOrder(u, { type: 'gather', res: r, dropoff, spot });
    return true;
  },

  /* ---- orders ---- */
  setOrder(u, order) {
    if (u.order && u.order.type === 'gather' && u.order.res && rk(u.order.res) === 'farm') { if (u.order.res.worker === u) u.order.res.worker = null; }
    if (u.order && u.order.type === 'gather' && u.order.res && u.order.res.workers != null) u.order.res.workers = Math.max(0, u.order.res.workers - 1);
    u.order = order; u.path = null; u.idleT = 0; u.stuck = 0; u.jam = 0; u.stillT = 0; u.wx = u.x; u.wy = u.y;
    Sim.release(u);
    if (order && order.type === 'gather' && order.res) {
      if (rk(order.res) === 'farm') order.res.worker = u; else order.res.workers = (order.res.workers || 0) + 1;
      if (order.spot) Sim.claim(u, order.spot);
      order.phase = u.carry.amt > 0 && u.carry.kind !== RES_KIND[rk(order.res)] ? 'return' : 'to';
    }
  },
  idle(u) { Sim.setOrder(u, null); },
  /* Shuffle to the nearest tile with nobody standing on it and nobody's gathering spot claimed. */
  stepAside(u) {
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    const clear = (x, y) => {
      if (!Sim.pass(u, x, y) || Sim.claims.has(Sim.key(x, y))) return false;
      for (const v of Game.units) if (v !== u && !v.dead && Math.floor(v.x) === x && Math.floor(v.y) === y) return false;
      return true;
    };
    const t = U.nearestTile(cx, cy, 3, clear);
    if (t && (t[0] !== cx || t[1] !== cy)) Sim.setOrder(u, { type: 'move', x: t[0], y: t[1] });
  },

  /* Path to a spot adjacent to a footprint (or onto it, if flat). Returns true if a path was set. */
  pathToEntity(u, e) {
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    const foot = Sim.footprint(e);
    let goal = null, bd = Infinity;
    if (e.def && e.def.passable) { goal = [Math.floor(e.x), Math.floor(e.y)]; }
    else {
      for (let x = foot.x0 - 1; x <= foot.x1 + 1; x++) for (let y = foot.y0 - 1; y <= foot.y1 + 1; y++) {
        if (x >= foot.x0 && x <= foot.x1 && y >= foot.y0 && y <= foot.y1) continue;
        if (!Sim.pass(u, x, y)) continue;
        const d = U.dist2(x, y, ux, uy); if (d < bd) { bd = d; goal = [x, y]; }
      }
    }
    if (!goal) return false;
    return Sim.pathTo(u, goal[0], goal[1]);
  },
  footprint(e) {
    if (e.kind === 'building') return { x0: e.tx, y0: e.ty, x1: e.tx + e.size - 1, y1: e.ty + e.size - 1 };
    const x = Math.floor(e.x), y = Math.floor(e.y); return { x0: x, y0: y, x1: x, y1: y };
  },
  pathTo(u, gx, gy) {
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    const here = World.regionAt(sx, sy), ok = (x, y) => Sim.pass(u, x, y) && (!here || World.regionAt(x, y) === here);
    if (!ok(gx, gy)) { const n = U.nearestTile(gx, gy, 6, ok); if (!n) return false; gx = n[0]; gy = n[1]; }
    if (sx === gx && sy === gy) { u.path = []; u.pathGoal = [gx, gy]; return true; }
    // a step or two away with a clear line: walk it rather than run a search
    if (Math.abs(gx - sx) <= 3 && Math.abs(gy - sy) <= 3) {
      const quick = U.walkLine(sx, sy, gx, gy, (x, y) => Sim.pass(u, x, y), 6);
      if (quick) { u.path = quick; u.pathGoal = [gx, gy]; return true; }
    }
    // Long searches are rationed: past the budget a unit gets a shallow, best-effort route and heads roughly the
    // right way, which it refines on a later tick. Keeps a crowd of orders from spiking a frame.
    const cap = Sim.pathBudget-- > 0 ? 5000 : 800;
    const path = U.astar(sx, sy, gx, gy, World.w, World.h, (x, y) => Sim.pass(u, x, y), cap);
    if (!path) return false;
    u.path = path; u.pathGoal = [gx, gy];
    return true;
  },
  /* Distance from a unit to the nearest edge of an entity's footprint. */
  distTo(u, e) {
    if (e.kind === 'unit') return U.dist(u.x, u.y, e.x, e.y);
    const f = Sim.footprint(e);
    const cx = U.clamp(u.x, f.x0, f.x1 + 1), cy = U.clamp(u.y, f.y0, f.y1 + 1);
    return U.dist(u.x, u.y, cx, cy);
  },
  distToRes(u, r) { return Math.max(0, U.dist(u.x, u.y, r.x + 0.5, r.y + 0.5) - 0.5); },

  /* Walk along the path. Returns 'arrived', 'moving' or 'blocked'. */
  step(u, dt) {
    if (!u.path || !u.path.length) { u.moving = false; return 'arrived'; }
    // Already standing on the next waypoint: take the one after it. Requiring a unit to reach the exact tile
    // centre pins it inside a crowd, where its neighbours shove away the last fraction of a tile every tick,
    // so it walks on the spot for as long as the crowd lasts.
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    while (u.path.length && u.path[0][0] === ux && u.path[0][1] === uy) u.path.shift();
    if (!u.path.length) { u.moving = false; return 'arrived'; }
    const [tx, ty] = u.path[0];
    if (!Sim.pass(u, tx, ty)) {
      // something was built in the way: re-path to the same goal
      if (u.pathGoal && Sim.pathTo(u, u.pathGoal[0], u.pathGoal[1])) return 'moving';
      u.path = null; u.moving = false; return 'blocked';
    }
    const gx = tx + 0.5, gy = ty + 0.5;
    const dx = gx - u.x, dy = gy - u.y, d = Math.sqrt(dx * dx + dy * dy);
    const stepLen = u.speed * dt;
    u.face = Math.atan2(dy, dx); u.moving = true; u.anim += dt * u.speed * 3;
    if (d <= stepLen) { u.x = gx; u.y = gy; u.path.shift(); if (!u.path.length) { u.moving = false; return 'arrived'; } }
    else { u.x += (dx / d) * stepLen; u.y += (dy / d) * stepLen; }
    return 'moving';
  },

  /* A unit that should be walking but has not moved is re-routed, and then sent somewhere else entirely. */
  watchdog(u, dt) {
    if (!u.path && !u.moving) { u.stillT = 0; u.wx = u.x; u.wy = u.y; return; }
    u.stillT = (u.stillT || 0) + dt;
    if (u.stillT < 0.6) return;
    const moved = U.dist2(u.x, u.y, u.wx == null ? u.x : u.wx, u.wy == null ? u.y : u.wy);
    u.stillT = 0; u.wx = u.x; u.wy = u.y;
    if (moved > 0.09) { u.jam = Math.max(0, (u.jam || 0) - 1); return; }   // 0.3 of a tile in 0.6 s
    u.jam = (u.jam || 0) + 1;
    if (u.jam === 3) { u.path = null; return; }             // try a fresh route
    if (u.jam >= 6) { u.jam = 0; Sim.unjam(u); }            // still nowhere after a few seconds: change target
  },
  unjam(u) {
    const o = u.order; if (!o) return;
    if (o.type === 'gather' && o.res) {
      const kind = rk(o.res);
      if (kind !== 'farm') { const alt = Sim.nearestFree(u, kind, u.x, u.y, 16, o.res); if (alt && Sim.assignGather(u, alt, o.dropoff, 16)) return; }
      // nowhere better to send them: keep the job and try the walk again rather than standing about idle
      if (!o.res.removed && !o.res.dead && o.res.amount > 0) { u.path = null; u.stuck = 0; return; }
      Sim.retarget(u, o); return;
    }
    // an attacker that cannot reach its target takes down whatever is in the way first
    if (o.type === 'attack' || o.type === 'attackmove') { const w = Sim.blocker(u, 6); if (w && w !== o.target) { Sim.setOrder(u, { type: 'attack', target: w, after: o.type === 'attack' ? o.target : null, resume: o.type === 'attackmove' ? o : null }); return; } }
    if (o.type === 'flee') { Sim.setOrder(u, o.prev || null); return; }
    if (o.type === 'build' && o.bld && !o.bld.dead) { u.path = null; u.stuck = 0; return; }   // the site may open up again
    Sim.idle(u); if (u.type === 'villager') Game.onIdleVillager(u);
  },

  /* Villagers caught in the open by soldiers run: into a nearby shelter if there is one, otherwise away. They pick
     up the job they left once the coast has been clear for a few seconds. */
  FLEE_SIGHT: 5, FLEE_CALM: 5,
  soldiers: [], shelters: [], listT: 0, pathBudget: 0,
  /* Rebuilt a couple of times a second: who can threaten a villager, and where one can hide. */
  refreshLists(dt) {
    this.pathBudget = 10;
    this.listT -= dt; if (this.listT > 0) return;
    this.listT = 0.5;
    this.soldiers = Game.units.filter((u) => !u.dead && u.type !== 'villager' && !u.def.noAttack && !u.def.naval);
    this.shelters = Game.players.map(() => []);
    for (const b of Game.buildings) if (!b.dead && b.built && b.def.garrison && this.shelters[b.owner]) this.shelters[b.owner].push(b);
  },
  checkFlee(u, dt) {
    u.fleeT = (u.fleeT || 0) - dt; if (u.fleeT > 0) return;
    u.fleeT = 0.4 + (u.id % 5) * 0.05;   // stagger the checks without making the simulation random
    const o = u.order;
    if (o && o.type === 'garrison') return;
    let threat = null, bd = Sim.FLEE_SIGHT * Sim.FLEE_SIGHT;
    for (const e of Sim.soldiers) { if (e.dead || e.owner === u.owner) continue; const d = U.dist2(e.x, e.y, u.x, u.y); if (d < bd) { bd = d; threat = e; } }
    if (!threat) {
      if (o && o.type === 'flee' && Game.time - o.since > Sim.FLEE_CALM) { const prev = o.prev; Sim.setOrder(u, null); if (prev && prev.type === 'gather' && prev.res && !prev.res.removed && !prev.res.dead) Sim.assignGather(u, prev.res, prev.dropoff, 14); else if (prev && prev.type === 'build' && prev.bld && !prev.bld.dead) Sim.setOrder(u, { type: 'build', bld: prev.bld }); else Game.onIdleVillager(u); }
      return;
    }
    if (o && o.type === 'flee' && Game.time - o.since < 1.2) return;
    const prev = o && (o.type === 'gather' || o.type === 'build') ? o : o && o.type === 'flee' ? o.prev : null;
    // a shelter with room, if it is not further off than the soldier
    let sh = null, sd = 15 * 15;
    for (const b of Sim.shelters[u.owner] || []) { if (b.dead || b.garrison.length >= b.def.garrison) continue; const d = U.dist2(b.x, b.y, u.x, u.y); if (d < sd) { sd = d; sh = b; } }
    if (sh && Math.sqrt(sd) < Math.sqrt(bd) + 6) { Sim.setOrder(u, { type: 'garrison', bld: sh, prev, flee: true }); return; }
    const a = Math.atan2(u.y - threat.y, u.x - threat.x);
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
      const t = U.nearestTile(Math.round(u.x + Math.cos(a + off) * 8), Math.round(u.y + Math.sin(a + off) * 8), 4, (x, y) => World.passable(x, y, u.owner));
      if (t) { Sim.setOrder(u, { type: 'flee', x: t[0], y: t[1], prev, since: Game.time }); return; }
    }
  },
  doFlee(u, o, dt) {
    if (Math.floor(u.x) === o.x && Math.floor(u.y) === o.y) { u.moving = false; u.path = null; return; }
    if (!u.path && !Sim.pathTo(u, o.x, o.y)) { Sim.setOrder(u, o.prev || null); return; }
    const s = Sim.step(u, dt);
    if (s === 'blocked') u.path = null;
  },

  tickUnit(u, dt) {
    if (u.dead) return;
    if (u.cd > 0) u.cd -= dt;
    if (u.swing > 0) u.swing -= dt;
    if (u.type === 'villager') Sim.checkFlee(u, dt);
    Sim.watchdog(u, dt);
    const o = u.order;
    if (!o) {
      u.moving = false; u.idleT += dt;
      // standing in someone's way: shuffle to a clear tile rather than be shunted along by them
      if (u.shoved) {
        u.shoved = 0; u.asideT = (u.asideT || 0) - dt;
        // a few shuffles is helpful; endlessly giving way in a busy crowd just looks like milling about
        if (u.asideT <= 0 && (u.asideN || 0) < 3) { u.asideT = 3; u.asideN = (u.asideN || 0) + 1; Sim.stepAside(u); }
      } else { u.calmT = (u.calmT || 0) + dt; if (u.calmT > 5) { u.calmT = 0; u.asideN = 0; } }
      if (u.def.cls !== 'villager' && !u.def.noAttack) Sim.scan(u, dt);
      return;
    }
    switch (o.type) {
      case 'move': Sim.doMove(u, o, dt); break;
      case 'attackmove': if (!u.def.noAttack) Sim.scan(u, dt); if (u.order === o) Sim.doMove(u, o, dt); break;
      case 'gather': Sim.doGather(u, o, dt); break;
      case 'build': Sim.doBuild(u, o, dt); break;
      case 'attack': Sim.doAttack(u, o, dt); break;
      case 'garrison': Sim.doGarrison(u, o, dt); break;
      case 'flee': Sim.doFlee(u, o, dt); break;
      case 'board': Sim.doBoard(u, o, dt); break;
      case 'unload': Sim.doUnload(u, o, dt); break;
    }
  },

  doMove(u, o, dt) {
    if (!u.path) { if (!Sim.pathTo(u, o.x, o.y)) { Sim.idle(u); return; } }
    const r = Sim.step(u, dt);
    const done = () => { if (o.then) Sim.setOrder(u, o.then); else Sim.idle(u); };
    if (r === 'arrived') { done(); return; }
    if (r === 'blocked') { Sim.idle(u); return; }
    // Somebody has settled on the tile we were sent to. Walking at it anyway is what makes a unit circle the
    // spot forever, so take the nearest free tile instead, and after a few tries just stop where we are.
    if (U.dist(u.x, u.y, o.x + 0.5, o.y + 0.5) < 2.5 && Sim.settledOn(o.x, o.y, u)) {
      o.reseat = (o.reseat || 0) + 1;
      const free = o.reseat <= 4 && U.nearestTile(o.x, o.y, 3, (x, y) => Sim.pass(u, x, y) && !Sim.occupied(x, y, u));
      if (free) { o.x = free[0]; o.y = free[1]; u.path = null; }
      else { u.path = null; done(); }
    }
  },

  /* Look for something hostile within sight. Military only. */
  scan(u, dt) {
    u.scanT -= dt; if (u.scanT > 0) return;
    u.scanT = 0.4;
    const t = Sim.nearestEnemy(u, u.def.sight + 1, true);
    if (t) { const prev = u.order; Sim.setOrder(u, { type: 'attack', target: t, resume: prev && prev.type === 'attackmove' ? prev : null }); }
  },
  nearestEnemy(u, radius, preferUnits) {
    let best = null, bd = Infinity;
    const r2 = radius * radius;
    for (const e of Game.units) {
      if (e.dead || e.owner === u.owner) continue;
      if (!u.def.naval && e.def.naval && !(u.range > 0)) continue; // a swordsman can't fight a ship
      const d = U.dist2(u.x, u.y, e.x, e.y); if (d < bd && d <= r2) { bd = d; best = e; }
    }
    if (best && preferUnits) return best;
    for (const b of Game.buildings) {
      if (b.dead || b.owner === u.owner) continue;
      const d = Sim.distTo(u, b); const dd = d * d + (preferUnits ? 100 : 0);
      if (dd < bd && d <= radius) { bd = dd; best = b; }
    }
    return best;
  },

  /* The nearest enemy structure within reach, walls included: what an attacker hits when its path is blocked. */
  blocker(u, radius) {
    const cx = Math.floor(u.x), cy = Math.floor(u.y), seen = new Set();
    let best = null, bd = Infinity;
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      const tx = cx + dx, ty = cy + dy;
      if (!World.inBounds(tx, ty)) continue;
      const b = World.bld[World.idx(tx, ty)];
      if (!b || b.dead || b.owner === u.owner || b.def.passable || seen.has(b.id)) continue;
      seen.add(b.id);
      const d = Sim.distTo(u, b); if (d <= radius && d < bd) { bd = d; best = b; }
    }
    return best;
  },
  doAttack(u, o, dt) {
    if (u.def.noAttack) { Sim.idle(u); return; }
    let t = o.target;
    if (t && t.dead && o.after && !o.after.dead) { o.target = t = o.after; o.after = null; u.path = null; u.stuck = 0; }
    if (!t || t.dead) { if (o.resume) Sim.setOrder(u, o.resume); else Sim.idle(u); return; }
    const range = u.range > 0 ? u.range + 0.5 : t.kind === 'building' ? REACH : 1.15;
    const d = Sim.distTo(u, t);
    if (d <= range) {
      u.path = null; u.moving = false;
      u.face = Math.atan2(t.y - u.y, t.x - u.x);
      if (u.cd <= 0) { u.cd = u.def.rate; u.swing = 0.3; Sim.strike(u, t); }
      return;
    }
    // chase: re-path periodically when the target moves
    o.repath = (o.repath || 0) - dt;
    if (!u.path || (t.kind === 'unit' && o.repath <= 0)) {
      o.repath = 0.7;
      const ok = t.kind === 'unit' ? Sim.pathTo(u, Math.floor(t.x), Math.floor(t.y)) : Sim.pathToEntity(u, t);
      if (!ok) { const w = Sim.blocker(u, 5); if (w && w !== t) { o.after = o.after || t; o.target = w; u.stuck = 0; return; } u.stuck += 1; if (u.stuck > 3) { Sim.idle(u); } return; }
    }
    const r = Sim.step(u, dt);
    if (r === 'arrived' && Sim.distTo(u, t) > range) {
      u.path = null; u.stuck++;
      // something is in the way: a wall, most likely. Break through it, then carry on.
      const w = Sim.blocker(u, 3.5); if (w && w !== t) { o.after = o.after || t; o.target = w; u.stuck = 0; return; }
      if (u.stuck > 4) Sim.idle(u);
    }
    if (r === 'blocked') u.path = null;
  },
  strike(u, t) {
    if (u.range > 0) {
      Game.effects.push({ kind: u.def.cls === 'siege' ? 'stone' : 'arrow', x0: u.x, y0: u.y, x1: t.x, y1: t.y, t: 0, dur: u.def.cls === 'siege' ? 0.8 : 0.35, dmgFrom: u, target: t });
    } else Sim.damage(t, u);
    Sfx.play(u.range > 0 ? 'shoot' : 'hit', u.x, u.y);
  },
  damageAmount(att, t) {
    let dmg = att.kind === 'building' ? (att.atkNow || att.def.attack || att.def.garrisonAttack).dmg + Game.players[att.owner].mods.towerAtk : att.atk;
    if (att.kind === 'unit' && att.def.bonus) { const cls = t.kind === 'building' ? 'building' : t.def.cls; if (att.def.bonus[cls]) dmg *= att.def.bonus[cls]; }
    const armor = t.kind === 'building' ? t.def.armor : t.armor;
    return Math.max(1, Math.round(dmg - armor));
  },
  damage(t, att) {
    if (!t || t.dead) return;
    const dmg = Sim.damageAmount(att, t);
    t.hp -= dmg; t.lastHit = Game.time; t.lastAttacker = att;
    const victim = Game.players[t.owner]; if (victim && att.owner != null && att.owner !== t.owner && Game.players[att.owner]) victim.grudge[att.owner] = Game.time;
    Game.onDamaged(t, att);
    if (att.kind === 'unit' && att.def.splash && t.kind === 'unit') {
      for (const e of Game.units) if (!e.dead && e !== t && e.owner !== att.owner && U.dist(e.x, e.y, t.x, t.y) <= att.def.splash) { e.hp -= Math.round(dmg * 0.5); if (e.hp <= 0) Sim.kill(e, att); }
    }
    if (t.hp <= 0) Sim.kill(t, att);
  },
  kill(t, att) {
    if (t.dead) return;
    t.dead = true;
    const owner = Game.players[t.owner], killer = att ? Game.players[att.owner] : null;
    if (t.kind === 'unit') {
      owner.stats.losses++; if (killer) killer.stats.kills++;
      Sim.setOrder(t, null); Sim.release(t);
      Game.effects.push({ kind: 'corpse', x: t.x, y: t.y, t: 0, dur: 6, color: owner.color.main, cls: t.def.cls });
      Sfx.play('die', t.x, t.y);
      // a sunk transport takes its passengers down with it
      if (t.cargo) { for (const c of t.cargo) { c.dead = true; c.inside = null; owner.stats.losses++; if (killer) killer.stats.kills++; } t.cargo = []; }
    } else {
      if (killer) killer.stats.razed++;
      while (t.garrison.length) Sim.ungarrison(t, t.garrison[0]);
      World.setBuilding(t, false);
      for (const q of t.queue) Sim.refundQueue(owner, q);
      t.queue = [];
      Game.effects.push({ kind: 'rubble', x: t.x, y: t.y, size: t.size, t: 0, dur: 25 });
      Sfx.play('collapse', t.x, t.y);
      // anyone working on or from this building stops
      for (const u of Game.units) if (!u.dead && u.order) { const o = u.order; if (o.bld === t || o.target === t || o.res === t || o.dropoff === t) { if (o.res === t) Sim.idle(u); else if (o.dropoff === t) { o.dropoff = null; } else Sim.idle(u); } }
    }
    Game.onKilled(t, att);
  },
  refundQueue(p, q) { if (q.kind === 'unit') p.refund(UNITS[q.id].cost); else if (q.kind === 'tech') p.refund(TECHS[q.id].cost); else if (q.kind === 'age') p.refund(AGES[p.age + 1].advance.cost); },

  /* ---- gathering ---- */
  doGather(u, o, dt) {
    const r = o.res;
    const kind = r ? RES_KIND[rk(r)] : u.carry.kind;
    if (o.phase === 'to') {
      if (!r || r.removed || r.amount <= 0 || (rk(r) === 'farm' && (r.dead || !r.built))) { Sim.retarget(u, o); return; }
      if (rk(r) === 'farm' && r.worker && r.worker !== u) { Sim.retarget(u, o); return; }
      const farm = rk(r) === 'farm';
      // the claimed tile can be built over or flooded by a new building: take another one
      if (!farm && (!o.spot || !Sim.pass(u, o.spot[0], o.spot[1]))) { const spot = Sim.freeSpot(u, r); if (!spot) { Sim.retarget(u, o); return; } o.spot = spot; Sim.claim(u, spot); u.path = null; }
      const there = () => (farm ? U.dist(u.x, u.y, r.x, r.y) <= 0.6 : Math.floor(u.x) === o.spot[0] && Math.floor(u.y) === o.spot[1]);
      const settle = () => { u.path = null; u.moving = false; o.phase = 'gathering'; if (!farm) { u.x = o.spot[0] + 0.5; u.y = o.spot[1] + 0.5; } u.face = Math.atan2((farm ? r.y : r.y + 0.5) - u.y, (farm ? r.x : r.x + 0.5) - u.x); };
      if (there()) { settle(); return; }
      if (!u.path) { const ok = farm ? Sim.pathTo(u, Math.floor(r.x), Math.floor(r.y)) : Sim.pathTo(u, o.spot[0], o.spot[1]); if (!ok) { Sim.retarget(u, o); return; } }
      const s = Sim.step(u, dt);
      if (there()) { settle(); return; }
      if (s === 'arrived') { u.path = null; u.stuck++; if (u.stuck > 2) Sim.retarget(u, o); }
      if (s === 'blocked') u.path = null;
    } else if (o.phase === 'gathering') {
      if (!r || r.removed || r.amount <= 0 || (rk(r) === 'farm' && (r.dead || !r.built))) { if (u.carry.amt > 0) o.phase = 'return'; else Sim.retarget(u, o); return; }
      const p = Game.players[u.owner];
      let rate = GATHER_RATE[rk(r)] * (1 + p.mods.gather[kind]);
      if (rk(r) === 'farm') rate *= 1 + p.mods.farmYield;
      u.anim += dt * 4; u.swing = 0.2;
      o.fxT = (o.fxT || 0) + dt;
      if (o.fxT > 0.78) { o.fxT = 0; const kind = rk(r); if (kind !== 'berry') Game.effects.push({ kind: 'chips', x: u.x + Math.cos(u.face) * 0.45, y: u.y + Math.sin(u.face) * 0.45, t: 0, dur: 0.55, seed: Math.random() * 9, color: { tree: '#d4b078', stone: '#c8ccd4', gold: '#f0d060', farm: '#9fc850', fish: '#e4f4ff' }[kind] || '#d4b078', splash: kind === 'fish' }); }
      const take = Math.min(rate * dt, u.carryCap - u.carry.amt, r.amount);
      if (u.carry.kind !== kind) { u.carry.kind = kind; u.carry.amt = 0; }
      u.carry.amt += take; r.amount -= take;
      if (r.amount <= 0 && rk(r) !== 'farm') { World.removeResource(r); }
      if (u.carry.amt >= u.carryCap - 0.001 || (r.amount <= 0)) { o.phase = 'return'; u.path = null; }
    } else if (o.phase === 'return') {
      const dOff = o.dropoff && !o.dropoff.dead && o.dropoff.built ? o.dropoff : (o.dropoff = Sim.nearestDropoff(u, u.carry.kind));
      if (!dOff) {
        // nowhere to take this load (carried over from another island, say): leave it and get on with the new job
        if (r && r.amount > 0 && RES_KIND[rk(r)] !== u.carry.kind) { u.carry.amt = 0; o.phase = 'to'; u.path = null; return; }
        Game.notify(u.owner, 'No drop-off point for ' + u.carry.kind + '.', 'warn', u.x, u.y); Sim.idle(u); return;
      }
      if (Sim.distTo(u, dOff) <= REACH) {
        const p = Game.players[u.owner]; p.res[u.carry.kind] += u.carry.amt; p.stats.gathered[u.carry.kind] += u.carry.amt; u.carry.amt = 0; u.path = null;
        if (r && r.amount > 0 && !(rk(r) === 'farm' && (r.dead || !r.built))) o.phase = 'to'; else Sim.retarget(u, o);
        return;
      }
      if (!u.path && !Sim.pathToEntity(u, dOff)) { Sim.idle(u); return; }
      const s = Sim.step(u, dt);
      if (Sim.distTo(u, dOff) <= REACH) return;            // arrival is banked on the next tick
      if (s === 'arrived') { u.path = null; u.stuck++; if (u.stuck > 3) Sim.idle(u); }
      if (s === 'blocked') u.path = null;
    }
  },
  /* The resource ran out: find another of the same kind nearby, or go idle. */
  retarget(u, o) {
    const old = o.res, kind = old ? rk(old) : null;
    const ox = old ? (rk(old) === 'farm' ? old.x : old.x + 0.5) : u.x, oy = old ? (rk(old) === 'farm' ? old.y : old.y + 0.5) : u.y;
    let next = null;
    if (kind === 'farm') next = Sim.freeFarm(u, 14);
    else if (kind) next = Sim.nearestFree(u, kind, ox, oy, 16, old);
    if (!next && !u.def.naval && (kind === 'berry' || kind === 'fish')) next = Sim.nearestFree(u, kind === 'berry' ? 'fish' : 'berry', ox, oy, 14, null) || Sim.freeFarm(u, 12);
    if (next) { const carry = u.carry.amt, dropoff = o.dropoff; if (Sim.assignGather(u, next, dropoff, 16) && carry >= u.carryCap - 0.001) u.order.phase = 'return'; }
    else { if (u.carry.amt > 0) { Sim.setOrder(u, { type: 'gather', res: null, dropoff: o.dropoff, phase: 'return' }); u.order.phase = 'return'; } else { Sim.idle(u); Game.onIdleVillager(u); } }
  },
  freeFarm(u, radius) {
    let best = null, bd = radius * radius;
    for (const b of Game.buildings) if (!b.dead && b.built && b.def.farm && b.owner === u.owner && (!b.worker || b.worker.dead || b.worker === u)) { const d = U.dist2(b.x, b.y, u.x, u.y); if (d < bd && World.regionAt(b.x, b.y) === World.regionAt(u.x, u.y)) { bd = d; best = b; } }
    return best;
  },
  nearestDropoff(u, kind) {
    let best = null, bd = Infinity;
    for (const b of Game.buildings) if (!b.dead && b.built && b.owner === u.owner && b.def.dropoff && b.def.dropoff.includes(kind) && (!u.def.naval || b.def.water) && Sim.canReach(u, b)) { const d = Sim.distTo(u, b); if (d < bd) { bd = d; best = b; } }
    return best;
  },
  /* Is there somewhere beside this building that the unit can get to? (Same island, or same sea.) */
  canReach(u, b) {
    const here = World.regionAt(u.x, u.y); if (!here) return true;
    for (let x = b.tx - 1; x <= b.tx + b.size; x++) for (let y = b.ty - 1; y <= b.ty + b.size; y++) {
      if (x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size) continue;
      if (Sim.pass(u, x, y) && World.regionAt(x, y) === here) return true;
    }
    return false;
  },

  /* ---- construction & repair ---- */
  doBuild(u, o, dt) {
    const b = o.bld;
    if (!b || b.dead) { Sim.idle(u); return; }
    if (b.built && b.hp >= b.maxHp) { Sim.afterBuild(u, b); return; }
    const near = b.def.passable ? U.dist(u.x, u.y, b.x, b.y) <= 1.4 : Sim.distTo(u, b) <= REACH;
    if (!near) {
      if (!u.path && !Sim.pathToEntity(u, b)) {
        u.stuck++;
        if (u.stuck > 2) {
          Sim.idle(u); Game.notify(u.owner, 'Cannot reach the building site.', 'warn', b.x, b.y);
          // a bot gives up on a foundation it has walled in, and gets its materials back
          const p = Game.players[b.owner]; if (p && p.isAI && !b.built && b.progress < 0.05) { for (const k in b.def.cost) p.res[k] += Math.round(b.def.cost[k] * (1 - b.progress)); Sim.kill(b, null); }
        }
        return;
      }
      const s = Sim.step(u, dt);
      if (s === 'arrived' && !(b.def.passable ? U.dist(u.x, u.y, b.x, b.y) <= 1.4 : Sim.distTo(u, b) <= REACH)) { u.path = null; u.stuck++; if (u.stuck > 3) Sim.idle(u); }
      if (s === 'blocked') u.path = null;
      return;
    }
    u.path = null; u.moving = false; u.face = Math.atan2(b.y - u.y, b.x - u.x); u.anim += dt * 5; u.swing = 0.2;
    o.fxT = (o.fxT || 0) + dt;
    if (o.fxT > 0.62) { o.fxT = 0; Game.effects.push({ kind: 'chips', x: u.x + Math.cos(u.face) * 0.5, y: u.y + Math.sin(u.face) * 0.5, t: 0, dur: 0.45, seed: Math.random() * 9, color: '#e8d8b0', spark: true }); }
    b.builders++;
    const n = Math.max(1, b.buildersLast);
    const share = (1 + 0.6 * (n - 1)) / n; // diminishing returns for crews
    if (!b.built) {
      b.progress = Math.min(1, b.progress + (dt / b.def.time) * share * (1 + Game.players[b.owner].mods.buildSpeed));
      b.hp = Math.max(1, Math.round(b.maxHp * b.progress));
      if (b.progress >= 1) Sim.completeBuilding(b);
    } else {
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp / b.def.time) * dt * share);
    }
  },
  completeBuilding(b) {
    b.built = true; b.hp = b.maxHp; b.progress = 1;
    const p = Game.players[b.owner];
    b.ageVisual = p.age;
    Game.onBuilt(b);
    Sfx.play('built', b.x, b.y);
  },
  /* Finished: a farm gets its farmer, a camp sends builders to the nearest matching resource. */
  afterBuild(u, b) {
    if (b.def.wall) { let best = null, bd = 64; for (const x of Game.buildings) { if (x.dead || x.built || x.owner !== u.owner) continue; const d = U.dist2(x.x, x.y, u.x, u.y); if (d < bd) { bd = d; best = x; } } if (best) { Sim.setOrder(u, { type: 'build', bld: best }); return; } }
    if (b.def.farm && (!b.worker || b.worker.dead || b.worker === u)) { Sim.setOrder(u, { type: 'gather', res: b }); return; }
    if (b.def.dropoff && b.type !== 'townhall') {
      for (const kind of ['tree', 'berry', 'fish', 'stone', 'gold']) {
        if (!b.def.dropoff.includes(RES_KIND[kind])) continue;
        const r = Sim.nearestFree(u, kind, b.x, b.y, 8, null);
        if (r && Sim.assignGather(u, r, b, 10)) return;
      }
    }
    Sim.idle(u); Game.onIdleVillager(u);
  },

  /* ---- buildings: training queues, towers, monuments ---- */
  tickBuilding(b, dt) {
    if (b.dead) return;
    b.buildersLast = b.builders; b.builders = 0;
    if (!b.built) return;
    const p = Game.players[b.owner];
    if (b.queue.length) {
      const q = b.queue[0];
      const total = q.kind === 'unit' ? p.trainTime(q.id) : q.kind === 'tech' ? TECHS[q.id].time / (1 + p.mods.researchSpeed) : AGES[p.age + 1].advance.time;
      b.qt += dt;
      if (b.qt >= total) {
        b.qt = 0; b.queue.shift();
        if (q.kind === 'unit') Sim.spawnUnit(b, q.id);
        else if (q.kind === 'tech') { p.applyTech(q.id); Game.onResearched(p, q.id); }
        else if (q.kind === 'age') { p.age++; for (const bb of p.buildings()) if (bb.built) bb.ageVisual = p.age; Game.onAgeUp(p); }
      }
    }
    const atk = b.def.attack || (b.garrison.length >= 3 && b.def.garrisonAttack) || null;
    if (atk) {
      if (b.cd > 0) b.cd -= dt;
      if (b.cd <= 0) {
        const range = atk.range + p.mods.towerRange;
        const arrows = b.def.attack ? 1 + Math.min(3, Math.floor(b.garrison.length / 2)) : Math.min(5, Math.floor(b.garrison.length / 3));
        const targets = Game.units.filter((e) => !e.dead && e.owner !== b.owner && U.dist(e.x, e.y, b.x, b.y) <= range + 0.5).sort((a, c) => U.dist2(a.x, a.y, b.x, b.y) - U.dist2(c.x, c.y, b.x, b.y));
        if (targets.length) {
          b.cd = atk.rate; b.atkNow = atk;
          for (let k = 0; k < arrows; k++) { const best = targets[k % targets.length]; Game.effects.push({ kind: 'arrow', x0: b.x + (k % 2) * 0.3 - 0.15, y0: b.y + Math.floor(k / 2) * 0.3 - 0.15, z0: b.size * 22 + 10, x1: best.x, y1: best.y, t: 0, dur: 0.4 + k * 0.05, dmgFrom: b, target: best }); }
          Sfx.play('shoot', b.x, b.y);
        }
      }
    }
    // villagers who took shelter on their own go back to work once the danger passes; the bell is the player's call
    if (b.garrison.some((u) => u.fled)) {
      const near = Sim.soldiers.some((e) => !e.dead && e.owner !== b.owner && U.dist2(e.x, e.y, b.x, b.y) < 196);
      b.calm = near ? 0 : (b.calm || 0) + dt;
      if (!b.bell && b.calm > Sim.FLEE_CALM) { for (const u of b.garrison.filter((x) => x.fled)) Sim.ungarrison(b, u); b.calm = 0; }
    } else b.calm = 0;
    if (b.def.monument) { b.monumentT += dt; if (b.monumentT >= Game.settings.monumentTime) Game.onMonumentWin(p); }
  },
  /* A free tile around a building's footprint, nearest to (rx, ry). */
  spotNear(b, rx, ry, owner, naval) {
    let best = null, bd = Infinity;
    const ok = (x, y) => (naval ? World.sailable(x, y) : World.passable(x, y, owner));
    for (let x = b.tx - 1; x <= b.tx + b.size; x++) for (let y = b.ty - 1; y <= b.ty + b.size; y++) {
      if (x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size) continue;
      if (!ok(x, y)) continue;
      const d = U.dist2(x + 0.5, y + 0.5, rx, ry); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) best = U.nearestTile(b.x, b.y, 8, ok);
    return best;
  },
  /* ---- transports ----
     Land units walk to the shore beside a transport and step aboard; the transport sails to water beside the
     land it was sent to and puts everyone ashore there. */
  room(ship) { return ship.def.capacity - ship.cargo.length - Game.units.filter((v) => !v.dead && v.order && v.order.type === 'board' && v.order.ship === ship).length; },
  doBoard(u, o, dt) {
    const ship = o.ship;
    if (!ship || ship.dead || ship.owner !== u.owner || ship.cargo.length >= ship.def.capacity) { Sim.idle(u); return; }
    if (U.dist(u.x, u.y, ship.x, ship.y) <= 1.75) { Sim.embark(u, ship); return; }
    o.repath = (o.repath || 0) - dt;
    if (!u.path || o.repath <= 0) {
      o.repath = 1;
      const here = World.regionAt(u.x, u.y), sx = Math.floor(ship.x), sy = Math.floor(ship.y);
      const t = U.nearestTile(sx, sy, 3, (x, y) => World.passable(x, y, u.owner) && World.regionAt(x, y) === here);
      if (!t || !Sim.pathTo(u, t[0], t[1])) { u.stuck++; if (u.stuck > 4) Sim.idle(u); return; }
    }
    const s = Sim.step(u, dt);
    if (s === 'arrived' && U.dist(u.x, u.y, ship.x, ship.y) > 1.75) { u.path = null; u.stuck++; if (u.stuck > 6) Sim.idle(u); }
    if (s === 'blocked') u.path = null;
  },
  embark(u, ship) {
    Sim.setOrder(u, null);
    const i = Game.units.indexOf(u); if (i >= 0) Game.units.splice(i, 1);
    const si = Game.selection.indexOf(u); if (si >= 0) { Game.selection.splice(si, 1); UI.selDirty = UI.cmdDirty = true; }
    u.inside = ship; u.path = null; u.moving = false; ship.cargo.push(u);
    if (Game.selection.includes(ship)) UI.selDirty = UI.cmdDirty = true;
  },
  doUnload(ship, o, dt) {
    if (!ship.cargo.length) { Sim.setOrder(ship, o.then || null); return; }
    const region = o.region || World.regionAt(o.x, o.y);
    // already lying against that shore: put them off here
    for (const [dx, dy] of U.DIRS) { const x = Math.floor(ship.x) + dx, y = Math.floor(ship.y) + dy; if (World.passable(x, y, ship.owner) && (!region || World.regionAt(x, y) === region)) { Sim.disembark(ship, o); return; } }
    if (!o.landing) { o.landing = World.landingNear(o.x, o.y, region, 16); if (!o.landing) { Game.notify(ship.owner, 'Nowhere to land there.', 'warn', ship.x, ship.y); Sim.idle(ship); return; } }
    if (!ship.path && !Sim.pathTo(ship, o.landing[0], o.landing[1])) { ship.stuck++; if (ship.stuck > 3) { Game.notify(ship.owner, 'The transport can\u2019t sail there.', 'warn', ship.x, ship.y); Sim.idle(ship); } return; }
    const s = Sim.step(ship, dt);
    if (s === 'arrived') ship.path = null;
    if (s === 'blocked') ship.path = null;
  },
  disembark(ship, o) {
    const region = o && (o.region || World.regionAt(o.x, o.y)), taken = new Set(), sx = Math.floor(ship.x), sy = Math.floor(ship.y), landed = [];
    for (const u of ship.cargo.slice()) {
      const t = U.nearestTile(sx, sy, 5, (x, y) => World.passable(x, y, u.owner) && (!region || World.regionAt(x, y) === region) && !taken.has(x + ',' + y));
      if (!t) break;
      taken.add(t[0] + ',' + t[1]);
      ship.cargo.splice(ship.cargo.indexOf(u), 1); u.inside = null; u.x = t[0] + 0.5; u.y = t[1] + 0.5; Game.units.push(u); landed.push(u);
      if (o && o.after) Sim.setOrder(u, Object.assign({}, o.after));
    }
    ship.path = null; ship.moving = false;
    if (Game.selection.includes(ship)) UI.selDirty = UI.cmdDirty = true;
    if (!ship.cargo.length) Sim.setOrder(ship, (o && o.then) || null);
    return landed;
  },
  /* ---- garrison ---- */
  canGarrison(u, b) { return !!(b && !b.dead && b.built && b.def.garrison && b.owner === u.owner && u.def.cls !== 'cavalry' && u.def.cls !== 'siege' && !u.def.naval); },
  garrison(u, b) {
    if (!Sim.canGarrison(u, b) || b.garrison.length >= b.def.garrison) return false;
    const o = u.order, keep = o && o.type === 'garrison' ? o.prev : null, fled = !!(o && o.type === 'garrison' && o.flee);
    Sim.setOrder(u, null); u.prevOrder = keep || null; u.fled = fled;
    const i = Game.units.indexOf(u); if (i >= 0) Game.units.splice(i, 1);
    const si = Game.selection.indexOf(u); if (si >= 0) { Game.selection.splice(si, 1); UI.selDirty = UI.cmdDirty = true; }
    u.inside = b; u.path = null; u.moving = false; b.garrison.push(u);
    if (Game.selection.includes(b)) UI.selDirty = UI.cmdDirty = true;
    return true;
  },
  ungarrison(b, u) {
    const i = b.garrison.indexOf(u); if (i < 0) return;
    b.garrison.splice(i, 1); u.inside = null; u.fled = false;
    const spot = Sim.spotNear(b, b.x, b.y + b.size, u.owner) || [b.tx, b.ty + b.size];
    u.x = spot[0] + 0.5; u.y = spot[1] + 0.5; Game.units.push(u);
    // back to what they were doing, if it still exists
    const o = u.prevOrder; u.prevOrder = null;
    if (o && o.type === 'gather' && o.res && !o.res.removed && !o.res.dead && (o.res.amount > 0)) Sim.assignGather(u, o.res, o.dropoff, 14);
    else if (o && o.type === 'build' && o.bld && !o.bld.dead) Sim.setOrder(u, { type: 'build', bld: o.bld });
    if (Game.selection.includes(b)) UI.selDirty = UI.cmdDirty = true;
  },
  ungarrisonAll(b) { while (b.garrison.length) Sim.ungarrison(b, b.garrison[b.garrison.length - 1]); },
  /* The town bell: every villager within earshot runs for the nearest shelter; ring again to send them back. */
  ringBell(b) {
    const p = Game.players[b.owner];
    if (!b.bell) {
      b.bell = true;
      const shelters = p.buildings().filter((x) => x.built && x.def.garrison);
      for (const u of p.units('villager')) {
        if (U.dist(u.x, u.y, b.x, b.y) > 26) continue;
        let best = null, bd = Infinity; for (const sh of shelters) { const room = sh.def.garrison - sh.garrison.length - Game.units.filter((v) => v.order && v.order.type === 'garrison' && v.order.bld === sh).length; if (room <= 0) continue; const d = U.dist2(u.x, u.y, sh.x, sh.y); if (d < bd) { bd = d; best = sh; } }
        if (best) { const prev = u.order; Sim.setOrder(u, { type: 'garrison', bld: best, prev: prev && (prev.type === 'gather' || prev.type === 'build') ? prev : null }); }
      }
      Game.notify(b.owner, 'The bell rings. Villagers run for shelter.', 'warn', b.x, b.y);
    } else {
      b.bell = false;
      for (const sh of p.buildings()) if (sh.def.garrison) { const vill = sh.garrison.filter((u) => u.type === 'villager'); for (const u of vill) Sim.ungarrison(sh, u); }
      for (const u of p.units('villager')) if (u.order && u.order.type === 'garrison') { const prev = u.order.prev; Sim.setOrder(u, prev || null); }
      Game.notify(b.owner, 'All clear. Villagers return to work.', 'good', b.x, b.y);
    }
  },
  doGarrison(u, o, dt) {
    const b = o.bld;
    if (!Sim.canGarrison(u, b) || b.garrison.length >= b.def.garrison) { Sim.setOrder(u, o.prev || null); return; }
    if (Sim.distTo(u, b) <= REACH) { Sim.garrison(u, b); return; }
    if (!u.path && !Sim.pathToEntity(u, b)) { u.stuck++; if (u.stuck > 2) Sim.setOrder(u, o.prev || null); return; }
    const s = Sim.step(u, dt);
    if (s === 'arrived' && Sim.distTo(u, b) > REACH) { u.path = null; u.stuck++; if (u.stuck > 3) Sim.setOrder(u, o.prev || null); }
    if (s === 'blocked') u.path = null;
  },
  spawnUnit(b, type) {
    const p = Game.players[b.owner];
    // spawn on a free tile around the footprint, biased towards the rally point
    const rx = b.rally ? b.rally.x : b.x, ry = b.rally ? b.rally.y + 1 : b.y + b.size / 2 + 1;
    const best = Sim.spotNear(b, rx, ry, b.owner, !!UNITS[type].naval); if (!best) return;
    const u = Ent.unit(type, b.owner, best[0] + 0.5, best[1] + 0.5);
    Game.units.push(u); p.stats.trained++;
    if (b.rally) {
      const r = b.rally;
      if (r.res && !r.res.removed && r.res.amount > 0 && (type === 'villager' || (u.def.gather && u.def.gather.includes(r.res.kind)))) Sim.assignGather(u, r.res, null, 14);
      else if (r.bld && !r.bld.dead && type === 'villager') { if (r.bld.def.farm && r.bld.built) Sim.setOrder(u, { type: 'gather', res: r.bld }); else Sim.setOrder(u, { type: 'build', bld: r.bld }); }
      else Sim.setOrder(u, { type: type === 'villager' || u.def.noAttack ? 'move' : 'attackmove', x: Math.floor(r.x), y: Math.floor(r.y) });
    }
    Game.onSpawned(u, b);
  },

  /* Queue a unit / tech / age-up at a building. Returns null or a reason string. */
  enqueue(b, item) {
    const p = Game.players[b.owner];
    if (!b.built) return 'Not finished';
    if (b.queue.length >= 8) return 'Queue is full';
    if (item.kind === 'unit') {
      const d = UNITS[item.id];
      if (!p.mayTrain(item.id)) return 'Only the ' + FACTIONS[d.faction].name + ' train these';
      if (d.age > p.age) return 'Requires the ' + AGES[d.age].name;
      if (p.pop() + 1 > p.popCap()) return 'Need more houses';
      if (!p.canAfford(d.cost)) return 'Not enough ' + p.missing(d.cost).join(', ');
      p.pay(d.cost);
    } else if (item.kind === 'tech') {
      const t = TECHS[item.id];
      if (p.techs.has(item.id)) return 'Already researched';
      if (t.age > p.age) return 'Requires the ' + AGES[t.age].name;
      if (t.requires && !p.techs.has(t.requires)) return 'Requires ' + TECHS[t.requires].name;
      for (const bb of p.buildings()) if (bb.queue.some((q) => q.kind === 'tech' && q.id === item.id)) return 'Already being researched';
      if (!p.canAfford(t.cost)) return 'Not enough ' + p.missing(t.cost).join(', ');
      p.pay(t.cost);
    } else if (item.kind === 'age') {
      const why = p.ageUpBlocker(); if (why) return why;
      p.pay(AGES[p.age + 1].advance.cost);
    }
    b.queue.push(item);
    return null;
  },
  dequeue(b, i) {
    const q = b.queue[i]; if (!q) return;
    Sim.refundQueue(Game.players[b.owner], q);
    b.queue.splice(i, 1); if (i === 0) b.qt = 0;
  },
};
