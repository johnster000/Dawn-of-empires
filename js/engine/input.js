/* Mouse, keyboard and touch. Turns raw events into Game commands. */
const Input = {
  el: null, keys: {}, mouse: { x: 0, y: 0, down: false, button: 0, sx: 0, sy: 0, dragging: false, panning: false },
  touches: new Map(), pinch: null, lastTap: 0, edgePan: false,
  init(el) {
    this.el = el;
    window.addEventListener('contextmenu', (e) => { if (this.overGame(e)) e.preventDefault(); }, { capture: true });
    window.addEventListener('mousedown', (e) => { if (e.button === 2 && this.overGame(e) && e.target !== el) this.onDown(e); }, { capture: true });
    el.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    // The wheel and the middle button are handled on the window, not the canvas: the interface panels cover a
    // good part of the screen, and an event that lands on one of them never reaches the canvas at all.
    window.addEventListener('wheel', (e) => {
      if (!this.overGame(e) || !e.deltaY) return;
      e.preventDefault();
      this.wheelAcc = (this.wheelAcc || 0) + (e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY);
      if (Math.abs(this.wheelAcc) < 24) return;                    // a trackpad sends many small steps
      const [x, y] = this.pos(e); Renderer.zoomAt(this.wheelAcc < 0 ? 1.12 : 1 / 1.12, x, y); this.wheelAcc = 0;
    }, { passive: false, capture: true });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1 || !this.overGame(e)) return;
      e.preventDefault();                                          // stops the browser's autoscroll taking over
      const [x, y] = this.pos(e); const m = this.mouse;
      m.down = true; m.button = 1; m.panning = true; m.x = x; m.y = y; m.sx = x; m.sy = y; m.dragging = false;
    }, { capture: true });
    window.addEventListener('auxclick', (e) => { if (e.button === 1 && this.overGame(e)) e.preventDefault(); }, { capture: true });
    el.addEventListener('mouseleave', () => { Renderer.hover = null; });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    el.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    el.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    el.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    el.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  },
  pos(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
  /* Is this event over the playing area, rather than a menu screen or a text box that needs the wheel itself? */
  overGame(e) {
    if (!Game.running || Game.paused) return false;
    const t = e.target;
    if (!t || !t.closest) return true;
    if (t.closest('.screen')) return false;
    return t.tagName !== 'SELECT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT';
  },
  onDown(e) {
    if (!Game.running) return;
    Sfx.init(); Sfx.resume();
    const [x, y] = this.pos(e); const m = this.mouse;
    m.down = true; m.button = e.button; m.sx = x; m.sy = y; m.x = x; m.y = y; m.dragging = false;
    if (e.button === 0 && this.keys[' ']) { m.panning = true; e.preventDefault(); return; }
    if (e.button === 0 && Game.placing) { if (Game.placing.wall) Game.beginWall(x, y); else Game.placeAt(x, y, e.shiftKey); return; }
    if (e.button === 2) {
      if (Game.placing) { Game.cancelPlacing(); return; }
      if (Game.mode) { Game.mode = null; UI.refreshCommands(); return; }
      Game.commandAt(x, y, e.shiftKey);
    }
  },
  onMove(e) {
    const [x, y] = this.pos(e); const m = this.mouse;
    if (m.panning && m.down) { const z = Renderer.cam.zoom; const dx = (x - m.x) / (32 * z), dy = (y - m.y) / (16 * z); Renderer.cam.x -= (dx + dy) / 2; Renderer.cam.y -= (dy - dx) / 2; Renderer.clampCam(); }
    else if (m.down && m.button === 0 && !Game.placing) {
      if (Math.abs(x - m.sx) > 5 || Math.abs(y - m.sy) > 5) m.dragging = true;
      if (m.dragging) Renderer.selBox = { x0: Math.min(m.sx, x), y0: Math.min(m.sy, y), x1: Math.max(m.sx, x), y1: Math.max(m.sy, y) };
    }
    m.x = x; m.y = y;
    if (Game.running) { if (Game.placing) Game.updateGhost(x, y); Game.updateHover(x, y); }
  },
  onUp(e) {
    const m = this.mouse; if (!m.down) return;
    m.down = false;
    if (m.panning) { m.panning = false; return; }
    if (e.button === 0 && Game.placing && Game.placing.wall && Game.wallStart) { Game.placeWall(m.x, m.y); Renderer.selBox = null; m.dragging = false; return; }
    if (e.button === 0 && !Game.placing) {
      if (m.dragging) { Game.boxSelect(Renderer.selBox, e.shiftKey); }
      else if (Game.mode) { Game.commandAt(m.x, m.y, e.shiftKey, Game.mode); Game.mode = null; UI.refreshCommands(); }
      else Game.clickSelect(m.x, m.y, e.shiftKey, e.ctrlKey || e.metaKey);
    }
    Renderer.selBox = null; m.dragging = false;
  },
  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.keys[e.key.toLowerCase()] = down; this.keys[e.key] = down;
    if (!down || !Game.running) return;
    if (e.key === ' ') { e.preventDefault(); }
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (Game.placing) Game.cancelPlacing(); else if (Game.mode) { Game.mode = null; UI.refreshCommands(); } else if (Game.selection.length) Game.select([]); else UI.togglePause(); return; }
    if (e.key === 'F3') { e.preventDefault(); Game.debug = !Game.debug; return; }
    if ((e.ctrlKey || e.metaKey) && /^[0-9]$/.test(e.key)) { e.preventDefault(); Game.groups[e.key] = Game.selection.filter((s) => s.kind === 'unit'); UI.toast('Group ' + e.key + ' set'); return; }
    if (/^[0-9]$/.test(e.key) && Game.groups[e.key]) { const g = Game.groups[e.key].filter((u) => !u.dead); if (g.length) { Game.select(g); if (Game.lastGroupKey === e.key && Game.time - Game.lastGroupT < 0.5) Game.focus(g[0]); Game.lastGroupKey = e.key; Game.lastGroupT = Game.time; } return; }
    if (k === 'h') { const th = Game.players[Game.human].buildings('townhall')[0]; if (th) { Game.select([th]); Game.focus(th); } return; }
    if (k === '.') { Game.nextIdleVillager(); return; }
    if (k === ',') { Game.selectArmy(); return; }
    if (k === '=' || k === '+') { Renderer.zoomAt(1.2, Renderer.W / 2, Renderer.H / 2); return; }
    if (k === '-') { Renderer.zoomAt(1 / 1.2, Renderer.W / 2, Renderer.H / 2); return; }
    if (e.key === 'Delete') { Game.deleteSelected(); return; }
    if (e.key === 'F1') { e.preventDefault(); UI.showHowTo(true); return; }
    if (e.key === 'Enter' && Game.lastEvent) { Renderer.centerOn(Game.lastEvent.x, Game.lastEvent.y); return; }
    if (k === 'p' || e.key === 'Pause') { UI.togglePause(); return; }
    // command panel hotkeys
    if (UI.hotkey(k)) { e.preventDefault(); }
  },
  /* Camera keys are polled each frame so movement is smooth. */
  poll(dt) {
    const k = this.keys, sp = 14 * dt / Renderer.cam.zoom; let dx = 0, dy = 0;
    if (k['w'] || k['arrowup']) dy -= 1; if (k['s'] && !k.shift || k['arrowdown']) dy += 1;
    if (k['a'] || k['arrowleft']) dx -= 1; if (k['d'] || k['arrowright']) dx += 1;
    if (dx || dy) { // screen-space pan converted to world
      Renderer.cam.x += (dx * 0.5 + dy) * sp * 0.5; Renderer.cam.y += (dy - dx * 0.5) * sp * 0.5; Renderer.clampCam();
    }
  },
  /* Touch: one finger drags the camera or taps; two fingers pinch to zoom. */
  onTouch(e, phase) {
    if (!Game.running) return;
    e.preventDefault();
    Sfx.init(); Sfx.resume();
    const r = this.el.getBoundingClientRect();
    if (phase === 'start') {
      for (const t of e.changedTouches) {
        const o = { x: t.clientX - r.left, y: t.clientY - r.top, sx: t.clientX - r.left, sy: t.clientY - r.top, moved: false, t: performance.now(), box: false };
        // hold a finger still for a moment to start a selection box
        o.timer = setTimeout(() => { if (this.touches.size === 1 && !o.moved && !Game.placing) { o.box = true; Renderer.selBox = { x0: o.sx, y0: o.sy, x1: o.sx, y1: o.sy }; UI.hint('Drag to select, lift to finish'); if (navigator.vibrate) navigator.vibrate(12); } }, 380);
        this.touches.set(t.identifier, o);
      }
      if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { d: U.dist(a.x, a.y, b.x, b.y), zoom: Renderer.cam.zoom }; }
      if (Game.placing && this.touches.size === 1) { const t = [...this.touches.values()][0]; Game.updateGhost(t.x, t.y); }
    } else if (phase === 'move') {
      for (const t of e.changedTouches) { const o = this.touches.get(t.identifier); if (!o) continue; const nx = t.clientX - r.left, ny = t.clientY - r.top; if (Math.abs(nx - o.sx) > 8 || Math.abs(ny - o.sy) > 8) o.moved = true;
        if (o.box) { Renderer.selBox = { x0: Math.min(o.sx, nx), y0: Math.min(o.sy, ny), x1: Math.max(o.sx, nx), y1: Math.max(o.sy, ny) }; o.x = nx; o.y = ny; continue; }
        if (o.moved && o.timer) { clearTimeout(o.timer); o.timer = null; }
        if (this.touches.size === 1 && o.moved) {
          if (Game.placing) Game.updateGhost(nx, ny);
          else { const z = Renderer.cam.zoom; const dx = (nx - o.x) / (32 * z), dy = (ny - o.y) / (16 * z); Renderer.cam.x -= (dx + dy) / 2; Renderer.cam.y -= (dy - dx) / 2; Renderer.clampCam(); }
        }
        o.x = nx; o.y = ny; }
      if (this.touches.size === 2 && this.pinch) { const [a, b] = [...this.touches.values()]; const d = U.dist(a.x, a.y, b.x, b.y); const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; const target = U.clamp(this.pinch.zoom * (d / this.pinch.d), Renderer.minZoom, Renderer.maxZoom); Renderer.zoomAt(target / Renderer.cam.zoom, mid[0], mid[1]); }
    } else {
      for (const t of e.changedTouches) {
        const o = this.touches.get(t.identifier); this.touches.delete(t.identifier); if (!o) continue;
        if (o.timer) clearTimeout(o.timer);
        if (o.box) { Game.boxSelect(Renderer.selBox, false); Renderer.selBox = null; UI.hint(null); UI.cmdDirty = true; continue; }
        if (!o.moved && this.touches.size === 0 && performance.now() - o.t < 600) this.tap(o.x, o.y);
      }
      if (this.touches.size < 2) this.pinch = null;
    }
  },
  tap(x, y) {
    if (Game.placing) { if (Game.placing.wall) { if (!Game.wallStart) { Game.beginWall(x, y); UI.hint('Tap the other end of the wall'); } else Game.placeWall(x, y); } else Game.placeAt(x, y, false); return; }
    if (Game.mode) { Game.commandAt(x, y, false, Game.mode); Game.mode = null; UI.refreshCommands(); return; }
    // Own thing under the finger: select it. Otherwise, with units selected, it's a command.
    const u = Renderer.pickUnit(x, y), b = u ? null : Renderer.pickBuilding(x, y);
    const own = (u && u.owner === Game.human) || (b && b.owner === Game.human);
    const haveUnits = Game.selection.some((s) => s.kind === 'unit');
    const haveBuilding = Game.selection.some((s) => s.kind === 'building');
    if (own && !(haveUnits && b && b.owner === Game.human && (!b.built || b.hp < b.maxHp || b.def.farm || b.def.garrison))) { Game.clickSelect(x, y, false, false); return; }
    if (haveUnits || haveBuilding) { Game.commandAt(x, y, false); return; }
    Game.clickSelect(x, y, false, false);
  },
};
