/* renderer.js — costruisce e anima la scena descritta da papera.py (window.__DATI__), con three.js r128.
   Tutto ciò che si vede è funzione del tempo t: lo stesso istante si può ridisegnare quante volte si vuole. */
(function () {
'use strict';

const D = window.__DATI__;
const PIXEL = D.stile === 'pixel';
const P = D.papera, L = D.limone, A = D.ambiente, EV = D.eventi, F = D.fumetto;

// ════════════════════════════ attrezzi ════════════════════════════
const TAU = Math.PI * 2;
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const s01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const smoother = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOutBack = (t, k = 1.9) => { t = clamp(t, 0, 1); const c3 = k + 1; return 1 + c3 * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
function rgb(hex) { const c = new THREE.Color(hex); return [c.r * 255, c.g * 255, c.b * 255]; }
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// rumore a valori 2D, opzionalmente periodico (per texture che si ripetono senza cuciture)
function rumore2(seed) {
  const r = rng(seed), N = 256, v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) v[i] = r();
  return function (x, y, per) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const pp = per || N;
    const m = k => (((k % pp) + pp) % pp) % N;
    const x0 = m(ix), x1 = m(ix + 1), y0 = m(iy), y1 = m(iy + 1);
    const a = v[y0 * N + x0], b = v[y0 * N + x1], c = v[y1 * N + x0], d = v[y1 * N + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(n, x, y, ott, per) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < ott; o++) { s += amp * n(x * f, y * f, per ? per * f : 0); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}
function tela(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ════════════════════════════ renderer, scena, luci ════════════════════════════
const cv = document.getElementById('scena');
const cvF = document.getElementById('fumetto');
const velo = document.getElementById('velo');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !PIXEL, powerPreference: 'high-performance' });
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = A.esposizione;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function texDa(c, colore = true, ripeti = true) {
  const t = new THREE.CanvasTexture(c);
  if (colore) t.encoding = THREE.sRGBEncoding;
  if (ripeti) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

const scena = new THREE.Scene();
// la nebbia lavora dopo la conversione in sRGB: il suo colore va dato così com'è
scena.fog = new THREE.Fog(new THREE.Color(A.orizzonte), A.nebbia[0], A.nebbia[1]);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 320);
const dirSole = new V3(...A.direzione_sole).normalize();

const VS_CIELO = 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// cielo visibile: colori sRGB scritti direttamente, così all'orizzonte combacia con la nebbia
const cielo = new THREE.Mesh(new THREE.SphereGeometry(280, 48, 24), new THREE.ShaderMaterial({
  uniforms: { cZ: { value: new THREE.Color(A.zenit) }, cO: { value: new THREE.Color(A.orizzonte) },
              cS: { value: new THREE.Color(A.sole) }, dS: { value: dirSole } },
  vertexShader: VS_CIELO,
  fragmentShader: `uniform vec3 cZ, cO, cS, dS; varying vec3 vD;
    void main(){ vec3 d = normalize(vD); float h = d.y;
      vec3 c = mix(cO, cZ, pow(smoothstep(0.0, 0.42, h), 0.8));
      float s = max(dot(d, normalize(dS)), 0.0);
      c = mix(c, cS, clamp(pow(s, 5.0) * 0.32 + pow(s, 80.0) * 0.6, 0.0, 1.0) * smoothstep(-0.05, 0.12, h));
      gl_FragColor = vec4(c, 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
}));
cielo.renderOrder = -10;
cielo.frustumCulled = false;
scena.add(cielo);

// ambiente per i riflessi (occhi lucidi, buccia cerata): lo stesso cielo, in luce lineare, più il sole
(function () {
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    uniforms: { cZ: { value: lin(A.zenit) }, cO: { value: lin(A.orizzonte) }, cT: { value: lin(A.terra_lontana) },
                cS: { value: lin(A.luce_sole) }, dS: { value: dirSole } },
    vertexShader: VS_CIELO,
    fragmentShader: `uniform vec3 cZ, cO, cT, cS, dS; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 c = h >= 0.0 ? mix(cO, cZ, pow(smoothstep(0.0, 0.7, h), 0.8)) : mix(cO, cT, smoothstep(0.0, -0.22, h));
        float s = max(dot(d, normalize(dS)), 0.0);
        c += cS * (pow(s, 300.0) * 28.0 + pow(s, 14.0) * 0.55);
        gl_FragColor = vec4(c, 1.0);
        #include <encodings_fragment>
      }`,
    side: THREE.BackSide,
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  scena.environment = pm.fromScene(sc, 0.015).texture;
  pm.dispose();
})();

const sole = new THREE.DirectionalLight(lin(A.luce_sole), A.intensita_sole);
sole.castShadow = true;
sole.shadow.mapSize.set(2048, 2048);
Object.assign(sole.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.2, far: 7 });
sole.shadow.bias = -0.00025;
sole.shadow.normalBias = 0.006;
scena.add(sole, sole.target);
scena.add(new THREE.HemisphereLight(lin(A.cielo_emisfero), lin(A.terra_emisfero), A.intensita_emisfero));
const controluce = new THREE.DirectionalLight(lin('#E6EDFF'), A.intensita_controluce);
controluce.position.set(0.45, 0.6, -1).multiplyScalar(6);
scena.add(controluce);

const U = { tempo: { value: 0 } };   // uniform condivise

// ════════════════════════════ terreno ════════════════════════════
const W_SENT = D.sentiero.larghezza;
const SENT = D.sentiero.punti;

// griglia di distanze dal centro del sentiero, per tenere l'erba fuori dalla terra battuta
const GRIGLIA = (function () {
  const x0 = -14, x1 = 14, z0 = -34, z1 = 5, c = 0.05;
  const nx = Math.ceil((x1 - x0) / c), nz = Math.ceil((z1 - z0) / c);
  const d = new Float32Array(nx * nz).fill(99);
  const R = 1.0, k = Math.ceil(R / c);
  for (let s = 0; s < SENT.length - 1; s++) {
    const [ax, az] = SENT[s], [bx, bz] = SENT[s + 1];
    const ix = Math.floor((ax - x0) / c), iz = Math.floor((az - z0) / c);
    const vx = bx - ax, vz = bz - az, vv = vx * vx + vz * vz || 1;
    for (let j = iz - k - 2; j <= iz + k + 2; j++) {
      if (j < 0 || j >= nz) continue;
      for (let i = ix - k - 2; i <= ix + k + 2; i++) {
        if (i < 0 || i >= nx) continue;
        const px = x0 + (i + 0.5) * c, pz = z0 + (j + 0.5) * c;
        const u = clamp(((px - ax) * vx + (pz - az) * vz) / vv, 0, 1);
        const dd = Math.hypot(px - ax - vx * u, pz - az - vz * u);
        const o = j * nx + i;
        if (dd < d[o]) d[o] = dd;
      }
    }
  }
  return function (x, z) {
    const i = Math.floor((x - x0) / c), j = Math.floor((z - z0) / c);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return 99;
    return d[j * nx + i];
  };
})();

function texPrato() {
  const S = 512, c = tela(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const n = rumore2(D.seme * 13 + 5);
  const c0 = rgb(A.prato_base), c1 = rgb(A.erba_scura), c2 = rgb(A.erba_media), cT = rgb(A.sentiero_scuro);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * 8, v = y / S * 8;
    const a = fbm(n, u, v, 5, 8);
    const b = fbm(n, u * 4 + 17, v * 4 + 3, 3, 32);
    const t = smooth(0.3, 0.72, a);
    let r = lerp(c0[0], c1[0], t), gg = lerp(c0[1], c1[1], t), bb = lerp(c0[2], c1[2], t);
    const t2 = smooth(0.55, 0.85, b) * 0.55;
    r = lerp(r, c2[0], t2); gg = lerp(gg, c2[1], t2); bb = lerp(bb, c2[2], t2);
    const ter = smooth(0.64, 0.82, fbm(n, u + 40, v + 11, 4, 8)) * 0.32;
    r = lerp(r, cT[0], ter); gg = lerp(gg, cT[1], ter); bb = lerp(bb, cT[2], ter);
    const k = 0.84 + 0.3 * hash2(x, y);
    const o = (y * S + x) * 4;
    d[o] = r * k; d[o + 1] = gg * k; d[o + 2] = bb * k; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return texDa(c);
}

function texSentiero(totW, lungTex) {
  const Wp = 256, Hp = 2048, c = tela(Wp, Hp), g = c.getContext('2d');
  const img = g.createImageData(Wp, Hp), d = img.data;
  const n = rumore2(D.seme * 31 + 9);
  const cb = rgb(A.sentiero), cs = rgb(A.sentiero_scuro), cc = rgb(A.sentiero_chiaro), ce = rgb(A.erba_scura);
  const core = W_SENT / totW / 2;
  const perV = Math.round(lungTex / 0.05);       // celle da 5 cm lungo il sentiero, periodiche
  for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) {
    const u = x / Wp, v = y / Hp;
    const X = u * totW / 0.05, Y = v * perV;
    const a = fbm(n, X * 0.5, Y * 0.5, 5, perV * 0.5);
    const b = fbm(n, X * 2 + 31, Y * 2 + 7, 3, perV * 2);
    const du = Math.abs(u - 0.5);
    const bordo = (fbm(n, X * 0.35 + 50, Y * 0.35, 4, perV * 0.35) - 0.5) * 0.16;
    const alfa = 1 - smooth(core - 0.035, core + 0.07, du + bordo);
    // compattata al centro (più chiara), più scura e un po' verde ai bordi
    const centro = 1 - smooth(0.0, core, du);
    let t = smooth(0.32, 0.72, a);
    let r = lerp(cs[0], cb[0], t), gg = lerp(cs[1], cb[1], t), bb = lerp(cs[2], cb[2], t);
    const ch = smooth(0.55, 0.85, b) * 0.5 + centro * 0.25;
    r = lerp(r, cc[0], ch); gg = lerp(gg, cc[1], ch); bb = lerp(bb, cc[2], ch);
    const verde = smooth(core * 0.65, core * 1.05, du + bordo * 0.6) * 0.45;
    r = lerp(r, ce[0], verde); gg = lerp(gg, ce[1], verde); bb = lerp(bb, ce[2], verde);
    const k = 0.86 + 0.26 * hash2(x + 7, y * 3);
    const o = (y * Wp + x) * 4;
    d[o] = r * k; d[o + 1] = gg * k; d[o + 2] = bb * k; d[o + 3] = 255 * alfa;
  }
  g.putImageData(img, 0, 0);
  // sassolini e granelli disegnati sopra (solo dove la terra è piena)
  const r = rng(D.seme * 5 + 77);
  const cp = rgb(A.sassolini);
  const pxPerM = Wp / totW;
  for (let i = 0; i < 2600; i++) {
    const u = 0.5 + (r() - 0.5) * core * 1.75, y = r() * Hp;
    const rad = (0.0012 + Math.pow(r(), 3) * 0.0042) * pxPerM;
    const tinta = 0.82 + r() * 0.25;
    for (const yy of [y, y - Hp, y + Hp]) {
      const x = u * Wp;
      g.save();
      g.translate(x, yy);
      g.rotate(r() * TAU);
      g.scale(1, 0.62 + r() * 0.3);
      g.fillStyle = `rgba(${cp[0] * tinta * 0.62 | 0},${cp[1] * tinta * 0.6 | 0},${cp[2] * tinta * 0.56 | 0},0.55)`;
      g.beginPath(); g.arc(rad * 0.25, rad * 0.35, rad * 1.08, 0, TAU); g.fill();
      g.fillStyle = `rgb(${cp[0] * tinta | 0},${cp[1] * tinta | 0},${cp[2] * tinta | 0})`;
      g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,250,0.35)';
      g.beginPath(); g.arc(-rad * 0.3, -rad * 0.3, rad * 0.4, 0, TAU); g.fill();
      g.restore();
    }
  }
  return texDa(c);
}

function creaTerreno() {
  const tex = texPrato();
  tex.repeat.set(72, 72);
  const g = new THREE.PlaneGeometry(170, 170);
  g.rotateX(-Math.PI / 2);
  const matT = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  // da lontano la trama del terreno si scioglie nel colore medio del prato (niente righe di ripetizione)
  matT.onBeforeCompile = sh => {
    sh.uniforms.uLontano = { value: lin(A.prato_lontano) };
    sh.fragmentShader = 'uniform vec3 uLontano;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, uLontano, smoothstep(9.0, 30.0, length(vViewPosition)));');
  };
  const m = new THREE.Mesh(g, matT);
  m.position.set(0, 0, -40);
  m.receiveShadow = true;
  scena.add(m);

  // nastro del sentiero
  const M = 0.17, totW = W_SENT + 2 * M, lungTex = 6.0;
  const pos = [], uv = [], nor = [], idx = [];
  let acc = 0;
  const nr = rumore2(D.seme * 3 + 1);
  for (let i = 0; i < SENT.length; i++) {
    const a = SENT[Math.max(0, i - 1)], b = SENT[Math.min(SENT.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    if (i > 0) acc += Math.hypot(SENT[i][0] - SENT[i - 1][0], SENT[i][1] - SENT[i - 1][1]);
    const w = totW / 2 * (0.94 + 0.12 * nr(acc * 0.6, 0.5));
    const [px, pz] = SENT[i];
    pos.push(px + nx * w, 0.002, pz + nz * w, px - nx * w, 0.002, pz - nz * w);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, acc / lungTex, 1, acc / lungTex);
  }
  for (let i = 0; i < SENT.length - 1; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const gs = new THREE.BufferGeometry();
  gs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  gs.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  gs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  gs.setIndex(idx);
  const ms = new THREE.MeshStandardMaterial({
    map: texSentiero(totW, lungTex), transparent: true, depthWrite: false, roughness: 0.96,
    polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -3,
  });
  const sent = new THREE.Mesh(gs, ms);
  sent.receiveShadow = true;
  sent.renderOrder = 1;
  scena.add(sent);
}

// colline e filari lontani: sagome morbide che la foschia schiarisce, per dare profondità all'orizzonte
function creaLontananze() {
  const nc = rumore2(D.seme * 59 + 3);
  const cam = D.camera.pos[0];
  function anello(raggio, hMin, hMax, colHex, freq, fase) {
    const N = 220, pos = [], col = [], idx = [];
    const cA = lin(colHex), cB = lin(colHex).multiplyScalar(0.78);
    for (let i = 0; i <= N; i++) {
      const a = lerp(-1.45, 1.45, i / N);
      const h = hMin + (hMax - hMin) * fbm(nc, i / N * freq + fase, fase * 3.1, 4);
      const x = cam[0] + Math.sin(a) * raggio, z = cam[2] - Math.cos(a) * raggio;
      const r2 = raggio * 0.94;
      pos.push(cam[0] + Math.sin(a) * r2, -0.5, cam[2] - Math.cos(a) * r2, x, h, z);
      col.push(cB.r, cB.g, cB.b, cA.r, cA.g, cA.b);
    }
    for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    scena.add(m);
    return (a) => {   // altezza della cresta a un certo angolo
      const i = (a + 1.45) / 2.9 * N;
      return hMin + (hMax - hMin) * fbm(nc, i / N * freq + fase, fase * 3.1, 4);
    };
  }
  anello(160, 2.5, 10, A.colline_lontane, 5, 11.3);
  anello(100, 0.4, 4.2, A.colline, 7, 2.7);
}

// filo d'erba: striscia rastremata e un po' curva, alta 1 (scalata per istanza)
function geoFilo() {
  const seg = 4, pos = [], col = [], nor = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const h = i / seg, w = 0.5 * Math.pow(1 - h, 0.85), z = 0.32 * h * h;
    pos.push(-w, h, z, w, h, z);
    const c = 0.42 + 0.58 * Math.pow(h, 0.8);
    col.push(c, c, c, c, c, c);
    nor.push(-0.2, 1, 0.35, 0.2, 1, 0.35);
  }
  pos.push(0, 1, 0.32); col.push(1, 1, 1); nor.push(0, 1, 0.35);
  for (let i = 0; i < seg - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const a = 2 * (seg - 1);
  idx.push(a, a + 1, 2 * seg);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

const GLSL_VENTO = `
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  {
    float hh = position.y * position.y;
    float wv = sin(uTempo * 1.7 + mvPosition.x * 1.9 + mvPosition.z * 1.3) * 0.65
             + sin(uTempo * 2.9 + mvPosition.x * 4.3 - mvPosition.z * 3.1) * 0.35;
    mvPosition.x += wv * uVento * hh;
    mvPosition.z += wv * uVento * 0.45 * hh;
  }
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;
// luce uguale sulle due facce di un filo (niente rovescio scuro)
const GLSL_NORMALE_PIATTA = `
  float faceDirection = 1.0;
  vec3 normal = normalize( vNormal );
  vec3 geometryNormal = normal;
`;

function materialeErba(vento) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTempo = U.tempo;
    sh.uniforms.uVento = { value: vento };
    sh.vertexShader = 'uniform float uTempo;\nuniform float uVento;\n' + sh.vertexShader.replace('#include <project_vertex>', GLSL_VENTO);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', GLSL_NORMALE_PIATTA);
  };
  return m;
}

function creaErba(escludi) {
  const EP = PIXEL ? D.pixel.erba : { quanti: 1, larghezza: 1, vento: 1 };
  const N = Math.round(A.erba_quanti * EP.quanti);
  const inst = new THREE.InstancedMesh(geoFilo(), materialeErba(0.011 * EP.vento), N);
  inst.receiveShadow = true;
  inst.frustumCulled = false;
  const r = rng(D.seme * 101 + 3);
  const nC = rumore2(D.seme * 7 + 1);
  const m4 = new THREE.Matrix4(), q = new Q4(), s = new V3(), p = new V3(), e = new THREE.Euler();
  const cS = lin(A.erba_scura), cM = lin(A.erba_media), cC = lin(A.erba_chiara), cY = lin(A.erba_secca);
  const col = new THREE.Color();
  const cam = D.camera.pos[D.camera.pos.length - 1];
  const r0 = 0.85, r1 = 34, a0 = Math.pow(r0, 0.4), a1 = Math.pow(r1, 0.4);
  const half = W_SENT / 2;
  let k = 0, tent = 0;
  while (k < N && tent < N * 5) {
    tent++;
    const rad = Math.pow(a0 + r() * (a1 - a0), 1 / 0.4);
    const ang = lerp(-0.86, 0.8, r());
    const x = cam[0] + Math.sin(ang) * rad, z = cam[2] - Math.cos(ang) * rad;
    const ds = GRIGLIA(x, z);
    if (ds < half - 0.035) continue;
    const bordo = smooth(half - 0.035, half + 0.16, ds);
    if (r() > 0.25 + 0.75 * bordo) continue;
    if (escludi(x, z)) continue;
    const macchia = fbm(nC, x * 0.9, z * 0.9, 3);
    const lontano = smooth(6, 26, rad);
    const h = lerp(0.026, 0.068, Math.pow(r(), 1.4)) * (0.75 + 0.55 * macchia) * (0.45 + 0.55 * bordo) * (1 + lontano * 0.35);
    const w = lerp(0.0048, 0.0078, r()) * (1 + lontano * 3.0) * EP.larghezza;
    e.set((r() - 0.5) * 0.35, r() * TAU, (r() - 0.5) * 0.35);
    q.setFromEuler(e);
    p.set(x, 0, z);
    s.set(w, h, h);
    m4.compose(p, q, s);
    inst.setMatrixAt(k, m4);
    const t = smooth(0.25, 0.8, macchia + (r() - 0.5) * 0.3);
    col.copy(cS).lerp(cM, t).lerp(cC, Math.pow(r(), 3) * 0.55);
    if (r() < 0.07) col.lerp(cY, 0.6 + r() * 0.3);
    col.multiplyScalar(0.86 + r() * 0.22);
    inst.setColorAt(k, col);
    k++;
  }
  inst.count = k;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scena.add(inst);
}

// margherite: gambo, corolla di petali bianchi con le punte rosate, bottone giallo
function geoCorolla() {
  const n = 15, pos = [], col = [], idx = [];
  const cB = lin(A.margherite), cR = lin(A.margherite_punte);
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + (k % 2) * 0.08, ca = Math.cos(a), sa = Math.sin(a);
    const base = pos.length / 3;
    const len = 0.0085 + (k % 3) * 0.0005, w = 0.0011;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, rr = 0.0022 + t * len, ww = w * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (1 - 0.3 * t);
      const y = 0.0012 * t + 0.0008 * Math.sin(Math.PI * t);
      pos.push(ca * rr - sa * ww, y, sa * rr + ca * ww, ca * rr + sa * ww, y, sa * rr - ca * ww);
      const c = cB.clone().lerp(cR, Math.pow(t, 3) * 0.55);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < 4; i++) { const a2 = base + 2 * i; idx.push(a2, a2 + 2, a2 + 1, a2 + 1, a2 + 2, a2 + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function creaMargherite(escludi) {
  const N = A.margherite_quante;
  const gG = new THREE.CylinderGeometry(0.0006, 0.0008, 1, 5); gG.translate(0, 0.5, 0);
  const steli = new THREE.InstancedMesh(gG, new THREE.MeshStandardMaterial({ color: lin('#5E7F35'), roughness: 0.8 }), N);
  const corolle = new THREE.InstancedMesh(geoCorolla(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), N);
  const gB = new THREE.SphereGeometry(0.0026, 12, 6); gB.scale(1, 0.55, 1);
  const bottoni = new THREE.InstancedMesh(gB, new THREE.MeshStandardMaterial({ color: lin(A.margherite_cuore), roughness: 0.7 }), N);
  for (const m of [steli, corolle, bottoni]) { m.receiveShadow = true; m.frustumCulled = false; }
  const r = rng(D.seme * 211 + 5);
  const cam = D.camera.pos[D.camera.pos.length - 1];
  const m4 = new THREE.Matrix4(), q = new Q4(), qt = new Q4(), e = new THREE.Euler();
  let k = 0, tent = 0;
  while (k < N && tent < N * 40) {
    tent++;
    const rad = 0.5 + Math.pow(r(), 1.6) * 7.5;
    const ang = lerp(-0.8, 0.75, r());
    const x = cam[0] + Math.sin(ang) * rad, z = cam[2] - Math.cos(ang) * rad;
    const ds = GRIGLIA(x, z);
    if (ds < W_SENT / 2 + 0.06 || ds > W_SENT / 2 + 2.2) continue;
    if (escludi(x, z)) continue;
    const h = 0.035 + r() * 0.04, sc = 0.8 + r() * 0.5;
    m4.compose(new V3(x, 0, z), q.identity(), new V3(1, h, 1));
    steli.setMatrixAt(k, m4);
    e.set(-0.25 + (r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5, 'YXZ');
    qt.setFromEuler(e);
    m4.compose(new V3(x, h, z), qt, new V3(sc, sc, sc));
    corolle.setMatrixAt(k, m4);
    m4.compose(new V3(x, h + 0.0012 * sc, z), qt, new V3(sc, sc, sc));
    bottoni.setMatrixAt(k, m4);
    k++;
  }
  for (const m of [steli, corolle, bottoni]) { m.count = k; m.instanceMatrix.needsUpdate = true; scena.add(m); }
}

function creaSassolini(escludi) {
  const r = rng(D.seme * 401 + 9);
  const geos = [0, 1, 2].map(j => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const a = g.attributes.position, rr = rng(D.seme + j * 17);
    for (let i = 0; i < a.count; i++) {
      const f = 0.78 + rr() * 0.32;
      a.setXYZ(i, a.getX(i) * f, a.getY(i) * f * 0.62, a.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  });
  const cBase = lin(A.sassolini), col = new THREE.Color();
  const m4 = new THREE.Matrix4(), q = new Q4(), e = new THREE.Euler();
  for (let j = 0; j < 3; j++) {
    const N = 70;
    const inst = new THREE.InstancedMesh(geos[j], new THREE.MeshStandardMaterial({ roughness: 0.85 }), N);
    inst.receiveShadow = true;
    inst.castShadow = false;
    let k = 0, tent = 0;
    while (k < N && tent < 4000) {
      tent++;
      const s = Math.floor(r() * (SENT.length - 1));
      const [ax, az] = SENT[s], [bx, bz] = SENT[s + 1];
      if (az < -7.5 || az > 2.6) continue;
      const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz) || 1;
      const off = (r() - 0.5) * W_SENT * 0.88, u = r();
      const x = lerp(ax, bx, u) - tz / l * off, z = lerp(az, bz, u) + tx / l * off;
      if (escludi(x, z)) continue;
      const rad = 0.003 + Math.pow(r(), 2.2) * 0.011;
      e.set(r() * 0.4, r() * TAU, r() * 0.4);
      q.setFromEuler(e);
      m4.compose(new V3(x, rad * 0.18, z), q, new V3(rad, rad, rad));
      inst.setMatrixAt(k, m4);
      col.copy(cBase).multiplyScalar(0.72 + r() * 0.36);
      if (r() < 0.3) col.lerp(lin('#BFA88A'), 0.5);
      inst.setColorAt(k, col);
      k++;
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scena.add(inst);
  }
}

// macchie morbide a terra sotto papera e limone (ombra di contatto)
const texAlone = (function () {
  const c = tela(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return texDa(c, false, false);
})();
function alone(opacita) {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texAlone, color: lin('#2D2A1C'), transparent: true, opacity: opacita, depthWrite: false }));
  m.renderOrder = 2;
  scena.add(m);
  return m;
}

// ════════════════════════════ materiale delle piume ════════════════════════════
// Rilievo procedurale in spazio oggetto (niente cuciture UV): ciuffetti morbidi allungati verso la coda.
const GLSL_PIUME = `
  varying vec3 vRest;
  float h3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float piume(vec3 p) {
    vec3 q = p * vec3(150.0, 150.0, 70.0);
    return vn3(q) * 0.55 + vn3(q * 2.07 + 7.1) * 0.3 + vn3(q * 4.3 + 3.7) * 0.15;
  }
  vec3 perturbaPiume(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
    vec3 vSigmaX = vec3(dFdx(surf_pos.x), dFdx(surf_pos.y), dFdx(surf_pos.z));
    vec3 vSigmaY = vec3(dFdy(surf_pos.x), dFdy(surf_pos.y), dFdy(surf_pos.z));
    vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDir;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
`;
// opz: colori (usa i colori per vertice), iride (riflesso cangiante sulle parti verdi e blu),
//      vermicolato (le righine sottili dei fianchi grigi), ruvidezza
function materialePiume(hex, rilievo, opz = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: opz.colori ? 0xffffff : lin(hex), vertexColors: !!opz.colori,
    roughness: opz.ruvidezza ?? 0.8, metalness: 0, envMapIntensity: opz.iride ? 1.25 : 0.9,
  });
  const iride = opz.iride ? 1 : 0, verm = opz.vermicolato ? 1 : 0;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_PIUME)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float hp = piume(vRest);
          vec2 dh = vec2(dFdx(hp), dFdy(hp)) * ${rilievo.toFixed(6)};
          normal = perturbaPiume(-vViewPosition, normal, dh, faceDirection); }
        if (${iride}.0 > 0.5) {
          // le piume del germano cambiano colore con l'angolo: il verde vira al blu-viola di taglio
          vec3 b = diffuseColor.rgb;
          float verde = clamp((b.g - max(b.r, b.b)) * 9.0, 0.0, 1.0);
          float blu = clamp((b.b - max(b.r, b.g)) * 7.0, 0.0, 1.0);
          float taglio = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
          diffuseColor.rgb = mix(b, vec3(0.03, 0.09, 0.32), taglio * 0.7 * verde);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.04, 0.32), taglio * 0.6 * blu);
          diffuseColor.rgb *= 1.0 + 0.25 * (1.0 - taglio) * verde;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { float k = piume(vRest * 0.31 + 11.0); diffuseColor.rgb *= mix(0.94, 1.025, k);
          if (${verm}.0 > 0.5) {
            vec3 b = diffuseColor.rgb;
            float grigio = (1.0 - smoothstep(0.015, 0.05, max(b.r, max(b.g, b.b)) - min(b.r, min(b.g, b.b)))) * smoothstep(0.12, 0.3, b.g);
            float onda = sin(vRest.y * 1150.0 + sin(vRest.z * 260.0) * 2.2 + vn3(vRest * 90.0) * 3.0);
            diffuseColor.rgb *= 1.0 - grigio * 0.16 * smoothstep(0.55, 1.0, onda);
          } }`);
  };
  return m;
}
function conRest(g) { g.setAttribute('aRest', g.attributes.position.clone()); return g; }

// ════════════════════════════ la papera ════════════════════════════
function formaCorpo(x, y, z, C) {
  const dietro = Math.max(0, -z), avanti = Math.max(0, z);
  const Lz = z >= 0 ? C.avanti : C.dietro;
  const w = C.larghezza * (1 - 0.34 * dietro * dietro);
  const h = C.altezza * (1 + 0.05 * avanti) * (1 - 0.2 * dietro * dietro);
  let X = x * w, Y = y * h, Z = z * Lz;
  if (Y < 0) Y *= 0.86;
  Y += C.coda_su * Math.pow(smooth(0.25, 1.0, dietro), 2);
  // petto un po' più pieno in basso davanti
  Z += 0.012 * avanti * Math.max(0, -y) * (1 - y * y);
  return [X, Y, Z];
}
// livrea del germano sul corpo: petto castano, fianchi grigi, dorso bruno, codrione nero
function coloreCorpo(x, y, z, out) {
  const K = P.livrea;
  const petto = smooth(0.12, 0.42, z) * smooth(-0.72, -0.4, y);
  const dorso = smooth(0.35, 0.8, y) * (1 - petto);
  const pancia = smooth(-0.45, -0.85, y) * (1 - petto * 0.6);
  const codrione = smooth(-0.6, -0.85, z);
  out.copy(lin(K.fianchi));
  out.lerp(lin(K.pancia), pancia);
  out.lerp(lin(K.dorso), dorso);
  out.lerp(lin(K.petto), petto);
  out.lerp(lin(K.codrione), codrione);
  return out;
}
function geoCorpo(C) {
  const g = new THREE.SphereGeometry(1, 80, 60), a = g.attributes.position;
  const col = new Float32Array(a.count * 3), c = new THREE.Color();
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    coloreCorpo(x, y, z, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    const [X, Y, Z] = formaCorpo(x, y, z, C); a.setXYZ(i, X, Y, Z);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return conRest(g);
}

// punto e normale sulla superficie del corpo, partendo da coordinate sulla sfera unitaria (lato s)
function superficieCorpo(s, ys, zs, C, p, n) {
  const f = (y, z) => { const x = s * Math.sqrt(Math.max(0.0004, 1 - y * y - z * z)); return formaCorpo(x, y, z, C); };
  const c = f(ys, zs);
  p.set(c[0], c[1], c[2]);
  if (n) {
    const e = 0.002, a = f(ys, zs + e), b = f(ys, zs - e), u = f(ys + e, zs), d = f(ys - e, zs);
    const tz = new V3(a[0] - b[0], a[1] - b[1], a[2] - b[2]), ty = new V3(u[0] - d[0], u[1] - d[1], u[2] - d[2]);
    n.crossVectors(ty, tz).normalize();
    if (n.x * s < 0) n.negate();
  }
}

// ala ripiegata che aderisce al fianco: (u lungo l'ala, dalla spalla alla punta; v dal bordo inferiore in su)
function puntoAla(s, u, v, C, out, nOut) {
  const zs = lerp(0.5, -0.9, u);
  const yTop = lerp(0.68, 0.36, Math.pow(u, 1.15));
  const yBot = lerp(-0.2, 0.2, Math.pow(u, 1.5));
  const ys = lerp(yBot, yTop, v);
  const n = nOut || new V3();
  superficieCorpo(s, ys, zs, C, out, n);
  const tb = smooth(0.0, 0.14, v), tt = Math.sqrt(1 - smooth(0.45, 1.0, v));
  const tf = smooth(0.0, 0.32, u), tk = 1 - smooth(0.78, 1.0, u);
  const t = -0.003 + 0.0122 * tb * tt * tf * tk + 0.0016 * tb * tf;
  out.addScaledVector(n, t);
  return t;
}
function geoGuscioAla(s, C) {
  const NU = 48, NV = 28, pos = [], idx = [];
  const p = new V3();
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    puntoAla(s, i / NU, j / NV, C, p);
    pos.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + NV + 1;
    if (s > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
    else idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return conRest(g);
}
// orienta una piuma (lunga lungo +z, piatta in y) con la base in p, la lunghezza lungo d, la faccia verso n
function orientaPiuma(m, p, d, n) {
  const z = d.clone().normalize();
  const y = n.clone().addScaledVector(z, -n.dot(z)).normalize();
  const x = new V3().crossVectors(y, z);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  m.position.copy(p);
}

function formaTesta(x, y, z, r) {
  let X = x * r * 0.9, Y = y * r * 0.97, Z = z * r * 1.07;
  const guance = Math.exp(-Math.pow((y + 0.28) / 0.45, 2)) * smooth(-0.5, 0.6, z);
  X *= 1 + 0.14 * guance;
  const fronte = Math.exp(-Math.pow((y - 0.5) / 0.38, 2)) * smooth(0.0, 0.9, z);
  Z += r * 0.06 * fronte;
  const nuca = smooth(-0.15, -0.95, z) * smooth(-0.6, 0.4, y);
  Z -= r * 0.04 * nuca;
  Y += r * 0.03 * smooth(-0.2, -0.9, z) * Math.max(0, y);
  return [X, Y, Z];
}
function geoTesta(r) {
  const g = new THREE.SphereGeometry(1, 60, 46), a = g.attributes.position;
  for (let i = 0; i < a.count; i++) { const [X, Y, Z] = formaTesta(a.getX(i), a.getY(i), a.getZ(i), r); a.setXYZ(i, X, Y, Z); }
  g.computeVertexNormals();
  return conRest(g);
}
// punto della superficie della testa nella direzione d (dal centro)
function superficieTesta(d, r) {
  const v = d.clone().normalize(), tmp = new V3();
  for (let k = 0; k < 12; k++) {
    const [X, Y, Z] = formaTesta(v.x, v.y, v.z, r);
    tmp.set(X, Y, Z).normalize();
    v.add(d.clone().normalize().sub(tmp)).normalize();
  }
  const [X, Y, Z] = formaTesta(v.x, v.y, v.z, r);
  return new V3(X, Y, Z);
}

// becco: sezione schiacciata, punta tonda con l'unghia, profilo un po' concavo
function profiloBecco(B, s, inferiore) {
  let hw = B.larghezza * (1 - 0.14 * Math.sin(Math.PI * Math.min(1, s / 0.8)));
  if (inferiore) hw *= 0.9;
  const sT = 0.72;
  const punta = s > sT ? Math.sqrt(Math.max(0, 1 - Math.pow((s - sT) / (1 - sT), 2))) : 1;
  hw *= punta;
  let ht = lerp(B.spessore, B.spessore * 0.5, s) * (inferiore ? 0.72 : 1) * Math.sqrt(punta);
  const cy = -B.curva * Math.sin(Math.PI * s * 0.85) - B.uncino * smooth(0.82, 1.0, s);
  return { hw, ht, cy };
}
function geoBecco(B, inferiore) {
  const NZ = 34, NT = 36, Lb = inferiore ? B.lunghezza * 0.9 : B.lunghezza;
  const pos = [], col = [], idx = [];
  const cBase = lin(P.becco), cSopra = lin(P.becco_chiaro), cSotto = lin(P.becco_scuro), cUnghia = lin(P.unghia);
  const c = new THREE.Color();
  for (let i = 0; i <= NZ; i++) {
    const s = i / NZ, z = s * Lb;
    const { hw, ht, cy } = profiloBecco(B, s, inferiore);
    for (let j = 0; j <= NT; j++) {
      const a = j / NT * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const x = hw * Math.sign(ca) * Math.pow(Math.abs(ca), 0.55);
      let y = ht * Math.sign(sa) * Math.pow(Math.abs(sa), 1.15);
      if (!inferiore) { if (y < 0) y *= 0.26; else y += ht * 0.32 * Math.pow(1 - s, 1.3) * (1 - ca * ca); }
      else { if (y > 0) y *= 0.28; }
      pos.push(x, cy + y - (inferiore ? 0.0012 : 0), z);
      const sopra = Math.max(0, sa), sotto = Math.max(0, -sa);
      c.copy(cBase).lerp(cSopra, sopra * (inferiore ? 0.2 : 0.6)).lerp(cSotto, sotto * 0.7 + (inferiore ? 0.25 : 0));
      const unghia = smooth(0.885, 0.935, s) * (inferiore ? 0.25 : 0.8);
      c.lerp(cUnghia, unghia * (0.35 + 0.65 * sopra));
      const bordo = Math.exp(-Math.pow((s - 0.845) / 0.016, 2)) * sopra * (inferiore ? 0 : 1);
      c.lerp(cSotto, bordo * 0.55);
      // vicino alla testa il becco sfuma appena più chiaro
      c.lerp(cSopra, (1 - smooth(0.0, 0.22, s)) * 0.25);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++) {
    const a = i * (NT + 1) + j, b = a + NT + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// piuma: lente allungata lungo +z (base in 0, punta in lung), sottile in y
// colore(u, out): se c'è, colora la piuma dalla base (u=0) alla punta (u=1)
function geoPiuma(lung, larg, spess, curva, arrotonda = 0.55, colore = null) {
  const g = new THREE.SphereGeometry(1, 22, 12);
  g.rotateX(Math.PI / 2);
  const a = g.attributes.position;
  const col = colore ? new Float32Array(a.count * 3) : null, cc = new THREE.Color();
  for (let i = 0; i < a.count; i++) {
    if (col) { colore((a.getZ(i) + 1) / 2, cc); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const u = (z + 1) / 2, ring = Math.sqrt(Math.max(1e-9, 1 - z * z));
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), arrotonda);
    const X = (x / ring) * larg * prof;
    let Y = (y / ring) * spess * (0.35 + 0.65 * prof) * (1 - 0.45 * u);
    Y += curva * u * u;
    a.setXYZ(i, ring < 1e-4 ? 0 : X, ring < 1e-4 ? curva * u * u : Y, u * lung);
  }
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return conRest(g);
}
function geoEllissoide(ax, ay, az) {
  const g = new THREE.SphereGeometry(1, 40, 28);
  g.scale(ax, ay, az);
  return conRest(g);
}

function geoPalma(Ld) {
  const sh = new THREE.Shape();
  const dita = [[-0.52, 0.86], [0, 1], [0.52, 0.86]].map(([a, l]) => [Math.sin(a) * Ld * l, Math.cos(a) * Ld * l]);
  sh.moveTo(0, -0.007);
  sh.bezierCurveTo(-0.009, -0.005, dita[0][0] * 0.62, dita[0][1] * 0.55, dita[0][0], dita[0][1]);
  sh.quadraticCurveTo((dita[0][0] + dita[1][0]) * 0.5, (dita[0][1] + dita[1][1]) * 0.5 - Ld * 0.17, dita[1][0], dita[1][1]);
  sh.quadraticCurveTo((dita[1][0] + dita[2][0]) * 0.5, (dita[1][1] + dita[2][1]) * 0.5 - Ld * 0.17, dita[2][0], dita[2][1]);
  sh.bezierCurveTo(dita[2][0] * 0.62, dita[2][1] * 0.55, 0.009, -0.005, 0, -0.007);
  const dep = 0.0016, bt = 0.0011;
  const g = new THREE.ExtrudeGeometry(sh, { depth: dep, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.0013, bevelSegments: 2, curveSegments: 14 });
  g.rotateX(Math.PI / 2);
  g.translate(0, dep + bt, 0);
  return { g, dita };
}

function Collo(mat, colore) {
  const nA = 28, nL = 26, nv = nA * (nL + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), rest = new Float32Array(nv * 3), idx = [];
  const col = new Float32Array(nv * 3), cc = new THREE.Color();
  for (let i = 0; i < nA; i++) for (let j = 0; j <= nL; j++) {
    const k = (i * (nL + 1) + j) * 3, a = j / nL * TAU;
    rest[k] = Math.cos(a) * 0.042; rest[k + 1] = Math.sin(a) * 0.042; rest[k + 2] = i / (nA - 1) * 0.11 + 0.37;
    colore(i / (nA - 1), a, cc);
    col[k] = cc.r; col[k + 1] = cc.g; col[k + 2] = cc.b;
  }
  for (let i = 0; i < nA - 1; i++) for (let j = 0; j < nL; j++) {
    const a = i * (nL + 1) + j, b = a + nL + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(pos, 3), aN = new THREE.BufferAttribute(nor, 3);
  aP.setUsage(THREE.DynamicDrawUsage); aN.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', aP); g.setAttribute('normal', aN); g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const C = new V3(), T = new V3(), X = new V3(), Y = new V3(), n = new V3(), p1 = new V3(), p2 = new V3();
  const q = new V3(), gN = new V3(), pp = new V3();
  // vicino alle giunzioni la normale del collo si confonde con quella dell'ellissoide di corpo e testa:
  // così l'ombreggiatura passa da un pezzo all'altro senza la riga della piega
  function fondi(s, fus) {
    if (!fus) return;
    pp.set(C.x + n.x * fus.r, C.y + n.y * fus.r, C.z + n.z * fus.r);
    const wb = 1 - smooth(0.0, 0.42, s), wh = smooth(0.62, 1.0, s);
    if (wb > 0) {
      q.copy(pp).applyMatrix4(fus.corpoInv);
      gN.set(q.x / fus.ac[0], q.y / fus.ac[1], q.z / fus.ac[2]).normalize().applyQuaternion(fus.corpoQ);
      n.lerp(gN, wb * 0.92).normalize();
    }
    if (wh > 0) {
      q.copy(pp).applyMatrix4(fus.testaInv);
      gN.set(q.x / fus.at[0], q.y / fus.at[1], q.z / fus.at[2]).normalize().applyQuaternion(fus.testaQ);
      n.lerp(gN, wh * 0.92).normalize();
    }
  }
  function aggiorna(P0, T0, P3, T3, raggio, fus) {
    const len = P0.distanceTo(P3);
    p1.copy(P0).addScaledVector(T0, len * 0.42);
    p2.copy(P3).addScaledVector(T3, -len * 0.42);
    for (let i = 0; i < nA; i++) {
      const s = i / (nA - 1), u = 1 - s;
      const b0 = u * u * u, b1 = 3 * u * u * s, b2 = 3 * u * s * s, b3 = s * s * s;
      C.set(0, 0, 0).addScaledVector(P0, b0).addScaledVector(p1, b1).addScaledVector(p2, b2).addScaledVector(P3, b3);
      const d0 = -3 * u * u, d1 = 3 * u * u - 6 * u * s, d2 = 6 * u * s - 3 * s * s, d3 = 3 * s * s;
      T.set(0, 0, 0).addScaledVector(P0, d0).addScaledVector(p1, d1).addScaledVector(p2, d2).addScaledVector(P3, d3).normalize();
      X.set(1, 0, 0).addScaledVector(T, -T.x).normalize();
      Y.crossVectors(T, X);
      const r = raggio(s);
      for (let j = 0; j <= nL; j++) {
        const a = j / nL * TAU, ca = Math.cos(a), sa = Math.sin(a);
        n.set(X.x * ca + Y.x * sa, X.y * ca + Y.y * sa, X.z * ca + Y.z * sa);
        const k = (i * (nL + 1) + j) * 3;
        pos[k] = C.x + n.x * r; pos[k + 1] = C.y + n.y * r; pos[k + 2] = C.z + n.z * r;
        if (fus) { fus.r = r; fondi(s, fus); }
        nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
      }
    }
    aP.needsUpdate = true; aN.needsUpdate = true;
  }
  return { mesh, aggiorna };
}

function creaPapera() {
  // livrea del germano reale maschio
  const K = P.livrea;
  const matCorpo = materialePiume('#ffffff', 0.00042, { colori: true, vermicolato: true });
  const matTesta = materialePiume(K.testa, 0.00022, { iride: true, ruvidezza: 0.42 });
  const matCollo = materialePiume('#ffffff', 0.0003, { colori: true, iride: true, ruvidezza: 0.55 });
  const matAla = materialePiume(K.ala, 0.00045);
  const matCopritrici = materialePiume(K.copritrici, 0.0004);
  const matSpecchio = materialePiume('#ffffff', 0.0002, { colori: true, iride: true, ruvidezza: 0.4 });
  const matPrimarie = materialePiume(K.primarie, 0.0003, { ruvidezza: 0.65 });
  const matCoda = materialePiume(K.coda, 0.0003);
  const matRiccio = materialePiume(K.codrione, 0.0002, { ruvidezza: 0.4 });
  // specchio dell'ala: blu cangiante, poi una riga nera e la punta bianca
  const cBlu = lin(K.specchio), cNero = lin(K.codrione), cBianco = lin('#F3F1EA');
  const coloreSpecchio = (u, out) => out.copy(cBlu).lerp(cNero, smooth(0.6, 0.66, u)).lerp(cBianco, smooth(0.76, 0.81, u));
  // collo: castano in basso, collarino bianco (aperto sulla nuca), poi verde
  const cPetto = lin(K.petto), cVerde = lin(K.testa);
  const coloreCollo = (sC, a, out) => {
    const nuca = Math.max(0, Math.sin(a));
    const larg = 0.05 * (1 - 0.65 * nuca), c0 = K.collarino;
    out.copy(cPetto).lerp(cVerde, smooth(c0 + larg, c0 + larg + 0.04, sC));
    const anello = smooth(c0 - larg - 0.02, c0 - larg, sC) * (1 - smooth(c0 + larg, c0 + larg + 0.02, sC));
    return out.lerp(cBianco, anello * (1 - 0.35 * nuca));
  };
  const matBecco = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0, envMapIntensity: 0.9 });
  const matZampe = new THREE.MeshStandardMaterial({ color: lin(P.zampe), roughness: 0.48, envMapIntensity: 0.8 });
  const matPalma = new THREE.MeshStandardMaterial({ color: lin(P.palmatura), roughness: 0.55, envMapIntensity: 0.8 });
  const matUnghie = new THREE.MeshStandardMaterial({ color: lin(P.unghie_zampe), roughness: 0.4 });
  const matOcchio = new THREE.MeshStandardMaterial({ color: lin(P.occhio), roughness: 0.05, metalness: 0, envMapIntensity: 2.2 });
  const matNarici = new THREE.MeshStandardMaterial({ color: lin(P.narici), roughness: 0.6 });
  const matLuce = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  const C = P.corpo, B = P.becco_misure;
  const radice = new THREE.Group(), dondolo = new THREE.Group(), corpo = new THREE.Group();
  radice.add(dondolo); dondolo.add(corpo);
  scena.add(radice);
  corpo.position.set(0, C.centro_y, 0);
  const ombreggia = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const corpoMesh = ombreggia(new THREE.Mesh(geoCorpo(C), matCorpo));
  corpo.add(corpoMesh);

  // ali ripiegate: un guscio che aderisce al fianco con il bordo inferiore netto,
  // una fila di remiganti secondarie a festoni e le primarie che si allungano sopra la coda
  function ala(s) {
    const g = new THREE.Group();
    g.add(ombreggia(new THREE.Mesh(geoGuscioAla(s, C), matAla)));
    const p = new V3(), n = new V3(), pa = new V3(), pb = new V3(), tu = new V3(), tv = new V3();
    const tangenti = (u, v) => {
      puntoAla(s, u + 0.01, v, C, pa); puntoAla(s, u - 0.01, v, C, pb); tu.copy(pa).sub(pb).normalize();
      puntoAla(s, u, v + 0.01, C, pa); puntoAla(s, u, v - 0.01, C, pb); tv.copy(pa).sub(pb).normalize();
    };
    // copritrici: scaglie morbide a metà ala
    for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) {
      const u = 0.2 + k * 0.105 + r * 0.05, v = 0.5 - r * 0.2;
      puntoAla(s, u, v, C, p, n); tangenti(u, v);
      const f = ombreggia(new THREE.Mesh(geoPiuma(0.042, 0.0165, 0.0022, -0.0012, 0.75), matCopritrici));
      orientaPiuma(f, p.addScaledVector(n, -0.0022), tu.clone().addScaledVector(tv, -0.55), n);
      g.add(f);
    }
    // secondarie lungo il bordo inferiore
    for (let k = 0; k < 7; k++) {
      const u = 0.16 + k * 0.088, v = 0.1;
      puntoAla(s, u, v, C, p, n); tangenti(u, v);
      const f = ombreggia(new THREE.Mesh(geoPiuma(0.05 + k * 0.002, 0.0145, 0.0024, -0.0018, 0.65, coloreSpecchio), matSpecchio));
      orientaPiuma(f, p.addScaledVector(n, -0.0006), tu.clone().addScaledVector(tv, -0.42), n);
      g.add(f);
    }
    // primarie
    for (let k = 0; k < 5; k++) {
      const u = 0.52 + k * 0.035, v = 0.5 - k * 0.075;
      puntoAla(s, u, v, C, p, n); tangenti(u, v);
      const f = ombreggia(new THREE.Mesh(geoPiuma(0.092 - k * 0.006, 0.0138, 0.0024, 0.0026, 0.62), matPrimarie));
      orientaPiuma(f, p.addScaledVector(n, 0.0008 - k * 0.0006), tu.clone().addScaledVector(tv, 0.1 - k * 0.07), n);
      g.add(f);
    }
    // perno alla spalla, per sollevare un poco l'ala quando è contenta
    const spalla = new V3();
    puntoAla(s, 0.08, 0.75, C, spalla);
    const perno = new THREE.Group();
    perno.position.copy(spalla);
    g.position.copy(spalla).negate();
    perno.add(g);
    corpo.add(perno);
    return perno;
  }
  const alaS = ala(1), alaD = ala(-1);

  // coda: ventaglio corto rivolto in su
  const coda = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const a = (k - 4) / 4;
    const f = ombreggia(new THREE.Mesh(geoPiuma(0.072 - Math.abs(a) * 0.016, 0.0158, 0.0028, 0.006, 0.6), matCoda));
    f.rotation.order = 'YXZ';
    f.rotation.set(-0.86 - Math.abs(a) * 0.12, Math.PI + a * 0.55, -a * 0.32);
    f.position.set(a * 0.011, -Math.abs(a) * 0.006, 0.004);
    coda.add(f);
  }
  // il ricciolo nero del maschio, sopra la coda
  for (const dx of [-0.0032, 0.0032]) {
    const curva = new THREE.CatmullRomCurve3([
      new V3(dx, 0.004, 0.018), new V3(dx, 0.012, -0.012), new V3(dx * 1.4, 0.03, -0.03),
      new V3(dx * 1.6, 0.046, -0.02), new V3(dx * 1.4, 0.047, -0.003), new V3(dx, 0.038, 0.004),
    ]);
    const g = conRest(new THREE.TubeGeometry(curva, 40, 0.0026, 8, false));
    coda.add(ombreggia(new THREE.Mesh(g, matRiccio)));
  }
  coda.position.set(0, C.coda_su - 0.004, -C.dietro + 0.024);
  corpo.add(coda);

  // testa
  const testa = new THREE.Group();
  testa.rotation.order = 'YXZ';
  dondolo.add(testa);
  testa.add(ombreggia(new THREE.Mesh(geoTesta(P.testa.raggio), matTesta)));
  const becco = new THREE.Group();
  becco.position.set(0, -0.0125, 0.049);
  becco.rotation.x = 0.1;
  testa.add(becco);
  becco.add(ombreggia(new THREE.Mesh(geoBecco(B, false), matBecco)));
  const mandibola = new THREE.Group();
  mandibola.position.set(0, -0.0016, 0.004);
  becco.add(mandibola);
  const mInf = ombreggia(new THREE.Mesh(geoBecco(B, true), matBecco));
  mInf.position.z = -0.004;
  mandibola.add(mInf);
  // narici
  for (const s of [1, -1]) {
    const sN = 0.33, pr = profiloBecco(B, sN, false);
    const n = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), matNarici);
    n.scale.set(0.0021, 0.0011, 0.0046);
    n.position.set(s * pr.hw * 0.36, pr.cy + pr.ht * 0.86, sN * B.lunghezza);
    n.rotation.y = s * 0.12;
    becco.add(n);
  }
  // punto in cui il becco stringe il rametto (tra le due metà, vicino alla punta)
  const sPresa = 0.8, prP = profiloBecco(B, sPresa, false);
  const presaLocale = new V3(0, prP.cy - 0.0008, sPresa * B.lunghezza);
  presaLocale.applyEuler(becco.rotation).add(becco.position);

  // occhi
  const occhi = [], luci = [];
  const dirO = new V3(0.7, 0.3, 0.64).normalize();
  for (const s of [1, -1]) {
    const d = new V3(s * dirO.x, dirO.y, dirO.z);
    const sup = superficieTesta(d, P.testa.raggio);
    const ro = P.occhio_raggio;
    const pivot = new THREE.Group();
    pivot.position.copy(sup).addScaledVector(d, -ro * 0.4);
    pivot.quaternion.setFromUnitVectors(new V3(0, 0, 1), d);
    const occhio = new THREE.Mesh(new THREE.SphereGeometry(ro, 28, 18), matOcchio);
    pivot.add(occhio);
    // palpebra: un anello appena più grande del colore delle piume, si vede quando l'occhio si chiude
    const luce = new THREE.Mesh(new THREE.SphereGeometry(ro * 0.27, 12, 8), matLuce);
    occhio.add(luce);
    const luce2 = new THREE.Mesh(new THREE.SphereGeometry(ro * 0.12, 10, 6), matLuce);
    occhio.add(luce2);
    testa.add(pivot);
    occhi.push(pivot); luci.push([luce, luce2]);
  }

  const collo = Collo(matCollo, coloreCollo);
  dondolo.add(collo.mesh);

  // zampe: in coordinate del mondo, perché restano piantate a terra
  const zampe = [];
  const { g: gPalma, dita } = geoPalma(P.dito);
  const gGamba = new THREE.CylinderGeometry(0.0084, 0.0094, 1, 12); gGamba.translate(0, 0.5, 0);
  for (let i = 0; i < 2; i++) {
    const piede = new THREE.Group();
    piede.rotation.order = 'YXZ';
    piede.add(ombreggia(new THREE.Mesh(gPalma, matPalma)));
    for (const [tx, tz] of dita) {
      const len = Math.hypot(tx, tz), ang = Math.atan2(tx, tz);
      const dito = new THREE.Group();
      dito.rotation.y = ang;
      const gc = new THREE.CylinderGeometry(0.0021, 0.0031, len * 0.94, 8);
      gc.rotateX(Math.PI / 2); gc.translate(0, 0, len * 0.47);
      const cil = ombreggia(new THREE.Mesh(gc, matZampe));
      cil.position.y = 0.0042;
      dito.add(cil);
      const pallina = new THREE.Mesh(new THREE.SphereGeometry(0.0027, 10, 8), matZampe);
      pallina.position.set(0, 0.0038, len * 0.94);
      dito.add(pallina);
      const unghia = new THREE.Mesh(new THREE.ConeGeometry(0.0017, 0.0062, 8), matUnghie);
      unghia.rotation.x = Math.PI / 2 + 0.35;
      unghia.position.set(0, 0.0028, len * 0.94 + 0.0032);
      dito.add(unghia);
      piede.add(dito);
    }
    const tallone = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 12, 8), matZampe);
    tallone.scale.set(1, 0.85, 1.2);
    tallone.position.set(0, 0.0045, -0.003);
    piede.add(tallone);
    const sperone = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), matZampe);
    sperone.position.set(0, 0.003, -0.009);
    piede.add(sperone);
    scena.add(piede);
    const gamba = ombreggia(new THREE.Mesh(gGamba, matZampe));
    scena.add(gamba);
    zampe.push({ piede, gamba });
  }

  const alone1 = alone(0.42);
  return { radice, dondolo, corpo, testa, becco, mandibola, presaLocale, occhi, luci, collo, alaS, alaD, coda, zampe, alone: alone1 };
}

// ════════════════════════════ il limone ════════════════════════════
const PROFILO_LIMONE = [
  [0.0, -0.0545], [0.003, -0.0541], [0.0052, -0.053], [0.0068, -0.0512], [0.008, -0.049], [0.0108, -0.0462],
  [0.016, -0.0425], [0.0215, -0.0365], [0.0262, -0.028], [0.0295, -0.017], [0.0314, -0.005], [0.0318, 0.006],
  [0.0309, 0.017], [0.0284, 0.0265], [0.0244, 0.0345], [0.019, 0.0405], [0.0138, 0.0442], [0.0098, 0.046],
  [0.007, 0.047], [0.0042, 0.0478], [0.0, 0.0482],
];
const Y_RAMETTO = 0.0475, LUNG_RAMETTO = L.rametto_lungo, Y_PRESA = Y_RAMETTO + LUNG_RAMETTO;
const RC = 0.0318, YA = -0.018, YS = 0.018, YT = -0.0545;

function texLimone() {
  const W = 1024, H = 512;
  const c = tela(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const b = tela(W, H), gb = b.getContext('2d'), imgB = gb.createImageData(W, H), db = imgB.data;
  const n = rumore2(D.seme * 17 + 3);
  const cB = rgb(L.buccia), cC = rgb(L.buccia_chiara), cV = rgb(L.buccia_verde), cS = rgb(L.buccia_scura);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H;    // 1 = picciolo, 0 = capezzolo
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const m = fbm(n, u * 16, v * 8, 5, 16);
      const m2 = fbm(n, u * 64 + 9, v * 32 + 4, 3, 64);
      let t = smooth(0.38, 0.78, m);
      let r = lerp(cB[0], cC[0], t), gg = lerp(cB[1], cC[1], t), bb = lerp(cB[2], cC[2], t);
      const sc = smooth(0.62, 0.9, m2) * 0.35;
      r = lerp(r, cS[0], sc); gg = lerp(gg, cS[1], sc); bb = lerp(bb, cS[2], sc);
      const verde = smooth(0.86, 0.99, v) * 0.75 + (1 - smooth(0.0, 0.07, v)) * 0.35;
      r = lerp(r, cV[0], verde); gg = lerp(gg, cV[1], verde); bb = lerp(bb, cV[2], verde);
      const o = (y * W + x) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = 255;
      const hb = 150 + 70 * fbm(n, u * 32 + 3, v * 16 + 1, 3, 32);
      db[o] = db[o + 1] = db[o + 2] = hb; db[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gb.putImageData(imgB, 0, 0);
  // ghiandole dell'olio: forellini fitti nel rilievo, puntini appena più scuri nel colore
  const r = rng(D.seme * 23 + 1);
  for (let i = 0; i < 26000; i++) {
    const x = r() * W, y = r() * H, rad = 1.0 + r() * 1.6;
    for (const xx of x < 4 ? [x, x + W] : x > W - 4 ? [x, x - W] : [x]) {
      gb.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.3})`;
      gb.beginPath(); gb.arc(xx, y, rad, 0, TAU); gb.fill();
      if (r() < 0.5) {
        g.fillStyle = `rgba(190,130,10,${0.05 + r() * 0.08})`;
        g.beginPath(); g.arc(xx, y, rad * 0.9, 0, TAU); g.fill();
      }
    }
  }
  return { mappa: texDa(c, true, true), rilievo: texDa(b, false, true) };
}

function texFoglia() {
  const W = 256, H = 512;
  const c = tela(W, H), g = c.getContext('2d');
  const b = tela(W, H), gb = b.getContext('2d');
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, L.foglia); gr.addColorStop(0.42, L.foglia_chiara); gr.addColorStop(0.5, L.foglia_chiara);
  gr.addColorStop(0.58, L.foglia_chiara); gr.addColorStop(1, L.foglia);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, W, H);
  const r = rng(D.seme * 29 + 2);
  // venature laterali: partono dalla nervatura centrale e piegano verso la punta (in alto nella tela)
  for (let k = 0; k < 11; k++) {
    const y0 = H * (0.94 - k * 0.078);
    for (const s of [-1, 1]) {
      const dy = H * (0.085 + r() * 0.02);
      for (const [ctx, col, lw] of [[g, 'rgba(170,196,96,0.55)', 1.6], [gb, 'rgba(40,40,40,0.9)', 2.4]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(W / 2, y0);
        ctx.quadraticCurveTo(W / 2 + s * W * 0.22, y0 - dy * 0.35, W / 2 + s * W * 0.47, y0 - dy);
        ctx.stroke();
      }
    }
  }
  // nervatura centrale
  for (const [ctx, col, lw] of [[g, L.nervatura, 4.5], [gb, 'rgba(20,20,20,1)', 5]]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(W / 2, H * 0.03); ctx.stroke();
  }
  // margine più scuro
  const gm = g.createLinearGradient(0, 0, W, 0);
  gm.addColorStop(0, 'rgba(20,45,15,0.55)'); gm.addColorStop(0.08, 'rgba(20,45,15,0)');
  gm.addColorStop(0.92, 'rgba(20,45,15,0)'); gm.addColorStop(1, 'rgba(20,45,15,0.55)');
  g.fillStyle = gm; g.fillRect(0, 0, W, H);
  const tm = texDa(c, true, false), tb = texDa(b, false, false);
  return { mappa: tm, rilievo: tb };
}

function geoFoglia(len, wid) {
  const NU = 12, NV = 22, pos = [], uv = [], idx = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const w = wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.8)), 0.75);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU * 2 - 1;
      const x = u * w;
      const y = Math.abs(u) * w * 0.3 - 0.07 * len * v * v + 0.004 * Math.sin(Math.PI * v) * (1 - Math.abs(u));
      pos.push(x, y, v * len);
      uv.push(i / NU, v);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + NU + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function creaLimone() {
  const gr = new THREE.Group();
  scena.add(gr);
  // buccia
  const pts = [];
  const P0 = PROFILO_LIMONE;
  for (let i = 0; i < P0.length - 1; i++) {
    const a = P0[Math.max(0, i - 1)], b = P0[i], c = P0[i + 1], d = P0[Math.min(P0.length - 1, i + 2)];
    for (let k = 0; k < 4; k++) {
      const t = k / 4, t2 = t * t, t3 = t2 * t;
      const f = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      pts.push(new THREE.Vector2(Math.max(0, f(a[0], b[0], c[0], d[0])), f(a[1], b[1], c[1], d[1])));
    }
  }
  pts.push(new THREE.Vector2(0, P0[P0.length - 1][1]));
  const seg = 96;
  const geo = new THREE.LatheGeometry(pts, seg);
  const a = geo.attributes.position;
  const nn = rumore2(D.seme * 41 + 7);
  for (let i = 0; i < a.count; i++) {
    let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-6) {
      const ang = Math.atan2(x, z);
      const bump = (fbm(nn, (ang / TAU + 0.5) * 24, (y + 0.06) * 260, 3, 24) - 0.5) * 0.0011
                 + (fbm(nn, (ang / TAU + 0.5) * 6 + 3, (y + 0.06) * 60, 2, 6) - 0.5) * 0.0016;
      const k = (r + bump * smooth(0.0, 0.012, r)) / r;
      x *= k * 1.025; z *= k * 0.982;
    }
    x += 0.0013 * (1 - Math.pow(y / 0.05, 2));
    a.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  // cucitura: media delle normali tra il primo e l'ultimo spicchio
  const np = pts.length, nrm = geo.attributes.normal;
  for (let j = 0; j < np; j++) {
    const i0 = j, i1 = seg * np + j;
    const nx = nrm.getX(i0) + nrm.getX(i1), ny = nrm.getY(i0) + nrm.getY(i1), nz = nrm.getZ(i0) + nrm.getZ(i1);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i0, nx / l, ny / l, nz / l); nrm.setXYZ(i1, nx / l, ny / l, nz / l);
  }
  const tl = texLimone();
  const matL = new THREE.MeshPhysicalMaterial({
    map: tl.mappa, bumpMap: tl.rilievo, bumpScale: 0.00032, roughness: 0.42, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 1.0,
  });
  const buccia = new THREE.Mesh(geo, matL);
  buccia.castShadow = true; buccia.receiveShadow = true;
  gr.add(buccia);

  // calice: stellina verde attorno al picciolo
  const sh = new THREE.Shape();
  for (let k = 0; k <= 10; k++) {
    const ang = k / 10 * TAU, rr = k % 2 ? 0.0034 : 0.0062;
    const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
    if (k === 0) sh.moveTo(px, py); else sh.lineTo(px, py);
  }
  const gc = new THREE.ExtrudeGeometry(sh, { depth: 0.0008, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1 });
  gc.rotateX(-Math.PI / 2);
  const calice = new THREE.Mesh(gc, new THREE.MeshStandardMaterial({ color: lin('#6F7D2E'), roughness: 0.6 }));
  calice.position.y = 0.0462;
  calice.castShadow = true;
  gr.add(calice);

  // rametto
  const curva = new THREE.CatmullRomCurve3([
    new V3(0, Y_RAMETTO - 0.003, 0), new V3(0.0009, Y_RAMETTO + LUNG_RAMETTO * 0.35, 0.0003),
    new V3(0.0003, Y_RAMETTO + LUNG_RAMETTO * 0.7, 0.0006), new V3(-0.0006, Y_PRESA, 0),
  ]);
  const gt = new THREE.TubeGeometry(curva, 24, 0.0017, 8, false);
  const matR = new THREE.MeshStandardMaterial({ color: lin(L.rametto), roughness: 0.68 });
  const rametto = new THREE.Mesh(gt, matR);
  rametto.castShadow = true;
  gr.add(rametto);
  const nodo = new THREE.Mesh(new THREE.SphereGeometry(0.0019, 10, 6), matR);
  nodo.position.set(-0.0006, Y_PRESA, 0);
  gr.add(nodo);

  // foglie
  const tf = texFoglia();
  const matF = new THREE.MeshStandardMaterial({ map: tf.mappa, bumpMap: tf.rilievo, bumpScale: 0.00025, roughness: 0.36, side: THREE.DoubleSide, envMapIntensity: 0.85 });
  const foglie = [];
  const def = [
    { y: Y_RAMETTO + 0.011, dir: new V3(0.86, 0.2, 0.32), lung: 0.078, larg: 0.032, giro: 0.4 },
    { y: Y_RAMETTO + 0.016, dir: new V3(-0.84, 0.12, -0.36), lung: 0.068, larg: 0.028, giro: -0.5 },
  ];
  for (const f of def) {
    const m = new THREE.Mesh(geoFoglia(f.lung, f.larg), matF);
    m.castShadow = true; m.receiveShadow = true;
    const z = f.dir.clone().normalize();
    const xg = new V3(0, 0, 1).cross(z).normalize();
    const yg = new V3().crossVectors(z, xg);
    const qa = new Q4().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xg, yg, z));
    qa.multiply(new Q4().setFromAxisAngle(new V3(0, 0, 1), f.giro));
    m.position.set(0.0004, f.y, 0);
    gr.add(m);
    foglie.push({ mesh: m, qAria: qa, attacco: new V3(0.0004, f.y, 0), lung: f.lung });
  }
  const alone2 = alone(0.5);
  return { gruppo: gr, foglie, alone: alone2 };
}

// ════════════════════════════ tracciato, posa, gesti ════════════════════════════
const TR = D.tracciato, nTR = TR.x.length, PMAX = TR.passo[nTR - 1];
const _st = { x: 0, z: 0, dir: 0, passo: 0, peso: 0 };
function campiona(t, out = { x: 0, z: 0, dir: 0, passo: 0, peso: 0 }) {
  const f = clamp(t / TR.dt, 0, nTR - 1), i = Math.min(Math.floor(f), nTR - 2), u = f - i;
  out.x = lerp(TR.x[i], TR.x[i + 1], u);
  out.z = lerp(TR.z[i], TR.z[i + 1], u);
  out.dir = TR.dir[i] + angDiff(TR.dir[i + 1], TR.dir[i]) * u;
  out.passo = lerp(TR.passo[i], TR.passo[i + 1], u);
  out.peso = lerp(TR.peso[i], TR.peso[i + 1], u);
  return out;
}
function statoAlPasso(g, out) {
  g = clamp(g, 0, PMAX);
  let lo = 0, hi = nTR - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (TR.passo[m] < g) lo = m + 1; else hi = m; }
  const i = Math.max(1, lo);
  const g0 = TR.passo[i - 1], g1 = TR.passo[i];
  const u = g1 > g0 ? clamp((g - g0) / (g1 - g0), 0, 1) : 1;
  return campiona((i - 1 + u) * TR.dt, out);
}

function camminata(lista, t, rampa = 0.28) {
  // inviluppo morbido di una lista di intervalli [t0, t1, ..., peso]
  let w = 0;
  for (const it of lista) {
    const e = smooth(it[0] - rampa, it[0] + rampa, t) * (1 - smooth(it[1] - rampa, it[1] + rampa, t));
    w = Math.max(w, e * it[it.length - 1]);
  }
  return w;
}

function battito(t) {
  let k = 0;
  for (const b of D.battiti) {
    if (t < b - 0.01) break;
    const x = (t - b) / 0.16;
    if (x >= 0 && x <= 1) k = Math.max(k, Math.sin(Math.PI * x));
  }
  return k;
}

// chinate: per raccogliere e per posare il limone
function chinate(t) {
  const out = { b: 0, bersaglio: null, beccheggio: 0, rollio: 0, imbardata: 0, apertura: 0, corpo: 0, abbassa: 0 };
  // raccolta
  {
    const t0 = EV.china_presa, tg = EV.presa, t1 = EV.sollevata;
    if (t > t0 && t < t1) {
      let b;
      if (t < tg) b = easeInOut((t - t0) / (tg - t0 - 0.05));
      else if (t < tg + 0.12) b = 1;
      else b = 1 - easeInOut((t - tg - 0.12) / (t1 - tg - 0.12));
      out.b = b;
      out.bersaglio = new V3(0, RC, 0.212);
      out.beccheggio = 1.06;
      out.corpo = 0.42 * b;
      out.abbassa = 0.012 * b;
      const discesa = (t - t0) / (tg - t0);
      out.apertura = t < tg ? smooth(0.45, 0.92, discesa) * 0.42 : 0.42 * (1 - smooth(tg, tg + 0.09, t));
    }
  }
  // posa davanti allo spettatore
  {
    const t0 = EV.china_posa, tr = EV.rilascio, t1 = EV.rialzata;
    if (t > t0 && t < t1 + 0.05) {
      const s = clamp((t - t0) / (tr - t0), 0, 1);
      let b = smooth(0, 0.42, s);
      if (t > tr) b = 1 - easeInOut((t - tr - 0.08) / (t1 - tr - 0.08));
      const P1 = new V3(0.0, 0.215, 0.232), P2 = new V3(-0.012, 0.13, 0.246), P3 = new V3(-0.068, 0.078, 0.252);
      const bers = s < 0.42 ? P1.clone() : s < 0.74 ? P1.clone().lerp(P2, smoother((s - 0.42) / 0.32)) : P2.clone().lerp(P3, smoother((s - 0.74) / 0.26));
      out.b = b;
      out.bersaglio = bers;
      out.beccheggio = lerp(0.42, 0.58, smooth(0.4, 1, s));
      out.rollio = -0.2 * smooth(0.7, 1, s);
      out.corpo = 0.3 * b;
      out.abbassa = 0.008 * b;
      out.apertura = t > tr ? 0.36 * smooth(tr, tr + 0.08, t) * (1 - smooth(tr + 0.25, tr + 0.6, t)) : 0;
    }
  }
  return out;
}

// ════════════════════════════ scena: costruzione ════════════════════════════
creaTerreno();
creaLontananze();
const papera = creaPapera();
const limone = creaLimone();

const camPos = new V3(), camMira = new V3();
function campionaCamera(t) {
  const C = D.camera, n = C.pos.length;
  const f = clamp(t / TR.dt, 0, n - 1), i = Math.min(Math.floor(f), n - 2), u = f - i;
  camPos.set(lerp(C.pos[i][0], C.pos[i + 1][0], u), lerp(C.pos[i][1], C.pos[i + 1][1], u), lerp(C.pos[i][2], C.pos[i + 1][2], u));
  camMira.set(lerp(C.mira[i][0], C.mira[i + 1][0], u), lerp(C.mira[i][1], C.mira[i + 1][1], u), lerp(C.mira[i][2], C.mira[i + 1][2], u));
  // respiro leggerissimo di chi guarda
  camPos.x += Math.sin(t * 0.37) * 0.0035; camPos.y += Math.sin(t * 0.53 + 1.3) * 0.0025;
  return lerp(C.fov[i], C.fov[i + 1], u);
}

// ════════════════════════════ posa della papera nel tempo ════════════════════════════
const tmpV = new V3(), tmpV2 = new V3(), tmpQ = new Q4();
const H_SU = new V3(0, P.testa.y, P.testa.z);
const base0 = new V3(0, 0.03, 0.07), dirBase0 = new V3(0, 0.86, 0.5).normalize();
const attaccoTesta = new V3(0, -0.022, -0.014), dirAttacco = new V3(0, 0.82, 0.55).normalize();
const fusione = {
  corpoInv: new THREE.Matrix4(), corpoQ: new Q4(), testaInv: new THREE.Matrix4(), testaQ: new Q4(), r: 0,
  ac: [P.corpo.larghezza ** 2, (P.corpo.altezza * 1.05) ** 2, P.corpo.avanti ** 2],
  at: [(0.9 * P.testa.raggio) ** 2, (0.97 * P.testa.raggio) ** 2, (1.07 * P.testa.raggio) ** 2],
};
let statoLimone = null;            // impostato dopo la simulazione
const posLimoneIniziale = new V3();

function bersaglioSguardo(nome, out) {
  if (nome === 'camera') return out.copy(camPos);
  if (nome === 'limone') return out.copy(statoLimone ? statoLimone.centro : posLimoneIniziale);
  return null;
}

function applicaPosa(t, completa) {
  const tr = campiona(t, _st);
  const w = tr.peso;
  const fase = tr.passo / D.falcata * TAU;
  const ch = chinate(t);
  const felice = camminata(D.contentezza, t, 0.15);
  const R = papera;

  R.radice.position.set(tr.x, 0, tr.z);
  R.radice.rotation.y = tr.dir;
  // dondolio da papera: si sposta sul piede d'appoggio e saltella appena
  const rollio = -0.085 * Math.sin(fase) * w;
  const respiro = Math.sin(t * 2.3) * 0.0016;
  const saltello = Math.abs(Math.sin(t * 13)) * 0.006 * felice;
  R.dondolo.position.set(0.006 * Math.sin(fase) * w, 0.0045 * (0.5 - 0.5 * Math.cos(2 * fase)) * w + respiro + saltello - ch.abbassa, 0);
  R.dondolo.rotation.set(0, 0, rollio + Math.sin(t * 13) * 0.04 * felice);
  R.corpo.rotation.x = P.corpo.beccheggio + ch.corpo + Math.sin(fase * 2) * 0.02 * w;
  R.corpo.scale.set(1 + respiro * 3, 1 + respiro * 4, 1);
  R.radice.updateMatrixWorld(true);

  // testa: posizione eretta + ondeggiare del passo + sguardo + inclinazioni
  const H = tmpV.copy(H_SU);
  H.z += 0.0065 * Math.sin(2 * fase + 0.6) * w;
  H.y += 0.0035 * Math.cos(2 * fase) * w + respiro * 1.5;
  H.x += Math.sin(t * 0.9) * 0.002;
  let bp = 0.1, by = 0, br = 0;
  // sguardo
  let sw = 0, sy = 0, sp = 0;
  for (const it of D.sguardi) {
    const e = smooth(it[0] - 0.3, it[0] + 0.3, t) * (1 - smooth(it[1] - 0.3, it[1] + 0.3, t)) * it[3];
    if (e <= 0.001) continue;
    const bers = bersaglioSguardo(it[2], tmpV2);
    if (!bers) continue;
    R.dondolo.worldToLocal(bers);
    const dx = bers.x - H.x, dy = bers.y - H.y, dz = bers.z - H.z;
    sy += e * clamp(Math.atan2(dx, dz), -1.1, 1.1);
    sp += e * clamp(-Math.atan2(dy, Math.hypot(dx, dz)) + 0.12, -0.5, 0.7);
    sw += e;
  }
  if (sw > 0) { const k = Math.min(1, sw); by = lerp(by, sy / sw, k); bp = lerp(bp, sp / sw, k); }
  br += camminata(D.inclinazioni.map(x => [x[0], x[1], 1]), t, 0.3) * (function () {
    let v = 0; for (const it of D.inclinazioni) if (t > it[0] - 0.3 && t < it[1] + 0.3) v = it[2]; return v;
  })();
  br += Math.sin(t * 13) * 0.08 * felice;
  // nell'attesa finale la testa non sta mai del tutto ferma
  { const a = smooth(EV.guarda_te, EV.guarda_te + 1.5, t); br += Math.sin((t - EV.guarda_te) * 0.85) * 0.06 * a; bp += Math.sin((t - EV.guarda_te) * 0.6 + 1.0) * 0.035 * a; }
  // chinata: la testa va dove il becco deve arrivare
  if (ch.b > 0) {
    const e = new THREE.Euler(ch.beccheggio, ch.imbardata, ch.rollio, 'YXZ');
    const qT = tmpQ.setFromEuler(e);
    const presa = R.presaLocale.clone().applyQuaternion(qT);
    const bersSway = R.dondolo.worldToLocal(R.radice.localToWorld(ch.bersaglio.clone()));
    const Hb = bersSway.sub(presa);
    const k = ch.b;
    H.lerp(Hb, k);
    bp = lerp(bp, ch.beccheggio, k); by = lerp(by, ch.imbardata, k); br = lerp(br, ch.rollio, k);
  }
  R.testa.position.copy(H);
  R.testa.rotation.set(bp, by, br);
  R.mandibola.rotation.x = ch.apertura;
  R.testa.updateMatrixWorld(true);
  if (!completa) return tr;

  // ali e coda
  const fl = felice;
  R.alaS.rotation.z = fl * (0.1 + 0.1 * Math.sin(t * 19)) + ch.b * 0.06;
  R.alaD.rotation.z = -fl * (0.1 + 0.1 * Math.sin(t * 19 + 0.6)) - ch.b * 0.06;
  R.coda.rotation.y = Math.sin(t * 21) * 0.38 * fl + Math.sin(fase) * 0.12 * w;
  R.coda.rotation.x = -0.05 * fl;

  // collo
  const P0 = base0.clone().applyEuler(R.corpo.rotation).multiply(R.corpo.scale).add(R.corpo.position);
  const T0 = dirBase0.clone().applyEuler(R.corpo.rotation);
  const P3 = attaccoTesta.clone().applyEuler(R.testa.rotation).add(R.testa.position);
  const T3 = dirAttacco.clone().applyEuler(R.testa.rotation);
  R.corpo.updateMatrix(); R.testa.updateMatrix();
  fusione.corpoInv.copy(R.corpo.matrix).invert(); fusione.corpoQ.copy(R.corpo.quaternion);
  fusione.testaInv.copy(R.testa.matrix).invert(); fusione.testaQ.copy(R.testa.quaternion);
  R.collo.aggiorna(P0, T0, P3, T3, s => 0.04 + 0.032 * Math.pow(1 - s, 2.6) + 0.016 * Math.pow(s, 2.4), fusione);

  // occhi: palpebre e riflesso
  const k = battito(t);
  for (let i = 0; i < 2; i++) {
    const o = R.occhi[i];
    o.scale.set(1, 1 - 0.88 * k, 1);
  }
  aggiornaRiflessi();

  // zampe
  aggiornaZampe(t, tr);

  // ombra morbida sotto il corpo
  R.alone.position.set(tr.x, 0.0024, tr.z);
  R.alone.rotation.y = tr.dir;
  R.alone.scale.set(0.3, 1, 0.4);
  return tr;
}

const _occhioPos = new V3(), _h = new V3(), _toCam = new V3(), _qInv = new Q4();
function aggiornaRiflessi() {
  for (let i = 0; i < 2; i++) {
    const o = papera.occhi[i];
    o.updateMatrixWorld(true);
    o.getWorldPosition(_occhioPos);
    _toCam.copy(camPos).sub(_occhioPos).normalize();
    _h.copy(dirSole).add(_toCam).normalize();
    o.getWorldQuaternion(_qInv); _qInv.invert();
    _h.applyQuaternion(_qInv);
    const r = P.occhio_raggio;
    papera.luci[i][0].position.copy(_h).multiplyScalar(r * 0.86);
    const h2 = _h.clone().multiplyScalar(-1); h2.z = Math.abs(h2.z) + 0.6; h2.normalize();
    papera.luci[i][1].position.copy(h2).multiplyScalar(r * 0.93);
  }
}

const _pA = { x: 0, z: 0, dir: 0, passo: 0, peso: 0 }, _pB = { x: 0, z: 0, dir: 0, passo: 0, peso: 0 };
function pianta(kk, off, lat, out) {
  const ST = 0.58, S = D.falcata;
  const g = (kk - off + ST * 0.5) * S;
  const st = statoAlPasso(g, out);
  const x = st.x + Math.cos(st.dir) * lat, z = st.z - Math.sin(st.dir) * lat;
  out.x = x; out.z = z;
  return out;
}
const fianchi = [new V3(0.037, 0.08, -0.024), new V3(-0.037, 0.08, -0.024)];
const _hip = new V3(), _cav = new V3(), _dirG = new V3(), _up = new V3(0, 1, 0);
function aggiornaZampe(t, tr) {
  const S = D.falcata, ST = 0.58;
  for (let i = 0; i < 2; i++) {
    const off = i ? 0.5 : 0, lat = (i ? -1 : 1) * P.passo_laterale;
    const c = tr.passo / S + off, k = Math.floor(c), f = c - k;
    let x, z, dir, alza = 0, becch = 0;
    if (f < ST) { const p = pianta(k, off, lat, _pA); x = p.x; z = p.z; dir = p.dir; }
    else {
      const s = (f - ST) / (1 - ST), a = pianta(k, off, lat, _pA), b = pianta(k + 1, off, lat, _pB), e = smoother(s);
      x = lerp(a.x, b.x, e); z = lerp(a.z, b.z, e); dir = a.dir + angDiff(b.dir, a.dir) * e;
      alza = Math.sin(Math.PI * s) * 0.02;
      becch = Math.sin(Math.PI * s) * 0.55 - 0.1 * s;
    }
    // da ferma i piedi tornano affiancati sotto il corpo, con un passettino
    const rx = tr.x + Math.cos(tr.dir) * lat, rz = tr.z - Math.sin(tr.dir) * lat;
    const wr = 1 - smooth(0.04, 0.55, tr.peso);
    const dist = Math.hypot(rx - x, rz - z);
    const zp = papera.zampe[i];
    zp.piede.position.set(lerp(x, rx, wr), alza * (1 - wr) + Math.sin(Math.PI * wr) * Math.min(0.016, dist * 0.5), lerp(z, rz, wr));
    zp.piede.rotation.set(becch * (1 - wr), dir + angDiff(tr.dir, dir) * wr + (i ? -0.13 : 0.13), 0);
    // gamba dal fianco alla caviglia
    _hip.copy(fianchi[i]);
    papera.dondolo.localToWorld(_hip);
    _cav.set(0, 0.0065, -0.004).applyEuler(zp.piede.rotation).add(zp.piede.position);
    _dirG.copy(_hip).sub(_cav);
    const len = _dirG.length();
    zp.gamba.position.copy(_cav);
    zp.gamba.quaternion.setFromUnitVectors(_up, _dirG.normalize());
    zp.gamba.scale.set(1, len, 1);
  }
}

function presaMondo(out) {
  return out.copy(papera.presaLocale).applyMatrix4(papera.testa.matrixWorld);
}

// ════════════════════════════ simulazione del limone ════════════════════════════
// Il limone è un'asta rigida: punta (capezzolo) — corpo — picciolo — rametto.
// Finché la papera lo tiene, la cima del rametto segue il becco; il resto pende, oscilla e si appoggia a terra.
const SIM = (function () {
  const dt = 1 / 240, rec = 2;
  const tg = EV.presa, tr = EV.rilascio, tFine = EV.rilascio + 3.0;
  const lenGA = Y_PRESA - YA;
  const tab = [];
  applicaPosa(tg, false);
  const G0 = presaMondo(new V3());
  const radice0 = papera.radice.position.clone();
  const u0 = new V3(radice0.x - G0.x, 0, radice0.z - G0.z).normalize();
  G0.y = RC;
  const xL0 = new V3().crossVectors(_up, u0).normalize();
  const zL0 = new V3().crossVectors(xL0, u0);
  const q0 = new Q4().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xL0, u0, zL0));
  const centro0 = G0.clone().addScaledVector(u0, -Y_PRESA);
  posLimoneIniziale.copy(centro0);

  const X = G0.clone().addScaledVector(u0, -lenGA), Xp = X.clone();
  const q = q0.clone(), uPrec = u0.clone(), u = new V3(), G = new V3(), qt = new Q4();
  const lato = new V3(), xAtt = new V3();
  let n = 0;
  const preferito = new V3();
  // fase 1: appeso al becco
  for (let t = tg; t <= tr + 1e-9; t += dt, n++) {
    applicaPosa(t, false);
    presaMondo(G);
    const damp = 0.9952;
    const vx = (X.x - Xp.x) * damp, vy = (X.y - Xp.y) * damp, vz = (X.z - Xp.z) * damp;
    Xp.copy(X);
    X.x += vx; X.y += vy - 9.81 * dt * dt; X.z += vz;
    u.copy(G).sub(X).normalize();
    const uMax = Math.min((G.y - RC) / (Y_PRESA - YA), (G.y - RC) / (Y_PRESA - YS), (G.y - 0.002) / (Y_PRESA - YT));
    let contatto = false;
    if (u.y > uMax) {
      contatto = true;
      let hx = u.x, hz = u.z, hl = Math.hypot(hx, hz);
      if (hl < 1e-4) {
        // pende dritto: si inclina verso il fianco destro della papera
        preferito.set(-1, 0, 0).applyQuaternion(papera.radice.quaternion);
        hx = -preferito.x; hz = -preferito.z; hl = 1;
      }
      const uy = Math.max(-0.2, uMax), hh = Math.sqrt(Math.max(0, 1 - uy * uy));
      u.set(hx / hl * hh, uy, hz / hl * hh);
    }
    X.copy(G).addScaledVector(u, -lenGA);
    if (contatto) { Xp.x = lerp(Xp.x, X.x, 0.5); Xp.z = lerp(Xp.z, X.z, 0.5); Xp.y = lerp(Xp.y, X.y, 0.5); }
    qt.setFromUnitVectors(uPrec, u); q.premultiply(qt); uPrec.copy(u);
    // torsione: il rametto stretto nel becco fa girare il limone con la testa
    lato.set(1, 0, 0).applyQuaternion(papera.testa.getWorldQuaternion(tmpQ));
    lato.addScaledVector(u, -lato.dot(u)).normalize();
    xAtt.set(1, 0, 0).applyQuaternion(q);
    const angolo = Math.atan2(new V3().crossVectors(xAtt, lato).dot(u), xAtt.dot(lato));
    q.premultiply(qt.setFromAxisAngle(u, angolo * 0.06 * (1 - smooth(0.0, 0.5, -u.y + 0.5) * 0)));
    if (n % rec === 0) {
      const c = G.clone().addScaledVector(u, -Y_PRESA);
      tab.push([t, c.x, c.y, c.z, q.x, q.y, q.z, q.w]);
    }
  }
  // fase 2: libero, cade su un fianco e si ferma
  const Pa = G.clone().addScaledVector(u, -(Y_PRESA - YA)), Ps = G.clone().addScaledVector(u, -(Y_PRESA - YS));
  const vA = X.clone().sub(Xp);
  const Pap = Pa.clone().sub(vA), Psp = Ps.clone().sub(vA);
  const dAS = YS - YA;
  const vinc = (p, pp, minY) => { if (p.y < minY) { p.y = minY; pp.x = lerp(pp.x, p.x, 0.35); pp.z = lerp(pp.z, p.z, 0.35); } };
  for (let t = tr + dt; t <= tFine; t += dt, n++) {
    for (const [p, pp] of [[Pa, Pap], [Ps, Psp]]) {
      const vx = (p.x - pp.x) * 0.996, vy = (p.y - pp.y) * 0.996, vz = (p.z - pp.z) * 0.996;
      pp.copy(p);
      p.x += vx; p.y += vy - 9.81 * dt * dt; p.z += vz;
    }
    for (let it = 0; it < 6; it++) {
      // distanza fissa
      const d = tmpV2.copy(Ps).sub(Pa), l = d.length(), corr = (l - dAS) / l * 0.5;
      Pa.addScaledVector(d, corr); Ps.addScaledVector(d, -corr);
      // capsula a terra
      vinc(Pa, Pap, RC); vinc(Ps, Psp, RC);
      // punta del capezzolo
      u.copy(Ps).sub(Pa).normalize();
      const punta = Pa.y + u.y * (YT - YA);
      if (punta < 0.0025) { const dd = 0.0025 - punta; Pa.y += dd; Pap.x = lerp(Pap.x, Pa.x, 0.4); Pap.z = lerp(Pap.z, Pa.z, 0.4); }
      // cima del rametto
      const cima = Ps.y + u.y * (Y_PRESA - YS);
      if (cima < 0.002) Ps.y += 0.002 - cima;
    }
    u.copy(Ps).sub(Pa).normalize();
    qt.setFromUnitVectors(uPrec, u); q.premultiply(qt); uPrec.copy(u);
    if (n % rec === 0) {
      const c = Pa.clone().addScaledVector(u, -YA);
      tab.push([t, c.x, c.y, c.z, q.x, q.y, q.z, q.w]);
    }
  }
  return { tab, q0, centro0, t0: tg, t1: tab[tab.length - 1][0], dtRec: dt * rec };
})();

const _qL = new Q4(), _qL2 = new Q4();
function statoLimoneAl(t, out) {
  out = out || { centro: new V3(), q: new Q4() };
  if (t <= SIM.t0) { out.centro.copy(SIM.centro0); out.q.copy(SIM.q0); return out; }
  const T = SIM.tab, f = clamp((t - SIM.t0) / SIM.dtRec, 0, T.length - 1), i = Math.min(Math.floor(f), T.length - 2), u = f - i;
  const a = T[i], b = T[i + 1];
  out.centro.set(lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u));
  _qL.set(a[4], a[5], a[6], a[7]); _qL2.set(b[4], b[5], b[6], b[7]);
  out.q.copy(_qL).slerp(_qL2, u);
  return out;
}
statoLimone = statoLimoneAl(SIM.t1 + 1);
const LIMONE_FINALE = statoLimone.centro.clone();
statoLimone = { centro: new V3(), q: new Q4() };

const _asse = new V3(), _att = new V3(), _dirA = new V3(), _h2 = new V3(), _xx = new V3(), _yy = new V3(), _zz = new V3(), _m4 = new THREE.Matrix4(), _qa = new Q4(), _qg = new Q4(), _qLinv = new Q4();
function aggiornaLimone(t, peso) {
  statoLimoneAl(t, statoLimone);
  const g = limone.gruppo;
  g.position.copy(statoLimone.centro);
  g.quaternion.copy(statoLimone.q);
  g.updateMatrixWorld(true);
  _asse.set(0, 1, 0).applyQuaternion(statoLimone.q);
  const aria = smooth(0.22, 0.8, _asse.y);
  _qLinv.copy(statoLimone.q).invert();
  limone.foglie.forEach((f, i) => {
    _att.copy(f.attacco).applyMatrix4(g.matrixWorld);
    _qa.copy(statoLimone.q).multiply(f.qAria);
    // a terra: la foglia si stende verso l'esterno, con la punta che tocca il prato
    // a terra le due foglie si aprono a ventaglio oltre il picciolo, lontano dal corpo del limone
    _h2.set(_asse.x, 0, _asse.z);
    if (_h2.lengthSq() < 1e-6) _h2.set(1, 0, 0);
    _h2.normalize();
    // tutte e due si aprono dal lato di chi guarda, così non restano nascoste dietro il limone
    const versoCam = Math.sign(_h2.x * (camPos.z - _att.z) - _h2.z * (camPos.x - _att.x)) || 1;
    _h2.applyAxisAngle(_up, -versoCam * (i ? -0.18 : 1.0));
    const incl = Math.asin(clamp((_att.y - 0.008) / f.lung, 0, 0.85));
    _zz.copy(_h2).multiplyScalar(Math.cos(incl)).addScaledVector(_up, -Math.sin(incl));
    _yy.copy(_up).multiplyScalar(Math.cos(incl)).addScaledVector(_h2, Math.sin(incl));
    _xx.crossVectors(_yy, _zz).normalize();
    _qg.setFromRotationMatrix(_m4.makeBasis(_xx, _yy, _zz));
    _qg.slerp(_qa, aria);
    // fruscio quando cammina
    const fr = Math.sin(t * 9.5 + i * 2.1) * 0.08 * peso * aria;
    _qg.multiply(tmpQ.setFromAxisAngle(_up, fr));
    f.mesh.quaternion.copy(_qLinv).multiply(_qg);
  });
  // ombra morbida sotto il limone
  const h = Math.max(0, statoLimone.centro.y - RC);
  limone.alone.position.set(statoLimone.centro.x, 0.0026, statoLimone.centro.z);
  limone.alone.rotation.y = Math.atan2(_asse.x, _asse.z);
  const sc = 1 + h * 4;
  limone.alone.scale.set(0.085 * sc, 1, (0.085 + 0.06 * (1 - Math.abs(_asse.y))) * sc);
  limone.alone.material.opacity = 0.5 / (1 + h * 30);
}

// ora che si sa dove finisce il limone, si semina il prato tenendolo libero
const escludi = (x, z) => {
  const dl = Math.hypot(x - LIMONE_FINALE.x, z - LIMONE_FINALE.z);
  const dl0 = Math.hypot(x - SIM.centro0.x, z - SIM.centro0.z);
  const dp = Math.hypot(x - TR.x[nTR - 1], z - TR.z[nTR - 1]);
  return dl < 0.13 || dl0 < 0.1 || dp < 0.12;
};
creaErba(escludi);
creaMargherite(escludi);
creaSassolini(escludi);

// ════════════════════════════ nuvoletta ════════════════════════════
const ctxF = cvF.getContext('2d');
let LW = 1, LH = 1, DPR = 1;
const offNuvola = document.createElement('canvas');
const ctxN = offNuvola.getContext('2d');
let ancoraRif = null;
function proietta(v) {
  const p = v.clone().project(camera);
  return { x: (p.x + 1) / 2 * LW, y: (1 - p.y) / 2 * LH };
}
function cimaTesta(out) {
  return out.set(0, P.testa.raggio * 1.05, -0.005).applyMatrix4(papera.testa.matrixWorld);
}
function formaNuvola(ctx, cx, cy, rx, ry, bolle, s, lw, riemp, contorno) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = contorno; ctx.lineWidth = lw * 2;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
  for (const b of bolle) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = riemp;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
  for (const b of bolle) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function disegnaFumetto(t) {
  ctxF.setTransform(1, 0, 0, 1, 0, 0);
  ctxF.clearRect(0, 0, cvF.width, cvF.height);
  const t0 = EV.nuvoletta;
  if (t < t0) return;
  ctxF.setTransform(DPR, 0, 0, DPR, 0, 0);
  const fs = clamp(Math.min(LW * 0.034, LH * 0.058), 18, 54);
  const font = `700 ${fs}px "${F.font_morbido}", "Comic Sans MS", "Chalkboard SE", cursive`;
  ctxF.font = font;
  const righe = F.righe, lw = righe.map(r => ctxF.measureText(r).width);
  const bw = Math.max(...lw), lh = fs * 1.08, bh = lh * righe.length;
  const rx = bw / 2 + fs * 0.62, ry = bh / 2 + fs * 0.32;
  const testa = proietta(cimaTesta(new V3()));
  const rif = ancoraRif ? proietta(ancoraRif) : testa;
  const margine = fs * 1.1;
  const rb = fs * 0.62;
  let cx = rif.x + rx * 0.82 + fs * 2.4, cy = rif.y - ry * 0.55 - fs * 2.1;
  cx = clamp(cx, rx + rb + margine, LW - rx - rb - margine);
  cy = clamp(cy, ry + rb + fs * 0.6, LH - ry - rb - margine);
  const dt = t - t0;
  cy += Math.sin(dt * 1.5) * fs * 0.07;
  // bolle del contorno a festoni
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const nb = Math.max(9, Math.round(per / (rb * 1.32)));
  const bolle = [];
  for (let k = 0; k < nb; k++) {
    const a = k / nb * TAU + 0.15;
    const vr = 1 + 0.13 * Math.sin(k * 2.7 + 1.1) + 0.03 * Math.sin(dt * 2.2 + k);
    bolle.push({ x: Math.cos(a) * rx * 0.99, y: Math.sin(a) * ry * 0.97, r: rb * vr });
  }
  const contorno = F.contorno, riemp = F.riempimento;
  const spess = Math.max(1.6, fs * 0.075);
  // puntini di pensiero, dal capo verso la nuvola
  const verso = Math.atan2(testa.y - cy, testa.x - cx);
  const bordo = { x: cx + Math.cos(verso) * (rx + rb * 0.6), y: cy + Math.sin(verso) * (ry + rb * 0.6) };
  const inizio = { x: testa.x + fs * 0.4, y: testa.y - fs * 0.7 };
  const dot = [[0.12, 0.2], [0.42, 0.3], [0.74, 0.42]];
  ctxF.save();
  ctxF.shadowColor = 'rgba(70,50,30,0.22)'; ctxF.shadowBlur = fs * 0.4; ctxF.shadowOffsetY = fs * 0.12;
  dot.forEach(([f, r], k) => {
    const sc = easeOutBack((dt - k * 0.17) / 0.32, 2.4);
    if (sc <= 0) return;
    const px = lerp(inizio.x, bordo.x, f), py = lerp(inizio.y, bordo.y, f) - Math.sin(Math.PI * f) * fs * 0.6;
    const rr = r * fs * sc;
    ctxF.beginPath(); ctxF.arc(px, py, rr, 0, TAU);
    ctxF.fillStyle = riemp; ctxF.fill();
    ctxF.shadowColor = 'transparent';
    ctxF.lineWidth = spess; ctxF.strokeStyle = contorno; ctxF.stroke();
    ctxF.shadowColor = 'rgba(70,50,30,0.22)';
  });
  ctxF.restore();
  // la nuvola, disegnata a parte e poi posata con la sua ombra
  const sN = easeOutBack((dt - 0.55) / 0.55, 1.6);
  if (sN > 0) {
    const pad = rb * 1.6 + spess * 2;
    const ow = Math.ceil((rx + pad) * 2 * DPR), oh = Math.ceil((ry + pad) * 2 * DPR);
    if (offNuvola.width !== ow || offNuvola.height !== oh) { offNuvola.width = ow; offNuvola.height = oh; }
    ctxN.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctxN.clearRect(0, 0, ow, oh);
    formaNuvola(ctxN, rx + pad, ry + pad, rx, ry, bolle, 1, spess, riemp, contorno);
    // un velo d'ombra sul fondo della nuvola, per darle volume
    ctxN.save();
    ctxN.globalCompositeOperation = 'source-atop';
    const gr = ctxN.createLinearGradient(0, pad, 0, ry * 2 + pad * 1.6);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(214,200,178,0.55)');
    ctxN.fillStyle = gr; ctxN.fillRect(0, 0, ow, oh);
    ctxN.restore();
    ctxF.save();
    ctxF.globalAlpha = clamp((dt - 0.55) / 0.18, 0, 1);
    ctxF.translate(cx, cy); ctxF.scale(sN, sN);
    ctxF.shadowColor = 'rgba(70,50,30,0.24)'; ctxF.shadowBlur = fs * 0.7; ctxF.shadowOffsetY = fs * 0.22;
    ctxF.drawImage(offNuvola, -(rx + pad), -(ry + pad), ow / DPR, oh / DPR);
    ctxF.restore();
  }
  // testo che si scrive una lettera alla volta
  const tT = 0.98;
  if (dt > tT) {
    const vis = (dt - tT) * 24;
    let idx = 0;
    ctxF.save();
    ctxF.font = font;
    ctxF.textBaseline = 'middle';
    ctxF.lineJoin = 'round';
    const evid = (F.evidenzia || '').toLowerCase();
    righe.forEach((riga, ri) => {
      const y0 = cy - bh / 2 + lh * (ri + 0.5) + fs * 0.04;
      const x0 = cx - lw[ri] / 2;
      const inizioEv = evid ? riga.toLowerCase().indexOf(evid) : -1;
      for (let ci = 0; ci < riga.length; ci++, idx++) {
        const a = clamp(vis - idx, 0, 1);
        if (a <= 0) continue;
        const ch = riga[ci];
        if (ch === ' ') continue;
        const x = x0 + ctxF.measureText(riga.slice(0, ci)).width;
        const y = y0 + (1 - easeOutBack(a, 2)) * fs * 0.25;
        ctxF.globalAlpha = a;
        const giallo = inizioEv >= 0 && ci >= inizioEv && ci < inizioEv + evid.length;
        if (giallo) {
          ctxF.lineWidth = fs * 0.13; ctxF.strokeStyle = F.contorno; ctxF.strokeText(ch, x, y);
          ctxF.fillStyle = F.giallo; ctxF.fillText(ch, x, y);
        } else {
          ctxF.fillStyle = F.testo; ctxF.fillText(ch, x, y);
        }
      }
    });
    ctxF.restore();
  }
}

// ════════════════════════════ stile pixel ════════════════════════════
// La stessa scena, disegnata a bassa risoluzione: luce a gradini su papera e limone,
// contorno scuro di un pixel attorno alle due sagome, colori ridotti a una tavolozza.
const PX = PIXEL ? (function () {
  const PXD = D.pixel;
  cv.classList.add('pixel'); cvF.classList.add('pixel');
  const grad = new THREE.DataTexture(new Uint8Array(PXD.luce), PXD.luce.length, 1, THREE.LuminanceFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.generateMipmaps = false; grad.needsUpdate = true;
  const cache = new Map();
  const daToon = m => new THREE.MeshToonMaterial({ color: m.color, map: m.map || null, vertexColors: m.vertexColors, gradientMap: grad, side: m.side });
  function toon(root, maschera) {
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.material.isMeshStandardMaterial) {
        if (!cache.has(o.material)) cache.set(o.material, daToon(o.material));
        o.material = cache.get(o.material);
      }
      o.userData.maschera = maschera;
    });
  }
  const mPapera = new THREE.MeshBasicMaterial({ color: 0x808080, fog: false, toneMapped: false });
  const mLimone = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide, toneMapped: false });
  // tre materiali neri: three r128 non distingue le istanze con e senza colore nello stesso programma
  const mNero = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  const mNeroIst = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  const mNeroIstCol = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  toon(papera.radice, mPapera);
  papera.zampe.forEach(z => { toon(z.piede, mPapera); toon(z.gamba, mPapera); });
  toon(limone.gruppo, mLimone);
  // le macchie d'ombra a terra non contano per le sagome
  const mNiente = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  papera.alone.userData.maschera = mNiente; limone.alone.userData.maschera = mNiente;
  const opz = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
  const rt = new THREE.WebGLRenderTarget(4, 4, opz);
  rt.texture.encoding = THREE.sRGBEncoding;
  const rtM = new THREE.WebGLRenderTarget(4, 4, opz);
  const gr = PXD.tavolozza || {};
  const tav = [].concat(gr.ambiente || [], gr.papera || [], gr.limone || []).map(h => new THREE.Color(h));
  const nTav = tav.length;
  const n1 = (gr.ambiente || []).length, n2 = n1 + (gr.papera || []).length;
  while (tav.length < 64) tav.push(new THREE.Color(0, 0, 0));
  const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: {
      tScena: { value: rt.texture }, tMaschera: { value: rtM.texture }, uRis: { value: new THREE.Vector2(4, 4) },
      uTav: { value: tav }, uN: { value: nTav }, uContorno: { value: new THREE.Color(PXD.contorno) },
      uRetino: { value: PXD.retino }, uGruppi: { value: new THREE.Vector3(n1, n2, nTav) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tScena, tMaschera; uniform vec2 uRis; uniform vec3 uTav[64]; uniform int uN;
      uniform vec3 uContorno; uniform float uRetino; uniform vec3 uGruppi;
      varying vec2 vUv;
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        vec2 px = floor(vUv * uRis);
        vec2 uv = (px + 0.5) / uRis;
        vec2 dx = vec2(1.0 / uRis.x, 0.0), dy = vec2(0.0, 1.0 / uRis.y);
        float m = texture2D(tMaschera, uv).r;
        float mx = max(max(texture2D(tMaschera, uv + dx).r, texture2D(tMaschera, uv - dx).r),
                       max(texture2D(tMaschera, uv + dy).r, texture2D(tMaschera, uv - dy).r));
        if (mx > m + 0.25) { gl_FragColor = vec4(uContorno, 1.0); return; }
        vec3 c = texture2D(tScena, uv).rgb;
        if (uN > 0) {
          c += (bayer4(px) - 0.5) * uRetino * (m > 0.25 ? 0.2 : 1.0);
          // ognuno pesca dai suoi colori: ambiente, papera (maschera grigia), limone (maschera bianca)
          int lo = 0, hi = int(uGruppi.x);
          if (m > 0.75) { lo = int(uGruppi.y); hi = int(uGruppi.z); }
          else if (m > 0.25) { lo = int(uGruppi.x); hi = int(uGruppi.y); }
          vec3 best = c; float bd = 1e9;
          for (int i = 0; i < 64; i++) {
            if (i < lo) continue;
            if (i >= hi) break;
            vec3 d = c - uTav[i];
            float dd = dot(d * d, vec3(0.32, 0.5, 0.18));
            if (dd < bd) { bd = dd; best = uTav[i]; }
          }
          c = best;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
  post.frustumCulled = false;
  const scenaPost = new THREE.Scene();
  scenaPost.add(post);
  const camPost = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { rt, rtM, post, scenaPost, camPost, mNero, mNeroIst, mNeroIstCol, k: 1, kF: 1, w: 4, h: 4 };
})() : null;

function renderPixel() {
  renderer.setRenderTarget(PX.rt);
  renderer.render(scena, camera);
  // maschera delle sagome: papera grigia, limone bianco, tutto il resto nero
  const salv = [];
  scena.traverse(o => {
    if (!o.isMesh) return;
    salv.push(o, o.material);
    o.material = o.userData.maschera || (o.isInstancedMesh ? (o.instanceColor ? PX.mNeroIstCol : PX.mNeroIst) : PX.mNero);
  });
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(PX.rtM);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scena, camera);
  renderer.shadowMap.autoUpdate = true;
  for (let i = 0; i < salv.length; i += 2) salv[i].material = salv[i + 1];
  renderer.setRenderTarget(null);
  renderer.render(PX.scenaPost, PX.camPost);
}

// nuvoletta in pixel art: forme senza sfumature, contorno di un pixel, carattere a pixel
const TINTE_PIXEL = [F.riempimento, F.contorno, F.testo, F.giallo_pixel, '#D9CBB4'].map(rgb);
function nitidizza(x0, y0, w, h) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  w = Math.min(cvF.width - x0, Math.ceil(w)); h = Math.min(cvF.height - y0, Math.ceil(h));
  if (w <= 0 || h <= 0) return;
  const img = ctxF.getImageData(x0, y0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 110) { d[i + 3] = 0; continue; }
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let best = 0, bd = 1e9;
    for (let k = 0; k < TINTE_PIXEL.length; k++) {
      const c = TINTE_PIXEL[k], dd = (r - c[0]) ** 2 * 0.3 + (g - c[1]) ** 2 * 0.5 + (b - c[2]) ** 2 * 0.2;
      if (dd < bd) { bd = dd; best = k; }
    }
    d[i] = TINTE_PIXEL[best][0]; d[i + 1] = TINTE_PIXEL[best][1]; d[i + 2] = TINTE_PIXEL[best][2]; d[i + 3] = 255;
  }
  ctxF.putImageData(img, x0, y0);
}
function disegnaFumettoPixel(t) {
  const W = cvF.width, H = cvF.height;
  ctxF.setTransform(1, 0, 0, 1, 0, 0);
  ctxF.clearRect(0, 0, W, H);
  const t0 = EV.nuvoletta;
  if (t < t0) return;
  ctxF.imageSmoothingEnabled = false;
  const sx = W / LW, sy = H / LH;
  const fs = D.pixel.carattere;
  const font = `500 ${fs}px "${F.font_pixel}", monospace`;
  ctxF.font = font;
  const righe = F.righe, lw = righe.map(r => Math.round(ctxF.measureText(r).width));
  const bw = Math.max(...lw), lh = Math.round(fs * 1.15), bh = lh * righe.length;
  const rx = Math.round(bw / 2 + fs * 0.75), ry = Math.round(bh / 2 + fs * 0.45);
  const tp = proietta(cimaTesta(new V3())), rp = ancoraRif ? proietta(ancoraRif) : tp;
  const testa = { x: tp.x * sx, y: tp.y * sy }, rif = { x: rp.x * sx, y: rp.y * sy };
  const rb = Math.round(fs * 0.6), margine = fs;
  let cx = rif.x + rx * 0.82 + fs * 2.4, cy = rif.y - ry * 0.55 - fs * 2.1;
  cx = Math.round(clamp(cx, rx + rb + margine, W - rx - rb - margine));
  cy = Math.round(clamp(cy, ry + rb + fs * 0.6, H - ry - rb - margine));
  const dt = t - t0;
  cy += Math.round(Math.sin(dt * 1.5) * 1.2);
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const nb = Math.max(8, Math.round(per / (rb * 1.4)));
  // puntini
  const verso = Math.atan2(testa.y - cy, testa.x - cx);
  const bordo = { x: cx + Math.cos(verso) * (rx + rb * 0.6), y: cy + Math.sin(verso) * (ry + rb * 0.6) };
  const inizio = { x: testa.x + fs * 0.4, y: testa.y - fs * 0.7 };
  [[0.12, 0.17], [0.42, 0.26], [0.74, 0.36]].forEach(([f, r], k) => {
    if (dt < k * 0.17) return;
    const sc = dt < k * 0.17 + 0.12 ? 0.6 : 1;
    const px = Math.round(lerp(inizio.x, bordo.x, f)), py = Math.round(lerp(inizio.y, bordo.y, f) - Math.sin(Math.PI * f) * fs * 0.6);
    const rr = Math.max(1.5, r * fs * sc);
    ctxF.fillStyle = F.contorno; ctxF.beginPath(); ctxF.arc(px, py, rr + 1, 0, TAU); ctxF.fill();
    ctxF.fillStyle = F.riempimento; ctxF.beginPath(); ctxF.arc(px, py, rr, 0, TAU); ctxF.fill();
  });
  // nuvola: si gonfia a scatti, come in un gioco
  const fase = dt - 0.55;
  if (fase > 0) {
    const sN = fase < 0.08 ? 0.45 : fase < 0.16 ? 0.8 : fase < 0.24 ? 1.08 : 1;
    const bolle = [];
    for (let k = 0; k < nb; k++) {
      const a = k / nb * TAU + 0.15;
      bolle.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry, r: rb * (1 + 0.14 * Math.sin(k * 2.7 + 1.1)) });
    }
    ctxF.save();
    ctxF.translate(cx, cy); ctxF.scale(sN, sN);
    ctxF.fillStyle = '#D9CBB4';
    ctxF.beginPath(); ctxF.ellipse(1, 2, rx + 1, ry + 1, 0, 0, TAU); ctxF.fill();
    for (const b of bolle) { ctxF.beginPath(); ctxF.arc(b.x + 1, b.y + 2, b.r + 1, 0, TAU); ctxF.fill(); }
    ctxF.fillStyle = F.contorno;
    ctxF.beginPath(); ctxF.ellipse(0, 0, rx + 1, ry + 1, 0, 0, TAU); ctxF.fill();
    for (const b of bolle) { ctxF.beginPath(); ctxF.arc(b.x, b.y, b.r + 1, 0, TAU); ctxF.fill(); }
    ctxF.fillStyle = F.riempimento;
    ctxF.beginPath(); ctxF.ellipse(0, 0, rx, ry, 0, 0, TAU); ctxF.fill();
    for (const b of bolle) { ctxF.beginPath(); ctxF.arc(b.x, b.y, b.r, 0, TAU); ctxF.fill(); }
    ctxF.restore();
  }
  nitidizza(cx - rx - rb * 2 - 4, cy - ry - rb * 2 - 4, (rx + rb * 2 + 4) * 2, (ry + rb * 2 + 6) * 2);
  nitidizza(Math.min(inizio.x, bordo.x) - fs, Math.min(inizio.y, bordo.y) - fs * 1.4, Math.abs(bordo.x - inizio.x) + fs * 2, Math.abs(bordo.y - inizio.y) + fs * 2.8);
  // testo, lettera per lettera
  if (dt > 0.98 && fase > 0.24) {
    const vis = Math.floor((dt - 0.98) * 24);
    let idx = 0;
    ctxF.font = font;
    ctxF.textBaseline = 'middle';
    const evid = (F.evidenzia || '').toLowerCase();
    righe.forEach((riga, ri) => {
      const y0 = Math.round(cy - bh / 2 + lh * (ri + 0.5));
      const x0 = Math.round(cx - lw[ri] / 2);
      const iEv = evid ? riga.toLowerCase().indexOf(evid) : -1;
      for (let ci = 0; ci < riga.length; ci++, idx++) {
        if (idx > vis) return;
        const ch = riga[ci];
        if (ch === ' ') continue;
        const x = x0 + Math.round(ctxF.measureText(riga.slice(0, ci)).width);
        const giallo = iEv >= 0 && ci >= iEv && ci < iEv + evid.length;
        if (giallo) {
          ctxF.fillStyle = F.contorno;
          ctxF.fillText(ch, x + 1, y0 + 1); ctxF.fillText(ch, x, y0 + 1);
          ctxF.fillStyle = F.giallo_pixel;
        } else ctxF.fillStyle = F.testo;
        ctxF.fillText(ch, x, y0);
      }
    });
    nitidizza(cx - rx, cy - ry, rx * 2, ry * 2);
  }
}

// ════════════════════════════ disegno di un istante ════════════════════════════
let override = null;
function disegna(t) {
  U.tempo.value = t;
  let fov = campionaCamera(t);
  if (override) { camPos.set(...override.pos); camMira.set(...override.mira); fov = override.fov || fov; }
  // con schermi stretti si allarga il campo in verticale, per non perdere i lati
  const asp = LW / LH;
  if (asp < 1.34) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.34 / asp));
  camera.fov = fov;
  camera.aspect = asp;
  camera.position.copy(camPos);
  camera.lookAt(camMira);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  cielo.position.copy(camPos);

  const tr = applicaPosa(t, true);
  aggiornaLimone(t, tr.peso);

  // la luce del sole (e la sua mappa d'ombra) segue la papera
  const fx = lerp(tr.x, statoLimone.centro.x, 0.25), fz = lerp(tr.z, statoLimone.centro.z, 0.25);
  sole.target.position.set(fx, 0.1, fz);
  sole.position.set(fx, 0.1, fz).addScaledVector(dirSole, 4);
  sole.target.updateMatrixWorld();

  if (PIXEL) renderPixel(); else renderer.render(scena, camera);
  if (velo) velo.style.opacity = String(1 - smooth(0.0, D.tempi.dissolvenza, t));
  if (PIXEL) disegnaFumettoPixel(t); else disegnaFumetto(t);
}

function ridimensiona() {
  LW = window.innerWidth; LH = window.innerHeight;
  if (PIXEL) {
    // pixel tutti uguali: ogni pixel della scena occupa k×k pixel dello schermo, con k intero
    const dev = Math.min(window.devicePixelRatio || 1, 3);
    const Wd = LW * dev, Hd = LH * dev;
    const k = Math.max(1, Math.round(Hd / D.pixel.righe));
    const w = Math.ceil(Wd / k), h = Math.ceil(Hd / k);
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    cv.style.width = (w * k / dev) + 'px'; cv.style.height = (h * k / dev) + 'px';
    PX.rt.setSize(w, h); PX.rtM.setSize(w, h);
    PX.post.material.uniforms.uRis.value.set(w, h);
    const kF = Math.max(1, Math.round(Hd * D.pixel.quota_testo / D.pixel.carattere));
    cvF.width = Math.ceil(Wd / kF); cvF.height = Math.ceil(Hd / kF);
    cvF.style.width = (cvF.width * kF / dev) + 'px'; cvF.style.height = (cvF.height * kF / dev) + 'px';
    PX.k = k; PX.kF = kF; DPR = 1;
    return;
  }
  // la scena 3D non va oltre 1,5 pixel per punto (resta fluida sui portatili); la nuvoletta usa la densità piena
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * qualita);
  renderer.setSize(LW, LH, false);
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cvF.width = Math.round(LW * DPR); cvF.height = Math.round(LH * DPR);
}
let qualita = 1;
window.addEventListener('resize', () => { ridimensiona(); if (fermo) disegna(tFermo); });

// punto di riferimento stabile per la nuvoletta: la testa quando la papera ti guarda
(function () {
  campionaCamera(EV.nuvoletta + 0.4);
  applicaPosa(EV.nuvoletta + 0.4, false);
  ancoraRif = cimaTesta(new V3());
})();

// ════════════════════════════ animazione ════════════════════════════
let tScena = 0, tPrec = null, fermo = false, tFermo = 0;
let campioni = 0, sommaDt = 0;
function ciclo(ora) {
  if (fermo) return;
  requestAnimationFrame(ciclo);
  if (tPrec === null) tPrec = ora;
  const dt = Math.min(0.1, (ora - tPrec) / 1000);
  tPrec = ora;
  tScena += dt;
  disegna(tScena);
  // paracadute: se il computer arranca, la risoluzione scende da sola
  if (!PIXEL && tScena > 1.5 && tScena < 12 && qualita > 0.55) {
    campioni++; sommaDt += dt;
    if (campioni >= 45) {
      if (sommaDt / campioni > 1 / 38) { qualita *= 0.8; ridimensiona(); }
      campioni = 0; sommaDt = 0;
    }
  }
}

window.__disegnaIstante = function (t, opz) {
  fermo = true; tFermo = t;
  override = opz && opz.camera ? opz.camera : null;
  disegna(t);
  return true;
};
window.__dbg = { scena, renderer, sole, camera, papera, limone, THREE, PX };
window.__stato = function (t) {
  applicaPosa(t, false);
  const g = presaMondo(new V3());
  const s = statoLimoneAl(t);
  return { presa: g.toArray(), limone: s.centro.toArray(), limoneFinale: LIMONE_FINALE.toArray(), radice: papera.radice.position.toArray() };
};

ridimensiona();
const pronto = document.fonts && document.fonts.load ? document.fonts.load(PIXEL ? `500 16px "${F.font_pixel}"` : `700 32px "${F.font_morbido}"`).catch(() => null) : Promise.resolve();
pronto.then(() => {
  window.__pronto = true;
  if (!window.__nonPartire) requestAnimationFrame(ciclo);
});
})();
