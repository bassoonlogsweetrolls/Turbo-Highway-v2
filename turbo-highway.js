/* =====================================================================
 *  TURBO HIGHWAY  ·  Juego de coches arcade pseudo-3D (canvas 2D)
 *
 *  CÓMO USARLO
 *   1. Abre cualquier página en Chrome (mejor una en blanco o normal).
 *   2. Pulsa F12 → pestaña "Consola".
 *   3. Pega TODO este script y pulsa Enter.
 *   4. Haz clic en la pantalla del juego para darle el foco del teclado.
 *
 *  CONTROLES
 *   ↑ / W ........ Acelerar          ESPACIO / SHIFT ... Nitro
 *   ↓ / S ........ Frenar            P ................. Pausa
 *   ← → / A D .... Girar             M ................. Sonido on/off
 *   R ............ Reiniciar         ESC ............... Pausa / Salir
 *   C ............ Garaje (skins de coche)
 *   Q ............ Volver al menú (también hay botones en pausa y al terminar)
 *   N ............ Mapas: Autopista · Neo Ciudad (futurista) · Gran Premio (F1)
 *   Cámara: al acelerar (↑) se aleja y sube; al frenar (↓) se acerca.
 *
 *  OBJETIVO: no te quedes sin tiempo. Cruza los checkpoints para ganar
 *  segundos, esquiva el tráfico, adelanta rozando coches para ganar
 *  puntos y nitro. ¡Cada vuelta cambia el escenario!
 * ===================================================================== */
(function () {
  'use strict';

  // Si ya hay una partida abierta, se cierra antes de crear la nueva.
  if (window.__TURBO_GAME__ && typeof window.__TURBO_GAME__.destroy === 'function') {
    try { window.__TURBO_GAME__.destroy(); } catch (e) { /* ignorar */ }
  }
  if (!document || !document.documentElement) { console.error('[Turbo Highway] No hay DOM disponible.'); return; }

  // ------------------------------------------------------------------
  //  Utilidades
  // ------------------------------------------------------------------
  const U = {
    limit: (v, a, b) => Math.max(a, Math.min(v, b)),
    rnd: (a, b) => a + Math.random() * (b - a),
    rndInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    interp: (a, b, p) => a + (b - a) * p,
    increase: (s, inc, max) => { const r = (s + inc) % max; return r < 0 ? r + max : r; },
    percentRemaining: (n, total) => (n % total) / total,
    easeIn: (a, b, p) => a + (b - a) * p * p,
    easeOut: (a, b, p) => a + (b - a) * (1 - (1 - p) * (1 - p)),
    easeInOut: (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5),
    fog: (d, k) => 1 / Math.exp(d * d * k),
    overlap: (x1, w1, x2, w2, pct) => {
      const half = (pct || 1) / 2;
      return !((x1 + w1 * half) < (x2 - w2 * half) || (x1 - w1 * half) > (x2 + w2 * half));
    }
  };
  const TAU = Math.PI * 2;
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => (a === undefined
    ? 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
    : 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')');
  const shade = (c, f) => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
  const thousands = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ------------------------------------------------------------------
  //  Constantes del motor pseudo-3D
  // ------------------------------------------------------------------
  const STEP = 1 / 60;
  const segmentLength = 200;
  const rumbleLength = 3;
  const roadWidth = 2000;
  const lanes = 3;
  const fov = 100;
  const cameraHeight = 1000; // solo fija la posición lógica del coche respecto a "position"
  const drawDistance = 300;
  const fogDensity = 2.6;    // menos niebla: los coches lejanos se distinguen mejor
  const cameraDepth = 1 / Math.tan((fov / 2) * Math.PI / 180);
  const playerZ = cameraHeight * cameraDepth;
  // Cámara dinámica: ↑ la aleja y la sube, ↓ la acerca y la baja
  const CAM_R = 0.82;       // el coche queda a ~91% de la altura de la pantalla
  const CAM_BASE_H = 1800;  // altura por defecto (bastante por encima del coche)
  const CAM_RANGE = 550;    // cuánto sube/baja con ↑ / ↓
  const maxSpeed = segmentLength / STEP;
  const accel = maxSpeed / 5;
  const breaking = -maxSpeed;
  const decel = -maxSpeed / 5;
  const offRoadDecel = -maxSpeed / 2;
  const offRoadLimit = maxSpeed / 4;
  const centrifugal = 0.28;
  const playerW = 0.3;
  const KMH = 270 / maxSpeed;
  const MAP_STRIDE = 4;
  const M = 60; // margen extra para el temblor de pantalla

  // ------------------------------------------------------------------
  //  Escenarios (se mezclan suavemente al cambiar de vuelta)
  // ------------------------------------------------------------------
  const THEMES = [
    { // Día
      skyTop: [52, 126, 222], skyBot: [176, 218, 255], sun: [255, 246, 205], sunY: 0.27,
      m1: [104, 138, 186], m2: [74, 108, 150],
      roadL: [112, 112, 118], roadD: [104, 104, 110], grassL: [46, 172, 70], grassD: [38, 158, 60],
      rumbleL: [245, 245, 245], rumbleD: [214, 40, 40], lane: [240, 240, 240],
      fog: [176, 218, 255], cloud: [255, 255, 255], stars: 0, night: 0,
      win: 0, neon: [255, 255, 255], run: [96, 166, 76]
    },
    { // Atardecer
      skyTop: [44, 32, 104], skyBot: [255, 142, 74], sun: [255, 206, 102], sunY: 0.4,
      m1: [132, 66, 104], m2: [92, 46, 84],
      roadL: [104, 96, 104], roadD: [96, 88, 98], grassL: [84, 128, 56], grassD: [74, 116, 50],
      rumbleL: [240, 230, 225], rumbleD: [210, 70, 50], lane: [250, 235, 215],
      fog: [255, 152, 96], cloud: [255, 190, 150], stars: 0.15, night: 0.12,
      win: 0, neon: [255, 255, 255], run: [90, 140, 60]
    },
    { // Noche
      skyTop: [4, 6, 22], skyBot: [28, 34, 84], sun: [226, 232, 255], sunY: 0.2,
      m1: [26, 32, 66], m2: [16, 22, 48],
      roadL: [58, 58, 70], roadD: [50, 50, 62], grassL: [14, 56, 44], grassD: [10, 48, 38],
      rumbleL: [210, 210, 225], rumbleD: [190, 36, 52], lane: [230, 230, 245],
      fog: [24, 30, 72], cloud: [70, 80, 130], stars: 1, night: 1,
      win: 0, neon: [255, 255, 255], run: [20, 70, 56]
    }
  ];
  function blendTheme(a, b, t) {
    const o = {};
    for (const k in a) o[k] = Array.isArray(a[k]) ? mixc(a[k], b[k], t) : a[k] + (b[k] - a[k]) * t;
    return o;
  }

  // Neo Ciudad: ciudad futurista de neón (amanecer sintético · noche cian · medianoche magenta)
  const CITY_THEMES = [
    {
      skyTop: [38, 18, 96], skyBot: [255, 98, 162], sun: [255, 224, 190], sunY: 0.36,
      m1: [38, 20, 78], m2: [104, 58, 148],
      roadL: [46, 46, 68], roadD: [40, 40, 60], grassL: [22, 14, 48], grassD: [18, 10, 42],
      rumbleL: [0, 240, 255], rumbleD: [255, 40, 180], lane: [210, 240, 255],
      fog: [150, 60, 140], cloud: [230, 130, 210], stars: 0.45, night: 0.5,
      win: 0.75, neon: [0, 240, 255], run: [30, 34, 72]
    },
    {
      skyTop: [2, 6, 30], skyBot: [12, 78, 130], sun: [200, 240, 255], sunY: 0.22,
      m1: [8, 20, 50], m2: [20, 54, 98],
      roadL: [32, 36, 56], roadD: [26, 30, 48], grassL: [8, 16, 36], grassD: [6, 12, 30],
      rumbleL: [0, 255, 210], rumbleD: [0, 120, 255], lane: [150, 255, 255],
      fog: [10, 52, 104], cloud: [30, 96, 156], stars: 1, night: 0.8,
      win: 1, neon: [0, 255, 230], run: [14, 30, 62]
    },
    {
      skyTop: [10, 0, 26], skyBot: [96, 0, 120], sun: [255, 130, 232], sunY: 0.3,
      m1: [24, 4, 46], m2: [70, 12, 98],
      roadL: [38, 30, 56], roadD: [32, 24, 50], grassL: [14, 6, 32], grassD: [10, 4, 26],
      rumbleL: [255, 60, 204], rumbleD: [255, 232, 60], lane: [255, 206, 250],
      fog: [74, 6, 96], cloud: [150, 44, 170], stars: 0.85, night: 0.85,
      win: 1, neon: [255, 60, 210], run: [34, 14, 64]
    }
  ];
  // Gran Premio: circuito de Fórmula 1 (día · tarde dorada · noche con focos)
  const F1_THEMES = [
    {
      skyTop: [40, 120, 232], skyBot: [196, 228, 255], sun: [255, 248, 214], sunY: 0.25,
      m1: [88, 146, 116], m2: [120, 166, 158],
      roadL: [78, 78, 86], roadD: [70, 70, 78], grassL: [52, 152, 62], grassD: [44, 140, 54],
      rumbleL: [250, 250, 250], rumbleD: [226, 28, 28], lane: [255, 255, 255],
      fog: [196, 228, 255], cloud: [255, 255, 255], stars: 0, night: 0,
      win: 0, neon: [255, 255, 255], run: [176, 160, 128]
    },
    {
      skyTop: [58, 88, 170], skyBot: [255, 204, 146], sun: [255, 228, 164], sunY: 0.36,
      m1: [104, 124, 100], m2: [156, 146, 134],
      roadL: [82, 76, 80], roadD: [74, 68, 72], grassL: [92, 144, 58], grassD: [82, 132, 52],
      rumbleL: [255, 244, 230], rumbleD: [222, 40, 36], lane: [255, 246, 228],
      fog: [255, 208, 154], cloud: [255, 218, 174], stars: 0.05, night: 0.08,
      win: 0, neon: [255, 246, 228], run: [184, 156, 112]
    },
    {
      skyTop: [3, 5, 20], skyBot: [26, 36, 78], sun: [232, 238, 255], sunY: 0.18,
      m1: [20, 28, 44], m2: [16, 24, 42],
      roadL: [56, 56, 66], roadD: [48, 48, 58], grassL: [22, 68, 42], grassD: [18, 60, 36],
      rumbleL: [240, 240, 246], rumbleD: [222, 30, 42], lane: [240, 240, 250],
      fog: [22, 30, 68], cloud: [62, 72, 114], stars: 1, night: 0.55,
      win: 0, neon: [240, 240, 250], run: [96, 90, 80]
    }
  ];

  // Paleta de sprites
  const TRUNK = [84, 56, 34], PINE_A = [24, 100, 52], PINE_B = [32, 124, 64], PINE_S = [16, 74, 40];
  const OAK_A = [52, 140, 58], OAK_B = [74, 168, 72], OAK_S = [34, 100, 46];
  const BUSH = [48, 128, 56], ROCK = [132, 132, 142], ROCK_S = [92, 92, 104];
  const TIRE = [14, 14, 16], GLASS = [20, 28, 42], GLASS2 = [52, 70, 98], BUMPER = [24, 24, 30];
  const CARBON = [22, 22, 26], TAIL_ON = [255, 52, 52], TAIL_OFF = [168, 14, 24], PLATE = [236, 236, 226];
  const EXH = [150, 150, 158], GRAY = [120, 124, 134];
  const PLAYER_COLOR = [222, 12, 46];
  const CAR_COLORS = ['#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#9b5de5', '#00bbf9', '#f15bb5', '#8ac926', '#ffffff', '#b8bcc6', '#ff6b35', '#3a86ff'].map(hex);
  const BILLBOARDS = [
    { txt: 'TURBO', col: [230, 57, 70] }, { txt: 'NITRO', col: [0, 150, 199] },
    { txt: 'SPEED', col: [244, 162, 97] }, { txt: 'DRIFT', col: [106, 76, 147] },
    { txt: 'OCTANO', col: [42, 157, 143] }, { txt: 'RACE', col: [233, 196, 106] }
  ];

  // ------------------------------------------------------------------
  //  DOM: overlay + canvas
  // ------------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;background:#000;margin:0;padding:0;overflow:hidden;';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
  overlay.appendChild(canvas);
  (document.body || document.documentElement).appendChild(overlay);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { overlay.remove(); console.error('[Turbo Highway] Canvas 2D no disponible.'); return; }

  let W = 0, H = 0, DPR = 1;
  const gy = () => H * (0.5 + CAM_R / 2); // y del suelo bajo el coche del jugador
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth || 800; H = window.innerHeight || 600;
    canvas.width = Math.max(1, Math.floor(W * DPR));
    canvas.height = Math.max(1, Math.floor(H * DPR));
  }
  resize();

  // ------------------------------------------------------------------
  //  Sonido (WebAudio, sin ficheros externos)
  // ------------------------------------------------------------------
  const Sound = {
    ac: null, muted: false, master: null, o1: null, o2: null, f: null, g: null, windG: null, windF: null, noiseBuf: null, ns: null,
    init() {
      if (this.ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        this.ac = ac;
        this.master = ac.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(ac.destination);
        this.o1 = ac.createOscillator(); this.o1.type = 'sawtooth';
        this.o2 = ac.createOscillator(); this.o2.type = 'square';
        this.f = ac.createBiquadFilter(); this.f.type = 'lowpass'; this.f.frequency.value = 500;
        this.g = ac.createGain(); this.g.gain.value = 0;
        this.o1.connect(this.f); this.o2.connect(this.f); this.f.connect(this.g); this.g.connect(this.master);
        this.o1.start(); this.o2.start();
        const len = Math.floor(ac.sampleRate);
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.ns = ac.createBufferSource(); this.ns.buffer = buf; this.ns.loop = true;
        this.windF = ac.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 700; this.windF.Q.value = 0.7;
        this.windG = ac.createGain(); this.windG.gain.value = 0;
        this.ns.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
        this.ns.start();
      } catch (e) { this.ac = null; }
    },
    resume() {
      try { if (this.ac && this.ac.state === 'suspended') { const p = this.ac.resume(); if (p && p.catch) p.catch(function () {}); } } catch (e) { /* ignorar */ }
    },
    update(freq, vol, wind, windFreq) {
      if (!this.ac) return;
      try {
        const t = this.ac.currentTime;
        this.o1.frequency.setTargetAtTime(freq, t, 0.04);
        this.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
        this.f.frequency.setTargetAtTime(300 + freq * 4, t, 0.05);
        this.g.gain.setTargetAtTime(vol, t, 0.05);
        this.windG.gain.setTargetAtTime(wind, t, 0.1);
        this.windF.frequency.setTargetAtTime(windFreq, t, 0.1);
      } catch (e) { /* ignorar */ }
    },
    noise(dur, vol, freq) {
      if (!this.ac || !this.noiseBuf) return;
      try {
        const ac = this.ac, t = ac.currentTime;
        const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
        const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = freq;
        const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(fl); fl.connect(g); g.connect(this.master);
        s.start(t); s.stop(t + dur + 0.05);
      } catch (e) { /* ignorar */ }
    },
    tone(freq, dur, vol, type, slideTo, delay) {
      if (!this.ac) return;
      try {
        const ac = this.ac, t = ac.currentTime + (delay || 0);
        const o = ac.createOscillator(); o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + dur + 0.05);
      } catch (e) { /* ignorar */ }
    },
    crash() { this.noise(0.55, 0.9, 900); this.tone(90, 0.3, 0.4, 'sawtooth', 40); },
    beep(hi) { this.tone(hi ? 880 : 440, hi ? 0.4 : 0.14, 0.22, 'square'); },
    checkpoint() { this.tone(660, 0.12, 0.2, 'square', 0, 0); this.tone(880, 0.12, 0.2, 'square', 0, 0.1); this.tone(1320, 0.25, 0.2, 'square', 0, 0.2); },
    bonus() { this.tone(900, 0.08, 0.15, 'triangle', 1400); },
    toggleMute() {
      this.muted = !this.muted;
      try { if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; } catch (e) { /* ignorar */ }
    },
    destroy() {
      try { if (this.ac) { const p = this.ac.close(); if (p && p.catch) p.catch(function () {}); } } catch (e) { /* ignorar */ }
      this.ac = null;
    }
  };

  // ------------------------------------------------------------------
  //  Pista
  // ------------------------------------------------------------------
  const ROAD = {
    LENGTH: { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 },
    HILL: { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 },
    CURVE: { NONE: 0, EASY: 2, MEDIUM: 4 }
  };
  let segments = [], trackLength = 0, mapPts = [], cpIdx = [];
  const startIdx = 6;

  function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      p1: { world: { y: lastY(), z: n * segmentLength }, camera: {}, screen: {} },
      p2: { world: { y: y, z: (n + 1) * segmentLength }, camera: {}, screen: {} },
      curve: curve, sprites: [], cars: [], clip: 0, fog: 1, looped: false,
      dark: Math.floor(n / rumbleLength) % 2 === 1, gantry: null
    });
  }
  function addRoad(enter, hold, leave, curve, y) {
    const startY = lastY(), endY = startY + (y || 0) * segmentLength, total = enter + hold + leave;
    let n;
    for (n = 0; n < enter; n++) addSegment(U.easeIn(0, curve, n / enter), U.easeInOut(startY, endY, n / total));
    for (n = 0; n < hold; n++) addSegment(curve, U.easeInOut(startY, endY, (enter + n) / total));
    for (n = 0; n < leave; n++) addSegment(U.easeInOut(curve, 0, n / leave), U.easeInOut(startY, endY, (enter + hold + n) / total));
  }
  const addStraight = (n) => { n = n || ROAD.LENGTH.MEDIUM; addRoad(n, n, n, 0, 0); };
  const addHill = (n, h) => { addRoad(n, n, n, 0, h); };
  const addCurve = (n, c, h) => { addRoad(n, n, n, c, h || 0); };
  function addLowRollingHills() {
    const n = ROAD.LENGTH.SHORT, h = ROAD.HILL.LOW, c = ROAD.CURVE.EASY;
    addRoad(n, n, n, 0, h / 2); addRoad(n, n, n, 0, -h); addRoad(n, n, n, c, h);
    addRoad(n, n, n, 0, 0); addRoad(n, n, n, -c, h / 2); addRoad(n, n, n, 0, 0);
  }
  function addSCurves() {
    const n = ROAD.LENGTH.MEDIUM, C = ROAD.CURVE, Hh = ROAD.HILL;
    addRoad(n, n, n, -C.EASY, Hh.NONE); addRoad(n, n, n, C.MEDIUM, Hh.MEDIUM); addRoad(n, n, n, C.EASY, -Hh.LOW);
    addRoad(n, n, n, -C.EASY, Hh.MEDIUM); addRoad(n, n, n, -C.MEDIUM, -Hh.MEDIUM);
  }
  function addBumps() {
    const n = 10;
    [5, -2, -5, 8, 5, -7, 5, -2].forEach(function (h) { addRoad(n, n, n, 0, h); });
  }
  function addDownhillToEnd(n) { addRoad(n, n, n, -ROAD.CURVE.EASY, -lastY() / segmentLength); }

  function addSprite(n, sp) { if (n >= 0 && n < segments.length) segments[n].sprites.push(sp); }
  function addTree(n, side, near) {
    const r = Math.random();
    let sp;
    if (r < 0.52) sp = { t: 'pine', w: 1.0, cw: 0.13, v: Math.random() };
    else if (r < 0.84) sp = { t: 'oak', w: 1.1, cw: 0.15, v: Math.random() };
    else sp = { t: 'bush', w: 0.6, cw: 0, v: Math.random() };
    sp.offset = side * (near + sp.w / 2);
    addSprite(n, sp);
  }
  function populateHighway() {
    const N = segments.length;
    let n, side;
    for (n = 8; n < N - 6; n += 3) {
      for (side = -1; side <= 1; side += 2) if (Math.random() < 0.78) addTree(n, side, 1.28 + Math.pow(Math.random(), 2) * 1.4);
    }
    for (n = 5; n < N - 6; n += 3) {
      for (side = -1; side <= 1; side += 2) if (Math.random() < 0.7) addTree(n + U.rndInt(0, 2), side, 2.8 + Math.random() * 7);
    }
    for (n = 10; n < N - 4; n += 7) {
      side = Math.random() < 0.5 ? -1 : 1;
      const r = Math.random();
      if (r < 0.45) addSprite(n, { t: 'bush', w: 0.55, cw: 0, v: Math.random(), offset: side * (1.25 + Math.random() * 1.6) });
      else if (r < 0.65) addSprite(n, { t: 'rock', w: 0.5, cw: 0.4, v: Math.random(), offset: side * (1.32 + Math.random() * 0.5) });
    }
    for (n = 2; n < N - 2; n += 12) {
      addSprite(n, { t: 'post', w: 0.07, cw: 0, v: 0, offset: -1.2 });
      addSprite(n, { t: 'post', w: 0.07, cw: 0, v: 0, offset: 1.2 });
    }
    for (n = 40; n < N - 40; n += U.rndInt(70, 130)) {
      side = Math.random() < 0.5 ? -1 : 1;
      const b = U.pick(BILLBOARDS);
      addSprite(n, { t: 'board', w: 1.3, cw: 0.2, v: 0, txt: b.txt, col: b.col, offset: side * (1.95 + Math.random() * 0.3) });
    }
  }
  function buildMap() {
    const N = segments.length, pts = [];
    let h = 0, x = 0, y = 0, i;
    for (i = 0; i < N; i++) {
      h += segments[i].curve * 0.0017; x += Math.cos(h); y += Math.sin(h);
      if (i % MAP_STRIDE === 0) pts.push([x, y]);
    }
    const n = pts.length, ex = pts[n - 1][0] - pts[0][0], ey = pts[n - 1][1] - pts[0][1];
    for (i = 0; i < n; i++) { pts[i][0] -= ex * i / (n - 1); pts[i][1] -= ey * i / (n - 1); }
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    pts.forEach(function (p) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
    const sz = Math.max(maxx - minx, maxy - miny, 1e-6), s = 1 / sz;
    const ox = (1 - (maxx - minx) * s) / 2, oy = (1 - (maxy - miny) * s) / 2;
    mapPts = pts.map(function (p) { return [(p[0] - minx) * s + ox, (p[1] - miny) * s + oy]; });
  }
  // ---- Neo Ciudad: decorado -------------------------------------------------
  const TOWER_COLS = [[26, 32, 62], [38, 28, 70], [20, 44, 72], [48, 38, 84], [30, 38, 84], [22, 26, 50]];
  const NEON_COLS = [[0, 240, 255], [255, 45, 180], [180, 255, 60], [255, 210, 63], [150, 90, 255]];
  const HOLO_TXT = ['NEO', 'CYBER', 'HYPER', 'AI-X', '2099', 'VOLT', 'ORBIT', 'NOVA'];
  function populateCity() {
    const N = segments.length;
    let n, side, i;
    // lo más lejano se añade primero para que se dibuje por debajo
    for (n = 4; n < N - 4; n += 5) {
      for (side = -1; side <= 1; side += 2) {
        if (Math.random() < 0.8) {
          const w = U.rnd(2, 4.2);
          addSprite(n + U.rndInt(0, 3), { t: 'tower', w: w, cw: 0, v: Math.random(), col: U.pick(TOWER_COLS), offset: side * (4.4 + w / 2 + Math.random() * 9) });
        }
      }
    }
    for (n = 6; n < N - 4; n += 4) {
      for (side = -1; side <= 1; side += 2) {
        if (Math.random() < 0.82) {
          const w = U.rnd(1.1, 2.2);
          addSprite(n + U.rndInt(0, 2), { t: 'tower', w: w, cw: 0.5, v: Math.random(), col: U.pick(TOWER_COLS), offset: side * (1.55 + w / 2 + Math.pow(Math.random(), 2) * 1.6) });
        }
      }
    }
    for (n = 25; n < N - 25; n += U.rndInt(45, 80)) {
      side = Math.random() < 0.5 ? -1 : 1;
      addSprite(n, { t: 'holo', w: 1.5, cw: 0, v: Math.random(), txt: U.pick(HOLO_TXT), col: U.pick(NEON_COLS), offset: side * (2.5 + Math.random() * 0.7) });
    }
    for (n = 3, i = 0; n < N - 2; n += 8, i++) {
      const col = NEON_COLS[i % 2 === 0 ? 0 : 1];
      addSprite(n, { t: 'npost', w: 0.07, cw: 0, v: 0, col: col, offset: -1.22 });
      addSprite(n, { t: 'npost', w: 0.07, cw: 0, v: 0, col: col, offset: 1.22 });
    }
    for (n = 30; n < N - 30; n += U.rndInt(55, 95)) {
      addSprite(n, { t: 'arch', w: 2.5, cw: 0, v: Math.random(), col: U.pick(NEON_COLS), offset: 0 });
    }
  }

  // ---- Gran Premio (F1): decorado -------------------------------------------
  const F1_BRANDS = [
    { txt: 'APEX', col: [214, 30, 40] }, { txt: 'VELOX', col: [20, 90, 200] }, { txt: 'PETRO', col: [250, 200, 20] },
    { txt: 'KINETIC', col: [30, 30, 36] }, { txt: 'ZENITH', col: [0, 150, 120] }, { txt: 'TURBO', col: [240, 110, 20] },
    { txt: 'ORBIT', col: [120, 60, 200] }, { txt: 'NOVA', col: [250, 250, 250] }
  ];
  function populateF1() {
    const N = segments.length;
    let n, side, i;
    for (n = 10; n < N - 10; n += 6) {
      side = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.55) addTree(n, side, 7 + Math.random() * 9);
    }
    for (n = 12; n < N - 12; n += 14) {
      for (side = -1; side <= 1; side += 2) {
        const near = n < 300 || Math.random() < 0.5;
        if (near && Math.random() < 0.82) {
          const w = U.rnd(1.4, 2.0);
          addSprite(n, { t: 'stand', w: w, cw: 0.5, v: Math.random(), col: U.pick(F1_BRANDS).col, offset: side * (2.5 + w / 2) });
        }
      }
    }
    for (n = 20; n < N - 20; n += 26) {
      side = (n / 26 | 0) % 2 === 0 ? -1 : 1;
      addSprite(n, { t: 'lamp', w: 0.07, cw: 0, v: 0, offset: side * 2.1 });
    }
    for (n = 6, i = 0; n < N - 8; n += 9, i++) {
      const b = F1_BRANDS[i % F1_BRANDS.length];
      for (side = -1; side <= 1; side += 2) addSprite(n, { t: 'adboard', w: 0.84, cw: 0, v: 0, txt: b.txt, col: b.col, offset: side * 1.86 });
    }
    for (n = 4; n < N - 2; n += 3) {
      for (side = -1; side <= 1; side += 2) addSprite(n, { t: 'tires', w: 0.3, cw: 0.2, v: Math.random(), col: ((n / 3) | 0) % 6 < 3 ? [240, 240, 240] : [222, 36, 40], offset: side * 1.5 });
    }
    for (n = 60; n < N - 50; n += U.rndInt(130, 220)) {
      const b = U.pick(F1_BRANDS);
      addSprite(n, { t: 'arch', w: 2.5, cw: 0, v: Math.random(), f1: true, txt: b.txt, col: b.col, offset: 0 });
    }
  }

  // ---- Trazados --------------------------------------------------------------
  const rd = (n, curve, hill) => { addRoad(n, n, n, curve, hill || 0); };
  function layoutHighway() {
    const L = ROAD.LENGTH, Hh = ROAD.HILL, C = ROAD.CURVE;
    addStraight(L.MEDIUM);
    addHill(L.SHORT, Hh.LOW);
    addLowRollingHills();
    addCurve(L.MEDIUM, C.MEDIUM, Hh.LOW);
    addSCurves();
    addStraight(L.LONG);
    addBumps();
    addCurve(L.LONG, -C.EASY, Hh.MEDIUM);
    addCurve(L.MEDIUM, C.MEDIUM, -Hh.LOW);
    addHill(L.MEDIUM, Hh.HIGH);
    addCurve(L.MEDIUM, -C.MEDIUM, 0);
    addDownhillToEnd(200);
  }
  // Neo Ciudad: autopista elevada de alta velocidad con rampas, chicanes y grandes barridos
  function layoutCity() {
    const L = ROAD.LENGTH, Hh = ROAD.HILL, C = ROAD.CURVE;
    addStraight(L.MEDIUM);
    rd(35, -C.MEDIUM, Hh.MEDIUM);
    rd(50, 0, Hh.MEDIUM);
    rd(50, C.MEDIUM, -Hh.MEDIUM);
    rd(35, C.EASY, -Hh.LOW);
    addSCurves();
    addStraight(L.LONG);
    rd(25, -C.MEDIUM, 0); rd(25, C.MEDIUM, 0); rd(25, -C.MEDIUM, 0); rd(25, C.MEDIUM, 0);
    addStraight(L.MEDIUM);
    addHill(L.MEDIUM, Hh.HIGH);
    rd(50, -C.EASY, -Hh.MEDIUM);
    rd(40, C.MEDIUM, 0);
    addLowRollingHills();
    addDownhillToEnd(150);
  }
  // Gran Premio: circuito técnico con rectas largas, horquillas, chicanes y eses
  function layoutF1() {
    const L = ROAD.LENGTH, Hh = ROAD.HILL, C = ROAD.CURVE;
    addStraight(L.LONG);
    addStraight(L.MEDIUM);
    rd(34, 5, 0);                       // horquilla 1
    addStraight(L.SHORT);
    rd(20, -3, 0); rd(20, 3, 0);        // chicane
    addStraight(L.MEDIUM);
    rd(40, -C.MEDIUM, Hh.LOW);          // curva rápida cuesta arriba
    rd(25, C.EASY, 0);
    rd(30, 5, -Hh.LOW);                 // horquilla 2 cuesta abajo
    addStraight(L.MEDIUM);
    rd(25, -3, 0); rd(25, 3, 0); rd(25, -3, 0); rd(25, 3, 0);   // eses
    rd(50, C.EASY, Hh.LOW);
    rd(50, -C.EASY, -Hh.LOW);
    addStraight(L.LONG);                // recta de atrás
    rd(36, -5, 0);                      // horquilla 3
    rd(30, C.EASY, 0);
    addStraight(L.SHORT);
    addDownhillToEnd(60);
  }

  // ---- Definición de los mapas ----------------------------------------------
  const MAPS = [
    {
      id: 'highway', name: 'Autopista', desc: ['Carretera entre bosques y montañas', 'Día, atardecer y noche'],
      ambient: 'Naturaleza', diff: 2, themes: THEMES, menuTheme: 1, bg: 'mountains',
      rumble: 1 / 6, runoff: 0, dash: true, edge: false,
      layout: layoutHighway, populate: populateHighway,
      traffic: { count: 130, types: ['sedan', 'sedan', 'sport', 'van'], colors: ['#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#9b5de5', '#00bbf9', '#f15bb5', '#8ac926', '#ffffff', '#b8bcc6', '#ff6b35', '#3a86ff'], vmin: 0.17, vmax: 0.46 }
    },
    {
      id: 'city', name: 'Neo Ciudad', desc: ['Rascacielos de neón y arcos de luz', 'Autopista elevada del año 2099'],
      ambient: 'Futurista', diff: 2, themes: CITY_THEMES, menuTheme: 0, bg: 'city',
      rumble: 1 / 7, runoff: 0.5, dash: true, edge: true,
      layout: layoutCity, populate: populateCity,
      traffic: { count: 140, types: ['sport', 'sport', 'sedan', 'van'], colors: ['#00f0ff', '#ff2db4', '#b6ff3a', '#ffd23f', '#9b5de5', '#ffffff', '#3a86ff', '#ff6b35'], vmin: 0.2, vmax: 0.5 }
    },
    {
      id: 'f1', name: 'Gran Premio', desc: ['Circuito de F1 con horquillas y eses', 'Gradas, muros de neumáticos y focos'],
      ambient: 'Circuito', diff: 3, themes: F1_THEMES, menuTheme: 0, bg: 'hills',
      rumble: 1 / 5, runoff: 0.9, dash: false, edge: true,
      layout: layoutF1, populate: populateF1,
      traffic: { count: 100, types: ['sport'], colors: ['#d61e28', '#145ac8', '#fac814', '#f06e14', '#00967a', '#7a3cc8', '#f0f0f0', '#1e1e24'], vmin: 0.22, vmax: 0.52, racing: true }
    }
  ];

  function buildTrack(map) {
    segments = [];
    map.layout();
    trackLength = segments.length * segmentLength;
    const N = segments.length;
    cpIdx = [startIdx, Math.floor(N * 0.25), Math.floor(N * 0.5), Math.floor(N * 0.75)];
    segments[cpIdx[0]].gantry = 'start';
    for (let i = 1; i < cpIdx.length; i++) segments[cpIdx[i]].gantry = 'check';
    map.populate();
    buildMap();
  }
  function findSegment(z) { return segments[Math.floor(z / segmentLength) % segments.length]; }

  // ------------------------------------------------------------------
  //  Estado del juego
  // ------------------------------------------------------------------
  let state = 'menu', prevState = 'menu';
  let position = 0, speed = 0, playerX = 0, playerY = 0;
  let time = 50, dist = 0, bonusScore = 0, lap = 1, nextCp = 1, nitro = 1, best = 0, newRecord = false, overtakes = 0;
  let steerVis = 0, spinT = 0, spinDir = 1, shake = 0, whiteFlash = 0, crashCd = 0, bgPx = 0, tAnim = 0;
  let cdTimer = 0, cdShown = 4, nitroOn = false, braking = false, playerPx = 200;
  let mapIdx = 0, skinIdx = 0, zoom = 0, camH = CAM_BASE_H, camD = cameraDepth * CAM_BASE_H / CAM_R, garageFrom = 'menu';
  const hits = [];
  let mouseX = -1, mouseY = -1;
  const over = (x, y, w, h) => mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;
  let curMap = MAPS[0], mapFrom = 'menu';
  let themeFrom = THEMES[1], themeTo = THEMES[1], themeT = 1, cur = THEMES[1];
  let cars = [], banner = null, destroyed = false, raf = 0, acc = 0, last = 0;
  const particles = [], pops = [];
  const keys = { left: false, right: false, up: false, down: false, nitro: false };
  const stars = [];
  const clouds = [];
  let i0;
  for (i0 = 0; i0 < 90; i0++) stars.push({ x: Math.random(), y: Math.random() * 0.46, r: U.rnd(0.6, 1.8), f: U.rnd(1, 4), p: U.rnd(0, TAU) });
  for (i0 = 0; i0 < 8; i0++) clouds.push({ x: Math.random(), y: U.rnd(0.06, 0.32), s: U.rnd(0.6, 1.4), v: U.rnd(6, 14) });

  const SKINS = [
    { name: 'Rojo Racing', desc: 'El clásico de competición', color: [222, 12, 46], stripe: [245, 245, 245], livery: 'single', wing: true, glow: [0, 220, 255] },
    { name: 'Azul Eléctrico', desc: 'Doble franja amarilla', color: [20, 110, 255], stripe: [255, 214, 0], livery: 'dual', wing: true, glow: [0, 170, 255] },
    { name: 'Verde Neón', desc: 'Veneno radiactivo', color: [34, 225, 110], stripe: [16, 16, 20], livery: 'single', wing: true, glow: [80, 255, 120] },
    { name: 'Amarillo Rally', desc: 'Se ve desde el espacio', color: [255, 205, 0], stripe: [20, 20, 24], livery: 'dual', wing: true, glow: [255, 210, 0] },
    { name: 'Negro Fantasma', desc: 'Neón magenta bajo el chasis', color: [30, 30, 38], stripe: [255, 45, 149], livery: 'single', wing: true, glow: [255, 45, 149] },
    { name: 'Naranja Dakar', desc: 'Para los más aventureros', color: [255, 110, 20], stripe: [30, 70, 200], livery: 'dual', wing: true, glow: [255, 140, 40] },
    { name: 'Blanco Perla', desc: 'Berlina elegante sin alerón', color: [238, 240, 246], stripe: [214, 40, 40], livery: 'single', wing: false, type: 'sedan', glow: [160, 200, 255] },
    { name: 'Rosa Retro', desc: 'Estilo synthwave', color: [255, 92, 190], stripe: [255, 255, 255], livery: 'dual', wing: false, type: 'sedan', glow: [255, 92, 190] },
    { name: 'Oro Imperial', desc: 'Edición de lujo', color: [212, 175, 55], stripe: [20, 20, 24], livery: 'single', wing: true, glow: [255, 215, 100] }
  ];
  try { const k = parseInt(window.localStorage.getItem('turbo_highway_skin'), 10); if (isFinite(k) && k >= 0 && k < SKINS.length) skinIdx = k; } catch (e) { /* ignorar */ }
  const bests = {};
  const bestKeyOf = (m) => (m.id === 'highway' ? 'turbo_highway_best' : 'turbo_highway_best_' + m.id);
  MAPS.forEach(function (m) {
    bests[m.id] = 0;
    try { const b = parseInt(window.localStorage.getItem(bestKeyOf(m)), 10); if (isFinite(b)) bests[m.id] = b; } catch (e) { /* ignorar */ }
  });
  function loadBest() { best = bests[curMap.id] || 0; }
  function saveBest() { bests[curMap.id] = best; try { window.localStorage.setItem(bestKeyOf(curMap), String(best)); } catch (e) { /* ignorar */ } }
  function saveMap() { try { window.localStorage.setItem('turbo_highway_map', String(mapIdx)); } catch (e) { /* ignorar */ } }
  try { const k = parseInt(window.localStorage.getItem('turbo_highway_map'), 10); if (isFinite(k) && k >= 0 && k < MAPS.length) mapIdx = k; } catch (e) { /* ignorar */ }
  function saveSkin() { try { window.localStorage.setItem('turbo_highway_skin', String(skinIdx)); } catch (e) { /* ignorar */ } }
  const score = () => Math.floor(dist) + bonusScore;

  function placeCars() {
    let i;
    for (i = 0; i < segments.length; i++) segments[i].cars.length = 0;
    cars = [];
    const N = segments.length;
    const tr = curMap.traffic, palette = tr.colors.map(hex);
    for (i = 0; i < tr.count; i++) {
      const idx = U.rndInt(30, N - 1);
      const type = U.pick(tr.types);
      const car = {
        offset: U.pick([-0.68, -0.02, 0.66]) + U.rnd(-0.1, 0.1),
        z: idx * segmentLength + U.rnd(0, segmentLength - 1),
        speed: maxSpeed * U.rnd(tr.vmin, tr.vmax), color: U.pick(palette), type: type, racing: !!tr.racing,
        w: type === 'van' ? 0.34 : 0.3, percent: 0, rel: 0
      };
      car.percent = U.percentRemaining(car.z, segmentLength);
      segments[idx].cars.push(car); cars.push(car);
    }
  }

  function startGame() {
    placeCars();
    position = 0; speed = 0; playerX = 0; time = 50; dist = 0; bonusScore = 0; lap = 1; nextCp = 1; nitro = 1; overtakes = 0;
    spinT = 0; shake = 0; whiteFlash = 0; crashCd = 0; newRecord = false;
    particles.length = 0; pops.length = 0; banner = null;
    themeFrom = cur; themeTo = curMap.themes[0]; themeT = 0;
    resetKeysExceptNone();
    state = 'countdown'; cdTimer = 3.6; cdShown = 4;
  }
  function resetKeysExceptNone() { keys.left = keys.right = keys.up = keys.down = keys.nitro = false; }
  function goMenu() {
    if (state !== 'pause' && state !== 'over' && state !== 'play' && state !== 'countdown') return;
    if (score() > best) { best = score(); saveBest(); }
    resetKeysExceptNone();
    particles.length = 0; pops.length = 0; banner = null;
    shake = 0; whiteFlash = 0; spinT = 0; crashCd = 0; nitroOn = false; braking = false;
    themeFrom = cur; themeTo = curMap.themes[curMap.menuTheme]; themeT = 0;
    placeCars();
    state = 'menu';
  }
  function openGarage() { if (state === 'menu' || state === 'over') { garageFrom = state; state = 'garage'; } }
  function closeGarage() { if (state === 'garage') { state = garageFrom; saveSkin(); } }
  function selectMap(i, quiet) {
    i = ((i % MAPS.length) + MAPS.length) % MAPS.length;
    mapIdx = i; curMap = MAPS[i]; saveMap();
    buildTrack(curMap); placeCars(); loadBest();
    position = 0; playerX = 0;
    particles.length = 0;
    themeFrom = themeTo = cur = curMap.themes[curMap.menuTheme]; themeT = 1;
    if (!quiet) Sound.tone(440, 0.08, 0.12, 'square', 660);
  }
  function openControls() { if (state === 'menu') state = 'controls'; }
  function closeControls() { if (state === 'controls') state = 'menu'; }
  function quitGame() { destroy(); }
  function toggleSound() { Sound.init(); Sound.resume(); Sound.toggleMute(); }
  function openMaps() { if (state === 'menu' || state === 'over') { mapFrom = state; state = 'maps'; } }
  function closeMaps() { if (state === 'maps') { state = mapFrom; saveMap(); } }
  function changeMap(d) { selectMap(mapIdx + d); }
  function changeSkin(d) { skinIdx = (skinIdx + d + SKINS.length) % SKINS.length; saveSkin(); Sound.tone(520, 0.06, 0.12, 'square'); }
  function endGame() {
    state = 'over';
    const s = score();
    if (s > best) { best = s; newRecord = true; saveBest(); } else newRecord = false;
    Sound.beep(false);
  }
  function pauseGame() { if (state === 'play' || state === 'countdown') { prevState = state; state = 'pause'; resetKeysExceptNone(); } }
  function resumeGame() { if (state === 'pause') state = prevState; }
  function showBanner(text, sub, color) { banner = { text: text, sub: sub || '', color: color || '#fff', t: 0, dur: 2.2 }; }
  function pop(text, color) { pops.push({ t: text, c: color || '#fff', life: 1.3, y: 0 }); if (pops.length > 6) pops.shift(); }

  // ------------------------------------------------------------------
  //  Lógica
  // ------------------------------------------------------------------
  function updateCarOffset(car, carSeg, playerSeg) {
    const lookahead = 20, carW = car.w;
    if ((carSeg.index - playerSeg.index) > drawDistance) return 0;
    for (let i = 1; i < lookahead; i++) {
      const seg = segments[(carSeg.index + i) % segments.length];
      let dir;
      if (seg === playerSeg && car.speed > speed && U.overlap(playerX, playerW, car.offset, carW, 1.2)) {
        if (playerX > 0.5) dir = -1; else if (playerX < -0.5) dir = 1; else dir = (car.offset > playerX) ? 1 : -1;
        return dir / i * (car.speed - speed) / maxSpeed;
      }
      for (let j = 0; j < seg.cars.length; j++) {
        const other = seg.cars[j];
        if (car.speed > other.speed && U.overlap(car.offset, carW, other.offset, other.w, 1.2)) {
          if (car.offset > 0.5) dir = -1; else if (car.offset < -0.5) dir = 1; else dir = (car.offset > other.offset) ? 1 : -1;
          return dir / i * (car.speed - other.speed) / maxSpeed;
        }
      }
    }
    if (car.offset < -0.9) return 0.1;
    if (car.offset > 0.9) return -0.1;
    return 0;
  }
  function updateCars(dt, playerSeg) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const oldSeg = findSegment(car.z);
      car.offset += updateCarOffset(car, oldSeg, playerSeg);
      car.z = U.increase(car.z, dt * car.speed, trackLength);
      car.percent = U.percentRemaining(car.z, segmentLength);
      const newSeg = findSegment(car.z);
      if (oldSeg !== newSeg) {
        const k = oldSeg.cars.indexOf(car);
        if (k >= 0) oldSeg.cars.splice(k, 1);
        newSeg.cars.push(car);
      }
      if (state === 'play') {
        let rel = car.z - (position + playerZ);
        rel = ((rel % trackLength) + trackLength) % trackLength;
        if (rel > trackLength / 2) rel -= trackLength;
        if (car.rel > 0 && rel <= 0 && car.rel < segmentLength * 40) onOvertake(car);
        car.rel = rel;
      }
    }
  }
  function onOvertake(car) {
    const d = Math.abs(car.offset - playerX);
    overtakes++;
    if (d < 0.5) { bonusScore += 150; nitro = Math.min(1, nitro + 0.1); pop('¡RASPÓN! +150', '#ffd23f'); Sound.bonus(); }
    else if (d < 1.1) { bonusScore += 50; pop('ADELANTAMIENTO +50', '#9bf6ff'); }
  }
  function spawnParticle(x, y, vx, vy, life, r, c, g, grow) {
    if (particles.length > 220) particles.shift();
    particles.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, r: r, c: c, g: g || 0, grow: grow || 0 });
  }
  function onCrash(sev, pushX, kind) {
    playerX += pushX;
    if (crashCd > 0) return;
    crashCd = 0.5;
    shake = Math.max(shake, 10 + sev * 26);
    whiteFlash = Math.min(0.6, 0.15 + sev * 0.5);
    Sound.crash();
    for (let i = 0; i < 26; i++) {
      const a = U.rnd(Math.PI, TAU), v = U.rnd(120, 520) * (0.4 + sev);
      spawnParticle(W / 2 + U.rnd(-playerPx * 0.3, playerPx * 0.3), gy() - H * 0.02, Math.cos(a) * v, Math.sin(a) * v, U.rnd(0.4, 0.9), U.rnd(2, 5),
        Math.random() < 0.5 ? [255, 190, 60] : [255, 120, 40], 600, 0);
    }
    for (let k = 0; k < 10; k++) {
      spawnParticle(W / 2 + U.rnd(-playerPx * 0.4, playerPx * 0.4), gy() - H * 0.04, U.rnd(-60, 60), U.rnd(-160, -50), U.rnd(0.8, 1.5), U.rnd(14, 30), [150, 150, 158], -20, 1.5);
    }
    if (kind === 'car' && sev > 0.25) { spinT = 0.9; spinDir = pushX >= 0 ? 1 : -1; }
    pop('¡CHOQUE!', '#ff5d5d');
  }
  function checkCheckpoints(prevIdx, newIdx) {
    const N = segments.length;
    const delta = (newIdx - prevIdx + N) % N;
    if (delta === 0 || delta > N / 2) return;
    const off = (cpIdx[nextCp] - prevIdx + N) % N;
    if (off > 0 && off <= delta) {
      if (nextCp === 0) {
        lap++;
        bonusScore += 500;
        themeFrom = cur; themeTo = curMap.themes[(lap - 1) % curMap.themes.length]; themeT = 0;
        const bonus = Math.max(12, 22 - lap);
        time += bonus;
        showBanner('VUELTA ' + lap, '+' + bonus + ' s   ·   +500 pts', '#ffd23f');
      } else {
        const bonus = Math.max(12, 22 - lap);
        time += bonus;
        bonusScore += 200;
        showBanner('CHECKPOINT', '+' + bonus + ' segundos', '#7dff6a');
      }
      Sound.checkpoint();
      nextCp = (nextCp + 1) % cpIdx.length;
    }
  }
  function update(dt) {
    const ps = findSegment(position + playerZ);
    const speedPercent = speed / maxSpeed;
    const sp1 = Math.min(speedPercent, 1);
    const dx = dt * 2 * sp1;
    const prevIdx = ps.index;

    updateCars(dt, ps);
    position = U.increase(position, dt * speed, trackLength);
    bgPx += ps.curve * sp1 * dt * W * 0.05;

    if (keys.left) playerX -= dx; else if (keys.right) playerX += dx;
    playerX -= dx * speedPercent * ps.curve * centrifugal;

    nitroOn = keys.nitro && nitro > 0.005;
    braking = keys.down && speed > 0 && !nitroOn;
    if (nitroOn) {
      speed += accel * 2.4 * dt;
      nitro = Math.max(0, nitro - dt * 0.26);
    } else {
      if (keys.up) speed += accel * dt; else if (keys.down) speed += breaking * dt; else speed += decel * dt;
      nitro = Math.min(1, nitro + dt * (keys.up ? 0.045 : 0.02));
    }
    if (!nitroOn && speed > maxSpeed) speed = Math.max(maxSpeed, speed - accel * 1.6 * dt);
    if (nitroOn) speed = Math.min(speed, maxSpeed * 1.3);

    const off = playerX < -1 || playerX > 1;
    if (off) {
      if (speed > offRoadLimit) speed += offRoadDecel * dt;
      shake = Math.max(shake, 2 + 5 * sp1);
      if (speed > 800 && Math.random() < 0.8) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnParticle(W / 2 + side * playerPx * 0.36, gy(), U.rnd(-90, 90), U.rnd(-200, -60), U.rnd(0.4, 0.8), U.rnd(10, 22),
          mixc(cur.grassL, [150, 120, 80], 0.6), -40, 1.4);
      }
      for (let i = 0; i < ps.sprites.length; i++) {
        const s = ps.sprites[i];
        if (s.cw > 0 && U.overlap(playerX, playerW, s.offset, s.cw, 1)) {
          const sev = Math.min(1, speed / maxSpeed);
          speed = Math.min(speed, maxSpeed * 0.2);
          position = U.increase(ps.p1.world.z, -playerZ, trackLength);
          onCrash(sev, s.offset > 0 ? -0.3 : 0.3, 'tree');
          break;
        }
      }
    }
    for (let i = 0; i < ps.cars.length; i++) {
      const car = ps.cars[i];
      if (speed > car.speed && U.overlap(playerX, playerW, car.offset, car.w, 0.85)) {
        const sev = (speed - car.speed) / maxSpeed;
        speed = car.speed * (car.speed / speed);
        position = U.increase(car.z, -playerZ, trackLength);
        onCrash(sev, playerX > car.offset ? 0.14 : -0.14, 'car');
        break;
      }
    }
    if (nitroOn && Math.random() < 0.7) {
      const side = Math.random() < 0.5 ? -1 : 1;
      spawnParticle(W / 2 + side * playerPx * 0.3, gy() + H * 0.005, U.rnd(-30, 30), U.rnd(80, 200), U.rnd(0.15, 0.3), U.rnd(3, 6), [255, 170, 60], 0, 0.5);
    }
    if (braking && speed > maxSpeed * 0.4 && Math.random() < 0.5) {
      spawnParticle(W / 2 + (Math.random() < 0.5 ? -1 : 1) * playerPx * 0.38, gy() + H * 0.01, U.rnd(-40, 40), U.rnd(-60, -10), U.rnd(0.3, 0.6), U.rnd(8, 16), [190, 190, 200], -10, 1.2);
    }

    playerX = U.limit(playerX, -3, 3);
    speed = U.limit(speed, 0, maxSpeed * 1.31);

    checkCheckpoints(prevIdx, findSegment(position + playerZ).index);
    dist += speed * dt * 0.00625;
    time -= dt;
    if (time <= 0) { time = 0; endGame(); }
  }
  function attract(dt) {
    speed = Math.min(speed + accel * dt, maxSpeed * 0.55);
    const ps = findSegment(position + playerZ);
    position = U.increase(position, dt * speed, trackLength);
    playerX = Math.sin(tAnim * 0.5) * 0.5;
    bgPx += ps.curve * 0.55 * dt * W * 0.05;
  }
  function countdown(dt) {
    cdTimer -= dt;
    const n = Math.ceil(cdTimer - 0.6);
    if (n !== cdShown && n >= 1) { cdShown = n; Sound.beep(false); }
    if (cdTimer <= 0.6) { state = 'play'; showBanner('¡YA!', '', '#7dff6a'); Sound.beep(true); }
  }
  function overUpdate(dt) {
    const ps = findSegment(position + playerZ);
    speed = Math.max(0, speed - maxSpeed * 0.45 * dt);
    updateCars(dt, ps);
    position = U.increase(position, dt * speed, trackLength);
    bgPx += ps.curve * Math.min(speed / maxSpeed, 1) * dt * W * 0.05;
    nitroOn = false; braking = false;
  }
  function updateCamera(dt) {
    let target = 0;
    if (state === 'play' || state === 'countdown') {
      if (keys.up || keys.nitro) target += 1;
      if (keys.down) target -= 1;
    }
    zoom += (target - zoom) * Math.min(1, dt * 2.5);
    camH = CAM_BASE_H + CAM_RANGE * zoom;
    camD = cameraDepth * camH / CAM_R;
  }
  function tick(dt) {
    tAnim += dt;
    shake *= 0.9; if (shake < 0.25) shake = 0;
    whiteFlash = Math.max(0, whiteFlash - dt * 1.6);
    crashCd = Math.max(0, crashCd - dt);
    if (spinT > 0) spinT = Math.max(0, spinT - dt);
    if (themeT < 1) themeT = Math.min(1, themeT + dt / 4);
    steerVis += (((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) - steerVis) * 0.18;
    updateCamera(dt);
    if (banner) { banner.t += dt; if (banner.t >= banner.dur) banner = null; }
    for (let i = pops.length - 1; i >= 0; i--) { pops[i].life -= dt; pops[i].y -= dt * 40; if (pops[i].life <= 0) pops.splice(i, 1); }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (state === 'menu' || state === 'garage' || state === 'maps' || state === 'controls') attract(dt);
    else if (state === 'countdown') countdown(dt);
    else if (state === 'play') update(dt);
    else if (state === 'over') overUpdate(dt);
  }

  // ------------------------------------------------------------------
  //  Dibujo: utilidades
  // ------------------------------------------------------------------
  let FOG = [0, 0, 0], DIM = 1, C = null;
  function T(c, vis, f) {
    const k = DIM * (f === undefined ? 1 : f);
    const r = FOG[0] + (c[0] * k - FOG[0]) * vis, g = FOG[1] + (c[1] * k - FOG[1]) * vis, b = FOG[2] + (c[2] * k - FOG[2]) * vis;
    return 'rgb(' + (r < 0 ? 0 : r > 255 ? 255 : r | 0) + ',' + (g < 0 ? 0 : g > 255 ? 255 : g | 0) + ',' + (b < 0 ? 0 : b > 255 ? 255 : b | 0) + ')';
  }
  const visOf = (fog) => Math.min(1, fog * 1.6);
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
  }
  function txt(s, x, y, size, color, align, weight, italic) {
    ctx.font = (italic === false ? '' : 'italic ') + (weight || 'bold') + ' ' + size + 'px "Segoe UI","Helvetica Neue",Arial,sans-serif';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(s, x + size * 0.05, y + size * 0.06);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  function project(p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    const sc = cameraDepth / p.camera.z;
    p.screen.scale = sc;
    p.screen.x = Math.round(W / 2 + sc * p.camera.x * W / 2);
    p.screen.y = Math.round(H / 2 - sc * p.camera.y * H / 2);
    p.screen.w = Math.round(sc * roadWidth * W / 2);
  }

  // ------------------------------------------------------------------
  //  Dibujo: fondo
  // ------------------------------------------------------------------
  function ridge(xx, f1, f2, f3, p) {
    const a = TAU * xx / 2400;
    return 0.55 * (1 - Math.abs(Math.sin(a * f1 + p))) + 0.3 * (1 - Math.abs(Math.sin(a * f2 + p * 2))) + 0.15 * (1 - Math.abs(Math.sin(a * f3 + p * 3)));
  }
  function drawMountains(col, amp, mult, f1, f2, f3, p, base) {
    ctx.fillStyle = css(col);
    ctx.beginPath(); ctx.moveTo(-M, base + 6);
    for (let x = -M; x <= W + M; x += 8) ctx.lineTo(x, base - amp * ridge(x + bgPx * mult, f1, f2, f3, p));
    ctx.lineTo(W + M, base + 6); ctx.closePath(); ctx.fill();
  }
  function drawCloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU); ctx.arc(x + r * 0.9, y + r * 0.15, r * 0.8, 0, TAU); ctx.arc(x - r * 0.9, y + r * 0.2, r * 0.7, 0, TAU);
    ctx.arc(x + r * 1.7, y + r * 0.3, r * 0.55, 0, TAU); ctx.arc(x - r * 1.7, y + r * 0.35, r * 0.5, 0, TAU);
    ctx.fill();
  }
  function hash1(a, b) { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }
  function drawSkyline(col, hMax, mult, seed, base, litA, litCol) {
    const cw = Math.max(30, H * 0.065), off = bgPx * mult;
    const i0 = Math.floor((off - M) / cw), i1 = Math.ceil((off + W + M) / cw);
    ctx.fillStyle = css(col);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const hh = hMax * (0.22 + 0.78 * hash1(i, seed)), bw = cw * (0.84 + 0.16 * hash1(i, seed + 1));
      ctx.rect(i * cw - off, base - hh, bw, hh + 6);
    }
    ctx.fill();
    if (litA > 0.02) {
      const ws = cw * 0.17;
      ctx.fillStyle = css(litCol, (0.62 * litA).toFixed(3));
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const hh = hMax * (0.22 + 0.78 * hash1(i, seed)), rows = Math.floor((hh - 8) / (ws * 1.9));
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < 3; k++) {
            if (hash1(i * 31 + r * 7 + k, seed + 2) < 0.4) ctx.rect(i * cw - off + cw * 0.12 + k * ws * 1.55, base - hh + 6 + r * ws * 1.9, ws, ws);
          }
        }
      }
      ctx.fill();
    }
  }
  function drawFlyers() {
    const span = W + 400;
    for (let k = 0; k < 7; k++) {
      const dir = k % 2 ? 1 : -1, sp = 24 + k * 9;
      const x = (((k * 211 + tAnim * sp * dir) % span) + span) % span - 200;
      const y = H * (0.09 + 0.05 * k) + Math.sin(tAnim * 0.7 + k) * 3;
      const col = NEON_COLS[k % NEON_COLS.length], len = 28 + k * 3, tx = x - dir * len;
      const g = ctx.createLinearGradient(x, 0, tx, 0);
      g.addColorStop(0, css(col, 0.95)); g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g; ctx.fillRect(Math.min(x, tx), y - 1.5, len, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  function drawFloodGlow(horizon) {
    if (cur.night < 0.15) return;
    const span = W + 240;
    for (let k = 0; k < 9; k++) {
      const x = ((((k * 0.117 + 0.04) * span - bgPx * 0.5) % span) + span) % span - 120;
      ctx.fillStyle = 'rgba(255,244,200,' + (0.1 * cur.night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, horizon - 4, H * 0.05, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,225,' + (0.5 * cur.night).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, horizon - 4, H * 0.008, 0, TAU); ctx.fill();
    }
  }
  function drawBackground() {
    const horizon = H / 2;
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, css(cur.skyTop)); g.addColorStop(1, css(cur.skyBot));
    ctx.fillStyle = g; ctx.fillRect(-M, -M, W + 2 * M, horizon + M + 2);
    if (cur.stars > 0.03) {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const a = U.limit(cur.stars * (0.45 + 0.55 * Math.sin(tAnim * s.f + s.p)), 0, 1);
        const sx = (((s.x * W - bgPx * 0.03) % W) + W) % W;
        ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        ctx.fillRect(sx, s.y * H, s.r, s.r);
      }
    }
    const sunX = W * 0.74, sunY = H * cur.sunY;
    g = ctx.createRadialGradient(sunX, sunY, 1, sunX, sunY, H * 0.3);
    g.addColorStop(0, css(cur.sun, 0.9)); g.addColorStop(0.25, css(cur.sun, 0.35)); g.addColorStop(1, css(cur.sun, 0));
    ctx.fillStyle = g; ctx.fillRect(sunX - H * 0.3, sunY - H * 0.3, H * 0.6, H * 0.6);
    ctx.fillStyle = css(cur.sun); ctx.beginPath(); ctx.arc(sunX, sunY, H * 0.045, 0, TAU); ctx.fill();
    ctx.fillStyle = css(cur.cloud, 0.5);
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i], span = W + 600;
      const cx = ((((c.x * span + tAnim * c.v - bgPx * 0.2) % span) + span) % span) - 300;
      drawCloud(cx, c.y * H, c.s * H * 0.04);
    }
    if (curMap.bg === 'city') {
      drawSkyline(cur.m2, H * 0.27, 0.35, 3, horizon, cur.win * 0.55, cur.neon);
      drawFlyers();
      drawSkyline(cur.m1, H * 0.2, 0.7, 11, horizon, cur.win, [255, 214, 140]);
    } else if (curMap.bg === 'hills') {
      drawMountains(cur.m2, H * 0.075, 0.4, 2, 5, 9, 0.7, horizon);
      drawMountains(cur.m1, H * 0.045, 0.8, 3, 8, 15, 2.1, horizon);
      drawFloodGlow(horizon);
    } else {
      drawMountains(cur.m2, H * 0.17, 0.4, 3, 7, 13, 0.7, horizon);
      drawMountains(cur.m1, H * 0.1, 0.8, 5, 11, 19, 2.1, horizon);
    }
    g = ctx.createLinearGradient(0, horizon - H * 0.1, 0, horizon + 2);
    g.addColorStop(0, css(cur.fog, 0)); g.addColorStop(1, css(cur.fog, 0.9));
    ctx.fillStyle = g; ctx.fillRect(-M, horizon - H * 0.1, W + 2 * M, H * 0.1 + 2);
    ctx.fillStyle = css(mixc(cur.grassL, cur.fog, 0.7)); ctx.fillRect(-M, horizon, W + 2 * M, H / 2 + M);
  }

  // ------------------------------------------------------------------
  //  Dibujo: carretera
  // ------------------------------------------------------------------
  function renderSegment(x1, y1, w1, x2, y2, w2, fog, dark) {
    const rf = curMap.rumble, r1 = w1 * rf, r2 = w2 * rf;
    const l1 = w1 / Math.max(32, 8 * lanes), l2 = w2 / Math.max(32, 8 * lanes);
    ctx.fillStyle = dark ? C.grassD : C.grassL;
    ctx.fillRect(-M, y2, W + 2 * M, y1 - y2);
    if (curMap.runoff > 0) {
      const b1 = w1 * curMap.runoff, b2 = w2 * curMap.runoff, rc = dark ? C.runD : C.run;
      poly(x1 - w1 - r1 - b1, y1, x1 - w1 - r1, y1, x2 - w2 - r2, y2, x2 - w2 - r2 - b2, y2, rc);
      poly(x1 + w1 + r1, y1, x1 + w1 + r1 + b1, y1, x2 + w2 + r2 + b2, y2, x2 + w2 + r2, y2, rc);
    }
    const rum = dark ? C.rumbleD : C.rumbleL;
    poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, rum);
    poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, rum);
    poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, dark ? C.roadD : C.roadL);
    if (curMap.dash && !dark) {
      const lw1 = w1 * 2 / lanes, lw2 = w2 * 2 / lanes;
      let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < lanes; lane++, lx1 += lw1, lx2 += lw2) {
        poly(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, C.lane);
      }
    }
    if (curMap.edge) {
      const e1 = w1 * 0.03, e2 = w2 * 0.03, i1 = w1 * 0.955, i2 = w2 * 0.955;
      poly(x1 - i1, y1, x1 - i1 + e1, y1, x2 - i2 + e2, y2, x2 - i2, y2, C.edge);
      poly(x1 + i1 - e1, y1, x1 + i1, y1, x2 + i2, y2, x2 + i2 - e2, y2, C.edge);
    }
    if (fog < 1) {
      ctx.globalAlpha = 1 - fog; ctx.fillStyle = C.fog;
      ctx.fillRect(-M, y2, W + 2 * M, y1 - y2);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------
  //  Dibujo: coches
  // ------------------------------------------------------------------
  function tail(c, x, y, w, h, r, on, vis, f) {
    if (on) { c.fillStyle = 'rgba(255,40,40,' + (0.35 * vis) + ')'; rr(c, x - 4, y - 4, w + 8, h + 8, r + 3); c.fill(); }
    c.fillStyle = T(on ? TAIL_ON : TAIL_OFF, vis, f); rr(c, x, y, w, h, r); c.fill();
  }
  function drawCar(c, x, y, w, o) {
    if (w < 1.5) return;
    const s = w / 100, vis = o.vis === undefined ? 1 : o.vis, f = o.lit ? 1 / DIM : 1;
    const col = o.color, type = o.type;
    const dark = shade(col, 0.72), light = shade(col, 1.2);
    c.save();
    c.translate(x, y); c.scale(s, s);
    if (o.roll) c.rotate(o.roll);
    if (o.rot) { c.translate(0, -34); c.rotate(o.rot); c.translate(0, 34); }
    if (o.glow) { const gc = o.glowCol || [0, 220, 255]; c.fillStyle = 'rgba(' + (gc[0] | 0) + ',' + (gc[1] | 0) + ',' + (gc[2] | 0) + ',' + o.glow + ')'; c.beginPath(); c.ellipse(0, -2, 72, 13, 0, 0, TAU); c.fill(); }
    c.fillStyle = 'rgba(0,0,0,' + (0.38 * vis) + ')'; c.beginPath(); c.ellipse(0, -2, 58, 8, 0, 0, TAU); c.fill();
    c.fillStyle = T(TIRE, vis, f); rr(c, -53, -30, 17, 30, 5); c.fill(); rr(c, 36, -30, 17, 30, 5); c.fill();

    if (type === 'van') {
      c.fillStyle = T(col, vis, f); rr(c, -49, -90, 98, 70, 9); c.fill();
      c.fillStyle = T(light, vis, f); rr(c, -49, -90, 98, 10, 6); c.fill();
      c.fillStyle = T(GLASS, vis, f); rr(c, -40, -80, 80, 24, 5); c.fill();
      c.fillStyle = T(dark, vis, f); c.fillRect(-1.2, -54, 2.4, 34);
      tail(c, -47, -56, 10, 26, 3, o.brake, vis, f); tail(c, 37, -56, 10, 26, 3, o.brake, vis, f);
      c.fillStyle = T(BUMPER, vis, f); rr(c, -50, -26, 100, 12, 3); c.fill();
      c.fillStyle = T(PLATE, vis, f); rr(c, -11, -46, 22, 9, 2); c.fill();
    } else {
      const sport = type !== 'sedan', ch = sport ? 65 : 71;
      c.fillStyle = T(col, vis, f); rr(c, -50, -48, 100, 32, 9); c.fill();
      c.fillStyle = T(light, vis, f); rr(c, -46, -48, 92, 6, 3); c.fill();
      if (o.stripe) {
        c.fillStyle = T(o.stripe, vis, f);
        if (o.livery === 'dual') { c.fillRect(-15, -48, 7, 30); c.fillRect(8, -48, 7, 30); } else c.fillRect(-7, -48, 14, 30);
      }
      c.fillStyle = T(dark, vis, f);
      c.beginPath(); c.moveTo(-38, -47); c.lineTo(-29, -ch); c.lineTo(29, -ch); c.lineTo(38, -47); c.closePath(); c.fill();
      c.fillStyle = T(GLASS, vis, f);
      c.beginPath(); c.moveTo(-33, -49); c.lineTo(-26, -ch + 4); c.lineTo(26, -ch + 4); c.lineTo(33, -49); c.closePath(); c.fill();
      c.fillStyle = T(GLASS2, vis, f);
      c.beginPath(); c.moveTo(-31, -49); c.lineTo(-25, -ch + 4); c.lineTo(-12, -ch + 4); c.lineTo(-19, -49); c.closePath(); c.fill();
      if (sport && o.wing !== false) {
        c.fillStyle = T(CARBON, vis, f); c.fillRect(-30, -68, 6, 20); c.fillRect(24, -68, 6, 20);
        rr(c, -48, -76, 96, 8, 3); c.fill();
        c.fillStyle = T(col, vis, f); rr(c, -50, -80, 4, 17, 2); c.fill(); rr(c, 46, -80, 4, 17, 2); c.fill();
      }
      c.fillStyle = T(BUMPER, vis, f); rr(c, -44, -20, 88, 14, 4); c.fill();
      tail(c, -46, -43, 24, 9, 3, o.brake, vis, f); tail(c, 22, -43, 24, 9, 3, o.brake, vis, f);
      c.fillStyle = T([110, 10, 18], vis, f); c.fillRect(-22, -40, 44, 3);
      c.fillStyle = T(PLATE, vis, f); rr(c, -11, -37, 22, 10, 2); c.fill();
      c.fillStyle = T([70, 70, 84], vis, f); c.fillRect(-8, -34, 16, 3);
      c.fillStyle = T(EXH, vis, f);
      c.beginPath(); c.arc(-30, -11, 5.5, 0, TAU); c.fill(); c.beginPath(); c.arc(30, -11, 5.5, 0, TAU); c.fill();
      c.fillStyle = T([20, 20, 24], vis, f);
      c.beginPath(); c.arc(-30, -11, 3.2, 0, TAU); c.fill(); c.beginPath(); c.arc(30, -11, 3.2, 0, TAU); c.fill();
    }
    if (o.flame) {
      for (let sx = -30; sx <= 30; sx += 60) {
        const fl = 14 + Math.random() * 18;
        c.fillStyle = 'rgba(255,120,30,0.85)'; c.beginPath(); c.ellipse(sx, -8, 8, fl, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,230,160,0.95)'; c.beginPath(); c.ellipse(sx, -8, 4.5, fl * 0.62, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(90,170,255,0.9)'; c.beginPath(); c.ellipse(sx, -8, 2.5, fl * 0.3, 0, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  // ------------------------------------------------------------------
  //  Dibujo: decorado
  // ------------------------------------------------------------------
  function drawPine(c, x, y, w, vis, v) {
    const f = 0.85 + v * 0.3;
    c.fillStyle = T(TRUNK, vis, 1); c.fillRect(x - w * 0.06, y - w * 0.3, w * 0.12, w * 0.3);
    for (let i = 0; i < 3; i++) {
      const by = y - w * 0.22 - i * w * 0.52, hw = w * (0.5 - i * 0.1), th = w * 0.78;
      c.fillStyle = T(i % 2 ? PINE_B : PINE_A, vis, f);
      c.beginPath(); c.moveTo(x - hw, by); c.lineTo(x + hw, by); c.lineTo(x, by - th); c.closePath(); c.fill();
      c.fillStyle = T(PINE_S, vis, f);
      c.beginPath(); c.moveTo(x, by - th); c.lineTo(x + hw, by); c.lineTo(x, by); c.closePath(); c.fill();
    }
  }
  function drawOak(c, x, y, w, vis, v) {
    const f = 0.85 + v * 0.3;
    c.fillStyle = T(TRUNK, vis, 1); c.fillRect(x - w * 0.07, y - w * 0.45, w * 0.14, w * 0.45);
    c.fillStyle = T(OAK_A, vis, f);
    c.beginPath(); c.arc(x, y - w * 0.78, w * 0.32, 0, TAU); c.arc(x - w * 0.22, y - w * 0.6, w * 0.26, 0, TAU); c.arc(x + w * 0.22, y - w * 0.6, w * 0.26, 0, TAU); c.fill();
    c.fillStyle = T(OAK_S, vis, f);
    c.beginPath(); c.arc(x + w * 0.16, y - w * 0.55, w * 0.2, 0, TAU); c.fill();
    c.fillStyle = T(OAK_B, vis, f);
    c.beginPath(); c.arc(x - w * 0.1, y - w * 0.88, w * 0.18, 0, TAU); c.fill();
  }
  function drawBush(c, x, y, w, vis, v) {
    const f = 0.85 + v * 0.3;
    c.fillStyle = T(BUSH, vis, f);
    c.beginPath(); c.arc(x - w * 0.2, y - w * 0.18, w * 0.22, 0, TAU); c.arc(x + w * 0.2, y - w * 0.18, w * 0.22, 0, TAU); c.arc(x, y - w * 0.28, w * 0.26, 0, TAU); c.fill();
  }
  function drawRock(c, x, y, w, vis) {
    c.fillStyle = T(ROCK, vis, 1);
    c.beginPath(); c.moveTo(x - w * 0.5, y); c.lineTo(x - w * 0.38, y - w * 0.32); c.lineTo(x - w * 0.1, y - w * 0.5); c.lineTo(x + w * 0.25, y - w * 0.4); c.lineTo(x + w * 0.5, y); c.closePath(); c.fill();
    c.fillStyle = T(ROCK_S, vis, 1);
    c.beginPath(); c.moveTo(x + w * 0.1, y - w * 0.46); c.lineTo(x + w * 0.25, y - w * 0.4); c.lineTo(x + w * 0.5, y); c.lineTo(x + w * 0.1, y); c.closePath(); c.fill();
  }
  function drawPost(c, x, y, w, vis) {
    c.fillStyle = T([235, 235, 235], vis, 1); c.fillRect(x - w / 2, y - w * 4.5, w, w * 4.5);
    c.fillStyle = T([220, 40, 40], vis, 1); c.fillRect(x - w / 2, y - w * 3.6, w, w * 1.1);
  }
  function drawBoard(c, x, y, w, vis, sp) {
    c.fillStyle = T([70, 70, 80], vis, 1);
    c.fillRect(x - w * 0.36, y - w * 0.45, w * 0.05, w * 0.45); c.fillRect(x + w * 0.31, y - w * 0.45, w * 0.05, w * 0.45);
    c.fillStyle = T([34, 34, 42], vis, 1); rr(c, x - w / 2, y - w * 0.95, w, w * 0.5, w * 0.03); c.fill();
    c.fillStyle = T(sp.col, vis, 1); rr(c, x - w * 0.47, y - w * 0.92, w * 0.94, w * 0.44, w * 0.02); c.fill();
    if (w > 36) {
      c.font = 'italic 900 ' + (w * 0.2) + 'px Arial,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = T([255, 255, 255], vis, 1); c.fillText(sp.txt, x, y - w * 0.7);
    }
  }
  const CROWD = [[230, 60, 60], [240, 240, 240], [60, 110, 230], [250, 200, 40], [60, 180, 110], [200, 90, 200]];
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  function drawTower(c, x, y, w, vis, sp) {
    const h = w * (2.3 + sp.v * 3.4), x0 = x - w / 2, em = 1 / DIM;
    c.fillStyle = T(sp.col, vis, 1); c.fillRect(x0, y - h, w, h);
    c.fillStyle = T(sp.col, vis, 0.62); c.fillRect(x + w * 0.22, y - h, w * 0.28, h);
    c.fillStyle = T(sp.col, vis, 1.4); c.fillRect(x0, y - h, Math.max(1, w * 0.05), h);
    c.fillStyle = T(cur.neon, vis, em); c.fillRect(x0, y - h - w * 0.02, w, Math.max(1, w * 0.035));
    if (w > 24) {
      const cols = Math.max(3, Math.min(7, Math.floor(w / 12))), cell = w / cols, rows = Math.max(1, Math.floor((h - cell * 1.2) / cell));
      const lit = 0.2 + 0.5 * cur.win, wx = cell * 0.52, wy = cell * 0.4, sd = sp.v * 100;
      for (let pass = 0; pass < 2; pass++) {
        c.fillStyle = T(pass ? cur.neon : [255, 214, 140], vis, em);
        c.beginPath();
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < cols; k++) {
            const hv = hash1(r * 13 + k * 5, sd);
            if (hv < lit && (hv < lit * 0.26) === !!pass) c.rect(x0 + k * cell + (cell - wx) / 2, y - h + cell * 0.55 + r * cell, wx, wy);
          }
        }
        c.fill();
      }
    }
    if (sp.v > 0.45) {
      const ah = w * (0.2 + sp.v * 0.3);
      c.fillStyle = T(GRAY, vis, 1); c.fillRect(x - w * 0.012, y - h - ah, Math.max(1, w * 0.024), ah);
      if (Math.sin(tAnim * 3 + sp.v * 20) > 0) { c.fillStyle = T([255, 40, 40], vis, em); c.beginPath(); c.arc(x, y - h - ah, Math.max(1, w * 0.03), 0, TAU); c.fill(); }
    }
  }
  function drawNPost(c, x, y, w, vis, sp) {
    const h = w * 9, em = 1 / DIM;
    c.fillStyle = T([62, 68, 94], vis, 1); c.fillRect(x - w * 0.18, y - h, w * 0.36, h);
    c.fillStyle = T(sp.col, vis, em); c.fillRect(x - w * 0.09, y - h * 0.92, w * 0.18, h * 0.6);
    c.fillStyle = css(sp.col, (0.18 * vis).toFixed(3)); c.beginPath(); c.arc(x, y - h - w * 0.3, Math.min(w * 1.7, H * 0.09), 0, TAU); c.fill();
    c.fillStyle = T(sp.col, vis, em); rr(c, x - w * 0.55, y - h - w * 0.55, w * 1.1, w * 0.5, w * 0.12); c.fill();
  }
  function drawArch(c, x, y, w, vis, sp) {
    const hgt = w * 0.42, pw = Math.max(1, w * 0.03), em = 1 / DIM, xl = x - w / 2, xr = x + w / 2;
    c.fillStyle = T([52, 58, 82], vis, 1);
    c.fillRect(xl - pw / 2, y - hgt, pw * 1.6, hgt); c.fillRect(xr - pw * 1.1, y - hgt, pw * 1.6, hgt);
    c.fillStyle = T([34, 38, 58], vis, 1); rr(c, xl - pw, y - hgt - pw * 2.4, w + 2 * pw, pw * 3.4, pw); c.fill();
    if (sp.f1) {
      c.fillStyle = T(sp.col, vis, 1); rr(c, x - w * 0.3, y - hgt + pw * 0.9, w * 0.6, hgt * 0.24, pw * 0.7); c.fill();
      if (w > 70) {
        c.font = 'italic 900 ' + (hgt * 0.17) + 'px Arial,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = T(lum(sp.col) > 150 ? [20, 20, 26] : [255, 255, 255], vis, 1); c.fillText(sp.txt, x, y - hgt + pw * 0.9 + hgt * 0.12);
      }
    } else {
      c.fillStyle = T(sp.col, vis, em);
      c.fillRect(xl, y - hgt + pw * 0.45, w, pw * 0.6);
      c.fillRect(xl - pw * 0.1, y - hgt, pw * 0.4, hgt); c.fillRect(xr - pw * 0.3, y - hgt, pw * 0.4, hgt);
      if (w > 50) { c.fillStyle = css(sp.col, (0.1 * vis).toFixed(3)); c.fillRect(xl, y - hgt + pw * 1.1, w, hgt * 0.4); }
    }
  }
  function drawHolo(c, x, y, w, vis, sp) {
    const pwid = w * 0.9, ph = w * 0.5, by = y - w * 0.4;
    c.fillStyle = T([70, 76, 102], vis, 1); c.fillRect(x - w * 0.02, by, w * 0.04, w * 0.4);
    c.fillStyle = css(sp.col, (0.22 * vis).toFixed(3)); rr(c, x - pwid / 2, by - ph, pwid, ph, w * 0.04); c.fill();
    c.lineWidth = Math.max(1, w * 0.012); c.strokeStyle = css(sp.col, (0.9 * vis).toFixed(3)); c.stroke();
    if (w > 40) {
      c.fillStyle = css(sp.col, (0.14 * vis).toFixed(3));
      for (let yy = by - ph + w * 0.05; yy < by - w * 0.03; yy += w * 0.06) c.fillRect(x - pwid / 2 + w * 0.03, yy, pwid - w * 0.06, w * 0.012);
      c.font = 'italic 900 ' + (w * 0.2) + 'px Arial,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = css(mixc(sp.col, [255, 255, 255], 0.55), (0.95 * vis).toFixed(3)); c.fillText(sp.txt, x, by - ph / 2);
    }
  }
  function drawTires(c, x, y, w, vis, sp) {
    const r = w / 6;
    if (w < 12) {
      c.fillStyle = T(TIRE, vis, 1); c.fillRect(x - w / 2, y - w * 0.6, w, w * 0.6);
      c.fillStyle = T(sp.col, vis, 1); c.fillRect(x - w / 2, y - w * 0.6, w, Math.max(1, w * 0.12));
      return;
    }
    const pos = [[-2, -1], [0, -1], [2, -1], [-1, -3], [1, -3]];
    const rings = [[TIRE, 0.98], [[52, 52, 60], 0.56], [[16, 16, 20], 0.28]];
    for (let k = 0; k < rings.length; k++) {
      c.fillStyle = T(rings[k][0], vis, 1); c.beginPath();
      for (let i = 0; i < pos.length; i++) { const cx = x + pos[i][0] * r, cy = y + pos[i][1] * r; c.moveTo(cx + r * rings[k][1], cy); c.arc(cx, cy, r * rings[k][1], 0, TAU); }
      c.fill();
    }
    c.fillStyle = T(sp.col, vis, 1); c.fillRect(x - r * 1.7, y - r * 4.05, r * 3.4, Math.max(1, r * 0.4));
  }
  function drawAdBoard(c, x, y, w, vis, sp) {
    const bh = w * 0.16;
    c.fillStyle = T([40, 40, 46], vis, 1); c.fillRect(x - w / 2, y - bh - w * 0.04, w, bh + w * 0.04);
    c.fillStyle = T(sp.col, vis, 1); c.fillRect(x - w / 2 + w * 0.01, y - bh - w * 0.03, w - w * 0.02, bh - w * 0.02);
    if (w > 50) {
      c.font = 'italic 900 ' + (bh * 0.62) + 'px Arial,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = T(lum(sp.col) > 150 ? [20, 20, 26] : [255, 255, 255], vis, 1); c.fillText(sp.txt, x, y - bh * 0.55 - w * 0.03);
    }
  }
  function drawStand(c, x, y, w, vis, sp) {
    const h = w * 0.55, x0 = x - w / 2, tiers = 4, th = h * 0.7 / tiers, top = y - h * 0.84;
    c.fillStyle = T([88, 92, 108], vis, 1); c.fillRect(x0, y - h * 0.16, w, h * 0.16);
    for (let t = 0; t < tiers; t++) { c.fillStyle = T(t % 2 ? [128, 132, 148] : [112, 116, 132], vis, 1); c.fillRect(x0, top + t * th, w, th); }
    if (w > 30) {
      const cols = Math.max(6, Math.min(40, Math.floor(w / (th * 0.95)))), cw2 = w / cols, dw = cw2 * 0.6, dh = th * 0.55;
      for (let ci = 0; ci < CROWD.length; ci++) {
        c.fillStyle = T(CROWD[ci], vis, 1); c.beginPath();
        for (let t = 0; t < tiers; t++) {
          for (let k = 0; k < cols; k++) {
            if (((hash1(t * 29 + k, sp.v * 50) * CROWD.length) | 0) === ci) c.rect(x0 + k * cw2 + (cw2 - dw) / 2, top + t * th + th * 0.12, dw, dh);
          }
        }
        c.fill();
      }
    }
    c.fillStyle = T([44, 46, 58], vis, 1); c.fillRect(x0 - w * 0.03, y - h, w * 1.06, h * 0.1);
    c.fillStyle = T(sp.col, vis, 1); c.fillRect(x0 - w * 0.03, y - h * 0.9, w * 1.06, h * 0.045);
    c.fillStyle = T([70, 74, 90], vis, 1); c.fillRect(x0 + w * 0.02, y - h * 0.9, w * 0.02, h * 0.9); c.fillRect(x + w * 0.46, y - h * 0.9, w * 0.02, h * 0.9);
  }
  function drawLamp(c, x, y, w, vis, sp) {
    const h = w * 16, a = cur.night, em = 1 / DIM;
    c.fillStyle = T([110, 114, 128], vis, 1); c.fillRect(x - w * 0.2, y - h, w * 0.4, h);
    c.fillStyle = T([50, 52, 64], vis, 1); c.fillRect(x - w * 1.9, y - h - w * 1.4, w * 3.8, w * 1.4);
    c.fillStyle = T([255, 244, 205], vis, em * (0.6 + a * 0.4));
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) c.fillRect(x - w * 1.7 + k * w * 0.9, y - h - w * 1.25 + r * w * 0.6, w * 0.7, w * 0.4);
    if (a > 0.2 && w > 3) {
      c.fillStyle = 'rgba(255,240,190,' + (0.07 * a * vis).toFixed(3) + ')'; c.beginPath(); c.arc(x, y - h - w * 0.7, Math.min(w * 9, H * 0.3), 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,240,190,' + (0.12 * a * vis).toFixed(3) + ')'; c.beginPath(); c.arc(x, y - h - w * 0.7, Math.min(w * 4.5, H * 0.15), 0, TAU); c.fill();
    }
  }
  function drawSprite(c, sp, x, y, w, vis) {
    switch (sp.t) {
      case 'tower': drawTower(c, x, y, w, vis, sp); break;
      case 'npost': drawNPost(c, x, y, w, vis, sp); break;
      case 'arch': drawArch(c, x, y, w, vis, sp); break;
      case 'holo': drawHolo(c, x, y, w, vis, sp); break;
      case 'tires': drawTires(c, x, y, w, vis, sp); break;
      case 'adboard': drawAdBoard(c, x, y, w, vis, sp); break;
      case 'stand': drawStand(c, x, y, w, vis, sp); break;
      case 'lamp': drawLamp(c, x, y, w, vis, sp); break;
      case 'pine': drawPine(c, x, y, w, vis, sp.v); break;
      case 'oak': drawOak(c, x, y, w, vis, sp.v); break;
      case 'bush': drawBush(c, x, y, w, vis, sp.v); break;
      case 'rock': drawRock(c, x, y, w, vis); break;
      case 'post': drawPost(c, x, y, w, vis); break;
      case 'board': drawBoard(c, x, y, w, vis, sp); break;
      default: break;
    }
  }
  function drawGantry(seg) {
    const hw = seg.p1.screen.w, cx = seg.p1.screen.x, sy = seg.p1.screen.y;
    if (hw < 12 || cx + hw * 1.5 < -M || cx - hw * 1.5 > W + M) return;
    const vis = visOf(seg.fog), start = seg.gantry === 'start';
    const gh = hw * 0.9, bh = hw * 0.34, px = hw * 1.22, pw = Math.max(1, hw * 0.07);
    ctx.save();
    if (sy > seg.clip) { ctx.beginPath(); ctx.rect(-M, -M, W + 2 * M, seg.clip + M); ctx.clip(); }
    ctx.fillStyle = T(GRAY, vis, 1);
    ctx.fillRect(cx - px - pw / 2, sy - gh, pw, gh); ctx.fillRect(cx + px - pw / 2, sy - gh, pw, gh);
    ctx.fillStyle = T(start ? [20, 20, 28] : [18, 38, 70], vis, 1);
    rr(ctx, cx - px - pw, sy - gh - bh * 0.1, 2 * px + 2 * pw, bh, bh * 0.18); ctx.fill();
    ctx.fillStyle = T(start ? [255, 255, 255] : [255, 200, 40], vis, 1);
    ctx.fillRect(cx - px, sy - gh + bh * 0.74, 2 * px, bh * 0.08);
    if (hw > 55) {
      ctx.font = 'italic 900 ' + (bh * 0.46) + 'px Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = T([255, 255, 255], vis, 1);
      ctx.fillText(start ? 'SALIDA / META' : 'CHECKPOINT', cx, sy - gh + bh * 0.36);
    }
    if (start && hw > 40) {
      const sq = bh * 0.12, nsq = Math.floor(2 * px / sq);
      for (let i = 0; i < nsq; i++) {
        ctx.fillStyle = T(i % 2 ? [255, 255, 255] : [20, 20, 20], vis, 1);
        ctx.fillRect(cx - px + i * sq, sy - gh - bh * 0.1, sq, sq);
        ctx.fillStyle = T(i % 2 ? [20, 20, 20] : [255, 255, 255], vis, 1);
        ctx.fillRect(cx - px + i * sq, sy - gh - bh * 0.1 + sq, sq, sq);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  //  Dibujo: mundo completo
  // ------------------------------------------------------------------
  function skinOpts(sk) {
    return { color: sk.color, type: sk.type || 'player', vis: 1, lit: true, stripe: sk.stripe, livery: sk.livery, wing: sk.wing, glowCol: sk.glow };
  }
  function drawPlayerFX() {
    const sc = cameraDepth / camD;
    const px = Math.min(playerW * roadWidth * sc * (W / 2), H * 0.6);
    playerPx = px;
    const off = playerX < -1 || playerX > 1;
    const bounce = (Math.random() - 0.5) * 2 * Math.min(speed / maxSpeed, 1.2) * (off ? 3 : 1) * px * 0.012;
    let rot = 0;
    if (spinT > 0) rot = U.easeOut(0, TAU, 1 - spinT / 0.9) * spinDir;
    if (state !== 'garage') {
      const o = skinOpts(SKINS[skinIdx]);
      o.roll = steerVis * 0.045; o.rot = rot; o.brake = braking || (cur.night > 0.4); o.flame = nitroOn;
      o.glow = 0.16 + cur.night * 0.3;
      drawCar(ctx, W / 2 + steerVis * px * 0.04, gy() + bounce, px, o);
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], a = p.life / p.max;
      ctx.fillStyle = css(p.c, (a * 0.8).toFixed(3));
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * (1 + p.grow * (1 - a))), 0, TAU); ctx.fill();
    }
  }
  function drawWorld() {
    const N = segments.length;
    const camPos = U.increase(position, playerZ - camD, trackLength);
    const baseSegment = findSegment(camPos);
    const basePercent = U.percentRemaining(camPos, segmentLength);
    const playerSeg = findSegment(position + playerZ);
    const playerPercent = U.percentRemaining(position + playerZ, segmentLength);
    playerY = U.interp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);
    let maxy = H, x = 0, dx = -(baseSegment.curve * basePercent), n, seg;

    for (n = 0; n < drawDistance; n++) {
      seg = segments[(baseSegment.index + n) % N];
      seg.looped = seg.index < baseSegment.index;
      seg.fog = U.fog(n / drawDistance, fogDensity);
      seg.clip = maxy;
      const camZ = camPos - (seg.looped ? trackLength : 0);
      project(seg.p1, playerX * roadWidth - x, playerY + camH, camZ);
      project(seg.p2, playerX * roadWidth - x - dx, playerY + camH, camZ);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= cameraDepth || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      renderSegment(seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w, seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w, seg.fog, seg.dark);
      maxy = seg.p1.screen.y;
    }

    for (n = drawDistance - 1; n >= 0; n--) {
      seg = segments[(baseSegment.index + n) % N];
      const near = seg.p1.camera.z > cameraDepth;
      if (near && state !== 'menu' && state !== 'garage' && state !== 'maps' && state !== 'controls') {
        for (let i = 0; i < seg.cars.length; i++) {
          const car = seg.cars[i];
          const sc = U.interp(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
          const cx = U.interp(seg.p1.screen.x, seg.p2.screen.x, car.percent) + sc * car.offset * roadWidth * W / 2;
          const cy = U.interp(seg.p1.screen.y, seg.p2.screen.y, car.percent);
          const cw = sc * roadWidth * (W / 2) * car.w;
          if (!(cw >= 2) || cw > W * 2.5 || cx + cw < -M || cx - cw > W + M) continue;
          ctx.save();
          if (cy > seg.clip) { ctx.beginPath(); ctx.rect(-M, -M, W + 2 * M, seg.clip + M); ctx.clip(); }
          drawCar(ctx, cx, cy, cw, car.racing ? { color: car.color, type: car.type, vis: Math.max(0.55, visOf(seg.fog)), brake: true, stripe: [245, 245, 245], livery: 'dual', wing: true }
            : { color: car.color, type: car.type, vis: Math.max(0.55, visOf(seg.fog)), brake: true });
          ctx.restore();
        }
      }
      if (near) {
        for (let i = 0; i < seg.sprites.length; i++) {
          const sp = seg.sprites[i];
          const sc = seg.p1.screen.scale;
          const sx = seg.p1.screen.x + sc * sp.offset * roadWidth * W / 2;
          const sy = seg.p1.screen.y;
          const pw = sc * roadWidth * (W / 2) * sp.w;
          if (!(pw >= 1.2) || pw > W * 2.5 || sx + pw < -M || sx - pw > W + M) continue;
          ctx.save();
          if (sy > seg.clip) { ctx.beginPath(); ctx.rect(-M, -M, W + 2 * M, seg.clip + M); ctx.clip(); }
          drawSprite(ctx, sp, sx, sy, pw, visOf(seg.fog));
          ctx.restore();
        }
        if (seg.gantry) drawGantry(seg);
      }
      if (seg === playerSeg) drawPlayerFX();
    }
  }

  // ------------------------------------------------------------------
  //  HUD y pantallas
  // ------------------------------------------------------------------
  function gearInfo() {
    const gp = Math.min(speed / maxSpeed, 1.3) / 1.3 * 6;
    const fl = Math.floor(gp);
    return { gear: Math.min(6, fl + 1), rpm: gp - fl };
  }
  function panel(x, y, w, h, ui) {
    rr(ctx, x, y, w, h, 14 * ui);
    ctx.fillStyle = 'rgba(8,12,24,0.58)'; ctx.fill();
    ctx.lineWidth = 1.5 * ui; ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.stroke();
  }
  function drawMap(ui, x, y, B) {
    panel(x, y, B, B, ui);
    if (!mapPts.length) return;
    const pad = 16 * ui, S = B - 2 * pad;
    const X = (p) => x + pad + p[0] * S, Y = (p) => y + pad + p[1] * S;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < mapPts.length; i++) { if (i === 0) ctx.moveTo(X(mapPts[i]), Y(mapPts[i])); else ctx.lineTo(X(mapPts[i]), Y(mapPts[i])); }
      ctx.closePath();
    };
    path(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 7 * ui; ctx.stroke();
    path(); ctx.strokeStyle = 'rgba(255,255,255,0.78)'; ctx.lineWidth = 3.5 * ui; ctx.stroke();
    for (let i = 0; i < cpIdx.length; i++) {
      const p = mapPts[Math.min(mapPts.length - 1, Math.floor(cpIdx[i] / MAP_STRIDE))];
      ctx.fillStyle = i === 0 ? '#ffffff' : '#ffd23f';
      ctx.beginPath(); ctx.arc(X(p), Y(p), 4 * ui, 0, TAU); ctx.fill();
    }
    const pi = Math.min(mapPts.length - 1, Math.floor(findSegment(position + playerZ).index / MAP_STRIDE));
    const pp = mapPts[pi];
    ctx.fillStyle = '#ff3b5c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * ui;
    ctx.beginPath(); ctx.arc(X(pp), Y(pp), 5.5 * ui, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawSpeedo(ui) {
    const R = 92 * ui, cx = W - R - 26 * ui, cy = H - R - 26 * ui, kmh = speed * KMH;
    const a0 = Math.PI * 0.75, aSpan = Math.PI * 1.5, maxK = 360;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = 'rgba(8,12,24,0.62)'; ctx.fill();
    ctx.lineWidth = 2 * ui; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineWidth = 5 * ui;
    ctx.strokeStyle = 'rgba(255,60,60,0.85)'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, a0 + aSpan * 300 / maxK, a0 + aSpan); ctx.stroke();
    const frac = U.limit(kmh / maxK, 0, 1);
    if (frac > 0.002) {
      ctx.strokeStyle = nitroOn ? '#ff9d2e' : '#2fd8ff';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, a0, a0 + aSpan * frac); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (let k = 0; k <= maxK; k += 20) {
      const a = a0 + aSpan * k / maxK, major = k % 40 === 0;
      const r1 = R * 0.82, r2 = R * (major ? 0.7 : 0.76);
      ctx.lineWidth = (major ? 2 : 1) * ui;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      if (k % 80 === 0) {
        ctx.font = 'bold ' + (10 * ui) + 'px Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(String(k), cx + Math.cos(a) * R * 0.58, cy + Math.sin(a) * R * 0.58);
      }
    }
    const na = a0 + aSpan * frac;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 * ui; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * R * 0.66, cy + Math.sin(na) * R * 0.66); ctx.stroke();
    ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(cx, cy, 5 * ui, 0, TAU); ctx.fill();
    ctx.restore();
    txt(String(Math.round(kmh)), cx, cy + R * 0.5, 30 * ui, '#ffffff', 'center', '900');
    txt('KM/H', cx, cy + R * 0.68, 10 * ui, '#8fa6c9', 'center', 'bold', false);
    txt('M' + gearInfo().gear, cx, cy - R * 0.28, 17 * ui, '#ffb347', 'center', '900');
  }
  function drawNitroBar(ui) {
    const x = 24 * ui, w = 250 * ui, h = 14 * ui, y = H - 42 * ui;
    txt('NITRO', x, y - 8 * ui, 12 * ui, nitroOn ? '#ffb347' : '#9fb4d6', 'left', 'bold');
    rr(ctx, x, y, w, h, 7 * ui); ctx.fillStyle = 'rgba(8,12,24,0.62)'; ctx.fill();
    ctx.lineWidth = 1.5 * ui; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    if (nitro > 0.01) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#19d3ff'); g.addColorStop(1, nitroOn ? '#ff9d2e' : '#ff3bd4');
      rr(ctx, x + 2 * ui, y + 2 * ui, Math.max(0, (w - 4 * ui) * nitro), h - 4 * ui, 5 * ui); ctx.fillStyle = g; ctx.fill();
    }
  }
  function speedLines() {
    const sp = speed / maxSpeed;
    const inten = U.limit((sp - 0.72) * 2.2 + (nitroOn ? 0.5 : 0), 0, 1);
    if (inten < 0.05) return;
    const cx = W / 2, cy = H * 0.46, base = Math.min(W, H) * 0.5;
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU, r0 = base * U.rnd(0.85, 1.25), len = base * U.rnd(0.15, 0.4) * (0.5 + inten);
      ctx.strokeStyle = 'rgba(255,255,255,' + (inten * 0.22).toFixed(3) + ')';
      ctx.lineWidth = U.rnd(1, 2.6);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); ctx.stroke();
    }
    ctx.restore();
  }
  function postFX() {
    if (cur.night > 0.02) {
      const g = ctx.createRadialGradient(W / 2, H * 0.9, H * 0.05, W / 2, H * 0.62, H * 0.95);
      g.addColorStop(0, 'rgba(0,0,12,0)'); g.addColorStop(1, 'rgba(0,0,12,' + (0.55 * cur.night).toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (state === 'play') speedLines();
    if (whiteFlash > 0.01) { ctx.fillStyle = 'rgba(255,255,255,' + whiteFlash.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  }
  function focused() { try { return document.hasFocus(); } catch (e) { return true; } }
  function drawHUD(ui) {
    const x0 = 22 * ui, y0 = 22 * ui;
    panel(x0, y0, 224 * ui, 134 * ui, ui);
    txt('TIEMPO', x0 + 16 * ui, y0 + 26 * ui, 12 * ui, '#9fb4d6', 'left', 'bold');
    const low = time < 10 && state === 'play';
    const pulse = low ? (0.6 + 0.4 * Math.sin(tAnim * 10)) : 1;
    txt(time.toFixed(1), x0 + 16 * ui, y0 + 72 * ui, 46 * ui, low ? 'rgb(255,' + ((80 + 90 * pulse) | 0) + ',70)' : '#ffffff', 'left', '900');
    txt('PUNTOS', x0 + 16 * ui, y0 + 98 * ui, 11 * ui, '#9fb4d6', 'left', 'bold');
    txt(thousands(score()), x0 + 16 * ui, y0 + 122 * ui, 22 * ui, '#ffd23f', 'left', '900');
    txt((dist / 1000).toFixed(2) + ' km', x0 + 208 * ui, y0 + 122 * ui, 13 * ui, '#9fb4d6', 'right', 'bold', false);

    const B = 150 * ui, mx = W - 22 * ui - B, my = 22 * ui;
    drawMap(ui, mx, my, B);
    txt('VUELTA ' + lap, mx + B / 2, my + B + 24 * ui, 17 * ui, '#ffffff', 'center', '900');
    txt('RÉCORD ' + thousands(Math.max(best, score())), mx + B / 2, my + B + 44 * ui, 12 * ui, '#9fb4d6', 'center', 'bold', false);
    txt(curMap.name.toUpperCase(), mx + B / 2, my + B + 62 * ui, 11 * ui, '#7f95b8', 'center', 'bold', false);

    drawSpeedo(ui);
    drawNitroBar(ui);

    for (let i = 0; i < pops.length; i++) {
      const p = pops[i], a = Math.min(1, p.life / 0.5);
      ctx.globalAlpha = a;
      txt(p.t, W / 2, H * 0.6 + p.y - i * 30 * ui, 22 * ui, p.c, 'center', '900');
      ctx.globalAlpha = 1;
    }
    if (banner) {
      const pr = banner.t / banner.dur;
      const al = pr < 0.8 ? 1 : 1 - (pr - 0.8) / 0.2;
      const sc = 1 + Math.max(0, 0.3 - pr * 1.5);
      ctx.save(); ctx.globalAlpha = Math.max(0, al);
      ctx.translate(W / 2, H * 0.26); ctx.scale(sc, sc);
      txt(banner.text, 0, 0, 60 * ui, banner.color, 'center', '900');
      if (banner.sub) txt(banner.sub, 0, 40 * ui, 24 * ui, '#ffffff', 'center', 'bold');
      ctx.restore();
    }
    if (state === 'countdown') {
      const n = Math.ceil(cdTimer - 0.6);
      if (n >= 1) {
        const frac = (cdTimer - 0.6) - Math.floor(cdTimer - 0.6 - 0.0001);
        const sc = 1 + (1 - Math.min(1, frac)) * 0.35;
        ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(sc, sc);
        txt(String(n), 0, 0, 150 * ui, n === 1 ? '#7dff6a' : (n === 2 ? '#ffd23f' : '#ff5d5d'), 'center', '900');
        ctx.restore();
      }
    }
  }
  function dim(a) { ctx.fillStyle = 'rgba(4,6,16,' + a + ')'; ctx.fillRect(0, 0, W, H); }
  function drawTitle(ui, y) {
    const size = Math.min(110 * ui, W / 9);
    ctx.font = 'italic 900 ' + size + 'px "Arial Black",Impact,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const g = ctx.createLinearGradient(W / 2 - size * 3, 0, W / 2 + size * 3, 0);
    g.addColorStop(0, '#ff2d95'); g.addColorStop(1, '#ffd400');
    ctx.lineJoin = 'round'; ctx.lineWidth = 12 * ui; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText('TURBO HIGHWAY', W / 2, y);
    ctx.fillStyle = g; ctx.fillText('TURBO HIGHWAY', W / 2, y);
  }
  function hit(x, y, w, h, fn) { hits.push({ x: x, y: y, w: w, h: h, fn: fn }); }
  function button(label, x, y, w, h, ui, fn, active) {
    const hov = over(x, y, w, h);
    rr(ctx, x, y, w, h, 10 * ui);
    ctx.fillStyle = active ? (hov ? 'rgba(255,226,120,1)' : 'rgba(255,210,63,0.92)') : (hov ? 'rgba(40,52,92,0.92)' : 'rgba(8,12,24,0.72)'); ctx.fill();
    ctx.lineWidth = 2 * ui; ctx.strokeStyle = active ? '#ffffff' : (hov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)'); ctx.stroke();
    txt(label, x + w / 2, y + h / 2 + 6 * ui, 16 * ui, active ? '#101018' : '#ffffff', 'center', '900', false);
    hit(x, y, w, h, fn);
  }
  function arrow(x, y, dir, ui, fn) {
    const s = 26 * ui;
    ctx.fillStyle = 'rgba(8,12,24,0.72)'; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    ctx.lineWidth = 2 * ui; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    ctx.moveTo(x + dir * s * 0.35, y - s * 0.45); ctx.lineTo(x - dir * s * 0.35, y); ctx.lineTo(x + dir * s * 0.35, y + s * 0.45);
    ctx.closePath(); ctx.fill();
    hit(x - s, y - s, s * 2, s * 2, fn);
  }
  // ---- Iconos del menú (dibujados con código) ----------------------------
  function drawIcon(kind, cx, cy, sz, col) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (kind === 'flag') {
      const px = cx - sz * 0.55, top = cy - sz * 0.85, sq = sz * 0.34;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, sz * 0.14);
      ctx.beginPath(); ctx.moveTo(px, cy + sz * 0.9); ctx.lineTo(px, top); ctx.stroke();
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
        ctx.fillStyle = (r + k) % 2 ? '#101018' : '#ffffff';
        ctx.fillRect(px + sz * 0.07 + k * sq, top + r * sq + Math.sin(tAnim * 5 + k) * sz * 0.05, sq, sq);
      }
    } else if (kind === 'car') {
      const o = skinOpts(SKINS[skinIdx]); o.brake = true;
      drawCar(ctx, cx, cy + sz * 0.8, sz * 2.1, o);
    } else if (kind === 'map') {
      const path = function () {
        ctx.beginPath(); ctx.moveTo(cx - sz * 0.9, cy + sz * 0.8);
        ctx.bezierCurveTo(cx - sz * 0.9, cy + sz * 0.1, cx + sz * 0.2, cy + sz * 0.9, cx + sz * 0.1, cy + sz * 0.1);
        ctx.bezierCurveTo(cx, cy - sz * 0.3, cx - sz * 0.7, cy - sz * 0.1, cx - sz * 0.3, cy - sz * 0.6);
      };
      path(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = sz * 0.5; ctx.stroke();
      path(); ctx.strokeStyle = col; ctx.lineWidth = sz * 0.26; ctx.stroke();
      const px = cx + sz * 0.62, py = cy - sz * 0.5, r = sz * 0.34;
      ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px - r * 0.8, py + r * 0.5); ctx.lineTo(px, py + r * 2); ctx.lineTo(px + r * 0.8, py + r * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, py, r * 0.38, 0, TAU); ctx.fill();
    } else if (kind === 'keys') {
      rr(ctx, cx - sz * 1.05, cy - sz * 0.6, sz * 2.1, sz * 1.3, sz * 0.18);
      ctx.strokeStyle = col; ctx.lineWidth = sz * 0.12; ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath();
      for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) ctx.rect(cx - sz * 0.85 + k * sz * 0.36, cy - sz * 0.4 + r * sz * 0.3, sz * 0.26, sz * 0.2);
      ctx.rect(cx - sz * 0.6, cy + sz * 0.25, sz * 1.2, sz * 0.2); ctx.fill();
    } else if (kind === 'sound') {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(cx - sz * 0.75, cy - sz * 0.28); ctx.lineTo(cx - sz * 0.35, cy - sz * 0.28); ctx.lineTo(cx + sz * 0.1, cy - sz * 0.7);
      ctx.lineTo(cx + sz * 0.1, cy + sz * 0.7); ctx.lineTo(cx - sz * 0.35, cy + sz * 0.28); ctx.lineTo(cx - sz * 0.75, cy + sz * 0.28); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = sz * 0.13;
      if (Sound.muted) {
        ctx.strokeStyle = '#ff5d5d'; ctx.beginPath(); ctx.moveTo(cx + sz * 0.35, cy - sz * 0.3); ctx.lineTo(cx + sz * 0.85, cy + sz * 0.3);
        ctx.moveTo(cx + sz * 0.85, cy - sz * 0.3); ctx.lineTo(cx + sz * 0.35, cy + sz * 0.3); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(cx + sz * 0.15, cy, sz * 0.42, -0.8, 0.8); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + sz * 0.15, cy, sz * 0.78, -0.8, 0.8); ctx.stroke();
      }
    } else if (kind === 'power') {
      ctx.strokeStyle = col; ctx.lineWidth = sz * 0.16;
      ctx.beginPath(); ctx.arc(cx, cy + sz * 0.08, sz * 0.62, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - sz * 0.8); ctx.lineTo(cx, cy - sz * 0.05); ctx.stroke();
    } else if (kind === 'back') {
      ctx.strokeStyle = col; ctx.lineWidth = sz * 0.2;
      ctx.beginPath(); ctx.moveTo(cx + sz * 0.6, cy - sz * 0.6); ctx.lineTo(cx - sz * 0.4, cy); ctx.lineTo(cx + sz * 0.6, cy + sz * 0.6); ctx.stroke();
    }
    ctx.restore();
  }
  function menuButton(label, sub, icon, x, y, w, h, ui, fn, accent, big) {
    const hov = over(x, y, w, h);
    ctx.save();
    const cx = x + w / 2, cy = y + h / 2, sc = 1 + (hov ? 0.035 : 0) + (big ? 0.012 * Math.sin(tAnim * 3) : 0);
    ctx.translate(cx, cy - (hov ? 3 * ui : 0)); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    if (hov) { ctx.shadowColor = css(accent, 0.8); ctx.shadowBlur = 22 * ui; }
    rr(ctx, x, y, w, h, 16 * ui);
    if (big) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#ff2d95'); g.addColorStop(1, '#ffb300');
      ctx.fillStyle = g;
    } else ctx.fillStyle = hov ? 'rgba(26,36,70,0.94)' : 'rgba(8,12,24,0.78)';
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.lineWidth = (hov ? 3 : 2) * ui; ctx.strokeStyle = big ? '#ffffff' : (hov ? css(accent, 1) : 'rgba(255,255,255,0.28)'); ctx.stroke();
    const br = h * 0.36, bx = x + h * 0.55, by = cy;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU);
    ctx.fillStyle = big ? 'rgba(0,0,0,0.28)' : css(accent, hov ? 0.4 : 0.24); ctx.fill();
    ctx.lineWidth = 2 * ui; ctx.strokeStyle = big ? 'rgba(255,255,255,0.8)' : css(accent, 0.9); ctx.stroke();
    drawIcon(icon, bx, by, br * 0.62, big ? '#ffffff' : css(mixc(accent, [255, 255, 255], 0.45)));
    txt(label, x + h * 1.1, y + h * (sub ? 0.46 : 0.62), (big ? 28 : 21) * ui, '#ffffff', 'left', '900');
    if (sub) txt(sub, x + h * 1.1, y + h * 0.8, 12.5 * ui, big ? 'rgba(255,255,255,0.92)' : '#9fb4d6', 'left', 'bold', false);
    const ax = x + w - 26 * ui, ay = cy, as = (hov ? 9 : 7) * ui;
    ctx.fillStyle = big ? '#ffffff' : css(accent, hov ? 1 : 0.7);
    ctx.beginPath(); ctx.moveTo(ax - as * 0.5, ay - as); ctx.lineTo(ax + as * 0.7, ay); ctx.lineTo(ax - as * 0.5, ay + as); ctx.closePath(); ctx.fill();
    ctx.restore();
    hit(x, y, w, h, fn);
  }
  function iconButton(icon, cx, cy, r, ui, fn, accent, tip) {
    const hov = over(cx - r, cy - r, r * 2, r * 2);
    ctx.save();
    if (hov) { ctx.shadowColor = css(accent, 0.8); ctx.shadowBlur = 18 * ui; }
    ctx.beginPath(); ctx.arc(cx, cy, r * (hov ? 1.08 : 1), 0, TAU);
    ctx.fillStyle = hov ? 'rgba(26,36,70,0.94)' : 'rgba(8,12,24,0.78)'; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.lineWidth = 2 * ui; ctx.strokeStyle = hov ? css(accent, 1) : 'rgba(255,255,255,0.3)'; ctx.stroke();
    drawIcon(icon, cx, cy, r * 0.52, css(mixc(accent, [255, 255, 255], hov ? 0.2 : 0.5)));
    ctx.restore();
    if (hov && tip) txt(tip, cx, cy - r - 10 * ui, 13 * ui, '#ffffff', 'center', 'bold', false);
    hit(cx - r, cy - r, r * 2, r * 2, fn);
  }
  function drawMenu(ui) {
    dim(0.5);
    drawTitle(ui, H * 0.2);
    txt('CARRERA ARCADE CONTRA EL RELOJ', W / 2, H * 0.2 + 36 * ui, 17 * ui, '#cfe0ff', 'center', 'bold');
    const bw = 400 * ui, bx = W / 2 - bw / 2, y0 = H * 0.33, hb = 72 * ui, hs = 58 * ui, gap = 12 * ui;
    menuButton('JUGAR', 'Mapa: ' + curMap.name + (best > 0 ? '  ·  Récord: ' + thousands(best) : ''), 'flag', bx, y0, bw, hb, ui, startGame, [255, 210, 63], true);
    let y = y0 + hb + gap + 6 * ui;
    menuButton('GARAJE', 'Coche: ' + SKINS[skinIdx].name, 'car', bx, y, bw, hs, ui, openGarage, [0, 200, 255]); y += hs + gap;
    menuButton('MAPAS', 'Mapa actual: ' + curMap.name, 'map', bx, y, bw, hs, ui, openMaps, [70, 225, 130]); y += hs + gap;
    menuButton('CONTROLES', 'Cómo se juega', 'keys', bx, y, bw, hs, ui, openControls, [255, 165, 50]);
    const r = 24 * ui;
    iconButton('sound', 14 * ui + r + 10 * ui, H - r - 22 * ui, r, ui, toggleSound, [180, 120, 255], Sound.muted ? 'Sonido: NO' : 'Sonido: SÍ');
    iconButton('power', W - 14 * ui - r - 10 * ui, H - r - 22 * ui, r, ui, quitGame, [255, 90, 90], 'Salir');
    if (!focused()) txt('Haz clic en el juego para activar el teclado', W / 2, H - 22 * ui, 16 * ui, '#ff9d2e', 'center', 'bold', false);
  }
  // ---- Pantalla de controles ----------------------------------------------
  function keycap(label, x, y, ui) {
    const fs = 14 * ui;
    ctx.font = 'bold ' + fs + 'px "Segoe UI","Helvetica Neue",Arial,sans-serif';
    const tw = (ctx.measureText(label) || { width: 8 * label.length }).width, w = Math.max(30 * ui, tw + 20 * ui), h = 30 * ui;
    rr(ctx, x, y + 3 * ui, w, h, 7 * ui); ctx.fillStyle = '#080c1a'; ctx.fill();
    rr(ctx, x, y, w, h, 7 * ui); ctx.fillStyle = '#2b3558'; ctx.fill();
    ctx.lineWidth = 1.5 * ui; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffd23f'; ctx.fillText(label, x + w / 2, y + h / 2 + ui);
    return w;
  }
  function keyRow(keys, desc, x, y, descX, ui) {
    let cx = x;
    for (let i = 0; i < keys.length; i++) {
      if (i) { txt('/', cx + 7 * ui, y + 21 * ui, 14 * ui, '#7f95b8', 'center', 'bold', false); cx += 14 * ui; }
      cx += keycap(keys[i], cx, y, ui);
    }
    txt(desc, descX, y + 21 * ui, 14.5 * ui, '#ffffff', 'left', 'bold', false);
  }
  function drawControls(ui) {
    dim(0.74);
    txt('CONTROLES', W / 2, H * 0.12, 56 * ui, '#ffffff', 'center', '900');
    const cw = 430 * ui, gap = 24 * ui, x1 = W / 2 - cw - gap / 2, x2 = W / 2 + gap / 2, y0 = H * 0.19, rh = 40 * ui;
    // Conducción
    panel(x1, y0, cw, 40 * ui + 4 * rh + 14 * ui, ui);
    txt('CONDUCCIÓN', x1 + 22 * ui, y0 + 28 * ui, 15 * ui, '#2fd8ff', 'left', '900');
    const dr = [[['↑', 'W'], 'Acelerar (la cámara se aleja)'], [['↓', 'S'], 'Frenar (la cámara se acerca)'], [['←', '→', 'A', 'D'], 'Girar'], [['ESPACIO', 'SHIFT'], 'Nitro (gasta la barra azul)']];
    for (let i = 0; i < dr.length; i++) keyRow(dr[i][0], dr[i][1], x1 + 22 * ui, y0 + 44 * ui + i * rh, x1 + 214 * ui, ui);
    // Consejos
    const ty = y0 + 40 * ui + 4 * rh + 14 * ui + 16 * ui, th = 110 * ui, jh = ty + th - y0;
    panel(x1, ty, cw, th, ui);
    txt('CONSEJOS', x1 + 22 * ui, ty + 28 * ui, 15 * ui, '#7dff6a', 'left', '900');
    const tips = ['Cruza los checkpoints para ganar tiempo', 'Esquiva el tráfico; rozar coches da puntos y nitro', 'Salirte de la carretera te frena'];
    for (let i = 0; i < tips.length; i++) txt('•  ' + tips[i], x1 + 22 * ui, ty + 54 * ui + i * 21 * ui, 13.5 * ui, '#cfe0ff', 'left', 'bold', false);
    // Juego
    const jr = [[['P'], 'Pausa'], [['R'], 'Reiniciar la partida'], [['Q'], 'Volver al menú'], [['M'], 'Sonido sí / no'], [['C'], 'Garaje (skins)'], [['N'], 'Mapas'], [['ESC'], 'Pausa / cerrar el juego']];
    panel(x2, y0, cw, jh, ui);
    txt('JUEGO', x2 + 22 * ui, y0 + 28 * ui, 15 * ui, '#ffb347', 'left', '900');
    const rh2 = Math.min(rh, (jh - 54 * ui) / jr.length);
    for (let i = 0; i < jr.length; i++) keyRow(jr[i][0], jr[i][1], x2 + 22 * ui, y0 + 44 * ui + i * rh2, x2 + 120 * ui, ui);
    button('VOLVER', W / 2 - 90 * ui, y0 + jh + 26 * ui, 180 * ui, 42 * ui, ui, closeControls, true);
  }
  function drawGarage(ui) {
    dim(0.74);
    const sk = SKINS[skinIdx];
    txt('GARAJE', W / 2, H * 0.14, 56 * ui, '#ffffff', 'center', '900');
    txt('Elige la pintura de tu coche', W / 2, H * 0.14 + 30 * ui, 16 * ui, '#cfe0ff', 'center', 'bold', false);
    const pw = Math.min(W * 0.26, H * 0.42), by = H * 0.58;
    const g = ctx.createRadialGradient(W / 2, by, 1, W / 2, by, pw * 0.85);
    g.addColorStop(0, css(sk.glow, 0.45)); g.addColorStop(1, css(sk.glow, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(W / 2, by + pw * 0.02, pw * 0.85, pw * 0.16, 0, 0, TAU); ctx.fill();
    const o = skinOpts(sk);
    o.roll = Math.sin(tAnim * 1.2) * 0.03; o.brake = true; o.glow = 0.28;
    drawCar(ctx, W / 2, by + Math.sin(tAnim * 2) * 2 * ui, pw, o);
    const ay = by - pw * 0.38, ax = pw * 0.85;
    arrow(W / 2 - ax, ay, -1, ui, function () { changeSkin(-1); });
    arrow(W / 2 + ax, ay, 1, ui, function () { changeSkin(1); });
    txt(sk.name.toUpperCase(), W / 2, by + 52 * ui, 32 * ui, css(mixc(sk.color, [255, 255, 255], 0.5)), 'center', '900');
    txt(sk.desc, W / 2, by + 80 * ui, 16 * ui, '#cfe0ff', 'center', 'bold', false);
    txt((skinIdx + 1) + ' / ' + SKINS.length, W / 2, by + 104 * ui, 13 * ui, '#9fb4d6', 'center', 'bold', false);
    const sw = 46 * ui, gap = 14 * ui, n = SKINS.length, total = n * sw + (n - 1) * gap, sy0 = H * 0.8;
    for (let i = 0; i < n; i++) {
      const x = W / 2 - total / 2 + i * (sw + gap), s = SKINS[i], sel = i === skinIdx;
      rr(ctx, x, sy0, sw, sw, 10 * ui); ctx.fillStyle = css(s.color); ctx.fill();
      ctx.fillStyle = css(s.stripe); ctx.fillRect(x + sw * 0.42, sy0 + 4 * ui, sw * 0.16, sw - 8 * ui);
      rr(ctx, x, sy0, sw, sw, 10 * ui); ctx.lineWidth = (sel ? 4 : 1.5) * ui; ctx.strokeStyle = sel ? '#ffd23f' : 'rgba(255,255,255,0.3)'; ctx.stroke();
      hit(x, sy0, sw, sw, function () { if (skinIdx !== i) { skinIdx = i; saveSkin(); } });
    }
    button('LISTO', W / 2 - 80 * ui, sy0 + sw + 20 * ui, 160 * ui, 40 * ui, ui, closeGarage, true);
    txt('← → / A D: cambiar   ·   ENTER / C / ESC: volver', W / 2, H - 18 * ui, 14 * ui, '#9fb4d6', 'center', 'bold', false);
  }
  function polyF(pts, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath(); ctx.fill();
  }
  function drawMapPreview(map, x, y, w, h, ui) {
    const th = map.themes[map.menuTheme], hz = y + h * 0.56, bot = y + h, cx = x + w / 2;
    ctx.save();
    rr(ctx, x, y, w, h, 12 * ui); ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, hz);
    g.addColorStop(0, css(th.skyTop)); g.addColorStop(1, css(th.skyBot));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, hz - y + 1);
    if (th.stars > 0.1) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, th.stars) * 0.8 + ')'; for (let i = 0; i < 26; i++) ctx.fillRect(x + hash1(i, 5) * w, y + hash1(i, 9) * (hz - y) * 0.8, 1.6 * ui, 1.6 * ui); }
    ctx.fillStyle = css(th.sun); ctx.beginPath(); ctx.arc(x + w * 0.76, y + h * th.sunY * 0.85, h * 0.05, 0, TAU); ctx.fill();
    // siluetas del fondo
    const sil = function (col, hMax, seed, cwid, lit) {
      ctx.fillStyle = css(col); ctx.beginPath();
      if (map.bg === 'city') {
        for (let bx = x - 4; bx < x + w; bx += cwid) ctx.rect(bx, hz - hMax * (0.25 + 0.75 * hash1(bx / cwid, seed)), cwid * 0.88, hMax + 2);
        ctx.fill();
        if (lit) {
          ctx.fillStyle = css(lit, 0.6); ctx.beginPath();
          for (let bx = x - 4, bi = 0; bx < x + w; bx += cwid, bi++) {
            const bh = hMax * (0.25 + 0.75 * hash1(bx / cwid, seed));
            for (let r = 0; r < Math.floor(bh / (3.4 * ui)); r++) for (let k = 0; k < 3; k++) if (hash1(bi * 17 + r * 3 + k, seed + 3) < 0.38) ctx.rect(bx + 2 * ui + k * 3.2 * ui, hz - bh + 3 * ui + r * 3.4 * ui, 1.8 * ui, 1.8 * ui);
          }
          ctx.fill();
        }
      } else {
        ctx.moveTo(x, hz + 2);
        for (let bx = x; bx <= x + w; bx += 6) ctx.lineTo(bx, hz - hMax * (map.bg === 'hills' ? 0.45 : 1) * (0.55 + 0.45 * Math.sin(bx * 0.045 / ui + seed) * Math.sin(bx * 0.013 / ui + seed * 2)));
        ctx.lineTo(x + w, hz + 2); ctx.closePath(); ctx.fill();
      }
    };
    sil(th.m2, h * 0.3, 3, 15 * ui, th.neon);
    sil(th.m1, h * 0.2, 11, 12 * ui, [255, 214, 140]);
    ctx.fillStyle = css(th.grassL); ctx.fillRect(x, hz, w, bot - hz);
    // carretera en perspectiva
    const rb = w * 0.5, rt = w * 0.03;
    const U1 = function (z) { return (1 / z - 1 / 16) / (1 - 1 / 16); };
    const hwAt = function (u) { return rt + (rb - rt) * u; };
    if (map.runoff > 0) {
      const k = 1 + map.rumble * 2 + map.runoff;
      polyF([cx - rb * k, bot, cx - rt * k, hz, cx + rt * k, hz, cx + rb * k, bot], css(th.run));
    }
    const k2 = 1 + map.rumble * 2;
    for (let z = 1, i = 0; z < 16; i++) {
      const z2 = z * 1.28, ua = U1(z), ub = U1(z2), ya = hz + (bot - hz) * ua, yb = hz + (bot - hz) * ub;
      const wa = hwAt(ua), wb = hwAt(ub), rc = i % 2 ? th.rumbleD : th.rumbleL;
      polyF([cx - wa * k2, ya, cx - wa, ya, cx - wb, yb, cx - wb * k2, yb], css(rc));
      polyF([cx + wa, ya, cx + wa * k2, ya, cx + wb * k2, yb, cx + wb, yb], css(rc));
      z = z2;
    }
    polyF([cx - rb, bot, cx + rb, bot, cx + rt, hz, cx - rt, hz], css(th.roadL));
    if (map.edge) {
      polyF([cx - rb * 0.95, bot, cx - rb * 0.915, bot, cx - rt * 0.915, hz, cx - rt * 0.95, hz], css(th.neon));
      polyF([cx + rb * 0.915, bot, cx + rb * 0.95, bot, cx + rt * 0.95, hz, cx + rt * 0.915, hz], css(th.neon));
    }
    if (map.dash) {
      for (let z = 1.1; z < 15; z += 2.2) {
        const ua = U1(z), ub = U1(z + 0.9), ya = hz + (bot - hz) * ua, yb = hz + (bot - hz) * ub;
        [-1, 1].forEach(function (sd) {
          const xa = cx + sd * hwAt(ua) / 3, xb = cx + sd * hwAt(ub) / 3, da = hwAt(ua) * 0.012, db = hwAt(ub) * 0.012;
          polyF([xa - da, ya, xa + da, ya, xb + db, yb, xb - db, yb], css(th.lane));
        });
      }
    } else {
      // parrilla de salida y línea de meta
      const ua = U1(1.4), ub = U1(1.9), ya = hz + (bot - hz) * ua, yb = hz + (bot - hz) * ub, wa = hwAt(ua), wb = hwAt(ub);
      for (let i = 0; i < 12; i++) {
        polyF([cx - wa + (2 * wa * i) / 12, ya, cx - wa + (2 * wa * (i + 1)) / 12, ya, cx - wb + (2 * wb * (i + 1)) / 12, yb, cx - wb + (2 * wb * i) / 12, yb], i % 2 ? '#f4f4f4' : '#15151a');
      }
    }
    // elementos laterales
    for (let z = 1.5, i = 0; z < 16; z *= 1.55, i++) {
      const u = U1(z), yy = hz + (bot - hz) * u, sz = 14 * ui + 150 * ui * u * u;
      [-1, 1].forEach(function (sd) {
        const px = cx + sd * (hwAt(u) * (map.id === 'f1' ? 1.5 : map.id === 'city' ? 1.55 : 1.4) + sz * 0.6);
        if (map.id === 'highway') {
          polyF([px - sz * 0.4, yy, px + sz * 0.4, yy, px, yy - sz * 1.3], css(i % 2 ? [24, 100, 52] : [32, 124, 64]));
          ctx.fillStyle = css([84, 56, 34]); ctx.fillRect(px - sz * 0.05, yy, sz * 0.1, sz * 0.2);
        } else if (map.id === 'city') {
          const bw = sz * 0.8, bh = sz * (1.6 + 0.5 * hash1(i, sd + 3));
          ctx.fillStyle = css([30, 24, 66]); ctx.fillRect(px - bw / 2, yy - bh, bw, bh);
          ctx.fillStyle = css(th.neon); ctx.fillRect(px - bw / 2, yy - bh, bw, Math.max(1, bw * 0.05));
          ctx.fillStyle = css([255, 214, 140], 0.8);
          for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 3; c2++) if (hash1(r * 5 + c2, i + sd) < 0.5) ctx.fillRect(px - bw / 2 + bw * 0.14 + c2 * bw * 0.28, yy - bh + bh * 0.1 + r * bh * 0.2, bw * 0.14, bh * 0.08);
        } else {
          ctx.fillStyle = css([20, 20, 24]); ctx.fillRect(px - sz * 0.5, yy - sz * 0.3, sz, sz * 0.3);
          ctx.fillStyle = css(i % 2 ? [240, 240, 240] : [222, 36, 40]); ctx.fillRect(px - sz * 0.5, yy - sz * 0.3, sz, sz * 0.07);
          if (i % 2 === 0) {
            const gx = px + sd * sz * 1.1, gw = sz * 1.4;
            ctx.fillStyle = css([112, 116, 132]); ctx.fillRect(gx - gw / 2, yy - sz * 0.9, gw, sz * 0.9);
            ctx.fillStyle = css(CROWD[(i * 2 + (sd > 0 ? 1 : 0)) % CROWD.length]); ctx.fillRect(gx - gw / 2, yy - sz * 0.75, gw, sz * 0.12); ctx.fillRect(gx - gw / 2, yy - sz * 0.45, gw, sz * 0.12);
          }
        }
      });
    }
    ctx.restore();
  }
  function drawMiniTrack(pts, x, y, size, ui) {
    if (!pts || !pts.length) return;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const path = function () { ctx.beginPath(); for (let i = 0; i < pts.length; i++) { const px = x + 6 * ui + pts[i][0] * (size - 12 * ui), py = y + 6 * ui + pts[i][1] * (size - 12 * ui); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.closePath(); };
    path(); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 5 * ui; ctx.stroke();
    path(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.4 * ui; ctx.stroke();
    ctx.restore();
  }
  function drawMaps(ui) {
    dim(0.6);
    txt('MAPAS', W / 2, H * 0.12, 56 * ui, '#ffffff', 'center', '900');
    txt('Elige dónde correr', W / 2, H * 0.12 + 28 * ui, 16 * ui, '#cfe0ff', 'center', 'bold', false);
    const cw = 340 * ui, ch = 392 * ui, gap = 26 * ui, total = MAPS.length * cw + (MAPS.length - 1) * gap, y0 = H * 0.19;
    for (let i = 0; i < MAPS.length; i++) {
      const m = MAPS[i], x = W / 2 - total / 2 + i * (cw + gap), sel = i === mapIdx;
      rr(ctx, x, y0, cw, ch, 16 * ui); ctx.fillStyle = sel ? 'rgba(10,14,30,0.9)' : 'rgba(8,12,24,0.68)'; ctx.fill();
      drawMapPreview(m, x + 12 * ui, y0 + 12 * ui, cw - 24 * ui, 170 * ui, ui);
      drawMiniTrack(m.pts, x + cw - 12 * ui - 62 * ui, y0 + 12 * ui + 170 * ui - 62 * ui - 4 * ui, 62 * ui, ui);
      if (sel) {
        rr(ctx, x + 22 * ui, y0 + 22 * ui, 118 * ui, 22 * ui, 11 * ui); ctx.fillStyle = '#ffd23f'; ctx.fill();
        txt('SELECCIONADO', x + 22 * ui + 59 * ui, y0 + 38 * ui, 11 * ui, '#101018', 'center', '900', false);
      }
      txt(m.name.toUpperCase(), x + cw / 2, y0 + 226 * ui, 26 * ui, sel ? '#ffd23f' : '#ffffff', 'center', '900');
      txt(m.desc[0], x + cw / 2, y0 + 250 * ui, 13 * ui, '#cfe0ff', 'center', 'bold', false);
      txt(m.desc[1], x + cw / 2, y0 + 268 * ui, 13 * ui, '#9fb4d6', 'center', 'bold', false);
      const rows = [
        ['Longitud', (m.len * 0.00625 / 1000).toFixed(1) + ' km'],
        ['Dificultad', '★★★'.slice(0, m.diff) + '☆☆☆'.slice(0, 3 - m.diff)],
        ['Ambiente', m.ambient],
        ['Récord', thousands(sel ? best : (bests[m.id] || 0))]
      ];
      for (let r = 0; r < rows.length; r++) {
        txt(rows[r][0], x + 24 * ui, y0 + (302 + r * 22) * ui, 14 * ui, '#9fb4d6', 'left', 'bold', false);
        txt(rows[r][1], x + cw - 24 * ui, y0 + (302 + r * 22) * ui, 15 * ui, r === 3 ? '#ffd23f' : '#ffffff', 'right', '900', false);
      }
      rr(ctx, x, y0, cw, ch, 16 * ui); ctx.lineWidth = (sel ? 4 : over(x, y0, cw, ch) ? 3 : 1.5) * ui; ctx.strokeStyle = sel ? '#ffd23f' : over(x, y0, cw, ch) ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)'; ctx.stroke();
      hit(x, y0, cw, ch, function () { if (mapIdx !== i) selectMap(i); });
    }
    button('LISTO', W / 2 - 80 * ui, y0 + ch + 20 * ui, 160 * ui, 40 * ui, ui, closeMaps, true);
    txt('← → / A D: cambiar   ·   ENTER / N / ESC: volver', W / 2, H - 18 * ui, 14 * ui, '#9fb4d6', 'center', 'bold', false);
  }
  function drawPause(ui) {
    dim(0.6);
    txt('PAUSA', W / 2, H * 0.42, 90 * ui, '#ffffff', 'center', '900');
    txt('P / ENTER: continuar  ·  R: reiniciar  ·  Q: menú  ·  ESC: salir', W / 2, H * 0.42 + 46 * ui, 18 * ui, '#cfe0ff', 'center', 'bold', false);
    const by = H * 0.42 + 76 * ui;
    button('CONTINUAR  [P]', W / 2 - 267 * ui, by, 170 * ui, 40 * ui, ui, resumeGame, true);
    button('REINICIAR  [R]', W / 2 - 85 * ui, by, 170 * ui, 40 * ui, ui, startGame);
    button('MENÚ  [Q]', W / 2 + 97 * ui, by, 170 * ui, 40 * ui, ui, goMenu);
    if (!focused()) txt('Haz clic en esta pantalla para recuperar el teclado', W / 2, by + 78 * ui, 18 * ui, '#ff9d2e', 'center', 'bold', false);
  }
  function drawOver(ui) {
    dim(0.62);
    txt('TIEMPO AGOTADO', W / 2, H * 0.3, Math.min(80 * ui, W / 10), '#ff5d5d', 'center', '900');
    const pw = 400 * ui, ph = 168 * ui, px = W / 2 - pw / 2, py = H * 0.3 + 30 * ui;
    panel(px, py, pw, ph, ui);
    const rows = [['Puntuación', thousands(score())], ['Distancia', (dist / 1000).toFixed(2) + ' km'], ['Vueltas', String(lap)], ['Adelantamientos', String(overtakes)]];
    for (let i = 0; i < rows.length; i++) {
      txt(rows[i][0], px + 26 * ui, py + (42 + i * 34) * ui, 17 * ui, '#9fb4d6', 'left', 'bold', false);
      txt(rows[i][1], px + pw - 26 * ui, py + (42 + i * 34) * ui, 20 * ui, '#ffffff', 'right', '900');
    }
    if (newRecord) txt('¡NUEVO RÉCORD!', W / 2, py + ph + 40 * ui, 30 * ui, '#ffd23f', 'center', '900');
    else txt('Récord: ' + thousands(best), W / 2, py + ph + 36 * ui, 18 * ui, '#ffd23f', 'center', 'bold', false);
    button('GARAJE  [C]', W / 2 - 235 * ui, py + ph + 104 * ui, 150 * ui, 38 * ui, ui, openGarage);
    button('MAPAS  [N]', W / 2 - 75 * ui, py + ph + 104 * ui, 150 * ui, 38 * ui, ui, openMaps);
    button('MENÚ  [Q]', W / 2 + 85 * ui, py + ph + 104 * ui, 150 * ui, 38 * ui, ui, goMenu, true);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(tAnim * 4);
    txt('ENTER / clic: jugar de nuevo  ·  Q: menú  ·  ESC: salir', W / 2, py + ph + 84 * ui, 20 * ui, '#ffffff', 'center', 'bold');
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------
  //  Render principal
  // ------------------------------------------------------------------
  function render() {
    if (W < 10 || H < 10) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    cur = themeT >= 1 ? themeTo : blendTheme(themeFrom, themeTo, themeT * themeT * (3 - 2 * themeT));
    C = {
      roadL: css(cur.roadL), roadD: css(cur.roadD), grassL: css(cur.grassL), grassD: css(cur.grassD),
      rumbleL: css(cur.rumbleL), rumbleD: css(cur.rumbleD), lane: css(cur.lane), fog: css(cur.fog),
      run: css(cur.run), runD: css(shade(cur.run, 0.9)), edge: css(cur.neon)
    };
    FOG = cur.fog; DIM = 1 - 0.4 * cur.night;
    const ui = U.limit(Math.min(W / 1280, H / 720), 0.6, 2);
    const sx = shake > 0.3 ? (Math.random() * 2 - 1) * shake : 0, sy = shake > 0.3 ? (Math.random() * 2 - 1) * shake : 0;
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground();
    drawWorld();
    ctx.restore();
    postFX();
    hits.length = 0;
    if (state !== 'menu' && state !== 'garage' && state !== 'maps' && state !== 'controls') drawHUD(ui);
    if (state === 'menu') drawMenu(ui);
    else if (state === 'garage') drawGarage(ui);
    else if (state === 'maps') drawMaps(ui);
    else if (state === 'controls') drawControls(ui);
    else if (state === 'pause') drawPause(ui);
    else if (state === 'over') drawOver(ui);
    let hov = false;
    for (let i = 0; i < hits.length; i++) if (over(hits[i].x, hits[i].y, hits[i].w, hits[i].h)) { hov = true; break; }
    canvas.style.cursor = hov ? 'pointer' : 'default';
  }
  function audioFrame() {
    if (!Sound.ac) return;
    const sp = speed / maxSpeed, gi = gearInfo();
    const freq = 55 + gi.rpm * 105 + (gi.gear - 1) * 9;
    let vol = 0.05 + 0.03 * Math.min(sp, 1.2) + (keys.up ? 0.015 : 0);
    if (state === 'pause') vol = 0; else if (state === 'menu' || state === 'garage' || state === 'maps' || state === 'controls') vol = 0.02;
    const wind = (state === 'play' || state === 'menu' || state === 'garage' || state === 'maps' || state === 'controls') ? Math.min(0.1, sp * 0.08 + (nitroOn ? 0.05 : 0)) : 0;
    Sound.update(freq, vol, wind, 500 + sp * 1200);
  }

  // ------------------------------------------------------------------
  //  Bucle principal
  // ------------------------------------------------------------------
  function frame(now) {
    if (destroyed) return;
    raf = window.requestAnimationFrame(frame);
    try {
      let dt = (now - last) / 1000; last = now;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.25) dt = 0.25;
      if ((state === 'play' || state === 'countdown') && !focused()) pauseGame();
      if (state === 'pause') acc = 0;
      else {
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard < 10) { tick(STEP); acc -= STEP; guard++; }
        if (guard >= 10) acc = 0;
      }
      render();
      audioFrame();
    } catch (err) {
      console.error('[Turbo Highway] Error inesperado:', err);
      destroy();
    }
  }

  // ------------------------------------------------------------------
  //  Entrada
  // ------------------------------------------------------------------
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'nitro', ShiftLeft: 'nitro', ShiftRight: 'nitro'
  };
  function onKeyDown(e) {
    const code = e.code, mapped = KEYMAP[code];
    const special = code === 'Enter' || code === 'NumpadEnter' || code === 'Escape' || code === 'KeyP' || code === 'KeyM' || code === 'KeyR' || code === 'KeyC' || code === 'KeyN' || code === 'KeyQ';
    if (!mapped && !special) return;
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    Sound.init(); Sound.resume();
    if (state === 'garage') {
      if (!e.repeat) {
        if (mapped === 'left') changeSkin(-1);
        else if (mapped === 'right') changeSkin(1);
        else if (code === 'Space') closeGarage();
      }
      if (mapped) return;
    }
    if (state === 'controls') {
      if (!e.repeat && (code === 'Enter' || code === 'NumpadEnter' || code === 'Escape' || code === 'Space')) closeControls();
      return;
    }
    if (state === 'maps') {
      if (!e.repeat) {
        if (mapped === 'left') changeMap(-1);
        else if (mapped === 'right') changeMap(1);
        else if (code === 'Space') closeMaps();
      }
      if (mapped) return;
    }
    if (mapped) {
      if (code === 'Space' && (state === 'menu' || state === 'over')) { startGame(); return; }
      if (code === 'Space' && state === 'pause') { resumeGame(); return; }
      keys[mapped] = true;
      return;
    }
    if (e.repeat) return;
    switch (code) {
      case 'Enter': case 'NumpadEnter':
        if (state === 'menu' || state === 'over') startGame(); else if (state === 'pause') resumeGame(); else if (state === 'garage') closeGarage(); else if (state === 'maps') closeMaps();
        break;
      case 'KeyN':
        if (state === 'menu' || state === 'over') openMaps(); else if (state === 'maps') closeMaps();
        break;
      case 'KeyC':
        if (state === 'menu' || state === 'over') openGarage(); else if (state === 'garage') closeGarage();
        break;
      case 'Escape':
        if (state === 'garage') closeGarage(); else if (state === 'maps') closeMaps(); else if (state === 'play' || state === 'countdown') pauseGame(); else destroy();
        break;
      case 'KeyP':
        if (state === 'pause') resumeGame(); else pauseGame();
        break;
      case 'KeyM':
        Sound.toggleMute(); pop(Sound.muted ? 'SONIDO: NO' : 'SONIDO: SÍ', '#9bf6ff');
        break;
      case 'KeyQ':
        goMenu();
        break;
      case 'KeyR':
        if (state !== 'menu' && state !== 'garage' && state !== 'maps') startGame();
        break;
      default: break;
    }
  }
  function onKeyUp(e) {
    const mapped = KEYMAP[e.code];
    if (!mapped) return;
    e.preventDefault(); e.stopPropagation();
    keys[mapped] = false;
  }
  function onBlur() { resetKeysExceptNone(); if (state === 'play' || state === 'countdown') pauseGame(); }
  function pointerPos(e) {
    if (e && typeof e.clientX === 'number') {
      const rect = (canvas.getBoundingClientRect && canvas.getBoundingClientRect()) || null;
      const rw = rect && rect.width ? rect.width : W, rh = rect && rect.height ? rect.height : H;
      return [(e.clientX - (rect ? rect.left : 0)) * (W / rw), (e.clientY - (rect ? rect.top : 0)) * (H / rh)];
    }
    return [-1, -1];
  }
  function onMove(e) { const p = pointerPos(e); mouseX = p[0]; mouseY = p[1]; }
  function onLeave() { mouseX = mouseY = -1; }
  function onPointer(e) {
    try { canvas.focus(); } catch (err) { /* ignorar */ }
    Sound.init(); Sound.resume();
    const pp = pointerPos(e), mx = pp[0], my = pp[1];
    mouseX = mx; mouseY = my;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) { h.fn(); return; }
    }
    if (state === 'over') startGame(); else if (state === 'pause') resumeGame();
  }
  function onVisibility() { if (document.hidden) onBlur(); }

  // ------------------------------------------------------------------
  //  Arranque y limpieza
  // ------------------------------------------------------------------
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { window.cancelAnimationFrame(raf); } catch (e) { /* ignorar */ }
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('mousedown', onPointer);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    Sound.destroy();
    try { overlay.remove(); } catch (e) { /* ignorar */ }
    if (window.__TURBO_GAME__ && window.__TURBO_GAME__.destroy === destroy) { try { delete window.__TURBO_GAME__; } catch (e) { window.__TURBO_GAME__ = null; } }
  }

  MAPS.forEach(function (m) { buildTrack(m); m.pts = mapPts; m.len = trackLength; });
  selectMap(mapIdx, true);
  updateCamera(0);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('mousedown', onPointer);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  window.__TURBO_GAME__ = { destroy: destroy };
  try { canvas.focus(); } catch (e) { /* ignorar */ }
  last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  raf = window.requestAnimationFrame(frame);
  console.log('%c TURBO HIGHWAY %c Haz clic en la pantalla del juego y pulsa ENTER. ESC para salir.',
    'background:#ff2d95;color:#fff;font-weight:bold;padding:3px 6px;border-radius:3px', 'color:#ffd400;font-weight:bold');
})();
