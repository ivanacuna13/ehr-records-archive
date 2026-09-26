import * as THREE from 'three';
import { ThreadSystem } from './threads.js';
import { layoutDoc, renderDoc, findingRect, renderFaceSheet, renderFolder, renderOrderSlip, renderProblemStrip, renderCover, PAGE_W, PAGE_H } from './docs.js';
import { tweens, easeInOutCubic, easeOutCubic, problemColor, chapterColor, chapterCss, yearColor, dateNum, clamp, lerp, damp } from './util.js';
import { manilaTexture, fibreTexture } from './textures.js';
import { CH, chartThickness } from './archive.js';

// ---------------------------------------------------------------------------------------------
// Level 2 — one patient's chart, opened on the reading dais.
//   hub      = the open chart jacket + face sheet at the centre (everything is keyed to it)
//   spokes   = brass binding from the hub to each visit folder
//   folders  = encounters, placed clockwise by date on the outer arc (the timeline)
//   sheets   = that encounter's chart sections, lifted out of the folder in an exploded cascade
//   rings    = one per diagnosis on the master problem list; the tab on the list starts the ring,
//              beads mark every visit where it was documented, dashes = not yet documented
//   highlights = findings on the exact printed line they were abstracted from, threaded to the
//              bead of the diagnosis they support at that visit
//   pink slip  = imaging order leaving the visit; its thread returns to the radiology report
// ---------------------------------------------------------------------------------------------

export const Y0 = 0.74;                       // dais top
const TILT = 65 * Math.PI / 180, STEP_UP = 0.03, STEP_OUT = 0.04, BASE_UP = 0.14, BASE_IN = 0.12;
const cascade = (k) => new THREE.Vector3(0, BASE_UP + k * STEP_UP, BASE_IN - k * STEP_OUT);
// reading spread for the visit in focus: the pages lift into a wall in reading order
// (rows x columns, all faces visible) so every highlighted line can be read in place
function gridLayout(n) { const rows = n <= 8 ? 2 : 3; return { rows, cols: Math.ceil(n / rows) }; }
function cascadePose(k, s, cover, n = 12) {
  const tiltC = TILT;
  const p0 = new THREE.Vector3(0, BASE_UP + k * STEP_UP, BASE_IN - k * STEP_OUT);
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(cover ? tiltC : -Math.PI / 2 + tiltC, 0, 0));
  if (s <= 0) return { p: p0, q: q0, s: new THREE.Vector3(1, 1, 1) };
  let p1, q1;
  if (cover) {
    p1 = new THREE.Vector3(0, 0.004, 0.002);
    q1 = new THREE.Quaternion();
  } else {
    const { rows, cols } = gridLayout(n);
    const row = Math.floor(k / cols), col = k % cols;
    p1 = new THREE.Vector3((col - (cols - 1) / 2) * 0.232, 0.24 + (rows - 1 - row) * 0.3, 0.62);
    q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 84 * Math.PI / 180, 0, 0));
  }
  return { p: p0.lerp(p1, s), q: q0.slerp(q1, s), s: new THREE.Vector3(1, 1, 1) };
}
const SHEET_W = 0.216, SHEET_H = 0.2795;       // US letter
const M_PER_PT = SHEET_W / PAGE_W;
const HUB_R = 0.30;
const polar = (r, a, y = Y0) => new THREE.Vector3(r * Math.sin(a), y, -r * Math.cos(a));
const DEG = Math.PI / 180;

function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function paperFace(mat) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.90, 0.88, 0.83);');
  };
  mat.customProgramCacheKey = () => 'paperFace';
  return mat;
}

let _shared;
function shared() {
  if (_shared) return _shared;
  const manila = manilaTexture();
  const fibre = fibreTexture(1);
  _shared = {
    manila, fibre,
    manilaMat: new THREE.MeshStandardMaterial({ map: manila, roughness: 0.8, roughnessMap: fibre }),
    paperBack: new THREE.MeshStandardMaterial({ color: 0xefeadd, roughness: 0.9, roughnessMap: fibre }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a262, metalness: 1, roughness: 0.26 }),
    brassDim: new THREE.MeshStandardMaterial({ color: 0x8c7040, metalness: 1, roughness: 0.4 }),
  };
  return _shared;
}

/**
 * Finding highlights. Two passes over the same quads: highlighter ink (multiply, so the typed
 * text stays legible) and an additive glow that only appears when the finding is traced/hovered.
 */
function highlightMaterial(stateTex, glow) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uState: { value: stateTex }, uVis: { value: 1 } },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: `attribute float aF; varying float vF; varying vec2 vUv2;
      void main(){ vF = aF; vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform sampler2D uState; uniform float uVis; varying float vF; varying vec2 vUv2;
      void main(){
        vec4 s = texelFetch(uState, ivec2(int(vF + 0.5), 0), 0);
        float act = s.r, dim = s.g, present = s.b, hov = s.a;
        vec3 col = present > 0.5 ? vec3(1.0, 0.80, 0.16) : vec3(0.52, 0.72, 1.0);
        float edge = smoothstep(0.0, 0.015, vUv2.x) * smoothstep(1.0, 0.985, vUv2.x);
        ${glow
    ? 'gl_FragColor = vec4(col * (act * 0.45 + hov * 0.3) * uVis * (1.0 - dim) * edge, 1.0);'
    : 'float a = (0.62 + hov * 0.25) * mix(1.0, 0.3, dim) * uVis * edge; gl_FragColor = vec4(mix(vec3(1.0), col, a), 1.0);'}
      }`,
  });
  if (glow) m.blending = THREE.AdditiveBlending;
  else { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.DstColorFactor; m.blendDst = THREE.ZeroFactor; }
  return m;
}

export class PatientChart {
  constructor(stage, p, meta) {
    this.stage = stage;
    this.p = p;
    this.meta = meta;                        // hospital entry (for chapter colour etc.)
    this.root = new THREE.Group();
    stage.scene.add(this.root);
    this.anim = [];                          // objects with assembled/exploded local transforms
    this.pickables = [];
    this.sheets = [];
    this.exploded = 0;                       // 0 assembled .. 1 exploded
    this.traceDid = null;
    this.time = 0;
    this._layout();
    this._build();
  }

  // ------------------------------------------------------------------------------ layout
  _layout() {
    const p = this.p;
    const probs = p.problems;
    // ring radii: core problems (active/chronic) get wider rows than secondary ones
    let r = 0.40;
    this.rows = probs.map((pr) => {
      const h = pr.kind === 'secondary' ? 0.034 : 0.056;
      const row = { r: r + h / 2, h };
      r += h;
      return row;
    });
    this.rMax = r;
    this.Rt = this.rMax + 0.09;                       // date scale ring
    const n = p.encounters.length;
    const minSep = 0.5;
    const SPAN = 78 * DEG;
    this.Rf = Math.max(this.Rt + 0.34, ((n - 1) * minSep) / (2 * SPAN) + 0.05, 1.05);
    const sep = minSep / this.Rf;
    const d = p.encounters.map((e) => dateNum(e.date));
    const d0 = Math.min(...d), d1 = Math.max(...d);
    let a = d.map((x) => (n === 1 ? 0 : -SPAN + (2 * SPAN * (x - d0)) / Math.max(1, d1 - d0)));
    for (let i = 1; i < n; i++) a[i] = Math.max(a[i], a[i - 1] + sep);
    if (a[n - 1] > SPAN) { a[n - 1] = SPAN; for (let i = n - 2; i >= 0; i--) a[i] = Math.min(a[i], a[i + 1] - sep); }
    if (a[0] < -SPAN - 1e-6) { const s = -SPAN - a[0]; a = a.map((x) => x + s); }
    this.alpha = a;
    this.dates = d;
    this.Rd = this.Rf + 0.62;
    this.encIndex = new Map(p.encounters.map((e, i) => [e.id, i]));
    this.probIndex = new Map(probs.map((pr, i) => [pr.did, i]));
  }

  dateToAngle(x) {
    const d = this.dates, a = this.alpha, n = d.length;
    if (n === 1) return a[0];
    if (x <= d[0]) return a[0] - ((d[0] - x) / Math.max(1, d[n - 1] - d[0])) * (a[n - 1] - a[0]);
    for (let i = 1; i < n; i++) if (x <= d[i]) return lerp(a[i - 1], a[i], d[i] === d[i - 1] ? 1 : (x - d[i - 1]) / (d[i] - d[i - 1]));
    return a[n - 1];
  }

  // ------------------------------------------------------------------------------ build
  _build() {
    const S = shared(), p = this.p, root = this.root;

    // dais (reading surface) — rises from the floor when the chart is opened
    const dais = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(this.Rd, this.Rd * 1.01, Y0, 128),
      new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.35 }));
    top.position.y = Y0 / 2;
    top.receiveShadow = true; top.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(this.Rd, 0.008, 12, 160), S.brass);
    rim.rotation.x = Math.PI / 2; rim.position.y = Y0;
    dais.add(top, rim);
    dais.position.y = -Y0 - 0.02;
    root.add(dais);
    this.dais = dais;

    this.content = new THREE.Group();
    root.add(this.content);
    this.content.visible = false;

    this._buildJacket();
    this._buildStrip();
    this._buildFolders();
    this._buildRingsAndSpokes();
    this._computeThreads();
  }

  _anim(obj, A, E, delay = 0) {
    const rec = { obj, A, E, delay };
    this.anim.push(rec);
    return rec;
  }

  _buildJacket() {
    const S = shared(), p = this.p;
    const t = chartThickness(p.encounters.length);
    this.thickness = t;
    const W = CH.D, L = CH.H;               // lying: width along x, length along z
    const jacket = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, 0.0016, L), S.manilaMat);
    back.position.set(W / 2, 0.0008, 0);
    back.castShadow = back.receiveShadow = true;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.004, t, L), new THREE.MeshStandardMaterial({ color: 0xb99a60, roughness: 0.8 }));
    spine.position.set(0.001, t / 2, 0);
    const chCol = chapterColor(this.meta.ch);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.006, t + 0.002, 0.05), new THREE.MeshStandardMaterial({ color: chCol, roughness: 0.45 }));
    band.position.set(0.0, t / 2, -0.105);
    const yr = new THREE.Mesh(new THREE.BoxGeometry(0.006, t + 0.002, 0.018), new THREE.MeshStandardMaterial({ color: yearColor(+this.meta.span[1].slice(0, 4)), roughness: 0.4 }));
    yr.position.set(0.0, t / 2, 0.105);
    // cover: hinged at the spine
    const pivot = new THREE.Group();
    pivot.position.set(0, t, 0);
    const coverTex = canvasTex(renderCover(p, chapterCss(this.meta.ch)));
    const inner = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.8, roughnessMap: S.fibre });
    const outerTex = canvasTex(renderCover(p, chapterCss(this.meta.ch), 1.0, true));
    const outer = new THREE.MeshStandardMaterial({ map: outerTex, roughness: 0.8, roughnessMap: S.fibre });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(W, 0.0016, L), [S.manilaMat, S.manilaMat, outer, inner, S.manilaMat, S.manilaMat]);
    cover.position.set(W / 2, 0, 0);
    cover.castShadow = true;
    pivot.add(cover);
    jacket.add(back, spine, band, yr, pivot);
    this.jacket = jacket;
    this.coverPivot = pivot;
    this.root.add(jacket);
    jacket.userData.pick = { kind: 'chart', label: `Chart · PT ${p.id}` };
    back.userData.pick = cover.userData.pick = { kind: 'chart' };
    this.pickables.push(back, cover);
    // resting place: back panel centred on the hub
    this.jacketRest = { p: new THREE.Vector3(-W / 2, Y0, 0), q: new THREE.Quaternion() };
    // cover open/closed rotation handled in update()
    this.coverOpen = 0;

    // face sheet lives on the back panel (first page of the chart)
    const fsTex = canvasTex(renderFaceSheet(p, 1.8));
    const face = this._sheetMesh(new THREE.MeshStandardMaterial({ map: fsTex, roughness: 0.8, roughnessMap: S.fibre }));
    face.userData.pick = { kind: 'face', label: `Face sheet · PT ${p.id}`, sub: `${p.age} y · ${p.sex} · ${p.insurance}` };
    this.pickables.push(face);
    this.content.add(face);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this._anim(face, { p: new THREE.Vector3(0, Y0 + t - 0.002, 0), q: flat, s: new THREE.Vector3(1, 1, 1) },
      { p: new THREE.Vector3(0, Y0 + 0.004, 0), q: flat, s: new THREE.Vector3(1, 1, 1) }, 0.0);
    this.face = face;
  }

  /** One draw call per sheet: a double-sided plane whose back face prints as blank paper. */
  _sheetMesh(frontMat, w = SHEET_W, h = SHEET_H) {
    paperFace(frontMat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frontMat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  _buildStrip() {
    const p = this.p, probs = p.problems;
    const zMin = 0.16, zMax = this.rMax + 0.02, x0 = -0.005, x1 = 0.60;
    const pxPerM = Math.min(2600, 4096 / Math.max(zMax - zMin, x1 - x0));
    const c = renderProblemStrip(probs, this.rows, x1 - x0, zMin, zMax, pxPerM);
    const tex = canvasTex(c);
    const S = shared();
    const strip = new THREE.Group();
    const plane = this._sheetMesh(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, roughnessMap: S.fibre }), x1 - x0, zMax - zMin);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((x0 + x1) / 2, 0.0004, (zMin + zMax) / 2);
    plane.receiveShadow = true;
    plane.userData.pick = { kind: 'strip' };
    strip.add(plane);
    this.stripPlane = plane;
    this.stripBounds = { zMin, zMax, x0, x1 };
    this.pickables.push(plane);
    // index tabs — one per diagnosis, sitting where its ring begins
    this.tabs = probs.map((pr, i) => {
      const row = this.rows[i];
      const col = new THREE.Color(problemColor(i));
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0026, row.h * 0.74),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, emissive: col, emissiveIntensity: 0.08 }));
      m.position.set(-0.012, 0.0014, row.r);
      m.castShadow = true;
      m.userData.pick = { kind: 'problem', i, label: `${pr.code} · ${pr.name}`, sub: `Problem list tab · SNOMED ${pr.snomed}` };
      this.pickables.push(m);
      strip.add(m);
      return m;
    });
    this.content.add(strip);
    // assembled: folded down to page size inside the chart
    const sA = new THREE.Vector3(SHEET_W / (x1 - x0), 1, SHEET_H / (zMax - zMin));
    this._anim(strip, { p: new THREE.Vector3(-(x0 + x1) / 2 * sA.x, Y0 + this.thickness - 0.004, -(zMin + zMax) / 2 * sA.z), q: new THREE.Quaternion(), s: sA },
      { p: new THREE.Vector3(0, Y0 + 0.001, 0), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }, 0.05);
    this.strip = strip;
  }

  _buildFolders() {
    const S = shared(), p = this.p, n = p.encounters.length;
    const findingsBySid = new Map();
    p.findings.forEach((f) => { if (f.sid != null) { if (!findingsBySid.has(f.sid)) findingsBySid.set(f.sid, []); findingsBySid.get(f.sid).push(f); } });
    this.findingsBySid = findingsBySid;
    this.folders = [];
    this.hlMeshes = [];
    // finding state texture (shared by all highlight overlays)
    const NF = Math.max(1, p.findings.length);
    this.fState = new Float32Array(NF * 4);
    p.findings.forEach((f, i) => { this.fState[i * 4 + 2] = f.present === 0 ? 0 : 1; });
    this.fTex = new THREE.DataTexture(this.fState, NF, 1, THREE.RGBAFormat, THREE.FloatType);
    this.fTex.needsUpdate = true;
    this.fTarget = new Float32Array(this.fState);

    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    p.encounters.forEach((e, i) => {
      const frame = new THREE.Group();
      this.content.add(frame);
      // back panel with staggered tab
      const ftex = canvasTex(renderFolder(e, i, i % 3, 1.1));
      const fw = 640 * M_PER_PT, fh = 830 * M_PER_PT;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh),
        new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.8, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }));
      panel.rotation.x = -Math.PI / 2;
      panel.position.set(0, 0.0003, -(fh - SHEET_H) / 2 + 0.004);
      panel.receiveShadow = true; panel.castShadow = true;
      panel.userData.pick = { kind: 'folder', i, label: `Visit ${i + 1} · ${e.date}`, sub: `${e.type} · ${e.dept}` };
      this.pickables.push(panel);
      frame.add(panel);
      // front cover: in the exploded view it lifts off as the top layer, behind the sheets
      const cover = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.985, 0.0012, SHEET_H + 0.004), S.manilaMat);
      cover.castShadow = true;
      cover.userData.pick = panel.userData.pick;
      this.pickables.push(cover);
      frame.add(cover);
      const nS = e.sections.length;
      const coverRec = this._anim(cover, { p: new THREE.Vector3(0, 0.0016 + nS * 0.00025 + 0.001, 0.002), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) },
        cascadePose(nS + 0.4, 0, true), 0.3 + i * 0.07);
      coverRec.k = nS + 0.4; coverRec.cover = true;
      const cascadeRecs = [coverRec];
      const hinge = null;

      // A: stacked inside the chart (newest on top), E: on the timeline arc
      const yA = Y0 + 0.003 + (i / Math.max(1, n)) * (this.thickness - 0.008);
      const a = this.alpha[i];
      const qE = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0));
      const rec = this._anim(frame, { p: new THREE.Vector3(0, yA, 0), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) },
        { p: polar(this.Rf, a, Y0 + 0.001), q: qE, s: new THREE.Vector3(1, 1, 1) }, 0.12 + i * 0.07);

      // sheets: one per chart section, cascading out of the folder
      const secs = e.sections;
      const sheetRecs = [];
      secs.forEach((s, k) => {
        const doc = {
          sid: s.sid, type: s.type, lines: s.lines, findings: findingsBySid.get(s.sid) || [],
          meta: { pid: p.id, sex: p.sex, age: p.age, eid: e.id, date: e.date, dept: e.dept, attending: e.attending, type: e.type, order: s.type === 'imaging' ? e.orders[0] : null },
        };
        layoutDoc(doc);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, roughnessMap: S.fibre });
        const sheet = this._sheetMesh(mat);
        sheet.userData.pick = { kind: 'sheet', i, k, sid: s.sid };
        this.pickables.push(sheet);
        frame.add(sheet);
        const aRec = this._anim(sheet,
          { p: new THREE.Vector3(0, 0.0012 + k * 0.00025, 0.004), q: flat, s: new THREE.Vector3(1, 1, 1) },
          cascadePose(k, 0, false), 0.35 + i * 0.07 + k * 0.03);
        aRec.k = k;
        cascadeRecs.push(aRec);
        const sh = { mesh: sheet, mat, doc, enc: i, k, sid: s.sid, res: 0, rec: aRec };
        this.sheets.push(sh);
        sheetRecs.push(sh);
        // finding highlights on this sheet
        this._buildHighlights(sh);
      });
      // imaging order slip(s): leave the folder outward, the result returns as the report sheet
      const slips = e.orders.map((o, oi) => {
        const st = canvasTex(renderOrderSlip(o, e, p, 1.2));
        const slip = this._sheetMesh(new THREE.MeshStandardMaterial({ map: st, roughness: 0.75 }), SHEET_W, SHEET_W * 396 / 612);
        slip.geometry.rotateX(-Math.PI / 2);
        slip.castShadow = true;
        slip.userData.pick = { kind: 'order', i, oi, label: `Imaging order #${o.order_id}`, sub: `${o.modality} · ${o.region} · ${o.priority}` };
        this.pickables.push(slip);
        frame.add(slip);
        const depth = SHEET_W * 396 / 612;
        this._anim(slip, { p: new THREE.Vector3(0, 0.0009, 0.02), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) },
          { p: new THREE.Vector3(0.02 * oi, 0.0015 + oi * 0.001, -fh / 2 - depth / 2 - 0.035 - oi * 0.02), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.06, 0)), s: new THREE.Vector3(1, 1, 1) }, 0.6 + i * 0.07);
        return { mesh: slip, order: o };
      });
      this.folders.push({ e, frame, panel, rec, sheets: sheetRecs, slips, cover, cascadeRecs, spread: 0 });
    });
  }

  _buildHighlights(sh) {
    const doc = sh.doc;
    const pos = [], uv = [], fi = [], idx = [];
    const quads = [];
    doc.findings.forEach((f) => {
      const r = findingRect(doc, f);
      if (!r) return;
      const [x0, y0, x1, y1] = r;
      const lx0 = (x0 / PAGE_W - 0.5) * SHEET_W, lx1 = (x1 / PAGE_W - 0.5) * SHEET_W;
      const ly0 = (0.5 - y1 / PAGE_H) * SHEET_H, ly1 = (0.5 - y0 / PAGE_H) * SHEET_H;
      const z = 0.00022 + quads.length * 0.000002;
      const b = pos.length / 3;
      pos.push(lx0, ly0, z, lx1, ly0, z, lx1, ly1, z, lx0, ly1, z);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      fi.push(f.i, f.i, f.i, f.i);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      quads.push({ f, cx: lx0 - 0.002, cy: (ly0 + ly1) / 2 });
    });
    sh.quads = quads;
    if (!quads.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(fi, 1));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, highlightMaterial(this.fTex, false));
    m.renderOrder = 3;
    m.userData.pick = { kind: 'highlights', sheet: sh };
    const glow = new THREE.Mesh(g, highlightMaterial(this.fTex, true));
    glow.renderOrder = 4;
    sh.mesh.add(m, glow);
    sh.hl = m;
    this.hlMeshes.push(m, glow);
    this.pickables.push(m);
    this.stage.aoHidden.add(m); this.stage.aoHidden.add(glow);
  }

  _buildRingsAndSpokes() {
    const S = shared(), p = this.p;
    const statics = new THREE.Group();
    this.content.add(statics);
    this.statics = statics;
    // hub binding collar
    const collar = new THREE.Mesh(new THREE.TorusGeometry(HUB_R, 0.005, 10, 96), S.brass);
    collar.rotation.x = Math.PI / 2; collar.position.y = Y0 + 0.003;
    statics.add(collar);
    // spokes: brass binding from hub to each visit folder
    this.spokes = this.alpha.map((a, i) => {
      const len = this.Rf - 0.17 - HUB_R;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, len, 8), S.brass);
      m.rotation.set(Math.PI / 2, 0, 0);
      const g = new THREE.Group();
      g.add(m);
      m.position.set(0, 0, -len / 2);
      g.position.copy(polar(HUB_R, a, Y0 + 0.004));
      g.rotation.y = -a;
      g.userData.len = len;
      m.castShadow = true;
      statics.add(g);
      return g;
    });
    // date scale: brass arc with year ticks between the rings and the folders
    const a0 = Math.min(...this.alpha) - 6 * DEG, a1 = Math.max(...this.alpha) + 6 * DEG;
    const arcPts = [];
    for (let a = a0; a <= a1 + 1e-6; a += 1.5 * DEG) arcPts.push(polar(this.Rt, a, Y0 + 0.002));
    if (arcPts.length > 1) {
      const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), arcPts.length * 2, 0.0022, 6), S.brassDim);
      statics.add(arc);
    }
    const y0 = new Date(Math.min(...this.dates) * 864e5).getUTCFullYear(), y1 = new Date(Math.max(...this.dates) * 864e5).getUTCFullYear() + 1;
    this.yearLabels = [];
    for (let y = y0; y <= y1; y++) {
      for (let q = 0; q < 4; q++) {
        const dn = Date.UTC(y, q * 3, 1) / 864e5;
        const a = this.dateToAngle(dn);
        if (a < a0 - 1e-6 || a > a1 + 1e-6) continue;
        const tick = new THREE.Mesh(new THREE.BoxGeometry(q ? 0.0015 : 0.003, 0.002, q ? 0.018 : 0.04), S.brassDim);
        tick.position.copy(polar(this.Rt, a, Y0 + 0.002));
        tick.rotation.y = -a;
        statics.add(tick);
        if (q === 0) {
          const c = document.createElement('canvas'); c.width = 256; c.height = 96;
          const g = c.getContext('2d');
          g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 96);
          g.fillStyle = '#d9c08a'; g.font = '500 64px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(y), 128, 50);
          const t = canvasTex(c);
          const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0375), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, color: 0xbfae88 }));
          lbl.rotation.set(-Math.PI / 2, 0, 0);
          const g2 = new THREE.Group(); g2.add(lbl);
          g2.position.copy(polar(this.Rt + 0.05, a, Y0 + 0.003));
          g2.rotation.y = -a;
          statics.add(g2);
        }
      }
    }
    // beads: every visit at which a diagnosis was documented
    const beads = [];
    p.problems.forEach((pr, pi) => pr.docs.forEach((d) => {
      const i = this.encIndex.get(d.enc);
      if (i == null) return;
      beads.push({ pi, i, how: d.how });
    }));
    this.beads = beads;
    const bg = new THREE.SphereGeometry(1, 16, 12);
    const bm = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.0 });
    bm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAct; varying float vAct;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAct = aAct;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAct;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * (0.25 + vAct * 2.2);');
    };
    const B = new THREE.InstancedMesh(bg, bm, Math.max(1, beads.length));
    const act = new Float32Array(Math.max(1, beads.length));
    bg.setAttribute('aAct', new THREE.InstancedBufferAttribute(act, 1));
    const m4 = new THREE.Matrix4();
    beads.forEach((b, k) => {
      const size = b.how === 'encounter diagnosis' ? 0.011 : b.how === 'secondary diagnosis' ? 0.008 : 0.006;
      m4.compose(polar(this.rows[b.pi].r, this.alpha[b.i], Y0 + 0.006), new THREE.Quaternion(), new THREE.Vector3(size, size * 0.8, size));
      B.setMatrixAt(k, m4);
      B.setColorAt(k, new THREE.Color(problemColor(b.pi)));
    });
    B.count = beads.length;
    B.userData.pick = { kind: 'bead' };
    this.beadMesh = B;
    this.beadAct = act;
    this.beadTarget = new Float32Array(act.length);
    statics.add(B);
    this.pickables.push(B);
  }

  /** Place everything in its exploded pose, read world anchors, build threads, restore. */
  _computeThreads() {
    for (const r of this.anim) this._apply(r, 1);
    this.root.updateMatrixWorld(true);
    const T = (this.threads = new ThreadSystem());
    const p = this.p;
    this.ringThreads = [];
    // rings (problem lanes)
    p.problems.forEach((pr, pi) => {
      const r = this.rows[pi].r;
      const docs = pr.docs.map((d) => this.encIndex.get(d.enc)).filter((x) => x != null).sort((a, b) => a - b);
      const col = problemColor(pi);
      const core = pr.kind !== 'secondary';
      const aFirst = docs.length ? this.alpha[docs[0]] : -Math.PI;
      const aLast = docs.length ? this.alpha[docs[docs.length - 1]] : -Math.PI;
      const arc = (from, to) => {
        const pts = [];
        const steps = Math.max(2, Math.ceil((to - from) / (2 * DEG)));
        for (let s = 0; s <= steps; s++) pts.push(polar(r, lerp(from, to, s / steps), Y0 + 0.004));
        return pts;
      };
      const pre = T.add(arc(-Math.PI, aFirst), { color: col, radius: core ? 0.0017 : 0.0011, opacity: 0.35, dashed: true, segments: 96, data: { kind: 'ring', pi, part: 'pre' } });
      let main = null;
      if (aLast - aFirst > 0.5 * DEG) main = T.add(arc(aFirst, aLast), { color: col, radius: core ? 0.0034 : 0.0019, opacity: core ? 0.9 : 0.7, segments: 128, data: { kind: 'ring', pi, part: 'main' } });
      this.ringThreads.push({ pre, main, r, aFirst });
    });
    // exploded-view axes: dashed centre line from each folder up through its sheets
    this.folders.forEach((F, i) => {
      if (!F.sheets.length) return;
      const top = F.sheets[F.sheets.length - 1].mesh.getWorldPosition(new THREE.Vector3());
      const base = F.frame.getWorldPosition(new THREE.Vector3());
      T.add([base, top], { curve: 'line', color: '#9c937f', radius: 0.0007, opacity: 0.35, dashed: true, segments: 4, data: { kind: 'axis', i } });
    });
    // findings -> diagnosis bead at that visit
    this.findingThreads = [];
    for (const sh of this.sheets) {
      if (!sh.quads) continue;
      for (const q of sh.quads) {
        for (const L of q.f.links) {
          const pi = this.probIndex.get(L.did);
          if (pi == null) continue;
          const start = sh.mesh.localToWorld(new THREE.Vector3(-SHEET_W / 2 - 0.003, q.cy, 0.0003));
          const side = sh.mesh.localToWorld(new THREE.Vector3(-SHEET_W / 2 - 0.05, q.cy, 0.02));
          const end = polar(this.rows[pi].r, this.alpha[sh.enc], Y0 + 0.008);
          const tang = polar(1, this.alpha[sh.enc] - Math.PI / 2, 0).setY(0).normalize();
          const drop = polar(this.Rf - 0.2, this.alpha[sh.enc], Y0 + 0.1).addScaledVector(tang, 0.13);
          const neg = L.rel === 'rules_out' || L.rel === 'protective';
          const id = T.add([start, side, drop, end], { curve: 'catmull', color: neg ? '#7fa8ff' : problemColor(pi), radius: 0.0009, opacity: 0.22, segments: 40, data: { kind: 'finding', fi: q.f.i, pi, enc: sh.enc, rel: L.rel } });
          this.findingThreads.push(id);
        }
      }
    }
    // order out -> result back
    this.folders.forEach((F, i) => F.slips.forEach((s) => {
      const rep = F.sheets.find((x) => x.sid === s.order.result_sid);
      if (!rep) return;
      const a = s.mesh.localToWorld(new THREE.Vector3(0.09, 0.001, 0));
      const b = rep.mesh.localToWorld(new THREE.Vector3(SHEET_W / 2, 0.0, 0.0003));
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5).add(new THREE.Vector3(0, 0.12, 0));
      mid.addScaledVector(polar(1, this.alpha[i], 0).setY(0), 0.08);
      T.add([a, mid, b], { curve: 'bezier', color: '#ff8fa6', radius: 0.0014, opacity: 0.7, segments: 40, data: { kind: 'order', i } });
    }));
    T.build(this.root);
    this.stage.aoHidden.add(T.mesh);
    for (const r of this.anim) this._apply(r, this.exploded);
    this.root.updateMatrixWorld(true);
  }

  _apply(r, k) {
    const o = r.obj;
    o.position.lerpVectors(r.A.p, r.E.p, k);
    o.quaternion.slerpQuaternions(r.A.q, r.E.q, k);
    o.scale.lerpVectors(r.A.s, r.E.s, k);
  }

  // ------------------------------------------------------------------------------ textures
  /** Lazily paint sheet textures: low-res for everything, high-res for the visit in focus. */
  paintTextures(budgetMs = 7) {
    const t0 = performance.now();
    const want = (sh) => (this.focusVisit === sh.enc || this.hiRes?.has(sh.sid) ? 2 : 1);
    for (const sh of this.sheets) {
      const w = want(sh);
      if (sh.res >= w) continue;
      const scale = w === 2 ? 1.7 : 0.62;
      const c = renderDoc(sh.doc, scale);
      const t = canvasTex(c);
      if (sh.mat.map) sh.mat.map.dispose();
      sh.mat.map = t;
      sh.mat.needsUpdate = true;
      sh.res = w;
      if (performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------------------ transitions
  async arriveFrom(startMatrix, chartQuatWorld) {
    // jacket starts as the shelf chart and flies to the dais, turning to lie flat
    const W = CH.D, t = this.thickness;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    startMatrix.decompose(pos, q, sc);
    const X = new THREE.Vector3(1, 0, 0).applyQuaternion(chartQuatWorld);
    const Z = new THREE.Vector3(0, 0, 1).applyQuaternion(chartQuatWorld);
    const Y = new THREE.Vector3(0, 1, 0).applyQuaternion(chartQuatWorld);
    // lying-frame axes expressed in shelf frame: x -> -Z, y -> +X, z -> -Y
    const mB = new THREE.Matrix4().makeBasis(Z.clone().negate(), X.clone(), Y.clone().negate());
    const qStand = new THREE.Quaternion().setFromRotationMatrix(mB);
    const pStand = pos.clone().addScaledVector(Z, CH.D / 2).addScaledVector(X, -t / 2);
    const pOut = pStand.clone().addScaledVector(Z, 0.34);
    const rest = this.jacketRest;
    const J = this.jacket;
    J.position.copy(pStand); J.quaternion.copy(qStand);
    this.coverPivot.rotation.z = 0;
    // 1) slide off the shelf
    await tweens.add({ duration: 0.75, ease: easeInOutCubic, update: (k) => J.position.lerpVectors(pStand, pOut, k) });
    // 2) fly to the dais while the dais rises
    const p0 = pOut.clone(), p2 = rest.p.clone(), p1 = new THREE.Vector3().lerpVectors(p0, p2, 0.5).add(new THREE.Vector3(0, 0.9, 0));
    const bez = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    tweens.add({ duration: 1.6, ease: easeInOutCubic, update: (k) => { this.dais.position.y = lerp(-Y0 - 0.02, 0, k); } });
    await tweens.add({
      duration: 1.7, ease: easeInOutCubic,
      update: (k) => { J.position.copy(bez.getPoint(k)); J.quaternion.slerpQuaternions(qStand, rest.q, easeInOutCubic(clamp(k * 1.15, 0, 1))); },
    });
    this.content.visible = true;
    this.stage.renderer.shadowMap.needsUpdate = true;
  }

  async setExploded(on, duration = 1.9) {
    const from = this.exploded, to = on ? 1 : 0;
    this.targetExploded = to;
    const maxDelay = Math.max(...this.anim.map((r) => r.delay));
    const token = (this._tok = (this._tok || 0) + 1);
    if (on) tweens.add({ duration: 0.9, ease: easeInOutCubic, update: (k) => { this.coverOpen = lerp(this.coverOpen, 1, k); } });
    await tweens.add({
      duration: duration + maxDelay * 0.6, ease: (x) => x,
      update: (k) => {
        if (token !== this._tok) return;
        const T = k * (duration + maxDelay * 0.6);
        for (const r of this.anim) {
          const d = on ? r.delay * 0.6 : (maxDelay - r.delay) * 0.6;
          const kk = easeInOutCubic(clamp((T - d) / duration, 0, 1));
          this._apply(r, lerp(from, to, kk));
        }
        this.exploded = lerp(from, to, k);
        this.stage.renderer.shadowMap.needsUpdate = true;
      },
    });
    if (token !== this._tok) return;
    this.exploded = to;
    if (!on) await tweens.add({ duration: 0.7, ease: easeInOutCubic, update: (k) => { this.coverOpen = lerp(this.coverOpen, 0, k); this.stage.renderer.shadowMap.needsUpdate = true; } });
  }

  async departTo(startMatrix, chartQuatWorld) {
    await this.setExploded(false, 1.2);
    this.content.visible = false;
    const t = this.thickness;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    startMatrix.decompose(pos, q, sc);
    const X = new THREE.Vector3(1, 0, 0).applyQuaternion(chartQuatWorld);
    const Z = new THREE.Vector3(0, 0, 1).applyQuaternion(chartQuatWorld);
    const Y = new THREE.Vector3(0, 1, 0).applyQuaternion(chartQuatWorld);
    const qStand = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Z.clone().negate(), X.clone(), Y.clone().negate()));
    const pStand = pos.clone().addScaledVector(Z, CH.D / 2).addScaledVector(X, -t / 2);
    const pOut = pStand.clone().addScaledVector(Z, 0.34);
    const J = this.jacket;
    const p0 = J.position.clone(), q0 = J.quaternion.clone();
    const p1 = new THREE.Vector3().lerpVectors(p0, pOut, 0.5).add(new THREE.Vector3(0, 0.9, 0));
    const bez = new THREE.QuadraticBezierCurve3(p0, p1, pOut);
    tweens.add({ duration: 1.5, delay: 0.2, ease: easeInOutCubic, update: (k) => { this.dais.position.y = lerp(0, -Y0 - 0.02, k); } });
    await tweens.add({
      duration: 1.6, ease: easeInOutCubic,
      update: (k) => { J.position.copy(bez.getPoint(k)); J.quaternion.slerpQuaternions(q0, qStand, easeInOutCubic(clamp(k * 1.1, 0, 1))); },
    });
    await tweens.add({ duration: 0.6, ease: easeInOutCubic, update: (k) => J.position.lerpVectors(pOut, pStand, k) });
  }

  // ------------------------------------------------------------------------------ camera poses
  overviewPose() {
    const R = this.Rd;
    return {
      target: new THREE.Vector3(0, Y0 + 0.25, -0.28 * this.Rf),
      position: new THREE.Vector3(0, Y0 + 0.95 * R + 0.85, 1.5 * R + 1.05),
    };
  }
  assembledPose() {
    return { target: new THREE.Vector3(0, Y0 + 0.02, 0), position: new THREE.Vector3(0.42, Y0 + 0.5, 0.62) };
  }
  visitPose(i) {
    const a = this.alpha[i];
    const out = polar(1, a, 0).setY(0).normalize();
    const n = this.p.encounters[i].sections.length;
    const { rows, cols } = gridLayout(n);
    const midY = 0.24 + (rows - 1) * 0.15;
    const c = polar(this.Rf - 0.62, a, Y0 + midY);
    const w = cols * 0.232, h = rows * 0.3;
    const dist = Math.max(w / 1.45, h / 0.58) * 1.08 + 0.1;
    return { target: c, position: c.clone().addScaledVector(out, -dist).add(new THREE.Vector3(0, 0.1, 0)) };
  }

  /** Fan the focused visit's sheets into a reading spread; rebuild threads for the new pose. */
  async setFocus(i) {
    const tok = (this._ftok = (this._ftok || 0) + 1);
    this.focusVisit = i;
    this._threadHold = true;
    const from = this.folders.map((F) => F.spread);
    const to = this.folders.map((_, k) => (k === i ? 1 : 0));
    if (from.every((v, k) => v === to[k])) { this._threadHold = false; return; }
    await tweens.add({
      duration: 1.1, ease: easeInOutCubic,
      update: (t) => {
        if (tok !== this._ftok) return;
        this.folders.forEach((F, k) => {
          F.spread = lerp(from[k], to[k], t);
          for (const r of F.cascadeRecs) {
            r.E = cascadePose(r.k, F.spread, !!r.cover, F.sheets.length);
            if (this.exploded >= 0.999) this._apply(r, 1);
          }
        });
        this.stage.renderer.shadowMap.needsUpdate = true;
      },
    });
    if (tok !== this._ftok) return;
    this.stage.aoHidden.delete(this.threads.mesh);
    this.threads.dispose();
    this._computeThreads();
    this.threads.uniforms.uVis.value = 0;
    if (this.traceDid != null) this.setTrace(this.traceDid);
    this._threadHold = false;
  }
  sheetPose(sh) {
    const c = sh.mesh.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(sh.mesh.getWorldQuaternion(new THREE.Quaternion()));
    return { target: c, position: c.clone().addScaledVector(n, 0.42) };
  }

  // ------------------------------------------------------------------------------ trace
  /** Light a diagnosis: its ring, beads, the visits/sheets/findings that support it. */
  setTrace(did) {
    this.traceDid = did;
    const p = this.p;
    const pi = did == null ? null : this.probIndex.get(did);
    const T = this.threads, now = this.time;
    const speed = T.uniforms.uSpeed.value;
    const docVisits = new Set(pi == null ? [] : p.problems[pi].docs.map((d) => this.encIndex.get(d.enc)));
    const fLinked = new Set();
    if (pi != null) p.findings.forEach((f) => { if (f.links.some((l) => l.did === did)) fLinked.add(f.i); });
    // arrival time of the pulse at each visit's bead along the ring
    const rt = pi != null ? this.ringThreads[pi] : null;
    const preLen = rt ? T.items[rt.pre].len : 0;
    const arrive = (i) => (rt ? (preLen + rt.r * Math.max(0, this.alpha[i] - rt.aFirst)) / speed : 0);
    T.setState((it) => {
      const d = it.data || {};
      if (pi == null) {
        if (d.kind === 'finding') return { opacity: 0.22 };
        return {};
      }
      if (d.kind === 'ring') {
        if (d.pi === pi) return { pulse: d.part === 'pre' ? now : now + preLen / speed, opacity: 1, active: 1 };
        return { opacity: 0.08 };
      }
      if (d.kind === 'finding') {
        if (d.pi === pi) return { pulse: now + arrive(d.enc) + 0.05, opacity: 0.9, active: 1 };
        return { opacity: 0.0 };
      }
      if (d.kind === 'axis') return { opacity: docVisits.has(d.i) ? 0.4 : 0.1 };
      if (d.kind === 'order') return { opacity: 0.12 };
      return {};
    });
    T._pulseDirty = true;
    // findings state
    const F = this.fTarget;
    p.findings.forEach((f, i) => {
      F[i * 4 + 0] = fLinked.has(i) ? 1 : 0;
      F[i * 4 + 1] = pi != null && !fLinked.has(i) ? 1 : 0;
    });
    // beads
    this.beads.forEach((b, k) => { this.beadTarget[k] = pi == null ? 0 : b.pi === pi ? 1 : -0.8; });
    // sheets / folders / tabs dimming
    for (const sh of this.sheets) {
      const lit = pi == null || (sh.quads || []).some((q) => fLinked.has(q.f.i));
      sh.dimTarget = pi == null ? 0 : lit ? 0 : 0.72;
    }
    this.folders.forEach((F2, i) => { F2.dimTarget = pi == null ? 0 : docVisits.has(i) ? 0 : 0.6; });
    this.tabs.forEach((t, i) => { t.userData.act = pi == null ? 0 : i === pi ? 1 : -1; });
    return { visits: docVisits, findings: fLinked.size };
  }

  setHover(pick) {
    const prev = this._hover;
    this._hover = pick;
    if (prev && prev.obj && prev.obj.material && prev.obj.material.emissive && prev.obj !== pick?.obj) prev.obj.material.emissiveIntensity = prev.base ?? 0;
    const F = this.fTarget;
    for (let i = 0; i < this.p.findings.length; i++) F[i * 4 + 3] = 0;
    if (pick && pick.finding != null) F[pick.finding * 4 + 3] = 1;
  }

  update(dt, time) {
    this.time = time;
    // cover hinge
    this.coverPivot.rotation.z = this.coverOpen * Math.PI;
    this.coverPivot.position.y = lerp(this.thickness, 0.0016, this.coverOpen);
    // threads fade in only when fully exploded (they are drawn for the exploded pose)
    const vis = this.threads.uniforms.uVis;
    vis.value = damp(vis.value, this.exploded > 0.985 && this.targetExploded === 1 && !this._threadHold ? 1 : 0, this._threadHold ? 10 : 4, dt);
    this.threads.update(dt, time);
    for (const m of this.hlMeshes) m.material.uniforms.uVis.value = clamp((this.exploded - 0.6) / 0.4, 0, 1);
    // statics (rings, spokes, beads, date scale) grow with the explode
    const e = easeOutCubic(clamp(this.exploded, 0, 1));
    this.statics.visible = e > 0.01;
    this.spokes.forEach((s) => { s.scale.set(1, 1, Math.max(0.001, e)); });
    this.statics.children.forEach((c) => { if (!this.spokes.includes(c)) c.scale.setScalar(Math.max(0.001, 0.2 + 0.8 * e)); });
    // finding state
    const S = this.fState, T = this.fTarget, k = 1 - Math.exp(-6 * dt);
    let ch = false;
    for (let i = 0; i < S.length; i++) { const d = T[i] - S[i]; if (Math.abs(d) > 1e-3) { S[i] += d * k; ch = true; } }
    if (ch) this.fTex.needsUpdate = true;
    // beads
    let bch = false;
    for (let i = 0; i < this.beadAct.length; i++) {
      const d = this.beadTarget[i] - this.beadAct[i];
      if (Math.abs(d) > 1e-3) { this.beadAct[i] += d * k; bch = true; }
    }
    if (bch) this.beadMesh.geometry.attributes.aAct.needsUpdate = true;
    // sheet / folder dimming
    for (const sh of this.sheets) {
      sh.dim = damp(sh.dim || 0, sh.dimTarget || 0, 6, dt);
      const v = 1 - sh.dim * 0.8;
      sh.mat.color.setRGB(v, v, v);
      sh.mat.emissive.setRGB(0, 0, 0);
    }
    for (const F2 of this.folders) {
      F2.dim = damp(F2.dim || 0, F2.dimTarget || 0, 6, dt);
      const v = 1 - F2.dim * 0.7;
      F2.panel.material.color.setRGB(v, v, v);
    }
    this.tabs.forEach((t) => {
      const a = t.userData.act || 0;
      t.material.emissiveIntensity = damp(t.material.emissiveIntensity, a > 0 ? 2.2 : a < 0 ? 0.0 : 0.12, 6, dt);
    });
    if (this._hover?.obj?.material?.emissive && this._hover.obj.userData.pick?.kind !== 'problem') {
      const m = this._hover.obj.material;
      if (this._hover.base == null) this._hover.base = m.emissiveIntensity;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      ms.forEach((m) => { if (m === shared().manilaMat || m === shared().paperBack || m === shared().brass || m === shared().brassDim) return; if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
    });
    this.threads.dispose();
    this.fTex.dispose();
    this.stage.aoHidden.clear();
    this.stage.scene.remove(this.root);
  }
}
