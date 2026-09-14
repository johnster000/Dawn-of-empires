/* Isometric renderer. Everything is drawn with canvas paths from palettes: no bitmaps, no pixel art.
   World tile (x, y) at height z projects to screen ((x - y) * 32, (x + y) * 16 - z) at zoom 1. */
const Renderer = {
  canvas: null, g: null, W: 0, H: 0, dpr: 1,
  cam: { x: 0, y: 0, zoom: 1 }, ZOOMS: [0.45, 0.56, 0.7, 0.85, 1, 1.25, 1.55, 1.9], minZoom: 0.45, maxZoom: 1.9,
  time: 0, hover: null, ghost: null, selBox: null,
  tileColor: null, tileDeco: null, terrainTex: null, fogTex: null, fogDirty: true, sprites: new Map(), view: null,
  mini: null, mg: null, miniTerrain: null, miniFog: null, miniT: 0,

  init(canvas, mini) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    this.mini = mini; this.mg = mini.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.canvas.clientWidth; this.H = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
  },
  /* Precompute per-tile colours and paint the whole ground into one texture (TP px per tile).
     Drawing it with the isometric affine transform maps each square tile onto its diamond exactly,
     so the entire terrain costs a single drawImage per frame. */
  TP: 16,
  prepareMap() {
    const w = World.w, h = World.h, T = World.T, n = w * h, TP = this.TP;
    this.tileColor = new Array(n); this.tileDeco = new Uint8Array(n);
    const rng = RNG.make(Game.seed ^ 0x51ed);
    for (let i = 0; i < n; i++) {
      const t = World.tiles[i], sh = World.shade[i];
      let c;
      if (t === 1) c = U.mix(T.waterDeep, T.water, U.clamp(0.5 + sh * 0.5, 0, 1));
      else {
        const k = U.clamp((sh + 1) / 2, 0, 0.999) * (T.ground.length - 1);
        const a = T.ground[Math.floor(k)], b = T.ground[Math.min(T.ground.length - 1, Math.floor(k) + 1)];
        c = U.mix(a, b, k - Math.floor(k));
        if (t === 2) c = U.mix(c, T.shore, 0.55);
      }
      this.tileColor[i] = c;
      const x = i % w, y = Math.floor(i / w);
      const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      this.tileDeco[i] = t === 0 ? (hsh % 9 === 0 ? 1 : hsh % 23 === 0 ? 2 : 0) : 0;
    }
    // ground texture
    const tex = this.terrainTex = document.createElement('canvas'); tex.width = w * TP; tex.height = h * TP;
    const tg = tex.getContext('2d');
    for (let i = 0; i < n; i++) {
      const x = i % w, y = Math.floor(i / w), c = this.tileColor[i], t = World.tiles[i];
      tg.fillStyle = c; tg.fillRect(x * TP, y * TP, TP, TP);
      // soft mottling so the ground reads as painted, not flat
      for (let k = 0; k < 4; k++) { tg.fillStyle = U.alpha(k % 2 ? '#000000' : '#ffffff', t === 1 ? 0.05 : 0.07); const px = x * TP + rng() * TP, py = y * TP + rng() * TP; tg.beginPath(); tg.arc(px, py, 1.5 + rng() * 3, 0, 7); tg.fill(); }
      if (t === 2) { tg.fillStyle = U.alpha(T.shoreDark, 0.35); tg.beginPath(); tg.arc(x * TP + rng() * TP, y * TP + rng() * TP, 1 + rng() * 2, 0, 7); tg.fill(); }
      const d = this.tileDeco[i];
      if (d === 1) { tg.strokeStyle = U.alpha(U.shade(c, -0.3), 0.75); tg.lineWidth = 1.2; tg.beginPath(); for (let k = -1; k <= 1; k++) { tg.moveTo(x * TP + TP / 2 + k * 3, y * TP + TP / 2 + 3); tg.lineTo(x * TP + TP / 2 + k * 4.5, y * TP + TP / 2 - 5); } tg.stroke(); }
      else if (d === 2) { tg.fillStyle = T.id === 'tundra' ? '#c7d3da' : ['#e8d07a', '#e2e6ea', '#d98aa8'][(x + y) % 3]; tg.beginPath(); tg.arc(x * TP + 5, y * TP + 6, 1.6, 0, 7); tg.arc(x * TP + 11, y * TP + 11, 1.4, 0, 7); tg.fill(); }
    }
    // minimap terrain
    this.miniTerrain = document.createElement('canvas'); this.miniTerrain.width = w; this.miniTerrain.height = h;
    const mg = this.miniTerrain.getContext('2d');
    for (let i = 0; i < n; i++) { mg.fillStyle = this.tileColor[i]; mg.fillRect(i % w, Math.floor(i / w), 1, 1); }
    this.miniFog = document.createElement('canvas'); this.miniFog.width = w; this.miniFog.height = h;
    this.fogTex = document.createElement('canvas'); this.fogTex.width = w; this.fogTex.height = h;
    this.fogDirty = true; this.miniT = 0; this.sprites = new Map();
  },
  /* The fog texture: one pixel per tile, drawn with the same transform as the ground, bilinear-smoothed. */
  updateFogTex() {
    const w = World.w, h = World.h, fg = this.fogTex.getContext('2d');
    const img = fg.createImageData(w, h), d = img.data;
    const reveal = Game.settings.reveal;
    for (let i = 0; i < w * h; i++) { const o = i * 4; d[o] = 11; d[o + 1] = 10; d[o + 2] = 16; d[o + 3] = reveal || World.visible[i] ? 0 : World.explored[i] ? 135 : 255; }
    fg.putImageData(img, 0, 0);
    // the minimap shares the same information
    const mf = this.miniFog.getContext('2d'); mf.clearRect(0, 0, w, h); mf.putImageData(img, 0, 0);
    this.fogDirty = false;
  },

  /* ---- projection ---- */
  toScreen(wx, wy, z) {
    const c = this.cam, s = c.zoom;
    return [this.W / 2 + ((wx - wy) - (c.x - c.y)) * 32 * s, this.H / 2 + ((wx + wy) - (c.x + c.y)) * 16 * s - (z || 0) * s];
  },
  toWorld(sx, sy) {
    const c = this.cam, s = c.zoom;
    const a = (sx - this.W / 2) / (32 * s) + (c.x - c.y), b = (sy - this.H / 2) / (16 * s) + (c.x + c.y);
    return [(a + b) / 2, (b - a) / 2];
  },
  centerOn(x, y) { this.cam.x = x; this.cam.y = y; this.clampCam(); },
  clampCam() { this.cam.x = U.clamp(this.cam.x, 2, World.w - 2); this.cam.y = U.clamp(this.cam.y, 2, World.h - 2); },
  /* Zoom snaps to fixed steps so cached sprites are stamped without rescaling. */
  zoomAt(factor, sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const Z = this.ZOOMS; let i = 0; for (let k = 0; k < Z.length; k++) if (Math.abs(Z[k] - this.cam.zoom) < Math.abs(Z[i] - this.cam.zoom)) i = k;
    if (factor > 1.001) i = Math.min(Z.length - 1, i + 1); else if (factor < 0.999) i = Math.max(0, i - 1);
    this.cam.zoom = Z[i];
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny; this.clampCam();
  },

  /* ---- frame ---- */
  draw(dt) {
    this.time += dt;
    const g = this.g, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0a10'; g.fillRect(0, 0, this.W, this.H);
    // visible tile range from the four screen corners
    const c0 = this.toWorld(0, 0), c1 = this.toWorld(this.W, 0), c2 = this.toWorld(0, this.H), c3 = this.toWorld(this.W, this.H);
    const x0 = Math.max(0, Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0])) - 1), x1 = Math.min(World.w - 1, Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1])) - 1), y1 = Math.min(World.h - 1, Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1])) + 3);
    this.view = { x0, y0, x1, y1 };
    this.drawGround(x0, y0, x1, y1);
    // collect drawables
    const list = [];
    const inView = (x, y) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2;
    const reveal = Game.settings.reveal, exp = World.explored, vis = World.visible;
    for (const r of World.res) if (inView(r.x, r.y) && (reveal || exp[World.idx(r.x, r.y)])) list.push({ d: r.x + r.y + 1, k: 'res', o: r });
    for (const b of Game.buildings) { if (b.dead || !inView(b.x, b.y)) continue; if (!reveal && !exp[World.idx(b.tx, b.ty)] && !exp[World.idx(b.tx + b.size - 1, b.ty + b.size - 1)]) continue; list.push({ d: b.tx + b.ty + b.size, k: 'bld', o: b }); }
    for (const u of Game.units) { if (u.dead || !inView(u.x, u.y)) continue; if (u.owner !== Game.human && !reveal && !vis[World.idx(Math.floor(u.x), Math.floor(u.y))]) { u.sx = null; continue; } list.push({ d: u.x + u.y, k: 'unit', o: u }); }
    for (const e of Game.effects) { const ex = e.x != null ? e.x : U.lerp(e.x0, e.x1, e.t / e.dur), ey = e.y != null ? e.y : U.lerp(e.y0, e.y1, e.t / e.dur); if (inView(ex, ey)) list.push({ d: ex + ey + (e.kind === 'corpse' || e.kind === 'rubble' ? -0.4 : 0.6), k: 'fx', o: e }); }
    if (this.ghost) list.push({ d: this.ghost.tx + this.ghost.ty + this.ghost.def.size, k: 'ghost', o: this.ghost });
    list.sort((a, b) => a.d - b.d || (a.k === 'fx' ? -1 : 0));
    // selection rings first so they sit under feet
    for (const u of Game.selection) if (u.kind === 'unit' && !u.dead) this.drawRing(u);
    for (const it of list) {
      if (it.k === 'res') this.drawResource(it.o);
      else if (it.k === 'bld') this.drawBuilding(it.o);
      else if (it.k === 'unit') this.drawUnit(it.o);
      else if (it.k === 'fx') this.drawEffect(it.o);
      else if (it.k === 'ghost') this.drawGhost(it.o);
    }
    // fog of war over everything in the world, then interface overlays on top
    if (!reveal) { if (this.fogDirty) this.updateFogTex(); this.drawMapImage(this.fogTex, 1, x0, y0, x1, y1); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of Game.buildings) if (!b.dead && inView(b.x, b.y) && (Game.selection.includes(b) || b.hp < b.maxHp || !b.built) && (reveal || exp[World.idx(b.tx, b.ty)])) this.drawBuildingBar(b);
    for (const u of Game.units) if (!u.dead && u.sx != null && inView(u.x, u.y) && (Game.selection.includes(u) || (u.hp < u.maxHp && Game.time - (u.lastHit || -99) < 6))) this.drawUnitBar(u);
    for (const b of Game.selection) if (b.kind === 'building' && b.rally && b.owner === Game.human) this.drawRally(b);
    if (this.selBox) { const bx = this.selBox; g.strokeStyle = 'rgba(232,196,106,0.9)'; g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(bx.x0 + 0.5, bx.y0 + 0.5, bx.x1 - bx.x0, bx.y1 - bx.y0); g.setLineDash([]); g.fillStyle = 'rgba(232,196,106,0.08)'; g.fillRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0); }
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.4; this.drawMinimap(); }
  },
  /* Draw a per-tile image (`ppt` pixels per tile) so that tile (x, y) lands on its diamond. */
  drawMapImage(img, ppt, x0, y0, x1, y1) {
    const g = this.g, z = this.cam.zoom, dpr = this.dpr, [ox, oy] = this.toScreen(0, 0, 0);
    g.setTransform(32 * z * dpr, 16 * z * dpr, -32 * z * dpr, 16 * z * dpr, ox * dpr, oy * dpr);
    g.imageSmoothingEnabled = true;
    const sx = Math.max(0, x0 - 1), sy = Math.max(0, y0 - 1), ex = Math.min(World.w, x1 + 2), ey = Math.min(World.h, y1 + 2);
    g.drawImage(img, sx * ppt, sy * ppt, (ex - sx) * ppt, (ey - sy) * ppt, sx, sy, ex - sx, ey - sy);
  },
  drawGround(x0, y0, x1, y1) {
    const g = this.g, s = this.cam.zoom, T = World.T, w = World.w, dpr = this.dpr;
    this.drawMapImage(this.terrainTex, this.TP, x0, y0, x1, y1);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s < 0.85) return;
    // animated ripples on visible water, nothing else: everything static is baked into the texture
    const hw = 32 * s, hh = 16 * s, reveal = Game.settings.reveal, vis = World.visible, tiles = World.tiles;
    const cols = this.rippleCols || (this.rippleCols = [0.25, 0.35, 0.45, 0.55].map((a) => U.alpha(T.waterLight, a)));
    g.lineWidth = Math.max(0.8, s); g.lineCap = 'round';
    let n = 0;
    for (let y = y0; y <= y1 && n < 400; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (tiles[i] !== 1 || ((x + y) & 1) || !(reveal || vis[i])) continue;
      const [sx, sy] = this.toScreen(x, y, 0), ph = this.time * 1.2 + x * 0.7 + y * 1.3, k = Math.sin(ph);
      g.strokeStyle = cols[(Math.floor((k + 1) * 2)) & 3];
      g.beginPath(); g.moveTo(sx - hw * 0.4, sy + hh + k * 2 * s); g.lineTo(sx + hw * 0.4, sy + hh - k * 2 * s); g.stroke(); n++;
    }
  },

  /* Set a transform so that (0,0) is the world point and 1 unit = 1 zoom-1 pixel. */
  at(wx, wy, z) { const [sx, sy] = this.toScreen(wx, wy, z || 0); const k = this.dpr * this.cam.zoom; this.g.setTransform(k, 0, 0, k, sx * this.dpr, sy * this.dpr); },
  /* Project a world offset (dx, dy, dz in tiles / px) relative to the current `at` origin. */
  P(dx, dy, dz) { return [(dx - dy) * 32, (dx + dy) * 16 - (dz || 0)]; },
  poly(pts, fill, stroke, lw) { const g = this.g; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); } },
  ell(x, y, rx, ry, fill, stroke) { const g = this.g; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); } },
  shadow(x, y, rx, ry, a) { this.ell(x, y, rx, ry, `rgba(10,8,20,${a == null ? 0.28 : a})`); },
  dimIf() { return true; },

  /* ---- natural resources: vector art rendered once per look and zoom step, then stamped ---- */
  drawResource(r) {
    const z = this.cam.zoom, zq = this.zq(z);
    const vq = Math.floor(r.v * 6), lvl = r.kind === 'tree' ? 0 : Math.min(2, Math.floor((r.amount / r.max) * 3));
    const key = r.kind + '|' + vq + '|' + lvl + '|' + zq.toFixed(3);
    let sp = this.sprites.get(key);
    if (!sp) {
      const k = zq * this.dpr, W = Math.ceil(64 * k), H = Math.ceil(80 * k), ax = W / 2, ay = H - 14 * k;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
      this.g = cv.getContext('2d'); this.dpr = 1; this.cam = { x: 0, y: 0, zoom: k }; this.W = 2 * ax; this.H = 2 * ay;
      const fake = { kind: r.kind, x: -0.5, y: -0.5, v: (vq + 0.5) / 6, amount: (lvl + 0.5) / 3, max: 1 };
      this.drawResourceVector(fake);
      this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
      sp = { cv, ax, ay, k }; this.sprites.set(key, sp);
      if (this.sprites.size > 400) this.sprites.clear();
    }
    const [sx, sy] = this.toScreen(r.x + 0.5, r.y + 0.5, 0), g = this.g, dpr = this.dpr, sc = (z * dpr) / sp.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(sp.cv, sx * dpr - sp.ax * sc, sy * dpr - sp.ay * sc, sp.cv.width * sc, sp.cv.height * sc);
  },
  drawResourceVector(r) {
    const g = this.g, T = World.T;
    this.at(r.x + 0.5, r.y + 0.5, 0);
    this.dimIf(r.x, r.y);
    const v = r.v, scale = r.kind === 'tree' ? 0.85 + v * 0.35 : 1;
    if (r.kind === 'tree') {
      const shape = T.treeShape;
      const canopy = T.canopy[Math.floor(v * T.canopy.length) % T.canopy.length];
      this.shadow(4, 3, 14 * scale, 6 * scale, 0.25);
      if (shape === 'pine') {
        g.fillStyle = T.trunk; g.fillRect(-2, -6 * scale, 4, 8 * scale);
        for (let k = 0; k < 3; k++) { const y = -4 - k * 12 * scale, w = (18 - k * 4) * scale, h = 16 * scale; this.poly([[0, y - h], [w, y], [-w, y]], k % 2 ? canopy : U.shade(canopy, -0.12)); this.poly([[0, y - h], [w * 0.35, y - h * 0.4], [0, y - h * 0.2]], U.shade(canopy, 0.18)); }
      } else if (shape === 'palm') {
        g.strokeStyle = T.trunk; g.lineWidth = 3.5; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(6 * scale, -14 * scale, 3 * scale, -30 * scale); g.stroke();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + v * 3; g.save(); g.translate(3 * scale, -30 * scale); g.rotate(a); this.ell(11 * scale, 0, 12 * scale, 3.5 * scale, k % 2 ? canopy : U.shade(canopy, -0.15)); g.restore(); }
        g.fillStyle = '#7a5a2a'; g.beginPath(); g.arc(3 * scale, -29 * scale, 3, 0, 7); g.fill();
      } else {
        g.fillStyle = T.trunk; g.fillRect(-2.5, -8 * scale, 5, 10 * scale);
        this.ell(0, -18 * scale, 13 * scale, 12 * scale, U.shade(canopy, -0.18));
        this.ell(-4 * scale, -20 * scale, 11 * scale, 10 * scale, canopy);
        this.ell(4 * scale, -23 * scale, 9 * scale, 8.5 * scale, U.shade(canopy, 0.12));
        this.ell(-3 * scale, -27 * scale, 6 * scale, 5 * scale, U.shade(canopy, 0.28));
      }
    } else if (r.kind === 'stone' || r.kind === 'gold') {
      const base = r.kind === 'gold' ? U.mix(T.rock, '#8a7a4a', 0.35) : T.rock, dark = r.kind === 'gold' ? U.mix(T.rockDark, '#6a5a30', 0.35) : T.rockDark;
      const k = 0.6 + 0.4 * (r.amount / r.max);
      this.shadow(2, 6, 18, 7, 0.25);
      this.poly([[-16 * k, 4], [-10 * k, -10 * k], [2, -14 * k], [12 * k, -6 * k], [16 * k, 5], [0, 10]], base);
      this.poly([[-16 * k, 4], [-10 * k, -10 * k], [2, -14 * k], [-2, 2]], U.shade(base, 0.2));
      this.poly([[2, -14 * k], [12 * k, -6 * k], [16 * k, 5], [0, 10], [-2, 2]], dark);
      this.poly([[-22, 8], [-18, 0], [-10, 2], [-9, 9]], U.shade(base, 0.05));
      if (r.kind === 'gold') { g.fillStyle = T.gold; for (let i = 0; i < 6; i++) { const a = v * 17 + i * 1.7; g.beginPath(); g.arc(Math.cos(a) * 9, -4 + Math.sin(a) * 5, 2.2, 0, 7); g.fill(); } g.fillStyle = '#fff3b0'; g.fillRect(3, -6, 1.5, 1.5); }
    } else if (r.kind === 'berry') {
      const k = 0.7 + 0.3 * (r.amount / r.max);
      this.shadow(2, 4, 13, 5, 0.22);
      this.ell(0, -6, 13 * k, 9 * k, T.bush); this.ell(-4, -9, 8 * k, 6 * k, U.shade(T.bush, 0.15)); this.ell(5, -8, 7 * k, 5 * k, U.shade(T.bush, 0.05));
      g.fillStyle = T.berry; for (let i = 0; i < 7; i++) { const a = v * 11 + i * 0.9; g.beginPath(); g.arc(Math.cos(a) * 9 * k, -7 + Math.sin(a) * 5 * k, 1.8, 0, 7); g.fill(); }
    }
    g.globalAlpha = 1;
  },

  /* ---- buildings: static art cached per look and zoom step; flags and smoke drawn live ---- */
  drawBuilding(b) {
    const g = this.g, p = Game.players[b.owner], age = AGES[b.ageVisual] || AGES[0];
    if (!b.built) { this.at(b.tx, b.ty, 0); this.footShadow(b); this.drawSite(b, age); return; }
    const z = this.cam.zoom, zq = this.zq(z), s = b.size;
    const grown = b.def.farm ? (b.worker && !b.worker.dead ? 1 : 0) : 0;
    const key = 'b|' + b.type + '|' + b.ageVisual + '|' + b.owner + '|' + grown + '|' + zq.toFixed(3);
    let sp = this.sprites.get(key);
    if (!sp) {
      const k = zq * this.dpr, hgt = this.height(b) + 70, W = Math.ceil((s * 64 + 48) * k), H = Math.ceil((s * 32 + hgt + 30) * k), ax = W / 2, ay = hgt * k;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
      this.g = cv.getContext('2d'); this.dpr = 1; this.cam = { x: 0, y: 0, zoom: k }; this.W = 2 * ax; this.H = 2 * ay;
      const fake = { tx: 0, ty: 0, size: s, x: s / 2, y: s / 2, def: b.def, type: b.type, built: true, worker: grown ? { dead: false } : null, owner: b.owner, ageVisual: b.ageVisual };
      this.at(0, 0, 0); this.footShadow(fake);
      const fn = this['shape_' + b.def.shape] || this.shape_house; fn.call(this, fake, age, p);
      this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
      sp = { cv, ax, ay, k }; this.sprites.set(key, sp);
      if (this.sprites.size > 400) this.sprites.clear();
    }
    const [sx, sy] = this.toScreen(b.tx, b.ty, 0), dpr = this.dpr, sc = (z * dpr) / sp.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(sp.cv, sx * dpr - sp.ax * sc, sy * dpr - sp.ay * sc, sp.cv.width * sc, sp.cv.height * sc);
    // live parts
    this.at(b.tx, b.ty, 0);
    const col = p.color.main, sh = b.def.shape;
    if (sh === 'hall') { const t = this.P(s - 0.4, s - 0.4, 40); this.flag([t[0], t[1] - 12], col); this.flag(this.P(s, 0, this.height(b) + 4), col); }
    else if (sh === 'tower') this.flag(this.P(0.5, 0.5, 62), col);
    else if (sh === 'keep') this.flag(this.P(s * 0.5, s * 0.5, 50), col);
    else if (sh === 'monument') { const t = this.P(s / 2, s / 2, 48); this.flag([t[0], t[1] - 44], col); }
    else if (sh !== 'farm') this.flag(this.P(s, 0, this.height(b) + 4), col);
    if (sh === 'smithy') { const c = this.P(s * 0.82, s * 0.32, 32); for (let k = 0; k < 3; k++) { const t = (this.time * 0.5 + k / 3) % 1; this.ell(c[0] + Math.sin(t * 6) * 3, c[1] - t * 22, 4 + t * 5, 3 + t * 3, `rgba(200,200,210,${0.35 * (1 - t)})`); } const w = this.P(s, s * 0.25, 9); this.ell(w[0], w[1], 4, 3, `rgba(255,140,40,${0.6 + 0.3 * Math.sin(this.time * 7)})`); }
  },
  zq(z) { const Z = this.ZOOMS; let i = 0; for (let k = 0; k < Z.length; k++) if (Math.abs(Z[k] - z) < Math.abs(Z[i] - z)) i = k; return Z[i]; },
  footShadow(b) {
    if (b.def.passable) return;
    const s = b.size, A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    this.poly([[A[0], A[1] + 2], [B[0] + 4, B[1] + 2], [C[0], C[1] + 4], [D[0] - 4, D[1] + 2]], 'rgba(10,8,20,0.28)');
  },
  height(b) { return { 1: 30, 2: 26, 3: 32, 4: 40 }[b.size] * ({ tower: 1.9, keep: 1.5, hall: 1.2, monument: 1.2, farm: 0 }[b.def.shape] || 1); },
  /* A box on the footprint: left face (D-C), right face (C-B), and a flat top. */
  box(x0, y0, x1, y1, z0, h, wall, wallDark, top) {
    const P = (x, y, z) => this.P(x, y, z);
    const A = P(x0, y0, z0 + h), B = P(x1, y0, z0 + h), C = P(x1, y1, z0 + h), D = P(x0, y1, z0 + h);
    const Cb = P(x1, y1, z0), Db = P(x0, y1, z0), Bb = P(x1, y0, z0);
    this.poly([D, C, Cb, Db], wall);
    this.poly([C, B, Bb, Cb], wallDark);
    if (top) this.poly([A, B, C, D], top);
    return { A, B, C, D };
  },
  /* Gabled roof over footprint (x0..x1, y0..y1) at wall height h, ridge along x. */
  gable(x0, y0, x1, y1, h, rise, roof, roofDark, overhang) {
    const o = overhang == null ? 0.18 : overhang;
    const P = (x, y, z) => this.P(x, y, z);
    const ym = (y0 + y1) / 2;
    const A = P(x0 - o, y0 - o, h - 2), B = P(x1 + o, y0 - o, h - 2), C = P(x1 + o, y1 + o, h - 2), D = P(x0 - o, y1 + o, h - 2);
    const M1 = P(x0 - o, ym, h + rise), M2 = P(x1 + o, ym, h + rise);
    this.poly([A, B, M2, M1], roofDark);       // far slope
    this.poly([M1, M2, C, D], roof);           // near slope
    // ridge highlight and a few shingle lines
    const g = this.g; g.strokeStyle = U.alpha('#ffffff', 0.18); g.lineWidth = 1.2; g.beginPath(); g.moveTo(M1[0], M1[1]); g.lineTo(M2[0], M2[1]); g.stroke();
    g.strokeStyle = U.alpha('#000000', 0.12); g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const t = k / 4; g.beginPath(); g.moveTo(U.lerp(M1[0], D[0], t), U.lerp(M1[1], D[1], t)); g.lineTo(U.lerp(M2[0], C[0], t), U.lerp(M2[1], C[1], t)); g.stroke(); }
    // gable end (right face triangle)
    this.poly([P(x1, y0, h), P(x1, y1, h), P(x1, ym, h + rise)], U.shade(roofDark, -0.15));
  },
  flag(at, color) { const g = this.g; g.strokeStyle = '#3a2a1a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(at[0], at[1]); g.lineTo(at[0], at[1] - 16); g.stroke(); const wv = Math.sin(this.time * 4 + at[0]) * 1.5; this.poly([[at[0], at[1] - 16], [at[0] + 10, at[1] - 13 + wv], [at[0], at[1] - 9]], color); },
  door(x, y, z, face, color) { // small arched door on the left (face 'L') or right ('R') wall at world point (x, y)
    const g = this.g; const [sx, sy] = this.P(x, y, z); const dx = face === 'L' ? 5 : -5;
    g.fillStyle = color || '#3a2a1a'; g.beginPath(); g.moveTo(sx - 4, sy); g.lineTo(sx - 4, sy - 8); g.quadraticCurveTo(sx, sy - 13, sx + 4, sy - 8 + (face === 'L' ? 2 : -2)); g.lineTo(sx + 4, sy + (face === 'L' ? 2 : -2)); g.closePath(); g.fill();
  },
  window(x, y, z, face) { const [sx, sy] = this.P(x, y, z); const g = this.g; g.fillStyle = 'rgba(255,225,150,0.85)'; g.fillRect(sx - 2.5, sy - 3, 5, 5); },
  drawSite(b, age) {
    // construction site: timber frame that grows with progress
    const g = this.g, s = b.size, h = this.height(b) * b.progress + 2;
    const A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    this.poly([A, B, C, D], 'rgba(120,90,50,0.35)', 'rgba(90,60,30,0.7)', 1);
    if (b.def.passable) { this.poly([A, B, C, D], 'rgba(120,80,40,0.45)'); return; }
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 2.2;
    for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s], [s / 2, 0], [0, s / 2], [s, s / 2], [s / 2, s]]) { const p0 = this.P(x, y, 0), p1 = this.P(x, y, h); g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); }
    g.lineWidth = 1.5; g.strokeStyle = '#a07f56';
    const pts = [this.P(0, 0, h), this.P(s, 0, h), this.P(s, s, h), this.P(0, s, h)];
    g.beginPath(); for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); } g.stroke();
    // a few planks stacked beside
    g.fillStyle = '#9c7a4a'; const pl = this.P(s + 0.2, s * 0.5, 0); for (let k = 0; k < 3; k++) g.fillRect(pl[0] - 8, pl[1] - 4 - k * 3, 16, 2.5);
  },
  shape_house(b, age, p) {
    const s = b.size; this.box(0, 0, s, s, 0, 20, age.wall, age.wallDark, age.roof);
    this.door(0, s * 0.5, 0, 'L', p.color.dark); this.window(s, s * 0.3, 10, 'R');
    this.gable(0, 0, s, s, 20, 14, age.roof, age.roofDark);
    const ch = this.P(s * 0.7, s * 0.5, 34); this.g.fillStyle = age.wallDark; this.g.fillRect(ch[0] - 2.5, ch[1] - 6, 5, 8);
  },
  shape_hall(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s, s, 0, 26, age.wall, age.wallDark, age.roof);
    this.door(0, s * 0.5, 0, 'L', p.color.dark); this.window(s, s * 0.35, 12, 'R'); this.window(s, s * 0.7, 12, 'R'); this.window(0, s * 0.2, 12, 'L');
    this.gable(0, 0, s, s, 26, 18, age.roof, age.roofDark);
    // corner turret with banner
    this.box(s - 0.8, s - 0.8, s, s, 0, 40, age.wall, age.wallDark, age.trim);
    const t = this.P(s - 0.4, s - 0.4, 40); this.poly([[t[0] - 12, t[1] + 4], [t[0], t[1] - 14], [t[0] + 12, t[1] + 4]], age.roofDark);
    // team banner on left face
    const bn = this.P(0, s * 0.8, 18); g.fillStyle = p.color.main; g.fillRect(bn[0] - 3, bn[1] - 8, 6, 14); g.fillStyle = age.trim; g.fillRect(bn[0] - 4, bn[1] - 9, 8, 2);
  },
  shape_barn(b, age, p) {
    const s = b.size; this.box(0, 0, s, s, 0, 18, age.wall, age.wallDark, age.roof);
    this.door(s, s * 0.5, 0, 'R', '#4a3320');
    this.gable(0, 0, s, s, 18, 16, age.roof, age.roofDark);
    // grain sacks by the wall
    const g = this.g; const q = this.P(-0.15, s * 0.3, 0); g.fillStyle = '#c9a66b'; this.ell(q[0], q[1], 5, 3.5, '#c9a66b'); this.ell(q[0] - 7, q[1] + 3, 4.5, 3, '#b8955c');
  },
  shape_camp(b, age, p) {
    const s = b.size, g = this.g;
    // low hut in one half, stock pile in the other
    this.box(0, 0, s * 0.55, s, 0, 14, age.wall, age.wallDark, age.roof);
    this.gable(0, 0, s * 0.55, s, 14, 12, age.roof, age.roofDark, 0.12);
    this.door(0, s * 0.5, 0, 'L', p.color.dark);
    if (b.type === 'lumbercamp') {
      for (let k = 0; k < 3; k++) for (let i = 0; i < 3 - k; i++) { const c = this.P(s * 0.8, s * 0.35 + i * 0.28 + k * 0.14, k * 5); this.ell(c[0], c[1], 6, 3.2, k % 2 ? '#8a6238' : '#9c7040', '#5a3f22'); this.ell(c[0], c[1], 3, 1.6, '#c9a26b'); }
    } else {
      const c = this.P(s * 0.78, s * 0.55, 0); g.fillStyle = '#6a4a2a'; g.fillRect(c[0] - 12, c[1] - 10, 24, 9); this.ell(c[0] - 7, c[1] + 1, 3.5, 3.5, '#3a2a1a'); this.ell(c[0] + 7, c[1] + 1, 3.5, 3.5, '#3a2a1a');
      for (let i = 0; i < 5; i++) this.ell(c[0] - 8 + i * 4, c[1] - 11, 2.6, 2.2, i % 2 ? World.T.gold : World.T.rock);
    }
  },
  shape_longhouse(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0.3, s, s - 0.3, 0, 22, age.wall, age.wallDark, age.roof);
    this.door(0, s * 0.5, 0, 'L', p.color.dark); this.window(s, s * 0.3, 12, 'R'); this.window(s, s * 0.65, 12, 'R');
    this.gable(0, 0.3, s, s - 0.3, 22, 15, age.roof, age.roofDark);
    // shields on the near wall
    for (let k = 0; k < 2; k++) { const w = this.P(k * 1.0 + 0.6, s, 12); this.ell(w[0], w[1], 4, 4.5, p.color.main, age.trim); }
    // weapon rack
    const r = this.P(s + 0.15, s * 0.4, 0); g.strokeStyle = '#5a3f22'; g.lineWidth = 1.5; g.beginPath(); for (let i = 0; i < 4; i++) { g.moveTo(r[0] + i * 4 - 6, r[1]); g.lineTo(r[0] + i * 4 - 4, r[1] - 16); } g.stroke();
  },
  shape_range(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s * 0.5, s * 0.6, 0, 18, age.wall, age.wallDark, age.roof);
    this.gable(0, 0, s * 0.5, s * 0.6, 18, 12, age.roof, age.roofDark, 0.12);
    this.door(0, s * 0.3, 0, 'L', p.color.dark);
    // fenced yard with two targets
    g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.5;
    const f = [this.P(s, 0), this.P(s, s), this.P(0, s)]; g.beginPath(); g.moveTo(f[0][0], f[0][1]); g.lineTo(f[1][0], f[1][1]); g.lineTo(f[2][0], f[2][1]); g.stroke();
    for (let k = 0; k < 2; k++) { const t = this.P(s * 0.85, s * 0.35 + k * 0.4, 0); this.ell(t[0], t[1] - 8, 6, 6, '#e8dcc4', '#5a3f22'); this.ell(t[0], t[1] - 8, 3.5, 3.5, p.color.main); this.ell(t[0], t[1] - 8, 1.3, 1.3, '#e8dcc4'); g.fillStyle = '#5a3f22'; g.fillRect(t[0] - 1, t[1] - 3, 2, 5); }
  },
  shape_stables(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s, s * 0.6, 0, 18, age.wall, age.wallDark, age.roof);
    this.gable(0, 0, s, s * 0.6, 18, 12, age.roof, age.roofDark);
    this.door(s, s * 0.3, 0, 'R', '#4a3320');
    // paddock fence and a horse
    g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.5; const f = [this.P(0, s * 0.6), this.P(0, s), this.P(s, s), this.P(s, s * 0.6)]; g.beginPath(); g.moveTo(f[0][0], f[0][1]); for (const q of f.slice(1)) g.lineTo(q[0], q[1]); g.stroke();
    const hp = this.P(s * 0.45, s * 0.82, 0); this.horse(hp[0], hp[1], '#7a5a3a', 1, 0);
    const hay = this.P(s * 0.85, s * 0.8, 0); this.ell(hay[0], hay[1], 7, 4, '#d8b860'); this.ell(hay[0], hay[1] - 3, 5, 3, '#e8cc78');
  },
  shape_smithy(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s, s, 0, 18, age.wall, age.wallDark, U.shade(age.roofDark, -0.2));
    this.door(s, s * 0.5, 0, 'R', '#2a1a10');
    // chimney with smoke
    this.box(s * 0.7, s * 0.2, s * 0.95, s * 0.45, 18, 14, age.wallDark, U.shade(age.wallDark, -0.2), '#3a3030');
    // anvil and glow
    const a = this.P(-0.2, s * 0.6, 0); g.fillStyle = '#3a3a40'; g.fillRect(a[0] - 6, a[1] - 6, 12, 4); g.fillRect(a[0] - 3, a[1] - 3, 6, 4);
  },
  shape_tower(b, age, p) {
    const s = b.size, h = 56, g = this.g;
    this.box(0.1, 0.1, s - 0.1, s - 0.1, 0, h, age.wall, age.wallDark, age.trim);
    // crenellations
    for (const [x, y] of [[0.1, 0.1], [s - 0.1, 0.1], [s - 0.1, s - 0.1], [0.1, s - 0.1], [0.5, 0.1], [0.1, 0.5], [s - 0.1, 0.5], [0.5, s - 0.1]]) this.box(x - 0.12, y - 0.12, x + 0.12, y + 0.12, h, 6, age.wall, age.wallDark, age.trim);
    this.window(0.1, 0.5, h * 0.55, 'L'); this.window(s - 0.1, 0.5, h * 0.55, 'R');
  },
  shape_keep(b, age, p) {
    const s = b.size, h = 46;
    this.box(0, 0, s, s, 0, h, age.wall, age.wallDark, age.trim);
    for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s]]) this.box(x - 0.25, y - 0.25, x + 0.25, y + 0.25, 0, h + 14, age.wall, age.wallDark, age.roofDark);
    for (let k = 0.4; k < s; k += 0.55) { this.box(k - 0.1, -0.05, k + 0.1, 0.05, h, 5, age.wall, age.wallDark, age.trim); this.box(k - 0.1, s - 0.05, k + 0.1, s + 0.05, h, 5, age.wall, age.wallDark, age.trim); }
    this.door(0, s * 0.5, 0, 'L', '#2a1a10'); this.window(s, s * 0.3, 26, 'R'); this.window(s, s * 0.7, 26, 'R'); this.window(0, s * 0.25, 26, 'L');
  },
  shape_library(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s, s, 0, 24, age.wall, age.wallDark, age.roof);
    // columns along the left face
    for (let k = 0.3; k < s; k += 0.6) { const c0 = this.P(0, k, 0), c1 = this.P(0, k, 24); g.strokeStyle = U.shade(age.wall, 0.25); g.lineWidth = 3; g.beginPath(); g.moveTo(c0[0] - 2, c0[1]); g.lineTo(c1[0] - 2, c1[1]); g.stroke(); }
    // dome
    const d = this.P(s / 2, s / 2, 24); this.ell(d[0], d[1] - 2, s * 18, s * 9, age.roofDark); this.ell(d[0], d[1] - 4, s * 16, s * 14, age.roof); this.ell(d[0] - s * 5, d[1] - s * 8, s * 6, s * 4, U.alpha('#ffffff', 0.18));
    g.fillStyle = age.trim; g.beginPath(); g.arc(d[0], d[1] - 4 - s * 14, 3, 0, 7); g.fill();
    this.door(0, s * 0.5, 0, 'L', '#3a2a1a');
  },
  shape_workshop(b, age, p) {
    const s = b.size, g = this.g;
    this.box(0, 0, s, s * 0.65, 0, 22, age.wall, age.wallDark, age.roof);
    this.gable(0, 0, s, s * 0.65, 22, 14, age.roof, age.roofDark);
    // open front with a wheel and beams
    const w = this.P(s * 0.3, s * 0.85, 0); this.ell(w[0], w[1] - 7, 7, 7, '#5a3f22', '#3a2a1a'); this.ell(w[0], w[1] - 7, 2, 2, '#3a2a1a');
    g.strokeStyle = '#7a5a3a'; g.lineWidth = 2.5; const bm = this.P(s * 0.75, s * 0.85, 0); g.beginPath(); g.moveTo(bm[0] - 14, bm[1]); g.lineTo(bm[0] + 14, bm[1] - 3); g.moveTo(bm[0] - 12, bm[1] - 4); g.lineTo(bm[0] + 12, bm[1] - 7); g.stroke();
  },
  shape_monument(b, age, p) {
    const s = b.size;
    const stone = '#e2dbcd', dark = '#b5ad9e';
    this.box(0, 0, s, s, 0, 16, stone, dark, U.shade(stone, -0.05));
    this.box(0.5, 0.5, s - 0.5, s - 0.5, 16, 16, stone, dark, U.shade(stone, -0.05));
    this.box(1, 1, s - 1, s - 1, 32, 16, stone, dark, U.shade(stone, -0.05));
    for (const [x, y] of [[1.3, 1.3], [s - 1.3, 1.3], [s - 1.3, s - 1.3], [1.3, s - 1.3]]) this.box(x - 0.15, y - 0.15, x + 0.15, y + 0.15, 48, 14, stone, dark, '#c9a54a');
    const top = this.P(s / 2, s / 2, 48); this.poly([this.P(1.4, 1.4, 62), this.P(s - 1.4, 1.4, 62), this.P(s - 1.4, s - 1.4, 62), this.P(1.4, s - 1.4, 62)], '#c9a54a');
    this.poly([this.P(1.4, 1.4, 62), this.P(s - 1.4, 1.4, 62), this.P(s / 2, s / 2, 92)], '#e0c060'); this.poly([this.P(s - 1.4, 1.4, 62), this.P(s - 1.4, s - 1.4, 62), this.P(s / 2, s / 2, 92)], '#b08a30'); this.poly([this.P(s - 1.4, s - 1.4, 62), this.P(1.4, s - 1.4, 62), this.P(s / 2, s / 2, 92)], '#d8b040');
  },
  shape_farm(b, age, p) {
    const g = this.g, s = b.size;
    const A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    this.poly([A, B, C, D], World.T.id === 'tundra' ? '#8a7a5a' : '#8a6a3a');
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
    for (let k = 1; k < 8; k++) { const t = k / 8; const p0 = this.P(t * s, 0), p1 = this.P(t * s, s); g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); }
    // crops
    const grown = b.worker && !b.worker.dead ? 1 : 0.6;
    g.fillStyle = U.alpha('#8fb84a', 0.9);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const q = this.P((i + 0.5) / 8 * s, (j + 0.5) / 8 * s); g.beginPath(); g.arc(q[0], q[1] - 3 * grown, 1.8 * grown, 0, 7); g.fill(); }
    g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(A[0], A[1] - 3); g.lineTo(B[0], B[1] - 3); g.lineTo(C[0], C[1] - 3); g.lineTo(D[0], D[1] - 3); g.closePath(); g.stroke();
  },

  drawGhost(gh) {
    const g = this.g, s = gh.def.size;
    this.at(gh.tx, gh.ty, 0);
    const ok = gh.ok;
    g.globalAlpha = 0.6;
    const A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    this.poly([A, B, C, D], ok ? 'rgba(122,201,67,0.45)' : 'rgba(216,72,74,0.45)', ok ? '#7ac943' : '#d8484a', 1.5);
    if (ok) { const fake = { tx: gh.tx, ty: gh.ty, size: s, x: gh.tx + s / 2, y: gh.ty + s / 2, def: gh.def, type: gh.type, built: true, worker: null, owner: Game.human }; const fn = this['shape_' + gh.def.shape] || this.shape_house; fn.call(this, fake, AGES[Game.players[Game.human].age], Game.players[Game.human]); }
    g.globalAlpha = 1;
  },

  /* ---- units ---- */
  drawRing(u) { this.at(u.x, u.y, 0); const c = Game.players[u.owner].color; this.ell(0, 1, 14, 7, U.alpha(c.light, 0.25), c.light); },
  drawUnit(u) {
    const g = this.g, p = Game.players[u.owner], col = p.color;
    this.at(u.x, u.y, 0);
    const sdx = Math.cos(u.face) - Math.sin(u.face); const flip = sdx < 0 ? -1 : 1;
    const walk = u.moving ? Math.sin(u.anim * 2) : 0;
    const skin = ['#e8c39e', '#d9a678', '#b57a4b', '#8a5a3a'][u.id % 4];
    this.shadow(0, 1, u.def.cls === 'cavalry' ? 13 : u.def.cls === 'siege' ? 14 : 7, u.def.cls === 'cavalry' ? 6 : 3.5, 0.3);
    g.save(); g.scale(flip, 1);
    if (u.def.cls === 'siege') { this.catapult(u, col); g.restore(); return; }
    let by = 0; // body baseline
    if (u.def.cls === 'cavalry') { this.horse(0, 0, ['#5a3a22', '#8a6a4a', '#c8b8a0', '#3a3030'][u.id % 4], 1, walk); by = -12; }
    // legs
    g.strokeStyle = '#3a2a2a'; g.lineWidth = 2.2; g.lineCap = 'round';
    if (u.def.cls !== 'cavalry') { g.beginPath(); g.moveTo(-2, by - 8); g.lineTo(-2 + walk * 3, by); g.moveTo(2, by - 8); g.lineTo(2 - walk * 3, by); g.stroke(); }
    // body
    const bodyCol = u.def.cls === 'villager' ? U.mix(col.main, '#9a8a70', 0.45) : col.main;
    g.fillStyle = bodyCol; g.beginPath(); g.roundRect(-4.5, by - 18, 9, 11, 3); g.fill();
    g.fillStyle = U.alpha('#000', 0.15); g.fillRect(-4.5, by - 10, 9, 3);
    if (u.def.cls === 'infantry' || u.def.cls === 'cavalry') { g.fillStyle = U.shade(col.dark, -0.1); g.fillRect(-4.5, by - 18, 9, 2.5); }
    // arms
    const swing = u.swing > 0 ? Math.sin((0.3 - u.swing) / 0.3 * Math.PI) : 0;
    g.strokeStyle = skin; g.lineWidth = 2; g.beginPath(); g.moveTo(3.5, by - 16); g.lineTo(6 + swing * 3, by - 10 - swing * 6); g.stroke();
    // head
    this.ell(0, by - 21.5, 3.8, 4, skin);
    // hat / helmet by class and age
    const age = p.age;
    if (u.def.cls === 'villager') { g.fillStyle = '#b89a4d'; g.beginPath(); g.ellipse(0, by - 23.5, 6, 2, 0, 0, 7); g.fill(); this.ell(0, by - 24.5, 3.6, 2.2, '#c9ab5d'); }
    else if (u.def.cls === 'archer') { g.fillStyle = age >= 2 ? '#8a8a90' : '#5a7a3a'; g.beginPath(); g.moveTo(-4, by - 22); g.lineTo(0, by - 29); g.lineTo(4, by - 22); g.closePath(); g.fill(); }
    else { g.fillStyle = age >= 2 ? '#b8bcc4' : age >= 1 ? '#8a7a5a' : '#6a5a4a'; g.beginPath(); g.arc(0, by - 22.5, 4.3, Math.PI, 0); g.fill(); if (age >= 3) { g.fillStyle = col.light; g.fillRect(-0.8, by - 30, 1.6, 4); } }
    // weapon
    g.lineCap = 'round';
    if (u.type === 'villager') {
      if (u.carry.amt > 0) { const c = RESOURCE_INFO[u.carry.kind].color; g.fillStyle = c; g.beginPath(); g.roundRect(-9, by - 19, 6, 7, 2); g.fill(); }
      g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(6 + swing * 3, by - 10 - swing * 6); g.lineTo(8 + swing * 3, by - 20 - swing * 5); g.stroke(); g.fillStyle = '#8a8a90'; g.fillRect(6.5 + swing * 3, by - 22 - swing * 5, 4, 3);
    } else if (u.type === 'spearman') { g.strokeStyle = '#7a5a3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(6, by - 2); g.lineTo(9 + swing * 6, by - 28 - swing * 2); g.stroke(); g.fillStyle = '#c8ccd4'; this.poly([[8 + swing * 6, by - 27 - swing * 2], [10 + swing * 6, by - 33 - swing * 2], [12 + swing * 6, by - 27 - swing * 2]], '#c8ccd4'); this.ell(-6.5, by - 12, 3.5, 4.5, col.dark, '#3a2a1a'); }
    else if (u.type === 'swordsman' || u.type === 'knight') { g.strokeStyle = '#d0d4dc'; g.lineWidth = 2; g.beginPath(); g.moveTo(6 + swing * 3, by - 10 - swing * 6); g.lineTo(12 + swing * 6, by - 22 - swing * 4); g.stroke(); g.strokeStyle = '#6a4a2a'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(5 + swing * 3, by - 12 - swing * 6); g.lineTo(8 + swing * 3, by - 11 - swing * 6); g.stroke(); this.ell(-6.5, by - 12, 4.2, 5, col.dark, age >= 2 ? '#c8ccd4' : '#3a2a1a'); }
    else if (u.type === 'horseman') { g.strokeStyle = '#7a5a3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(6, by - 4); g.lineTo(12 + swing * 6, by - 26); g.stroke(); this.poly([[11 + swing * 6, by - 25], [13 + swing * 6, by - 31], [15 + swing * 6, by - 25]], '#c8ccd4'); }
    else if (u.def.cls === 'archer') { g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.8; g.beginPath(); g.arc(7, by - 14, 8, -Math.PI * 0.55, Math.PI * 0.55); g.stroke(); g.strokeStyle = '#d8d0c0'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(7 + 8 * Math.cos(-Math.PI * 0.55), by - 14 + 8 * Math.sin(-Math.PI * 0.55)); g.lineTo(7 + 8 * Math.cos(Math.PI * 0.55), by - 14 + 8 * Math.sin(Math.PI * 0.55)); g.stroke(); g.fillStyle = '#7a5a3a'; g.fillRect(-7, by - 20, 3, 9); }
    g.restore();
    const [sx, sy] = this.toScreen(u.x, u.y, 0); u.sx = sx; u.sy = sy; u.sh = (u.def.cls === 'cavalry' ? 38 : u.def.cls === 'siege' ? 26 : 30) * this.cam.zoom;
  },
  horse(x, y, col, k, walk) {
    const g = this.g;
    g.strokeStyle = U.shade(col, -0.2); g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - 7, y - 8); g.lineTo(x - 7 + walk * 3, y); g.moveTo(x - 4, y - 8); g.lineTo(x - 4 - walk * 3, y); g.moveTo(x + 5, y - 8); g.lineTo(x + 5 - walk * 3, y); g.moveTo(x + 8, y - 8); g.lineTo(x + 8 + walk * 3, y); g.stroke();
    this.ell(x, y - 12, 11 * k, 5.5 * k, col);
    g.fillStyle = col; g.beginPath(); g.moveTo(x + 8, y - 14); g.lineTo(x + 14, y - 22); g.lineTo(x + 18, y - 19); g.lineTo(x + 12, y - 12); g.closePath(); g.fill();
    this.ell(x + 16, y - 20, 3.5, 2.6, col);
    g.strokeStyle = U.shade(col, -0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(x + 9, y - 17); g.quadraticCurveTo(x + 12, y - 23, x + 15, y - 22); g.stroke();
    g.beginPath(); g.moveTo(x - 10, y - 13); g.quadraticCurveTo(x - 15, y - 10, x - 13, y - 3); g.stroke();
  },
  catapult(u, col) {
    const g = this.g;
    g.fillStyle = '#6a4a2a'; g.fillRect(-13, -9, 26, 5);
    this.ell(-8, -3, 4.5, 4.5, '#5a3f22', '#3a2a1a'); this.ell(8, -3, 4.5, 4.5, '#5a3f22', '#3a2a1a');
    g.strokeStyle = '#7a5a3a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-6, -9); g.lineTo(0, -20); g.lineTo(6, -9); g.stroke();
    const a = u.swing > 0 ? -1.2 + (0.3 - u.swing) / 0.3 * 1.4 : 0.2;
    g.save(); g.translate(0, -14); g.rotate(a); g.strokeStyle = '#8a6a3a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -4); g.stroke(); this.ell(-18, -4, 3.5, 3.5, '#6a6a70'); g.restore();
    g.fillStyle = col.main; g.fillRect(9, -18, 2, 9); this.poly([[11, -18], [17, -16], [11, -13]], col.main);
    const [sx, sy] = this.toScreen(u.x, u.y, 0); u.sx = sx; u.sy = sy; u.sh = 26 * this.cam.zoom;
  },

  drawUnitBar(u) {
    const g = this.g, [sx, sy] = this.toScreen(u.x, u.y, 0), z = this.cam.zoom;
    const w = 18 * z, h = Math.max(2, 3 * z), y = sy - (u.def.cls === 'cavalry' ? 40 : 34) * z;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(sx - w / 2 - 1, y - 1, w + 2, h + 2);
    const f = u.hp / u.maxHp; g.fillStyle = f > 0.5 ? '#6fbf6a' : f > 0.25 ? '#e0b040' : '#d8484a'; g.fillRect(sx - w / 2, y, w * f, h);
  },
  drawBuildingBar(b) {
    const g = this.g, z = this.cam.zoom, [sx, sy] = this.toScreen(b.x, b.y - b.size / 2, this.height(b) + 22);
    const w = (24 + b.size * 10) * z, h = Math.max(2, 4 * z);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
    if (!b.built) { g.fillStyle = '#e8c46a'; g.fillRect(sx - w / 2, sy, w * b.progress, h); }
    else { const f = b.hp / b.maxHp; g.fillStyle = f > 0.5 ? '#6fbf6a' : f > 0.25 ? '#e0b040' : '#d8484a'; g.fillRect(sx - w / 2, sy, w * f, h); }
  },
  drawRally(b) {
    const g = this.g, r = b.rally, [sx, sy] = this.toScreen(r.x, r.y, 0), z = this.cam.zoom;
    g.strokeStyle = '#e8c46a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 18 * z); g.stroke();
    this.poly([[sx, sy - 18 * z], [sx + 10 * z, sy - 15 * z], [sx, sy - 11 * z]], Game.players[b.owner].color.main);
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(232,196,106,0.5)'; const [bx, by] = this.toScreen(b.x, b.y, 0); g.beginPath(); g.moveTo(bx, by); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
  },

  /* ---- effects ---- */
  drawEffect(e) {
    const g = this.g;
    if (e.kind === 'arrow' || e.kind === 'stone') {
      const t = e.t / e.dur, x = U.lerp(e.x0, e.x1, t), y = U.lerp(e.y0, e.y1, t);
      const arc = Math.sin(t * Math.PI) * (e.kind === 'stone' ? 40 : 14) + U.lerp(e.z0 || 14, 10, t);
      this.at(x, y, arc);
      if (e.kind === 'stone') { this.ell(0, 0, 4, 4, '#6a6a70', '#3a3a40'); }
      else { const [ax, ay] = this.toScreen(e.x0, e.y0, 0), [bx, by] = this.toScreen(e.x1, e.y1, 0); const ang = Math.atan2(by - ay, bx - ax) - (t < 0.5 ? 0.35 : -0.35); g.rotate(ang); g.strokeStyle = '#e8dcc4'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.stroke(); this.poly([[6, 0], [3, -2], [3, 2]], '#c8ccd4'); }
    } else if (e.kind === 'hit') {
      this.at(e.x, e.y, 14); const t = e.t / e.dur; g.globalAlpha = 1 - t; g.strokeStyle = '#ffe9a0'; g.lineWidth = 1.5; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k * 1.26 + e.seed; g.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); g.lineTo(Math.cos(a) * (6 + t * 8), Math.sin(a) * (6 + t * 8)); } g.stroke(); g.globalAlpha = 1;
    } else if (e.kind === 'corpse') {
      this.at(e.x, e.y, 0); const t = e.t / e.dur; g.globalAlpha = Math.min(1, (1 - t) * 3); this.ell(0, 0, e.cls === 'cavalry' ? 14 : 9, 4, U.alpha(e.color, 0.8)); this.ell(e.cls === 'cavalry' ? 10 : 7, -1, 3, 3, '#d9a678'); g.globalAlpha = 1;
    } else if (e.kind === 'rubble') {
      this.at(e.x, e.y, 0); const t = e.t / e.dur; g.globalAlpha = Math.min(1, (1 - t) * 2.5); const s = e.size * 20;
      this.poly([[-s, 0], [-s * 0.3, -s * 0.35], [s * 0.4, -s * 0.2], [s, 0], [s * 0.3, s * 0.4], [-s * 0.5, s * 0.4]], '#5a5550'); this.poly([[-s * 0.6, -s * 0.1], [-s * 0.2, -s * 0.5], [s * 0.2, -s * 0.3], [0, s * 0.05]], '#7a736a'); this.poly([[s * 0.2, -s * 0.1], [s * 0.5, -s * 0.4], [s * 0.7, -s * 0.05]], '#6a635a');
      if (t < 0.15) for (let k = 0; k < 4; k++) this.ell(k * 8 - 12, -10 - t * 120, 10 + t * 30, 6 + t * 20, `rgba(160,150,140,${0.5 * (1 - t / 0.15)})`);
      g.globalAlpha = 1;
    } else if (e.kind === 'text') {
      const [sx, sy] = this.toScreen(e.x, e.y, 30); const t = e.t / e.dur; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.globalAlpha = 1 - t; g.fillStyle = e.color || '#e8c46a'; g.font = `bold ${13 * this.cam.zoom}px Palatino, Georgia, serif`; g.textAlign = 'center'; g.fillText(e.text, sx, sy - t * 30); g.globalAlpha = 1;
    } else if (e.kind === 'ping') {
      const [sx, sy] = this.toScreen(e.x, e.y, 0); const t = e.t / e.dur; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.strokeStyle = U.alpha(e.color || '#e8c46a', 1 - t); g.lineWidth = 2; g.beginPath(); g.ellipse(sx, sy, (10 + t * 40) * this.cam.zoom, (5 + t * 20) * this.cam.zoom, 0, 0, 7); g.stroke();
    }
  },

  /* ---- minimap: a diamond of the whole map with entities and the camera frame ---- */
  drawMinimap() {
    const mg = this.mg, mc = this.mini, w = World.w, h = World.h;
    const size = mc.clientWidth || 180; if (mc.width !== size * 2) { mc.width = size * 2; mc.height = size * 2; }
    const S = mc.width;
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, S, S);
    mg.fillStyle = '#0e0b12'; mg.fillRect(0, 0, S, S);
    if (this.fogDirty && !Game.settings.reveal) this.updateFogTex();
    // diamond transform: world (x, y) -> minimap
    const k = S / (w + h);
    const tf = () => { mg.setTransform(k, k * 0.5, -k, k * 0.5, S / 2, 0); };
    tf(); mg.imageSmoothingEnabled = false; mg.drawImage(this.miniTerrain, 0, 0);
    // resources
    for (const r of World.res) { if (!World.explored[World.idx(r.x, r.y)] && !Game.settings.reveal) continue; mg.fillStyle = r.kind === 'tree' ? World.T.canopyDark : r.kind === 'gold' ? '#e0b43c' : r.kind === 'stone' ? '#b8bcc4' : '#d0405c'; mg.fillRect(r.x, r.y, 1, 1); }
    for (const b of Game.buildings) { if (b.dead) continue; if (!Game.settings.reveal && !World.explored[World.idx(b.tx, b.ty)]) continue; mg.fillStyle = Game.players[b.owner].color.main; mg.fillRect(b.tx - 0.3, b.ty - 0.3, b.size + 0.6, b.size + 0.6); }
    for (const u of Game.units) { if (u.dead) continue; if (u.owner !== Game.human && !Game.settings.reveal && !World.visible[World.idx(Math.floor(u.x), Math.floor(u.y))]) continue; mg.fillStyle = Game.players[u.owner].color.light; mg.fillRect(u.x - 0.7, u.y - 0.7, 1.4, 1.4); }
    if (!Game.settings.reveal) mg.drawImage(this.miniFog, 0, 0);
    for (const e of Game.effects) if (e.kind === 'ping') { mg.strokeStyle = e.color || '#e8c46a'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(e.x, e.y, 3 + (e.t / e.dur) * 4, 0, 7); mg.stroke(); }
    // camera frame
    const c = [this.toWorld(0, 0), this.toWorld(this.W, 0), this.toWorld(this.W, this.H), this.toWorld(0, this.H)];
    mg.strokeStyle = 'rgba(232,196,106,0.9)'; mg.lineWidth = 1.2; mg.beginPath(); mg.moveTo(c[0][0], c[0][1]); for (const q of c.slice(1)) mg.lineTo(q[0], q[1]); mg.closePath(); mg.stroke();
    mg.setTransform(1, 0, 0, 1, 0, 0);
  },
  miniToWorld(px, py) {
    const S = this.mini.width, w = World.w, h = World.h, k = S / (w + h);
    const dpr = S / (this.mini.clientWidth || 180);
    px *= dpr; py *= dpr;
    // invert: X = k*x - k*y + S/2 ; Y = 0.5k*x + 0.5k*y
    const a = (px - S / 2) / k, b = py / (0.5 * k);
    return [(a + b) / 2, (b - a) / 2];
  },

  /* ---- picking ---- */
  pickUnit(sx, sy, filter) {
    let best = null, bd = Infinity;
    const z = this.cam.zoom;
    for (const u of Game.units) {
      if (u.dead || u.sx == null || (filter && !filter(u))) continue;
      if (u.owner !== Game.human && !World.visible[World.idx(Math.floor(u.x), Math.floor(u.y))] && !Game.settings.reveal) continue;
      const dx = Math.abs(sx - u.sx), dy = sy - (u.sy - u.sh / 2);
      if (dx < 12 * z && Math.abs(dy) < u.sh / 2 + 4 * z) { const d = dx + Math.abs(dy) * 0.5; if (d < bd) { bd = d; best = u; } }
    }
    return best;
  },
  /* Buildings are picked through their footprint, extended upwards by wall height. */
  pickBuilding(sx, sy) {
    const z = this.cam.zoom;
    for (let dz = 0; dz <= 60; dz += 12) {
      const [wx, wy] = this.toWorld(sx, sy + dz * z);
      const tx = Math.floor(wx), ty = Math.floor(wy);
      if (!World.inBounds(tx, ty)) continue;
      const b = World.bld[World.idx(tx, ty)];
      if (b && !b.dead && (World.explored[World.idx(tx, ty)] || Game.settings.reveal) && dz <= this.height(b) + 20) return b;
    }
    return null;
  },
  pickResource(sx, sy) {
    for (let dz = 0; dz <= 30; dz += 10) {
      const [wx, wy] = this.toWorld(sx, sy + dz * this.cam.zoom);
      const tx = Math.floor(wx), ty = Math.floor(wy);
      if (!World.inBounds(tx, ty)) continue;
      const r = World.resAt[World.idx(tx, ty)];
      if (r && World.explored[World.idx(tx, ty)]) return r;
    }
    return null;
  },
  /* Render an icon of a unit or building into a small canvas (for the command panel). */
  icon(kind, type, owner, size) {
    const cv = document.createElement('canvas'); cv.width = size * 2; cv.height = size * 2; cv.style.width = cv.style.height = size + 'px';
    const saveG = this.g, saveCam = { ...this.cam }, saveW = this.W, saveH = this.H, saveDpr = this.dpr;
    this.g = cv.getContext('2d'); this.dpr = 2; this.W = size; this.H = size;
    const p = Game.players[owner] || Game.players[0];
    if (kind === 'unit') {
      const def = UNITS[type]; this.cam = { x: 0, y: 0, zoom: def.cls === 'siege' ? 1.1 : 1.15 }; this.W = size; this.H = size * 1.55;
      const fake = { id: 1, type, def, owner, x: 0, y: 0, face: 0.6, moving: false, anim: 0, swing: 0, carry: { amt: 0 }, hp: 1, maxHp: 1 };
      this.drawUnit(fake);
    } else {
      const def = BUILDINGS[type]; const s = def.size; const z = size / (s * 64 + 30) * 1.15;
      this.cam = { x: s / 2, y: s / 2 - (this.height({ size: s, def }) + 10) / 32 * 0.5, zoom: z }; this.H = size * 1.1;
      const fake = { tx: 0, ty: 0, size: s, x: s / 2, y: s / 2, def, type, built: true, worker: { dead: false }, owner, ageVisual: p.age, hp: 1, maxHp: 1, progress: 1 };
      this.drawBuilding(fake);
    }
    this.g = saveG; this.cam = saveCam; this.W = saveW; this.H = saveH; this.dpr = saveDpr;
    return cv;
  },
};
