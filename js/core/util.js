/* Anvil & Acre — small shared helpers. Everything hangs off a single global `U`. */
const U = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); },
  dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
  sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; },
  pick(arr, rng) { return arr[Math.floor((rng ? rng() : Math.random()) * arr.length)]; },
  fmt(n) { n = Math.floor(n); return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); },
  time(sec) { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; },
  cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); },
  el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  once(arr) { return Array.from(new Set(arr)); },

  /* ---- colour helpers (hex in, hex/rgba out) ---- */
  hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
  rgb(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(U.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); },
  shade(c, k) { const [r, g, b] = U.hex(c); return k >= 0 ? U.rgb(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : U.rgb(r * (1 + k), g * (1 + k), b * (1 + k)); },
  mix(a, b, t) { const A = U.hex(a), B = U.hex(b); return U.rgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); },
  alpha(c, a) { const [r, g, b] = U.hex(c); return `rgba(${r},${g},${b},${a})`; },

  /* ---- grid pathfinding: 8-way A*, corners not cut, bounded search ----
     passable(x, y) -> bool. Returns an array of [x, y] steps excluding the start, or null.
     If the goal is unreachable the path to the closest explored node is returned (best effort). */
  astar(sx, sy, gx, gy, w, h, passable, maxNodes) {
    maxNodes = maxNodes || 6000;
    if (sx === gx && sy === gy) return [];
    const n = w * h;
    // Scratch buffers are kept between searches and marked with a run number, so nothing has to be cleared.
    if (!U._as || U._as.n < n) U._as = { n, g: new Float32Array(n), came: new Int32Array(n), seen: new Int32Array(n), shut: new Int32Array(n), gen: 0 };
    const A = U._as, G = A.g, CAME = A.came, SEEN = A.seen, SHUT = A.shut, gen = ++A.gen;
    const open = new BinaryHeap();
    const hFn = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    const start = sy * w + sx;
    G[start] = 0; SEEN[start] = gen; CAME[start] = -1;
    open.push({ i: start, x: sx, y: sy, f: hFn(sx, sy) });
    let best = start, bestH = hFn(sx, sy), count = 0;
    while (open.size() && count++ < maxNodes) {
      const cur = open.pop();
      if (SHUT[cur.i] === gen) continue;
      if (cur.x === gx && cur.y === gy) { best = cur.i; bestH = -1; break; }
      SHUT[cur.i] = gen;
      const ch = hFn(cur.x, cur.y);
      if (ch < bestH) { bestH = ch; best = cur.i; }
      const g0 = G[cur.i];
      for (let d = 0; d < 8; d++) {
        const dx = U.DIRS[d][0], dy = U.DIRS[d][1];
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (SHUT[ni] === gen) continue;
        const goal = nx === gx && ny === gy;
        if (!goal && !passable(nx, ny)) continue;
        if (dx && dy && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue;
        const g = g0 + (dx && dy ? 1.4142 : 1);
        if (SEEN[ni] !== gen || g < G[ni]) {
          SEEN[ni] = gen; G[ni] = g; CAME[ni] = cur.i;
          open.push({ i: ni, x: nx, y: ny, f: g + hFn(nx, ny) });
        }
      }
    }
    if (best === start) return null;
    const path = [];
    for (let c = best; c !== start && c >= 0; c = CAME[c]) path.push([c % w, (c / w) | 0]);
    path.reverse();
    return path.length ? path : null;
  },
  DIRS: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],

  /* A short straight walk between two tiles, or null if anything blocks it. Lets a unit take a step or two without
     paying for a full search, which is most of what walking units actually ask for. */
  walkLine(sx, sy, gx, gy, passable, maxSteps) {
    const out = []; let x = sx, y = sy;
    for (let i = 0; i < maxSteps; i++) {
      if (x === gx && y === gy) return out;
      const dx = U.sign(gx - x), dy = U.sign(gy - y), nx = x + dx, ny = y + dy;
      if (!passable(nx, ny)) return null;
      if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) return null;
      out.push([nx, ny]); x = nx; y = ny;
    }
    return x === gx && y === gy ? out : null;
  },

  /* Spiral search for the nearest tile satisfying pred, within radius r. */
  nearestTile(cx, cy, r, pred) {
    cx = Math.round(cx); cy = Math.round(cy);
    if (pred(cx, cy)) return [cx, cy];
    for (let d = 1; d <= r; d++) {
      let best = null, bd = Infinity;
      for (let x = cx - d; x <= cx + d; x++) for (let y = cy - d; y <= cy + d; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d) continue;
        if (pred(x, y)) { const dd = U.dist2(x, y, cx, cy); if (dd < bd) { bd = dd; best = [x, y]; } }
      }
      if (best) return best;
    }
    return null;
  },
};

/* Minimal binary heap keyed on .f */
class BinaryHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
