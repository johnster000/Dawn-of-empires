/* DOM interface: screens, HUD, selection panel, command grid, tooltips, log. */
const GRID_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b'];
const UI = {
  els: {}, commands: [], iconCache: new Map(), log: [], selDirty: true, cmdDirty: true, lastRes: {}, toastT: 0,
  $(id) { return document.getElementById(id); },
  init() {
    const $ = this.$;
    ['hud', 'topbar', 'log', 'selpanel', 'commands', 'tooltip', 'toast', 'title', 'setup', 'howto', 'pause', 'end', 'modal', 'pop', 'age', 'clock', 'btn-idle', 'minimap', 'monument', 'hint', 'speed'].forEach((id) => (this.els[id] = $(id)));
    for (const r of RESOURCES) { const el = document.querySelector(`.res[data-res="${r}"]`); el.querySelector('.ricon').replaceWith(this.resIcon(r, 18)); this.els['res-' + r] = el.querySelector('.val'); el.title = RESOURCE_INFO[r].desc; }
    $('btn-new').onclick = () => { Sfx.init(); Sfx.play('ui'); this.showScreen('setup'); };
    $('btn-continue').onclick = () => { Sfx.init(); Sfx.resume(); const d = Save.read(); if (!d) { this.toast('No saved game'); this.syncContinue(); return; } try { Save.restore(d); this.message('Game restored.', 'good'); } catch (e) { this.showScreen('title'); this.toast(e.message); } };
    $('btn-save').onclick = () => { Game.save(false); };
    $('btn-export').onclick = () => this.exportSave();
    $('btn-import').onclick = () => this.importSave();
    $('btn-modal-close').onclick = () => { this.els.modal.hidden = true; if (!Game.running) this.showScreen('title'); else if (Game.paused) this.showScreen('pause'); };
    $('btn-modal-copy').onclick = async () => { const ta = $('modal-text'); ta.select(); try { await navigator.clipboard.writeText(ta.value); this.toast('Copied'); } catch (e) { try { document.execCommand('copy'); this.toast('Copied'); } catch (err) { this.toast('Select the text and copy it'); } } };
    $('btn-modal-import').onclick = () => { const r = Save.importText($('modal-text').value); if (r.error) { this.toast(r.error); Sfx.play('error'); return; } this.els.modal.hidden = true; this.showScreen(null); this.message(`Imported: ${r.meta.age}, ${r.meta.time} played.`, 'good'); };
    $('btn-howto').onclick = () => { Sfx.play('ui'); this.showHowTo(false); };
    $('btn-howto-back').onclick = () => { Sfx.play('ui'); if (Game.running) { this.showScreen(null); } else this.showScreen('title'); };
    $('btn-sound').onclick = () => { Sfx.init(); Sfx.setEnabled(!Sfx.enabled); this.syncSound(); try { localStorage.setItem('anvil-sound', Sfx.enabled ? '1' : '0'); } catch (e) {} };
    $('btn-begin').onclick = () => { Sfx.init(); Sfx.resume(); Sfx.play('ui'); Game.newGame(this.readSetup()); };
    $('btn-setup-back').onclick = () => { Sfx.play('ui'); this.showScreen('title'); };
    $('btn-random-seed').onclick = () => { $('set-seed').value = Math.floor(Math.random() * 1e9).toString(36); };
    $('btn-menu').onclick = () => this.togglePause();
    $('btn-resume').onclick = () => this.togglePause();
    $('btn-pause-howto').onclick = () => { this.showHowTo(true); };
    $('btn-pause-sound').onclick = () => { Sfx.setEnabled(!Sfx.enabled); this.syncSound(); };
    $('btn-restart').onclick = () => { Game.newGame(Game.settings); };
    $('btn-quit').onclick = () => { Game.quit(); };
    $('btn-end-again').onclick = () => { Game.newGame(Game.settings); };
    $('btn-end-title').onclick = () => { Game.quit(); };
    $('btn-end-continue').onclick = () => { this.showScreen(null); Game.paused = false; };
    $('btn-idle').onclick = () => Game.nextIdleVillager();
    $('btn-army').onclick = () => Game.selectArmy();
    const cycleSpeed = () => { const s = [1, 1.5, 2, 3]; Game.settings.speed = s[(s.indexOf(Game.settings.speed) + 1) % s.length]; this.syncSpeed(); };
    $('speed').onclick = cycleSpeed; $('btn-pause-speed').onclick = cycleSpeed;
    for (const b of document.querySelectorAll('.donate')) b.addEventListener('click', (e) => { setTimeout(() => { try { if (!window.open) b.classList.add('blocked'); } catch (err) {} }, 0); });
    this.els.minimap.addEventListener('mousedown', (e) => this.miniClick(e));
    this.els.minimap.addEventListener('mousemove', (e) => { if (e.buttons & 1) this.miniClick(e); });
    this.els.minimap.addEventListener('touchstart', (e) => { e.preventDefault(); this.miniClick(e.touches[0], true); }, { passive: false });
    this.els.minimap.addEventListener('touchmove', (e) => { e.preventDefault(); this.miniClick(e.touches[0], true); }, { passive: false });
    this.els.minimap.addEventListener('contextmenu', (e) => e.preventDefault());
    this.buildSetup();
    const coarse = () => document.body.classList.toggle('coarse', window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 560);
    coarse(); window.addEventListener('resize', coarse);
    document.addEventListener('touchstart', () => this.hideTip(), { passive: true });
    try { if (localStorage.getItem('anvil-sound') === '0') Sfx.enabled = false; } catch (e) {}
    this.syncSound();
    this.showScreen('title');
  },
  syncContinue() { const b = this.$('btn-continue'); const d = Save.exists() ? Save.meta(Save.read()) : null; b.hidden = !d; if (d) b.textContent = `Continue · ${d.age}, ${d.time}`; },
  exportSave() {
    if (!Game.running) return;
    const $ = this.$; $('modal-title').textContent = 'Export save'; $('modal-sub').textContent = 'Copy this text and keep it somewhere. Paste it into Import on any device to pick the game up there.';
    $('modal-text').value = Save.exportText(); $('btn-modal-import').hidden = true; $('btn-modal-copy').hidden = false; this.showScreen('modal'); $('modal-text').select();
  },
  importSave() {
    const $ = this.$; $('modal-title').textContent = 'Import a save'; $('modal-sub').textContent = 'Paste the text from Export. It replaces the saved game on this device and starts straight away.';
    $('modal-text').value = ''; $('btn-modal-import').hidden = false; $('btn-modal-copy').hidden = true; this.showScreen('modal'); $('modal-text').focus();
  },
  syncSound() { const t = Sfx.enabled ? 'Sounds on' : 'Sounds off'; this.$('btn-sound').textContent = t; this.$('btn-pause-sound').textContent = t; },
  syncSpeed() { const sp = Game.settings.speed; this.els.speed.textContent = '»' + sp + '×'; this.$('btn-pause-speed').textContent = 'Speed: ' + ({ 1: 'Normal', 1.5: 'Fast', 2: 'Very fast', 3: 'Fastest' }[sp] || sp + '×'); },
  showScreen(id) {
    for (const s of ['title', 'setup', 'howto', 'pause', 'end', 'modal']) this.els[s].hidden = s !== id;
    if (id === 'title') this.syncContinue();
    this.els.hud.hidden = !Game.running;
    document.body.classList.toggle('in-game', Game.running);
  },
  showHowTo(fromGame) { this.howtoFromGame = fromGame; this.showScreen('howto'); if (fromGame) Game.paused = true; },
  togglePause() {
    if (!Game.running || Game.over) return;
    Game.paused = !Game.paused; this.showScreen(Game.paused ? 'pause' : null); Sfx.play('ui');
  },
  miniClick(e, touch) {
    const r = this.els.minimap.getBoundingClientRect();
    const [wx, wy] = Renderer.miniToWorld(e.clientX - r.left, e.clientY - r.top);
    if (!touch && e.button === 2 && Game.selection.some((s) => s.kind === 'unit')) { Game.commandWorld(wx, wy, false); return; }
    Renderer.centerOn(U.clamp(wx, 0, World.w), U.clamp(wy, 0, World.h));
  },

  /* ---- setup screen ---- */
  buildSetup() {
    const $ = this.$;
    const opt = (sel, list) => { sel.innerHTML = ''; for (const [v, t] of list) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); } };
    opt($('set-size'), Object.entries(MAP_SIZES).map(([k, v]) => [k, `${v.name} (${v.w}×${v.h})`]));
    opt($('set-terrain'), Object.entries(TERRAINS).map(([k, v]) => [k, v.name]));
    opt($('set-enemies'), [[1, '1 enemy'], [2, '2 enemies'], [3, '3 enemies'], [4, '4 enemies'], [5, '5 enemies']]);
    opt($('set-difficulty'), [['easy', 'Easy — a gentle neighbour'], ['normal', 'Normal — builds and raids'], ['hard', 'Hard — fast, aggressive, sharper economy']]);
    opt($('set-resources'), [['low', 'Low'], ['normal', 'Standard'], ['high', 'High'], ['huge', 'Huge']]);
    opt($('set-age'), AGES.map((a, i) => [i, `${a.name} (${a.numeral})`]));
    opt($('set-pop'), [[50, '50'], [100, '100'], [150, '150'], [200, '200']]);
    opt($('set-speed'), [[1, 'Normal'], [1.5, 'Fast'], [2, 'Very fast']]);
    opt($('set-color'), PLAYER_COLORS.map((c) => [c.id, c.name]));
    let saved = null; try { saved = JSON.parse(localStorage.getItem('anvil-settings') || 'null'); } catch (e) {}
    const s = Object.assign({}, Game.defaults, saved || {});
    $('set-size').value = s.mapSize; $('set-terrain').value = s.terrain; $('set-enemies').value = s.enemies; $('set-difficulty').value = s.difficulty; $('set-resources').value = s.resources; $('set-age').value = s.startAge; $('set-pop').value = s.popCap; $('set-speed').value = s.speed; $('set-color').value = s.color; $('set-reveal').checked = !!s.reveal; $('set-seed').value = '';
    const blurb = () => { $('terrain-blurb').textContent = TERRAINS[$('set-terrain').value].blurb; };
    $('set-terrain').onchange = blurb; blurb();
  },
  readSetup() {
    const $ = this.$;
    const s = { mapSize: $('set-size').value, terrain: $('set-terrain').value, enemies: +$('set-enemies').value, difficulty: $('set-difficulty').value, resources: $('set-resources').value, startAge: +$('set-age').value, popCap: +$('set-pop').value, speed: +$('set-speed').value, color: $('set-color').value, reveal: $('set-reveal').checked, seedText: $('set-seed').value.trim() };
    try { localStorage.setItem('anvil-settings', JSON.stringify(s)); } catch (e) {}
    return Object.assign({}, Game.defaults, s);
  },

  /* ---- icons ---- */
  resIcon(kind, size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px'; cv.className = 'ricon';
    const g = cv.getContext('2d'); g.scale(2, 2); const c = size / 2;
    if (kind === 'food') { g.fillStyle = '#d0603a'; g.beginPath(); g.arc(c, c + 1, c * 0.62, 0, 7); g.fill(); g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(c + 2, c - 5, 3.5, 1.8, -0.6, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(c - 2.5, c - 1.5, 2, 0, 7); g.fill(); }
    else if (kind === 'wood') { g.fillStyle = '#8c6a3c'; g.beginPath(); g.roundRect(c - 8, c - 4, 16, 8, 3); g.fill(); g.fillStyle = '#c9a26b'; g.beginPath(); g.ellipse(c + 8, c, 2.5, 4, 0, 0, 7); g.fill(); g.strokeStyle = '#6a4a2a'; g.beginPath(); g.moveTo(c - 4, c - 2); g.lineTo(c + 3, c - 2); g.moveTo(c - 6, c + 2); g.lineTo(c + 2, c + 2); g.stroke(); }
    else if (kind === 'stone') { g.fillStyle = '#9aa0a8'; g.beginPath(); g.moveTo(c - 8, c + 5); g.lineTo(c - 5, c - 4); g.lineTo(c + 1, c - 7); g.lineTo(c + 7, c - 2); g.lineTo(c + 8, c + 5); g.closePath(); g.fill(); g.fillStyle = '#c8ccd4'; g.beginPath(); g.moveTo(c - 5, c - 4); g.lineTo(c + 1, c - 7); g.lineTo(c, c - 1); g.closePath(); g.fill(); }
    else { g.fillStyle = '#e0b43c'; g.beginPath(); g.moveTo(c - 8, c + 5); g.lineTo(c - 5, c - 2); g.lineTo(c + 5, c - 2); g.lineTo(c + 8, c + 5); g.closePath(); g.fill(); g.fillStyle = '#f5d878'; g.fillRect(c - 4, c - 1, 8, 2); }
    return cv;
  },
  icon(kind, type, owner) {
    const p = Game.players[owner]; const key = kind + ':' + type + ':' + owner + ':' + (p ? p.age : 0);
    if (!this.iconCache.has(key)) this.iconCache.set(key, kind === 'tech' ? this.techIcon(type) : Renderer.icon(kind, type, owner, 44));
    return this.iconCache.get(key).cloneNode(true) && this.copyCanvas(this.iconCache.get(key));
  },
  copyCanvas(src) { const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; cv.style.width = src.style.width; cv.style.height = src.style.height; cv.getContext('2d').drawImage(src, 0, 0); return cv; },
  techIcon(id) {
    const t = TECHS[id], cv = document.createElement('canvas'); cv.width = cv.height = 88; cv.style.width = cv.style.height = '44px';
    const g = cv.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#e8dcc4'; g.beginPath(); g.roundRect(8, 6, 28, 32, 3); g.fill(); g.fillStyle = '#c9ab7a'; g.fillRect(8, 6, 28, 3); g.fillRect(8, 35, 28, 3);
    g.strokeStyle = '#5a4130'; g.lineWidth = 2.2; g.lineCap = 'round'; g.fillStyle = '#5a4130';
    const e = t.effect;
    if (e.atk) { g.beginPath(); g.moveTo(14, 30); g.lineTo(28, 14); g.stroke(); g.beginPath(); g.moveTo(18, 30); g.lineTo(13, 25); g.stroke(); g.fillStyle = '#8a8a90'; g.beginPath(); g.moveTo(26, 12); g.lineTo(31, 12); g.lineTo(31, 17); g.closePath(); g.fill(); }
    else if (e.armor) { g.fillStyle = '#5a6a8a'; g.beginPath(); g.moveTo(22, 12); g.lineTo(30, 15); g.lineTo(29, 24); g.lineTo(22, 31); g.lineTo(15, 24); g.lineTo(14, 15); g.closePath(); g.fill(); g.fillStyle = '#e8c46a'; g.fillRect(21, 15, 2, 12); }
    else if (e.range) { g.beginPath(); g.arc(20, 22, 9, -1.2, 1.2); g.stroke(); g.beginPath(); g.moveTo(12, 22); g.lineTo(32, 22); g.stroke(); }
    else if (e.gather || e.farmYield) { g.strokeStyle = '#6a8a3a'; g.beginPath(); g.moveTo(22, 32); g.lineTo(22, 16); g.stroke(); for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(22 + (k % 2 ? 4 : -4), 18 + k * 4, 4, 2, k % 2 ? 0.6 : -0.6, 0, 7); g.fillStyle = '#7fa855'; g.fill(); } }
    else if (e.carry != null || e.villagerSpeed) { g.beginPath(); g.arc(18, 30, 4, 0, 7); g.stroke(); g.beginPath(); g.moveTo(14, 20); g.lineTo(30, 20); g.lineTo(28, 27); g.lineTo(16, 27); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(30, 20); g.lineTo(34, 30); g.stroke(); }
    else if (e.villagerHp) { g.strokeStyle = '#8a5a3a'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(13, 14 + k * 5); g.lineTo(31, 14 + k * 5); g.stroke(); } for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(14 + k * 5, 12); g.lineTo(14 + k * 5, 32); g.stroke(); } }
    else { g.beginPath(); g.moveTo(22, 12); g.lineTo(22, 32); g.moveTo(15, 18); g.lineTo(29, 18); g.stroke(); }
    return cv;
  },

  /* ---- per frame ---- */
  update(dt) {
    if (!Game.running) return;
    const p = Game.players[Game.human];
    for (const r of RESOURCES) { const v = Math.floor(p.res[r]); if (this.lastRes[r] !== v) { this.lastRes[r] = v; this.els['res-' + r].textContent = v; } }
    const pop = p.pop(), cap = p.popCap(); const popTxt = pop + '/' + cap; if (this.els.pop.textContent !== popTxt) { this.els.pop.textContent = popTxt; this.els.pop.classList.toggle('full', pop >= cap); }
    const a = AGES[p.age]; const ageTxt = a.name; if (this.els.age.textContent !== ageTxt) this.els.age.textContent = ageTxt;
    const ct = U.time(Game.time); if (this.els.clock.textContent !== ct) this.els.clock.textContent = ct;
    const idle = p.units('villager').filter((u) => !u.order).length; const it = idle ? `Idle villager · ${idle}` : 'Idle villager'; if (this.els['btn-idle'].textContent !== it) { this.els['btn-idle'].textContent = it; this.els['btn-idle'].classList.toggle('attention', idle > 0); }
    // monument countdown
    const mon = Game.buildings.find((b) => !b.dead && b.built && b.def.monument);
    if (mon) { const left = Math.max(0, Game.settings.monumentTime - mon.monumentT); this.els.monument.hidden = false; this.els.monument.textContent = `${Game.players[mon.owner].name}'s Monument stands — ${U.time(left)} to victory`; this.els.monument.style.borderColor = Game.players[mon.owner].color.main; } else this.els.monument.hidden = true;
    this.selT = (this.selT || 0) - dt;
    if (this.selDirty || this.selT <= 0) { this.selT = 0.25; this.refreshSelection(); this.selDirty = false; }
    this.cmdT = (this.cmdT || 0) - dt;
    if (this.cmdDirty || this.cmdT <= 0) { this.cmdT = 0.5; this.refreshCommands(); this.cmdDirty = false; }
    // log fade
    const now = performance.now();
    for (const m of this.log) { const age = (now - m.t) / 1000; if (age > 10) { m.el.remove(); m.gone = true; } else m.el.style.opacity = age > 7 ? String(1 - (age - 7) / 3) : '1'; }
    this.log = this.log.filter((m) => !m.gone);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.els.toast.classList.remove('on'); }
  },
  toast(text) { this.els.toast.textContent = text; this.els.toast.classList.add('on'); this.toastT = 2.2; },
  hint(text) { this.els.hint.textContent = text || ''; this.els.hint.hidden = !text; },
  message(text, kind, x, y) {
    const el = U.el('div', 'msg ' + (kind || 'info'), text);
    if (x != null) { el.classList.add('link'); el.onclick = () => Renderer.centerOn(x, y); }
    this.els.log.appendChild(el); this.log.push({ el, t: performance.now() });
    const maxMsgs = window.innerWidth < 560 ? 3 : 6;
    while (this.log.length > maxMsgs) { this.log[0].el.remove(); this.log.shift(); }
  },

  /* ---- selection panel ---- */
  refreshSelection() {
    const el = this.els.selpanel; const sel = Game.selection.filter((s) => !s.dead);
    if (!sel.length) { el.innerHTML = ''; el.hidden = true; this.els.commands.hidden = true; return; }
    el.hidden = false;
    const p = Game.players[sel[0].owner];
    if (sel.length === 1) {
      const s = sel[0]; el.innerHTML = '';
      const head = U.el('div', 'sel-head');
      head.appendChild(this.icon(s.kind, s.type, s.owner));
      const info = U.el('div', 'sel-info');
      info.appendChild(U.el('div', 'sel-name', s.def.name));
      const own = U.el('div', 'sel-owner', p.name); own.style.color = p.color.light; info.appendChild(own);
      const bar = U.el('div', 'hpbar'); const fill = U.el('div', 'fill'); const f = s.hp / s.maxHp; fill.style.width = (f * 100) + '%'; fill.style.background = f > 0.5 ? '#6fbf6a' : f > 0.25 ? '#e0b040' : '#d8484a'; bar.appendChild(fill); bar.appendChild(U.el('span', null, `${Math.ceil(s.hp)} / ${s.maxHp}`)); info.appendChild(bar);
      head.appendChild(info); el.appendChild(head);
      head.onclick = () => el.classList.toggle('expanded'); head.title = 'Tap for details';
      const stats = U.el('div', 'sel-stats');
      if (s.kind === 'unit') {
        stats.appendChild(this.stat('Attack', s.atk + (s.def.bonus ? ' ★' : ''), s.def.bonus ? 'Bonus vs ' + Object.keys(s.def.bonus).join(', ') : ''));
        stats.appendChild(this.stat('Armour', s.armor));
        stats.appendChild(this.stat('Range', s.range || 'melee'));
        stats.appendChild(this.stat('Speed', s.speed.toFixed(1)));
        if (s.type === 'villager') stats.appendChild(this.stat('Carrying', s.carry.amt > 0 ? `${Math.floor(s.carry.amt)} ${s.carry.kind}` : '—'));
        el.appendChild(stats);
        el.appendChild(U.el('div', 'sel-activity', this.activity(s)));
      } else {
        if (s.def.attack) { stats.appendChild(this.stat('Attack', s.def.attack.dmg + p.mods.towerAtk)); stats.appendChild(this.stat('Range', s.def.attack.range + p.mods.towerRange)); }
        stats.appendChild(this.stat('Armour', s.def.armor));
        if (s.def.pop) stats.appendChild(this.stat('Housing', '+' + s.def.pop));
        if (s.def.dropoff) stats.appendChild(this.stat('Stores', s.def.dropoff.join(', ')));
        if (s.def.farm) stats.appendChild(this.stat('Farmer', s.worker && !s.worker.dead ? 'working' : 'none'));
        if (s.def.garrison) stats.appendChild(this.stat('Garrison', `${s.garrison.length} / ${s.def.garrison}`, 'Right-click with villagers or foot soldiers to garrison'));
        el.appendChild(stats);
        if (!s.built) el.appendChild(U.el('div', 'sel-activity', `Under construction · ${Math.floor(s.progress * 100)}%` + (s.buildersLast ? ` · ${s.buildersLast} builder${s.buildersLast > 1 ? 's' : ''}` : ' · no builders')));
        else if (s.queue.length) {
          const q = U.el('div', 'queue');
          s.queue.forEach((item, i) => {
            const qi = U.el('div', 'qitem'); qi.title = 'Click to cancel';
            const total = item.kind === 'unit' ? UNITS[item.id].time / (UNITS[item.id].cls !== 'villager' ? 1 + p.mods.trainSpeed : 1) : item.kind === 'tech' ? TECHS[item.id].time : AGES[p.age + 1].advance.time;
            const name = item.kind === 'unit' ? UNITS[item.id].name : item.kind === 'tech' ? TECHS[item.id].name : 'Advance to ' + AGES[p.age + 1].name;
            qi.appendChild(U.el('span', 'qname', name));
            const bar = U.el('div', 'qbar'); const fl = U.el('div', 'fill'); fl.style.width = (i === 0 ? (s.qt / total) * 100 : 0) + '%'; bar.appendChild(fl); qi.appendChild(bar);
            if (i === 0) qi.appendChild(U.el('span', 'qtime', U.time(total - s.qt)));
            qi.onclick = () => { if (s.owner === Game.human) { Sim.dequeue(s, i); Sfx.play('ui'); this.selDirty = true; } };
            q.appendChild(qi);
          });
          el.appendChild(q);
        } else if (s.def.monument && s.built) el.appendChild(U.el('div', 'sel-activity', `Standing for ${U.time(s.monumentT)} of ${U.time(Game.settings.monumentTime)}`));
        else if (s.owner === Game.human && (s.def.trains || s.def.techs)) el.appendChild(U.el('div', 'sel-activity muted', 'Right-click the map to set a rally point.'));
      }
    } else {
      // group portraits by type
      el.innerHTML = '';
      const groups = new Map(); for (const s of sel) { const k = s.kind + ':' + s.type; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
      const row = U.el('div', 'sel-multi');
      for (const [k, list] of groups) {
        const b = U.el('button', 'portrait'); b.appendChild(this.icon(list[0].kind, list[0].type, list[0].owner)); b.appendChild(U.el('span', 'count', list.length)); b.title = list[0].def.name + ' — click to select only these';
        b.onclick = () => Game.select(list);
        row.appendChild(b);
      }
      el.appendChild(row);
      const hp = sel.reduce((a, s) => a + s.hp, 0), mx = sel.reduce((a, s) => a + s.maxHp, 0);
      el.appendChild(U.el('div', 'sel-activity', `${sel.length} selected · ${Math.round((hp / mx) * 100)}% health`));
    }
  },
  stat(label, value, title) { const d = U.el('div', 'stat'); d.appendChild(U.el('span', 'label', label)); d.appendChild(U.el('span', 'value', String(value))); if (title) d.title = title; return d; },
  activity(u) {
    const o = u.order; if (!o) return u.def.cls === 'villager' ? 'Idle — waiting for orders' : 'Standing guard';
    if (o.type === 'move') return 'Moving'; if (o.type === 'attackmove') return 'Advancing';
    if (o.type === 'attack') return 'Attacking ' + (o.target ? o.target.def.name : '');
    if (o.type === 'build') return (o.bld && o.bld.built ? 'Repairing ' : 'Building ') + (o.bld ? o.bld.def.name : '');
    if (o.type === 'gather') { const r = o.res; if (o.phase === 'return') return 'Returning ' + (u.carry.kind || ''); const k = rk(r) || ''; return { tree: 'Chopping wood', berry: 'Picking berries', stone: 'Quarrying stone', gold: 'Mining gold', farm: 'Farming', fish: 'Fishing' }[k] || 'Gathering'; }
    return '';
  },

  /* ---- command grid ---- */
  refreshCommands() {
    const el = this.els.commands; el.innerHTML = ''; this.commands = [];
    const sel = Game.selection.filter((s) => !s.dead && s.owner === Game.human);
    if (!sel.length) { el.hidden = true; this.hint(Game.selection.length ? '' : null); return; }
    el.hidden = false;
    const p = Game.players[Game.human];
    const units = sel.filter((s) => s.kind === 'unit'), blds = sel.filter((s) => s.kind === 'building');
    const cmds = [];
    if (units.length) {
      const vill = units.filter((u) => u.type === 'villager'), mil = units.filter((u) => u.type !== 'villager');
      if (Game.placing) {
        cmds.push({ label: 'Cancel', glyph: '✕', desc: 'Stop placing.', onClick: () => Game.cancelPlacing() });
      } else if (Game.buildMenu && vill.length) {
        for (const id of (Game.buildMenu === 'defence' ? DEFENCE_MENU : BUILD_MENU)) {
          const d = BUILDINGS[id];
          let why = null; if (d.age > p.age) why = 'Requires the ' + AGES[d.age].name; else if (!p.canAfford(d.cost)) why = 'Not enough ' + p.missing(d.cost).join(', ');
          if (d.monument && p.buildings('monument').length) why = 'Only one Monument';
          cmds.push({ label: d.name, icon: ['building', id, Game.human], cost: d.cost, desc: d.desc, locked: d.age > p.age, disabled: why, onClick: () => Game.startPlacing(id) });
        }
        cmds.push({ label: 'Back', glyph: '↩', desc: 'Back to unit commands.', onClick: () => { Game.buildMenu = false; this.refreshCommands(); } });
      } else {
        if (vill.length) cmds.push({ label: 'Build', glyph: '⚒', desc: 'Houses, farms, camps and workshops.', onClick: () => { Game.buildMenu = 'main'; this.refreshCommands(); } });
        if (vill.length) cmds.push({ label: 'Defences', glyph: '🛡', desc: 'Walls, gates, towers and keeps.', onClick: () => { Game.buildMenu = 'defence'; this.refreshCommands(); } });
        if (mil.length) cmds.push({ label: 'Attack move', glyph: '⚔', desc: 'Advance to a point, fighting anything met on the way.', active: Game.mode === 'attackmove', onClick: () => { Game.mode = Game.mode === 'attackmove' ? null : 'attackmove'; this.refreshCommands(); } });
        if (vill.length) cmds.push({ label: 'Repair', glyph: '🔧', desc: 'Pick one of your buildings to mend it.', active: Game.mode === 'repair', onClick: () => { Game.mode = Game.mode === 'repair' ? null : 'repair'; this.refreshCommands(); } });
        cmds.push({ label: 'Stop', glyph: '■', desc: 'Stop and stand still.', onClick: () => { for (const u of units) Sim.idle(u); Sfx.play('ack'); this.selDirty = true; } });
        cmds.push({ label: 'Move', glyph: '➤', desc: 'Move to a point without fighting. (Right-click does this too.)', active: Game.mode === 'move', onClick: () => { Game.mode = Game.mode === 'move' ? null : 'move'; this.refreshCommands(); } });
      }
    } else if (blds.length) {
      const b = blds[0]; const same = blds.every((x) => x.type === b.type);
      if (same && b.built) {
        for (const id of b.def.trains || []) { const d = UNITS[id]; let why = null; if (d.age > p.age) why = 'Requires the ' + AGES[d.age].name; else if (p.pop() + 1 > p.popCap()) why = p.popCap() >= Game.settings.popCap ? 'Population cap reached' : 'Need more houses'; else if (!p.canAfford(d.cost)) why = 'Not enough ' + p.missing(d.cost).join(', ');
          cmds.push({ label: d.name, icon: ['unit', id, Game.human], cost: d.cost, desc: d.desc + ` Trains in ${d.time}s.`, locked: d.age > p.age, disabled: why, onClick: () => Game.train(blds, { kind: 'unit', id }) }); }
        for (const id of b.def.techs || []) { const t = TECHS[id]; if (p.techs.has(id)) continue; if (t.requires && !p.techs.has(t.requires)) continue; // one step of a chain at a time
          let why = null; if (t.age > p.age) why = 'Requires the ' + AGES[t.age].name; else if (!p.canAfford(t.cost)) why = 'Not enough ' + p.missing(t.cost).join(', ');
          if (p.buildings().some((bb) => bb.queue.some((q) => q.kind === 'tech' && q.id === id))) why = 'Being researched';
          cmds.push({ label: t.name, icon: ['tech', id, Game.human], cost: t.cost, desc: t.desc + ` Takes ${t.time}s.`, locked: t.age > p.age, disabled: why, onClick: () => Game.train(blds, { kind: 'tech', id }) }); }
        if (b.def.ageUp && AGES[p.age + 1]) { const nx = AGES[p.age + 1]; const why = p.ageUpBlocker(); cmds.push({ label: 'Advance to ' + nx.name, glyph: nx.numeral, cost: nx.advance.cost, desc: `${nx.blurb} Needs ${nx.advance.needCount} different ${AGES[p.age].name} buildings. Takes ${nx.advance.time}s.`, disabled: why, onClick: () => Game.train(blds, { kind: 'age' }) }); }
        if (b.def.ageUp) cmds.push({ label: b.bell ? 'All clear' : 'Town bell', glyph: '🔔', active: b.bell, desc: b.bell ? 'Send everyone back to work.' : 'Every villager nearby runs into the nearest Town Hall, tower or keep.', onClick: () => Game.ringBell() });
        if (b.def.garrison && blds.some((x) => x.garrison.length)) cmds.push({ label: 'Ungarrison', glyph: '⇲', desc: 'Everyone inside comes out.', onClick: () => { for (const x of blds) Sim.ungarrisonAll(x); Sfx.play('ack'); this.selDirty = true; this.refreshCommands(); } });
        if (b.def.trains && b.rally) cmds.push({ label: 'Clear rally', glyph: '⚑', desc: 'New units will gather at the building again.', onClick: () => { for (const x of blds) x.rally = null; Sfx.play('ui'); this.refreshCommands(); } });
      }
      cmds.push({ label: 'Demolish', glyph: '🕱', desc: b.built ? 'Tear this building down.' : 'Abandon the site. Unspent materials are returned.', danger: true, onClick: () => Game.deleteSelected() });
    }
    cmds.forEach((c, i) => {
      const btn = U.el('button', 'cmd' + (c.disabled ? ' disabled' : '') + (c.locked ? ' locked' : '') + (c.active ? ' active' : '') + (c.danger ? ' danger' : ''));
      if (c.icon) btn.appendChild(this.icon(...c.icon)); else btn.appendChild(U.el('span', 'glyph', c.glyph));
      btn.appendChild(U.el('span', 'lbl', c.label));
      if (i < GRID_KEYS.length) { c.key = GRID_KEYS[i]; btn.appendChild(U.el('span', 'key', c.key.toUpperCase())); }
      btn.onclick = (e) => { e.stopPropagation(); if (c.disabled) { UI.toast(c.disabled); Sfx.play('error'); return; } Sfx.play('ui'); c.onClick(); this.cmdDirty = true; };
      btn.onmouseenter = () => this.showTip(btn, c); btn.onmouseleave = () => this.hideTip();
      el.appendChild(btn); this.commands.push(c);
    });
    if (Game.placing && Game.placing.wall) this.hint(Game.wallStart ? 'Drag to the other end, then release' : 'Click and drag to lay a run of wall · Right-click or Esc to finish');
    else if (Game.placing) this.hint('Click to place · Shift-click to place several · Right-click or Esc to cancel');
    else if (Game.mode === 'attackmove') this.hint('Click a destination to attack-move');
    else if (Game.mode === 'move') this.hint('Click a destination');
    else if (Game.mode === 'repair') this.hint('Click one of your buildings to repair it');
    else this.hint(null);
  },
  hotkey(k) {
    const c = this.commands.find((c) => c.key === k); if (!c) return false;
    if (c.disabled) { this.toast(c.disabled); Sfx.play('error'); return true; }
    Sfx.play('ui'); c.onClick(); this.cmdDirty = true; return true;
  },
  showTip(btn, c) {
    if (document.body.classList.contains('coarse')) return;
    const t = this.els.tooltip; t.innerHTML = '';
    t.appendChild(U.el('div', 'tip-name', c.label + (c.key ? `  [${c.key.toUpperCase()}]` : '')));
    if (c.cost) { const row = U.el('div', 'tip-cost'); for (const k in c.cost) { const s = U.el('span', 'cost' + ((Game.players[Game.human].res[k] || 0) < c.cost[k] ? ' short' : '')); s.appendChild(this.resIcon(k, 14)); s.appendChild(document.createTextNode(c.cost[k])); row.appendChild(s); } t.appendChild(row); }
    if (c.desc) t.appendChild(U.el('div', 'tip-desc', c.desc));
    if (c.disabled) t.appendChild(U.el('div', 'tip-why', c.disabled));
    t.hidden = false;
    const r = btn.getBoundingClientRect(); t.style.left = Math.max(8, Math.min(window.innerWidth - t.offsetWidth - 8, r.left + r.width / 2 - t.offsetWidth / 2)) + 'px'; t.style.top = (r.top - t.offsetHeight - 8) + 'px';
  },
  hideTip() { this.els.tooltip.hidden = true; },

  /* ---- end screen ---- */
  showEnd(won, reason) {
    const $ = this.$;
    $('end-title').textContent = won ? 'Victory' : 'Defeat'; $('end-title').className = won ? 'won' : 'lost';
    $('end-reason').textContent = reason;
    const tbl = $('end-stats'); tbl.innerHTML = '';
    const head = U.el('tr'); for (const h of ['Player', 'Age', 'Gathered', 'Trained', 'Kills', 'Losses', 'Razed']) head.appendChild(U.el('th', null, h)); tbl.appendChild(head);
    for (const p of Game.players) {
      const tr = U.el('tr'); const nm = U.el('td', null, p.name + (p.alive ? '' : ' ✝')); nm.style.color = p.color.light; tr.appendChild(nm);
      const g = p.stats.gathered; tr.appendChild(U.el('td', null, AGES[p.age].numeral)); tr.appendChild(U.el('td', null, U.fmt(g.food + g.wood + g.stone + g.gold))); tr.appendChild(U.el('td', null, p.stats.trained)); tr.appendChild(U.el('td', null, p.stats.kills)); tr.appendChild(U.el('td', null, p.stats.losses)); tr.appendChild(U.el('td', null, p.stats.razed));
      tbl.appendChild(tr);
    }
    $('end-time').textContent = 'Game time ' + U.time(Game.time);
    $('btn-end-continue').hidden = !won;
    this.showScreen('end');
  },
};
