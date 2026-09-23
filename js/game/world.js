/* World: the tile map, natural resources, occupancy and fog of war. */
const World = {
  w: 0, h: 0, T: null, terrain: 'meadow',
  tiles: null,     // 0 land, 1 water, 2 shore (land next to water)
  shade: null,     // per-tile brightness variation
  res: [],         // natural resources: trees, stone, gold, berries
  resAt: null,     // tile -> resource or null
  bld: null,       // tile -> building or null
  explored: null, visible: null,   // fog for the human player
  starts: [],
  decals: [],      // stumps and other permanent ground marks
  nextResId: 1,

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; },
  idx(x, y) { return y * this.w + x; },
  isLand(x, y) { return this.inBounds(x, y) && this.tiles[this.idx(x, y)] !== 1; },
  /* Can a unit stand here? Buildings block unless they are flat (farms). Resources block. */
  passable(x, y, owner) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.tiles[i] === 1 || this.resAt[i]) return false;
    const b = this.bld[i];
    if (!b || b.def.passable) return true;
    return !!(b.def.gate && owner != null && b.owner === owner); // gates open for their owner
  },
  /* Can a ship be here? Open water with no resource or building on it. */
  sailable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.tiles[i] === 1 && !this.resAt[i] && !this.bld[i];
  },
  /* Connected bodies of land (positive ids) and water (negative ids), four-way like the pathfinder's corners.
     Two tiles in different regions can never reach each other, so a search between them is skipped. */
  computeRegions() {
    const w = this.w, h = this.h, n = w * h, reg = this.region = new Int32Array(n), q = new Int32Array(n);
    let land = 0, sea = 0;
    for (let s = 0; s < n; s++) {
      if (reg[s]) continue;
      const water = this.tiles[s] === 1, id = water ? -(++sea) : ++land;
      let head = 0, tail = 0; q[tail++] = s; reg[s] = id;
      while (head < tail) {
        const i = q[head++], x = i % w, y = (i - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx; if (reg[j] || (this.tiles[j] === 1) !== water) continue;
          reg[j] = id; q[tail++] = j;
        }
      }
    }
    this.landRegions = land;
  },
  regionAt(x, y) { x = Math.floor(x); y = Math.floor(y); return this.inBounds(x, y) && this.region ? this.region[this.idx(x, y)] : 0; },
  /* The land a resource is worked from: its own tile, or for fish the shore beside it (0 if none). */
  resRegion(r) {
    if (this.tiles[this.idx(r.x, r.y)] !== 1) return this.regionAt(r.x, r.y);
    for (const [dx, dy] of U.DIRS) if (this.isLand(r.x + dx, r.y + dy)) return this.regionAt(r.x + dx, r.y + dy);
    return 0;
  },
  /* Nearest water tile beside land in a region, from a point: where a transport lands its passengers. */
  landingNear(x, y, region, radius) {
    const cx = Math.floor(x), cy = Math.floor(y); let best = null, bd = Infinity;
    for (let r = 0; r <= (radius || 14); r++) {
      if (best && bd <= (r - 1) * (r - 1)) break;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy; if (!this.sailable(tx, ty)) continue;
        let shore = false; for (const [ax, ay] of U.DIRS.slice(0, 4)) if (this.passable(tx + ax, ty + ay) && (!region || this.regionAt(tx + ax, ty + ay) === region)) { shore = true; break; }
        if (!shore) continue;
        const d = U.dist2(tx, ty, x, y); if (d < bd) { bd = d; best = [tx, ty]; }
      }
    }
    return best;
  },
  /* Which neighbours a wall piece joins: bits 1 E, 2 S, 4 W, 8 N, then the diagonals 16 NE, 32 SE, 64 SW,
     128 NW. A diagonal only counts when neither square beside it is wall, so a staircase run joins corner to
     corner while an L-shaped bend doesn't also grow a triangle across its inside. */
  wallMask(b) {
    const own = (x, y) => { if (!this.inBounds(x, y)) return false; const n = this.bld[this.idx(x, y)]; return !!(n && !n.dead && n.def.wall && n.owner === b.owner); };
    let m = 0; const x = b.tx, y = b.ty;
    if (own(x + 1, y)) m |= 1; if (own(x, y + 1)) m |= 2; if (own(x - 1, y)) m |= 4; if (own(x, y - 1)) m |= 8;
    for (const [dx, dy, bit] of [[1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128]]) if (own(x + dx, y + dy) && !own(x + dx, y) && !own(x, y + dy)) m |= bit;
    return m;
  },
  /* Empty land: nothing at all on it. Used for placing buildings and resources. */
  open(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.tiles[i] !== 1 && !this.resAt[i] && !this.bld[i];
  },
  canPlace(def, tx, ty, ignoreUnits) {
    if (def.water) {
      // on open water, with land along one side to build from and open water beside it to launch into
      let coast = false, sea = false;
      for (let x = tx; x < tx + def.size; x++) for (let y = ty; y < ty + def.size; y++) if (!this.sailable(x, y)) return false;
      for (let x = tx - 1; x <= tx + def.size; x++) for (let y = ty - 1; y <= ty + def.size; y++) {
        if (x >= tx && x < tx + def.size && y >= ty && y < ty + def.size) continue;
        if (this.passable(x, y)) coast = true; else if (this.sailable(x, y)) sea = true;
      }
      if (!coast || !sea) return false;
      if (!ignoreUnits) for (const u of Game.units) if (!u.dead && u.x >= tx && u.x < tx + def.size && u.y >= ty && u.y < ty + def.size) return false;
      return true;
    }
    for (let x = tx; x < tx + def.size; x++) for (let y = ty; y < ty + def.size; y++) if (!this.open(x, y)) return false;
    if (!ignoreUnits) for (const u of Game.units) { if (u.dead) continue; if (u.x >= tx && u.x < tx + def.size && u.y >= ty && u.y < ty + def.size && !def.passable) return false; }
    return true;
  },
  setBuilding(b, on) {
    for (let x = b.tx; x < b.tx + b.size; x++) for (let y = b.ty; y < b.ty + b.size; y++) if (this.inBounds(x, y)) this.bld[this.idx(x, y)] = on ? b : null;
  },
  removeResource(r) {
    if (r.removed) return;
    r.removed = true;
    if (Game.selectedRes === r) { Game.selectedRes = null; UI.selDirty = true; }
    if (r.kind === 'tree') this.decals.push({ kind: 'stump', x: r.x, y: r.y, ox: r.ox, oy: r.oy, v: r.v });
    this.resAt[this.idx(r.x, r.y)] = null;
    const i = this.res.indexOf(r); if (i >= 0) this.res.splice(i, 1);
  },
  /* Nearest resource of a kind to (x, y) within radius, optionally excluding ones already crowded. */
  nearestResource(kind, x, y, radius, filter) {
    let best = null, bd = radius * radius;
    for (const r of this.res) {
      if (r.kind !== kind || r.amount <= 0) continue;
      const d = U.dist2(r.x + 0.5, r.y + 0.5, x, y);
      if (d < bd && (!filter || filter(r))) { bd = d; best = r; }
    }
    return best;
  },

  /* ---------------- generation ---------------- */
  generate(opts) {
    const size = MAP_SIZES[opts.mapSize] || MAP_SIZES.medium;
    const w = this.w = size.w, h = this.h = size.h;
    this.terrain = opts.terrain; this.T = TERRAINS[opts.terrain];
    const T = this.T;
    const rng = RNG.make(opts.seed);
    this.tiles = new Uint8Array(w * h); this.shade = new Float32Array(w * h);
    this.resAt = new Array(w * h).fill(null); this.bld = new Array(w * h).fill(null);
    this.explored = new Uint8Array(w * h); this.visible = new Uint8Array(w * h);
    this.res = []; this.starts = []; this.decals = []; this.nextResId = 1;
    const players = opts.players;

    // Water and ground variation
    const nWater = RNG.noise(opts.seed + 11, 14 * T.roughness), nShade = RNG.noise(opts.seed + 23, 6), nForest = RNG.noise(opts.seed + 37, 9);
    const islands = this.islands = opts.mapType === 'islands'; this.neutral = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // keep the edges mostly land so starts are never cut off
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const v = nWater(x, y) + (edge < 6 ? (6 - edge) * 0.05 : 0);
      this.tiles[i] = v < T.waterLevel ? 1 : 0;
      this.shade[i] = (nShade(x, y) - 0.5) * 2;
    }
    if (islands) this.makeIslands(opts, rng, players);
    else {
      // Player starts: evenly around a ring, snapped to land, then cleared
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36, a0 = rng() * Math.PI * 2;
      for (let p = 0; p < players; p++) {
        const a = a0 + (p / players) * Math.PI * 2;
        const sx = Math.round(cx + Math.cos(a) * R), sy = Math.round(cy + Math.sin(a) * R);
        this.starts.push({ x: U.clamp(sx, 8, w - 9), y: U.clamp(sy, 8, h - 9) });
      }
      for (const s of this.starts) this.fillLand(s.x, s.y, 7);
    }
    this.markShores();

    // Forests from noise, thinner near starts
    const dens = T.treeDensity;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!this.open(x, y)) continue;
      const ds = this.startDist(x, y);
      if (ds < 6) continue;
      const f = nForest(x, y);
      const thresh = 0.6 - (dens - 1) * 0.08 + (ds < 12 ? (12 - ds) * 0.02 : 0);
      if (f > thresh && rng() < 0.985) this.addRes('tree', x, y, rng);
    }
    // Guaranteed starting resources for every player
    for (const s of this.starts) {
      const dirs = rng.shuffle([0, 1, 2, 3, 4, 5].map((k) => (k / 6) * Math.PI * 2 + rng() * 0.4));
      this.blob('tree', s, dirs[0], 9, 11, 46, rng);
      this.blob('tree', s, dirs[1], 10, 12, 30, rng);
      this.fishNear(s, rng);
      // islands: enough stone and gold to get going, not enough to finish; the rest is out on the neutral isles
      this.cluster('stone', s, dirs[2], 7, 9, islands ? 4 : 5, rng);
      this.cluster('gold', s, dirs[3], 7, 9, islands ? 4 : 5, rng);
      this.cluster('berry', s, dirs[4], 5, 7, 6, rng);
      if (rng() < 0.5) this.cluster('berry', s, dirs[5], 6, 8, 4, rng);
    }
    // Scattered deposits elsewhere
    const area = (w * h) / (88 * 88);
    const nStone = Math.round(7 * area * T.stone), nGold = Math.round(7 * area * T.goldOre), nBerry = Math.round(5 * area * T.berries);
    if (islands) {
      for (const isl of this.neutral) {
        const put = (kind, n) => { for (let t = 0; t < 12; t++) { const a = rng() * Math.PI * 2, d = rng() * isl.r * 0.55; if (this.clusterAt(kind, Math.round(isl.x + Math.cos(a) * d), Math.round(isl.y + Math.sin(a) * d), n, rng, 8) >= n - 1) return; } };
        put('gold', 7); put('stone', 6); if (isl.r >= 8) { put('gold', 6); put('stone', 5); }
        if (rng() < 0.6) put('berry', 5);
      }
    } else {
      for (let k = 0; k < nStone; k++) this.randomCluster('stone', 4 + rng.int(0, 3), rng);
      for (let k = 0; k < nGold; k++) this.randomCluster('gold', 4 + rng.int(0, 3), rng);
      for (let k = 0; k < nBerry; k++) this.randomCluster('berry', 4 + rng.int(0, 2), rng);
    }
    // fish shoals in shallow water along the coasts
    const nFish = Math.round(14 * area);
    for (let k = 0; k < nFish; k++) { const t = this.randomShallow(rng); if (t && this.startDist(t[0], t[1]) > 9) this.shoal(t[0], t[1], 2 + rng.int(0, 2), rng); }
    // and out in open water, for fishing boats
    const nDeep = Math.round((islands ? 16 : 4) * area);
    for (let k = 0; k < nDeep; k++) { const t = this.randomDeep(rng); if (t) this.deepShoal(t[0], t[1], 2 + rng.int(0, 2), rng); }
    if (islands) for (const s of this.starts) { const t = this.randomDeep(rng, s, 9, 16); if (t) this.deepShoal(t[0], t[1], 3, rng); }
    // Lone trees for texture
    const lone = Math.round(28 * area * dens);
    for (let k = 0; k < lone; k++) { const x = rng.int(1, w - 2), y = rng.int(1, h - 2); if (this.open(x, y) && this.startDist(x, y) > 7) this.addRes('tree', x, y, rng); }
    // undergrowth: ferns and shrubs on open ground beside the forests
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!this.open(x, y)) continue;
      let trees = 0; for (const [dx, dy] of U.DIRS) { const r = this.resAt[this.idx(x + dx, y + dy)]; if (r && r.kind === 'tree') trees++; }
      if (trees >= 2 && rng() < 0.55) { const v = rng(); this.decals.push({ kind: rng() < 0.6 ? 'fern' : 'shrub', x, y, ox: (rng() - 0.5) * 0.7, oy: (rng() - 0.5) * 0.7, v }); }
    }
    if (opts.reveal) { this.explored.fill(1); this.visible.fill(1); }
  },
  /* One island per player around a ring, and smaller neutral isles between them and in the middle. */
  makeIslands(opts, rng, players) {
    const w = this.w, h = this.h, n = players, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.33, a0 = rng() * Math.PI * 2;
    let ri = U.clamp(Math.round(Math.min(w, h) * 0.12), 10, 18);
    if (n > 1) ri = Math.max(9, Math.min(ri, Math.floor((2 * R * Math.sin(Math.PI / n) - 7) / 2)));
    this.tiles.fill(1);
    const nz = RNG.noise(opts.seed + 71, 5);
    const island = (ix, iy, r) => {
      for (let x = Math.floor(ix - r * 1.3); x <= ix + r * 1.3; x++) for (let y = Math.floor(iy - r * 1.3); y <= iy + r * 1.3; y++) {
        if (x < 3 || y < 3 || x > w - 4 || y > h - 4) continue;
        const d = U.dist(x, y, ix, iy); if (d <= r * (0.8 + 0.4 * nz(x, y))) this.tiles[this.idx(x, y)] = 0;
      }
    };
    const spots = [];
    for (let p = 0; p < n; p++) { const a = a0 + (p / n) * Math.PI * 2; const s = { x: Math.round(cx + Math.cos(a) * R), y: Math.round(cy + Math.sin(a) * R) }; this.starts.push(s); island(s.x, s.y, ri); this.fillLand(s.x, s.y, 7); spots.push({ x: s.x, y: s.y, r: ri * 1.2 }); }
    // neutral isles: one in the middle, one between each pair of neighbours, kept clear of the home islands
    const cand = [{ x: cx, y: cy, r: Math.max(7, Math.round(ri * 0.7)) }];
    for (let p = 0; p < n; p++) { const a = a0 + ((p + 0.5) / n) * Math.PI * 2; cand.push({ x: Math.round(cx + Math.cos(a) * R * 0.95), y: Math.round(cy + Math.sin(a) * R * 0.95), r: Math.max(6, Math.round(ri * 0.5)) }); }
    for (const c of cand) {
      if (spots.some((s) => U.dist(s.x, s.y, c.x, c.y) < s.r + c.r + 4)) { c.r = Math.floor(c.r * 0.7); if (c.r < 5 || spots.some((s) => U.dist(s.x, s.y, c.x, c.y) < s.r + c.r + 4)) continue; }
      island(c.x, c.y, c.r); this.neutral.push(c); spots.push({ x: c.x, y: c.y, r: c.r * 1.2 });
    }
    // drop lone specks of land
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = this.idx(x, y); if (this.tiles[i] === 1) continue; let land = 0; for (const [dx, dy] of U.DIRS) if (this.tiles[this.idx(x + dx, y + dy)] !== 1) land++; if (land <= 1) this.tiles[i] = 1; }
  },
  /* Water with water all round it: out of reach from the shore. */
  isDeep(x, y) { if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== 1) return false; for (const [dx, dy] of U.DIRS) { const nx = x + dx, ny = y + dy; if (!this.inBounds(nx, ny) || this.tiles[this.idx(nx, ny)] !== 1) return false; } return true; },
  randomDeep(rng, near, dMin, dMax) {
    for (let t = 0; t < 80; t++) {
      let x, y; if (near) { const a = rng() * Math.PI * 2, d = rng.range(dMin, dMax); x = Math.round(near.x + Math.cos(a) * d); y = Math.round(near.y + Math.sin(a) * d); } else { x = rng.int(2, this.w - 3); y = rng.int(2, this.h - 3); }
      if (this.isDeep(x, y) && !this.resAt[this.idx(x, y)] && (near || this.startDist(x, y) > 10)) return [x, y];
    }
    return null;
  },
  deepShoal(cx, cy, count, rng) {
    const open = [[cx, cy]]; let placed = 0, guard = 0;
    while (open.length && placed < count && guard++ < 40) { const [x, y] = open.splice(rng.int(0, open.length - 1), 1)[0]; if (!this.isDeep(x, y)) continue; if (this.addRes('fish', x, y, rng)) { placed++; for (const [dx, dy] of U.DIRS.slice(0, 4)) open.push([x + dx * 2, y + dy * 2]); } }
    return placed;
  },
  startDist(x, y) { let d = Infinity; for (const s of this.starts) d = Math.min(d, U.dist(x, y, s.x, s.y)); return d; },
  fillLand(cx, cy, r) {
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) if (this.inBounds(x, y) && U.dist(x, y, cx, cy) <= r) this.tiles[this.idx(x, y)] = 0;
  },
  markShores() {
    const w = this.w, h = this.h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (this.tiles[i] === 1) continue;
      let shore = false;
      for (const [dx, dy] of U.DIRS) { const nx = x + dx, ny = y + dy; if (this.inBounds(nx, ny) && this.tiles[ny * w + nx] === 1) { shore = true; break; } }
      this.tiles[i] = shore ? 2 : 0;
    }
    this.computeRegions();
  },
  addRes(kind, x, y, rng) {
    if (kind === 'fish') { if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== 1 || this.resAt[this.idx(x, y)]) return null; }
    else if (!this.open(x, y)) return null;
    const amounts = { tree: 100, stone: 350, gold: 350, berry: 125, fish: 250 };
    const v = rng ? rng() : Math.random(), v2 = rng ? rng() : Math.random();
    // resources sit a little off the tile centre so the world does not read as a grid
    const jit = { tree: 0.42, berry: 0.2, stone: 0.14, gold: 0.14, fish: 0.2 }[kind] || 0;
    const r = { id: this.nextResId++, kind, x, y, amount: amounts[kind], max: amounts[kind], v, ox: (v2 - 0.5) * 2 * jit, oy: (((v * 7919) % 1) - 0.5) * 2 * jit, workers: 0 };
    this.res.push(r); this.resAt[this.idx(x, y)] = r;
    return r;
  },
  /* A roundish patch of trees at a distance from a start, in a direction. */
  blob(kind, s, ang, dMin, dMax, count, rng) {
    const d = rng.range(dMin, dMax), cx = Math.round(s.x + Math.cos(ang) * d), cy = Math.round(s.y + Math.sin(ang) * d);
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 12) {
      const rr = Math.sqrt(rng()) * 3.6, aa = rng() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(aa) * rr * 1.25), y = Math.round(cy + Math.sin(aa) * rr);
      if (this.inBounds(x, y) && this.startDist(x, y) >= 6 && this.addRes(kind, x, y, rng)) placed++;
    }
  },
  /* A tight cluster (stone, gold, berries). */
  cluster(kind, s, ang, dMin, dMax, count, rng) {
    const d = rng.range(dMin, dMax);
    const cx = Math.round(s.x + Math.cos(ang) * d), cy = Math.round(s.y + Math.sin(ang) * d);
    let placed = this.clusterAt(kind, cx, cy, count, rng, 5);
    // landed in a wood or the sea: try other bearings, and in the end clear a spot, so every start gets its share
    for (let t = 1; t <= 10 && placed < count - 1; t++) {
      const a = ang + t * 0.9, dd = dMin + (t % 3), x = Math.round(s.x + Math.cos(a) * dd), y = Math.round(s.y + Math.sin(a) * dd);
      if (t === 10) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const r = this.inBounds(x + ox, y + oy) && this.resAt[this.idx(x + ox, y + oy)]; if (r && r.kind === 'tree') this.removeResource(r); }
      placed += this.clusterAt(kind, x, y, count - placed, rng, 5);
    }
  },
  clusterAt(kind, cx, cy, count, rng, minStart) {
    const open = [[cx, cy]]; let placed = 0, guard = 0;
    while (open.length && placed < count && guard++ < 200) {
      const [x, y] = open.splice(rng.int(0, open.length - 1), 1)[0];
      if (!this.inBounds(x, y) || this.startDist(x, y) < minStart) continue;
      if (this.addRes(kind, x, y, rng)) { placed++; for (const [dx, dy] of U.DIRS.slice(0, 4)) open.push([x + dx, y + dy]); }
    }
    return placed;
  },
  /* A shallow-water tile: water with land beside it. */
  isShallow(x, y) { if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== 1) return false; for (const [dx, dy] of U.DIRS) if (this.isLand(x + dx, y + dy)) return true; return false; },
  randomShallow(rng) { for (let t = 0; t < 60; t++) { const x = rng.int(1, this.w - 2), y = rng.int(1, this.h - 2); if (this.isShallow(x, y) && !this.resAt[this.idx(x, y)]) return [x, y]; } return null; },
  shoal(cx, cy, count, rng) {
    const open = [[cx, cy]]; let placed = 0, guard = 0;
    while (open.length && placed < count && guard++ < 60) {
      const [x, y] = open.splice(rng.int(0, open.length - 1), 1)[0];
      if (!this.isShallow(x, y)) continue;
      if (this.addRes('fish', x, y, rng)) { placed++; for (const [dx, dy] of U.DIRS.slice(0, 4)) open.push([x + dx, y + dy]); }
    }
    return placed;
  },
  fishNear(s, rng) {
    let best = null, bd = 12 * 12;
    for (let x = s.x - 12; x <= s.x + 12; x++) for (let y = s.y - 12; y <= s.y + 12; y++) { if (!this.isShallow(x, y) || this.resAt[this.idx(x, y)]) continue; const d = U.dist2(x, y, s.x, s.y); if (d < bd && d > 25) { bd = d; best = [x, y]; } }
    if (best) this.shoal(best[0], best[1], 3, rng);
  },
  randomCluster(kind, count, rng) {
    for (let t = 0; t < 30; t++) {
      const x = rng.int(3, this.w - 4), y = rng.int(3, this.h - 4);
      if (this.open(x, y) && this.startDist(x, y) > 13) { this.clusterAt(kind, x, y, count, rng, 12); return; }
    }
  },

  /* ---------------- fog of war (human player) ---------------- */
  revealCircle(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (U.dist2(x + 0.5, y + 0.5, cx, cy) <= r2) { const i = y * this.w + x; this.visible[i] = 1; this.explored[i] = 1; }
    }
  },
  updateFog(playerId, reveal) {
    if (reveal) { this.visible.fill(1); this.explored.fill(1); return; }
    this.visible.fill(0);
    for (const u of Game.units) if (!u.dead && u.owner === playerId) this.revealCircle(u.x, u.y, u.def.sight);
    for (const b of Game.buildings) if (!b.dead && b.owner === playerId) this.revealCircle(b.tx + b.size / 2, b.ty + b.size / 2, b.built ? b.def.sight : 3);
  },
  isVisible(x, y) { return this.inBounds(x, y) && this.visible[this.idx(x, y)] === 1; },
  isExplored(x, y) { return this.inBounds(x, y) && this.explored[this.idx(x, y)] === 1; },
};
