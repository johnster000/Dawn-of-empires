/* Building art. Each shape draws one building at the origin of its footprint in world units (one tile is 64 x 32,
   height in pixels), back to front, into a sprite the renderer caches per look. Only the two faces that turn towards
   the viewer are ever seen: the +y face (lower left, lit) and the +x face (lower right, shaded), so doors, windows and
   anything fixed to a wall go on those two. Every building keeps its silhouette through the ages; the age changes its
   materials (this.mat, which box and gable texture with) and adds one detail. */
Object.assign(Renderer, {
  /* ---- helpers ---- */
  plain(fn) { const m = this.mat; this.mat = null; fn(); this.mat = m; },
  withMat(wallMat, fn) { const m = this.mat; this.mat = { wallMat, roofMat: m && m.roofMat }; fn(); this.mat = m; },
  line3(x0, y0, z0, x1, y1, z1, col, lw) { const g = this.g, a = this.P(x0, y0, z0), b = this.P(x1, y1, z1); g.strokeStyle = col; g.lineWidth = lw || 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); },
  post(x, y, z0, z1, w, col) { col = col || '#7a5a3a'; this.line3(x, y, z0, x, y, z1, U.shade(col, -0.35), (w || 3) + 1); const g = this.g, a = this.P(x, y, z0), b = this.P(x, y, z1); g.strokeStyle = col; g.lineWidth = (w || 3) * 0.55; g.beginPath(); g.moveTo(a[0] - (w || 3) * 0.2, a[1]); g.lineTo(b[0] - (w || 3) * 0.2, b[1]); g.stroke(); },
  /* A shape on a visible face: face 'y' is the wall at y = at, running along x; face 'x' the wall at x = at. */
  onFace(face, at, u, v) { return face === 'y' ? this.P(u, at, v) : this.P(at, u, v); },
  opening(face, at, u, hw, z0, h, col, arched) {
    const pts = [this.onFace(face, at, u - hw, z0), this.onFace(face, at, u - hw, z0 + h * (arched ? 0.72 : 1))];
    if (arched) for (let k = 1; k < 8; k++) { const t = Math.PI - (k / 8) * Math.PI; pts.push(this.onFace(face, at, u + Math.cos(t) * hw, z0 + h * 0.72 + Math.sin(t) * h * 0.28)); }
    pts.push(this.onFace(face, at, u + hw, z0 + h * (arched ? 0.72 : 1)), this.onFace(face, at, u + hw, z0));
    this.poly(pts, col || '#2a1e14');
  },
  pane(face, at, u, z, tall) { this.opening(face, at, u, 0.085, z, tall ? 11 : 7, '#2a1e14', tall); this.opening(face, at, u, 0.055, z + 1, tall ? 9 : 5, 'rgba(255,225,150,0.85)', tall); },
  /* Gable with its ridge along y; the gable end faces the viewer's left. */
  gableY(x0, y0, x1, y1, h, rise, roof, dark, endCol, o) {
    o = o == null ? 0.1 : o; const xm = (x0 + x1) / 2, P = (x, y, z) => this.P(x, y, z);
    const A = P(x0 - o, y0 - o, h - 2), B = P(x1 + o, y0 - o, h - 2), C = P(x1 + o, y1 + o, h - 2), D = P(x0 - o, y1 + o, h - 2), M1 = P(xm, y0 - o, h + rise), M2 = P(xm, y1 + o, h + rise);
    this.poly([A, M1, M2, D], U.shade(roof, 0.08)); if (this.mat && this.mat.roofMat) this.texQuad([M1, M1, D, A], this.mat.roofMat, roof);
    this.poly([P(x0, y1, h), P(x1, y1, h), P(xm, y1, h + rise)], endCol);
    this.poly([M1, B, C, M2], dark); if (this.mat && this.mat.roofMat) this.texQuad([M1, B, C, M2], this.mat.roofMat, dark);
    const g = this.g; g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(M1[0], M1[1]); g.lineTo(M2[0], M2[1]); g.stroke();
    this.flagSpot(xm, y1 + o - 0.1, h + rise - 1, true);
  },
  /* Hipped (or, with inset near half the width, pyramid) roof. */
  hip(x0, y0, x1, y1, h, rise, roof, dark, inset) {
    inset = inset || 0; const o = 0.12, P = (x, y, z) => this.P(x, y, z);
    const A = P(x0 - o, y0 - o, h), B = P(x1 + o, y0 - o, h), C = P(x1 + o, y1 + o, h), D = P(x0 - o, y1 + o, h), M1 = P(x0 + inset, (y0 + y1) / 2, h + rise), M2 = P(x1 - inset, (y0 + y1) / 2, h + rise);
    this.poly([A, B, M2, M1], dark); this.poly([B, C, M2], U.shade(dark, -0.15)); this.poly([M1, M2, C, D], roof); this.poly([D, A, M1], U.shade(roof, 0.1));
    if (this.mat && this.mat.roofMat) this.texQuad([M1, M2, C, D], this.mat.roofMat, roof);
    const g = this.g; g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(M1[0], M1[1]); g.lineTo(M2[0], M2[1]); g.stroke();
  },
  /* Lean-to roof: high along one edge ('x0' or 'y0'), sloping down to the opposite one. */
  lean(x0, y0, x1, y1, hLow, hHigh, roof, dark, highEdge) {
    const o = 0.08, P = (x, y, z) => this.P(x, y, z);
    if (highEdge === 'x0') {
      this.poly([P(x0 - o, y0 - o, hHigh), P(x1 + o, y0 - o, hLow), P(x1 + o, y1 + o, hLow), P(x0 - o, y1 + o, hHigh)], roof);
      this.poly([P(x0 - o, y1 + o, hHigh), P(x1 + o, y1 + o, hLow), P(x1 + o, y1 + o, hLow - 2), P(x0 - o, y1 + o, hHigh - 2)], U.shade(dark, 0.1));
    } else {
      this.poly([P(x0 - o, y0 - o, hHigh), P(x1 + o, y0 - o, hHigh), P(x1 + o, y1 + o, hLow), P(x0 - o, y1 + o, hLow)], roof);
      this.poly([P(x1 + o, y0 - o, hHigh), P(x1 + o, y1 + o, hLow), P(x1 + o, y1 + o, hLow - 2), P(x1 + o, y0 - o, hHigh - 2)], dark);
    }
    if (this.mat && this.mat.roofMat) { const q = highEdge === 'x0' ? [P(x0 - o, y0 - o, hHigh), P(x1 + o, y0 - o, hLow), P(x1 + o, y1 + o, hLow), P(x0 - o, y1 + o, hHigh)] : [P(x0 - o, y0 - o, hHigh), P(x1 + o, y0 - o, hHigh), P(x1 + o, y1 + o, hLow), P(x0 - o, y1 + o, hLow)]; this.texQuad(q, this.mat.roofMat, roof); }
  },
  cyl(x, y, r, z0, h, col, dark, top, kind) {
    const g = this.g, [sx, sy] = this.P(x, y, z0), rx = r * 45.25, ry = r * 22.6, ty = sy - h;
    const gr = g.createLinearGradient(sx - rx, 0, sx + rx, 0); gr.addColorStop(0, U.shade(col, 0.1)); gr.addColorStop(0.45, col); gr.addColorStop(1, dark);
    g.beginPath(); g.moveTo(sx - rx, ty); g.lineTo(sx - rx, sy); g.ellipse(sx, sy, rx, ry, 0, Math.PI, 0, true); g.lineTo(sx + rx, ty); g.ellipse(sx, ty, rx, ry, 0, 0, Math.PI, false); g.closePath(); g.fillStyle = gr; g.fill();
    if (kind) { g.save(); g.clip(); g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1; const step = kind === 'plank' ? 4 : 6; for (let yy = ty + step; yy < sy + ry; yy += step) { g.beginPath(); g.ellipse(sx, yy, rx, ry, 0, 0, Math.PI); g.stroke(); } if (kind === 'plank') for (let k = -3; k <= 3; k++) { const xx = sx + Math.sin(k / 3.4) * rx; g.beginPath(); g.moveTo(xx, ty); g.lineTo(xx, sy + ry * Math.cos(k / 3.4)); g.stroke(); } g.restore(); }
    if (top) { g.beginPath(); g.ellipse(sx, ty, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = top; g.fill(); }
  },
  cone(x, y, r, z, h, col, dark) {
    const g = this.g, [sx, sy] = this.P(x, y, z), rx = r * 45.25, ry = r * 22.6;
    const gr = g.createLinearGradient(sx - rx, 0, sx + rx, 0); gr.addColorStop(0, U.shade(col, 0.12)); gr.addColorStop(0.5, col); gr.addColorStop(1, dark);
    g.beginPath(); g.moveTo(sx - rx, sy); g.lineTo(sx, sy - h); g.lineTo(sx + rx, sy); g.ellipse(sx, sy, rx, ry, 0, 0, Math.PI, false); g.closePath(); g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1; for (let k = 1; k < 5; k++) { const t = k / 5; g.beginPath(); g.ellipse(sx, sy - h * (1 - t), rx * t, ry * t, 0, 0, Math.PI); g.stroke(); }
  },
  dome(x, y, r, z, hz, col, dark) {
    const g = this.g, [sx, sy] = this.P(x, y, z), rx = r * 45.25, ry = r * 22.6;
    const gr = g.createRadialGradient(sx - rx * 0.35, sy - hz * 0.7, 2, sx, sy - hz * 0.3, rx * 1.2); gr.addColorStop(0, U.shade(col, 0.3)); gr.addColorStop(0.6, col); gr.addColorStop(1, dark);
    g.beginPath(); g.moveTo(sx - rx, sy); g.ellipse(sx, sy, rx, hz, 0, Math.PI, 0, false); g.ellipse(sx, sy, rx, ry, 0, 0, Math.PI, false); g.closePath(); g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.ellipse(sx, sy, Math.abs(k) * rx / 3, hz, 0, Math.PI, 0, false); g.stroke(); }
  },
  /* A log lying along y (end facing the viewer's lower left) or along x (end facing lower right): bark and a ringed end. */
  log(axis, a, b0, b1, z, r) {
    const g = this.g, e0 = axis === 'y' ? this.P(a, b0, z) : this.P(b0, a, z), e1 = axis === 'y' ? this.P(a, b1, z) : this.P(b1, a, z);
    g.lineCap = 'butt'; g.strokeStyle = '#4a3320'; g.lineWidth = r * 2 + 1.2; g.beginPath(); g.moveTo(e0[0], e0[1] - r); g.lineTo(e1[0], e1[1] - r); g.stroke();
    g.strokeStyle = '#7a5530'; g.lineWidth = r * 2 - 0.8; g.beginPath(); g.moveTo(e0[0], e0[1] - r); g.lineTo(e1[0], e1[1] - r); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(e0[0], e0[1] - r * 0.4); g.lineTo(e1[0], e1[1] - r * 0.4); g.stroke();
    g.strokeStyle = 'rgba(255,230,190,0.25)'; g.beginPath(); g.moveTo(e0[0], e0[1] - r * 1.6); g.lineTo(e1[0], e1[1] - r * 1.6); g.stroke();
    this.ell(e1[0], e1[1] - r, r * 0.8, r, '#c9a26b', '#5a3f22'); this.ell(e1[0], e1[1] - r, r * 0.45, r * 0.55, null, 'rgba(90,60,30,0.6)'); g.fillStyle = '#8a6238'; g.fillRect(e1[0] - 0.5, e1[1] - r - 0.5, 1, 1);
  },
  heapAt(x, y, r, col, dark, n) { const g = this.g, [sx, sy] = this.P(x, y, 0); n = n || 9; for (let i = 0; i < n; i++) { const a = i * 2.4, d = Math.sqrt(i / n) * r; const cx = sx + Math.cos(a) * d * 1.4, cy = sy + Math.sin(a) * d * 0.7 - (r - d) * 0.8; g.beginPath(); g.ellipse(cx, cy, 5, 3.8, 0, 0, 7); g.fillStyle = i % 2 ? col : dark; g.fill(); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(cx - 2, cy - 2.5, 2, 1); } },
  wheelAt(x, y, z, r, col, faceX) { const g = this.g, [sx, sy] = this.P(x, y, z); g.save(); g.translate(sx, sy); g.transform(1, faceX ? 0.5 : -0.5, 0, 1, 0, 0); g.strokeStyle = col; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); g.lineWidth = 1.3; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); } g.restore(); },
  glowAt(x, y, z, r) { const g = this.g, [sx, sy] = this.P(x, y, z); const gr = g.createRadialGradient(sx, sy, 1, sx, sy, r); gr.addColorStop(0, 'rgba(255,190,80,.95)'); gr.addColorStop(0.4, 'rgba(255,120,30,.6)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill(); },
  /* A row of stakes or rails between points, drawn back to front. */
  stakes(x0, y0, x1, y1, h, step) { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (step || 0.12))); const pts = []; for (let k = 0; k <= n; k++) pts.push([U.lerp(x0, x1, k / n), U.lerp(y0, y1, k / n)]); pts.sort((a, b) => a[0] + a[1] - b[0] - b[1]); for (const [x, y] of pts) this.stake(x, y, h, 4.5, { wall: '#8d6c3e', dark: '#5f4728', top: '#a88852' }); },
  rails(x0, y0, x1, y1, h) { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.45)); for (let k = 0; k <= n; k++) this.post(U.lerp(x0, x1, k / n), U.lerp(y0, y1, k / n), 0, h, 2); this.line3(x0, y0, h * 0.85, x1, y1, h * 0.85, '#7a5a3a', 1.6); this.line3(x0, y0, h * 0.45, x1, y1, h * 0.45, '#7a5a3a', 1.6); },
  banner(x, y, z, h, col) { const g = this.g, [sx, sy] = this.P(x, y, z); g.strokeStyle = '#2a1c10'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - h); g.stroke(); this.poly([[sx + 1, sy - h + 2], [sx + 9, sy - h + 2], [sx + 9, sy - h + 22], [sx + 5, sy - h + 18], [sx + 1, sy - h + 22]], col); g.fillStyle = U.shade(col, -0.35); g.fillRect(sx + 1, sy - h + 2, 8, 2); },
  anvil(x, y) { const g = this.g; this.cyl(x, y, 0.1, 0, 5, '#8a6238', '#5a3f22', '#b8905a'); const [ax, ay] = this.P(x, y, 5); g.fillStyle = '#3a3a42'; g.fillRect(ax - 2.5, ay - 4, 5, 4); g.fillRect(ax - 6, ay - 7, 11, 3.2); this.poly([[ax + 5, ay - 7], [ax + 9, ay - 6], [ax + 5, ay - 3.8]], '#3a3a42'); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(ax - 5, ay - 7, 8, 1); },

  /* ---- Town Hall: a long hall with a bell tower rising from its middle (the Dawn Age keeps the pavilion) ---- */
  shape_hall(b, age, p) {
    if (b.ageVisual === 0) { this.pavilion(b, age, p); return; }
    const a = b.ageVisual || 1, m = age, t0 = 1.05, t1 = 1.95, th = a >= 2 ? 62 : 56;
    this.box(0.2, 0.5, 2.8, 2.5, 0, 24, m.wall, m.wallDark, m.roof);
    this.pane('y', 2.5, 0.55, 10); this.pane('y', 2.5, 2.45, 10); this.pane('x', 2.8, 1.0, 10); this.pane('x', 2.8, 2.0, 10);
    // a team banner hung on the wall beside the door, and the door itself, both under the porch
    const bn = this.P(0.95, 2.5, 18), g = this.g; g.fillStyle = p.color.main; g.fillRect(bn[0] - 3, bn[1], 6, 13); g.fillStyle = m.trim; g.fillRect(bn[0] - 4, bn[1] - 1, 8, 2);
    this.opening('y', 2.5, 1.5, 0.2, 0, 16, p.color.dark, true);
    this.gable(0.2, 0.5, 2.8, 2.5, 24, 16, m.roof, m.roofDark);
    // the tower comes up through the roof
    this.box(t0, t0, t1, t1, 30, th - 30, m.wall, m.wallDark, m.trim);
    if (a === 1) {
      this.plain(() => { for (const [x, y] of [[t0 + 0.05, t1 - 0.05], [t1 - 0.05, t1 - 0.05], [t1 - 0.05, t0 + 0.05]]) this.post(x, y, th, th + 16, 3); });
      const [bx, by] = this.P(1.5, 1.5, th + 12); g.fillStyle = '#b89040'; g.beginPath(); g.moveTo(bx - 5, by + 6); g.quadraticCurveTo(bx - 4, by - 4, bx, by - 5); g.quadraticCurveTo(bx + 4, by - 4, bx + 5, by + 6); g.fill();
      this.hip(t0 - 0.05, t0 - 0.05, t1 + 0.05, t1 + 0.05, th + 16, 16, m.roof, m.roofDark, 0.45); this.flagSpot(1.5, 1.5, th + 31);
    } else if (a === 2) {
      this.opening('y', t1, 1.5, 0.16, th - 18, 14, '#221810', true); this.opening('x', t1, 1.5, 0.16, th - 18, 14, '#221810', true);
      this.hip(t0 - 0.08, t0 - 0.08, t1 + 0.08, t1 + 0.08, th, 26, m.roof, m.roofDark, 0.45); this.flagSpot(1.5, 1.5, th + 25);
    } else {
      this.opening('y', t1, 1.5, 0.16, th - 18, 14, '#221810', true); this.opening('x', t1, 1.5, 0.16, th - 18, 14, '#221810', true);
      this.box(t0 + 0.1, t0 + 0.1, t1 - 0.1, t1 - 0.1, th, 5, m.wall, m.wallDark, m.trim);
      this.dome(1.5, 1.5, 0.36, th + 5, 22, m.roof, m.roofDark); this.cyl(1.5, 1.5, 0.08, th + 25, 8, m.trim, U.shade(m.trim, -0.3), m.trim); this.flagSpot(1.5, 1.5, th + 33);
    }
    // porch: posts in front, then its roof over the door and banner
    this.plain(() => { this.post(1.2, 2.8, 0, 12, 2.4); this.post(1.8, 2.8, 0, 12, 2.4); });
    this.lean(1.12, 2.5, 1.88, 2.86, 12, 16, m.roofDark, U.shade(m.roofDark, -0.2));
  },

  /* ---- House: the one building that looks like a home ---- */
  shape_house(b, age, p) {
    const a = b.ageVisual || 0, m = age, hh = a === 3 ? 26 : 16, g = this.g;
    this.box(0.35, 0.4, 1.6, 1.55, 0, 16, m.wall, m.wallDark, m.roof);
    if (a === 3) this.box(0.3, 0.35, 1.65, 1.6, 16, 10, m.wall, m.wallDark, m.roof);
    this.opening('y', 1.55, 0.95, 0.14, 0, 12, p.color.dark, true); this.pane('x', 1.6, 1.0, 8);
    if (a === 3) { this.pane('y', 1.6, 0.6, 18); this.pane('y', 1.6, 1.3, 18); }
    this.gableY(0.35, 0.4, 1.6, 1.55, hh, 18, m.roof, m.roofDark, m.wall);
    const stone = a >= 2; this.withMat(stone ? 'stone' : null, () => this.box(1.2, 0.55, 1.4, 0.75, hh, 18, stone ? '#9a948a' : m.wallDark, stone ? '#6e6960' : U.shade(m.wallDark, -0.2), '#3a3030'));
    // a woodpile against the right-hand wall: logs lying end-on to the viewer, under a little lean-to
    this.plain(() => {
      for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) this.log('x', 0.72 + i * 0.2 + row * 0.1, 1.64, 1.92, 3 + row * 6, 3.2);
      this.post(1.95, 0.55, 0, 19, 2); this.post(1.95, 1.45, 0, 19, 2);
      this.lean(1.6, 0.5, 2.0, 1.5, 17, 20, m.roofDark, U.shade(m.roofDark, -0.2), 'x0');
    });
    this.plain(() => this.rails(0.15, 1.85, 1.35, 1.85, 7));
  },

  /* ---- Granary: two round silos with cone roofs ---- */
  shape_barn(b, age, p) {
    const a = b.ageVisual || 0, m = age, h = a === 3 ? 30 : 22, stilt = a <= 1 ? 6 : 0, wc = a === 0 ? '#9a7b52' : m.wall, wd = a === 0 ? '#6a5236' : m.wallDark;
    const silo = (x, y, r) => { if (stilt) this.plain(() => { for (const [dx, dy] of [[-0.2, 0.2], [0.2, 0.2], [0.2, -0.2]]) this.post(x + dx, y + dy, 0, stilt + 2, 2.4); }); this.cyl(x, y, r, stilt, h, wc, wd, null, a === 0 ? 'plank' : a >= 2 ? 'stone' : null); this.cone(x, y, r + 0.08, stilt + h, 22, m.roof, m.roofDark); };
    silo(1.3, 0.62, 0.34);
    if (a === 3) this.plain(() => { this.post(1.65, 1.1, 0, 44, 2.4); this.line3(1.65, 1.1, 44, 1.3, 0.8, 44, '#523b25', 2); });
    silo(0.62, 1.3, 0.34);
    this.heapAt(1.2, 1.35, 7, '#d8b860', '#b8955c', 7);
    const [lx, ly] = this.P(1.05, 0.95, 0), g = this.g; g.strokeStyle = '#523b25'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(lx - 3, ly); g.lineTo(lx + 2, ly - 30); g.moveTo(lx + 3, ly + 2); g.lineTo(lx + 8, ly - 28); g.stroke();
    this.flagSpot(1.3, 0.62, stilt + h + 21);
  },

  /* ---- Lumber Camp and Mining Camp ---- */
  shape_camp(b, age, p) { if (b.type === 'miningcamp') this.miningCamp(b, age, p); else this.lumberCamp(b, age, p); },
  /* An open shed on four posts over a sawhorse, with a stack of logs beside it. */
  lumberCamp(b, age, p) {
    const a = b.ageVisual || 0, m = age;
    this.plain(() => {
      this.post(0.2, 0.25, 0, 26, 2.8); this.post(1.05, 0.25, 0, 26, 2.8);
      // sawhorse with a log on it
      this.post(0.45, 0.85, 0, 7, 1.6); this.post(0.75, 0.85, 0, 7, 1.6); this.post(0.45, 1.25, 0, 7, 1.6); this.post(0.75, 1.25, 0, 7, 1.6);
      this.log('y', 0.6, 0.7, 1.45, 8, 3);
      this.post(0.2, 1.75, 0, 18, 2.8); this.post(1.05, 1.75, 0, 18, 2.8);
    });
    this.lean(0.15, 0.2, 1.1, 1.8, 18, 26, m.roof, m.roofDark, 'y0');
    this.plain(() => {
      // the stack: logs lying along x with their cut ends towards the viewer's right
      for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) this.log('x', 0.45 + i * 0.26 + row * 0.13, 1.3, 1.88, 2 + row * 7, 4);
      if (a >= 2) { this.post(0.2, 2.0, 0, 16, 2.4); this.post(0.7, 2.0, 0, 16, 2.4); this.line3(0.2, 2.0, 16, 0.7, 2.0, 16, '#7a5a3a', 2.4); this.line3(0.45, 2.0, 16, 0.45, 2.0, 2, '#b8bcc4', 1.2); }
      // chopping block with the axe in it
      this.cyl(1.35, 1.75, 0.1, 0, 6, '#8a6238', '#5a3f22', '#c9a26b'); const [ax, ay] = this.P(1.35, 1.75, 6), g = this.g; g.strokeStyle = '#5a3f22'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + 6, ay - 8); g.stroke(); this.poly([[ax - 1, ay + 1], [ax + 3, ay - 2], [ax + 1, ay + 3]], '#9aa0a8');
    });
    this.flagSpot(1.1, 0.2, 27);
  },
  /* A small working: a windlass over the shaft, a tool shed, an ore cart and heaps of stone and gold. */
  miningCamp(b, age, p) {
    const a = b.ageVisual || 0, m = age, stone = a >= 2;
    // the shaft with its collar
    this.withMat(stone ? 'stone' : null, () => this.box(0.3, 0.35, 0.9, 0.95, 0, stone ? 5 : 3, stone ? '#9a948a' : '#7a5a3a', stone ? '#6e6960' : '#523b25', '#1a1410'));
    this.poly([this.P(0.4, 0.45, stone ? 5 : 3), this.P(0.8, 0.45, stone ? 5 : 3), this.P(0.8, 0.85, stone ? 5 : 3), this.P(0.4, 0.85, stone ? 5 : 3)], '#0e0a08');
    // tool shed at the back
    this.box(1.15, 0.2, 1.8, 0.75, 0, 12, m.wall, m.wallDark, m.roof);
    this.opening('y', 0.75, 1.45, 0.12, 0, 9, '#2a1e14', false);
    this.lean(1.15, 0.2, 1.8, 0.75, 12, 16, m.roof, m.roofDark, 'y0');
    // windlass: two posts, a drum between them with a crank, the rope going down
    this.plain(() => {
      const hz = 14, drum = stone ? '#55555c' : '#6a4a2a';
      this.post(0.3, 0.65, 0, hz, 2.6);
      this.line3(0.32, 0.65, hz - 2, 0.88, 0.65, hz - 2, U.shade(drum, -0.3), 5.5); this.line3(0.32, 0.65, hz - 1.5, 0.88, 0.65, hz - 1.5, drum, 3.5);
      this.line3(0.6, 0.65, hz - 4, 0.6, 0.65, 2, '#c8b89a', 1);
      this.post(0.9, 0.65, 0, hz, 2.6); this.line3(0.94, 0.65, hz - 2, 1.02, 0.65, hz - 2, '#3a3a42', 1.4); this.line3(1.02, 0.65, hz - 2, 1.02, 0.65, hz - 7, '#3a3a42', 1.4);
    });
    // rails and a cart of ore, heaps beside
    this.line3(1.1, 1.2, 0, 1.9, 1.2, 0, '#4a3a2a', 1.6); this.line3(1.1, 1.45, 0, 1.9, 1.45, 0, '#4a3a2a', 1.6);
    this.heapAt(0.45, 1.5, 7, '#9a948a', '#6e6960', 8);
    this.plain(() => { this.box(1.4, 1.2, 1.75, 1.45, 2, 7, '#7a5a3a', '#523b25', '#3a2a1a'); this.wheelAt(1.48, 1.45, 2.5, 2.5, '#2a2020', false); this.wheelAt(1.68, 1.45, 2.5, 2.5, '#2a2020', false); });
    this.heapAt(1.58, 1.32, 3, '#d8b040', '#a88420', 4);
    this.heapAt(0.95, 1.85, 6, '#d8b040', '#b8902a', 7);
    this.flagSpot(1.8, 0.2, 17);
  },

  /* ---- Barracks: a longhouse behind a fenced drill yard with dummies, a spear rack and tall banners ---- */
  shape_longhouse(b, age, p) {
    const a = b.ageVisual || 0, m = age, g = this.g, team = a === 3 ? '#c9a54a' : p.color.main;
    this.box(0.2, 0.2, 2.8, 1.2, 0, 22, m.wall, m.wallDark, a >= 2 ? m.trim : m.roof);
    if (a === 3) for (let x = 0.5; x < 2.7; x += 0.55) this.opening('y', 1.2, x, 0.14, 0, 15, '#221810', true);
    else { this.opening('y', 1.2, 1.5, 0.16, 0, 14, p.color.dark, true); this.pane('y', 1.2, 0.7, 11); this.pane('y', 1.2, 2.3, 11); }
    this.pane('x', 2.8, 0.7, 12);
    if (a >= 2) { for (let x = 0.3; x < 2.8; x += 0.3) this.box(x, 0.2, x + 0.14, 0.32, 22, 6, m.wall, m.wallDark, m.trim); for (let y = 0.3; y < 1.2; y += 0.3) this.box(0.2, y, 0.32, y + 0.14, 22, 6, m.wall, m.wallDark, m.trim); for (let x = 0.3; x < 2.8; x += 0.3) this.box(x, 1.08, x + 0.14, 1.2, 22, 6, m.wall, m.wallDark, m.trim); for (let y = 0.3; y < 1.2; y += 0.3) this.box(2.68, y, 2.8, y + 0.14, 22, 6, m.wall, m.wallDark, m.trim); this.flagSpot(2.7, 0.3, 28); }
    else this.gable(0.2, 0.2, 2.8, 1.2, 22, 16, m.roof, m.roofDark);
    this.plain(() => {
      // the yard: back (left) fence first, then what stands in it, then the front and right fences
      this.stakes(0.15, 1.35, 0.15, 2.85, 11);
      const dummy = (x, y) => { this.post(x, y, 0, 18, 2.4); const [sx, sy] = this.P(x, y, 18); g.fillStyle = '#d8b860'; g.beginPath(); g.ellipse(sx, sy - 2, 5, 7, 0, 0, 7); g.fill(); this.line3(x - 0.15, y + 0.15, 14, x + 0.15, y - 0.15, 14, '#523b25', 2.4); g.fillStyle = '#c9a850'; g.beginPath(); g.arc(sx, sy - 12, 3.2, 0, 7); g.fill(); };
      const [rx, ry] = this.P(0.45, 2.3, 0); for (let i = 0; i < 5; i++) { g.strokeStyle = '#523b25'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(rx - 8 + i * 4, ry); g.lineTo(rx - 6 + i * 4, ry - 26); g.stroke(); this.poly([[rx - 7 + i * 4, ry - 26], [rx - 6 + i * 4, ry - 31], [rx - 5 + i * 4, ry - 26]], '#b8bcc4'); }
      dummy(0.9, 1.8); dummy(2.1, 2.05);
      this.stakes(2.85, 1.35, 2.85, 2.85, 11);
      this.stakes(0.15, 2.85, 1.25, 2.85, 11); this.stakes(1.75, 2.85, 2.85, 2.85, 11);
      this.banner(1.25, 2.95, 0, 44, team); this.banner(1.75, 2.95, 0, 44, team);
    });
  },

  /* ---- Archery Range: an open shooting shed and a lane ending in straw targets ---- */
  shape_range(b, age, p) {
    const m = age, g = this.g;
    this.poly([this.P(1.0, 0.25), this.P(2.9, 0.25), this.P(2.9, 2.75), this.P(1.0, 2.75)], 'rgba(120,150,70,0.35)');
    // the shed: a solid back wall, back and front posts, and a roof sloping down towards the lane
    this.box(0.12, 0.2, 0.28, 2.8, 0, 22, m.wall, m.wallDark, m.trim);
    this.plain(() => { for (let y = 0.3; y <= 2.8; y += 0.62) this.post(0.85, y, 0, 17, 2.6); });
    this.lean(0.12, 0.2, 0.9, 2.8, 17, 24, m.roof, m.roofDark, 'x0');
    // a quiver rack under the eaves
    this.plain(() => { const [qx, qy] = this.P(0.6, 2.7, 0); g.fillStyle = '#6a4d30'; g.fillRect(qx - 5, qy - 12, 3, 11); g.fillRect(qx + 1, qy - 12, 3, 11); g.fillStyle = '#e8e0d0'; g.fillRect(qx - 5, qy - 14, 3, 2); g.fillRect(qx + 1, qy - 14, 3, 2); });
    // targets at the far end of the lane
    for (let k = 0; k < 3; k++) {
      const x = 2.55, y = 0.7 + k * 0.8; this.plain(() => { this.post(x + 0.08, y - 0.08, 0, 12, 1.6); this.post(x + 0.08, y + 0.08, 0, 12, 1.6); });
      const [sx, sy] = this.P(x, y, 14); g.save(); g.translate(sx, sy); g.transform(1, -0.5, 0, 1, 0, 0); for (const [r, col] of [[9, '#e8dcc4'], [6.5, p.color.main], [4, '#e8dcc4'], [1.8, '#d8b040']]) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = col; g.fill(); } g.strokeStyle = '#5a3f22'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.stroke(); g.restore();
      this.heapAt(x + 0.1, y, 3, '#d8b860', '#b8955c', 4);
    }
    this.plain(() => { this.rails(2.95, 0.15, 2.95, 2.95, 6); this.rails(1.0, 2.95, 2.95, 2.95, 6); });
    this.flagSpot(0.2, 0.35, 29);
  },

  /* ---- Stables: a low barn with a row of stall doors, and a railed paddock ---- */
  shape_stables(b, age, p) {
    const a = b.ageVisual || 1, m = age, g = this.g;
    this.box(0.15, 0.15, 2.85, 1.05, 0, 16, m.wall, m.wallDark, m.roof);
    // stall doors flat on the front wall: dark opening, a lower half-door, a horse looking out of every other one
    for (let k = 0; k < 5; k++) {
      const x = 0.4 + k * 0.5;
      this.opening('y', 1.05, x, 0.16, 0, 12, '#1e160e', false);
      this.opening('y', 1.05, x, 0.16, 0, 6, '#7a5a3a', false);
      this.line3(x - 0.16, 1.05, 6, x + 0.16, 1.05, 6, '#523b25', 1.2);
      if (k % 2 === 0) { const [hx, hy] = this.P(x, 1.05, 9); this.ell(hx - 1, hy, 2.6, 3.4, k === 2 ? '#e8e0d0' : '#6a4a2a'); g.fillStyle = '#1a1010'; g.fillRect(hx - 2, hy - 1.5, 1, 1); }
    }
    this.pane('x', 2.85, 0.6, 9);
    this.hip(0.15, 0.15, 2.85, 1.05, 16, 14, m.roof, m.roofDark, 0.45);
    if (a >= 2) { this.box(1.4, 0.5, 1.6, 0.7, 29, 7, m.wall, m.wallDark, m.roof); this.hip(1.35, 0.45, 1.65, 0.75, 36, 6, m.roof, m.roofDark, 0.15); this.flagSpot(1.5, 0.6, 42); }
    else this.flagSpot(1.5, 0.6, 29);
    this.plain(() => {
      // paddock: the far rail first, then the hay, the horse and the trough, then the near rails in front of them
      this.rails(0.15, 1.45, 0.15, 2.85, 9);
      this.cone(2.35, 1.85, 0.3, 0, 22, '#d8b860', '#a8842a');
      const [hx, hy] = this.P(1.3, 2.1, 0); g.fillStyle = '#7a5a3a'; g.beginPath(); g.ellipse(hx, hy - 12, 11, 5.5, 0, 0, 7); g.fill(); g.fillRect(hx - 9, hy - 10, 2.4, 10); g.fillRect(hx - 5, hy - 10, 2.4, 10); g.fillRect(hx + 5, hy - 10, 2.4, 10); g.fillRect(hx + 8, hy - 10, 2.4, 10); g.beginPath(); g.moveTo(hx + 9, hy - 14); g.lineTo(hx + 15, hy - 25); g.lineTo(hx + 19, hy - 23); g.lineTo(hx + 13, hy - 12); g.fill(); g.fillStyle = '#3a2a1a'; g.fillRect(hx - 12, hy - 14, 2, 8);
      this.box(1.9, 2.5, 2.4, 2.65, 0, 4, '#7a5a3a', '#523b25', '#4a6a8a');
      this.rails(0.15, 2.85, 2.85, 2.85, 9); this.rails(2.85, 1.45, 2.85, 2.85, 9);
    });
  },

  /* ---- Blacksmith: a squat forge under a fat chimney, the fire open at the front, an anvil at the side ---- */
  shape_smithy(b, age, p) {
    const a = b.ageVisual || 1, m = age, s = a >= 2;
    this.box(0.3, 0.2, 1.7, 1.15, 0, 14, m.wall, m.wallDark, m.roof);
    this.opening('x', 1.7, 0.55, 0.14, 0, 11, '#1a120c', true);
    this.gable(0.3, 0.2, 1.7, 1.15, 14, 10, m.roof, m.roofDark, 0.1);
    this.withMat('stone', () => { this.box(0.45, 0.35, 0.85, 0.75, 14, 36, s ? '#9a948a' : '#7a6a5a', s ? '#6e6960' : '#5a4c40', '#2a2420'); if (s) this.box(1.0, 0.35, 1.22, 0.57, 14, 24, '#9a948a', '#6e6960', '#2a2420'); });
    // the open forge under a lean-to at the front, glowing
    this.plain(() => { this.withMat('stone', () => this.box(0.6, 1.25, 1.0, 1.55, 0, 7, '#9a948a', '#6e6960', '#3a3030')); });
    this.glowAt(0.8, 1.4, 9, 13);
    this.plain(() => { this.post(0.52, 1.62, 0, 10, 2.2); this.post(1.08, 1.62, 0, 10, 2.2); });
    this.lean(0.45, 1.15, 1.15, 1.66, 10, 13, m.roofDark, U.shade(m.roofDark, -0.2), 'y0');
    // at the side: the anvil on its stump, the quench barrel and a grinding wheel
    this.plain(() => { this.anvil(1.95, 0.55); this.cyl(1.95, 1.2, 0.12, 0, 9, '#7a5a3a', '#4a3320', '#35506a', 'plank'); this.wheelAt(1.9, 1.62, 6, 5, '#8a8680', true); });
    if (a === 3) this.plain(() => this.wheelAt(1.72, 0.3, 14, 11, '#523b25', true));
    this.flagSpot(1.6, 0.68, 25);
  },

  /* ---- Watchtower: a lookout on splayed legs in timber; a tapering stone tower later ---- */
  shape_tower(b, age, p) {
    const a = b.ageVisual || 1, m = age;
    if (a <= 1) {
      const top = 50, i0 = 0.28, i1 = 0.72;
      this.plain(() => {
        this.line3(0.05, 0.05, 0, i0, i0, top, '#7a5a3a', 3.2); this.line3(0.95, 0.05, 0, i1, i0, top, '#7a5a3a', 3.2); this.line3(0.05, 0.95, 0, i0, i1, top, '#7a5a3a', 3.2);
        this.line3(0.15, 0.85, 16, 0.85, 0.85, 34, '#523b25', 1.6); this.line3(0.15, 0.85, 34, 0.85, 0.85, 16, '#523b25', 1.6); this.line3(0.85, 0.15, 16, 0.85, 0.85, 34, '#523b25', 1.6); this.line3(0.85, 0.15, 34, 0.85, 0.85, 16, '#523b25', 1.6);
        this.line3(0.95, 0.95, 0, i1, i1, top, '#7a5a3a', 3.2);
        this.withMat('plank', () => this.box(0.18, 0.18, 0.82, 0.82, top, 4, '#7a5a3a', '#523b25', '#8a6a44'));
      });
      this.box(0.18, 0.18, 0.82, 0.82, top + 4, 9, a === 1 ? m.wall : '#7a5a3a', a === 1 ? m.wallDark : '#523b25', null);
      this.plain(() => { for (const [x, y] of [[0.2, 0.8], [0.8, 0.8], [0.8, 0.2]]) this.post(x, y, top + 4, top + 18, 2); });
      this.hip(0.14, 0.14, 0.86, 0.86, top + 18, 18, m.roof, m.roofDark, 0.36); this.flagSpot(0.5, 0.5, top + 35);
    } else {
      const h = 58, A = [this.P(0.12, 0.88, 0), this.P(0.88, 0.88, 0), this.P(0.76, 0.76, h), this.P(0.24, 0.76, h)];
      this.poly(A, m.wall); this.texQuad([A[3], A[2], A[1], A[0]], m.wallMat, m.wall);
      const B = [this.P(0.88, 0.88, 0), this.P(0.88, 0.12, 0), this.P(0.76, 0.24, h), this.P(0.76, 0.76, h)]; this.poly(B, m.wallDark); this.texQuad([B[3], B[2], B[1], B[0]], m.wallMat, m.wallDark);
      this.opening('y', 0.8, 0.5, 0.07, 30, 9, '#221810', true); this.opening('x', 0.8, 0.5, 0.07, 30, 9, '#221810', true);
      this.box(0.16, 0.16, 0.84, 0.84, h, 10, a === 3 ? m.wall : '#7a5a3a', a === 3 ? m.wallDark : '#523b25', null);
      this.hip(0.1, 0.1, 0.9, 0.9, h + 10, a === 3 ? 34 : 20, m.roof, m.roofDark, 0.4); this.flagSpot(0.5, 0.5, h + (a === 3 ? 43 : 29));
    }
  },

  /* ---- Hall of Scholars: a columned portico under a pediment, a drum and dome behind ---- */
  shape_library(b, age, p) {
    const a = Math.max(2, b.ageVisual || 2), m = age;
    for (let k = 0; k < 3; k++) this.box(0.1 + k * 0.06, 0.1 + k * 0.06, 2.9 - k * 0.06, 2.9 - k * 0.06, k * 2.5, 2.5, m.wall, m.wallDark, U.shade(m.wall, 0.1));
    this.box(0.35, 0.35, 2.65, 2.1, 7.5, 24, m.wall, m.wallDark, m.roof);
    for (const y of [0.8, 1.3, 1.8]) this.pane('x', 2.65, y, 17, true);
    this.cyl(1.5, 1.2, 0.62, 31.5, 12, m.wall, m.wallDark, m.wall, m.wallMat === 'ashlar' ? 'stone' : 'stone');
    this.dome(1.5, 1.2, 0.66, 43.5, 30, a === 3 ? '#c9a54a' : m.roof, a === 3 ? '#8a6a20' : m.roofDark);
    this.cyl(1.5, 1.2, 0.07, 73, 6, m.trim, U.shade(m.trim, -0.3), m.trim);
    // portico: six columns along the front, an entablature, and a proper gabled roof over it
    this.opening('y', 2.1, 1.5, 0.18, 7.5, 16, '#2a1e14', true);
    for (let k = 0; k < 6; k++) this.cyl(0.6 + k * 0.36, 2.55, 0.07, 7.5, 24, U.shade(m.wall, 0.15), m.wallDark, m.wall);
    this.box(0.45, 2.1, 2.55, 2.7, 31.5, 5, m.wall, m.wallDark, m.wall);
    this.gableY(0.45, 2.1, 2.55, 2.7, 36.5, 15, m.roof, m.roofDark, U.shade(m.wall, 0.08), 0.06);
    this.flagSpot(1.5, 1.2, 78);
  },

  /* ---- Keep: a square great tower on an earth mound, round turrets at its corners ---- */
  shape_keep(b, age, p) {
    const m = age, a = Math.max(2, b.ageVisual || 2);
    const P = (x, y) => this.P(x, y, 0), g = this.g;
    this.poly([P(0.02, 0.02), P(1.98, 0.02), P(1.98, 1.98), P(0.02, 1.98)], '#5a6a34');
    this.cone(1, 1, 0.95, 0, 10, '#6f7a40', '#4a5a2a');
    const turret = (x, y) => { this.cyl(x, y, 0.17, 10, 60, m.wall, m.wallDark, null, 'stone'); this.cone(x, y, 0.21, 70, 20, m.roof, m.roofDark); };
    // back turret first, then the tower, then the side turrets, then the front one
    turret(0.4, 0.4);
    this.box(0.4, 0.4, 1.6, 1.6, 10, 50, m.wall, m.wallDark, m.trim);
    for (let x = 0.45; x < 1.6; x += 0.22) this.box(x, 0.4, x + 0.11, 0.5, 60, 6, m.wall, m.wallDark, m.trim);
    for (let y = 0.45; y < 1.6; y += 0.22) this.box(0.4, y, 0.5, y + 0.11, 60, 6, m.wall, m.wallDark, m.trim);
    for (let x = 0.45; x < 1.6; x += 0.22) this.box(x, 1.5, x + 0.11, 1.6, 60, 6, m.wall, m.wallDark, m.trim);
    for (let y = 0.45; y < 1.6; y += 0.22) this.box(1.5, y, 1.6, y + 0.11, 60, 6, m.wall, m.wallDark, m.trim);
    this.opening('y', 1.6, 1.0, 0.13, 12, 14, '#221810', true); this.pane('y', 1.6, 0.8, 40, true); this.pane('x', 1.6, 1.0, 40, true); this.pane('x', 1.6, 0.7, 28, true);
    turret(1.6, 0.4); turret(0.4, 1.6); turret(1.6, 1.6);
    if (a === 3) { this.flagSpot(0.4, 0.4, 89); this.flagSpot(1.6, 0.4, 89); this.flagSpot(0.4, 1.6, 89); this.flagSpot(1.6, 1.6, 89); } else this.flagSpot(0.4, 0.4, 89);
    // a low curtain wall round the foot of the mound, near side only
    this.withMat('stone', () => { this.box(0.02, 1.9, 1.98, 1.98, 0, 7, m.wall, m.wallDark, m.trim); this.box(1.9, 0.02, 1.98, 1.9, 0, 7, m.wall, m.wallDark, m.trim); });
  },

  /* ---- Siege Workshop: a tall open shed, a treadwheel crane and an engine half built ---- */
  shape_workshop(b, age, p) {
    const m = age;
    this.box(0.2, 0.2, 1.4, 0.35, 0, 28, m.wall, m.wallDark, m.roof);
    this.plain(() => { for (let y = 0.4; y <= 2.8; y += 0.8) this.post(1.35, y, 0, 28, 3.4); });
    this.box(0.2, 2.65, 1.4, 2.8, 0, 28, m.wall, m.wallDark, m.roof);
    this.gableY(0.2, 0.2, 1.4, 2.8, 28, 20, m.roof, m.roofDark, m.wall);
    this.plain(() => {
      this.post(2.3, 0.6, 0, 58, 3.4); this.line3(2.3, 0.6, 56, 2.8, 1.6, 42, '#7a5a3a', 3); this.line3(2.8, 1.6, 42, 2.8, 1.6, 20, '#c8b89a', 1);
      this.wheelAt(2.3, 0.95, 16, 15, '#523b25', false); this.post(2.3, 0.95, 0, 16, 2);
      const W = '#7a5a3a', D = '#523b25';
      this.line3(1.8, 1.9, 2, 2.6, 1.9, 2, W, 3.2); this.line3(1.8, 2.4, 2, 2.6, 2.4, 2, W, 3.2); this.line3(2.2, 1.9, 2, 2.2, 1.9, 18, W, 2.6); this.line3(2.2, 2.4, 2, 2.2, 2.4, 18, W, 2.6); this.line3(2.2, 1.9, 18, 2.2, 2.4, 18, D, 2.6); this.line3(2.2, 2.15, 10, 2.7, 2.15, 30, D, 2.4);
      this.wheelAt(1.9, 2.45, 5, 5, D, true); this.wheelAt(2.5, 2.45, 5, 5, D, true);
      for (let k = 0; k < 3; k++) this.box(1.7, 2.7 - k * 0.02, 2.8, 2.82 - k * 0.02, k * 4, 4, W, D, '#a88852');
    });
    this.flagSpot(0.8, 2.82, 47);
  },

  /* ---- Monument: an obelisk on a plinth inside a colonnaded court ---- */
  shape_monument(b, age, p) {
    const s = b.size, st = '#e2dbcd', dk = '#b5ad9e', gold = '#e0c060', g = this.g;
    this.withMat('ashlar', () => this.box(0, 0, s, s, 0, 4, st, dk, '#cfc6b2'));
    const col = (x, y) => this.cyl(x, y, 0.1, 4, 26, st, dk, st);
    const beam = (x0, y0, x1, y1) => this.box(Math.min(x0, x1) - 0.12, Math.min(y0, y1) - 0.12, Math.max(x0, x1) + 0.12, Math.max(y0, y1) + 0.12, 30, 4, st, dk, U.shade(st, -0.04));
    // the far colonnades
    for (let x = 0.3; x < s - 0.2; x += 0.5) col(x, 0.3); for (let y = 0.8; y < s - 0.2; y += 0.5) col(0.3, y);
    beam(0.3, 0.3, s - 0.3, 0.3); beam(0.3, 0.3, 0.3, s - 0.3);
    // plinth, obelisk and its gilded tip
    this.withMat('ashlar', () => this.box(1.5, 1.5, 2.5, 2.5, 4, 8, st, dk, st));
    for (const [x, y] of [[1.55, 2.45], [2.45, 2.45], [2.45, 1.55]]) { const [fx, fy] = this.P(x, y, 12); g.fillStyle = p.color.main; g.fillRect(fx - 2, fy - 9, 4, 8); }
    const L = [this.P(1.75, 2.25, 12), this.P(2.25, 2.25, 12), this.P(2.12, 2.12, 88), this.P(1.88, 2.12, 88)]; this.poly(L, st); this.texQuad([L[3], L[2], L[1], L[0]], 'ashlar', st);
    const R = [this.P(2.25, 2.25, 12), this.P(2.25, 1.75, 12), this.P(2.12, 1.88, 88), this.P(2.12, 2.12, 88)]; this.poly(R, dk);
    this.poly([this.P(1.88, 2.12, 88), this.P(2.12, 2.12, 88), this.P(2, 2, 100)], gold); this.poly([this.P(2.12, 2.12, 88), this.P(2.12, 1.88, 88), this.P(2, 2, 100)], '#b08a30');
    // the near colonnades
    for (let x = 0.8; x < s - 0.2; x += 0.5) col(x, s - 0.3); for (let y = 0.3; y < s - 0.2; y += 0.5) col(s - 0.3, y);
    beam(0.3, s - 0.3, s - 0.3, s - 0.3); beam(s - 0.3, 0.3, s - 0.3, s - 0.3);
  },

  /* ---- Dock: a plank pier on piles with a boat shed, a hand crane and nets ---- */
  shape_dock(b, age, p) {
    const s = b.size, g = this.g, stone = (b.ageVisual || 0) >= 2, deck = stone ? '#9a948a' : '#9c7a4a', deckD = stone ? '#6e6960' : '#6a5034';
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 3;
    for (const x of [0.12, s / 2, s - 0.12]) for (const y of [0.12, s / 2, s - 0.12]) { const a = this.P(x, y, -5), c = this.P(x, y, 4); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    this.plain(() => this.box(0, 0, s, s, 3, 3, deckD, U.shade(deckD, -0.2), deck));
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; for (let k = 0.25; k < s; k += 0.25) { const a = this.P(k, 0, 6), c = this.P(k, s, 6); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    this.box(0.1, 0.1, 1.0, s - 0.3, 6, 14, age.wall, age.wallDark, age.roof);
    this.opening('x', 1.0, s * 0.45, 0.25, 6, 13, '#1a1410', true);
    this.gable(0.1, 0.1, 1.0, s - 0.3, 20, 10, age.roof, age.roofDark, 0.08);
    this.plain(() => {
      const c0 = this.P(s - 0.3, s - 0.3, 6), c1 = this.P(s - 0.3, s - 0.3, 34), c2 = this.P(s + 0.1, s - 0.9, 30);
      g.strokeStyle = '#5a3f22'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      g.strokeStyle = '#c8b89a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(c2[0], c2[1]); g.lineTo(c2[0], c2[1] + 16); g.stroke(); g.fillStyle = '#8a6a44'; g.fillRect(c2[0] - 3, c2[1] + 15, 6, 4);
      const n0 = this.P(1.3, 0.3, 6), n1 = this.P(1.8, 0.3, 6); g.strokeStyle = '#5a3f22'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(n0[0], n0[1]); g.lineTo(n0[0], n0[1] - 12); g.lineTo(n1[0], n1[1] - 12); g.lineTo(n1[0], n1[1]); g.stroke();
      g.strokeStyle = 'rgba(220,210,180,0.75)'; g.lineWidth = 0.7; g.beginPath(); for (let k = 0; k <= 5; k++) { const t = k / 5; g.moveTo(U.lerp(n0[0], n1[0], t), U.lerp(n0[1], n1[1], t) - 12); g.lineTo(U.lerp(n0[0], n1[0], t), U.lerp(n0[1], n1[1], t) - 4); } g.stroke();
      const r = this.P(s - 0.5, 0.5, 6); this.ell(r[0], r[1] - 1, 4, 2, '#b8a070', '#6a5a3a');
    });
    // on the shed's ridge, at its near end where it can be seen
    this.flagSpot(0.95, (0.1 + s - 0.3) / 2, 29);
  },
});
