/* Isometric renderer. Everything is drawn with canvas paths from palettes: no bitmaps, no pixel art.
   World tile (x, y) at height z projects to screen ((x - y) * 32, (x + y) * 16 - z) at zoom 1. */
/* Rendered sprites, kept per kind (units, buildings, resources) and evicted least-recently-used first, so a busy
   screen never throws the whole cache away and redraws everything in one frame. */
class SpriteCache {
  constructor(caps) { this.caps = caps; this.maps = {}; for (const k in caps) this.maps[k] = new Map(); }
  map(key) { return this.maps[key[0] === 'u' && key[1] === '|' ? 'u' : key[0] === 'b' && key[1] === '|' ? 'b' : 'r']; }
  get(key) { const m = this.map(key), sp = m.get(key); if (sp) { m.delete(key); m.set(key, sp); } return sp; }
  set(key, sp) {
    Renderer.spritesMade = (Renderer.spritesMade || 0) + 1;
    const m = this.map(key); m.set(key, sp);
    const cap = this.caps[key[0] === 'u' && key[1] === '|' ? 'u' : key[0] === 'b' && key[1] === '|' ? 'b' : 'r'];
    if (m.size > cap) { const it = m.keys(); for (let i = Math.ceil(cap * 0.1); i > 0; i--) { const k = it.next().value, old = m.get(k); m.delete(k); } }
  }
  get size() { let n = 0; for (const k in this.maps) n += this.maps[k].size; return n; }
  clear() { for (const k in this.maps) this.maps[k].clear(); }
}
const newSprites = () => new SpriteCache({ u: 1600, b: 260, r: 500 });

const Renderer = {
  canvas: null, g: null, W: 0, H: 0, dpr: 1,
  cam: { x: 0, y: 0, zoom: 1 }, ZOOMS: [0.45, 0.56, 0.7, 0.85, 1, 1.25, 1.55, 1.9], minZoom: 0.45, maxZoom: 1.9,
  time: 0, hover: null, hoverRes: null, ghost: null, selBox: null,
  tileColor: null, tileDeco: null, terrainTex: null, fogTex: null, fogDirty: true, sprites: newSprites(), view: null,
  mini: null, mg: null, miniTerrain: null, miniFog: null, miniT: 0,

  init(canvas, mini) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    try { const q = localStorage.getItem('anvil-gfx'); if (q === 'sharp' || q === 'fast' || q === 'auto') this.quality = q; } catch (e) {}
    this.mini = mini; this.mg = mini.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const mark = () => { this.dirty = true; };
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'keydown']) window.addEventListener(ev, mark, { passive: true, capture: true });
  },
  /* Graphics quality: 'sharp' draws at the screen's full pixel density (up to 2x); 'fast' at one pixel per CSS pixel;
     'auto' keeps the canvas under about 2.4 million pixels, which a big tablet at 2x would otherwise quadruple. Sprites
     are drawn chunky on purpose, so a little under native density costs almost nothing to the eye. */
  quality: 'auto', PIXEL_BUDGET: 2.4e6, debugOff: 0, dirty: true,
  setQuality(q) { this.quality = q; try { localStorage.setItem('anvil-gfx', q); } catch (e) {} this.resize(); },
  resize() {
    this.W = this.canvas.clientWidth; this.H = this.canvas.clientHeight;
    const native = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = this.quality === 'fast' ? 1 : this.quality === 'sharp' ? native : Math.max(1, Math.min(native, Math.sqrt(this.PIXEL_BUDGET / Math.max(1, this.W * this.H))));
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
  },
  /* Precompute per-tile colours and paint the whole ground into one texture (TP px per tile).
     Drawing it with the isometric affine transform maps each square tile onto its diamond exactly,
     so the entire terrain costs a single drawImage per frame. */
  TP: 16,
  prepareMap() {
    const w = World.w, h = World.h, T = World.T, n = w * h;
    const TP = this.TP = w >= 112 ? 12 : w >= 88 ? 16 : 20;
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
      this.tileDeco[i] = t === 0 ? (hsh % 14 === 0 ? 1 : hsh % 29 === 0 ? 2 : 0) : 0;
    }
    // ground texture. Colours are computed per texel from smooth fields (shade, dirt, a bilinear land/water
    // mask with noisy edges) so coastlines and dirt fade instead of following tile diamonds.
    this.terrainVer++;
    const tex = this.terrainTex = document.createElement('canvas'); tex.width = w * TP; tex.height = h * TP;
    const tg = tex.getContext('2d');
    const img = tg.createImageData(w * TP, h * TP), d = img.data;
    const nDirt = RNG.noise(Game.seed + 77, 5), nFine = RNG.noise(Game.seed + 91, 1.7), nShade = RNG.noise(Game.seed + 23, 6);
    const dirt = T.dirt ? U.hex(T.dirt) : null, W = w * TP, ground = T.ground.map(U.hex), sand = U.hex(T.shore), sandDark = U.hex(T.shoreDark);
    const waterDeep = U.hex(T.waterDeep), waterMid = U.hex(T.water), waterShallow = U.mix(T.water, T.waterLight, 0.55), waterSh = U.hex(waterShallow);
    const mask = new Float32Array(n); for (let i = 0; i < n; i++) mask[i] = World.tiles[i] === 1 ? 1 : 0;
    const wet = (fx, fy) => { // bilinear sample of the water mask at tile centres
      const gx = U.clamp(fx - 0.5, 0, w - 1.001), gy = U.clamp(fy - 0.5, 0, h - 1.001), x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      return (mask[y0 * w + x0] * (1 - tx) + mask[y0 * w + x1] * tx) * (1 - ty) + (mask[y1 * w + x0] * (1 - tx) + mask[y1 * w + x1] * tx) * ty;
    };
    this.wetAt = wet;
    let seed = (Game.seed ^ 0xabcdef) >>> 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let py = 0; py < TP; py++) for (let px = 0; px < TP; px++) {
        const fx = x + (px + 0.5) / TP, fy = y + (py + 0.5) / TP;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const grain = ((seed >>> 16) % 13) - 6;
        const fine = nFine(fx, fy, 2) - 0.5;
        const wv = wet(fx, fy) + fine * 0.22;
        let r, g, b;
        if (wv > 0.5) {
          const depth = U.clamp((wv - 0.5) / 0.35, 0, 1);
          const c0 = depth < 0.5 ? waterSh : waterMid, c1 = depth < 0.5 ? waterMid : waterDeep, f = depth < 0.5 ? depth * 2 : (depth - 0.5) * 2;
          r = c0[0] + (c1[0] - c0[0]) * f; g = c0[1] + (c1[1] - c0[1]) * f; b = c0[2] + (c1[2] - c0[2]) * f;
          r += fine * 14; g += fine * 14; b += fine * 10;
        } else {
          const sh = nShade(fx, fy, 3);
          const kk = U.clamp(sh, 0, 0.999) * (ground.length - 1), i0 = Math.floor(kk), f = kk - i0, c0 = ground[i0], c1 = ground[Math.min(ground.length - 1, i0 + 1)];
          r = c0[0] + (c1[0] - c0[0]) * f; g = c0[1] + (c1[1] - c0[1]) * f; b = c0[2] + (c1[2] - c0[2]) * f;
          if (dirt) { const dv = U.clamp((nDirt(fx, fy, 3) - 0.56) * 5, 0, 0.8); if (dv > 0) { r += (dirt[0] - r) * dv; g += (dirt[1] - g) * dv; b += (dirt[2] - b) * dv; } }
          const sf = U.clamp((wv - 0.16) / 0.3, 0, 1); // beach fades in towards the water
          if (sf > 0) { const sc = fine > 0.1 ? sandDark : sand; r += (sc[0] - r) * sf; g += (sc[1] - g) * sf; b += (sc[2] - b) * sf; }
          r += fine * 22; g += fine * 22; b += fine * 16;
        }
        const o = ((y * TP + py) * W + (x * TP + px)) * 4;
        d[o] = U.clamp(Math.round((r + grain) / 4) * 4, 0, 255); d[o + 1] = U.clamp(Math.round((g + grain) / 4) * 4, 0, 255); d[o + 2] = U.clamp(Math.round((b + grain) / 4) * 4, 0, 255); d[o + 3] = 255;
      }
    }
    tg.putImageData(img, 0, 0);
    // sparse ground detail: tufts and pebbles, painted after the fact
    for (let i = 0; i < n; i++) {
      const x = i % w, y = Math.floor(i / w), t = World.tiles[i], c = this.tileColor[i];
      if (t !== 0) continue;
      const dd = this.tileDeco[i];
      if (dd === 1) { tg.fillStyle = U.alpha(U.shade(c, -0.22), 0.7); for (let k = -1; k <= 1; k++) tg.fillRect(x * TP + TP / 2 + k * 3 + Math.floor(rng() * 3), y * TP + TP / 2 - 2 + Math.floor(rng() * 4), 1, 4); }
      else if (dd === 2) { tg.fillStyle = T.id === 'tundra' ? '#b8c4cb' : ['#d6be6a', '#cfd2d5', '#b87a92'][(x + y) % 3]; tg.fillRect(x * TP + 5, y * TP + 6, 2, 2); tg.fillRect(x * TP + 11, y * TP + 11, 2, 2); }
    }
    // screen-space film grain, tiled over the ground each frame
    const gp = document.createElement('canvas'); gp.width = gp.height = 128; const gg = gp.getContext('2d'); const gi = gg.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) { const o = i * 4; const v = Math.random(); gi.data[o] = gi.data[o + 1] = gi.data[o + 2] = v > 0.5 ? 255 : 0; gi.data[o + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 26); }
    gg.putImageData(gi, 0, 0); this.grainPat = this.g.createPattern(gp, 'repeat');
    // minimap terrain
    this.miniTerrain = document.createElement('canvas'); this.miniTerrain.width = w; this.miniTerrain.height = h;
    const mg = this.miniTerrain.getContext('2d');
    for (let i = 0; i < n; i++) { mg.fillStyle = this.tileColor[i]; mg.fillRect(i % w, Math.floor(i / w), 1, 1); }
    this.miniFog = document.createElement('canvas'); this.miniFog.width = w; this.miniFog.height = h;
    this.fogTex = document.createElement('canvas'); this.fogTex.width = w; this.fogTex.height = h;
    this.fogDirty = true; this.miniT = 0; this.sprites = newSprites();
  },
  /* The fog texture: one pixel per tile, drawn with the same transform as the ground, bilinear-smoothed. */
  /* Fog is cached like the ground: it is re-rendered into a screen-sized buffer only when the camera moves or the fog
     itself changes (a few times a second), and simply copied the rest of the time. */
  fogCv: null, fogKey: '', fogVer: 0,
  drawFog(x0, y0, x1, y1) {
    const cw = this.canvas.width, ch = this.canvas.height, key = [this.cam.x, this.cam.y, this.cam.zoom, cw, ch, this.dpr, this.fogVer, x0, y0, x1, y1].join(',');
    if (!this.fogCv || this.fogCv.width !== cw || this.fogCv.height !== ch) { this.fogCv = document.createElement('canvas'); this.fogCv.width = cw; this.fogCv.height = ch; this.fogKey = ''; }
    if (key !== this.fogKey) { const main = this.g, fc = this.g = this.fogCv.getContext('2d'); fc.setTransform(1, 0, 0, 1, 0, 0); fc.clearRect(0, 0, cw, ch); this.drawMapImage(this.fogTex, 1, x0, y0, x1, y1); this.g = main; this.fogKey = key; }
    const g = this.g; g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.fogCv, 0, 0);
  },
  updateFogTex() {
    this.fogVer++;
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
    this.time += dt; this.madeThisFrame = 0;
    const g = this.g, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // visible tile range from the four screen corners
    const c0 = this.toWorld(0, 0), c1 = this.toWorld(this.W, 0), c2 = this.toWorld(0, this.H), c3 = this.toWorld(this.W, this.H);
    const x0 = Math.max(0, Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0])) - 1), x1 = Math.min(World.w - 1, Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1])) - 1), y1 = Math.min(World.h - 1, Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1])) + 3);
    this.view = { x0, y0, x1, y1 };
    const inView = (x, y) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2;
    const reveal = Game.settings.reveal, exp = World.explored, vis = World.visible, noSprites = this.debugOff === 3 || this.debugOff === 4;
    /* Things that never move (trees, rocks, stumps, ferns, finished buildings) are painted once into a cached layer
       with the ground; each frame only draws what moves. Drawing a hundred-odd separate images every frame was what
       held slower tablets to 15 fps. A fingerprint of what is in view tells when the layer must be painted again. */
    const stat = [], dyn = []; let h = 17; const mix = (v) => { h = (Math.imul(h, 31) + (v | 0)) | 0; };
    for (const r of World.res) if (inView(r.x, r.y) && (reveal || exp[World.idx(r.x, r.y)])) { stat.push({ d: r.x + r.y + 1 + r.ox + r.oy, k: 'res', o: r, occ: r.kind === 'tree' }); mix(r.id * 4 + (r.max ? Math.min(2, Math.floor((r.amount / r.max) * 3)) : 0)); }
    for (const r of World.decals) if (inView(r.x, r.y) && (reveal || exp[World.idx(r.x, r.y)])) { stat.push({ d: r.x + r.y + 0.3, k: 'res', o: r }); mix(r.x * 977 + r.y); }
    for (const b of Game.buildings) {
      if (b.dead || !inView(b.x, b.y)) continue; if (!reveal && !exp[World.idx(b.tx, b.ty)] && !exp[World.idx(b.tx + b.size - 1, b.ty + b.size - 1)]) continue;
      const d = b.def.passable ? b.tx + b.ty - 0.5 : b.tx + b.ty + b.size;
      if (!b.built) { dyn.push({ d, k: 'bld', o: b }); continue; }
      stat.push({ d, k: 'bld', o: b, occ: !b.def.passable });
      mix(b.id); mix(b.ageVisual); mix(b.owner); mix(b.def.farm && b.worker && !b.worker.dead ? 1 : 0); mix(b.def.wall ? World.wallMask(b) : 0);
      dyn.push({ d: d + 0.001, k: 'live', o: b });
    }
    mix(stat.length);
    const cw = this.canvas.width, ch = this.canvas.height;
    const skey = [this.cam.x, this.cam.y, this.cam.zoom, cw, ch, dpr, this.terrainVer, x0, y0, x1, y1, h, this.debugOff].join(',');
    if (!this.staticCv || this.staticCv.width !== cw || this.staticCv.height !== ch) { this.staticCv = document.createElement('canvas'); this.staticCv.width = cw; this.staticCv.height = ch; this.staticKey = ''; }
    if (skey !== this.staticKey) { this.paintStatic(stat, x0, y0, x1, y1, noSprites); this.staticKey = skey; this.staticPaints++; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.staticCv, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.debugOff !== 2 && this.debugOff !== 4) this.drawRipples(x0, y0, x1, y1);
    // what moves
    for (const u of Game.units) { if (u.dead || !inView(u.x, u.y)) continue; if (u.owner !== Game.human && !reveal && !vis[World.idx(Math.floor(u.x), Math.floor(u.y))]) { u.sx = null; continue; } dyn.push({ d: u.x + u.y, k: 'unit', o: u }); }
    for (const e of Game.effects) { const ex = e.x != null ? e.x : U.lerp(e.x0, e.x1, e.t / e.dur), ey = e.y != null ? e.y : U.lerp(e.y0, e.y1, e.t / e.dur); if (inView(ex, ey)) dyn.push({ d: ex + ey + (e.kind === 'corpse' || e.kind === 'rubble' ? -0.4 : 0.6), k: 'fx', o: e }); }
    if (this.ghost) dyn.push({ d: this.ghost.tx + this.ghost.ty + this.ghost.def.size, k: 'ghost', o: this.ghost });
    for (const r of [Game.selectedRes, this.hoverRes]) if (r && !r.removed && inView(r.x, r.y)) dyn.push({ d: r.x + r.y + 1 + r.ox + r.oy + 0.001, k: 'hl', o: r });
    // a tree or building standing in front of someone is drawn again over them, clipped to their outline
    const z = this.cam.zoom;
    for (const it of dyn) {
      if (it.k !== 'unit') continue;
      const u = it.o, [sx, sy] = this.toScreen(u.x, u.y, 0), hw = (u.def.naval ? 34 : u.def.cls === 'cavalry' || u.def.cls === 'siege' ? 22 : 14) * z, top = sy - (u.def.naval ? 50 : u.def.cls === 'cavalry' ? 52 : 42) * z, bot = sy + 6 * z;
      const seen = new Set();
      for (const s of this.occludersNear(sx - hw, top, sx + hw, bot)) {
        if (seen.has(s) || s.d <= it.d) continue; seen.add(s);
        dyn.push({ d: s.d, k: 'occ', o: s, clip: [sx - hw, top, hw * 2, bot - top] });
      }
    }
    dyn.sort((a, b) => a.d - b.d || (a.k === 'fx' ? -1 : 0));
    // selection rings first so they sit under feet
    for (const u of Game.selection) if (u.kind === 'unit' && !u.dead) this.drawRing(u);
    if (!noSprites) for (const it of dyn) {
      if (it.k === 'bld') this.drawBuilding(it.o);
      else if (it.k === 'live') this.drawBuilding(it.o, 'live');
      else if (it.k === 'unit') this.drawUnit(it.o);
      else if (it.k === 'fx') this.drawEffect(it.o);
      else if (it.k === 'ghost') this.drawGhost(it.o);
      else if (it.k === 'hl') this.drawResource(it.o, 'hl');
      else if (it.k === 'occ') this.stampPart(it.o.sp, it.o.sx, it.o.sy, it.clip);
    }
    // your own people show through whatever hides them, as a faint silhouette
    for (const u of Game.units) if (!u.dead && u.owner === Game.human && u.spr && u.sx != null && inView(u.x, u.y) && this.occluded(u)) { g.globalAlpha = 0.5; this.stamp(u.spr, u.sx, u.sy); g.globalAlpha = 1; }
    // fog of war over everything in the world, then interface overlays on top
    if (!reveal && this.debugOff !== 1 && this.debugOff !== 4) { if (this.fogDirty) this.updateFogTex(); this.drawFog(x0, y0, x1, y1); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of Game.buildings) if (!b.dead && inView(b.x, b.y) && (Game.selection.includes(b) || b.hp < b.maxHp || !b.built) && (reveal || exp[World.idx(b.tx, b.ty)])) this.drawBuildingBar(b);
    for (const u of Game.units) if (!u.dead && u.sx != null && inView(u.x, u.y) && (Game.selection.includes(u) || (u.hp < u.maxHp && Game.time - (u.lastHit || -99) < 6))) this.drawUnitBar(u);
    for (const b of Game.selection) if (b.kind === 'building' && b.rally && b.owner === Game.human) this.drawRally(b);
    if (this.selBox) { const bx = this.selBox; g.strokeStyle = 'rgba(232,196,106,0.9)'; g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(bx.x0 + 0.5, bx.y0 + 0.5, bx.x1 - bx.x0, bx.y1 - bx.y0); g.setLineDash([]); g.fillStyle = 'rgba(232,196,106,0.08)'; g.fillRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0); }
    // the carved frame round the edge of the screen
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineWidth = 1;
    for (const [inset, col] of [[0.5, '#000'], [1.5, '#000'], [2.5, '#3a3040'], [3.5, '#000']]) { g.strokeStyle = col; g.strokeRect(inset, inset, this.W - inset * 2, this.H - inset * 2); }
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.4; this.drawMinimap(); }
  },
  staticCv: null, staticKey: '', occGrid: null, stamps: 0, staticPaints: 0, madeThisFrame: 0,
  paintStatic(stat, x0, y0, x1, y1, noSprites) {
    const main = this.g, sg = this.g = this.staticCv.getContext('2d'), dpr = this.dpr, cw = this.staticCv.width, ch = this.staticCv.height;
    if (this.debugOff === 2 || this.debugOff === 4) { sg.setTransform(1, 0, 0, 1, 0, 0); sg.fillStyle = '#0b0a10'; sg.fillRect(0, 0, cw, ch); sg.setTransform(dpr, 0, 0, dpr, 0, 0); }
    else this.drawGround(x0, y0, x1, y1);
    stat.sort((a, b) => a.d - b.d);
    // screen cells (64 px) listing the things that can hide a unit, for the per-frame occlusion test
    const grid = this.occGrid = new Map(), C = 64, z = this.cam.zoom;
    for (const it of stat) {
      const sp = it.k === 'res' ? this.resSprite(it.o) : this.bldSprite(it.o);
      const [sx, sy] = it.k === 'res' ? this.toScreen(it.o.x + 0.5 + (it.o.ox || 0), it.o.y + 0.5 + (it.o.oy || 0), 0) : this.toScreen(it.o.tx, it.o.ty, 0);
      if (!noSprites) this.stamp(sp, sx, sy);
      if (!it.occ) continue;
      it.sp = sp; it.sx = sx; it.sy = sy;
      const l = sx - sp.ax * z, t = sy - sp.ay * z, r = l + sp.w * z, b = t + sp.h * z; it.rect = [l, t, r, b];
      for (let gx = Math.floor(l / C); gx <= Math.floor(r / C); gx++) for (let gy = Math.floor(t / C); gy <= Math.floor(b / C); gy++) { const k = gx * 4096 + gy; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(it); }
    }
    this.g = main;
  },
  *occludersNear(l, t, r, b) {
    const grid = this.occGrid; if (!grid) return; const C = 64;
    for (let gx = Math.floor(l / C); gx <= Math.floor(r / C); gx++) for (let gy = Math.floor(t / C); gy <= Math.floor(b / C); gy++) {
      const a = grid.get(gx * 4096 + gy); if (!a) continue;
      for (const s of a) { const q = s.rect; if (q[0] < r && q[2] > l && q[1] < b && q[3] > t) yield s; }
    }
  },
  /* Draw a per-tile image (`ppt` pixels per tile) so that tile (x, y) lands on its diamond. */
  drawMapImage(img, ppt, x0, y0, x1, y1, smooth) {
    const g = this.g, z = this.cam.zoom, dpr = this.dpr, [ox, oy] = this.toScreen(0, 0, 0);
    g.setTransform(32 * z * dpr, 16 * z * dpr, -32 * z * dpr, 16 * z * dpr, ox * dpr, oy * dpr);
    g.imageSmoothingEnabled = !!smooth;
    const sx = Math.max(0, x0 - 1), sy = Math.max(0, y0 - 1), ex = Math.min(World.w, x1 + 2), ey = Math.min(World.h, y1 + 2);
    g.drawImage(img, sx * ppt, sy * ppt, (ex - sx) * ppt, (ey - sy) * ppt, sx, sy, ex - sx, ey - sy);
  },
  /* The ground (terrain and film grain) only changes when the camera moves, so it is painted into a screen-sized
     buffer and that buffer is copied each frame. Repainting it at full resolution every frame was most of the cost
     of a frame on a big tablet screen. */
  groundCv: null, groundKey: '', terrainVer: 0,
  drawGround(x0, y0, x1, y1) {
    const s = this.cam.zoom, T = World.T, w = World.w, dpr = this.dpr, cw = this.canvas.width, ch = this.canvas.height;
    const key = [this.cam.x, this.cam.y, s, cw, ch, dpr, this.terrainVer, x0, y0, x1, y1].join(',');
    if (!this.groundCv || this.groundCv.width !== cw || this.groundCv.height !== ch) { this.groundCv = document.createElement('canvas'); this.groundCv.width = cw; this.groundCv.height = ch; this.groundKey = ''; }
    if (key !== this.groundKey) {
      const main = this.g, gc = this.g = this.groundCv.getContext('2d');
      gc.setTransform(1, 0, 0, 1, 0, 0); gc.fillStyle = '#0b0a10'; gc.fillRect(0, 0, cw, ch);
      this.drawMapImage(this.terrainTex, this.TP, x0, y0, x1, y1, true);
      // film grain over the whole map area, scrolling with the world
      gc.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = [this.toScreen(0, 0, 0), this.toScreen(w, 0, 0), this.toScreen(w, World.h, 0), this.toScreen(0, World.h, 0)];
      gc.save(); gc.beginPath(); gc.moveTo(c[0][0], c[0][1]); for (const q of c.slice(1)) gc.lineTo(q[0], q[1]); gc.closePath(); gc.clip();
      const ox = ((c[0][0] % 128) + 128) % 128, oy = ((c[0][1] % 128) + 128) % 128;
      gc.translate(ox, oy); gc.fillStyle = this.grainPat; gc.fillRect(-ox - 128, -oy - 128, this.W + 256, this.H + 256);
      gc.restore();
      this.g = main; this.groundKey = key;
    }
    const g = this.g; g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.groundCv, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  },
  /* Moving water, drawn live over the cached layer: light dashes that drift, brighter in the shallows, foam at the
     shoreline. Skipped beside trees and buildings, whose sprites can hang over the water. */
  drawRipples(x0, y0, x1, y1) {
    const g = this.g, s = this.cam.zoom, T = World.T, w = World.w;
    if (s < 0.7) return;
    // moving water: light dashes that drift, brighter and denser in the shallows, foam at the shoreline
    const hw = 32 * s, hh = 16 * s, reveal = Game.settings.reveal, vis = World.visible, tiles = World.tiles;
    const cols = this.rippleCols || (this.rippleCols = [U.alpha(T.waterLight, 0.35), U.alpha(T.waterLight, 0.55), U.alpha('#ffffff', 0.35)]);
    g.lineCap = 'butt'; g.lineWidth = Math.max(1, Math.round(s));
    // one path per colour, stroked once each, rather than a stroke call per ripple
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    let n = 0;
    for (let y = y0; y <= y1 && n < 700; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (tiles[i] !== 1 || !(reveal || vis[i])) continue;
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * w + dx, r = World.resAt[j]; if ((r && r.kind === 'tree') || World.bld[j]) { near = true; break; } }
      if (near) continue;
      const [sx, sy] = this.toScreen(x + 0.5, y + 0.5, 0);
      const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const drift = ((this.time * 6 + (hsh % 64)) % 64) - 32;
      const k = ((hsh >>> 8) % 3), py = sy + ((hsh >>> 4) % 9 - 4) * s;
      paths[k].moveTo(sx + (drift - 14) * s * 0.7, py); paths[k].lineTo(sx + (drift - 14 + 6 + k * 3) * s * 0.7, py); n++;
      if (World.isShallow(x, y) && Math.sin(this.time * 1.5 + hsh % 7) > 0.2) { paths[2].moveTo(sx - 10 * s, sy + 6 * s); paths[2].lineTo(sx + 4 * s, sy + 6 * s); }
    }
    for (let k = 0; k < 3; k++) { g.strokeStyle = cols[k]; g.stroke(paths[k]); }
  },

  /* Set a transform so that (0,0) is the world point and 1 unit = 1 zoom-1 pixel. */
  at(wx, wy, z) { const [sx, sy] = this.toScreen(wx, wy, z || 0); const k = this.dpr * this.cam.zoom; this.g.setTransform(k, 0, 0, k, sx * this.dpr, sy * this.dpr); },
  /* Project a world offset (dx, dy, dz in tiles / px) relative to the current `at` origin. */
  P(dx, dy, dz) { return [(dx - dy) * 32, (dx + dy) * 16 - (dz || 0)]; },
  poly(pts, fill, stroke, lw) { const g = this.g; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); } },
  ell(x, y, rx, ry, fill, stroke) { const g = this.g; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); } },
  /* Light comes from the upper left, so shadows fall to the lower right. */
  castShadow(x, y, len, ry) { const g = this.g; g.fillStyle = this.SHADOW; g.beginPath(); g.ellipse(x + len * 0.45, y + 1, len * 0.7, ry, 0.18, 0, Math.PI * 2); g.fill(); },
  SHADOW: '#010203', // marker colour: oldSchool() turns it into a translucent shadow
  /* Pinch: go to the step nearest the requested zoom (zoomAt always moves a whole step, which made a gentle
     pinch flick back and forth between two steps on every finger movement). */
  zoomTo(target, sx, sy) {
    const Z = this.ZOOMS; let i = 0; for (let k = 0; k < Z.length; k++) if (Math.abs(Math.log(Z[k] / target)) < Math.abs(Math.log(Z[i] / target))) i = k;
    if (Z[i] === this.cam.zoom) return;
    const [wx, wy] = this.toWorld(sx, sy); this.cam.zoom = Z[i];
    const [nx, ny] = this.toWorld(sx, sy); this.cam.x += wx - nx; this.cam.y += wy - ny; this.clampCam();
  },
  shadow(x, y, rx, ry, a) { this.ell(x, y, rx, ry, this.SHADOW); },
  dimIf() { return true; },

  /* ---- natural resources: vector art rendered once per look and zoom step, then stamped ---- */
  drawResource(r, mode) {
    const sp = this.resSprite(r), [sx, sy] = this.toScreen(r.x + 0.5 + (r.ox || 0), r.y + 0.5 + (r.oy || 0), 0);
    if (mode !== 'hl') { this.stamp(sp, sx, sy); if (mode === 'static') return; }
    // picked out under the pointer, and ringed while selected
    const sel = Game.selectedRes === r, hov = this.hoverRes === r;
    if (sel || hov) {
      this.at(r.x + 0.5 + (r.ox || 0), r.y + 0.5 + (r.oy || 0), 0);
      this.g.lineWidth = sel ? 1.6 : 1.2;
      this.ell(0, 1, 13, 6.5, sel ? 'rgba(232,196,106,0.16)' : null, sel ? '#f4e2a0' : 'rgba(244,226,160,0.55)');
      this.stamp(sp, sx, sy, sel ? 0.26 : 0.14);
    }
  },
  resSprite(r) {
    const z = this.cam.zoom, zq = this.zq(z);
    const vq = Math.floor(r.v * 8), lvl = r.max ? Math.min(2, Math.floor((r.amount / r.max) * 3)) : 0;
    const key = r.kind + '|' + vq + '|' + lvl;
    let sp = this.sprites.get(key);
    if (!sp) {
      const k = this.spriteK(zq), W = Math.ceil(128 * k), H = Math.ceil(150 * k), ax = W / 2, ay = H - 20 * k;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
      this.g = cv.getContext('2d', { willReadFrequently: true }); this.dpr = 1; this.cam = { x: 0, y: 0, zoom: k }; this.W = 2 * ax; this.H = 2 * ay;
      const fake = { kind: r.kind, x: -0.5, y: -0.5, ox: 0, oy: 0, v: (vq + 0.5) / 8, amount: (lvl + 0.5) / 3, max: 1 };
      this.drawResourceVector(fake); this.oldSchool(cv);
      this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
      sp = this.pack(cv, ax, ay, k, null, r.kind === 'tree'); this.sprites.set(key, sp);
    }
    return sp;
  },
  /* A small picture of a resource for the selection panel. */
  resPortrait(kind, size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px';
    const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
    const k = kind === 'tree' ? size / 58 : size / 32;
    this.g = cv.getContext('2d', { willReadFrequently: true }); this.dpr = 2; this.cam = { x: 0, y: 0, zoom: k }; this.W = size; this.H = size * 1.75;
    this.drawResourceVector({ kind: kind, x: -0.5, y: -0.5, ox: 0, oy: 0, v: 0.5, amount: 1, max: 1 });
    this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
    return cv;
  },
  drawResourceVector(r) {
    const g = this.g, T = World.T;
    this.at(r.x + 0.5, r.y + 0.5, 0);
    const v = r.v; let seed = Math.floor(v * 1e6) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) / 16777216; };
    const dots = (cx, cy, rx, ry, count, cols) => { for (let i = 0; i < count; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()); g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(Math.round(cx + Math.cos(a) * rx * d), Math.round(cy + Math.sin(a) * ry * d), 1.5, 1.5); } };
    if (r.kind === 'tree') {
      const shape = T.treeShape;
      // every tree is its own height and width so a stand of them reads as a canopy, not a row
      const scale = 0.85 + v * 0.45, tall = ((v * 13) % 1) < 0.3, hgt = (tall ? 78 : 58) * scale;
      const canopy = T.canopy[Math.floor(v * T.canopy.length) % T.canopy.length], light = U.shade(canopy, 0.16), lighter = U.shade(canopy, 0.3), dark = U.shade(canopy, -0.28), darker = U.shade(canopy, -0.5);
      // a broad ground shadow: many of these overlapping is what makes a forest floor dark
      this.castShadow(6, 2, 40 * scale, 11 * scale);
      const leaves = (cx, cy, rx, ry, count, size) => {
        for (let i = 0; i < count; i++) {
          const a = rnd() * Math.PI * 2, dd = Math.pow(rnd(), 0.6), bx = cx + Math.cos(a) * rx * dd, by = cy + Math.sin(a) * ry * dd;
          const lit = -(by - cy) / ry * 0.6 - (bx - cx) / rx * 0.3 + (rnd() - 0.5) * 0.5;
          const col = lit > 0.5 ? lighter : lit > 0.15 ? light : lit > -0.25 ? canopy : lit > -0.55 ? dark : darker;
          const rr = size * (0.6 + rnd() * 0.8);
          this.ell(bx, by, rr, rr * 0.8, col);
        }
      };
      if (shape === 'pine') {
        this.poly([[-2.5, 2], [2.5, 2], [1.5, -hgt - 20], [-1.5, -hgt - 20]], T.trunk);
        const layers = tall ? 7 : 6;
        for (let L = 0; L < layers; L++) {
          const y = -8 - L * (hgt / layers) * 1.05, hw = (26 - L * (22 / layers)) * scale, h = 18 * scale, col = L % 2 ? canopy : dark;
          const pts = [[0, y - h]]; const teeth = 9; for (let t = 0; t <= teeth; t++) { const f = t / teeth; pts.push([U.lerp(hw, -hw, f), y + (t % 2 ? -4 * scale : 0) + (rnd() - 0.5) * 3]); }
          this.poly(pts, col);
          this.poly([[0, y - h], [-hw * 0.55, y - h * 0.3], [-hw * 0.15, y - h * 0.15]], light);
          this.poly([[0, y - h], [hw * 0.6, y - h * 0.25], [hw * 0.2, y - h * 0.05]], darker);
          for (let i = 0; i < 10; i++) { const f = rnd(); g.fillStyle = rnd() < 0.5 ? light : darker; g.fillRect(U.lerp(-hw * 0.9, hw * 0.9, f), y - h * 0.5 * rnd(), 1.5, 2.5); }
        }
      } else if (shape === 'palm') {
        const th = hgt + 10;
        g.strokeStyle = T.trunk; g.lineWidth = 4.5; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(9 * scale, -th * 0.45, 5 * scale, -th); g.stroke();
        g.strokeStyle = U.shade(T.trunk, -0.3); g.lineWidth = 1; for (let k = 0; k < 12; k++) { const t = k / 12; const px = t * 6 * scale, py = -t * th; g.beginPath(); g.moveTo(-2.5 + px, py); g.lineTo(2.5 + px, py - 1); g.stroke(); }
        for (let k = 0; k < 11; k++) { const a = (k / 11) * Math.PI * 2 + v * 3, len = (22 + rnd() * 10) * scale, col = k % 3 === 0 ? light : k % 3 === 1 ? canopy : dark;
          g.save(); g.translate(5 * scale, -th); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); for (let t = 0; t <= 8; t++) { const f = t / 8; g.lineTo(f * len, -(4 * scale) * Math.sin(f * Math.PI) - (t % 2) * 2.5 + f * f * 6); } for (let t = 8; t >= 0; t--) { const f = t / 8; g.lineTo(f * len, (4 * scale) * Math.sin(f * Math.PI) + (t % 2) * 2.5 + f * f * 6); } g.closePath(); g.fill(); g.restore(); }
        g.fillStyle = '#7a5a2a'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(5 * scale + k * 3 - 4, -th + 3, 2.4, 0, 7); g.fill(); }
      } else {
        // broadleaf: trunk, a few limbs, then a crown built entirely from leaf clusters
        const cw = (tall ? 24 : 32) * scale, ch = (tall ? 30 : 26) * scale, cy = -hgt;
        this.poly([[-4.5, 2], [4.5, 2], [3, cy + ch * 0.4], [-3, cy + ch * 0.4]], T.trunk);
        this.poly([[-7, 2], [-3.5, 2], [-2.5, -4]], T.trunk); this.poly([[7, 2], [3.5, 2], [2.5, -4]], T.trunk);
        g.strokeStyle = U.shade(T.trunk, -0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(-1.5, 0); g.lineTo(-1, cy + ch * 0.5); g.moveTo(2, -2); g.lineTo(1.5, cy + ch * 0.55); g.stroke();
        g.strokeStyle = T.trunk; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, cy + ch * 0.4); g.lineTo(-cw * 0.45, cy - ch * 0.1); g.moveTo(0, cy + ch * 0.4); g.lineTo(cw * 0.4, cy - ch * 0.2); g.moveTo(0, cy + ch * 0.3); g.lineTo(cw * 0.1, cy - ch * 0.5); g.stroke();
        this.ell(0, cy + 3, cw * 0.9, ch * 0.9, darker);
        leaves(0, cy, cw, ch, 150, 4.2 * scale);
        // secondary crowns break the outline
        leaves(-cw * 0.55, cy + ch * 0.25, cw * 0.5, ch * 0.45, 40, 3.6 * scale);
        leaves(cw * 0.5, cy + ch * 0.1, cw * 0.5, ch * 0.5, 40, 3.6 * scale);
        leaves(cw * 0.1, cy - ch * 0.55, cw * 0.55, ch * 0.4, 35, 3.4 * scale);
        // fine leaf speckle
        for (let i = 0; i < 90; i++) { const a = rnd() * Math.PI * 2, dd = Math.sqrt(rnd()); g.fillStyle = rnd() < 0.5 ? lighter : darker; g.fillRect(Math.round(Math.cos(a) * cw * dd), Math.round(cy + Math.sin(a) * ch * dd), 1.5, 1.5); }
      }
    } else if (r.kind === 'fern') {
      const col = World.T.bush, light = U.shade(col, 0.3), dark = U.shade(col, -0.3), scale = 0.8 + v * 0.5;
      g.lineWidth = 1.6; g.lineCap = 'round';
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.38 + (rnd() - 0.5) * 0.2, len = (12 + rnd() * 6) * scale; const ex = Math.cos(a) * len, ey = Math.sin(a) * len * 0.8; g.strokeStyle = i % 2 ? light : dark; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(ex * 0.5, ey - 4, ex, ey + 3); g.stroke(); for (let k = 1; k < 5; k++) { const f = k / 5; g.fillStyle = i % 2 ? light : col; g.fillRect(ex * f * 0.9 - 1.5, ey * f - 3 + 1, 3, 1.5); } }
    } else if (r.kind === 'shrub') {
      const col = World.T.bush, light = U.shade(col, 0.25), dark = U.shade(col, -0.35), scale = 0.7 + v * 0.6;
      this.castShadow(1, 2, 12 * scale, 3);
      for (let i = 0; i < 12; i++) { const a = rnd() * Math.PI * 2, dd = Math.sqrt(rnd()), bx = Math.cos(a) * 11 * scale * dd, by = -7 * scale + Math.sin(a) * 6 * scale * dd; this.ell(bx, by, 3.5 * scale, 3 * scale, by < -7 * scale ? light : dd > 0.7 ? dark : col); }
      dots(0, -7 * scale, 10 * scale, 5 * scale, 14, [light, dark]);
    } else if (r.kind === 'stump') {
      this.castShadow(1, 1, 8, 3);
      this.poly([[-4, 2], [4, 2], [3.5, -5], [-3.5, -5]], U.shade(T.trunk, -0.15));
      this.ell(0, -5, 3.5, 1.8, U.shade(T.trunk, 0.45)); g.strokeStyle = U.shade(T.trunk, 0.1); g.lineWidth = 0.8; g.beginPath(); g.ellipse(0, -5, 2, 1, 0, 0, 7); g.stroke();
      g.fillStyle = U.shade(T.trunk, 0.2); g.fillRect(6, 0, 5, 1.5); g.fillRect(-9, 1, 4, 1.5);
    } else if (r.kind === 'stone' || r.kind === 'gold') {
      const gold = r.kind === 'gold';
      const base = gold ? U.mix(T.rock, '#7a6a48', 0.3) : T.rock, dark = gold ? U.mix(T.rockDark, '#5a4a30', 0.3) : T.rockDark, light = U.shade(base, 0.3);
      const k = 0.7 + 0.3 * (r.amount / r.max);
      this.castShadow(4, 5, 24, 7);
      const boulder = (bx, by, w, h) => {
        const pts = []; const nn = 7; for (let i = 0; i < nn; i++) { const a = (i / nn) * Math.PI * 2 + rnd() * 0.4; pts.push([bx + Math.cos(a) * w * (0.8 + rnd() * 0.3), by + Math.sin(a) * h * (0.8 + rnd() * 0.3)]); }
        this.poly(pts, base);
        // lit top-left facet and a dark lower-right facet
        this.poly([pts[3], pts[4], pts[5], [bx, by]], light); this.poly([pts[0], pts[1], pts[2], [bx + w * 0.1, by + h * 0.1]], dark);
        g.strokeStyle = U.alpha('#000', 0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(pts[5][0], pts[5][1]); g.lineTo(bx, by); g.lineTo(pts[2][0], pts[2][1]); g.stroke();
        dots(bx, by, w * 0.8, h * 0.8, 14, [light, dark]);
      };
      boulder(-9 * k, 0, 10 * k, 7 * k); boulder(7 * k, -3, 13 * k, 9 * k); boulder(-1, 5, 7 * k, 4.5 * k);
      if (gold) { g.strokeStyle = '#d6ad33'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const x = -12 + rnd() * 24, y = -8 + rnd() * 12; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3 + rnd() * 4, y + 1 - rnd() * 3); g.stroke(); } dots(0, -2, 14, 8, 16, ['#f0d060', '#d6ad33', '#fff2b0']); }
    } else if (r.kind === 'berry') {
      const k = 0.75 + 0.25 * (r.amount / r.max);
      this.castShadow(1, 3, 16, 4);
      this.ell(0, -7, 16 * k, 10 * k, U.shade(T.bush, -0.35));
      for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI * 2, dd = Math.sqrt(rnd()) * 0.8, bx = Math.cos(a) * 13 * k * dd, by = -8 + Math.sin(a) * 7 * k * dd; this.ell(bx, by, (5 + rnd() * 3) * k, (4 + rnd() * 2) * k, by < -9 ? U.shade(T.bush, 0.2) : T.bush); }
      dots(0, -8, 13 * k, 7 * k, 30, [U.shade(T.bush, 0.35), U.shade(T.bush, -0.4)]);
      for (let i = 0; i < 12; i++) { const a = rnd() * Math.PI * 2, dd = Math.sqrt(rnd()) * 0.85; const bx = Math.cos(a) * 13 * k * dd, by = -8 + Math.sin(a) * 7 * k * dd; this.ell(bx, by, 1.9, 1.9, T.berry); g.fillStyle = '#ffd0d0'; g.fillRect(bx - 1, by - 1, 1, 1); }
    } else if (r.kind === 'fish') {
      // a shoal in the shallows: rings on the water and a few dark backs breaking the surface
      g.strokeStyle = U.alpha('#ffffff', 0.5); g.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const bx = -10 + rnd() * 20, by = -4 + rnd() * 8; g.beginPath(); g.ellipse(bx, by, 6 + rnd() * 4, 2.5 + rnd() * 1.5, 0, 0, 7); g.stroke(); }
      for (let i = 0; i < 4; i++) { const bx = -12 + rnd() * 24, by = -5 + rnd() * 10, dir = rnd() < 0.5 ? -1 : 1; g.fillStyle = i % 2 ? '#3a4a5a' : '#4a5f72'; g.beginPath(); g.ellipse(bx, by, 5, 1.6, 0.1 * dir, 0, 7); g.fill(); this.poly([[bx + 5 * dir, by], [bx + 8 * dir, by - 2], [bx + 8 * dir, by + 2]], i % 2 ? '#3a4a5a' : '#4a5f72'); g.fillStyle = '#c8d8e8'; g.fillRect(bx - 1, by - 1, 1.5, 1); }
    }
  },

  /* ---- buildings: static art cached per look and zoom step; flags and smoke drawn live ---- */
  drawBuilding(b, mode) {
    const p = Game.players[b.owner], age = AGES[b.ageVisual] || AGES[0];
    if (!b.built) { this.at(b.tx, b.ty, 0); this.drawSite(b, age); return; }
    const sp = this.bldSprite(b), s = b.size;
    if (mode !== 'live') { const [sx, sy] = this.toScreen(b.tx, b.ty, 0); this.stamp(sp, sx, sy); if (mode === 'static') return; }
    // live parts
    // each shape says where its poles stand while it is drawn, so the cloth waves from the roof it belongs to
    const col = p.color.main, sh = b.def.shape, z = this.cam.zoom;
    if (sp.flags && sp.flags.length) { const [ox, oy] = this.toScreen(b.tx, b.ty, 0); for (const f of sp.flags) { const at = this.P(f[0], f[1], f[2]); this.stamp(this.flagSprite(col, this.time * 4 + at[0]), ox + at[0] * z, oy + at[1] * z); } }
    if (sh === 'smithy') { this.at(b.tx, b.ty, 0); this.smithySmoke(); }
  },
  bldSprite(b) {
    const p = Game.players[b.owner], age = AGES[b.ageVisual] || AGES[0];
    const z = this.cam.zoom, zq = this.zq(z), s = b.size;
    const grown = b.def.farm ? (b.worker && !b.worker.dead ? 1 : 0) : 0;
    const mask = b.def.wall ? World.wallMask(b) : 0;
    const key = 'b|' + b.type + '|' + b.ageVisual + '|' + b.owner + '|' + grown + '|' + mask;
    let sp = this.sprites.get(key);
    if (!sp) {
      const k = this.spriteK(zq), hgt = this.height(b) + 70, W = Math.ceil((s * 64 + 72) * k), H = Math.ceil((s * 32 + hgt + 40) * k), ax = W / 2 - 8 * k, ay = hgt * k;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
      this.g = cv.getContext('2d', { willReadFrequently: true }); this.dpr = 1; this.cam = { x: 0, y: 0, zoom: k }; this.W = 2 * ax; this.H = 2 * ay;
      const fake = { tx: 0, ty: 0, size: s, x: s / 2, y: s / 2, def: b.def, type: b.type, built: true, worker: grown ? { dead: false } : null, owner: b.owner, ageVisual: b.ageVisual, mask };
      this.at(0, 0, 0); this.footShadow(fake); this.mat = age; this.flags = [];
      const fn = this['shape_' + b.def.shape] || this.shape_house; fn.call(this, fake, age, p);
      this.mat = null; const flags = this.flags; this.flags = null; this.oldSchool(cv, 9, b.def.shape === 'wall'); // wall pieces butt together, so no outline at their ends
      this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
      sp = this.pack(cv, ax, ay, k, flags, !b.def.passable); this.sprites.set(key, sp);
    }
    return sp;
  },
  /* A waving flag is one of eight cached frames, stamped like any sprite instead of drawn as shapes every frame. */
  flagSprite(color, phase) {
    const q = ((Math.floor((phase / (Math.PI * 2)) * 8) % 8) + 8) % 8, key = 'f|' + color + '|' + q;
    let sp = this.sprites.get(key);
    if (!sp) {
      const W = 18, H = 24, ax = 4, ay = 20, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true }), wv = Math.sin((q / 8) * Math.PI * 2) * 1.5;
      g.translate(ax, ay); g.strokeStyle = '#3a2a1a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -16); g.stroke();
      g.fillStyle = color; g.beginPath(); g.moveTo(0, -16); g.lineTo(10, -13 + wv); g.lineTo(0, -9); g.closePath(); g.fill();
      this.oldSchool(cv, 6, true);
      sp = this.pack(cv, ax, ay, 1); this.sprites.set(key, sp);
    }
    return sp;
  },
  smithySmoke() {
    const c = this.P(0.65, 0.55, 52); for (let k = 0; k < 3; k++) { const t = (this.time * 0.5 + k / 3) % 1; this.ell(c[0] + Math.sin(t * 6) * 3, c[1] - t * 22, 4 + t * 5, 3 + t * 3, `rgba(200,200,210,${0.35 * (1 - t)})`); } const w = this.P(0.8, 1.4, 9); this.ell(w[0], w[1], 5, 3, `rgba(255,140,40,${0.45 + 0.3 * Math.sin(this.time * 7)})`); 
  },
  /* Sprites are rasterised once, at one texel per zoom-1 pixel, whatever the zoom: changing zoom never redraws
     anything. Zoomed in they are stamped with nearest-neighbour scaling for the chunky pre-rendered look;
     zoomed out below one texel per screen pixel they are filtered down instead. */
  spriteK() { return 1; },
  /* The "pre-rendered" pass: hard alpha, film grain, a limited palette, and a dark one-pixel outline. */
  oldSchool(cv, grain, noOutline) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height; if (!w || !h) return;
    const img = g.getImageData(0, 0, w, h), d = img.data, n = w * h;
    const solid = new Uint8Array(n); let seed = (w * 7919 + h * 104729) >>> 0; grain = grain == null ? 11 : grain;
    for (let i = 0; i < n; i++) {
      const o = i * 4; if (d[o + 3] < 96) { d[o + 3] = 0; continue; }
      if (d[o] <= 4 && d[o + 1] <= 5 && d[o + 2] <= 6) { d[o] = 10; d[o + 1] = 8; d[o + 2] = 20; d[o + 3] = 115; continue; } // shadow marker
      d[o + 3] = 255; solid[i] = 1;
      seed = (seed * 1664525 + 1013904223) >>> 0; const gr = ((seed >>> 16) % (grain * 2 + 1)) - grain;
      for (let c = 0; c < 3; c++) d[o + c] = U.clamp(Math.round((d[o + c] + gr) / 8) * 8, 0, 255);
    }
    if (!noOutline) for (let i = 0; i < n; i++) {
      if (!solid[i]) continue; const x = i % w, y = (i - x) / w;
      if ((x > 0 && !solid[i - 1]) || (x < w - 1 && !solid[i + 1]) || (y > 0 && !solid[i - w]) || (y < h - 1 && !solid[i + w])) { const o = i * 4; d[o] = d[o] * 0.45; d[o + 1] = d[o + 1] * 0.45; d[o + 2] = d[o + 2] * 0.45; }
    }
    g.putImageData(img, 0, 0);
  },
  /* Sprites are drawn on CPU-side canvases (willReadFrequently), so the old-school pass reads their pixels without
     stalling the GPU, which on Android tablets cost many milliseconds per sprite. The finished sprite is copied once
     to an ordinary canvas that is never read, so stamping it stays on the GPU. */
  freeze(cv) { const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height; out.getContext('2d').drawImage(cv, 0, 0); return out; },
  /* Finished sprites are swapped for ImageBitmaps once the browser has made them: an immutable image the GPU keeps,
     where a small canvas may be kept in software on Android and uploaded again every time it is drawn. */
  bitmapify(sp) { if (typeof createImageBitmap !== 'function') return sp; createImageBitmap(sp.cv).then((b) => { sp.cv = b; }).catch(() => {}); return sp; },
  // a finished sprite: its pixels, their size, and the anchor point that sits on the ground
  pack(cv, ax, ay, k, flags, solid) {
    const sp = this.bitmapify({ cv: this.freeze(cv), w: cv.width, h: cv.height, ax, ay, k, flags });
    /* Things that can stand in front of a unit also keep a copy without their see-through shadow: the piece redrawn
       over the unit must not lay the shadow a second time on the one already in the background. */
    if (solid) {
      const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), d = img.data;
      for (let o = 3; o < d.length; o += 4) if (d[o] < 255) d[o] = 0;
      const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height; out.getContext('2d').putImageData(img, 0, 0);
      sp.solid = this.bitmapify({ cv: out });
    }
    return sp;
  },
  stamp(sp, sx, sy, glow) {
    this.stamps++;
    const g = this.g, dpr = this.dpr, sc = (this.cam.zoom * dpr) / sp.k;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = sc < 0.99;
    if (glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = glow; }
    const dx = Math.round(sx * dpr - sp.ax * sc), dy = Math.round(sy * dpr - sp.ay * sc), dw = Math.round(sp.w * sc), dh = Math.round(sp.h * sc);
    g.drawImage(sp.cv, dx, dy, dw, dh);
    if (glow) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
  },
  /* Just the part of a sprite inside a screen rectangle (CSS px): the piece of a tree or wall redrawn over someone
     behind it. Cutting the source image is a plain copy, where clipping the canvas made the graphics chip build a
     mask for every one. */
  stampPart(sp, sx, sy, c) {
    this.stamps++;
    const g = this.g, dpr = this.dpr, sc = (this.cam.zoom * dpr) / sp.k;
    const dx = Math.round(sx * dpr - sp.ax * sc), dy = Math.round(sy * dpr - sp.ay * sc), dw = Math.round(sp.w * sc), dh = Math.round(sp.h * sc);
    const fx = dw / sp.w, fy = dh / sp.h;
    // whole texels only, so the redrawn piece lines up exactly with the copy already in the background
    const u0 = Math.max(0, Math.floor((c[0] * dpr - dx) / fx)), u1 = Math.min(sp.w, Math.ceil(((c[0] + c[2]) * dpr - dx) / fx));
    const v0 = Math.max(0, Math.floor((c[1] * dpr - dy) / fy)), v1 = Math.min(sp.h, Math.ceil(((c[1] + c[3]) * dpr - dy) / fy));
    if (u1 <= u0 || v1 <= v0) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = sc < 0.99;
    g.drawImage((sp.solid || sp).cv, u0, v0, u1 - u0, v1 - v0, dx + u0 * fx, dy + v0 * fy, (u1 - u0) * fx, (v1 - v0) * fy);
  },
  zq(z) { const Z = this.ZOOMS; let i = 0; for (let k = 0; k < Z.length; k++) if (Math.abs(Z[k] - z) < Math.abs(Z[i] - z)) i = k; return Z[i]; },
  footShadow(b) {
    if (b.def.passable || b.def.shape === 'wall') return;
    const s = b.size, h = this.height(b) * 0.55, A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    // the footprint plus a wedge thrown to the lower right by the walls
    this.poly([A, B, [B[0] + h * 0.9, B[1] + h * 0.45], [C[0] + h * 0.9, C[1] + h * 0.45], C, D], this.SHADOW);
  },
  /* Material textures painted inside a face quad [top-left, top-right, bottom-right, bottom-left]. */
  texQuad(q, kind, base) {
    const g = this.g; g.save(); g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.closePath(); g.clip();
    const L = (t) => [U.lerp(q[0][0], q[3][0], t), U.lerp(q[0][1], q[3][1], t)], R = (t) => [U.lerp(q[1][0], q[2][0], t), U.lerp(q[1][1], q[2][1], t)];
    const hgt = Math.max(1, Math.abs(q[3][1] - q[0][1])), wid = Math.max(1, Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]));
    let seed = Math.floor(Math.abs(q[0][0] * 31 + q[1][1] * 17)) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) / 16777216; };
    const row = (t, col, lw) => { const a = L(t), b = R(t); g.strokeStyle = col; g.lineWidth = lw || 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
    const dark = U.alpha('#000000', 0.28), light = U.alpha('#ffffff', 0.16);
    if (kind === 'plank') { for (let y = 5; y < hgt; y += 5) row(y / hgt, dark, 1); for (let x = 0.15; x < 1; x += 0.28) { const a = [U.lerp(q[0][0], q[1][0], x), U.lerp(q[0][1], q[1][1], x)], b = [U.lerp(q[3][0], q[2][0], x), U.lerp(q[3][1], q[2][1], x)]; g.strokeStyle = U.alpha('#000', 0.35); g.lineWidth = 1.5; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } }
    else if (kind === 'plaster') { g.fillStyle = U.alpha('#000', 0.08); for (let i = 0; i < wid * hgt / 30; i++) g.fillRect(U.lerp(q[0][0], q[1][0], rnd()) + (rnd() - 0.5) * 4, U.lerp(q[0][1], q[3][1], rnd()), 2, 1); for (let x = 0.08; x < 1; x += 0.3) { const a = [U.lerp(q[0][0], q[1][0], x), U.lerp(q[0][1], q[1][1], x)], b = [U.lerp(q[3][0], q[2][0], x), U.lerp(q[3][1], q[2][1], x)]; g.strokeStyle = '#4a3320'; g.lineWidth = 2; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } row(0.02, '#4a3320', 2); }
    else if (kind === 'stone' || kind === 'ashlar') { const rh = kind === 'stone' ? 6 : 9; let k = 0; for (let y = rh; y < hgt; y += rh, k++) { row(y / hgt, dark, 1); row((y - 1) / hgt, light, 0.8); const a = L(y / hgt), b = R(y / hgt), pa = L((y - rh) / hgt), pb = R((y - rh) / hgt); for (let x = (k % 2) * 0.5; x < 1; x += 1 / (kind === 'stone' ? 3 : 2)) { g.strokeStyle = dark; g.lineWidth = 1; g.beginPath(); g.moveTo(U.lerp(pa[0], pb[0], x), U.lerp(pa[1], pb[1], x)); g.lineTo(U.lerp(a[0], b[0], x), U.lerp(a[1], b[1], x)); g.stroke(); } } }
    else if (kind === 'thatch') { g.strokeStyle = U.alpha('#000', 0.22); g.lineWidth = 1; for (let i = 0; i < wid * hgt / 14; i++) { const t = rnd(), x = rnd(); const a = [U.lerp(L(t)[0], R(t)[0], x), U.lerp(L(t)[1], R(t)[1], x)]; const dy = 3 + rnd() * 4; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0] + (q[3][0] - q[0][0]) * dy / hgt, a[1] + dy); g.stroke(); } for (let y = 6; y < hgt; y += 7) row(y / hgt, light, 1); }
    else if (kind === 'shingle' || kind === 'tile') { for (let y = 4; y < hgt; y += 4) { row(y / hgt, dark, 1); row((y - 1) / hgt, light, 0.7); const a = L(y / hgt), b = R(y / hgt); const step = kind === 'tile' ? 5 : 7, off = ((y / 4) % 2) * step / 2; g.fillStyle = dark; for (let x = off; x < wid; x += step) { const t = x / wid; g.fillRect(U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t) - 3, 1, 3); } } }
    else if (kind === 'slate') { for (let y = 5; y < hgt; y += 5) { row(y / hgt, U.alpha('#000', 0.22), 1); row((y - 1) / hgt, U.alpha('#fff', 0.1), 0.7); } }
    g.restore();
  },
  height(b) { if (b.def.shape === 'wall') return b.def.wall === 'stone' ? 26 : 18; if (b.def.shape === 'gate') return 34; return { 1: 30, 2: 26, 3: 32, 4: 40 }[b.size] * ({ tower: 1.9, keep: 1.5, hall: 1.2, monument: 1.2, farm: 0 }[b.def.shape] || 1); },
  /* A box on the footprint: left face (D-C), right face (C-B), and a flat top. */
  box(x0, y0, x1, y1, z0, h, wall, wallDark, top) {
    const P = (x, y, z) => this.P(x, y, z);
    const A = P(x0, y0, z0 + h), B = P(x1, y0, z0 + h), C = P(x1, y1, z0 + h), D = P(x0, y1, z0 + h);
    const Cb = P(x1, y1, z0), Db = P(x0, y1, z0), Bb = P(x1, y0, z0);
    this.poly([D, C, Cb, Db], wall);
    this.poly([C, B, Bb, Cb], wallDark);
    if (this.mat && this.mat.wallMat && h > 8) { this.texQuad([D, C, Cb, Db], this.mat.wallMat, wall); this.texQuad([C, B, Bb, Cb], this.mat.wallMat, wallDark); }
    // a lit edge along the corner and the top rim, as a renderer with a key light would give
    const g = this.g; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(D[0], D[1]); g.lineTo(C[0], C[1]); g.lineTo(B[0], B[1]); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(C[0], C[1]); g.lineTo(Cb[0], Cb[1]); g.stroke();
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
    if (this.mat && this.mat.roofMat) { this.texQuad([M1, M2, C, D], this.mat.roofMat, roof); this.texQuad([A, B, M2, M1], this.mat.roofMat, roofDark); }
    // ridge highlight and a few shingle lines
    const g = this.g; g.strokeStyle = U.alpha('#ffffff', 0.18); g.lineWidth = 1.2; g.beginPath(); g.moveTo(M1[0], M1[1]); g.lineTo(M2[0], M2[1]); g.stroke();
    g.strokeStyle = U.alpha('#000000', 0.12); g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { const t = k / 4; g.beginPath(); g.moveTo(U.lerp(M1[0], D[0], t), U.lerp(M1[1], D[1], t)); g.lineTo(U.lerp(M2[0], C[0], t), U.lerp(M2[1], C[1], t)); g.stroke(); }
    // gable end (right face triangle)
    this.poly([P(x1, y0, h), P(x1, y1, h), P(x1, ym, h + rise)], U.shade(roofDark, -0.15));
    this.flagSpot(x1 - 0.15, ym, h + rise - 1, true);
  },
  /* Shapes call this while their sprite is drawn: a flag pole planted at world offset (x, y, z). The first
     gable roof offers its ridge end as a fallback; an explicit spot replaces it. */
  flagSpot(x, y, z, fallback) { if (!this.flags) return; if (fallback) { if (!this.flags.length) { this.flags.push([x, y, z]); this.flags.fallback = true; } return; } if (this.flags.fallback) { this.flags.length = 0; this.flags.fallback = false; } this.flags.push([x, y, z]); },
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
  /* The first town hall: a raised deck, timber posts, a hide-and-canvas hip roof with two lean-to wings. */
  pavilion(b, age, p) {
    const s = b.size, g = this.g, P = (x, y, z) => this.P(x, y, z);
    const canvas = '#c9b389', canvasDark = '#a8936c', post = '#7a5a3a', postDark = '#55402a', trim = p.color.main;
    // deck
    this.box(0.15, 0.15, s - 0.15, s - 0.15, 0, 5, '#8a6a44', '#6a5034', '#a3845a');
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; for (let k = 0.5; k < s; k += 0.5) { const a = P(k, 0.15, 5), c = P(k, s - 0.15, 5); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    const postAt = (x, y, h) => { const a = P(x, y, 5), t = P(x, y, 5 + h); g.strokeStyle = postDark; g.lineWidth = 3.2; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(t[0], t[1]); g.stroke(); g.strokeStyle = post; g.lineWidth = 1.4; g.beginPath(); g.moveTo(a[0] - 0.8, a[1]); g.lineTo(t[0] - 0.8, t[1]); g.stroke(); };
    const canopyRoof = (x0, y0, x1, y1, z, rise, hip) => {
      const A = P(x0, y0, z), B = P(x1, y0, z), C = P(x1, y1, z), D = P(x0, y1, z);
      if (hip) {
        const M = P((x0 + x1) / 2, (y0 + y1) / 2, z + rise);
        this.poly([A, B, M], canvasDark); this.poly([B, C, M], U.shade(canvasDark, -0.15)); this.poly([C, D, M], canvas); this.poly([D, A, M], U.shade(canvas, 0.08));
        g.strokeStyle = 'rgba(60,40,20,0.45)'; g.lineWidth = 1; for (const q of [A, B, C, D]) { g.beginPath(); g.moveTo(M[0], M[1]); g.lineTo(q[0], q[1]); g.stroke(); }
        // seams in the hide
        g.strokeStyle = 'rgba(60,40,20,0.3)'; for (let k = 0.3; k < 1; k += 0.35) { g.beginPath(); g.moveTo(U.lerp(D[0], M[0], k), U.lerp(D[1], M[1], k)); g.lineTo(U.lerp(C[0], M[0], k), U.lerp(C[1], M[1], k)); g.stroke(); }
      } else {
        const ym = y0; const A2 = P(x0, ym, z + rise), B2 = P(x1, ym, z + rise);
        this.poly([A2, B2, C, D], canvas); g.strokeStyle = 'rgba(60,40,20,0.3)'; g.lineWidth = 1; for (let k = 0.33; k < 1; k += 0.33) { g.beginPath(); g.moveTo(U.lerp(A2[0], D[0], k), U.lerp(A2[1], D[1], k)); g.lineTo(U.lerp(B2[0], C[0], k), U.lerp(B2[1], C[1], k)); g.stroke(); }
        this.poly([B2, C, P(x1, y1, z)], U.shade(canvasDark, -0.1));
      }
      // team-coloured edging along the eaves
      g.strokeStyle = trim; g.lineWidth = 2.2; g.beginPath(); g.moveTo(D[0], D[1]); g.lineTo(C[0], C[1]); g.lineTo(B[0], B[1]); g.stroke();
      g.strokeStyle = U.shade(trim, 0.35); g.lineWidth = 0.8; g.beginPath(); g.moveTo(D[0], D[1] - 1); g.lineTo(C[0], C[1] - 1); g.lineTo(B[0], B[1] - 1); g.stroke();
    };
    // wings first (further back / lower), then the central hall
    for (const [x, y] of [[0.3, 1.9], [1.1, 1.9], [0.3, 2.75], [1.1, 2.75]]) postAt(x, y, 16);
    canopyRoof(0.2, 1.8, 1.25, 2.85, 21, 8, false);
    for (const [x, y] of [[1.9, 0.3], [2.75, 0.3], [1.9, 1.1], [2.75, 1.1]]) postAt(x, y, 16);
    canopyRoof(1.8, 0.2, 2.85, 1.2, 21, 8, false);
    // central platform and posts
    this.box(0.75, 0.75, 2.3, 2.3, 5, 6, '#8a6a44', '#6a5034', '#a3845a');
    for (const [x, y] of [[0.8, 0.8], [2.25, 0.8], [0.8, 2.25], [2.25, 2.25], [1.5, 2.3], [2.3, 1.5]]) postAt(x, y, 34);
    // railings and cross braces
    g.strokeStyle = post; g.lineWidth = 1.5; for (const [a, c] of [[[0.8, 2.25], [2.25, 2.25]], [[2.25, 0.8], [2.25, 2.25]]]) for (const z of [17, 22]) { const q0 = P(a[0], a[1], z), q1 = P(c[0], c[1], z); g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.stroke(); }
    g.strokeStyle = postDark; g.lineWidth = 1; const b0 = P(0.8, 2.25, 11), b1 = P(2.25, 2.25, 28), b2 = P(0.8, 2.25, 28), b3 = P(2.25, 2.25, 11); g.beginPath(); g.moveTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.moveTo(b2[0], b2[1]); g.lineTo(b3[0], b3[1]); g.stroke();
    // stores under the roof: crates, sacks, a barrel
    const cr = P(1.3, 1.3, 11); g.fillStyle = '#8a6a44'; g.fillRect(cr[0] - 6, cr[1] - 10, 12, 9); g.fillStyle = '#a3845a'; g.fillRect(cr[0] - 6, cr[1] - 10, 12, 2);
    const sk = P(1.9, 1.7, 11); this.ell(sk[0], sk[1] - 3, 5, 3.5, '#c9a66b'); this.ell(sk[0] - 7, sk[1] - 1, 4.5, 3, '#b8955c');
    const br = P(0.5, 2.55, 5); this.ell(br[0], br[1] - 7, 4, 2.2, '#6a4a2a'); g.fillStyle = '#7a5a3a'; g.fillRect(br[0] - 4, br[1] - 7, 8, 7); this.ell(br[0], br[1], 4, 2.2, '#5a3f22');
    canopyRoof(0.65, 0.65, 2.4, 2.4, 39, 16, true); this.flagSpot(1.525, 1.525, 54);
    // a small hearth in the yard
    const fh = P(2.6, 2.6, 0); this.ell(fh[0], fh[1], 4.5, 2.3, '#4a4038'); g.fillStyle = '#e07a2a'; g.fillRect(fh[0] - 1.5, fh[1] - 3, 3, 2.5); g.fillStyle = '#ffd060'; g.fillRect(fh[0] - 0.5, fh[1] - 4, 1.2, 1.5);
  },
  /* Wall pieces join up with their neighbours: a run from the middle of the square to every connected side or
     corner, so a line of pieces reads as one continuous wall, diagonals included. */
  wallCols(b) { return b.def.wall === 'stone' ? { wall: '#9a948a', dark: '#6e6960', top: '#b8b2a6', mat: 'stone' } : { wall: '#8d6c3e', dark: '#5f4728', top: '#a88852', mat: 'plank' }; },
  WALL_DIRS: [[1, 0, 1], [0, 1, 2], [-1, 0, 4], [0, -1, 8], [1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128]],
  wallRuns(m) { const out = []; for (const [dx, dy, bit] of this.WALL_DIRS) if (m & bit) out.push([dx, dy]); return out; },
  /* A straight slab of height h and thickness t between two ground points, in any direction: the faces turned
     towards the viewer, shaded by which way they face, then the top. */
  slab(x0, y0, x1, y1, z0, h, t, c, tex) {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L * t / 2, ny = (x1 - x0) / L * t / 2;
    const base = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
    const faces = [];
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], ox = -ey, oy = ex; // outward normal
      const facing = ox + oy; if (facing <= 1e-6) continue;
      const lit = oy / (Math.abs(ox) + Math.abs(oy)); // +1 faces +y (the lit left face), 0 faces +x (the shaded right face)
      faces.push({ a, b, depth: (a[0] + a[1] + b[0] + b[1]) / 2, col: U.lerpColor(c.dark, c.wall, lit) });
    }
    faces.sort((p, q) => p.depth - q.depth);
    for (const f of faces) {
      const q = [this.P(f.a[0], f.a[1], z0 + h), this.P(f.b[0], f.b[1], z0 + h), this.P(f.b[0], f.b[1], z0), this.P(f.a[0], f.a[1], z0)];
      if (q[0][0] > q[1][0]) { q.reverse(); q.push(q.shift()); q.push(q.shift()); }
      this.poly(q, f.col); if (tex && h > 8) this.texQuad(q, tex, f.col);
    }
    this.poly(base.map(([x, y]) => this.P(x, y, z0 + h)), c.top);
  },
  /* One sharpened log standing at ground point (x, y). */
  stake(x, y, h, w, c) {
    const [bx, by] = this.P(x, y, 0), top = by - h, g = this.g;
    g.fillStyle = c.dark; g.fillRect(bx - w / 2, top, w, h);
    g.fillStyle = c.wall; g.fillRect(bx - w / 2, top, w * 0.55, h);
    g.fillStyle = U.alpha('#ffffff', 0.18); g.fillRect(bx - w / 2 + 0.6, top + 1, 0.9, h - 2);
    this.poly([[bx - w / 2, top], [bx, top - w * 1.1], [bx + w / 2, top]], c.top);
    g.fillStyle = U.alpha('#000000', 0.25); g.fillRect(bx - w / 2, top + h * 0.3, w, 1); // lashing
  },
  shape_wall(b, age, p) {
    const g = this.g, c = this.wallCols(b), m = b.mask || 0, h = this.height(b), stone = b.def.wall === 'stone';
    const runs = this.wallRuns(m), T = stone ? 0.42 : 0.22;
    // shadow along each run rather than under the whole square
    const sh = h * 0.5;
    const shadowRun = (x1, y1) => { const A = this.P(0.5, 0.5), B = this.P(x1, y1); this.poly([[A[0] - 4, A[1]], [B[0] - 4, B[1]], [B[0] + sh * 0.9, B[1] + sh * 0.45 + 2], [A[0] + sh * 0.9, A[1] + sh * 0.45 + 2]], this.SHADOW); };
    for (const [dx, dy] of runs) shadowRun(0.5 + dx * 0.5, 0.5 + dy * 0.5);
    if (!runs.length) { const A = this.P(0.3, 0.3), C = this.P(0.7, 0.7); this.poly([[A[0], A[1]], [C[0] + sh, C[1] + sh * 0.5], [C[0], C[1]]], this.SHADOW); }
    if (stone) {
      // back runs first, then the pier (only where the wall turns or ends), then front runs
      const straight = runs.length === 2 && runs[0][0] === -runs[1][0] && runs[0][1] === -runs[1][1];
      const order = runs.slice().sort((r, s2) => (r[0] + r[1]) - (s2[0] + s2[1]));
      const run = ([dx, dy]) => {
        const x1 = 0.5 + dx * 0.5, y1 = 0.5 + dy * 0.5;
        if (dx === dy) {
          // a run pointing straight down (or up) the screen would show only its top, so build it as a
          // staircase of short blocks, the way the old games drew their diagonal walls
          const r = T / 2, steps = [0.1, 0.24, 0.38, 0.5].map((d) => [0.5 + dx * d, 0.5 + dy * d]);
          if (dx < 0) steps.reverse();
          for (const [cx, cy] of steps) { this.box(cx - r, cy - r, cx + r, cy + r, 0, h, c.wall, c.dark, c.top); this.box(cx - r * 0.45, cy - r * 0.45, cx + r * 0.45, cy + r * 0.45, h, 5, c.wall, c.dark, c.top); }
          return;
        }
        this.slab(0.5, 0.5, x1, y1, 0, h, T, c, c.mat);
        const len = Math.hypot(dx, dy) * 0.5, n = Math.max(1, Math.round(len / 0.2));
        for (let i = 0; i < n; i++) { const t0 = (i + 0.2) / n, t1 = (i + 0.7) / n; this.slab(U.lerp(0.5, x1, t0), U.lerp(0.5, y1, t0), U.lerp(0.5, x1, t1), U.lerp(0.5, y1, t1), h, 6, T, c); } // merlons with gaps between
      };
      for (const r of order) if (r[0] + r[1] < 0 || (r[0] + r[1] === 0 && r[0] < 0)) run(r);
      if (!straight) { this.box(0.27, 0.27, 0.73, 0.73, 0, h + 7, c.wall, c.dark, c.top); this.box(0.24, 0.24, 0.76, 0.76, h + 7, 3, c.wall, c.dark, c.top); }
      for (const r of order) if (!(r[0] + r[1] < 0 || (r[0] + r[1] === 0 && r[0] < 0))) run(r);
      return;
    }
    // palisade: tightly packed sharpened logs along every run, drawn back to front, with a rail on the near side
    const logs = [];
    let seed = (m * 2654435761) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 8) / 16777216; };
    const add = (x, y) => logs.push([x, y, h - 2 + rnd() * 4]);
    add(0.5, 0.5);
    for (const [dx, dy] of runs) { const x1 = 0.5 + dx * 0.5, y1 = 0.5 + dy * 0.5, [sx0, sy0] = this.P(0.5, 0.5), [sx1, sy1] = this.P(x1, y1), n = Math.max(2, Math.round(Math.hypot(sx1 - sx0, sy1 - sy0) / 4)); for (let i = 1; i <= n; i++) { const o = dx === dy ? (i % 2 ? 0.06 : -0.06) : 0; add(U.lerp(0.5, x1, i / n) + o, U.lerp(0.5, y1, i / n) - o); } }
    if (!runs.length) { add(0.4, 0.5); add(0.6, 0.5); add(0.5, 0.4); add(0.5, 0.6); }
    logs.sort((a, q) => (a[0] + a[1]) - (q[0] + q[1]) || this.P(a[0], a[1])[0] - this.P(q[0], q[1])[0]);
    for (const [x, y, lh] of logs) this.stake(x, y, lh, 5, c);
    g.strokeStyle = U.shade(c.dark, -0.25); g.lineWidth = 1.6;
    for (const [dx, dy] of runs) { if (dx + dy < 0 || (dx + dy === 0 && dx < 0)) continue; const a = this.P(0.5 + 0.08, 0.5 + 0.08, h * 0.45), e = this.P(0.5 + dx * 0.5 + 0.08, 0.5 + dy * 0.5 + 0.08, h * 0.45); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(e[0], e[1]); g.stroke(); }
  },
  shape_gate(b, age, p) {
    const g = this.g, c = this.wallCols(b), m = b.mask || 0, h = this.height(b), stone = b.def.wall === 'stone';
    const alongX = (m & 5) || !(m & 10); // walls east/west: the opening runs north-south
    const saveMat = this.mat; this.mat = { wallMat: c.mat };
    const piers = alongX ? [[0, 0.3, 0.28, 0.7], [0.72, 0.3, 1, 0.7]] : [[0.3, 0, 0.7, 0.28], [0.3, 0.72, 0.7, 1]];
    if (stone) for (const [x0, y0, x1, y1] of piers) this.box(x0, y0, x1, y1, 0, h, c.wall, c.dark, c.top);
    else {
      // two posts of bound logs, taller than the palisade either side
      const logs = []; for (const [x0, y0, x1, y1] of piers) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) logs.push([U.lerp(x0 + 0.04, x1 - 0.04, i / 2), U.lerp(y0 + 0.04, y1 - 0.04, j / 2)]);
      logs.sort((a, q) => (a[0] + a[1]) - (q[0] + q[1]) || this.P(a[0], a[1])[0] - this.P(q[0], q[1])[0]);
      logs.forEach(([x, y], i) => this.stake(x, y, h - 4 + ((i * 7) % 5), 5, c));
    }
    // lintel over the opening and two open doors
    const a = alongX ? this.P(0.14, 0.5, h - 4) : this.P(0.5, 0.14, h - 4), d = alongX ? this.P(0.86, 0.5, h - 4) : this.P(0.5, 0.86, h - 4);
    g.strokeStyle = c.dark; g.lineWidth = 6; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); g.stroke(); g.strokeStyle = c.top; g.lineWidth = 2; g.beginPath(); g.moveTo(a[0], a[1] - 2); g.lineTo(d[0], d[1] - 2); g.stroke();
    const door = stone ? '#5a4128' : '#6f5230';
    if (alongX) { this.box(0.28, 0.62, 0.34, 0.9, 0, h - 8, door, U.shade(door, -0.3), door); this.box(0.66, 0.62, 0.72, 0.9, 0, h - 8, door, U.shade(door, -0.3), door); }
    else { this.box(0.62, 0.28, 0.9, 0.34, 0, h - 8, door, U.shade(door, -0.3), door); this.box(0.62, 0.66, 0.9, 0.72, 0, h - 8, door, U.shade(door, -0.3), door); }
    const f = this.P(alongX ? 0.14 : 0.5, alongX ? 0.5 : 0.14, h); g.fillStyle = p.color.main; g.fillRect(f[0] - 3, f[1] - 9, 6, 8);
    this.mat = saveMat;
  },
  shape_farm(b, age, p) {
    const g = this.g, s = b.size, P = (x, y) => this.P(x, y);
    const A = P(0, 0), B = P(s, 0), C = P(s, s), D = P(0, s);
    const soil = World.T.id === 'tundra' ? '#6f6250' : World.T.id === 'desert' ? '#8a6a3c' : '#6b4b2a';
    this.poly([A, B, C, D], soil);
    const grown = b.worker && !b.worker.dead;
    // furrows run along the x axis; each carries a row of plants
    const rows = 7;
    for (let k = 0; k < rows; k++) {
      const t = (k + 0.5) / rows;
      const a = P(0.08, t * s), c = P(s - 0.08, t * s);
      g.strokeStyle = U.alpha('#000000', 0.35); g.lineWidth = 2.2; g.beginPath(); g.moveTo(a[0], a[1] + 1); g.lineTo(c[0], c[1] + 1); g.stroke();
      g.strokeStyle = U.alpha('#ffffff', 0.12); g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1] - 1); g.lineTo(c[0], c[1] - 1); g.stroke();
      const steps = Math.round(s * 9);
      for (let i = 1; i < steps; i++) {
        const f = i / steps, x = U.lerp(a[0], c[0], f), y = U.lerp(a[1], c[1], f);
        if (grown) { g.strokeStyle = (i + k) % 3 ? '#c9a23a' : '#a8842a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 1, y - 6); g.moveTo(x, y); g.lineTo(x + 1.5, y - 5); g.stroke(); g.fillStyle = '#e0c060'; g.fillRect(x - 1.5, y - 7, 2, 2); }
        else { g.fillStyle = (i + k) % 2 ? '#5f8a3a' : '#4f7a30'; g.fillRect(x - 1, y - 3, 2, 3); }
      }
    }
    // post-and-rail fence around the field
    const rail = '#5a3f22', railLight = '#8a6a44';
    const edges = [[A, B], [B, C], [C, D], [D, A]];
    for (const [p0, p1] of edges) { g.strokeStyle = rail; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p0[0], p0[1] - 5); g.lineTo(p1[0], p1[1] - 5); g.moveTo(p0[0], p0[1] - 2); g.lineTo(p1[0], p1[1] - 2); g.stroke(); }
    for (const [p0, p1] of edges) for (let t = 0; t <= 1; t += 1 / (s * 2)) { const x = U.lerp(p0[0], p1[0], t), y = U.lerp(p0[1], p1[1], t); g.fillStyle = railLight; g.fillRect(x - 1, y - 8, 2, 8); g.fillStyle = rail; g.fillRect(x, y - 8, 1, 8); }
  },

  drawGhost(gh) {
    const g = this.g, s = gh.def.size;
    if (gh.line) { for (const [tx, ty, ok] of gh.line) { this.at(tx, ty, 0); const A = this.P(0, 0), B = this.P(1, 0), C = this.P(1, 1), D = this.P(0, 1); this.poly([A, B, C, D], ok ? 'rgba(122,201,67,0.45)' : 'rgba(216,72,74,0.45)', ok ? '#7ac943' : '#d8484a', 1.5); } return; }
    this.at(gh.tx, gh.ty, 0);
    const ok = gh.ok;
    g.globalAlpha = 0.6;
    const A = this.P(0, 0), B = this.P(s, 0), C = this.P(s, s), D = this.P(0, s);
    this.poly([A, B, C, D], ok ? 'rgba(122,201,67,0.45)' : 'rgba(216,72,74,0.45)', ok ? '#7ac943' : '#d8484a', 1.5);
    if (ok) { const fake = { tx: gh.tx, ty: gh.ty, size: s, x: gh.tx + s / 2, y: gh.ty + s / 2, def: gh.def, type: gh.type, built: true, worker: null, owner: Game.human, mask: 0, ageVisual: Game.players[Game.human].age }; const age = AGES[Game.players[Game.human].age]; this.mat = age; const fn = this['shape_' + gh.def.shape] || this.shape_house; fn.call(this, fake, age, Game.players[Game.human]); this.mat = null; }
    g.globalAlpha = 1;
  },

  /* ---- units ---- */
  drawRing(u) { this.at(u.x, u.y, 0); const g = this.g; g.lineWidth = 1.2; const big = u.def.naval ? 22 : u.def.cls === 'cavalry' ? 16 : 11; this.ell(0, 1, big, big / 2, null, '#f4f0e0'); },
  /* Which tool a villager holds, and whether they are mid-task (which drives the work cycle). */
  unitPose(u) {
    const o = u.order; let tool = 'axe', working = false;
    if (u.type === 'villager' && o) {
      if (o.type === 'gather' && o.res) { const k = rk(o.res); tool = { tree: 'axe', stone: 'pick', gold: 'pick', farm: 'hoe', berry: 'basket', fish: 'rod' }[k] || 'axe'; working = o.phase === 'gathering'; }
      else if (o.type === 'build') { tool = 'hammer'; working = !u.moving && !u.path; }
    }
    return { tool, working };
  },
  drawUnit(u) {
    const z = this.cam.zoom, zq = this.zq(z), p = Game.players[u.owner];
    const sdx = Math.cos(u.face) - Math.sin(u.face), flip = sdx < 0 ? 1 : 0;
    const frame = u.moving ? (Math.floor((u.anim * 2) / (Math.PI / 2)) & 3) : 0;
    const pose = this.unitPose(u);
    // work cycle: four frames of raise, swing, strike, recover; soldiers use the attack timer instead
    let swing = u.swing > 0.2 ? 2 : u.swing > 0 ? 1 : 0;
    if (pose.working) swing = 3 + (Math.floor((u.anim % (Math.PI * 2)) / (Math.PI * 2) * 4) & 3);
    const carry = u.carry.amt > 0 ? u.carry.kind : '';
    const key = 'u|' + u.type + '|' + u.owner + '|' + p.age + '|' + flip + '|' + frame + '|' + swing + '|' + carry + '|' + (u.id % 4) + '|' + pose.tool + (u.def.naval ? '|' + (u.moving ? 1 : 0) + (u.cargo && u.cargo.length ? 'c' : '') : '');
    let sp = this.sprites.get(key);
    // a few new pictures a frame at most: a crowd changing pose all at once keeps its last look for a frame or two
    // rather than stalling the frame while every one is painted
    if (!sp && u.spr && this.madeThisFrame >= 2) sp = u.spr;
    if (!sp) {
      this.madeThisFrame++;
      const k = this.spriteK(zq), W = Math.ceil((u.def.naval ? 128 : 72) * k), H = Math.ceil((u.def.naval ? 96 : 76) * k), ax = W / 2, ay = H - (u.def.naval ? 20 : 8) * k;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const saveG = this.g, saveCam = this.cam, saveDpr = this.dpr, saveW = this.W, saveH = this.H;
      this.g = cv.getContext('2d', { willReadFrequently: true }); this.dpr = 1; this.cam = { x: 0, y: 0, zoom: k }; this.W = 2 * ax; this.H = 2 * ay;
      const walk = [0, 1, 0, -1][frame];
      const sw = swing >= 3 ? [1, 0.55, -0.3, 0.15][swing - 3] : swing === 2 ? 1 : swing === 1 ? -0.3 : 0.1;
      this.at(0, 0, 0);
      this.drawUnitVector(u, p, flip ? -1 : 1, walk, sw, pose.tool, swing >= 3);
      this.oldSchool(cv, 8);
      this.g = saveG; this.cam = saveCam; this.dpr = saveDpr; this.W = saveW; this.H = saveH;
      sp = this.pack(cv, ax, ay, k); this.sprites.set(key, sp);
    }
    const [sx, sy] = this.toScreen(u.x, u.y, 0);
    this.stamp(sp, sx, sy); u.spr = sp;
    u.sx = sx; u.sy = sy; u.sh = (u.def.naval ? 30 : u.def.cls === 'cavalry' ? 46 : u.def.cls === 'siege' ? 26 : 34) * z;
  },
  /* Is this unit hidden behind a tree crown or a building that draws after it? */
  occluded(u) {
    const ux = Math.floor(u.x), uy = Math.floor(u.y), d0 = u.x + u.y, z = this.cam.zoom, headY = u.sy - 18 * z;
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) {
      const tx = ux + dx, ty = uy + dy; if (!World.inBounds(tx, ty)) continue;
      const i = World.idx(tx, ty), r = World.resAt[i];
      if (r && r.kind === 'tree' && r.x + r.y + 1 + r.ox + r.oy > d0) {
        const [tsx, tsy] = this.toScreen(r.x + 0.5 + r.ox, r.y + 0.5 + r.oy, 0);
        if (Math.abs(tsx - u.sx) < 30 * z && headY < tsy - 22 * z && headY > tsy - 100 * z) return true;
      }
      const b = World.bld[i];
      if (b && !b.dead && !b.def.passable && b.tx + b.ty + b.size > d0) {
        const left = this.toScreen(b.tx, b.ty + b.size, 0)[0], right = this.toScreen(b.tx + b.size, b.ty, 0)[0];
        const top = this.toScreen(b.tx, b.ty, this.height(b) + 16)[1], bottom = this.toScreen(b.tx + b.size, b.ty + b.size, 0)[1];
        if (u.sx > left && u.sx < right && headY > top && headY < bottom) return true;
      }
    }
    return false;
  },
  /* A person at the origin, feet on y = 0, facing right, about 32 px tall at zoom 1. `walk` in [-1, 1],
     `swing` in [0, 1] raises the working arm. Team colour on the tunic; villagers wear undyed cloth with a sash. */
  drawUnitVector(u, p, flip, walk, swing, tool, working) {
    const g = this.g, col = p.color, age = p.age, cls = u.def.cls;
    tool = tool || 'axe'; const bend = working && (tool === 'hoe' || tool === 'basket') ? 1 : 0; // stooping over the field or bush
    const skin = ['#e0b898', '#cfa07a', '#a8744c', '#7a5236'][u.id % 4], hair = ['#3a2a1a', '#6a4a2a', '#c9a060', '#1a1a1a'][(u.id >> 2) % 4];
    if (cls === 'ship') { this.ship(u, col, flip, walk, swing); return; }
    this.castShadow(0, 0, cls === 'cavalry' ? 26 : cls === 'siege' ? 26 : 12, cls === 'cavalry' ? 5 : 3);
    g.save(); g.scale(flip, 1); g.lineCap = 'round'; g.lineJoin = 'round';
    if (cls === 'siege') { this.catapult(u, col); g.restore(); return; }
    let by = 0;
    if (cls === 'cavalry') { this.horse(0, 0, ['#4f3220', '#7a5a3c', '#b8a68c', '#332a28'][u.id % 4], col, walk); by = -15; }
    const T = u.type, bare = T === 'gaesatae';
    const tunic = cls === 'villager' ? '#9c8461' : bare ? skin : T === 'medjay' ? '#e8e0cc' : col.main, tunicDark = cls === 'villager' ? '#6f5a40' : bare ? col.dark : T === 'medjay' ? col.main : col.dark;
    const armour = age >= 3 ? '#b4bac4' : age >= 2 ? '#8d939c' : age >= 1 ? '#6f5b44' : '#5a4738';
    // back arm
    g.strokeStyle = skin; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-3.5, by - 21); g.lineTo(-5 - walk * 2, by - 14); g.lineTo(-4 - walk * 3, by - 9); g.stroke();
    // legs: trousers and boots, striding when walking
    if (cls !== 'cavalry') {
      g.strokeStyle = cls === 'villager' ? '#5d4a36' : tunicDark; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-1.5, by - 12); g.lineTo(-2 + walk * 3.5, by - 6); g.lineTo(-2.5 + walk * 4, by - 1); g.stroke();
      g.beginPath(); g.moveTo(1.5, by - 12); g.lineTo(2 - walk * 3.5, by - 6); g.lineTo(2.5 - walk * 4, by - 1); g.stroke();
      g.fillStyle = '#2e2119'; g.fillRect(-4 + walk * 4, by - 2, 4.5, 2.2); g.fillRect(1 - walk * 4, by - 2, 4.5, 2.2);
    } else { g.strokeStyle = tunicDark; g.lineWidth = 3; g.beginPath(); g.moveTo(1, by - 12); g.lineTo(4, by - 6); g.lineTo(4.5, by - 2); g.stroke(); g.fillStyle = '#2e2119'; g.fillRect(3, by - 3, 4, 2); }
    // torso: shoulders wider than the waist, belt, tunic skirt for villagers
    this.poly([[-5, by - 24], [5, by - 24], [3.8, by - 13], [-3.8, by - 13]], tunic);
    if (cls === 'villager') this.poly([[-3.8, by - 13], [3.8, by - 13], [4.5, by - 9], [-4.5, by - 9]], tunicDark);
    g.fillStyle = 'rgba(255,255,255,0.16)'; this.poly([[-5, by - 24], [-1.5, by - 24], [-1, by - 13], [-3.8, by - 13]], 'rgba(255,255,255,0.14)');
    g.fillStyle = '#3a2a1a'; g.fillRect(-4, by - 14.5, 8, 1.6);
    if (cls === 'villager') { g.fillStyle = col.main; this.poly([[-5, by - 24], [-2, by - 24], [3.8, by - 13], [1.5, by - 13]], col.main); }
    if ((cls === 'infantry' || cls === 'cavalry') && !bare && T !== 'steppearcher') { this.poly([[-5.5, by - 24.5], [5.5, by - 24.5], [4.5, by - 19], [-4.5, by - 19]], T === 'praetorian' || T === 'phalangite' ? '#b08a4a' : armour); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-5, by - 24, 3, 2); }
    if (bare) { g.strokeStyle = col.main; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-4.5, by - 24); g.lineTo(3.8, by - 14); g.stroke(); } // a sash in team colour
    if (T === 'steppearcher') { this.poly([[-5.5, by - 24.5], [5.5, by - 24.5], [4, by - 13], [-4, by - 13]], '#7a5a3a'); g.strokeStyle = col.main; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-4, by - 24); g.lineTo(4, by - 14); g.stroke(); }
    if (cls === 'archer') { g.strokeStyle = '#5a3f22'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-4, by - 24); g.lineTo(4, by - 14); g.stroke(); }
    // neck and head with hair, eye and a hint of a nose
    if (bend) g.translate(2.5, 1.5);
    g.fillStyle = skin; g.fillRect(-1.2, by - 27, 2.6, 3.5);
    this.ell(0.4, by - 29.5, 3.6, 3.9, skin);
    g.fillStyle = hair; g.beginPath(); g.arc(0.2, by - 30.2, 3.7, Math.PI * 1.05, Math.PI * 2.05); g.fill(); g.fillRect(-3.4, by - 31, 2, 3.5);
    g.fillStyle = '#1a1010'; g.fillRect(2.2, by - 30, 1.1, 1.1); g.fillStyle = U.shade(skin, -0.18); g.fillRect(3.4, by - 29, 1, 1.4);
    // headgear
    if (cls === 'villager') { g.fillStyle = '#a8894a'; g.beginPath(); g.ellipse(0.4, by - 31.5, 6.2, 1.9, 0, 0, 7); g.fill(); this.ell(0.4, by - 32.6, 3.6, 2.2, '#b89a58'); }
    else if (T === 'medjay') { g.fillStyle = col.main; g.fillRect(-3.6, by - 32, 8, 1.6); g.fillStyle = '#e8e0cc'; g.fillRect(-4.2, by - 31, 2, 5); }
    else if (T === 'gaesatae') { g.fillStyle = '#c9a060'; for (let k = -3; k <= 3; k += 2) this.poly([[k - 1.2, by - 32], [k + 0.4, by - 37.5], [k + 1.4, by - 32]], '#c9a060'); }
    else if (T === 'steppearcher') { this.ell(0.4, by - 32.5, 4.6, 2.2, '#6a4a2a'); this.poly([[-3.4, by - 32.5], [0.4, by - 39], [4.2, by - 32.5]], col.main); g.fillStyle = '#8a6a44'; g.fillRect(-4.6, by - 33, 9.8, 1.6); }
    else if (T === 'hirdman') { this.poly([[-4.2, by - 30.5], [0.4, by - 37.5], [5, by - 30.5]], '#8d939c'); g.fillStyle = '#8d939c'; g.fillRect(-0.2, by - 30.5, 1.2, 3.6); }
    else if (T === 'praetorian' || T === 'phalangite') { g.fillStyle = '#b08a4a'; g.beginPath(); g.arc(0.4, by - 30.5, 4.2, Math.PI, 0); g.fill(); g.fillRect(-3.8, by - 30.5, 2.2, 4); g.fillStyle = T === 'praetorian' ? '#b8322a' : col.light; if (T === 'praetorian') g.fillRect(-3.5, by - 37, 8, 2.4); else this.poly([[-4.5, by - 34], [0.4, by - 39], [5, by - 34], [0.4, by - 35.5]], col.light); }
    else if (cls === 'archer') { this.poly([[-4, by - 30], [0.5, by - 37], [5, by - 30]], age >= 2 ? '#7f858c' : '#4d6a32'); g.fillStyle = '#c9a23a'; g.fillRect(3.5, by - 33, 1, 3); }
    else { g.fillStyle = armour; g.beginPath(); g.arc(0.4, by - 30.5, 4.2, Math.PI, 0); g.fill(); g.fillRect(-3.8, by - 30.5, 8.4, 2); if (age >= 2) g.fillRect(-0.5, by - 30, 1.2, 4); if (age >= 3) { g.fillStyle = col.light; g.fillRect(-0.4, by - 38, 1.4, 7); } if (age >= 1) { g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-3, by - 33, 2.5, 1.2); } }
    if (bend) g.translate(-2.5, -1.5);
    // front arm and what it holds
    const hx = 6.5 + swing * 3 + bend * 3, hy = by - 15 - swing * 8 + bend * 5;
    g.strokeStyle = skin; g.lineWidth = 2.4; g.beginPath(); g.moveTo(4, by - 21.5); g.lineTo(6.5 + swing, by - 18 - swing * 3 + bend * 2); g.lineTo(hx, hy); g.stroke();
    if (u.type === 'villager') {
      if (u.carry.amt > 0) { const c = RESOURCE_INFO[u.carry.kind].color; g.fillStyle = c; g.beginPath(); g.roundRect(-9.5, by - 25, 6, 7.5, 1.5); g.fill(); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-9.5, by - 21, 6, 1); }
      // tool angle: raised behind the shoulder at the top of the swing, driven forward and down on the strike
      const a = 1.9 - (swing + 0.3) * 1.75, L = tool === 'hoe' ? 17 : tool === 'hammer' ? 10 : 14;
      const tx = hx + Math.sin(a) * L, ty = hy - Math.cos(a) * L, px = Math.cos(a), py = Math.sin(a); // tip and a perpendicular
      if (tool === 'basket') {
        g.strokeStyle = skin; g.lineWidth = 2.4; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + 4, hy + 2 - (working ? (swing > 0.5 ? 6 : 0) : 0)); g.stroke();
        this.poly([[-9, by - 14], [-3, by - 14], [-4, by - 7], [-8, by - 7]], '#a8894a'); g.strokeStyle = '#7a5a2a'; g.lineWidth = 1; g.beginPath(); g.moveTo(-8.5, by - 12); g.lineTo(-3.5, by - 12); g.moveTo(-8, by - 10); g.lineTo(-4, by - 10); g.stroke();
      } else if (tool === 'rod') {
        g.strokeStyle = '#8a6a3a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx - 3, hy + 3); g.lineTo(hx + 20, hy - 14); g.stroke();
        g.strokeStyle = 'rgba(240,240,255,0.9)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(hx + 20, hy - 14); g.quadraticCurveTo(hx + 22, hy - 4, hx + 21, by + 1); g.stroke();
      } else {
        g.strokeStyle = tool === 'pick' ? '#5a4128' : '#6a4a2a'; g.lineWidth = 1.9; g.beginPath(); g.moveTo(hx - Math.sin(a) * 4, hy + Math.cos(a) * 4); g.lineTo(tx, ty); g.stroke();
        if (tool === 'axe') this.poly([[tx, ty], [tx + px * 5.5 + Math.sin(a) * 1.5, ty + py * 5.5 - Math.cos(a) * 1.5], [tx + px * 5 - Math.sin(a) * 3.5, ty + py * 5 + Math.cos(a) * 3.5], [tx - Math.sin(a) * 3, ty + Math.cos(a) * 3]], '#9aa0a8');
        else if (tool === 'pick') { this.poly([[tx - px * 7, ty - py * 7], [tx + Math.sin(a) * 2, ty - Math.cos(a) * 2], [tx + px * 7, ty + py * 7], [tx - Math.sin(a) * 2, ty + Math.cos(a) * 2]], '#8a8f96'); }
        else if (tool === 'hammer') { this.poly([[tx - px * 4 + Math.sin(a) * 2.5, ty - py * 4 - Math.cos(a) * 2.5], [tx + px * 4 + Math.sin(a) * 2.5, ty + py * 4 - Math.cos(a) * 2.5], [tx + px * 4 - Math.sin(a) * 2.5, ty + py * 4 + Math.cos(a) * 2.5], [tx - px * 4 - Math.sin(a) * 2.5, ty - py * 4 + Math.cos(a) * 2.5]], '#6a6a70'); }
        else if (tool === 'hoe') { this.poly([[tx, ty], [tx + px * 6, ty + py * 6], [tx + px * 6 + Math.sin(a) * 2.5, ty + py * 6 - Math.cos(a) * 2.5], [tx + Math.sin(a) * 2.5, ty - Math.cos(a) * 2.5]], '#8a8f96'); }
      }
    } else if (u.type === 'spearman') { g.strokeStyle = '#6a4d30'; g.lineWidth = 1.7; g.beginPath(); g.moveTo(hx - 1, by - 2); g.lineTo(hx + 3 + swing * 5, by - 36 - swing * 2); g.stroke(); this.poly([[hx + 1.5 + swing * 5, by - 35 - swing * 2], [hx + 3 + swing * 5, by - 42 - swing * 2], [hx + 4.5 + swing * 5, by - 35 - swing * 2]], '#c0c6ce'); this.shield(-7.5, by - 15, 4.5, 5.5, col, age); }
    else if (u.type === 'swordsman' || u.type === 'knight') { g.strokeStyle = '#d0d4dc'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + 7 + swing * 4, hy - 13 - swing * 2); g.stroke(); g.strokeStyle = '#5a4128'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(hx - 1.5, hy - 1); g.lineTo(hx + 2.5, hy + 1); g.stroke(); this.shield(-7.5, by - 15, 5, 6.5, col, age); }
    else if (u.type === 'horseman') { g.strokeStyle = '#6a4d30'; g.lineWidth = 1.7; g.beginPath(); g.moveTo(hx - 2, by - 4); g.lineTo(hx + 6 + swing * 5, by - 34); g.stroke(); this.poly([[hx + 4.5 + swing * 5, by - 33], [hx + 6 + swing * 5, by - 40], [hx + 7.5 + swing * 5, by - 33]], '#c0c6ce'); }
    else if (T === 'praetorian') { // short sword and a tall curved shield
      g.strokeStyle = '#d0d4dc'; g.lineWidth = 2; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + 5 + swing * 4, hy - 9 - swing * 2); g.stroke();
      g.fillStyle = col.main; g.beginPath(); g.roundRect(-11, by - 25, 7.5, 17, 2); g.fill(); g.strokeStyle = '#d8b040'; g.lineWidth = 1; g.strokeRect(-10.5, by - 24.5, 6.5, 16); this.ell(-7.2, by - 16.5, 1.6, 1.6, '#d8b040'); }
    else if (T === 'hirdman') { // bearded axe and a big round shield
      const a = 1.9 - (swing + 0.3) * 1.75, tx = hx + Math.sin(a) * 13, ty = hy - Math.cos(a) * 13, px = Math.cos(a), py = Math.sin(a);
      g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.9; g.beginPath(); g.moveTo(hx - Math.sin(a) * 3, hy + Math.cos(a) * 3); g.lineTo(tx, ty); g.stroke();
      this.poly([[tx, ty], [tx + px * 6 + Math.sin(a) * 2, ty + py * 6 - Math.cos(a) * 2], [tx + px * 6 - Math.sin(a) * 5, ty + py * 6 + Math.cos(a) * 5], [tx - Math.sin(a) * 3, ty + Math.cos(a) * 3]], '#b4bac4');
      this.ell(-7.5, by - 16, 6.5, 7, col.main, '#3a2a1a'); g.strokeStyle = col.light; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-7.5, by - 23); g.lineTo(-7.5, by - 9); g.moveTo(-14, by - 16); g.lineTo(-1, by - 16); g.stroke(); this.ell(-7.5, by - 16, 1.6, 1.6, '#9aa0a8'); }
    else if (T === 'gaesatae') { // long spear held high and a tall oval shield
      g.strokeStyle = '#6a4d30'; g.lineWidth = 1.7; g.beginPath(); g.moveTo(hx - 3, by - 6 + swing * 4); g.lineTo(hx + 7 + swing * 7, by - 36 + swing * 4); g.stroke(); this.poly([[hx + 5.5 + swing * 7, by - 35 + swing * 4], [hx + 8.5 + swing * 7, by - 43 + swing * 4], [hx + 9 + swing * 7, by - 35 + swing * 4]], '#c0c6ce');
      this.ell(-8, by - 16, 4, 9, col.dark, '#2e2119'); g.fillStyle = col.light; g.fillRect(-8.6, by - 24, 1.4, 16); this.ell(-8, by - 16, 1.8, 2.4, '#8a6a44'); }
    else if (T === 'phalangite') { // a very long pike levelled forward and a bronze round shield
      const lv = 0.35 + swing * 0.25; g.strokeStyle = '#6a4d30'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx - 14 * Math.cos(lv), hy + 14 * Math.sin(lv)); g.lineTo(hx + 30 * Math.cos(lv), hy - 30 * Math.sin(lv)); g.stroke();
      const px = hx + 30 * Math.cos(lv), py = hy - 30 * Math.sin(lv); this.poly([[px - 1.5, py - 1.5], [px + 5 * Math.cos(lv), py - 5 * Math.sin(lv)], [px + 1.5, py + 1.5]], '#c0c6ce');
      this.ell(-6.5, by - 17, 6.5, 6.5, '#b08a4a', '#6a4a20'); this.ell(-6.5, by - 17, 3.5, 3.5, col.main); }
    else if (T === 'medjay') { // javelins: one ready, two more in the off hand
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx - 6, hy + 4 - swing * 3); g.lineTo(hx + 10, hy - 10 - swing * 5); g.stroke(); this.poly([[hx + 9, hy - 10 - swing * 5], [hx + 13, hy - 14 - swing * 5], [hx + 10.5, hy - 8.5 - swing * 5]], '#c0c6ce');
      g.beginPath(); g.moveTo(-7, by - 8); g.lineTo(-3, by - 32); g.moveTo(-8.5, by - 8); g.lineTo(-5, by - 31); g.stroke(); this.ell(-7, by - 16, 3.5, 5, col.main, '#e8e0cc'); }
    else if (T === 'steppearcher') { g.strokeStyle = '#5a4128'; g.lineWidth = 2; g.beginPath(); g.moveTo(hx + 1, hy - 9); g.quadraticCurveTo(hx + 8, hy - 6, hx + 3, hy); g.quadraticCurveTo(hx + 8, hy + 6, hx + 1, hy + 9); g.stroke(); g.strokeStyle = '#e8e0d0'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(hx + 1, hy - 9); g.lineTo(hx - 1 - swing * 3, hy); g.lineTo(hx + 1, hy + 9); g.stroke(); g.fillStyle = '#6a4d30'; g.fillRect(-9, by - 20, 3, 10); g.fillStyle = '#e8e0d0'; g.fillRect(-9, by - 22, 3, 2); }
    else if (cls === 'archer') { g.strokeStyle = '#5a4128'; g.lineWidth = 2; g.beginPath(); g.arc(hx + 1, hy, 10, -Math.PI * 0.5, Math.PI * 0.5); g.stroke(); g.strokeStyle = '#e8e0d0'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(hx + 1, hy - 10); g.lineTo(hx + 1, hy + 10); g.stroke(); g.fillStyle = '#6a4d30'; g.fillRect(-8, by - 27, 3, 11); g.fillStyle = '#e8e0d0'; g.fillRect(-8, by - 29, 3, 2); }
    g.restore();
  },
  shield(x, y, rx, ry, col, age) { this.ell(x, y, rx, ry, col.dark, age >= 2 ? '#c0c6ce' : '#2e2119'); this.ell(x, y, 1.3, 1.3, age >= 2 ? '#c0c6ce' : '#8a6a44'); },
  horse(x, y, col, team, walk) {
    const g = this.g, dark = U.shade(col, -0.3), light = U.shade(col, 0.2);
    g.lineCap = 'round'; g.strokeStyle = dark; g.lineWidth = 2.6;
    // far legs, body, near legs
    g.beginPath(); g.moveTo(x - 8, y - 10); g.lineTo(x - 9 + walk * 3, y - 5); g.lineTo(x - 9 + walk * 4, y); g.moveTo(x + 7, y - 10); g.lineTo(x + 8 - walk * 3, y - 5); g.lineTo(x + 9 - walk * 4, y); g.stroke();
    this.ell(x, y - 15, 13, 6.5, col);
    g.strokeStyle = col; g.lineWidth = 2.8; g.beginPath(); g.moveTo(x - 6, y - 11); g.lineTo(x - 7 - walk * 3, y - 5); g.lineTo(x - 8 - walk * 4, y); g.moveTo(x + 9, y - 11); g.lineTo(x + 10 + walk * 3, y - 5); g.lineTo(x + 11 + walk * 4, y); g.stroke();
    g.fillStyle = '#2a2020'; for (const hx of [x - 9 + walk * 4, x + 9 - walk * 4, x - 8 - walk * 4, x + 11 + walk * 4]) g.fillRect(hx - 1.5, y - 1.5, 3, 2);
    // neck and head
    this.poly([[x + 9, y - 19], [x + 13, y - 20], [x + 19, y - 29], [x + 15, y - 31], [x + 8, y - 15]], col);
    this.ell(x + 19.5, y - 29, 4.2, 2.6, col); this.poly([[x + 22, y - 30], [x + 25, y - 28.5], [x + 22, y - 27]], light);
    g.fillStyle = '#1a1010'; g.fillRect(x + 19, y - 30.5, 1.2, 1.2);
    g.strokeStyle = dark; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x + 10, y - 21); g.quadraticCurveTo(x + 14, y - 28, x + 17, y - 31); g.stroke(); // mane
    g.beginPath(); g.moveTo(x - 12, y - 16); g.quadraticCurveTo(x - 17, y - 12, x - 15, y - 3); g.stroke(); // tail
    // saddle cloth in team colour and reins
    this.poly([[x - 5, y - 19], [x + 5, y - 19], [x + 6, y - 12], [x - 6, y - 12]], team.main); g.fillStyle = team.light; g.fillRect(x - 5, y - 13, 11, 1);
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + 4, y - 22); g.lineTo(x + 18, y - 28); g.stroke();
    this.ell(x + 1, y - 13, 1.3, 1.3, light);
  },
  /* Boats, drawn side-on and flipped to face their heading, riding low in the water. */
  ship(u, col, flip, walk, swing) {
    const g = this.g, T = u.type, moving = u.moving, wood = '#6a4a2a', woodD = '#4a3320', woodL = '#8a6a44';
    const L = T === 'galley' ? 24 : T === 'transport' ? 20 : 14, beam = T === 'transport' ? 7 : 5;
    // the water around the hull: a dark reflection, and a wake behind when under way
    const sc = T === 'fishboat' ? 1.15 : 1.35; g.save(); g.scale(sc, sc);
    this.ell(0, 1, L + 4, beam + 1.5, 'rgba(10,30,50,0.35)');
    g.save(); g.scale(flip, 1);
    if (moving) { g.strokeStyle = 'rgba(235,245,255,0.8)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-L - 2, -1); g.lineTo(-L - 14, -5); g.moveTo(-L - 2, 2); g.lineTo(-L - 14, 5); g.moveTo(L + 1, 0); g.lineTo(L + 5, -2); g.moveTo(L + 1, 1); g.lineTo(L + 5, 3); g.stroke(); }
    // hull: the near side, a darker strake along the waterline, and the deck
    g.fillStyle = woodD; g.beginPath(); g.moveTo(-L, -4); g.quadraticCurveTo(-L + 2, 3, -L + 6, 3); g.lineTo(L - 5, 3); g.quadraticCurveTo(L, 2, L + 2, -6); g.lineTo(L - 2, -5); g.lineTo(-L + 1, -5); g.closePath(); g.fill();
    g.fillStyle = wood; g.beginPath(); g.moveTo(-L, -4); g.lineTo(L + 2, -6); g.lineTo(L - 2, -5 - beam * 0.3); g.lineTo(-L + 1, -5 - beam * 0.3); g.closePath(); g.fill();
    this.poly([[-L + 1, -5 - beam * 0.3], [L - 2, -5 - beam * 0.3], [L - 4, -5 - beam], [-L + 3, -5 - beam]], woodL);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-L + 4, -1, L * 2 - 9, 1.5);
    g.fillStyle = col.main; g.fillRect(-L + 5, -4.5, L * 2 - 11, 1.4); // a painted band in team colour
    if (T === 'galley') {
      // oars sweeping in time, shields along the rail, a bronze ram and a striped square sail
      const sweep = moving ? walk * 2.5 : 0;
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 1.1; g.beginPath(); for (let i = -3; i <= 3; i++) { g.moveTo(i * 5, -3); g.lineTo(i * 5 + sweep - 2, 5); } g.stroke();
      for (let i = -3; i <= 3; i++) this.ell(i * 5 + 1, -7, 2, 2, i % 2 ? col.main : col.light, '#2e2119');
      this.poly([[L + 1, -2], [L + 7, -1], [L + 1, 1]], '#b08a4a');
      g.strokeStyle = woodD; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-2, -9); g.lineTo(-2, -34); g.stroke();
      g.fillStyle = '#e8e0cc'; g.fillRect(-11, -33, 18, 16); g.fillStyle = col.main; for (let k = 0; k < 3; k++) g.fillRect(-11 + k * 6, -33, 3, 16);
      g.strokeStyle = woodD; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-13, -33); g.lineTo(9, -33); g.stroke();
      this.poly([[-L - 1, -5], [-L - 5, -12], [-L + 2, -7]], woodL);
    } else if (T === 'transport') {
      // a broad barge: crates and a canopy, people aboard when laden, one square sail
      g.fillStyle = '#9c7a4a'; g.fillRect(-12, -13, 7, 6); g.fillRect(6, -12, 6, 5); g.fillStyle = '#b8955c'; g.fillRect(-12, -13, 7, 1.5);
      if (u.cargo && u.cargo.length) for (let i = 0; i < 4; i++) { this.ell(-3 + i * 3.4, -13, 1.8, 2, ['#e0b898', '#a8744c', '#cfa07a', '#7a5236'][i]); g.fillStyle = col.main; g.fillRect(-4.6 + i * 3.4, -11.5, 3.2, 3.5); }
      g.strokeStyle = woodD; g.lineWidth = 1.8; g.beginPath(); g.moveTo(1, -10); g.lineTo(1, -36); g.stroke();
      g.fillStyle = col.main; g.beginPath(); g.moveTo(-9, -35); g.lineTo(10, -35); g.quadraticCurveTo(12, -26, 10, -18); g.lineTo(-9, -18); g.quadraticCurveTo(-7, -26, -9, -35); g.fill();
      g.fillStyle = col.light; g.fillRect(-9, -28, 19, 2);
    } else {
      // a fishing boat: one small sail, a net over the side, and the catch in the bottom when full
      g.strokeStyle = woodD; g.lineWidth = 1.5; g.beginPath(); g.moveTo(2, -8); g.lineTo(2, -28); g.stroke();
      this.poly([[3, -27], [13, -11], [3, -10]], '#e8e0cc'); g.fillStyle = col.main; g.fillRect(3, -14, 7, 2);
      g.strokeStyle = 'rgba(220,210,180,0.8)'; g.lineWidth = 0.7; g.beginPath(); for (let k = 0; k < 4; k++) { g.moveTo(-9 + k * 2, -6); g.lineTo(-12 + k * 3, 3); } g.stroke();
      if (u.carry && u.carry.amt > 0) { this.ell(-3, -9, 3, 1.3, '#c8d8e8'); this.ell(-6, -9, 2.5, 1.1, '#a8b8c8'); }
      if (u.order && u.order.phase === 'gathering') { g.strokeStyle = '#8a6a3a'; g.lineWidth = 1; g.beginPath(); g.moveTo(-5, -9); g.lineTo(-14, -4 + swing * 2); g.stroke(); }
      this.ell(-4, -11, 1.8, 2, '#cfa07a'); g.fillStyle = '#8a7a5a'; g.fillRect(-5.5, -9.5, 3, 3);
    }
    g.restore(); g.restore();
  },
  catapult(u, col) {
    const g = this.g;
    g.fillStyle = '#6a4a2a'; g.fillRect(-13, -9, 26, 5);
    this.ell(-8, -3, 4.5, 4.5, '#5a3f22', '#3a2a1a'); this.ell(8, -3, 4.5, 4.5, '#5a3f22', '#3a2a1a');
    g.strokeStyle = '#7a5a3a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-6, -9); g.lineTo(0, -20); g.lineTo(6, -9); g.stroke();
    const a = u.swing > 0 ? -1.2 + (0.3 - u.swing) / 0.3 * 1.4 : 0.2;
    g.save(); g.translate(0, -14); g.rotate(a); g.strokeStyle = '#8a6a3a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -4); g.stroke(); this.ell(-18, -4, 3.5, 3.5, '#6a6a70'); g.restore();
    g.fillStyle = col.main; g.fillRect(9, -18, 2, 9); this.poly([[11, -18], [17, -16], [11, -13]], col.main);
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
    } else if (e.kind === 'chips') {
      this.at(e.x, e.y, 0); const t = e.t / e.dur; g.fillStyle = e.color; g.globalAlpha = 1 - t * t;
      // all the bits in one shape: one draw instead of one per chip
      if (e.splash) { g.strokeStyle = e.color; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, 0, 4 + t * 12, 2 + t * 6, 0, 0, 7); g.stroke(); g.beginPath(); for (let k = 0; k < 4; k++) { const a = e.seed + k * 1.6; g.rect(Math.cos(a) * 5 * (1 + t), -6 - Math.sin(t * Math.PI) * 10 + k, 1.5, 3); } g.fill(); }
      else { g.beginPath(); for (let k = 0; k < 6; k++) { const a = e.seed + k * 1.05, vx = Math.cos(a) * (6 + (k % 3) * 4), vz = 10 + (k % 2) * 8; const x = vx * t, z = vz * t - 24 * t * t; g.rect(x - 1, -14 - z, e.spark && k % 2 ? 1.2 : 2.2, e.spark && k % 2 ? 1.2 : 1.6); } g.fill(); }
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
    // the diamond is 2:1 like the world view, so the frame is too: a square one leaves half of it empty
    const wpx = mc.clientWidth || 180, hpx = mc.clientHeight || Math.round(wpx / 2);
    if (mc.width !== wpx * 2 || mc.height !== hpx * 2) { mc.width = wpx * 2; mc.height = hpx * 2; }
    const S = mc.width;
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, mc.width, mc.height);
    mg.fillStyle = '#0e0b12'; mg.fillRect(0, 0, mc.width, mc.height);
    if (this.fogDirty && !Game.settings.reveal) this.updateFogTex();
    // diamond transform: world (x, y) -> minimap
    const k = S / (w + h);
    const tf = () => { mg.setTransform(k, k * 0.5, -k, k * 0.5, S / 2, 0); };
    tf(); mg.imageSmoothingEnabled = false; mg.drawImage(this.miniTerrain, 0, 0);
    // resources
    for (const r of World.res) { if (!World.explored[World.idx(r.x, r.y)] && !Game.settings.reveal) continue; mg.fillStyle = r.kind === 'tree' ? World.T.canopyDark : r.kind === 'gold' ? '#e0b43c' : r.kind === 'stone' ? '#b8bcc4' : r.kind === 'fish' ? '#8fd0e8' : '#d0405c'; mg.fillRect(r.x, r.y, 1, 1); }
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
      if (dx < (u.def.naval ? 20 : 12) * z && Math.abs(dy) < u.sh / 2 + 4 * z) { const d = dx + Math.abs(dy) * 0.5; if (d < bd) { bd = d; best = u; } }
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
    this.g = cv.getContext('2d', { willReadFrequently: true }); this.dpr = 2; this.W = size; this.H = size;
    const p = Game.players[owner] || Game.players[0];
    if (kind === 'unit') {
      const def = UNITS[type]; this.cam = { x: 0, y: 0, zoom: def.cls === 'siege' ? 1.1 : 1.15 }; this.W = size; this.H = size * 1.55;
      const fake = { id: 1, type, def, owner, x: 0, y: 0, face: 0.6, moving: false, anim: 0, swing: 0, order: null, carry: { amt: 0, kind: null }, hp: 1, maxHp: 1 };
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
