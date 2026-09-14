/* Dawn of Empires — small shared helpers. Everything hangs off a single global `U`. */
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
    const idx = (x, y) => y * w + x;
    const open = new BinaryHeap();
    const gScore = new Map(), came = new Map(), closed = new Set();
    const hFn = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    const start = idx(sx, sy);
    gScore.set(start, 0);
    open.push({ i: start, x: sx, y: sy, f: hFn(sx, sy) });
    let best = { i: start, x: sx, y: sy, h: hFn(sx, sy) };
    let n = 0;
    while (open.size() && n++ < maxNodes) {
      const cur = open.pop();
      if (closed.has(cur.i)) continue;
      if (cur.x === gx && cur.y === gy) { best = cur; break; }
      closed.add(cur.i);
      const ch = hFn(cur.x, cur.y);
      if (ch < best.h) best = { i: cur.i, x: cur.x, y: cur.y, h: ch };
      const g0 = gScore.get(cur.i);
      for (let d = 0; d < 8; d++) {
        const dx = U.DIRS[d][0], dy = U.DIRS[d][1];
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = idx(nx, ny);
        if (closed.has(ni)) continue;
        const goal = nx === gx && ny === gy;
        if (!goal && !passable(nx, ny)) continue;
        if (dx && dy && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue;
        const g = g0 + (dx && dy ? 1.4142 : 1);
        if (g < (gScore.get(ni) ?? Infinity)) {
          gScore.set(ni, g); came.set(ni, cur.i);
          open.push({ i: ni, x: nx, y: ny, f: g + hFn(nx, ny) });
        }
      }
    }
    if (best.i === start) return null;
    const path = [];
    let c = best.i;
    while (c !== start) { path.push([c % w, Math.floor(c / w)]); c = came.get(c); }
    path.reverse();
    return path;
  },
  DIRS: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],

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
