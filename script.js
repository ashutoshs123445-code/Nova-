'use strict';
/* NOVA — AI Command Core (frontend prototype).
   NO API KEYS HERE. Keep them on your own server and set NOVA_CONFIG.endpoint to it. */
const NOVA_CONFIG = {
  apiKey: 'xyz',            // TEST ONLY: replace xyz with your own key. Never share or publish this file with a real key in it.
  provider: 'gemini',       // 'gemini' (free key from aistudio.google.com) or 'openai'
  model: '',                // empty = NOVA auto-picks a Gemini Flash model. For OpenAI use 'gpt-6-astra'
  voiceLang: 'hi-IN',       // mic language: hi-IN understands Hindi + English mix
  voice: 'Kore',            // Gemini voice name
  endpoint: null }; // e.g. '/api/nova' -> POST {command} -> {intent,confidence,tool,reply}
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms)), lerp = (a, b, t) => a + (b - a) * t, rnd = (a, b) => a + Math.random() * (b - a), TAU = Math.PI * 2;
const MONO = '"JetBrains Mono",monospace';
const PERF = { CINEMATIC: { n: 240, orb: 64, nodes: 26, seg: 72, dpr: 2 }, BALANCED: { n: 130, orb: 40, nodes: 18, seg: 56, dpr: 1.5 }, PERFORMANCE: { n: 50, orb: 20, nodes: 12, seg: 36, dpr: 1 } };
const STATES = {
  IDLE: { t: 'READY', c: [0, 229, 255], e: .25, sc: 1, sp: .35, pull: 0, net: .25, al: 0 },
  LISTENING: { t: 'LISTENING', c: [0, 229, 255], e: .55, sc: 1.12, sp: .6, pull: 1, net: .35, al: 0 },
  GESTURE: { t: 'GESTURE DETECTED', c: [110, 190, 255], e: .8, sc: 1.05, sp: 1.4, pull: .35, net: .5, al: 0 },
  ANALYZING: { t: 'ANALYZING', c: [110, 150, 255], e: .7, sc: 1.02, sp: 1.2, pull: .7, net: .8, al: 0 },
  THINKING: { t: 'THINKING', c: [165, 130, 255], e: 1, sc: 1.08, sp: 2, pull: .25, net: 1, al: 0 },
  EXECUTING: { t: 'EXECUTING', c: [0, 240, 255], e: 1.2, sc: .98, sp: 3, pull: -.6, net: .6, al: 1 },
  RESPONSE: { t: 'RESPONSE READY', c: [0, 229, 255], e: .4, sc: 1, sp: .4, pull: 0, net: .3, al: 0 }
};
const Input = { x: 0, y: 0, px: -999, py: -999 };

/* ---------- Sound (Web Audio, no files) ---------- */
const Sound = {
  on: false, ctx: null,
  toggle() { this.on = !this.on; if (this.on) { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); this.play('boot'); } return this.on; },
  tone(f, d = .15, type = 'sine', v = .03, to = f, delay = 0) {
    if (!this.on) return; const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + .05);
  },
  play(k) {
    const m = {
      boot: () => { this.tone(220, .5, 'sine', .03, 440); this.tone(660, .6, 'sine', .02, 880, .15); },
      accept: () => { this.tone(880, .09, 'triangle', .03); this.tone(1320, .12, 'triangle', .03, 1320, .08); },
      scan: () => this.tone(300, .5, 'sawtooth', .012, 1800),
      pulse: () => this.tone(110, .3, 'sine', .04, 80),
      exec: () => { this.tone(150, .6, 'sawtooth', .02, 900); this.tone(900, .3, 'sine', .025, 1400, .3); },
      done: () => { this.tone(523, .25, 'sine', .03); this.tone(784, .4, 'sine', .03, 784, .12); }
    }; (m[k] || (() => { }))();
  }
};

/* ---------- StateMachine ---------- */
const StateMachine = {
  cur: 'IDLE',
  set(n, label) {
    this.cur = n; const s = STATES[n];
    document.body.dataset.state = n.toLowerCase(); document.body.style.setProperty('--c', s.c.join(','));
    UIController.setText(label || s.t); CoreRenderer.onState(n);
    const k = { LISTENING: 'pulse', GESTURE: 'scan', ANALYZING: 'scan', THINKING: 'pulse', EXECUTING: 'exec', RESPONSE: 'done' }[n]; if (k) Sound.play(k);
  }
};

/* ---------- CoreRenderer (Canvas2D pseudo-3D; swap for Three.js later if wanted) ---------- */
const rot = (x, y, z, a, b, c) => { let C = Math.cos(a), S = Math.sin(a), y1 = y * C - z * S, z1 = y * S + z * C; C = Math.cos(b); S = Math.sin(b); const x2 = x * C + z1 * S, z2 = -x * S + z1 * C; C = Math.cos(c); S = Math.sin(c); return [x2 * C - y1 * S, x2 * S + y1 * C, z2]; };
const CoreRenderer = {
  rings: [
    { r: 1.25, a: [1.4, 0, 0], s: [0, .5, 0] }, { r: 1.45, a: [0, 1.3, 0], s: [.4, 0, 0] }, { r: 1.6, a: [.8, .6, 0], s: [0, 0, .35], d: [2, 8] },
    { r: 1.05, a: [1.1, 0, .8], s: [-.3, .6, 0] }, { r: 1.75, a: [1.5, .3, 0], s: [.15, -.2, 0], d: [1, 14], gold: true }, { r: 1.35, a: [.3, 1.2, 1], s: [.25, .35, -.2] }],
  init() {
    this.cv = $('#fx'); this.g = this.cv.getContext('2d'); this.t = 0; this.last = performance.now();
    this.p = { e: .25, sc: 1, sp: .35, pull: 0, net: .25, al: 0, c: [0, 229, 255] }; this.tg = STATES.IDLE;
    Object.assign(this, { mx: 0, my: 0, cy: 0, as: 1, reveal: 0, revT: 0, flashV: 0, prog: 0, progT: 0, focus: 0, focusT: 0, wave: 0, pulses: [], sparks: [], nextPulse: 1, st0: 0, pt: null, cX: 0, cY: 0, R: 100 });
    this.setMode(innerWidth < 700 ? 'BALANCED' : 'CINEMATIC'); addEventListener('resize', () => this.resize());
    this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
  },
  setMode(m) {
    this.mode = m; const P = this.P = PERF[m]; this.resize();
    this.amb = Array.from({ length: P.n }, () => ({ x: rnd(0, this.w), y: rnd(0, this.h), z: Math.random(), s: rnd(4, 16), a: rnd(0, TAU), vx: 0, vy: 0 }));
    this.orb = Array.from({ length: P.orb }, (_, i) => ({ r: i % this.rings.length, ph: rnd(0, TAU), sp: rnd(.3, 1.1) * (Math.random() < .5 ? -1 : 1), s: rnd(1, 2.4) }));
    this.nodes = Array.from({ length: P.nodes }, () => { const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u), k = rnd(1, 1.35); return { x: s * Math.cos(a) * k, y: s * Math.sin(a) * k, z: u * k, f: 0 }; });
  },
  resize() { const d = Math.min(devicePixelRatio || 1, this.P.dpr); this.w = innerWidth; this.h = innerHeight; this.cv.width = this.w * d; this.cv.height = this.h * d; this.g.setTransform(d, 0, 0, d, 0, 0); AirWritingEngine.layout(this.w, this.h); },
  flash(v) { this.flashV = v || 1; },
  spark(x, y, n = 3) { for (let i = 0; i < n; i++) this.sparks.push({ x, y, vx: rnd(-40, 40), vy: rnd(-40, 40), l: 1 }); if (this.sparks.length > 160) this.sparks.splice(0, 40); },
  burst() { for (let i = 0; i < 45; i++) { const q = this.amb[Math.random() * this.amb.length | 0], a = rnd(0, TAU); q.x = this.cX + Math.cos(a) * this.R; q.y = this.cY + Math.sin(a) * this.R; q.vx = Math.cos(a) * 420; q.vy = Math.sin(a) * 420; } },
  onState(n) {
    this.tg = STATES[n]; this.st0 = this.t;
    if (n === 'GESTURE') this.flash(.9); if (n === 'RESPONSE') this.flash(.3);
    if (n === 'EXECUTING') { this.flash(.7); this.burst(); const r = $('#panel').getBoundingClientRect(); this.pt = [r.left + r.width / 2, r.top + r.height / 2]; }
  },
  frame(now) { requestAnimationFrame(this.frame); if (document.hidden) return; const dt = Math.min((now - this.last) / 1e3, .05); this.last = now; this.t += dt; this.draw(dt); },
  draw(dt) {
    const g = this.g, w = this.w, h = this.h, t = this.t, p = this.p, tg = this.tg, k = Math.min(1, dt * 2.2), st = StateMachine.cur, air = AirWritingEngine.on;
    for (const f of ['e', 'sc', 'sp', 'pull', 'net', 'al']) p[f] = lerp(p[f], tg[f], k);
    p.c = p.c.map((v, i) => lerp(v, tg.c[i], k));
    this.reveal = lerp(this.reveal, this.revT, dt * 1.2); this.prog = lerp(this.prog, this.progT, dt * 3); this.focus = lerp(this.focus, this.focusT, dt * 4);
    this.flashV = Math.max(0, this.flashV - dt * 1.8); this.mx = lerp(this.mx, Input.x, dt * 3); this.my = lerp(this.my, Input.y, dt * 3);
    const ds = document.documentElement.style; ds.setProperty('--mx', this.mx.toFixed(3)); ds.setProperty('--my', this.my.toFixed(3));
    const portrait = w < h * .9, cyT = air ? h * .13 : h * (portrait ? .34 : .42); this.cy = this.cy ? lerp(this.cy, cyT, dt * 3) : cyT; this.as = lerp(this.as, air ? .5 : 1, dt * 3);
    const rev = this.reveal, e = p.e * rev, R = Math.min(w, h) * (portrait ? .19 : .135) * p.sc * this.as * (1 + Math.sin(t * 1.05) * .025 + this.focus * .06) * (.4 + .6 * rev);
    const cx = w / 2 + this.mx * 16, cy = this.cy + this.my * 10; this.cX = cx; this.cY = cy; this.R = R;
    const C = p.c.map(Math.round), col = a => `rgba(${C},${a})`, vi = a => `rgba(157,123,255,${a})`, go = a => `rgba(255,200,87,${a})`;
    g.clearRect(0, 0, w, h); g.globalCompositeOperation = 'lighter'; g.lineWidth = 1;
    // volumetric glow
    let gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 3.4); gr.addColorStop(0, col(.22 * e + .06 * rev)); gr.addColorStop(.4, col(.07 * e + .02)); gr.addColorStop(1, col(0)); g.fillStyle = gr; g.fillRect(cx - R * 3.4, cy - R * 3.4, R * 6.8, R * 6.8);
    // ambient + data particles
    for (const q of this.amb) {
      const dx = cx - q.x, dy = cy - q.y, d = Math.hypot(dx, dy) + 1, pl = p.pull * (.5 + q.z) * 90 / (1 + d / 200);
      q.vx = (q.vx + dx / d * pl * dt * 3) * (1 - dt * .8); q.vy = (q.vy + dy / d * pl * dt * 3) * (1 - dt * .8);
      const mdx = q.x - Input.px, mdy = q.y - Input.py, md = Math.hypot(mdx, mdy); if (md < 110) { q.vx += mdx / md * dt * 160; q.vy += mdy / md * dt * 160; }
      q.a += rnd(-1, 1) * dt * 2; q.x += (q.vx + Math.cos(q.a) * q.s * .5 * (.4 + q.z)) * dt; q.y += (q.vy + Math.sin(q.a) * q.s * .5 * (.4 + q.z)) * dt;
      if ((p.pull > .3 && d < R * .7) || q.x < -20 || q.x > w + 20 || q.y < -20 || q.y > h + 20) {
        if (p.pull < -.2) { const a = rnd(0, TAU); q.x = cx + Math.cos(a) * R * .8; q.y = cy + Math.sin(a) * R * .8; } else { q.x = rnd(0, w); q.y = Math.random() < .5 ? -10 : h + 10; } q.vx = q.vy = 0;
      }
      const a = (.1 + .35 * q.z) * (.5 + e * .6) * Math.max(rev, .25), sp = Math.hypot(q.vx, q.vy);
      g.fillStyle = q.z > .8 ? vi(a * 1.3) : col(a); g.beginPath(); g.arc(q.x, q.y, .6 + q.z * 1.6, 0, TAU); g.fill();
      if (sp > 40) { g.strokeStyle = col(a * 1.2); g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * .06, q.y - q.vy * .06); g.stroke(); }
    }
    // energy pulses
    this.nextPulse -= dt * (1 + p.e * 1.5); if (this.nextPulse <= 0 && rev > .5) { this.pulses.push(0); this.nextPulse = 6; }
    this.pulses = this.pulses.map(a => a + dt * .35).filter(a => a < 1);
    for (const a of this.pulses) { g.strokeStyle = col((1 - a) * .3); g.beginPath(); g.arc(cx, cy, R * (.8 + a * 3), 0, TAU); g.stroke(); }
    // rings (front/back split for depth)
    const seg = this.P.seg, al = p.al;
    this.rings.forEach((r, i) => {
      for (let j = 0; j < 3; j++) r.a[j] += r.s[j] * dt * (.4 + p.sp * .6);
      r.e = [r.a[0] * (1 - al), r.a[1] * (1 - al), r.a[2] * (1 - al) + al * i * .1];
      const Rr = R * r.r, path = { f: new Path2D(), b: new Path2D() }; let last = null, pp = null;
      for (let i2 = 0; i2 <= seg; i2++) {
        const a = i2 / seg * TAU, [x, y, z] = rot(Math.cos(a) * Rr, Math.sin(a) * Rr, 0, ...r.e), f = 900 / (900 + z), X = cx + x * f, Y = cy + y * f;
        if (pp) { const zz = (z + pp[2]) / 2 > 0 ? 'b' : 'f', P = path[zz]; if (last !== zz) P.moveTo(pp[0], pp[1]); P.lineTo(X, Y); last = zz; } pp = [X, Y, z];
      } r.path = path;
    });
    for (const r of this.rings) { g.setLineDash(r.d || []); g.strokeStyle = r.gold ? go(.3 * rev) : col(.2 * rev); g.stroke(r.path.b); }
    g.setLineDash([]);
    // sphere + nucleus
    const Rs = R * .62; gr = g.createRadialGradient(cx - Rs * .3, cy - Rs * .35, Rs * .05, cx, cy, Rs);
    gr.addColorStop(0, col(.9 * rev)); gr.addColorStop(.35, col(.3 + .25 * e)); gr.addColorStop(1, 'rgba(40,20,120,.12)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, Rs, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, Rs, 0, TAU); g.clip(); g.strokeStyle = vi(.35 * e + .1);
    for (let i = 0; i < 4; i++) { const ang = t * .25 * (.5 + p.sp) + i * Math.PI / 4; g.beginPath(); g.ellipse(cx, cy, Rs * Math.abs(Math.cos(ang)), Rs, i * .6 + t * .05, 0, TAU); g.stroke(); } g.restore();
    const nr = R * .16 * (1 + Math.sin(t * 3) * .08 + e * .2 + this.flashV * .6); gr = g.createRadialGradient(cx, cy, 0, cx, cy, nr * 2.4); gr.addColorStop(0, `rgba(255,255,255,${.95 * rev})`); gr.addColorStop(.35, col(.7 * rev)); gr.addColorStop(1, col(0)); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, nr * 2.4, 0, TAU); g.fill();
    if (this.flashV > 0) { gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 2.5); gr.addColorStop(0, `rgba(255,255,255,${this.flashV * .35})`); gr.addColorStop(1, col(0)); g.fillStyle = gr; g.fillRect(cx - R * 2.5, cy - R * 2.5, R * 5, R * 5); }
    // neural network
    const sp2 = .5 + p.sp * .3, nd = this.nodes.map(n => { const [x, y, z] = rot(n.x * R, n.y * R, n.z * R, t * .11 * sp2, t * .17 * sp2, 0), f = 900 / (900 + z); return { X: cx + x * f, Y: cy + y * f, x, y, z, n }; });
    if (Math.random() < p.net * dt * 3) this.nodes[Math.random() * this.nodes.length | 0].f = 1;
    const thr = R * (.7 + .35 * p.net + .1 * Math.sin(t * 2)); g.lineWidth = .7;
    for (let i = 0; i < nd.length; i++) for (let j = i + 1; j < nd.length; j++) {
      const d = Math.hypot(nd[i].x - nd[j].x, nd[i].y - nd[j].y, nd[i].z - nd[j].z);
      if (d < thr) { const a = (1 - d / thr) * (.08 + .6 * p.net) * rev, hot = nd[i].n.f + nd[j].n.f > .6; g.strokeStyle = hot ? col(a * 1.6) : vi(a); g.beginPath(); g.moveTo(nd[i].X, nd[i].Y); g.lineTo(nd[j].X, nd[j].Y); g.stroke(); }
    }
    for (const o of nd) { o.n.f = Math.max(0, o.n.f - dt * 1.5); g.fillStyle = col((.4 + .6 * o.n.f) * rev); g.beginPath(); g.arc(o.X, o.Y, 1.2 + 1.8 * o.n.f, 0, TAU); g.fill(); }
    g.lineWidth = 1;
    // front ring halves + orbit particles
    for (const r of this.rings) { g.setLineDash(r.d || []); g.strokeStyle = r.gold ? go(.55 * rev) : col((.35 + .4 * p.e) * rev); g.stroke(r.path.f); } g.setLineDash([]);
    for (const o of this.orb) {
      const r = this.rings[o.r], a = o.ph + t * o.sp * (.5 + p.sp * .4), Rr = R * r.r, [x, y, z] = rot(Math.cos(a) * Rr, Math.sin(a) * Rr, 0, ...r.e), f = 900 / (900 + z);
      g.fillStyle = r.gold ? go(.9 * rev) : col((.35 + .5 * (z < 0)) * rev); g.beginPath(); g.arc(cx + x * f, cy + y * f, o.s * f * (1 + e * .4), 0, TAU); g.fill();
    }
    // listening waveform
    const wv = this.wave = lerp(this.wave, st === 'LISTENING' ? 1 : 0, dt * 4);
    if (wv > .02) { g.strokeStyle = col(.8 * wv); g.lineWidth = 1.5; g.beginPath(); for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, r = R * 1.9 + R * .13 * wv * (Math.sin(a * 7 + t * 9) * Math.sin(t * 3.1) + Math.sin(a * 13 - t * 6) * .5); i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.stroke(); g.lineWidth = 1; }
    // scanner / target lock
    if (st === 'GESTURE' || st === 'ANALYZING') {
      const gs = st === 'GESTURE', a = t * (gs ? 5 : 2); g.strokeStyle = col(.7 * rev); g.lineWidth = 1.5;
      g.beginPath(); g.arc(cx, cy, R * 1.95, a, a + 1.3); g.stroke(); g.beginPath(); g.arc(cx, cy, R * 1.95, a + Math.PI, a + Math.PI + .5); g.stroke(); g.lineWidth = 1;
      const sy = h * (.5 + .5 * Math.sin(t * (gs ? 6 : 2.2))); gr = g.createLinearGradient(0, sy - 30, 0, sy + 2); gr.addColorStop(0, col(0)); gr.addColorStop(1, col(.22)); g.fillStyle = gr; g.fillRect(0, sy - 30, w, 32);
      if (gs) { const S = R * 2.2 * (1 + Math.max(0, 1 - (t - this.st0) * 2) * .6); g.strokeStyle = go(.7); for (const [sx, sy2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { g.beginPath(); g.moveTo(cx + sx * S, cy + sy2 * (S - 18)); g.lineTo(cx + sx * S, cy + sy2 * S); g.lineTo(cx + sx * (S - 18), cy + sy2 * S); g.stroke(); } }
    }
    // progress ring, symbols, command path
    if ((st === 'ANALYZING' || st === 'THINKING' || st === 'EXECUTING') && this.prog > .01) {
      g.strokeStyle = col(.12); g.beginPath(); g.arc(cx, cy, R * 2.05, 0, TAU); g.stroke(); g.strokeStyle = col(.85); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * 2.05, -Math.PI / 2, -Math.PI / 2 + this.prog * TAU); g.stroke(); g.lineWidth = 1;
    }
    if (st === 'THINKING') { const G = '∑∫λ∂π√Ωθ∇≈'; g.font = `10px ${MONO}`; g.fillStyle = vi(.7); for (let i = 0; i < 10; i++) { const a = t * .8 + i * TAU / 10; g.fillText(G[i], cx + Math.cos(a) * R * 2.5, cy + Math.sin(a) * R * 1.1); } }
    if (st === 'EXECUTING' && this.pt) {
      const [tx, ty] = this.pt, dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy), sx = cx + dx / d * R * 1.8, sy = cy + dy / d * R * 1.8, u = (t * 1.2) % 1;
      g.setLineDash([6, 8]); g.lineDashOffset = -t * 60; g.strokeStyle = go(.6); g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
      g.fillStyle = go(1); g.beginPath(); g.arc(lerp(sx, tx, u), lerp(sy, ty, u), 3, 0, TAU); g.fill();
    }
    // gesture hand (live camera landmarks)
    const lv = GestureEngine.live;
    if (lv) {
      g.strokeStyle = col(.6); g.lineWidth = 1.2; for (const ch of GestureEngine.chains) { g.beginPath(); ch.forEach((k2, i) => i ? g.lineTo(lv[k2].x, lv[k2].y) : g.moveTo(lv[k2].x, lv[k2].y)); g.stroke(); }
      g.fillStyle = col(.95); for (const q of lv) { g.beginPath(); g.arc(q.x, q.y, 2.6, 0, TAU); g.fill(); }
      const pm = lv[9], sz = Math.hypot(lv[0].x - lv[9].x, lv[0].y - lv[9].y); g.strokeStyle = col(.35); g.lineWidth = 1;
      g.beginPath(); g.arc(pm.x, pm.y, sz * 1.4, t * 2, t * 2 + 1.2); g.stroke(); g.beginPath(); g.arc(pm.x, pm.y, sz * 1.4, t * 2 + Math.PI, t * 2 + Math.PI + .6); g.stroke();
      if (GestureEngine.pinch) { g.strokeStyle = go(.9); g.beginPath(); g.arc((lv[4].x + lv[8].x) / 2, (lv[4].y + lv[8].y) / 2, 10 + Math.sin(t * 8) * 2, 0, TAU); g.stroke(); }
      g.font = `9px ${MONO}`; g.fillStyle = col(.8); g.fillText(GestureEngine.name, lv[0].x + 14, lv[0].y + 14);
    }
    if (air) AirWritingEngine.draw(g, col, go, t);
    // sparks
    this.sparks = this.sparks.filter(s => (s.l -= dt * 1.6) > 0); for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; g.fillStyle = col(s.l * .8); g.beginPath(); g.arc(s.x, s.y, 1.5, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  }
};

/* ---------- GestureEngine: REAL camera hand tracking (MediaPipe HandLandmarker from CDN) ---------- */
const GestureEngine = {
  on: false, starting: false, live: null, pinch: false, name: 'NO HAND', mode: '', video: null, hl: null, last: 0, lt: -1,
  chains: [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]],
  async load() {
    if (this.hl) return; const U = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/';
    const V = await import(U + 'vision_bundle.mjs'), fs = await V.FilesetResolver.forVisionTasks(U + 'wasm');
    const opt = d => ({ baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: d }, runningMode: 'VIDEO', numHands: 1 });
    try { this.hl = await V.HandLandmarker.createFromOptions(fs, opt('GPU')); } catch (e) { this.hl = await V.HandLandmarker.createFromOptions(fs, opt('CPU')); }
  },
  async start(mode) {
    this.mode = mode || ''; if (this.on || this.starting) return; this.starting = true; $('#hVis').textContent = 'LOADING'; if (!this.mode) StateMachine.set('ANALYZING', 'LOADING VISION');
    try { this.video = $('#cam'); this.video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false }); await this.video.play(); } catch (e) { return this.fail(e); }
    try { await this.load(); } catch (e) { return this.fail(e, true); }
    this.on = true; this.starting = false; this.lt = -1; document.body.classList.add('cam'); if (!this.mode) document.body.classList.add('gesture');
    $('#hVis').textContent = $('#dVis').textContent = 'ACTIVE'; $('#bGest').classList.add('act'); if (!this.mode) StateMachine.set('IDLE', 'SHOW YOUR HAND'); this.loop();
  },
  release() { const s = this.video && this.video.srcObject; if (s) s.getTracks().forEach(t => t.stop()); if (this.video) this.video.srcObject = null; },
  fail(e, model) {
    console.error(e); this.starting = false; this.release(); $('#hVis').textContent = 'ERROR';
    const m = model ? 'MODEL LOAD FAILED' : !navigator.mediaDevices ? 'CAMERA NEEDS HTTPS' : (e && e.name === 'NotAllowedError') ? 'CAMERA BLOCKED' : 'CAMERA ERROR';
    if (!AirWritingEngine.on) StateMachine.set('IDLE', m); setTimeout(() => { $('#hVis').textContent = 'READY'; if (!AirWritingEngine.on && StateMachine.cur === 'IDLE' && !UIController.busy) StateMachine.set('IDLE', 'READY'); }, 3000);
  },
  stop(quiet) {
    this.on = this.starting = false; this.release(); this.live = null; this.mode = ''; this.name = 'NO HAND'; this.pinch = false; document.body.classList.remove('gesture', 'cam');
    $('#hVis').textContent = 'READY'; $('#dVis').textContent = 'STANDBY'; $('#bGest').classList.remove('act'); if (!quiet && ['IDLE', 'GESTURE'].includes(StateMachine.cur)) StateMachine.set('IDLE', 'READY');
  },
  toggle() { if (UIController.busy) return; (this.on || this.starting) ? this.stop() : this.start(); },
  loop() {
    if (!this.on) return; requestAnimationFrame(() => this.loop()); const v = this.video, now = performance.now();
    if (v.readyState < 2 || v.currentTime === this.lt || now - this.last < 33) return; this.lt = v.currentTime; this.last = now;
    let res; try { res = this.hl.detectForVideo(v, now); } catch (e) { return; } this.onResult(res);
  },
  upd(L, conf) { $('#gName').textContent = this.name; $('#gLock').textContent = L ? 'LOCKED' : 'SEARCHING'; $('#gConf').textContent = conf ? (conf * 100).toFixed(1) + '%' : '—'; },
  onResult(res) {
    const L = res.landmarks && res.landmarks[0];
    if (!L) { this.live = null; this.pinch = false; if (this.name !== 'NO HAND') { this.name = 'NO HAND'; this.upd(); } AirWritingEngine.hand(null, false); }
    else {
      const w = innerWidth, h = innerHeight, G = 1.4, mp = p => ({ x: Math.max(0, Math.min(w, w / 2 + ((1 - p.x) * w - w / 2) * G)), y: Math.max(0, Math.min(h, h / 2 + (p.y * h - h / 2) * G)) });
      const raw = L.map(mp); this.live = raw.map((p, i) => this.live ? { x: lerp(this.live[i].x, p.x, .5), y: lerp(this.live[i].y, p.y, .5) } : p);
      const d = (i, j) => Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y), size = d(0, 9) || .1, ext = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([t, p]) => d(t, 0) > d(p, 0) * 1.15), n = ext.filter(Boolean).length;
      this.pinch = d(4, 8) < size * (this.pinch ? .5 : .32);
      const name = this.pinch ? 'PINCH' : n === 0 ? 'FIST' : n === 4 ? 'OPEN PALM' : (ext[0] && !ext[1] && !ext[2] && !ext[3]) ? 'POINT' : (ext[0] && ext[1] && !ext[2] && !ext[3]) ? 'PEACE' : 'TRACKING';
      if (name !== this.name) { this.name = name; CoreRenderer.flash(.5); } this.upd(L, res.handednesses && res.handednesses[0] && res.handednesses[0][0] && res.handednesses[0][0].score);
      AirWritingEngine.hand({ x: (this.live[4].x + this.live[8].x) / 2, y: (this.live[4].y + this.live[8].y) / 2 }, this.pinch);
    }
    if (!this.mode && !UIController.busy && ['IDLE', 'GESTURE'].includes(StateMachine.cur)) { const want = L ? 'GESTURE' : 'IDLE'; if (StateMachine.cur !== want) StateMachine.set(want, L ? undefined : 'SHOW YOUR HAND'); }
  }
};

/* ---------- VoiceEngine: always-on mic (browser speech-to-text) + Gemini voice (TTS) for replies ---------- */
const VoiceEngine = {
  on: false, auto: true, speaking: false, rec: null, ac: null, tm: null, lt: null, fails: 0,
  init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { $('#bVoice').textContent = 'MIC N/A'; this.auto = false; return; }
    const r = this.rec = new SR(); r.continuous = true; r.interimResults = true; r.lang = NOVA_CONFIG.voiceLang;
    r.onstart = () => { this.on = true; };
    r.onresult = e => {
      if (this.speaking || !document.body.classList.contains('live')) return; let fin = '', tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; e.results[i].isFinal ? fin += t : tmp += t; }
      if (tmp || fin) this.hear(); if (fin.trim().length > 1) UIController.run(fin);
    };
    r.onend = () => { this.on = false; if (this.auto && !this.speaking) setTimeout(() => this.listen(), 300); };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.auto = false; this.ui(); UIController.setText('MIC BLOCKED'); } };
    addEventListener('pointerdown', () => { if (this.ac) this.ac.resume(); this.listen(); });
    this.ui(); this.listen();
  },
  ui() { document.body.classList.toggle('miclive', this.auto); $('#bVoice').textContent = this.auto ? 'MIC AUTO ON' : 'MIC OFF'; $('#bVoice').classList.toggle('act', this.auto); },
  toggle() { this.auto = !this.auto; this.ui(); if (this.auto) this.listen(); else { try { this.rec.stop(); } catch (e) { } if (window.speechSynthesis) speechSynthesis.cancel(); } },
  listen() { if (!this.rec || this.on || this.speaking || !this.auto) return; try { this.rec.start(); } catch (e) { } },
  hear() {
    if (StateMachine.cur === 'IDLE' && !UIController.busy) StateMachine.set('LISTENING'); clearTimeout(this.lt);
    this.lt = setTimeout(() => { if (StateMachine.cur === 'LISTENING' && !UIController.busy && !AirWritingEngine.on) StateMachine.set('IDLE'); }, 2500);
  },
  async say(text) {
    if (!this.auto || !text || /^(API|Network) error/.test(text)) return; this.speaking = true; try { if (this.on) this.rec.stop(); } catch (e) { }
    if (this.fails < 2) { try { await this.gem(text); this.fails = 0; } catch (e) { this.fails++; await this.web(text); } } else await this.web(text);
    this.speaking = false; this.listen();
  },
  async gem(text) {
    const key = AICommandRouter.key(); if (!key || NOVA_CONFIG.provider !== 'gemini') throw 0;
    const H = { 'Content-Type': 'application/json', 'x-goog-api-key': key }, B = 'https://generativelanguage.googleapis.com/v1beta/';
    if (!this.tm) {
      const l = await (await fetch(B + 'models', { headers: H })).json();
      const c = (l.models || []).filter(x => (x.supportedGenerationMethods || []).includes('generateContent') && /tts/.test(x.name)).map(x => x.name.replace('models/', '')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); if (!c.length) throw 0; this.tm = c[0];
    }
    const r = await fetch(B + 'models/' + this.tm + ':generateContent', { method: 'POST', headers: H, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: NOVA_CONFIG.voice } } } } }) });
    if (!r.ok) { if (r.status === 404) this.tm = null; throw 0; }
    const j = await r.json(), p = (j.candidates?.[0]?.content?.parts || []).find(x => x.inlineData); if (!p) throw 0; await this.play(p.inlineData.data);
  },
  play(b64) {
    return new Promise(res => {
      const ac = this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume();
      const bin = atob(b64), n = bin.length >> 1, buf = ac.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; ch[i] = v / 32768; }
      const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination); s.onended = res; s.start(); setTimeout(res, n / 24 + 1500);
    });
  },
  web(text) {
    return new Promise(res => { if (!window.speechSynthesis) return res(); const u = new SpeechSynthesisUtterance(text); u.lang = NOVA_CONFIG.voiceLang; u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 15000); });
  }
};

/* ---------- AirWritingEngine ---------- */
const AirWritingEngine = {
  on: false, strokes: [], cur: null, rec: 'WAITING...', t0: 0, cursor: null, r: { x: 0, y: 0, w: 0, h: 0 },
  layout(w, h) { this.r = { x: w * .08, y: h * .2, w: w * .84, h: h * .45 }; },
  init() {
    const z = $('#airZone'), pos = e => ({ x: e.clientX, y: e.clientY });
    z.addEventListener('pointerdown', e => { z.setPointerCapture(e.pointerId); this.cur = [pos(e)]; this.strokes.push(this.cur); this.rec = 'WAITING...'; this.upd(); });
    z.addEventListener('pointermove', e => { this.cursor = pos(e); if (this.cur) { this.cur.push(pos(e)); CoreRenderer.spark(e.clientX, e.clientY, 1); this.upd(); } });
    z.addEventListener('pointerup', () => { this.cur = null; this.t0 = performance.now(); this.upd(); });
    z.addEventListener('pointerleave', () => { this.cursor = null; });
    setInterval(() => this.tick(), 300);
  },
  async tick() {
    if (!this.on || this.cur || !this.strokes.length || this.rec !== 'WAITING...' || performance.now() - this.t0 < 1200) return;
    this.rec = 'ANALYZING...'; this.upd(); const txt = await this.recognize(this.strokes); this.rec = 'RESULT: ' + txt; this.upd();
    await sleep(2200); this.strokes = []; this.rec = 'WAITING...'; this.upd();
  },
  async recognize(strokes) { /* HOOK: rasterize strokes -> send to your backend -> vision model */ await sleep(900); return ['NOVA', 'HELLO', 'OPEN', 'AI'][Math.random() * 4 | 0]; },
  toggle(f) {
    const on = f === undefined ? !this.on : f; if (on === this.on) return; this.on = on; document.body.classList.toggle('air', on); $('#bAir').classList.toggle('act', on);
    if (on) { this.strokes = []; this.rec = 'WAITING...'; this.upd(); StateMachine.set('LISTENING', 'SPATIAL WRITING'); GestureEngine.start('air'); } else { this.cur = this.cursor = this.sm = null; if (GestureEngine.on || GestureEngine.starting) GestureEngine.stop(true); if (StateMachine.cur === 'LISTENING') StateMachine.set('IDLE'); }
  },
  hand(pt, down) { // fed by GestureEngine: pt = pen position (screen px), down = pinching
    if (!this.on) return;
    if (!pt) { if (this.cur) { this.cur = null; this.t0 = performance.now(); this.upd(); } this.cursor = this.sm = null; return; }
    const s = this.sm = this.sm ? { x: lerp(this.sm.x, pt.x, .5), y: lerp(this.sm.y, pt.y, .5) } : pt; this.cursor = s;
    if (down) { if (!this.cur) { this.cur = []; this.strokes.push(this.cur); this.rec = 'WAITING...'; } this.cur.push({ x: s.x, y: s.y }); if (Math.random() < .5) CoreRenderer.spark(s.x, s.y, 1); this.upd(); }
    else if (this.cur) { this.cur = null; this.t0 = performance.now(); this.upd(); }
  },
  upd() { $('#aN').textContent = this.strokes.length; $('#aIn').textContent = this.cur ? 'STROKE DETECTED' : 'IDLE'; $('#aRec').textContent = this.rec; },
  draw(g, col, go, t) {
    const r = this.r; g.lineWidth = 1; g.strokeStyle = col(.4);
    for (const [a, b, sx, sy] of [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]]) { const x = r.x + a * r.w, y = r.y + b * r.h; g.beginPath(); g.moveTo(x, y + sy * 22); g.lineTo(x, y); g.lineTo(x + sx * 22, y); g.stroke(); }
    g.strokeStyle = col(.06); for (let i = 1; i < 8; i++) { const x = r.x + r.w * i / 8; g.beginPath(); g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); g.stroke(); }
    for (let i = 1; i < 5; i++) { const y = r.y + r.h * i / 5; g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke(); }
    g.lineCap = g.lineJoin = 'round';
    for (const s of this.strokes) { if (s.length < 2) continue; g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.strokeStyle = col(.18); g.lineWidth = 9; g.stroke(); g.strokeStyle = col(.95); g.lineWidth = 2; g.stroke(); }
    g.lineWidth = 1; const c = this.cursor;
    if (c) { const k = 10 + Math.sin(t * 5) * 2; g.strokeStyle = go(.8); g.beginPath(); g.arc(c.x, c.y, k, 0, TAU); g.moveTo(c.x - 24, c.y); g.lineTo(c.x - 6, c.y); g.moveTo(c.x + 6, c.y); g.lineTo(c.x + 24, c.y); g.moveTo(c.x, c.y - 24); g.lineTo(c.x, c.y - 6); g.moveTo(c.x, c.y + 6); g.lineTo(c.x, c.y + 24); g.stroke();
      g.font = `9px ${MONO}`; g.fillStyle = col(.8); g.fillText(`X ${((c.x - r.x) / r.w).toFixed(3)}  Y ${((c.y - r.y) / r.h).toFixed(3)}  Z ${(Math.sin(t * 2) * .5).toFixed(2)}`, c.x + 16, c.y - 16); }
  }
};

/* ---------- ToolRegistry / AICommandRouter / AgentEngine ---------- */
const ToolRegistry = {
  tools: [
    { id: 'workspace', re: /workspace/i, intent: 'Workspace.Open', run: () => ({ r: 'Workspace opened. 4 panels restored.' }) },
    { id: 'code', re: /code/i, intent: 'Code.Analyze', run: () => ({ r: 'Static scan complete. 0 critical, 2 hints.' }) },
    { id: 'air', re: /air ?writ/i, intent: 'Input.AirWrite', run: () => ({ r: 'Spatial writing engine armed.', after: () => AirWritingEngine.toggle(true) }) },
    { id: 'status', re: /status/i, intent: 'System.Status', run: () => ({ r: 'All subsystems nominal.', after: () => UIController.diag(true) }) },
    { id: 'project', re: /project/i, intent: 'Project.Create', run: () => ({ r: 'Project scaffold created: nova-project/' }) },
    { id: 'explain', re: /explain/i, intent: 'Knowledge.Explain', run: () => ({ r: 'Concept model assembled. Ready to explain.' }) },
    { id: 'search', re: /search/i, intent: 'Knowledge.Search', run: () => ({ r: '128 nodes matched in 14ms.' }) },
    { id: 'diag', re: /diagnos/i, intent: 'System.Diagnostics', run: () => ({ r: 'Diagnostics passed: 6/6 subsystems.', after: () => UIController.diag(true) }) },
    { id: 'vision', re: /vision/i, intent: 'Vision.Activate', run: () => ({ r: 'Vision engine online. Hand tracking locked.', after: () => GestureEngine.start() }) }],
  fallback: { id: 'llm', intent: 'General.Query', run: () => ({ r: 'Simulated reply. Connect your LLM in AICommandRouter.route().' }) },
  match(t) { return this.tools.find(x => x.re.test(t)) || this.fallback; }
};
const Store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };
const AICommandRouter = {
  hist: [],
  key() { return (NOVA_CONFIG.apiKey && NOVA_CONFIG.apiKey !== 'xyz') ? NOVA_CONFIG.apiKey : Store.get('nova_key'); },
  async gemini(key, text) {
    const H = { 'Content-Type': 'application/json', 'x-goog-api-key': key }, B = 'https://generativelanguage.googleapis.com/v1beta/';
    const call = m => fetch(B + 'models/' + m + ':generateContent', { method: 'POST', headers: H, body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are NOVA, the AI core of a futuristic personal AI operating system. Reply in the same language and style as the user (Hinglish stays Hinglish in Roman script). At most 2 short sentences, no markdown, no emojis. If asked to perform an action, respond as if you just did it.' }] }, contents: [...this.hist, { role: 'user', parts: [{ text }] }] }) });
    let m = this.gm || NOVA_CONFIG.model, r = m ? await call(m) : null;
    if (!r || r.status === 404) {
      const l = await (await fetch(B + 'models', { headers: H })).json();
      const c = (l.models || []).filter(x => (x.supportedGenerationMethods || []).includes('generateContent') && /flash/.test(x.name) && !/lite|image|tts|live|audio/.test(x.name)).map(x => x.name.replace('models/', '')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (!c.length) return 'API error: ' + ((l.error && l.error.message) || 'no usable Gemini model for this key').slice(0, 90);
      this.gm = m = c[0]; r = await call(m);
    }
    const j = await r.json();
    const rep = r.ok ? (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim() : ''; if (rep) { this.hist = [...this.hist, { role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: rep }] }].slice(-12); return rep; }
    return r.ok ? 'No reply.' : 'API error ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 90);
  },
  async route(text) {
    if (NOVA_CONFIG.endpoint) { try { const r = await fetch(NOVA_CONFIG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: text }) }); return await r.json(); } catch (e) { /* fall back to simulation */ } }
    const tool = ToolRegistry.match(text), key = (NOVA_CONFIG.apiKey && NOVA_CONFIG.apiKey !== 'xyz') ? NOVA_CONFIG.apiKey : Store.get('nova_key'), out = { intent: tool.intent, confidence: tool === ToolRegistry.fallback ? rnd(70, 85) : rnd(94, 99.4), tool: tool.id };
    if (!key) { await sleep(rnd(200, 500)); return out; }
    if (NOVA_CONFIG.provider === 'gemini') { try { out.reply = await this.gemini(key, text); } catch (e) { out.reply = 'Network error: could not reach the API.'; } return out; }
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: Store.get('nova_model') || NOVA_CONFIG.model, messages: [{ role: 'system', content: 'You are NOVA, the AI core of a futuristic personal AI operating system. Reply in the same language and style as the user (Hinglish stays Hinglish in Roman script). At most 2 short sentences, no markdown, no emojis. If asked to perform an action, respond as if you just did it.' }, { role: 'user', content: text }] }) });
      const j = await r.json(); out.reply = r.ok ? j.choices[0].message.content.trim() : 'API error ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 90);
    } catch (e) { out.reply = 'Network error: could not reach the API.'; }
    return out;
  }
};
const AgentEngine = { // HOOK: real agent loop / tool calls (server-side)
  async execute(route, text) {
    const tool = ToolRegistry.tools.find(x => x.id === route.tool) || ToolRegistry.fallback; await sleep(1300);
    const res = tool.run(text); if (route.reply) res.r = route.reply; return res;
  }
};

/* ---------- UIController ---------- */
const UIController = {
  busy: false, sid: 0, txt: '', skipped: false,
  init() {
    addEventListener('pointermove', e => { Input.x = (e.clientX / innerWidth - .5) * 2; Input.y = (e.clientY / innerHeight - .5) * 2; Input.px = e.clientX; Input.py = e.clientY; });
    addEventListener('pointerleave', () => { Input.px = Input.py = -999; });
    $('#cmd').addEventListener('submit', e => { e.preventDefault(); this.run($('#cmdIn').value); });
    $('#cmdIn').addEventListener('focus', () => CoreRenderer.focusT = 1); $('#cmdIn').addEventListener('blur', () => CoreRenderer.focusT = 0);
    ['Open workspace', 'Analyze this code', 'Start air writing', 'Show system status', 'Create a project', 'Explain this concept', 'Search my knowledge', 'Run diagnostics', 'Activate vision'].forEach(c => {
      const b = document.createElement('button'); b.className = 'mag'; b.textContent = c; b.onclick = () => this.run(c); $('#chips').appendChild(b);
    });
    $('#menu').onclick = () => $('#tools').classList.toggle('open');
    $('#bSound').onclick = () => { const on = Sound.toggle(); $('#bSound').textContent = on ? 'SOUND ON' : 'SOUND OFF'; $('#bSound').classList.toggle('act', on); };
    $('#bVoice').onclick = () => VoiceEngine.toggle(); $('#bGest').onclick = () => GestureEngine.toggle();
    $('#bAir').onclick = () => { if (!this.busy) AirWritingEngine.toggle(); }; $('#bDiag').onclick = () => this.diag();
    $('#bKey').onclick = () => { const k = prompt('Paste your API key (saved only in this browser):', ''); if (k === null) return; Store.set('nova_key', k.trim()); $('#bKey').classList.toggle('act', !!Store.get('nova_key')); };
    $('#bKey').classList.toggle('act', !!Store.get('nova_key'));
    $('#bPerf').onclick = () => { const ks = Object.keys(PERF), m = ks[(ks.indexOf(CoreRenderer.mode) + 1) % ks.length]; CoreRenderer.setMode(m); $('#bPerf').textContent = m; };
    $('#bPerf').textContent = CoreRenderer.mode;
    $('#skip').onclick = () => this.skipped = true; addEventListener('keydown', e => { if (e.key === 'Escape') this.skipped = true; });
    $$('.mag').forEach(b => { b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .18}px,${(e.clientY - r.top - r.height / 2) * .28}px)`; b.classList.add('hot'); if (Math.random() < .25) CoreRenderer.spark(e.clientX, e.clientY, 1); }); b.addEventListener('pointerleave', () => { b.style.transform = ''; b.classList.remove('hot'); }); });
    setInterval(() => {
      const e = STATES[StateMachine.cur].e; $('#hLoad').textContent = Math.round(18 + e * 30 + rnd(0, 6)) + '%'; $('#hLat').textContent = Math.round(14 + e * 10 + rnd(0, 6)) + 'ms'; $('#hSig').textContent = Math.round(96 + rnd(0, 3)) + '%';
      $$('#diag i').forEach(i => i.style.setProperty('--v', rnd(.55, .98).toFixed(2)));
    }, 1400);
    this.boot();
  },
  async boot() {
    const L = ['INITIALIZING NOVA', 'LOADING NEURAL CORE', 'CALIBRATING INTERFACE', 'ESTABLISHING SYSTEM LINK', 'NOVA ONLINE'], box = $('#bootL');
    for (const l of L) { const d = document.createElement('div'); d.textContent = l; box.appendChild(d); if (box.children.length > 2) box.firstChild.remove(); for (let i = 0; i < 10 && !this.skipped; i++) await sleep(55); }
    await sleep(this.skipped ? 0 : 300); $('#boot').classList.add('off'); document.body.classList.add('live'); CoreRenderer.revT = 1; StateMachine.set('IDLE'); Sound.play('boot');
  },
  setText(t) {
    if (this.txt === t) return; this.txt = t; const el = $('#stateText'), ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/', id = ++this.sid; let f = 0;
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    const step = () => { if (id !== this.sid) return; f++; if (f >= t.length * 1.6 + 2) { el.textContent = t; return; } el.textContent = [...t].map((c, i) => c === ' ' || i < f / 1.6 ? c : ch[Math.random() * ch.length | 0]).join(''); setTimeout(step, 28); };
    step();
  },
  diag(f) { $('#diag').classList.toggle('on', f); $('#bDiag').classList.toggle('act', $('#diag').classList.contains('on')); },
  flow(i) { $$('#flow li').forEach((li, j) => { li.classList.toggle('on', j === i); li.classList.toggle('done', j < i); }); },
  stat(s) { $('#pStat').textContent = s; },
  count(v) { const el = $('#pConf'), t0 = performance.now(), s = () => { const k = Math.min(1, (performance.now() - t0) / 600); el.textContent = (v * k).toFixed(1) + '%'; if (k < 1) requestAnimationFrame(s); }; s(); },
  tid: 0,
  type(t) { const el = $('#pRes'), id = ++this.tid; el.classList.add('show'); let i = 0; const s = () => { if (id !== this.tid) return; el.textContent = t.slice(0, ++i); if (i < t.length) setTimeout(s, 18); }; s(); },
  panel(cmd) { this.tid++; $('#pCmd').textContent = cmd; $('#pInt').textContent = '—'; $('#pConf').textContent = '—'; $('#pStat').textContent = 'RECEIVED'; $('#pRes').textContent = ''; $('#pRes').classList.remove('show'); $('#panel').classList.remove('recede'); $('#panel').classList.add('on'); },
  async run(text) {
    text = (text || '').trim(); if (!text || this.busy) return; this.busy = true; $('#cmdIn').value = ''; $('#cmdIn').blur();
    AirWritingEngine.toggle(false);
    this.panel(text); this.flow(0); StateMachine.set('ANALYZING', 'COMMAND RECEIVED'); CoreRenderer.flash(.6); CoreRenderer.progT = .1; Sound.play('accept'); await sleep(650);
    this.flow(1); StateMachine.set('ANALYZING'); this.stat('ANALYZING'); CoreRenderer.progT = .35; await sleep(1300);
    this.flow(2); StateMachine.set('THINKING'); this.stat('THINKING'); CoreRenderer.progT = .7;
    const [route] = await Promise.all([AICommandRouter.route(text), sleep(1700)]); $('#pInt').textContent = route.intent; this.count(route.confidence);
    this.flow(3); StateMachine.set('EXECUTING'); this.stat('EXECUTING'); CoreRenderer.progT = 1; const res = await AgentEngine.execute(route, text);
    this.flow(4); StateMachine.set('RESPONSE'); this.stat('COMPLETE'); CoreRenderer.progT = 0; this.type(res.r); if (res.after) res.after(); await Promise.all([VoiceEngine.say(res.r), sleep(Math.min(6000, 1500 + res.r.length * 35))]); $('#panel').classList.add('recede'); if (StateMachine.cur === 'RESPONSE') StateMachine.set('IDLE'); this.flow(-1); this.busy = false;
  }
};

/* ---------- Boot ---------- */
window.NOVA = { CoreRenderer, StateMachine, GestureEngine, VoiceEngine, AirWritingEngine, AICommandRouter, AgentEngine, ToolRegistry, UIController };
CoreRenderer.init(); AirWritingEngine.init(); UIController.init(); VoiceEngine.init();
