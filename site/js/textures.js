import * as THREE from 'three';

// Procedural material textures. Everything is generated on the fly so the site ships as
// HTML + JSON + one HDRI; nothing here encodes data, it is surface finish only.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = false, repeat = [1, 1], aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Paper fibre: a grey-scale height/roughness field of short random strokes. */
export function paperFibre(size = 512, seed = 7) {
  const c = canvas(size, size), g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 118 + (r() - .5) * 26; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI, l = 3 + r() * 14;
    const v = r() < .5 ? 150 + r() * 40 : 80 + r() * 30;
    g.strokeStyle = `rgba(${v},${v},${v},${.18 + r() * .25})`;
    g.lineWidth = .5 + r() * .8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}

let _fibre;
export function fibreTexture(repeat = 1) {
  _fibre = _fibre || paperFibre();
  return tex(_fibre, { repeat: [repeat, repeat] });
}

/** Manila card stock: warm base with fibre flecks (sRGB colour map). */
export function manilaTexture() {
  const s = 512, c = canvas(s, s), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#d6bb82'; g.fillRect(0, 0, s, s);
  const f = _fibre || (_fibre = paperFibre());
  g.globalAlpha = .22; g.globalCompositeOperation = 'multiply'; g.drawImage(f, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  for (let i = 0; i < 500; i++) {
    g.fillStyle = r() < .6 ? `rgba(120,85,40,${r() * .18})` : `rgba(255,240,210,${r() * .2})`;
    g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r());
  }
  return tex(c, { srgb: true });
}

/** Dark lacquered walnut for the shelving. Returns {map, roughnessMap}. */
export function walnut() {
  const w = 1024, h = 256, c = canvas(w, h), g = c.getContext('2d'), r = rng(3);
  const cr = canvas(w, h), gr = cr.getContext('2d');
  g.fillStyle = '#2a1a10'; g.fillRect(0, 0, w, h);
  gr.fillStyle = '#5a5a5a'; gr.fillRect(0, 0, w, h);
  for (let i = 0; i < 380; i++) {
    const y = r() * h, amp = 2 + r() * 8, freq = .003 + r() * .01, ph = r() * 6;
    const light = r();
    g.strokeStyle = light < .5 ? `rgba(70,42,24,${.25 + r() * .35})` : `rgba(12,7,4,${.3 + r() * .4})`;
    g.lineWidth = .6 + r() * 2.4;
    gr.strokeStyle = `rgba(${light < .5 ? 110 : 60},${light < .5 ? 110 : 60},${light < .5 ? 110 : 60},.35)`;
    gr.lineWidth = g.lineWidth;
    g.beginPath(); gr.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * .3;
      x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      x ? gr.lineTo(x, yy) : gr.moveTo(x, yy);
    }
    g.stroke(); gr.stroke();
  }
  return { map: tex(c, { srgb: true }), roughnessMap: tex(cr) };
}

/** Polished dark stone floor: subtle aggregate + roughness variation for broken reflections. */
export function stoneFloor() {
  const s = 1024, c = canvas(s, s), g = c.getContext('2d'), r = rng(21);
  const cr = canvas(s, s), gr = cr.getContext('2d');
  g.fillStyle = '#121214'; g.fillRect(0, 0, s, s);
  gr.fillStyle = '#3a3a3a'; gr.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const x = r() * s, y = r() * s, rad = r() * r() * 3.2;
    const v = 18 + r() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 3},${.35 + r() * .5})`;
    g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
  }
  // soft roughness clouds (polish wear)
  for (let i = 0; i < 160; i++) {
    const x = r() * s, y = r() * s, rad = 30 + r() * 140;
    const grd = gr.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() < .5 ? 20 : 90;
    grd.addColorStop(0, `rgba(${v},${v},${v},.25)`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    gr.fillStyle = grd; gr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { map: tex(c, { srgb: true, repeat: [6, 6] }), roughnessMap: tex(cr, { repeat: [6, 6] }) };
}

/** Brushed brass: anisotropic streak roughness. */
export function brushed() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d'), r = rng(5);
  g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const y = r() * s, v = 70 + r() * 90;
    g.strokeStyle = `rgba(${v},${v},${v},.25)`; g.lineWidth = r() * 1.2;
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (r() - .5) * 2); g.stroke();
  }
  return tex(c, { repeat: [2, 2] });
}
