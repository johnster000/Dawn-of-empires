/* Save games: one autosave slot in localStorage, plus text export/import for carrying a match between browsers.
   Everything is stored by id; the map itself is rebuilt from its seed and then overwritten with the saved state. */
const Save = {
  KEY: 'doe-save', VERSION: 1,
  exists() { try { return !!localStorage.getItem(this.KEY); } catch (e) { return false; } },
  read() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  write(d) { try { localStorage.setItem(this.KEY, JSON.stringify(d)); return true; } catch (e) { return false; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  meta(d) { if (!d || !d.players) return null; const you = d.players[0]; return { age: AGES[you.age].name, time: U.time(d.time), rivals: d.players.length - 1, terrain: TERRAINS[d.settings.terrain].name, at: d.savedAt }; },

  /* ---- writing ---- */
  refRes(r) { return !r ? null : r.kind === 'building' ? { b: r.id } : { r: r.id }; },
  ref(e) { return !e ? null : e.kind === 'unit' ? { u: e.id } : { b: e.id }; },
  order(o) {
    if (!o) return null;
    const d = { type: o.type };
    if (o.phase) d.phase = o.phase; if (o.x != null) { d.x = o.x; d.y = o.y; }
    if (o.res !== undefined) d.res = this.refRes(o.res); if (o.bld) d.bld = o.bld.id; if (o.target) d.target = this.ref(o.target); if (o.dropoff) d.dropoff = o.dropoff.id;
    if (o.resume) d.resume = this.order(o.resume); if (o.after) d.after = this.ref(o.after); if (o.prev) d.prev = this.order(o.prev); if (o.then) d.then = this.order(o.then);
    return d;
  },
  unit(u) { return { id: u.id, type: u.type, owner: u.owner, x: +u.x.toFixed(3), y: +u.y.toFixed(3), hp: Math.round(u.hp * 10) / 10, face: +u.face.toFixed(2), cd: +u.cd.toFixed(2), anim: +u.anim.toFixed(2), carry: u.carry.amt > 0 ? { kind: u.carry.kind, amt: +u.carry.amt.toFixed(2) } : null, order: this.order(u.order), prev: this.order(u.prevOrder) }; },
  building(b) { return { id: b.id, type: b.type, owner: b.owner, tx: b.tx, ty: b.ty, hp: Math.round(b.hp), built: b.built, progress: +b.progress.toFixed(4), queue: b.queue, qt: +b.qt.toFixed(2), rally: b.rally ? { x: b.rally.x, y: b.rally.y, res: this.refRes(b.rally.res), bld: b.rally.bld ? b.rally.bld.id : null } : null, cd: +b.cd.toFixed(2), worker: b.worker && !b.worker.dead ? b.worker.id : null, monumentT: Math.round(b.monumentT), ageVisual: b.ageVisual, bell: !!b.bell, garrison: b.garrison.map((u) => this.unit(u)) }; },
  rle(arr) { const out = []; let v = 0, n = 0; for (let i = 0; i < arr.length; i++) { if (arr[i] === v) n++; else { out.push(n); v = arr[i]; n = 1; } } out.push(n); return out; },
  unrle(runs, len) { const a = new Uint8Array(len); let i = 0, v = 0; for (const n of runs) { if (v) a.fill(1, i, i + n); i += n; v ^= 1; } return a; },
  serialize() {
    return {
      v: this.VERSION, savedAt: Date.now(), settings: Object.assign({}, Game.settings, { forceSeed: Game.seed }), time: Game.time, nextId: Ent.nextId,
      cam: { x: Renderer.cam.x, y: Renderer.cam.y, zoom: Renderer.cam.zoom }, alertT: Game.alertT,
      players: Game.players.map((p) => ({ res: Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v * 10) / 10])), age: p.age, techs: [...p.techs], stats: p.stats, alive: p.alive,
        ai: p.ai ? { lastAttack: p.ai.lastAttack === -Infinity ? null : p.ai.lastAttack, attacking: p.ai.attacking, attackTarget: p.ai.attackTarget ? p.ai.attackTarget.id : null, attackStart: p.ai.attackStart, lastHouse: p.ai.lastHouse, threatT: p.ai.threatT } : null })),
      world: { nextResId: World.nextResId, res: World.res.map((r) => [r.id, r.kind, r.x, r.y, Math.round(r.amount * 10) / 10, +r.v.toFixed(4), +r.ox.toFixed(3), +r.oy.toFixed(3)]), decals: World.decals, explored: this.rle(World.explored) },
      units: Game.units.filter((u) => !u.dead).map((u) => this.unit(u)),
      buildings: Game.buildings.filter((b) => !b.dead).map((b) => this.building(b)),
    };
  },

  /* ---- reading ---- */
  restore(d) {
    if (!d || d.v !== this.VERSION || !Array.isArray(d.units) || !Array.isArray(d.buildings) || !d.world) throw new Error('That is not a Dawn of Empires save.');
    Game.newGame(d.settings);
    // wipe the freshly generated start and rebuild from the save
    Game.units = []; Game.buildings = []; Game.selection = []; Game.effects = []; World.bld.fill(null); World.resAt.fill(null);
    World.res = []; World.nextResId = d.world.nextResId; World.decals = d.world.decals || [];
    for (const [id, kind, x, y, amount, v, ox, oy] of d.world.res) { const amounts = { tree: 100, stone: 350, gold: 350, berry: 125, fish: 250 }; const r = { id, kind, x, y, amount, max: amounts[kind] || amount, v, ox, oy, workers: 0 }; World.res.push(r); World.resAt[World.idx(x, y)] = r; }
    const resById = new Map(World.res.map((r) => [r.id, r]));
    d.players.forEach((pd, i) => { const p = Game.players[i]; if (!p) return; Object.assign(p.res, pd.res); p.age = pd.age; p.stats = pd.stats; p.alive = pd.alive; for (const t of pd.techs) p.applyTech(t);
      if (p.ai && pd.ai) { Object.assign(p.ai, { lastAttack: pd.ai.lastAttack == null ? -Infinity : pd.ai.lastAttack, attacking: pd.ai.attacking, attackStart: pd.ai.attackStart, lastHouse: pd.ai.lastHouse, threatT: pd.ai.threatT }); p.ai._target = pd.ai.attackTarget; } });
    const bById = new Map(), uById = new Map(), pending = [];
    for (const bd of d.buildings) {
      const b = Ent.building(bd.type, bd.owner, bd.tx, bd.ty, bd.built);
      Object.assign(b, { id: bd.id, hp: bd.hp, progress: bd.progress, queue: bd.queue || [], qt: bd.qt, cd: bd.cd, monumentT: bd.monumentT || 0, ageVisual: bd.ageVisual, bell: !!bd.bell });
      World.setBuilding(b, true); Game.buildings.push(b); bById.set(b.id, b);
      for (const ud of bd.garrison || []) { const u = this.makeUnit(ud); u.inside = b; b.garrison.push(u); uById.set(u.id, u); pending.push([u, ud]); }
      pending.push([b, bd]);
    }
    for (const ud of d.units) { const u = this.makeUnit(ud); Game.units.push(u); uById.set(u.id, u); pending.push([u, ud]); }
    const res = (ref) => (!ref ? null : ref.r != null ? resById.get(ref.r) || null : bById.get(ref.b) || null);
    const ent = (ref) => (!ref ? null : ref.u != null ? uById.get(ref.u) || null : bById.get(ref.b) || null);
    const order = (od) => { if (!od) return null; const o = { type: od.type }; if (od.phase) o.phase = od.phase; if (od.x != null) { o.x = od.x; o.y = od.y; } if (od.res !== undefined) o.res = res(od.res); if (od.bld) o.bld = bById.get(od.bld) || null; if (od.target) o.target = ent(od.target); if (od.dropoff) o.dropoff = bById.get(od.dropoff) || null; if (od.resume) o.resume = order(od.resume); if (od.after) o.after = ent(od.after); if (od.prev) o.prev = order(od.prev); if (od.then) o.then = order(od.then); return o; };
    for (const [e, ed] of pending) {
      if (e.kind === 'unit') {
        e.order = order(ed.order); e.prevOrder = order(ed.prev);
        if (e.order && (e.order.type === 'attack' || e.order.type === 'build' || e.order.type === 'garrison') && !(e.order.target || e.order.bld)) e.order = null;
        if (e.order && e.order.type === 'gather' && e.order.res) { if (rk(e.order.res) === 'farm') e.order.res.worker = e; else e.order.res.workers = (e.order.res.workers || 0) + 1; }
        else if (e.order && e.order.type === 'gather' && !e.carry.amt) e.order = null;
      } else {
        if (ed.rally) e.rally = { x: ed.rally.x, y: ed.rally.y, res: res(ed.rally.res), bld: ed.rally.bld ? bById.get(ed.rally.bld) || null : null };
        if (ed.worker) e.worker = uById.get(ed.worker) || null;
      }
    }
    for (const p of Game.players) if (p.ai) { p.ai.attackTarget = p.ai._target != null ? bById.get(p.ai._target) || null : null; delete p.ai._target; }
    Ent.nextId = Math.max(d.nextId, ...[...uById.keys(), ...bById.keys()].map((x) => x + 1), 1);
    Game.time = d.time; Game.alertT = d.alertT == null ? -99 : d.alertT;
    if (d.world.explored) World.explored = this.unrle(d.world.explored, World.w * World.h);
    World.updateFog(Game.human, Game.settings.reveal); Renderer.fogDirty = true;
    if (d.cam) { Renderer.cam.zoom = Renderer.zq(d.cam.zoom); Renderer.centerOn(d.cam.x, d.cam.y); }
    UI.iconCache.clear(); UI.selDirty = UI.cmdDirty = true;
    Game.select([]);
    for (const p of Game.players) if (!p.alive) for (const u of Game.units) if (u.owner === p.id) u.dead = true;
  },
  makeUnit(ud) {
    const u = Ent.unit(ud.type, ud.owner, ud.x, ud.y);
    u.id = ud.id; u.face = ud.face || 0; u.cd = ud.cd || 0; u.anim = ud.anim || 0;
    if (ud.carry) u.carry = { kind: ud.carry.kind, amt: ud.carry.amt };
    Sim.refreshUnit(u); u.hp = Math.min(u.maxHp, ud.hp);
    return u;
  },

  /* ---- text export / import ---- */
  exportText() { return JSON.stringify(this.serialize()); },
  importText(text) {
    let d; try { d = JSON.parse(String(text).trim()); } catch (e) { return { error: 'That is not a Dawn of Empires save.' }; }
    if (!d || d.v !== this.VERSION || !Array.isArray(d.units) || !d.world) return { error: 'That is not a Dawn of Empires save.' };
    try { this.restore(d); } catch (e) { return { error: 'Could not load that save: ' + e.message }; }
    this.write(d);
    return { ok: true, meta: this.meta(d) };
  },
};
