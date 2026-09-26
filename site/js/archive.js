import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chapterColor, chapterCss, yearColor, damp, clamp } from './util.js';
import { walnut, manilaTexture, fibreTexture, brushed } from './textures.js';

// ---------------------------------------------------------------------------------------------
// Level 1 — the hospital as a records archive.
//   wing   = ICD-10 chapter (a freestanding shelving range with a lit range sign)
//   shelf label + divider guide = ICD-10 block inside the chapter
//   chart  = one patient, filed by the chapter/block of their primary diagnosis
//   chart thickness = number of visits; spine label = primary ICD-10 code (call number)
//   coloured top band = chapter; small bottom band = year of last visit (retention sticker)
// ---------------------------------------------------------------------------------------------

export const CH = { H: 0.28, D: 0.235 };          // chart height / depth (m)
const TIERS = 7, TIER_H = 0.34, BASE = 0.14, BOARD = 0.022, SHELF_D = 0.30, UPRIGHT = 0.028;
const DIVIDER_T = 0.004, GAP = 0.0012;
export const chartThickness = (n) => 0.010 + 0.0045 * n;

function buildAtlas(items, cellW, cellH, draw) {
  const cols = Math.floor(2048 / cellW);
  const rows = Math.ceil(items.length / cols);
  const H = THREE.MathUtils.ceilPowerOfTwo(Math.max(cellH, rows * cellH));
  const c = document.createElement('canvas');
  c.width = 2048; c.height = H;
  const g = c.getContext('2d');
  items.forEach((it, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    g.save(); g.translate(x, y); draw(g, it, cellW, cellH); g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false;
  return { texture: t, cols, rows: H / cellH, cellW, cellH, canvasH: H };
}

/** Inject per-instance state (filter glow, trace glow, dim, slide-out, hide) into a standard material. */
function patchInstanced(mat, { atlas = null, fadeUniform = null, glowScale = 1 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHiColor = { value: new THREE.Color(1.0, 0.72, 0.36) };
    sh.uniforms.uTrColor = { value: new THREE.Color(0.35, 0.8, 1.0) };
    sh.uniforms.uGlow = { value: glowScale };
    if (fadeUniform) sh.uniforms.uFade = fadeUniform;
    if (atlas) {
      sh.uniforms.uAtlasGrid = { value: new THREE.Vector2(atlas.cols, atlas.rows) };
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aHi; attribute float aTr; attribute float aDim; attribute float aSlide; attribute float aHide;
        ${atlas ? 'attribute float aSlot; varying float vSlot;' : ''}
        varying float vHi; varying float vTr; varying float vDim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHi = aHi; vTr = aTr; vDim = aDim; ${atlas ? 'vSlot = aSlot;' : ''}
        transformed.z += aSlide / max(length(vec3(instanceMatrix[2])), 1e-4);
        transformed *= (1.0 - aHide);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uHiColor; uniform vec3 uTrColor; uniform float uGlow;
        ${fadeUniform ? 'uniform float uFade;' : ''}
        ${atlas ? 'uniform vec2 uAtlasGrid; varying float vSlot;' : ''}
        varying float vHi; varying float vTr; varying float vDim;`)
      .replace('#include <map_fragment>', atlas ? `
        {
          float col = mod(vSlot, uAtlasGrid.x); float row = floor(vSlot / uAtlasGrid.x);
          vec2 auv = vec2((col + vMapUv.x) / uAtlasGrid.x, (row + 1.0 - vMapUv.y) / uAtlasGrid.y);
          vec4 texel = texture2D(map, auv);
          ${fadeUniform ? 'texel.rgb = mix(vec3(0.93,0.91,0.86), texel.rgb, uFade);' : ''}
          diffuseColor *= texel;
        }` : '#include <map_fragment>')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        diffuseColor.rgb *= mix(1.0, 0.07, vDim);
        totalEmissiveRadiance += (uHiColor * vHi * (0.35 + diffuseColor.rgb) * 0.8 + uTrColor * vTr * 0.7) * uGlow;`);
  };
  mat.customProgramCacheKey = () => 'inst' + (atlas ? 'A' : '') + (fadeUniform ? 'F' : '') + glowScale;
  return mat;
}

export class Archive {
  constructor(stage, hospital) {
    this.stage = stage;
    this.data = hospital;
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.labelFade = { value: 0 };
    this._layout();
    this._buildShelving();
    this._buildCharts();
    this._buildSigns();
  }

  // ---------------------------------------------------------------- layout
  _layout() {
    const chapters = this.data.chapters;
    const byCh = new Map(chapters.map((c) => [c.no, []]));
    this.data.patients.forEach((p, i) => byCh.get(p.ch).push(i));
    this.wings = [];
    for (const ch of chapters) {
      const idx = byCh.get(ch.no);
      idx.sort((a, b) => {
        const A = this.data.patients[a], B = this.data.patients[b];
        return (A.blk || '').localeCompare(B.blk || '') || (A.pcode || '').localeCompare(B.pcode || '', 'en', { numeric: true }) || A.id - B.id;
      });
      // sequence of items: divider guide at each block start, then charts
      const seq = [];
      let lastBlk = null;
      for (const i of idx) {
        const p = this.data.patients[i];
        if (p.blk !== lastBlk) { seq.push({ kind: 'div', blk: p.blk }); lastBlk = p.blk; }
        seq.push({ kind: 'chart', i, t: chartThickness(p.n) });
      }
      const len = seq.reduce((s, it) => s + (it.kind === 'div' ? DIVIDER_T + GAP * 2 : it.t + GAP), 0);
      let w = Math.max(0.26, (len / TIERS) * 1.06 + 0.03);
      let placed;
      for (let tries = 0; tries < 40; tries++) {
        placed = this._pack(seq, w);
        if (placed) break;
        w += 0.02;
      }
      const m = ch.title.match(/\(([A-Z0-9]+-[A-Z0-9]+)\)/);
      this.wings.push({ ch, idx, seq: placed, w, range: m ? m[1].replace('-', '–') : '', count: idx.length });
    }
    const WGAP = 0.16;
    const total = this.wings.reduce((s, w) => s + w.w + UPRIGHT * 2, 0) + WGAP * (this.wings.length - 1);
    const span = THREE.MathUtils.degToRad(148);
    this.R = Math.max(4.0, total / span);
    let s = -total / 2;
    for (const w of this.wings) {
      const full = w.w + UPRIGHT * 2;
      const mid = s + full / 2;
      w.phi = mid / this.R;
      w.pos = new THREE.Vector3(Math.sin(w.phi) * this.R, 0, -Math.cos(w.phi) * this.R);
      w.rotY = -w.phi;
      w.matrix = new THREE.Matrix4().compose(w.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, w.rotY, 0)), new THREE.Vector3(1, 1, 1));
      s += full + WGAP;
    }
    this.height = BASE + TIERS * TIER_H + 0.06;
  }

  _pack(seq, w) {
    const out = [];
    let tier = 0, x = 0;
    for (const it of seq) {
      const need = it.kind === 'div' ? DIVIDER_T + GAP * 2 : it.t + GAP;
      if (x + need > w - 0.01) { tier++; x = 0; }
      if (tier >= TIERS) return null;
      out.push({ ...it, tier, x: x + need / 2 - w / 2 });
      x += need;
    }
    return out;
  }

  tierY(tier) { return BASE + (TIERS - 1 - tier) * TIER_H + BOARD / 2; }

  // ---------------------------------------------------------------- room
  buildFloor(stoneTex) {
    const g = new THREE.CircleGeometry(30, 96);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({
      color: 0x19191c, map: stoneTex.map, roughnessMap: stoneTex.roughnessMap, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.25,
    });
    this.stage.makeReflective(m);
    const floor = new THREE.Mesh(g, m);
    floor.receiveShadow = true;
    this.stage.scene.add(floor);
    this.stage.reflHidden.push(floor);
    this.floor = floor;

    // brass inlay ring where the reading dais rises
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.215, 128).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }));
    ring.position.y = 0.001;
    this.stage.scene.add(ring);
    this.stage.reflHidden.push(ring);

    // rotunda wall behind the ranges
    const wallR = Math.max(this.R * 2.6, 13);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(wallR, wallR, 12, 160, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, side: THREE.BackSide, envMapIntensity: 0.08 }));
    wall.position.y = 6;
    this.stage.scene.add(wall);

    // backlit plaster behind the ranges: a soft vertical glow that silhouettes the shelving
    const bR = this.R + 1.1;
    const bgeo = new THREE.CylinderGeometry(bR, bR, 6, 128, 1, true, Math.PI - 1.55, 3.1);
    const bc = document.createElement('canvas'); bc.width = 8; bc.height = 256;
    const bgx = bc.getContext('2d');
    const grd = bgx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.45, 'rgb(38,30,24)'); grd.addColorStop(0.78, 'rgb(70,56,44)'); grd.addColorStop(1, 'rgb(20,16,13)');
    bgx.fillStyle = grd; bgx.fillRect(0, 0, 8, 256);
    const gt = new THREE.CanvasTexture(bc); gt.colorSpace = THREE.SRGBColorSpace;
    const back = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ map: gt, side: THREE.BackSide, fog: false }));
    back.position.y = 3;
    this.stage.scene.add(back);
  }

  // ---------------------------------------------------------------- shelving
  _buildShelving() {
    const wood = walnut();
    wood.map.repeat.set(1, 1);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a55, map: wood.map, roughnessMap: wood.roughnessMap, roughness: 0.42, metalness: 0.0 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a262, metalness: 1, roughness: 0.28, roughnessMap: brushed() });
    const woodParts = [], brassParts = [];
    const box = (w, h, d, x, y, z, M, arr) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      g.applyMatrix4(M);
      arr.push(g);
    };
    this.labelHolders = [];
    for (const wg of this.wings) {
      const M = wg.matrix, w = wg.w, H = this.height;
      const zc = -SHELF_D / 2;
      box(UPRIGHT, H, SHELF_D + 0.02, -w / 2 - UPRIGHT / 2, H / 2, zc, M, woodParts);
      box(UPRIGHT, H, SHELF_D + 0.02, w / 2 + UPRIGHT / 2, H / 2, zc, M, woodParts);
      box(w + UPRIGHT * 2, H, 0.014, 0, H / 2, -SHELF_D - 0.007, M, woodParts);
      box(w, BASE - 0.01, SHELF_D - 0.03, 0, (BASE - 0.01) / 2, zc - 0.015, M, woodParts);
      for (let k = 0; k <= TIERS; k++) {
        const y = BASE + k * TIER_H;
        box(w, BOARD, SHELF_D, 0, y, zc, M, woodParts);
        box(w, 0.014, 0.004, 0, y, 0.002, M, brassParts);          // brass shelf lip
      }
      box(w + UPRIGHT * 2 + 0.03, 0.05, SHELF_D + 0.06, 0, H + 0.025, zc + 0.01, M, woodParts); // crown
      // shelf label holders at every block start (ICD-10 block call number)
      for (const it of wg.seq) {
        if (it.kind !== 'div') continue;
        const y = this.tierY(it.tier) - 0.001;
        const lx = clamp(it.x + 0.024, -w / 2 + 0.03, w / 2 - 0.03);
        box(0.056, 0.022, 0.003, lx, y - 0.004, 0.006, M, brassParts);
        this.labelHolders.push({ blk: it.blk, x: lx, y: y - 0.004, M, ch: wg.ch.no });
      }
    }
    const woodMesh = new THREE.Mesh(mergeGeometries(woodParts), woodMat);
    woodMesh.castShadow = woodMesh.receiveShadow = true;
    const brassMesh = new THREE.Mesh(mergeGeometries(brassParts), brass);
    this.group.add(woodMesh, brassMesh);

    // block label inserts (atlas)
    const blocks = [...new Set(this.labelHolders.map((l) => l.blk))];
    const bslot = new Map(blocks.map((b, i) => [b, i]));
    const atlas = buildAtlas(blocks, 128, 48, (g, b, w, h) => {
      g.fillStyle = '#f1ece0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b1a18'; g.font = '600 26px "JetBrains Mono", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.replace('-', '–'), w / 2, h / 2 + 1, w - 8);
    });
    const lg = new THREE.PlaneGeometry(1, 1);
    const lm = patchInstanced(new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.6 }), { atlas, fadeUniform: this.labelFade });
    const L = new THREE.InstancedMesh(lg, lm, this.labelHolders.length);
    const slots = new Float32Array(this.labelHolders.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(0.05, 0.017, 1);
    this.labelHolders.forEach((l, i) => {
      m4.compose(new THREE.Vector3(l.x, l.y, 0.0085), q, sc).premultiply(l.M);
      L.setMatrixAt(i, m4);
      slots[i] = bslot.get(l.blk);
    });
    const zero = (n) => new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    lg.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
    for (const a of ['aHi', 'aTr', 'aDim', 'aSlide', 'aHide']) lg.setAttribute(a, zero(this.labelHolders.length));
    this.blockLabels = L;
    this.group.add(L);

    // divider guides (pressboard cards, taller than charts so their tops show the block breaks)
    const divs = [];
    for (const wg of this.wings) for (const it of wg.seq) if (it.kind === 'div') divs.push({ wg, it });
    const dg = new THREE.BoxGeometry(1, 1, 1);
    const dm = new THREE.MeshStandardMaterial({ roughness: 0.75, map: fibreTexture(2) });
    const D = new THREE.InstancedMesh(dg, dm, divs.length);
    divs.forEach(({ wg, it }, i) => {
      const h = CH.H + 0.035;
      m4.compose(new THREE.Vector3(it.x, this.tierY(it.tier) + BOARD / 2 + h / 2, -0.03 - CH.D / 2), q, new THREE.Vector3(DIVIDER_T, h, CH.D + 0.01)).premultiply(wg.matrix);
      D.setMatrixAt(i, m4);
      D.setColorAt(i, chapterColor(wg.ch.no).multiplyScalar(0.55));
    });
    D.castShadow = true; D.receiveShadow = true;
    this.group.add(D);
  }

  // ---------------------------------------------------------------- charts
  _buildCharts() {
    const P = this.data.patients, n = P.length;
    this.slots = new Array(n);
    for (const wg of this.wings) for (const it of wg.seq) if (it.kind === 'chart') this.slots[it.i] = { wg, it };

    const mats = [];
    this.chartMatrices = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const { wg, it } = this.slots[i];
      m4.compose(new THREE.Vector3(it.x, this.tierY(it.tier) + BOARD / 2 + CH.H / 2 + 0.0005, -0.03 - CH.D / 2), q, new THREE.Vector3(it.t, CH.H, CH.D)).premultiply(wg.matrix);
      this.chartMatrices.push(m4.clone());
    }

    // shared per-instance state
    this.state = {};
    for (const a of ['aHi', 'aTr', 'aDim', 'aSlide', 'aHide']) {
      this.state[a] = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      this.state[a].setUsage(THREE.DynamicDrawUsage);
    }
    this.target = { aHi: new Float32Array(n), aTr: new Float32Array(n), aDim: new Float32Array(n), aSlide: new Float32Array(n) };

    const mk = (geo, mat, colorFn) => {
      for (const a in this.state) geo.setAttribute(a, this.state[a]);
      const im = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        im.setMatrixAt(i, this.chartMatrices[i]);
        if (colorFn) im.setColorAt(i, colorFn(i));
      }
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      mats.push(im);
      return im;
    };

    // folder body: manila card stock, slightly varied like real aged folders
    const manila = manilaTexture();
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = patchInstanced(new THREE.MeshStandardMaterial({ map: manila, roughness: 0.82, roughnessMap: fibreTexture(1) }));
    const tint = new THREE.Color();
    this.body = mk(bodyGeo, bodyMat, (i) => tint.setHSL(0.11 + ((i * 7919) % 13) / 900, 0.3, 0.8 + ((i * 104729) % 17) / 250, THREE.SRGBColorSpace).clone());
    this.body.castShadow = true; this.body.receiveShadow = true;

    // chapter colour band across the spine (top)
    const bandH = 0.05 / CH.H, bandY = 0.105 / CH.H;
    const bandGeo = new THREE.BoxGeometry(1.03, bandH, 0.012 / CH.D).translate(0, bandY, 0.5);
    this.bands = mk(bandGeo, patchInstanced(new THREE.MeshStandardMaterial({ roughness: 0.45 })), (i) => chapterColor(P[i].ch));

    // year-of-last-visit sticker (bottom)
    const yrGeo = new THREE.BoxGeometry(1.03, 0.018 / CH.H, 0.012 / CH.D).translate(0, -0.105 / CH.H, 0.5);
    this.years = mk(yrGeo, patchInstanced(new THREE.MeshStandardMaterial({ roughness: 0.4 })), (i) => new THREE.Color(yearColor(+P[i].span[1].slice(0, 4))));

    // spine call-number label: primary ICD-10 code, printed vertically
    const codes = [...new Set(P.map((p) => p.pcode || '—'))];
    const cslot = new Map(codes.map((c, i) => [c, i]));
    const atlas = buildAtlas(codes, 32, 128, (g, code, w, h) => {
      g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h);
      g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
      g.fillStyle = '#141414'; g.font = '600 19px "JetBrains Mono", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(code, 0, 1, h - 10);
    });
    const lblGeo = new THREE.PlaneGeometry(0.78, 0.1 / CH.H).translate(0, 0.0, 0.5 + 0.0065 / CH.D);
    const slotArr = new Float32Array(n);
    P.forEach((p, i) => (slotArr[i] = cslot.get(p.pcode || '—')));
    lblGeo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slotArr, 1));
    this.labels = mk(lblGeo, patchInstanced(new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55 }), { atlas, fadeUniform: this.labelFade }));
    this.meshes = mats;
  }

  // ---------------------------------------------------------------- signs
  _buildSigns() {
    this.signs = [];
    for (const wg of this.wings) {
      const W = wg.w + UPRIGHT * 2 + 0.03, Hs = 0.2;
      const c = document.createElement('canvas');
      c.width = 1024; c.height = Math.round(1024 * Hs / W);
      const g = c.getContext('2d');
      const s = c.height / 100;
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      const col = chapterCss(wg.ch.no);
      g.fillStyle = col; g.fillRect(c.width * 0.06, 14 * s, 3 * s, 72 * s);
      g.fillStyle = '#fff';
      g.font = `300 ${34 * s}px Inter, sans-serif`;
      g.textBaseline = 'alphabetic';
      g.fillText(wg.ch.roman, c.width * 0.06 + 10 * s, 44 * s);
      g.font = `600 ${17 * s}px Inter, sans-serif`;
      g.fillText(wg.ch.name.toUpperCase(), c.width * 0.06 + 10 * s, 68 * s, c.width * 0.86);
      g.fillStyle = 'rgba(255,255,255,0.62)';
      g.font = `500 ${12 * s}px "JetBrains Mono", monospace`;
      g.fillText(`${wg.range}  ·  ${wg.count} charts`, c.width * 0.06 + 10 * s, 86 * s, c.width * 0.86);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.18, metalness: 0.3, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(W, Hs, 0.012), [mat, mat, mat, mat, mat, mat]);
      const frontMat = mat;
      plate.material = [new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }), new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }),
        new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }), new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }), frontMat,
        new THREE.MeshStandardMaterial({ color: 0x0a0b0d })];
      plate.position.set(0, this.height + 0.05 + Hs / 2 + 0.02, 0.0);
      plate.applyMatrix4(wg.matrix);
      plate.userData = { wing: wg };
      this.group.add(plate);
      wg.sign = plate;
      wg.signMat = mat;
      wg.signTop = plate.position.clone().add(new THREE.Vector3(0, Hs / 2 + 0.06, 0));
      this.signs.push(plate);
    }
  }

  // ---------------------------------------------------------------- lights for this level
  buildLights() {
    const s = this.stage.scene;
    s.add(new THREE.HemisphereLight(0x9aa6b8, 0x1a120c, 0.18));
    const key = new THREE.SpotLight(0xffe2bf, 340, 34, 0.42, 0.8, 1.5);
    key.position.set(0.8, 9.5, this.R * 2.0 + 3);
    key.target.position.set(0, 1.0, -2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    key.shadow.camera.near = 4; key.shadow.camera.far = 30;
    s.add(key, key.target);
    this.key = key;
    // cool top light from high behind the ranges: separates the crowns from the dark wall
    const rim = new THREE.DirectionalLight(0x9db8ff, 0.5);
    rim.position.set(0, 12, -this.R * 2.2);
    s.add(rim);
    // soft pools on the ranges (no shadows): three spots from above the reading room
    this.pools = [-0.75, 0, 0.75].map((a) => {
      const sp = new THREE.SpotLight(0xffd9a8, 60, this.R * 2.2, 0.42, 0.9, 1.4);
      sp.position.set(0, 5.2, 0.6);
      sp.target.position.set(Math.sin(a) * this.R, 1.1, -Math.cos(a) * this.R);
      s.add(sp, sp.target);
      return sp;
    });
    // soft wash along the ranges
    const wash = new THREE.PointLight(0xffd7a8, 1.5, this.R * 1.4, 1.6);
    wash.position.set(0, 4.2, -this.R * 0.35);
    s.add(wash);
    this.wash = wash;
  }

  // ---------------------------------------------------------------- state
  /** match: Set of patient indices (filter) or null; trace: Set (diagnosis trace) or null. */
  setHighlight(match, trace, focusMode = false) {
    const n = this.data.patients.length, T = this.target;
    const any = !!(match || trace);
    for (let i = 0; i < n; i++) {
      const m = match ? match.has(i) : false, t = trace ? trace.has(i) : false;
      T.aHi[i] = m && !trace ? 1 : 0;
      T.aTr[i] = t ? 1 : 0;
      const lit = trace ? t && (!match || match.has(i)) : m;
      T.aDim[i] = focusMode ? 0.85 : any ? (lit ? 0 : 0.78) : 0;
      if (trace && match && !match.has(i)) T.aTr[i] = 0;
      T.aSlide[i] = any && lit ? 0.07 : 0;
    }
  }

  setHidden(i, hidden) {
    this.state.aHide.array[i] = hidden ? 1 : 0;
    this.state.aHide.needsUpdate = true;
  }

  update(dt, camera) {
    const S = this.state, T = this.target, n = this.data.patients.length;
    let changed = false;
    for (const k of ['aHi', 'aTr', 'aDim', 'aSlide']) {
      const a = S[k].array, t = T[k];
      let ch = false;
      const h = this.hoverIdx ?? -1;
      for (let i = 0; i < n; i++) {
        let tv = t[i];
        if (i === h) tv = k === 'aSlide' ? Math.max(tv, 0.05) : k === 'aHi' ? Math.max(tv, 0.55) : k === 'aDim' ? 0 : tv;
        const d = tv - a[i];
        if (Math.abs(d) > 1e-4) { a[i] += d * (1 - Math.exp(-(k === 'aSlide' ? 7 : 6) * dt)); ch = true; }
        else if (d !== 0) { a[i] = tv; ch = true; }
      }
      if (ch) { S[k].needsUpdate = true; changed = true; }
    }
    // level of detail: printed labels only resolve when the camera is near the shelves
    const cp = camera.position;
    const dShelf = Math.abs(Math.hypot(cp.x, cp.z) - this.R);
    const near = Math.hypot(dShelf, Math.max(0, cp.y - 2.5));
    const fade = clamp(1 - (near - 1.6) / 1.6, 0, 1);
    this.labelFade.value = damp(this.labelFade.value, fade, 6, dt);
    const vis = this.labelFade.value > 0.01;
    this.labels.visible = vis;
    this.blockLabels.visible = vis;
    return changed;
  }

  /** World position of a chart's spine centre (for tooltips, fly-to). */
  chartWorld(i, out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.chartMatrices[i]);
  }
  chartFacing(i) {
    const { wg } = this.slots[i];
    return new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), wg.rotY);
  }
  chartQuat(i) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.slots[i].wg.rotY, 0));
  }
}
