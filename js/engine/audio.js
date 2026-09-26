/* Tiny WebAudio synth: every sound is generated, nothing is loaded. Distant events are quieter. */
const Sfx = {
  ctx: null, master: null, enabled: true, last: {}, volume: 0.6,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination); } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? this.volume : 0; },
  /* Loudness by distance from the camera centre (world tiles). */
  gainFor(x, y) { if (x == null) return 1; const d = U.dist(x, y, Renderer.cam.x, Renderer.cam.y); return U.clamp(1 - d / 26, 0, 1) ** 1.5; },
  play(name, x, y) {
    if (!this.enabled || !this.ctx) return;
    const g = this.gainFor(x, y); if (g <= 0.02) return;
    const now = this.ctx.currentTime;
    // throttle repeats of the same sound
    const minGap = { hit: 0.06, shoot: 0.05, die: 0.1, ui: 0.03 }[name] || 0.12;
    if (this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    const S = this.synth[name]; if (S) S.call(this, now, g);
  },
  tone(t0, freq, dur, type, vol, freqEnd, attack) {
    const c = this.ctx, o = c.createOscillator(), gn = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0); if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.01)); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn); gn.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  },
  /* One second of white noise, made once and reused: building a fresh buffer of random samples for every chop and
     arrow was a steady cost on phones and tablets. The fade that used to be baked in is now a gain ramp. */
  noiseBuf: null,
  noise(t0, dur, vol, lp) {
    const c = this.ctx;
    if (!this.noiseBuf) { const n = c.sampleRate, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = buf; }
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; const gn = c.createGain();
    gn.gain.setValueAtTime(vol, t0); gn.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
    src.connect(f); f.connect(gn); gn.connect(this.master); src.start(t0, Math.random() * 0.2, dur);
  },
  synth: {
    ui(t, g) { this.tone(t, 660, 0.06, 'triangle', 0.12 * g); },
    select(t, g) { this.tone(t, 520, 0.07, 'triangle', 0.1 * g, 700); },
    ack(t, g) { this.tone(t, 440, 0.05, 'triangle', 0.08 * g); this.tone(t + 0.06, 560, 0.06, 'triangle', 0.08 * g); },
    error(t, g) { this.tone(t, 180, 0.15, 'square', 0.07 * g, 140); },
    hit(t, g) { this.noise(t, 0.08, 0.25 * g, 900); this.tone(t, 220, 0.08, 'square', 0.05 * g, 90); },
    shoot(t, g) { this.noise(t, 0.12, 0.12 * g, 2500); this.tone(t, 900, 0.1, 'sine', 0.04 * g, 300); },
    die(t, g) { this.tone(t, 300, 0.3, 'sawtooth', 0.06 * g, 60); this.noise(t, 0.2, 0.12 * g, 600); },
    built(t, g) { this.tone(t, 523, 0.12, 'triangle', 0.12 * g); this.tone(t + 0.12, 659, 0.12, 'triangle', 0.12 * g); this.tone(t + 0.24, 784, 0.2, 'triangle', 0.12 * g); },
    collapse(t, g) { this.noise(t, 0.7, 0.5 * g, 400); this.tone(t, 90, 0.6, 'sawtooth', 0.15 * g, 30); },
    alert(t, g) { for (let i = 0; i < 3; i++) this.tone(t + i * 0.18, i % 2 ? 660 : 880, 0.15, 'square', 0.08); },
    ageup(t) { const seq = [523, 659, 784, 1046, 784, 1046]; seq.forEach((f, i) => this.tone(t + i * 0.13, f, i === seq.length - 1 ? 0.6 : 0.16, 'triangle', 0.14)); this.tone(t, 130, 1.2, 'sawtooth', 0.05); },
    research(t) { this.tone(t, 880, 0.1, 'sine', 0.1); this.tone(t + 0.1, 1175, 0.25, 'sine', 0.1); },
    victory(t) { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(t + i * 0.15, f, 0.5, 'triangle', 0.14)); },
    defeat(t) { [440, 415, 392, 330].forEach((f, i) => this.tone(t + i * 0.35, f, 0.6, 'sawtooth', 0.08)); },
    spawn(t, g) { this.tone(t, 392, 0.08, 'triangle', 0.08 * g); this.tone(t + 0.08, 494, 0.1, 'triangle', 0.08 * g); },
    coin(t, g) { this.tone(t, 1300, 0.08, 'sine', 0.06 * g); },
  },
};

/* A small readout of where each frame's time goes, switched on from the pause menu. Updated twice a second. */
const Perf = {
  on: false, el: null, sum: { tick: 0, draw: 0, ui: 0 }, frames: 0, since: 0, sprites: 0, lastTs: 0, worst: 0,
  init() { try { this.on = localStorage.getItem('anvil-perf') === '1'; } catch (e) {} },
  toggle() { this.on = !this.on; try { localStorage.setItem('anvil-perf', this.on ? '1' : '0'); } catch (e) {} if (this.el) this.el.hidden = !this.on; },
  add(k, ms) { if (this.on) this.sum[k] += ms; },
  frame(ts) {
    if (!this.on) return;
    if (!this.el) { this.el = document.createElement('div'); this.el.id = 'perf'; document.body.appendChild(this.el); this.el.onclick = () => { Renderer.debugOff = (Renderer.debugOff + 1) % 5; }; }
    this.el.hidden = false;
    if (this.lastTs) this.worst = Math.max(this.worst, ts - this.lastTs);
    this.lastTs = ts; this.frames++;
    if (!this.since) { this.since = ts; return; }
    const span = ts - this.since; if (span < 500) return;
    const f = this.frames, s = this.sum, R = typeof Renderer !== 'undefined' ? Renderer : null;
    const layers = ['all layers', 'no fog', 'no ground', 'no sprites', 'nothing drawn'][R ? R.debugOff : 0];
    this.el.textContent = `${Math.round(f * 1000 / span)} fps · worst ${Math.round(this.worst)} ms\nlogic ${(s.tick / f).toFixed(1)} · draw ${(s.draw / f).toFixed(1)} · ui ${(s.ui / f).toFixed(1)} ms\nnew sprites ${Math.round(((R ? R.spritesMade : 0) - this.sprites) * 1000 / span)}/s · ${R ? R.W + '×' + R.H + ' @' + R.dpr.toFixed(2) : ''}\n${layers} · tap here to test`;
    this.sprites = R ? R.spritesMade : 0; this.since = ts; this.frames = 0; this.worst = 0; s.tick = s.draw = s.ui = 0;
  },
};
Perf.init();
