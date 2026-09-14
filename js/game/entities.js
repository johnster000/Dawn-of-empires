/* Players, units and buildings, plus the per-tick simulation of what they do. */

const GATHER_RATE = { berry: 0.5, tree: 0.55, stone: 0.45, gold: 0.45, farm: 0.48 };
const RES_KIND = { berry: 'food', tree: 'wood', stone: 'stone', gold: 'gold', farm: 'food' };
const BASE_CARRY = 10;
/* Resource kind of a gather target: natural resources carry their own kind; a farm is a building. */
const rk = (r) => (r && r.kind === 'building' ? 'farm' : r ? r.kind : null);

class Player {
  constructor(id, opts) {
    this.id = id; this.name = opts.name; this.color = opts.color; this.isAI = !!opts.isAI; this.difficulty = opts.difficulty || 'normal';
    this.res = Object.assign({ food: 200, wood: 200, stone: 100, gold: 100 }, opts.res || {});
    this.age = opts.age || 0; this.techs = new Set(); this.alive = true;
    this.mods = { atk: {}, armor: {}, range: {}, gather: { food: 0, wood: 0, stone: 0, gold: 0 }, farmYield: 0, villagerSpeed: 0, carry: 0, villagerHp: 0, villagerArmor: 0, towerAtk: 0, towerRange: 0, trainSpeed: 0 };
    this.stats = { gathered: { food: 0, wood: 0, stone: 0, gold: 0 }, kills: 0, losses: 0, razed: 0, trained: 0 };
    this.ai = null;
  }
  canAfford(cost) { for (const k in cost) if ((this.res[k] || 0) < cost[k]) return false; return true; }
  missing(cost) { const m = []; for (const k in cost) if ((this.res[k] || 0) < cost[k]) m.push(k); return m; }
  pay(cost) { for (const k in cost) this.res[k] -= cost[k]; }
  refund(cost) { for (const k in cost) this.res[k] += cost[k]; }
  popCap() { let c = 0; for (const b of Game.buildings) if (!b.dead && b.built && b.owner === this.id) c += b.def.pop || 0; return Math.min(c, Game.settings.popCap); }
  pop() { let n = 0; for (const u of Game.units) if (!u.dead && u.owner === this.id) n++; for (const b of Game.buildings) if (!b.dead && b.owner === this.id) for (const q of b.queue) if (q.kind === 'unit') n++; return n; }
  hasTech(id) { return this.techs.has(id); }
  applyTech(id) {
    const t = TECHS[id]; if (!t || this.techs.has(id)) return;
    this.techs.add(id);
    const e = t.effect, m = this.mods;
    for (const k in e) {
      if (typeof e[k] === 'number') m[k] = (m[k] || 0) + e[k];
      else for (const c in e[k]) m[k][c] = (m[k][c] || 0) + e[k][c];
    }
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
    const u = { id: Ent.nextId++, kind: 'unit', type, def, owner, x, y, hp: def.hp, maxHp: def.hp, dead: false,
      order: null, path: null, carry: { kind: null, amt: 0 }, cd: 0, face: 0.8, anim: 0, moving: false, scanT: Math.random() * 0.4, idleT: 0, swing: 0, stuck: 0 };
    Sim.refreshUnit(u);
    return u;
  },
  building(type, owner, tx, ty, built) {
    const def = BUILDINGS[type];
    const b = { id: Ent.nextId++, kind: 'building', type, def, owner, tx, ty, size: def.size, x: tx + def.size / 2, y: ty + def.size / 2,
      hp: built ? def.hp : 1, maxHp: def.hp, dead: false, built: !!built, progress: built ? 1 : 0, builders: 0, buildersLast: 0,
      queue: [], qt: 0, rally: null, cd: 0, worker: null, amount: def.farm ? Infinity : 0, kindRes: def.farm ? 'farm' : null, monumentT: 0, ageVisual: 0 };
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
    u.carryCap = BASE_CARRY + m.carry;
  },
  effectiveRange(u) { return u.range > 0 ? u.range : 0; },

  /* ---- orders ---- */
  setOrder(u, order) {
    if (u.order && u.order.type === 'gather' && u.order.res && rk(u.order.res) === 'farm') { if (u.order.res.worker === u) u.order.res.worker = null; }
    if (u.order && u.order.type === 'gather' && u.order.res && u.order.res.workers != null) u.order.res.workers = Math.max(0, u.order.res.workers - 1);
    u.order = order; u.path = null; u.idleT = 0; u.stuck = 0;
    if (order && order.type === 'gather' && order.res) {
      if (rk(order.res) === 'farm') order.res.worker = u; else order.res.workers = (order.res.workers || 0) + 1;
      order.phase = u.carry.amt > 0 && u.carry.kind !== RES_KIND[order.res.kind] ? 'return' : 'to';
    }
  },
  idle(u) { Sim.setOrder(u, null); },

  /* Path to a spot adjacent to a footprint (or onto it, if flat). Returns true if a path was set. */
  pathToEntity(u, e) {
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    const foot = Sim.footprint(e);
    let goal = null, bd = Infinity;
    if (e.def && e.def.passable) { goal = [Math.floor(e.x), Math.floor(e.y)]; }
    else {
      for (let x = foot.x0 - 1; x <= foot.x1 + 1; x++) for (let y = foot.y0 - 1; y <= foot.y1 + 1; y++) {
        if (x >= foot.x0 && x <= foot.x1 && y >= foot.y0 && y <= foot.y1) continue;
        if (!World.passable(x, y)) continue;
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
    if (!World.passable(gx, gy)) { const n = U.nearestTile(gx, gy, 6, (x, y) => World.passable(x, y)); if (!n) return false; gx = n[0]; gy = n[1]; }
    const path = U.astar(sx, sy, gx, gy, World.w, World.h, (x, y) => World.passable(x, y), 5000);
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
    const [tx, ty] = u.path[0];
    if (!World.passable(tx, ty)) {
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

  tickUnit(u, dt) {
    if (u.dead) return;
    if (u.cd > 0) u.cd -= dt;
    if (u.swing > 0) u.swing -= dt;
    const o = u.order;
    if (!o) {
      u.moving = false; u.idleT += dt;
      if (u.def.cls !== 'villager') Sim.scan(u, dt);
      return;
    }
    switch (o.type) {
      case 'move': Sim.doMove(u, o, dt); break;
      case 'attackmove': Sim.scan(u, dt); if (u.order === o) Sim.doMove(u, o, dt); break;
      case 'gather': Sim.doGather(u, o, dt); break;
      case 'build': Sim.doBuild(u, o, dt); break;
      case 'attack': Sim.doAttack(u, o, dt); break;
    }
  },

  doMove(u, o, dt) {
    if (!u.path) { if (!Sim.pathTo(u, o.x, o.y)) { Sim.idle(u); return; } }
    const r = Sim.step(u, dt);
    if (r === 'arrived') { if (o.then) { const t = o.then; Sim.setOrder(u, t); } else Sim.idle(u); }
    else if (r === 'blocked') Sim.idle(u);
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

  doAttack(u, o, dt) {
    const t = o.target;
    if (!t || t.dead) { if (o.resume) Sim.setOrder(u, o.resume); else Sim.idle(u); return; }
    const range = u.range > 0 ? u.range + 0.5 : 1.15;
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
      if (!ok) { u.stuck += 1; if (u.stuck > 3) { Sim.idle(u); } return; }
    }
    const r = Sim.step(u, dt);
    if (r === 'arrived' && Sim.distTo(u, t) > range) { u.path = null; u.stuck++; if (u.stuck > 4) Sim.idle(u); }
    if (r === 'blocked') u.path = null;
  },
  strike(u, t) {
    if (u.range > 0) {
      Game.effects.push({ kind: u.def.cls === 'siege' ? 'stone' : 'arrow', x0: u.x, y0: u.y, x1: t.x, y1: t.y, t: 0, dur: u.def.cls === 'siege' ? 0.8 : 0.35, dmgFrom: u, target: t });
    } else Sim.damage(t, u);
    Sfx.play(u.range > 0 ? 'shoot' : 'hit', u.x, u.y);
  },
  damageAmount(att, t) {
    let dmg = att.kind === 'building' ? att.def.attack.dmg + Game.players[att.owner].mods.towerAtk : att.atk;
    if (att.kind === 'unit' && att.def.bonus) { const cls = t.kind === 'building' ? 'building' : t.def.cls; if (att.def.bonus[cls]) dmg *= att.def.bonus[cls]; }
    const armor = t.kind === 'building' ? t.def.armor : t.armor;
    return Math.max(1, Math.round(dmg - armor));
  },
  damage(t, att) {
    if (!t || t.dead) return;
    const dmg = Sim.damageAmount(att, t);
    t.hp -= dmg; t.lastHit = Game.time; t.lastAttacker = att;
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
      Sim.setOrder(t, null);
      Game.effects.push({ kind: 'corpse', x: t.x, y: t.y, t: 0, dur: 6, color: owner.color.main, cls: t.def.cls });
      Sfx.play('die', t.x, t.y);
    } else {
      if (killer) killer.stats.razed++;
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
      if (!r || r.amount <= 0 || (rk(r) === 'farm' && (r.dead || !r.built))) { Sim.retarget(u, o); return; }
      if (rk(r) === 'farm' && r.worker && r.worker !== u) { Sim.retarget(u, o); return; }
      const near = rk(r) === 'farm' ? U.dist(u.x, u.y, r.x, r.y) <= 0.6 : Sim.distToRes(u, r) <= 1.0;
      if (near) { u.path = null; u.moving = false; o.phase = 'gathering'; u.face = Math.atan2((rk(r) === 'farm' ? r.y : r.y + 0.5) - u.y, (rk(r) === 'farm' ? r.x : r.x + 0.5) - u.x); return; }
      if (!u.path) { const ok = rk(r) === 'farm' ? Sim.pathTo(u, Math.floor(r.x), Math.floor(r.y)) : Sim.pathTo(u, r.x, r.y); if (!ok) { Sim.retarget(u, o); return; } }
      const s = Sim.step(u, dt);
      if (s === 'arrived' && !(rk(r) === 'farm' ? U.dist(u.x, u.y, r.x, r.y) <= 0.6 : Sim.distToRes(u, r) <= 1.0)) { u.path = null; u.stuck++; if (u.stuck > 3) Sim.retarget(u, o); }
      if (s === 'blocked') u.path = null;
    } else if (o.phase === 'gathering') {
      if (!r || r.amount <= 0 || (rk(r) === 'farm' && (r.dead || !r.built))) { if (u.carry.amt > 0) o.phase = 'return'; else Sim.retarget(u, o); return; }
      const p = Game.players[u.owner];
      let rate = GATHER_RATE[rk(r)] * (1 + p.mods.gather[kind]);
      if (rk(r) === 'farm') rate *= 1 + p.mods.farmYield;
      u.anim += dt * 4; u.swing = 0.2;
      const take = Math.min(rate * dt, u.carryCap - u.carry.amt, r.amount);
      if (u.carry.kind !== kind) { u.carry.kind = kind; u.carry.amt = 0; }
      u.carry.amt += take; r.amount -= take;
      if (r.amount <= 0 && rk(r) !== 'farm') { World.removeResource(r); }
      if (u.carry.amt >= u.carryCap - 0.001 || (r.amount <= 0)) { o.phase = 'return'; u.path = null; }
    } else if (o.phase === 'return') {
      const dOff = o.dropoff && !o.dropoff.dead && o.dropoff.built ? o.dropoff : (o.dropoff = Sim.nearestDropoff(u, u.carry.kind));
      if (!dOff) { Game.notify(u.owner, 'No drop-off point for ' + u.carry.kind + '.', 'warn', u.x, u.y); Sim.idle(u); return; }
      if (Sim.distTo(u, dOff) <= 1.0) {
        const p = Game.players[u.owner]; p.res[u.carry.kind] += u.carry.amt; p.stats.gathered[u.carry.kind] += u.carry.amt; u.carry.amt = 0; u.path = null;
        if (r && r.amount > 0 && !(rk(r) === 'farm' && (r.dead || !r.built))) o.phase = 'to'; else Sim.retarget(u, o);
        return;
      }
      if (!u.path && !Sim.pathToEntity(u, dOff)) { Sim.idle(u); return; }
      const s = Sim.step(u, dt);
      if (s === 'arrived' && Sim.distTo(u, dOff) > 1.0) { u.path = null; u.stuck++; if (u.stuck > 3) Sim.idle(u); }
      if (s === 'blocked') u.path = null;
    }
  },
  /* The resource ran out: find another of the same kind nearby, or go idle. */
  retarget(u, o) {
    const old = o.res, kind = old ? rk(old) : null;
    const ox = old ? (rk(old) === 'farm' ? old.x : old.x + 0.5) : u.x, oy = old ? (rk(old) === 'farm' ? old.y : old.y + 0.5) : u.y;
    let next = null;
    if (kind === 'farm') next = Sim.freeFarm(u, 14);
    else if (kind) next = World.nearestResource(kind, ox, oy, 10, (rr) => rr !== old && (rr.workers || 0) < (kind === 'tree' ? 2 : 4)) || World.nearestResource(kind, ox, oy, 14, (rr) => rr !== old);
    if (!next && kind === 'berry') next = Sim.freeFarm(u, 12);
    if (next) { const carry = u.carry.amt; Sim.setOrder(u, { type: 'gather', res: next, dropoff: o.dropoff }); if (carry >= u.carryCap - 0.001) u.order.phase = 'return'; }
    else { if (u.carry.amt > 0) { Sim.setOrder(u, { type: 'gather', res: null, dropoff: o.dropoff, phase: 'return' }); u.order.phase = 'return'; } else { Sim.idle(u); Game.onIdleVillager(u); } }
  },
  freeFarm(u, radius) {
    let best = null, bd = radius * radius;
    for (const b of Game.buildings) if (!b.dead && b.built && b.def.farm && b.owner === u.owner && (!b.worker || b.worker.dead || b.worker === u)) { const d = U.dist2(b.x, b.y, u.x, u.y); if (d < bd) { bd = d; best = b; } }
    return best;
  },
  nearestDropoff(u, kind) {
    let best = null, bd = Infinity;
    for (const b of Game.buildings) if (!b.dead && b.built && b.owner === u.owner && b.def.dropoff && b.def.dropoff.includes(kind)) { const d = Sim.distTo(u, b); if (d < bd) { bd = d; best = b; } }
    return best;
  },

  /* ---- construction & repair ---- */
  doBuild(u, o, dt) {
    const b = o.bld;
    if (!b || b.dead) { Sim.idle(u); return; }
    if (b.built && b.hp >= b.maxHp) { Sim.afterBuild(u, b); return; }
    const near = b.def.passable ? U.dist(u.x, u.y, b.x, b.y) <= 1.2 : Sim.distTo(u, b) <= 1.0;
    if (!near) {
      if (!u.path && !Sim.pathToEntity(u, b)) { u.stuck++; if (u.stuck > 2) { Sim.idle(u); Game.notify(u.owner, 'Cannot reach the building site.', 'warn', b.x, b.y); } return; }
      const s = Sim.step(u, dt);
      if (s === 'arrived' && !(b.def.passable ? U.dist(u.x, u.y, b.x, b.y) <= 1.2 : Sim.distTo(u, b) <= 1.0)) { u.path = null; u.stuck++; if (u.stuck > 3) Sim.idle(u); }
      if (s === 'blocked') u.path = null;
      return;
    }
    u.path = null; u.moving = false; u.face = Math.atan2(b.y - u.y, b.x - u.x); u.anim += dt * 5; u.swing = 0.2;
    b.builders++;
    const n = Math.max(1, b.buildersLast);
    const share = (1 + 0.6 * (n - 1)) / n; // diminishing returns for crews
    if (!b.built) {
      b.progress = Math.min(1, b.progress + (dt / b.def.time) * share);
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
    if (b.def.farm && (!b.worker || b.worker.dead || b.worker === u)) { Sim.setOrder(u, { type: 'gather', res: b }); return; }
    if (b.def.dropoff && b.type !== 'townhall') {
      for (const kind of ['tree', 'berry', 'stone', 'gold']) {
        if (!b.def.dropoff.includes(RES_KIND[kind])) continue;
        const r = World.nearestResource(kind, b.x, b.y, 7);
        if (r) { Sim.setOrder(u, { type: 'gather', res: r, dropoff: b }); return; }
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
      let total = q.kind === 'unit' ? UNITS[q.id].time : q.kind === 'tech' ? TECHS[q.id].time : AGES[p.age + 1].advance.time;
      if (q.kind === 'unit' && UNITS[q.id].cls !== 'villager') total /= 1 + p.mods.trainSpeed;
      b.qt += dt;
      if (b.qt >= total) {
        b.qt = 0; b.queue.shift();
        if (q.kind === 'unit') Sim.spawnUnit(b, q.id);
        else if (q.kind === 'tech') { p.applyTech(q.id); Game.onResearched(p, q.id); }
        else if (q.kind === 'age') { p.age++; for (const bb of p.buildings()) if (bb.built) bb.ageVisual = p.age; Game.onAgeUp(p); }
      }
    }
    if (b.def.attack) {
      if (b.cd > 0) b.cd -= dt;
      if (b.cd <= 0) {
        const range = b.def.attack.range + p.mods.towerRange;
        let best = null, bd = Infinity;
        for (const e of Game.units) { if (e.dead || e.owner === b.owner) continue; const d = U.dist(e.x, e.y, b.x, b.y); if (d <= range + 0.5 && d < bd) { bd = d; best = e; } }
        if (best) { b.cd = b.def.attack.rate; Game.effects.push({ kind: 'arrow', x0: b.x, y0: b.y, z0: b.size * 22 + 10, x1: best.x, y1: best.y, t: 0, dur: 0.4, dmgFrom: b, target: best }); Sfx.play('shoot', b.x, b.y); }
      }
    }
    if (b.def.monument) { b.monumentT += dt; if (b.monumentT >= Game.settings.monumentTime) Game.onMonumentWin(p); }
  },
  spawnUnit(b, type) {
    const p = Game.players[b.owner];
    // spawn on a free tile around the footprint, biased towards the rally point
    const rx = b.rally ? b.rally.x : b.x, ry = b.rally ? b.rally.y + 1 : b.y + b.size / 2 + 1;
    let best = null, bd = Infinity;
    for (let x = b.tx - 1; x <= b.tx + b.size; x++) for (let y = b.ty - 1; y <= b.ty + b.size; y++) {
      if (x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size) continue;
      if (!World.passable(x, y)) continue;
      const d = U.dist2(x + 0.5, y + 0.5, rx, ry); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) { const n = U.nearestTile(b.x, b.y, 6, (x, y) => World.passable(x, y)); if (!n) return; best = n; }
    const u = Ent.unit(type, b.owner, best[0] + 0.5, best[1] + 0.5);
    Game.units.push(u); p.stats.trained++;
    if (b.rally) {
      const r = b.rally;
      if (r.res && !r.res.removed && r.res.amount > 0 && type === 'villager') Sim.setOrder(u, { type: 'gather', res: r.res });
      else if (r.bld && !r.bld.dead && type === 'villager') { if (r.bld.def.farm && r.bld.built) Sim.setOrder(u, { type: 'gather', res: r.bld }); else Sim.setOrder(u, { type: 'build', bld: r.bld }); }
      else Sim.setOrder(u, { type: type === 'villager' ? 'move' : 'attackmove', x: Math.floor(r.x), y: Math.floor(r.y) });
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
