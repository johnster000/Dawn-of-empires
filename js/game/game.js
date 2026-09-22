/* Game controller: settings, setup, the main loop, selection and commands, victory. */
const STEP = 1 / 20;
const Game = {
  defaults: { mapSize: 'medium', terrain: 'meadow', enemies: 1, difficulty: 'normal', resources: 'normal', startAge: 0, popCap: 100, reveal: false, speed: 1, color: 'blue', seedText: '', monumentTime: 300 },
  settings: null, players: [], human: 0, units: [], buildings: [], effects: [], selection: [], groups: {},
  running: false, paused: false, over: false, time: 0, acc: 0, lastTs: 0, seed: 0,
  placing: null, buildMenu: false, wallStart: null, mode: null, hover: null, lastEvent: null, debug: false, fogT: 0, winT: 0, alertT: -99, idleIdx: 0,

  init() {
    for (const k in TERRAINS) TERRAINS[k].id = k;
    Renderer.init(document.getElementById('game'), document.getElementById('minimap'));
    Input.init(document.getElementById('game'));
    UI.init();
    this.lastTs = performance.now();
    requestAnimationFrame((ts) => this.frame(ts));
  },

  newGame(settings) {
    this.settings = Object.assign({}, this.defaults, settings);
    const s = this.settings;
    this.seed = s.forceSeed != null ? s.forceSeed : s.seedText ? RNG.seedFrom(s.seedText) : (Math.random() * 4294967295) >>> 0;
    delete s.forceSeed;
    s.seed = this.seed;
    this.units = []; this.buildings = []; this.effects = []; this.selection = []; this.groups = {}; this.players = []; Sim.claims.clear();
    this.time = 0; this.acc = 0; this.saveT = 0; this.over = false; this.paused = false; this.placing = null; this.mode = null; this.buildMenu = false; this.idleIdx = 0; this.alertT = -99;
    Ent.nextId = 1; UI.iconCache.clear(); UI.log.forEach((m) => m.el.remove()); UI.log = []; UI.lastRes = {};
    const startRes = { low: { food: 100, wood: 100, stone: 50, gold: 50 }, normal: { food: 200, wood: 200, stone: 100, gold: 100 }, high: { food: 600, wood: 600, stone: 300, gold: 300 }, huge: { food: 2000, wood: 2000, stone: 1000, gold: 1000 } }[s.resources];
    const n = 1 + U.clamp(s.enemies, 1, 5);
    const colors = PLAYER_COLORS.slice(); const humanColor = colors.find((c) => c.id === s.color) || colors[0]; colors.splice(colors.indexOf(humanColor), 1);
    const names = ['Ashvale', 'Corrin', 'Dunmere', 'Eldwick', 'Fenmoor', 'Garrow'];
    const rng = RNG.make(this.seed ^ 0x9e3779b9);
    rng.shuffle(colors); rng.shuffle(names);
    this.players.push(new Player(0, { name: 'You', color: humanColor, isAI: false, res: { ...startRes }, age: s.startAge }));
    for (let i = 1; i < n; i++) this.players.push(new Player(i, { name: names[i - 1], color: colors[i - 1], isAI: true, difficulty: s.difficulty, res: { ...startRes }, age: s.startAge }));
    this.human = 0;
    World.generate({ mapSize: s.mapSize, terrain: s.terrain, seed: this.seed, players: n, reveal: s.reveal });
    Renderer.prepareMap();
    // Town hall and three villagers for everyone
    for (let i = 0; i < n; i++) {
      const st = World.starts[i], p = this.players[i];
      const tx = st.x - 1, ty = st.y - 1;
      for (let x = tx - 1; x <= tx + 3; x++) for (let y = ty - 1; y <= ty + 3; y++) { const r = World.inBounds(x, y) ? World.resAt[World.idx(x, y)] : null; if (r) World.removeResource(r); if (World.inBounds(x, y)) World.tiles[World.idx(x, y)] = 0; }
      const th = Ent.building('townhall', i, tx, ty, true); World.setBuilding(th, true); this.buildings.push(th);
      const spots = [[tx - 1, ty + 3], [tx + 1, ty + 3], [tx + 3, ty + 1]];
      for (const [x, y] of spots) { const t = U.nearestTile(x, y, 4, (a, b) => World.passable(a, b)); if (t) this.units.push(Ent.unit('villager', i, t[0] + 0.5, t[1] + 0.5)); }
      if (p.isAI) AI.create(p);
      if (s.startAge > 0) { for (const b of p.buildings()) b.ageVisual = s.startAge; }
    }
    World.markShores(); Renderer.prepareMap();
    Renderer.cam.zoom = 1; Renderer.centerOn(World.starts[0].x + 0.5, World.starts[0].y + 1.5);
    World.updateFog(this.human, s.reveal);
    this.running = true;
    UI.showScreen(null); UI.syncSpeed(); UI.selDirty = UI.cmdDirty = true;
    this.select([this.players[0].buildings('townhall')[0]]);
    UI.message(`${AGES[s.startAge].name}. ${n - 1} rival${n > 2 ? 's' : ''} somewhere in the ${TERRAINS[s.terrain].name.toLowerCase()}. Build, grow, endure.`, 'info');
    Sfx.init();
  },
  quit() { if (this.running && !this.over) this.save(true); this.running = false; this.paused = false; this.selection = []; UI.showScreen('title'); UI.syncContinue(); },
  save(quiet) { if (!this.running || this.over) return false; const ok = Save.write(Save.serialize()); if (!quiet) UI.toast(ok ? 'Game saved' : 'Could not save (storage blocked)'); this.saveT = 0; return ok; },

  /* ---- loop ---- */
  frame(ts) {
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000); this.lastTs = ts;
    if (this.running) {
      if (!this.paused) {
        Input.poll(dt);
        this.acc += dt * this.settings.speed;
        let guard = 0;
        while (this.acc >= STEP && guard++ < 12) { this.tick(STEP); this.acc -= STEP; }
        if (guard >= 12) this.acc = 0;
      }
      Renderer.draw(this.paused ? 0 : dt);
      UI.update(dt);
    }
    requestAnimationFrame((t) => this.frame(t));
  },
  tick(dt) {
    this.time += dt;
    Sim.refreshLists(dt);
    for (const u of this.units) Sim.tickUnit(u, dt);
    Sim.separate();
    for (const b of this.buildings) Sim.tickBuilding(b, dt);
    // effects: projectiles land, decals fade
    for (const e of this.effects) {
      e.t += dt;
      if ((e.kind === 'arrow' || e.kind === 'stone') && e.t >= e.dur && !e.done) { e.done = true; if (e.target && !e.target.dead && e.dmgFrom && !e.dmgFrom.dead) { Sim.damage(e.target, e.dmgFrom); this.effects.push({ kind: 'hit', x: e.target.x, y: e.target.y, t: 0, dur: 0.25, seed: Math.random() * 6 }); } }
    }
    this.effects = this.effects.filter((e) => e.t < e.dur);
    if (this.units.some((u) => u.dead)) { this.units = this.units.filter((u) => !u.dead); this.selection = this.selection.filter((s) => !s.dead); UI.selDirty = UI.cmdDirty = true; }
    if (this.buildings.some((b) => b.dead)) { this.buildings = this.buildings.filter((b) => !b.dead); this.selection = this.selection.filter((s) => !s.dead); UI.selDirty = UI.cmdDirty = true; }
    for (const p of this.players) if (p.isAI && p.alive) AI.tick(p, dt);
    this.fogT -= dt; if (this.fogT <= 0) { this.fogT = 0.3; World.updateFog(this.human, this.settings.reveal); Renderer.fogDirty = true; }
    this.winT -= dt; if (this.winT <= 0) { this.winT = 1; this.checkVictory(); }
    this.saveT = (this.saveT || 0) + dt; if (this.saveT >= 60 && !this.over) this.save(true);
  },

  /* ---- selection ---- */
  select(list) {
    this.selection = list.filter((s) => !s.dead); this.buildMenu = false; this.mode = null;
    if (this.placing) this.cancelPlacing();
    UI.selDirty = UI.cmdDirty = true; UI.hideTip();
    if (list.length) Sfx.play('select');
  },
  clickSelect(sx, sy, shift, ctrl) {
    const u = Renderer.pickUnit(sx, sy, (x) => x.owner === this.human) || Renderer.pickUnit(sx, sy);
    const b = u ? null : Renderer.pickBuilding(sx, sy);
    const hit = u || b;
    const now = performance.now();
    const dbl = hit && this.lastClick && this.lastClick.e === hit && now - this.lastClick.t < 350;
    this.lastClick = { e: hit, t: now };
    if (!hit) { if (!shift) this.select([]); return; }
    if ((ctrl || dbl) && hit.kind === 'unit' && hit.owner === this.human) { this.select(this.units.filter((x) => x.owner === this.human && x.type === hit.type && x.sx != null && x.sx >= 0 && x.sx <= Renderer.W && x.sy >= 0 && x.sy <= Renderer.H)); return; }
    if (shift && hit.owner === this.human && hit.kind === 'unit' && this.selection.every((s) => s.kind === 'unit')) { const i = this.selection.indexOf(hit); const list = this.selection.slice(); if (i >= 0) list.splice(i, 1); else list.push(hit); this.select(list); return; }
    this.select([hit]);
  },
  boxSelect(box, shift) {
    if (!box) return;
    const inBox = (u) => u.sx != null && u.sx >= box.x0 && u.sx <= box.x1 && u.sy - u.sh / 2 >= box.y0 && u.sy - u.sh / 2 <= box.y1;
    let list = this.units.filter((u) => !u.dead && u.owner === this.human && inBox(u));
    if (list.some((u) => u.type !== 'villager')) list = list.filter((u) => u.type !== 'villager'); // soldiers first
    if (shift) list = U.once(this.selection.filter((s) => s.kind === 'unit').concat(list));
    if (!list.length) { if (!shift) this.select([]); return; }
    this.select(list);
  },
  focus(e) { Renderer.centerOn(e.x, e.y); },
  selectArmy() {
    const army = this.players[this.human].units().filter((u) => u.type !== 'villager');
    if (!army.length) { UI.toast('No soldiers'); return; }
    this.select(army); this.focus(army[0]);
  },
  nextIdleVillager() {
    const idle = this.players[this.human].units('villager').filter((u) => !u.order);
    if (!idle.length) { UI.toast('No idle villagers'); return; }
    this.idleIdx = (this.idleIdx + 1) % idle.length; const u = idle[this.idleIdx];
    this.select([u]); this.focus(u);
  },
  deleteSelected() {
    const own = this.selection.filter((s) => s.owner === this.human);
    if (!own.length) return;
    for (const s of own) {
      if (s.kind === 'building' && !s.built) { const p = this.players[s.owner]; for (const k in s.def.cost) p.res[k] += Math.round(s.def.cost[k] * (1 - s.progress)); }
      Sim.kill(s, null);
    }
    UI.toast(own.length === 1 ? own[0].def.name + ' removed' : own.length + ' removed');
    this.select([]);
  },

  /* ---- commands ---- */
  commandAt(sx, sy, queue, mode) {
    const enemyUnit = Renderer.pickUnit(sx, sy, (x) => x.owner !== this.human);
    const anyUnit = enemyUnit || Renderer.pickUnit(sx, sy);
    const b = Renderer.pickBuilding(sx, sy), r = b ? null : Renderer.pickResource(sx, sy);
    const [wx, wy] = Renderer.toWorld(sx, sy);
    this.command({ unit: anyUnit, bld: b, res: r, x: wx, y: wy }, queue, mode);
  },
  commandWorld(wx, wy, queue) {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    const b = World.inBounds(tx, ty) ? World.bld[World.idx(tx, ty)] : null, r = World.inBounds(tx, ty) ? World.resAt[World.idx(tx, ty)] : null;
    this.command({ unit: null, bld: b, res: r, x: wx, y: wy }, queue, null);
  },
  command(t, queue, mode) {
    const units = this.selection.filter((s) => s.kind === 'unit' && s.owner === this.human && !s.dead);
    const blds = this.selection.filter((s) => s.kind === 'building' && s.owner === this.human && !s.dead);
    if (!units.length && blds.length) {
      // rally point
      for (const b of blds) if (b.def.trains) b.rally = { x: t.x, y: t.y, res: t.res || null, bld: t.bld && t.bld.owner === this.human && t.bld !== b ? t.bld : null };
      Sfx.play('ack'); UI.toast('Rally point set'); UI.cmdDirty = true; return;
    }
    if (!units.length) return;
    if (!World.inBounds(Math.floor(t.x), Math.floor(t.y))) return;
    const tx = Math.floor(t.x), ty = Math.floor(t.y);
    const vill = units.filter((u) => u.type === 'villager'), mil = units.filter((u) => u.type !== 'villager');
    const target = t.unit && t.unit.owner !== this.human ? t.unit : t.bld && t.bld.owner !== this.human ? t.bld : null;
    if (mode === 'repair' && !(t.bld && t.bld.owner === this.human)) { UI.toast('Pick one of your buildings to repair'); return; }
    if (mode === 'attackmove') { this.spread(mil, tx, ty, 'attackmove'); this.spread(vill, tx, ty, 'move'); this.ping(t.x, t.y, '#d8484a'); Sfx.play('ack'); return; }
    if (mode === 'move' || (t.unit && t.unit.owner === this.human && !target)) { this.spread(units, tx, ty, 'move'); this.ping(t.x, t.y); Sfx.play('ack'); return; }
    if (target) { for (const u of units) Sim.setOrder(u, { type: 'attack', target }); this.ping(target.x, target.y, '#d8484a'); Sfx.play('ack'); return; }
    if (t.bld && t.bld.owner === this.human) {
      const b = t.bld;
      if (mode === 'repair') { if (vill.length && b.built) { for (const u of vill) Sim.setOrder(u, { type: 'build', bld: b }); Sfx.play('ack'); this.ping(b.x, b.y); } else UI.toast('Nothing to repair there'); return; }
      if (vill.length && !b.built) { for (const u of vill) Sim.setOrder(u, { type: 'build', bld: b }); this.spread(mil, tx, ty, 'move'); Sfx.play('ack'); this.ping(b.x, b.y); return; }
      if (b.built && b.def.garrison) {
        const takers = units.filter((u) => Sim.canGarrison(u, b));
        if (takers.length) {
          const room = b.def.garrison - b.garrison.length;
          if (room <= 0) { UI.toast(b.def.name + ' is full'); Sfx.play('error'); return; }
          takers.slice(0, room).forEach((u) => Sim.setOrder(u, { type: 'garrison', bld: b, prev: u.order && (u.order.type === 'gather' || u.order.type === 'build') ? u.order : null }));
          if (takers.length > room) UI.toast(`Room for ${room} inside`);
          this.spread(units.filter((u) => !takers.slice(0, room).includes(u)), tx, ty, 'move'); Sfx.play('ack'); this.ping(b.x, b.y); return;
        }
      }
      if (vill.length && b.built && b.hp < b.maxHp) { for (const u of vill) Sim.setOrder(u, { type: 'build', bld: b }); this.spread(mil, tx, ty, 'move'); Sfx.play('ack'); this.ping(b.x, b.y); return; }
      if (vill.length && b.def.farm && b.built) { const free = !b.worker || b.worker.dead; if (free) { Sim.setOrder(vill[0], { type: 'gather', res: b }); for (const u of vill.slice(1)) { const f = Sim.freeFarm(u, 10); if (f && f !== b) Sim.setOrder(u, { type: 'gather', res: f }); else Sim.setOrder(u, { type: 'move', x: tx, y: ty }); } } else UI.toast('That farm already has a farmer'); this.spread(mil, tx, ty, 'move'); Sfx.play('ack'); return; }
      if (vill.length && b.def.dropoff && vill.some((u) => u.carry.amt > 0)) { for (const u of vill) if (u.carry.amt > 0) Sim.setOrder(u, { type: 'gather', res: u.order && u.order.res || null, dropoff: b, phase: 'return' }); this.spread(mil, tx, ty, 'move'); Sfx.play('ack'); return; }
      this.spread(units, tx, ty, 'move'); Sfx.play('ack'); this.ping(t.x, t.y); return;
    }
    if (t.res && vill.length) {
      // each one claims its own place to stand; when this resource is full they spill onto the nearest of its kind
      let sent = 0;
      for (const u of vill.slice().sort((a, b) => U.dist2(a.x, a.y, t.res.x, t.res.y) - U.dist2(b.x, b.y, t.res.x, t.res.y))) if (Sim.assignGather(u, t.res, null, 14)) sent++;
      if (!sent) { UI.toast('No room to work there'); Sfx.play('error'); return; }
      if (sent < vill.length) UI.toast(`${sent} of ${vill.length} could reach it`);
      this.spread(mil, tx, ty, 'move'); Sfx.play('ack'); this.ping(t.res.x + 0.5, t.res.y + 0.5); return;
    }
    this.spread(units, tx, ty, 'move'); this.ping(t.x, t.y); Sfx.play('ack');
  },
  /* Give each unit its own destination tile around the target. */
  spread(units, tx, ty, type) {
    if (!units.length) return;
    const taken = new Set(); const tiles = [];
    const r = Math.ceil(Math.sqrt(units.length)) + 2;
    for (let d = 0; d <= r && tiles.length < units.length; d++) for (let x = tx - d; x <= tx + d && tiles.length < units.length; x++) for (let y = ty - d; y <= ty + d; y++) { if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== d) continue; const key = x + ',' + y; if (taken.has(key) || !World.passable(x, y, this.human)) continue; taken.add(key); tiles.push([x, y]); if (tiles.length >= units.length) break; }
    if (!tiles.length) { UI.toast("Can't go there"); Sfx.play('error'); return; }
    const sorted = units.slice().sort((a, b) => U.dist2(a.x, a.y, tx, ty) - U.dist2(b.x, b.y, tx, ty));
    sorted.forEach((u, i) => { const t = tiles[Math.min(i, tiles.length - 1)]; Sim.setOrder(u, { type, x: t[0], y: t[1] }); });
  },
  ping(x, y, color) { this.effects.push({ kind: 'ping', x, y, t: 0, dur: 0.6, color: color || '#e8c46a' }); },
  train(blds, item) {
    // send the order to the least busy of the selected buildings
    const b = blds.slice().sort((a, c) => a.queue.length - c.queue.length)[0];
    const why = Sim.enqueue(b, item);
    if (why) { UI.toast(why); Sfx.play('error'); } else { Sfx.play('coin'); UI.selDirty = true; }
  },

  /* ---- placement ---- */
  startPlacing(type) {
    const def = BUILDINGS[type], p = this.players[this.human];
    if (def.age > p.age) { UI.toast('Requires the ' + AGES[def.age].name); return; }
    this.placing = { type, def, tx: -99, ty: -99, ok: false, wall: !!(def.wall && !def.gate), line: null }; Renderer.ghost = this.placing; this.mode = null; this.wallStart = null;
    this.updateGhost(Input.mouse.x, Input.mouse.y); UI.cmdDirty = true;
  },
  /* Can this go here? Gates may replace one of your own plain wall pieces. */
  siteOk(def, tx, ty) {
    let ok = World.canPlace(def, tx, ty);
    if (!ok && def.gate && World.inBounds(tx, ty)) { const b = World.bld[World.idx(tx, ty)]; if (b && !b.dead && b.owner === this.human && b.def.wall && !b.def.gate && World.tiles[World.idx(tx, ty)] !== 1 && !World.resAt[World.idx(tx, ty)]) ok = true; }
    if (ok && !this.settings.reveal) for (let x = tx; x < tx + def.size; x++) for (let y = ty; y < ty + def.size; y++) if (!World.explored[World.idx(x, y)]) ok = false;
    return ok;
  },
  updateGhost(sx, sy) {
    const g = this.placing; if (!g) return;
    const [wx, wy] = Renderer.toWorld(sx, sy);
    g.tx = Math.round(wx - g.def.size / 2); g.ty = Math.round(wy - g.def.size / 2);
    g.ok = this.siteOk(g.def, g.tx, g.ty);
    if (g.wall && this.wallStart) g.line = this.wallLine(this.wallStart[0], this.wallStart[1], g.tx, g.ty).map(([x, y]) => [x, y, this.siteOk(g.def, x, y)]);
    else g.line = null;
  },
  /* Tiles along a straight run between two tiles (Bresenham). */
  wallLine(x0, y0, x1, y1) {
    const out = []; let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, x = x0, y = y0, guard = 0;
    for (;;) { out.push([x, y]); if ((x === x1 && y === y1) || guard++ > 400) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
    return out;
  },
  beginWall(sx, sy) { this.updateGhost(sx, sy); const g = this.placing; if (!g || !g.wall) return; this.wallStart = [g.tx, g.ty]; this.updateGhost(sx, sy); UI.hint('Drag to the other end, then release'); },
  placeWall(sx, sy) {
    const g = this.placing, p = this.players[this.human]; if (!g || !g.wall || !this.wallStart) return;
    this.updateGhost(sx, sy);
    const vill = this.selection.filter((s) => s.kind === 'unit' && s.type === 'villager' && !s.dead);
    const placed = [];
    for (const [x, y, ok] of g.line || []) { if (!ok) continue; if (!p.canAfford(g.def.cost)) { UI.toast('Out of ' + p.missing(g.def.cost).join(', ')); break; } const b = this.placeBuilding(p, g.type, x, y); if (b) placed.push(b); }
    this.wallStart = null; g.line = null;
    if (!placed.length) { UI.toast('Cannot build there'); Sfx.play('error'); return; }
    // builders split along the run and chain from piece to piece
    vill.forEach((u, i) => Sim.setOrder(u, { type: 'build', bld: placed[Math.floor((i / vill.length) * placed.length)] }));
    Sfx.play('ack'); UI.hint('Click and drag for another run · Right-click or Esc to finish'); UI.cmdDirty = true;
  },
  placeAt(sx, sy, keep) {
    this.updateGhost(sx, sy);
    const g = this.placing, p = this.players[this.human];
    if (!g) return;
    if (!g.ok) { UI.toast('Cannot build there'); Sfx.play('error'); return; }
    if (!p.canAfford(g.def.cost)) { UI.toast('Not enough ' + p.missing(g.def.cost).join(', ')); Sfx.play('error'); return; }
    const b = this.placeBuilding(p, g.type, g.tx, g.ty);
    if (!b) return;
    const vill = this.selection.filter((s) => s.kind === 'unit' && s.type === 'villager' && !s.dead);
    for (const u of vill) Sim.setOrder(u, { type: 'build', bld: b });
    Sfx.play('ack');
    if (!keep || !p.canAfford(g.def.cost) || g.def.monument || g.def.ageUp) this.cancelPlacing(); else { UI.cmdDirty = true; }
  },
  placeBuilding(p, type, tx, ty) {
    const def = BUILDINGS[type];
    if (def.gate && World.inBounds(tx, ty)) { const old = World.bld[World.idx(tx, ty)]; if (old && !old.dead && old.owner === p.id && old.def.wall && !old.def.gate) { old.dead = true; World.setBuilding(old, false); this.buildings = this.buildings.filter((b) => b !== old); if (old.built) p.refund(old.def.cost); } }
    if (!World.canPlace(def, tx, ty, true) || !p.canAfford(def.cost)) return null;
    p.pay(def.cost);
    const b = Ent.building(type, p.id, tx, ty, false); World.setBuilding(b, true); this.buildings.push(b);
    // units standing on the site step off it
    if (!def.passable) for (const u of this.units) if (!u.dead && u.x >= tx && u.x < tx + def.size && u.y >= ty && u.y < ty + def.size) { const t = U.nearestTile(u.x, u.y, 4, (x, y) => World.passable(x, y)); if (t) { u.x = t[0] + 0.5; u.y = t[1] + 0.5; } }
    return b;
  },
  cancelPlacing() { this.placing = null; this.wallStart = null; Renderer.ghost = null; UI.hint(null); UI.cmdDirty = true; },
  updateHover(sx, sy) {
    if (!this.running) return;
    const u = Renderer.pickUnit(sx, sy), b = u ? null : Renderer.pickBuilding(sx, sy), r = u || b ? null : Renderer.pickResource(sx, sy);
    const haveUnits = this.selection.some((s) => s.kind === 'unit' && s.owner === this.human);
    const cv = Renderer.canvas;
    let cur = 'default';
    if (this.placing) cur = 'copy'; else if (this.mode) cur = 'crosshair';
    else if ((u && u.owner !== this.human) || (b && b.owner !== this.human)) cur = haveUnits ? 'crosshair' : 'pointer';
    else if (u || b) cur = 'pointer'; else if (r && haveUnits) cur = 'cell';
    if (cv.style.cursor !== cur) cv.style.cursor = cur;
    const name = u ? `${u.def.name} · ${this.players[u.owner].name}` : b ? `${b.def.name} · ${this.players[b.owner].name}` : r ? `${{ tree: 'Trees', berry: 'Berry bush', stone: 'Stone', gold: 'Gold', fish: 'Fish' }[r.kind]} · ${Math.ceil(r.amount)}` : '';
    const el = document.getElementById('hover'); if (el.textContent !== name) el.textContent = name; el.hidden = !name;
  },

  /* ---- events from the simulation ---- */
  notify(playerId, text, kind, x, y) {
    if (playerId !== this.human) return;
    UI.message(text, kind, x, y);
    if (x != null) this.lastEvent = { x, y };
  },
  onDamaged(t, att) {
    if (t.owner === this.human && att.owner !== this.human && this.time - this.alertT > 10) {
      this.alertT = this.time; Sfx.play('alert');
      UI.message(`${t.def.name} under attack!`, 'attack', t.x, t.y); this.lastEvent = { x: t.x, y: t.y };
      this.effects.push({ kind: 'ping', x: t.x, y: t.y, t: 0, dur: 2.5, color: '#d8484a' });
    }
  },
  onKilled(t, att) {
    if (t.kind === 'building') {
      if (t.owner === this.human && t.built) UI.message(`Your ${t.def.name} was destroyed.`, 'attack', t.x, t.y);
      else if (att && att.owner === this.human && t.built) UI.message(`${this.players[t.owner].name}'s ${t.def.name} destroyed.`, 'good', t.x, t.y);
      if (t.def.monument && t.built) UI.message(`${this.players[t.owner].name}'s Monument has fallen.`, 'info', t.x, t.y);
    }
    if (this.selection.includes(t)) UI.selDirty = UI.cmdDirty = true;
  },
  ringBell() { const th = this.players[this.human].buildings('townhall').find((b) => b.built) || this.players[this.human].buildings().find((b) => b.built && b.def.garrison); if (!th) { UI.toast('No shelter to run to'); return; } Sim.ringBell(th); UI.cmdDirty = true; },
  onBuilt(b) {
    if (b.owner === this.human) { UI.message(`${b.def.name} complete.`, 'good', b.x, b.y); UI.iconCache.clear(); }
    if (b.def.monument) { UI.message(`${this.players[b.owner].name} has completed a Monument! Destroy it within ${U.time(this.settings.monumentTime)}.`, b.owner === this.human ? 'good' : 'attack', b.x, b.y); if (b.owner !== this.human) Sfx.play('alert'); }
    if (this.selection.includes(b)) UI.selDirty = UI.cmdDirty = true;
  },
  onSpawned(u, b) { if (u.owner === this.human) Sfx.play('spawn', u.x, u.y); if (this.selection.includes(b)) UI.selDirty = true; },
  onResearched(p, id) { if (p.id === this.human) { UI.message(`${TECHS[id].name} researched.`, 'good'); Sfx.play('research'); UI.cmdDirty = true; } },
  onAgeUp(p) {
    UI.message(`${p.name === 'You' ? 'You have' : p.name + ' has'} advanced to the ${AGES[p.age].name}.`, p.id === this.human ? 'good' : 'info');
    if (p.id === this.human) { Sfx.play('ageup'); UI.iconCache.clear(); UI.cmdDirty = true; this.effects.push({ kind: 'text', x: Renderer.cam.x, y: Renderer.cam.y, t: 0, dur: 3, text: AGES[p.age].name, color: '#e8c46a' }); }
  },
  onIdleVillager(u) { },
  onAIAttack(p, target) { if (target.owner === this.human) { /* the scouts will tell us when it lands */ } },
  onMonumentWin(p) { if (this.over) return; this.gameOver(p.id === this.human, p.id === this.human ? 'Your Monument stood unbroken. The age is yours.' : `${p.name}'s Monument stood for ${U.time(this.settings.monumentTime)}.`); },

  checkVictory() {
    if (this.over) return;
    for (const p of this.players) {
      if (!p.alive) continue;
      const alive = this.buildings.some((b) => !b.dead && b.owner === p.id) || this.units.some((u) => !u.dead && u.owner === p.id && u.type === 'villager');
      if (!alive) { p.alive = false; UI.message(`${p.name === 'You' ? 'You have' : p.name + ' has'} been defeated.`, p.id === this.human ? 'attack' : 'good'); for (const u of this.units) if (u.owner === p.id) Sim.kill(u, null); }
    }
    if (!this.players[this.human].alive) { this.gameOver(false, 'Your last building has fallen and your people are scattered.'); return; }
    if (this.players.every((p) => p.id === this.human || !p.alive)) this.gameOver(true, 'Every rival has been driven from the land.');
  },
  gameOver(won, reason) {
    this.over = true; this.paused = true; Save.clear();
    Sfx.play(won ? 'victory' : 'defeat');
    UI.showEnd(won, reason);
  },
};
window.addEventListener('DOMContentLoaded', () => Game.init());
