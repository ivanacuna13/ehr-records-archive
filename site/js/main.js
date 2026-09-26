import * as THREE from 'three';
import { Stage } from './stage.js';
import { Archive } from './archive.js';
import { PatientChart, Y0 } from './patient.js';
import { stoneFloor } from './textures.js';
import { tweens, easeInOutCubic, easeInOutQuint, fmtDate, fmtInt, esc, chapterCss, problemColor, SECTION_LABEL, FINDING_LABEL, dateNum, damp } from './util.js';
import * as UI from './ui.js';
import { Tour } from './tour.js';

const $ = UI.$;
const stage = new Stage($('#stage'));
const { camera, controls, scene } = stage;
let H, archive, chart = null, openIdx = -1, prevPose = null;
let level = 'boot', busy = false, time = 0, touring = false;
const filt = { q: '', sex: 'all', amin: 0, amax: 100, wing: '', trace: null };
let match = null, traceSet = null;

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const progress = (v, note) => { $('#loadbar').style.width = `${Math.round(v * 100)}%`; if (note) $('#loadnote').textContent = note; };

// ------------------------------------------------------------------ camera moves
let flyTok = 0;
function flyTo(pose, dur = 2, arc = 0.12) {
  const tok = ++flyTok;
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const p1 = pose.position.clone(), t1 = pose.target.clone();
  const lift = p0.distanceTo(p1) * arc;
  controls.enabled = false;
  return tweens.add({
    duration: dur, ease: easeInOutCubic,
    update: (k) => {
      if (tok !== flyTok) return;
      camera.position.lerpVectors(p0, p1, k);
      camera.position.y += Math.sin(k * Math.PI) * lift;
      controls.target.lerpVectors(t0, t1, k);
    },
    complete: () => { if (tok === flyTok) controls.enabled = !touring; },
  });
}

function hospitalPose() {
  // frame the whole arc of wings for the current aspect ratio
  const R = archive.R, half = R * Math.sin(THREE.MathUtils.degToRad(76)) + 0.35;
  const target = new THREE.Vector3(0, 1.2, -0.38 * R);
  const cam = camera.clone();
  let dist = 4;
  for (let it = 0; it < 30; it++) {
    cam.position.set(0, target.y + dist * 0.17, target.z + dist);
    cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const v = new THREE.Vector3(half, 0.2, -R * Math.cos(THREE.MathUtils.degToRad(76))).project(cam);
    const top = new THREE.Vector3(0, archive.height + 0.45, -R).project(cam);
    if (Math.abs(v.x) > 0.9 || top.y > 0.62) dist *= 1.06; else break;
  }
  return { target, position: cam.position.clone() };
}

// ------------------------------------------------------------------ lighting per level
function lightsFor(lv, dur = 2.2) {
  const k0 = archive.key.position.clone(), t0 = archive.key.target.position.clone();
  const fog0 = scene.fog.density, w0 = archive.wash.intensity, ki0 = archive.key.intensity, pool0 = archive.pools[0].intensity;
  const patient = lv === 'patient';
  const k1 = patient ? new THREE.Vector3(1.4, 6.8, 4.2) : new THREE.Vector3(0.8, 9.5, archive.R * 2.0 + 3);
  const t1 = patient ? new THREE.Vector3(0, Y0, -0.4) : new THREE.Vector3(0, 1.0, -2.6);
  const fog1 = patient ? 0.075 : 0.045, w1 = patient ? 0.4 : 1.5, ki1 = patient ? 55 : 340;
  stage.setDof(patient ? 0.0019 : 0.0004, patient ? 0.0085 : 0.0025);
  const pool1 = patient ? 8 : 60;
  return tweens.add({
    duration: dur, ease: easeInOutCubic,
    update: (k) => {
      archive.key.position.lerpVectors(k0, k1, k);
      archive.key.target.position.lerpVectors(t0, t1, k);
      archive.key.target.updateMatrixWorld();
      scene.fog.density = fog0 + (fog1 - fog0) * k;
      archive.wash.intensity = w0 + (w1 - w0) * k;
      archive.key.intensity = ki0 + (ki1 - ki0) * k;
      archive.pools.forEach((sp) => (sp.intensity = pool0 + (pool1 - pool0) * k));
      stage.renderer.shadowMap.needsUpdate = true;
    },
  });
}

// ------------------------------------------------------------------ boot
async function boot() {
  progress(0.08, 'Loading typefaces…');
  const fonts = ['300 20px Inter', '400 20px Inter', '500 20px Inter', '600 20px Inter', '700 20px Inter', '800 20px Inter',
    '400 20px "JetBrains Mono"', '500 20px "JetBrains Mono"', '600 20px "JetBrains Mono"', '700 20px "JetBrains Mono"',
    '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"', '600 20px "IBM Plex Mono"', '700 20px "IBM Plex Mono"', 'italic 400 20px "IBM Plex Mono"'];
  await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), sleep(6)]);
  progress(0.25, 'Reading the index…');
  const [hosp] = await Promise.all([fetch('data/hospital.json').then((r) => r.json()), stage.loadEnvironment('assets/museum_of_ethnography.hdr')]);
  H = hosp;
  H.patients.forEach((p, i) => { p._i = i; p._dx = p.dx.map(([c, n]) => (c + ' ' + n).toLowerCase()); });
  progress(0.55, 'Shelving 1,268 charts…');
  await sleep(0.05);
  archive = new Archive(stage, H);
  archive.buildFloor(stoneFloor());
  archive.buildLights();
  stage.renderer.shadowMap.needsUpdate = true;
  progress(0.8, 'Lighting the reading room…');
  initUI();
  const ages = H.patients.map((p) => p.age);
  filt.amin = Math.min(...ages); filt.amax = Math.max(...ages);
  ['#amin', '#amax'].forEach((s) => { $(s).min = filt.amin; $(s).max = filt.amax; });
  $('#amin').value = filt.amin; $('#amax').value = filt.amax;
  updateAgeUI();
  applyFilters();
  // compile shaders before revealing
  camera.position.set(0, 7.5, archive.R * 3.2 + 6);
  controls.target.set(0, 1.4, -archive.R * 0.4);
  controls.update();
  stage.renderer.compile(scene, camera);
  stage.render(0.016);
  progress(1, 'Ready');
  await sleep(0.25);
  $('#loader').classList.add('done');
  level = 'hospital';
  UI.legendLevel(1);
  applyControlLimits();
  setTimeout(() => $('#intro').classList.remove('hidden'), 900);
  await flyTo(hospitalPose(), 3.6, 0.02);
}

function applyControlLimits() {
  controls.minDistance = 0.35;
  controls.maxDistance = 18;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
}

// ------------------------------------------------------------------ level 1 UI: search / filters / trace
function initUI() {
  UI.buildLegend();
  const wsel = $('#wing');
  H.chapters.forEach((c) => { const o = document.createElement('option'); o.value = c.no; o.textContent = `${c.roman} · ${c.name}`; wsel.appendChild(o); });
  wsel.onchange = () => { filt.wing = wsel.value; applyFilters(); };
  document.querySelectorAll('#sex button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#sex button').forEach((x) => x.classList.toggle('on', x === b));
    filt.sex = b.dataset.v; applyFilters();
  }));
  const onAge = () => {
    let a = +$('#amin').value, b = +$('#amax').value;
    if (a > b) [a, b] = [b, a];
    filt.amin = a; filt.amax = b; updateAgeUI(); applyFilters();
  };
  $('#amin').oninput = onAge; $('#amax').oninput = onAge;
  const q = $('#q');
  let sel = -1;
  q.oninput = () => { sel = -1; suggest(q.value); };
  q.onfocus = () => suggest(q.value);
  q.onkeydown = (ev) => {
    const rows = [...document.querySelectorAll('#suggest .row')];
    if (ev.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(-1, sel - 1); ev.preventDefault(); }
    else if (ev.key === 'Enter') {
      if (sel >= 0 && rows[sel]) rows[sel].click();
      else { filt.q = q.value; applyFilters(); $('#suggest').classList.add('hidden'); q.blur(); }
      return;
    } else if (ev.key === 'Escape') { $('#suggest').classList.add('hidden'); q.blur(); return; }
    rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
  };
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('#searchwrap')) $('#suggest').classList.add('hidden'); });
  $('#clear').onclick = clearAll;

  // level 2 controls
  $('#back').onclick = () => closePatient();
  document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => setMode(b.dataset.v === 'exploded')));
  $('#overview').onclick = () => focusVisit(null);
  $('#pclose').onclick = closePanel;
  $('#pbody').addEventListener('click', onPanelClick);
  addEventListener('keydown', onKey);
}

function updateAgeUI() {
  const lo = +$('#amin').min, hi = +$('#amin').max;
  $('#agelbl').textContent = `${filt.amin}–${filt.amax}`;
  const f = $('#afill');
  f.style.left = `${((filt.amin - lo) / (hi - lo)) * 100}%`;
  f.style.width = `${((filt.amax - filt.amin) / (hi - lo)) * 100}%`;
}

function suggest(text) {
  const box = $('#suggest');
  const t = text.trim().toLowerCase();
  if (!t) { box.classList.add('hidden'); return; }
  const dx = [];
  for (const e of H.index) {
    const c = (e.code || '').toLowerCase(), n = e.name.toLowerCase();
    let s = -1;
    if (c.startsWith(t)) s = 3; else if (n.includes(t) || e.alt.some((a) => a.toLowerCase().includes(t))) s = 1; else if (c.includes(t)) s = 0.5;
    if (s >= 0) dx.push([s, e]);
    if (dx.length > 400) break;
  }
  dx.sort((a, b) => b[0] - a[0] || b[1].patients.length - a[1].patients.length);
  const wings = H.chapters.filter((c) => c.name.toLowerCase().includes(t) || c.title.toLowerCase().includes(t) || c.roman.toLowerCase() === t);
  const pts = /^\d+$/.test(t) ? H.patients.filter((p) => String(p.id).startsWith(t)).slice(0, 4) : [];
  let html = '';
  if (dx.length) html += `<div class="kind">Diagnoses — trace across the hospital</div>` + dx.slice(0, 7).map(([, e]) => `<div class="row" data-code="${esc(e.code)}"><span class="code">${esc(e.code)}</span><span>${esc(e.name)}</span><span class="n">${e.patients.length} charts</span></div>`).join('');
  if (wings.length) html += `<div class="kind">Wings</div>` + wings.map((c) => `<div class="row" data-wing="${c.no}"><i class="dot" style="background:${chapterCss(c.no)}"></i><span>${c.roman} · ${esc(c.name)}</span><span class="n">${H.patients.filter((p) => p.ch === c.no).length}</span></div>`).join('');
  if (pts.length) html += `<div class="kind">Patients — open chart</div>` + pts.map((p) => `<div class="row" data-pid="${p._i}"><span class="code">PT ${p.id}</span><span>${p.sex} · ${p.age} y · ${esc(p.pname || '')}</span></div>`).join('');
  html += `<div class="kind">Filter</div><div class="row" data-filter="1"><span class="code">text</span><span>Show every chart mentioning “${esc(text.trim())}”</span></div>`;
  box.innerHTML = html;
  box.classList.remove('hidden');
  box.querySelectorAll('.row').forEach((r) => (r.onclick = () => {
    box.classList.add('hidden');
    if (r.dataset.code) { setTrace(r.dataset.code); $('#q').value = ''; filt.q = ''; }
    else if (r.dataset.wing) { filt.wing = r.dataset.wing; $('#wing').value = r.dataset.wing; $('#q').value = ''; filt.q = ''; applyFilters(); }
    else if (r.dataset.pid) { openPatient(+r.dataset.pid); }
    else { filt.q = $('#q').value; applyFilters(); }
    $('#q').blur();
  }));
}

function setTrace(code) {
  const e = code ? H.index.find((x) => x.code === code && code) : null;
  filt.trace = e;
  applyFilters();
}

function clearAll() {
  filt.q = ''; filt.sex = 'all'; filt.wing = ''; filt.trace = null;
  $('#q').value = ''; $('#wing').value = '';
  document.querySelectorAll('#sex button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'all'));
  filt.amin = +$('#amin').min; filt.amax = +$('#amin').max;
  $('#amin').value = filt.amin; $('#amax').value = filt.amax; updateAgeUI();
  applyFilters();
}

function applyFilters() {
  const P = H.patients;
  const q = filt.q.trim().toLowerCase();
  const lo = +$('#amin').min, hi = +$('#amin').max;
  const active = q || filt.sex !== 'all' || filt.amin > lo || filt.amax < hi || filt.wing;
  match = null;
  if (active) {
    match = new Set();
    const wingQ = q ? H.chapters.filter((c) => c.name.toLowerCase().includes(q)).map((c) => c.no) : [];
    for (const p of P) {
      if (filt.sex !== 'all' && p.sex !== filt.sex) continue;
      if (p.age < filt.amin || p.age > filt.amax) continue;
      if (filt.wing && p.ch !== +filt.wing) continue;
      if (q && !(p._dx.some((d) => d.includes(q)) || String(p.id) === q || wingQ.includes(p.ch))) continue;
      match.add(p._i);
    }
  }
  traceSet = filt.trace ? new Set(filt.trace.patients.map((id) => H.patients.findIndex((p) => p.id === id))) : null;
  if (level !== 'patient' && level !== 'flying') archive.setHighlight(match, traceSet);
  // readout
  let shown = P;
  if (match && traceSet) shown = P.filter((p) => match.has(p._i) && traceSet.has(p._i));
  else if (match) shown = P.filter((p) => match.has(p._i));
  else if (traceSet) shown = P.filter((p) => traceSet.has(p._i));
  UI.renderReadout(H.totals, {
    patients: shown.length,
    encounters: shown.reduce((s, p) => s + p.n, 0),
    documents: shown.reduce((s, p) => s + p.docs, 0),
  });
  const parts = [];
  if (filt.sex !== 'all') parts.push(`sex <b>${filt.sex}</b>`);
  if (filt.amin > lo || filt.amax < hi) parts.push(`age <b>${filt.amin}–${filt.amax}</b>`);
  if (filt.wing) { const c = H.chapters.find((c) => c.no === +filt.wing); parts.push(`wing <b>${c.roman} ${esc(c.name)}</b>`); }
  if (q) parts.push(`text <b>“${esc(filt.q.trim())}”</b>`);
  let d = parts.length ? `Filter: ${parts.join(' · ')}` : 'All charts on the shelves';
  if (filt.trace) d += `<br>Trace: <b>${esc(filt.trace.code)} ${esc(filt.trace.name)}</b>`;
  $('#filterdesc').innerHTML = d;
  // trace bar with wing breakdown
  const tb = $('#tracebar');
  if (filt.trace && level === 'hospital') {
    const byWing = new Map();
    for (const i of traceSet) { if (match && !match.has(i)) continue; const c = P[i].ch; byWing.set(c, (byWing.get(c) || 0) + 1); }
    const nW = byWing.size;
    tb.innerHTML = `<span class="pill"><span class="pulse-dot"></span><span class="code">${esc(filt.trace.code)}</span> ${esc(filt.trace.name)}</span><span class="sub" style="color:var(--muted);font-size:12px">${shown.length} charts across ${nW} wing${nW === 1 ? '' : 's'}</span><button class="x" id="untrace" title="Clear trace">×</button>`;
    tb.classList.remove('hidden');
    $('#untrace').onclick = () => setTrace(null);
    archive._wingCounts = byWing;
  } else { tb.classList.add('hidden'); archive._wingCounts = null; }
  if (!filt.trace && match) {
    const byWing = new Map();
    for (const i of match) { const c = P[i].ch; byWing.set(c, (byWing.get(c) || 0) + 1); }
    archive._wingCounts = byWing;
  }
  buildBadges();
}

function buildBadges() {
  const box = $('#badges');
  box.innerHTML = '';
  if (!archive._wingCounts || level !== 'hospital') return;
  for (const w of archive.wings) {
    const n = archive._wingCounts.get(w.ch.no);
    if (!n) continue;
    const b = document.createElement('div');
    b.className = 'badge';
    b.textContent = `${n}`;
    b._w = w;
    if (!filt.trace) b.style.borderColor = 'rgba(255,184,92,0.5)', b.style.boxShadow = '0 0 18px rgba(255,184,92,0.25)', b.style.color = '#ffe7c4';
    box.appendChild(b);
  }
}

function placeBadges() {
  const v = new THREE.Vector3();
  for (const b of $('#badges').children) {
    v.copy(b._w.signTop).project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    b.style.opacity = vis ? 1 : 0;
    b.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    b.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
}

// ------------------------------------------------------------------ pointer
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2(-9, -9);
let mouseMoved = false, downAt = null, hoverI = -1, hoverPick = null, clientXY = [0, 0];
const canvas = stage.renderer.domElement;
canvas.addEventListener('pointermove', (e) => {
  if (touring) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  clientXY = [e.clientX, e.clientY];
  mouseMoved = true;
});
canvas.addEventListener('pointerleave', () => { mouse.set(-9, -9); mouseMoved = true; });
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || touring) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 5 || busy) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); clientXY = [e.clientX, e.clientY];
  if (level === 'hospital') hoverHospital(); else if (level === 'patient' && chart) hoverPatient();
  if (level === 'hospital' && hoverI >= 0) openPatient(hoverI);
  else if (level === 'patient') onPatientClick(e);
});
canvas.addEventListener('dblclick', () => {
  if (touring || level !== 'patient' || !hoverPick) return;
  if (hoverPick.kind === 'sheet' || hoverPick.kind === 'finding') { const sh = hoverPick.sheet; if (sh) { chart.hiRes = chart.hiRes || new Set(); chart.hiRes.add(sh.sid); texDirty = true; flyTo(chart.sheetPose(sh), 1.4, 0.04); } }
});

function showTip(html) {
  const t = $('#tip');
  t.innerHTML = html;
  t.classList.remove('hidden');
  const r = t.getBoundingClientRect();
  let x = clientXY[0] + 18, y = clientXY[1] + 18;
  if (x + r.width > innerWidth - 10) x = clientXY[0] - r.width - 18;
  if (y + r.height > innerHeight - 10) y = clientXY[1] - r.height - 18;
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
const hideTip = () => $('#tip').classList.add('hidden');

function hoverHospital() {
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObject(archive.body, false)[0];
  const i = hit ? hit.instanceId : -1;
  if (i !== hoverI) {
    hoverI = i;
    archive.hoverIdx = i;
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
  }
  if (i >= 0) showTip(UI.spineLabel(H.patients[i], H.chapters));
  else hideTip();
}

function describe(hit) {
  const o = hit.object, pk = o.userData.pick;
  if (!pk) return null;
  const P = chart.p;
  switch (pk.kind) {
    case 'sheet': {
      const sh = chart.sheets.find((s) => s.mesh === o);
      return { kind: 'sheet', sheet: sh, obj: o, html: UI.smallLabel('Document · ' + fmtDate(P.encounters[sh.enc].date), SECTION_LABEL[sh.doc.type] || sh.doc.type, `section ${sh.sid} · ${sh.doc.findings.length} findings`) };
    }
    case 'highlights': {
      const sh = pk.sheet;
      const q = sh.quads[Math.floor(hit.faceIndex / 2)];
      if (!q) return null;
      const f = q.f;
      return { kind: 'finding', finding: f.i, f, sheet: sh, obj: o, html: UI.smallLabel(`Finding · ${FINDING_LABEL[f.type] || f.type}${f.present === 0 ? ' · absent' : ''}`, f.name + (f.value ? ` — ${f.value}` : ''), [f.snomed && `SNOMED ${f.snomed}`, f.loinc && `LOINC ${f.loinc}`].filter(Boolean).join(' · ')) };
    }
    case 'bead': {
      const b = chart.beads[hit.instanceId];
      if (!b) return null;
      const pr = P.problems[b.pi], e = P.encounters[b.i];
      return { kind: 'problem', i: b.pi, visit: b.i, obj: o, html: UI.smallLabel(`Documented · ${fmtDate(e.date)} · ${b.how}`, pr.name, `ICD-10 ${pr.code}`) };
    }
    case 'strip': {
      const lp = chart.strip.worldToLocal(hit.point.clone());
      let best = -1, bd = 1e9;
      chart.rows.forEach((r, i) => { const d = Math.abs(r.r - lp.z); if (d < bd && d < r.h * 0.6) { bd = d; best = i; } });
      if (best < 0) return { kind: 'face', obj: o, html: UI.smallLabel('Master problem list', `${P.problems.length} diagnoses`, 'patient level') };
      const pr = P.problems[best];
      return { kind: 'problem', i: best, obj: o, html: UI.smallLabel(`Problem list · ${pr.kind}`, pr.name, `ICD-10 ${pr.code} · SNOMED ${pr.snomed}`) };
    }
    case 'problem': {
      const pr = P.problems[pk.i];
      return { kind: 'problem', i: pk.i, obj: o, html: UI.smallLabel(`Problem list tab · ${pr.kind}`, pr.name, `ICD-10 ${pr.code} · SNOMED ${pr.snomed}`) };
    }
    case 'folder': {
      const e = P.encounters[pk.i];
      return { kind: 'folder', i: pk.i, obj: o, html: UI.smallLabel(`Visit ${pk.i + 1} · ${e.type}`, `${fmtDate(e.date)} · ${e.dept}`, `encounter ${e.id} · ${e.sections.length} documents`) };
    }
    case 'order': {
      const o2 = P.encounters[pk.i].orders[pk.oi];
      return { kind: 'order', i: pk.i, order: o2, obj: o, html: UI.smallLabel('Imaging order · outgoing', `${o2.modality} · ${o2.region}`, `order #${o2.order_id} · ${o2.priority}`) };
    }
    case 'face': return { kind: 'face', obj: o, html: UI.smallLabel('Face sheet · patient', `PT ${P.id} · ${P.age} y · ${P.sex}`, `${P.encounters.length} visits · filed ${P.primary?.code || ''}`) };
    case 'chart': return { kind: 'face', obj: o, html: UI.smallLabel('Chart jacket', `PT ${P.id}`, `filed ${P.primary?.code || ''} · ${P.filing.block}`) };
  }
  return null;
}

function hoverPatient() {
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(chart.pickables, false);
  let d = null;
  for (const h of hits) {
    let vis = true, o = h.object;
    while (o) { if (!o.visible) { vis = false; break; } o = o.parent; }
    if (!vis) continue;
    if (h.object.userData.pick?.kind === 'highlights' && chart.exploded < 0.9) continue;
    d = describe(h);
    if (d) break;
  }
  hoverPick = d;
  chart.setHover(d);
  canvas.style.cursor = d ? 'pointer' : '';
  if (d) showTip(d.html); else hideTip();
}

// ------------------------------------------------------------------ level 2
let texDirty = true;
async function openPatient(i) {
  if (busy || level === 'patient') return;
  busy = true; level = 'flying';
  openIdx = i;
  hideTip(); hoverI = -1; archive.hoverIdx = -1;
  $('#suggest').classList.add('hidden');
  ['#brand', '#searchwrap', '#tracebar'].forEach((s) => $(s).classList.add('hidden'));
  $('#badges').innerHTML = '';
  prevPose = { position: camera.position.clone(), target: controls.target.clone() };
  const entry = H.patients[i];
  const pP = fetch(`data/patients/${entry.id}.json`).then((r) => r.json());
  archive.setHighlight(null, null, true);
  archive.target.aDim[i] = 0; archive.target.aHi[i] = 0.8;
  const cw = archive.chartWorld(i), f = archive.chartFacing(i);
  await flyTo({ target: cw.clone(), position: cw.clone().addScaledVector(f, 1.3).add(new THREE.Vector3(0, 0.22, 0)) }, 1.5, 0.05);
  const P = await pP;
  chart = new PatientChart(stage, P, entry);
  texDirty = true;
  archive.setHidden(i, true);
  lightsFor('patient', 3);
  const arrival = chart.arriveFrom(archive.chartMatrices[i], archive.chartQuat(i));
  await sleep(0.5);
  flyTo(chart.assembledPose(), 2.1, 0.1);
  await arrival;
  buildPatientUI(P, entry);
  flyTo(chart.overviewPose(), 2.8, 0.05);
  await chart.setExploded(true);
  level = 'patient'; busy = false;
  UI.legendLevel(2);
  hint();
}

async function closePatient() {
  if (busy || !chart) return;
  busy = true; level = 'flying';
  closePanel(); hideTip();
  if (chart.traceDid != null) setPatientTrace(null);
  ['#patientbar', '#scrubber', '#ptrace'].forEach((s) => $(s).classList.add('hidden'));
  const i = openIdx;
  const cw = archive.chartWorld(i), f = archive.chartFacing(i);
  flyTo(chart.assembledPose(), 1.4, 0.05);
  const dep = chart.departTo(archive.chartMatrices[i], archive.chartQuat(i));
  await sleep(2.1);
  lightsFor('hospital', 2.6);
  flyTo({ target: cw.clone(), position: cw.clone().addScaledVector(f, 1.3).add(new THREE.Vector3(0, 0.22, 0)) }, 2.0, 0.1);
  await dep;
  archive.setHidden(i, false);
  chart.dispose(); chart = null;
  level = 'hospital';
  applyFilters();
  await flyTo(prevPose, 2.2, 0.06);
  ['#brand', '#searchwrap'].forEach((s) => $(s).classList.remove('hidden'));
  applyFilters();
  busy = false;
  UI.legendLevel(1);
  hint();
}

function buildPatientUI(P, entry) {
  const ch = H.chapters.find((c) => c.no === entry.ch);
  $('#pwing').textContent = `${ch.roman} · ${ch.name} wing · ${P.filing.block}`;
  $('#pname').innerHTML = `Patient ${P.id} <span style="color:var(--muted);font-weight:400">· ${P.age} y · ${P.sex} · ${P.encounters.length} visits · ${esc(P.primary?.code || '')}</span>`;
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'exploded'));
  // scrubber
  const d = P.encounters.map((e) => dateNum(e.date));
  let d0 = Math.min(...d), d1 = Math.max(...d);
  const pad = Math.max(20, (d1 - d0) * 0.06);
  d0 -= pad; d1 += pad;
  const x = (v) => ((v - d0) / (d1 - d0)) * 100;
  const y0 = new Date(d0 * 864e5).getUTCFullYear(), y1 = new Date(d1 * 864e5).getUTCFullYear();
  let tk = '';
  for (let y = y0; y <= y1 + 1; y++) {
    const v = Date.UTC(y, 0, 1) / 864e5;
    if (v < d0 || v > d1) continue;
    tk += `<div class="tk" style="left:${x(v)}%"></div><div class="yl" style="left:${x(v)}%">${y}</div>`;
  }
  $('#ticks').innerHTML = tk;
  $('#visits').innerHTML = P.encounters.map((e, k) => `<div class="v" data-k="${k}" style="left:${x(d[k])}%" title="${fmtDate(e.date)} · ${esc(e.dept)}"></div>`).join('');
  document.querySelectorAll('#visits .v').forEach((v) => {
    v.onclick = (ev) => { ev.stopPropagation(); focusVisit(+v.dataset.k); };
    v.onmouseenter = () => { $('#visitlbl').textContent = `${fmtDate(P.encounters[+v.dataset.k].date)} · ${P.encounters[+v.dataset.k].dept}`; };
    v.onmouseleave = () => updateVisitLabel();
  });
  const track = $('#track');
  let drag = false;
  const nearest = (ev) => {
    const r = track.getBoundingClientRect();
    const pct = ((ev.clientX - r.left) / r.width) * 100;
    let best = 0, bd = 1e9;
    d.forEach((v, k) => { const dd = Math.abs(x(v) - pct); if (dd < bd) { bd = dd; best = k; } });
    return best;
  };
  track.onpointerdown = (ev) => { drag = true; track.setPointerCapture(ev.pointerId); const k = nearest(ev); if (k !== chart.focusVisit) focusVisit(k); };
  track.onpointermove = (ev) => { if (!drag) return; const k = nearest(ev); if (k !== chart.focusVisit) focusVisit(k); };
  track.onpointerup = () => { drag = false; };
  updateVisitLabel();
  ['#patientbar', '#scrubber'].forEach((s) => $(s).classList.remove('hidden'));
}

function updateVisitLabel() {
  if (!chart) return;
  const k = chart.focusVisit;
  const P = chart.p;
  $('#visitlbl').textContent = k == null ? `${P.encounters.length} visits · ${P.encounters[0].date.slice(0, 4)}–${P.encounters[P.encounters.length - 1].date.slice(0, 4)}` : `Visit ${k + 1} · ${fmtDate(P.encounters[k].date)}`;
  document.querySelectorAll('#visits .v').forEach((v) => v.classList.toggle('on', +v.dataset.k === k));
}

async function focusVisit(k) {
  if (!chart || busy) return;
  if (chart.exploded < 0.5) await setMode(true);
  chart.setFocus(k);
  texDirty = true;
  updateVisitLabel();
  flyTo(k == null ? chart.overviewPose() : chart.visitPose(k), 1.6, 0.04);
}

async function setMode(exploded) {
  if (!chart) return;
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'exploded') === exploded));
  if (!exploded && chart.traceDid != null) setPatientTrace(null);
  if (!exploded) { chart.setFocus(null); updateVisitLabel(); }
  flyTo(exploded ? chart.overviewPose() : chart.assembledPose(), exploded ? 2.4 : 2.0, 0.05);
  await chart.setExploded(exploded);
}

async function setPatientTrace(did) {
  if (!chart) return;
  if (did != null && chart.exploded < 0.99) await setMode(true);
  const res = chart.setTrace(did);
  const P = chart.p;
  const bar = $('#ptrace');
  document.querySelectorAll('#visits .v').forEach((v) => { v.classList.toggle('lit', did != null && res.visits.has(+v.dataset.k)); v.classList.toggle('dim', did != null && !res.visits.has(+v.dataset.k)); });
  if (did == null) { bar.classList.add('hidden'); return; }
  const i = chart.probIndex.get(did), pr = P.problems[i];
  bar.innerHTML = `<span class="pill"><span class="pulse-dot" style="background:${problemColor(i)};box-shadow:0 0 12px ${problemColor(i)}"></span><span class="code">${esc(pr.code)}</span> ${esc(pr.name)}</span><span style="color:var(--muted);font-size:12px">${res.visits.size} visit${res.visits.size === 1 ? '' : 's'} · ${res.findings} supporting finding${res.findings === 1 ? '' : 's'}</span><button class="x" id="unptrace">×</button>`;
  bar.classList.remove('hidden');
  $('#unptrace').onclick = () => setPatientTrace(null);
}

function onPatientClick() {
  const d = hoverPick;
  if (!d) { return; }
  const P = chart.p;
  switch (d.kind) {
    case 'sheet': openPanel(UI.panelSheet(d.sheet, P, chart, chart.traceDid)); chart.hiRes = chart.hiRes || new Set(); chart.hiRes.add(d.sheet.sid); texDirty = true; break;
    case 'finding': openPanel(UI.panelFinding(d.f, P, chart)); break;
    case 'problem': {
      const did = P.problems[d.i].did;
      const on = chart.traceDid !== did;
      setPatientTrace(on ? did : null);
      openPanel(UI.panelProblem(d.i, P, chart, on));
      break;
    }
    case 'folder': openPanel(UI.panelVisit(d.i, P, chart)); focusVisit(d.i); break;
    case 'order': openPanel(UI.panelOrder(d.i, d.order, P, chart)); break;
    case 'face': openPanel(UI.panelFace(P)); break;
  }
}

function onPanelClick(ev) {
  const t = ev.target.closest('[data-trace],[data-visit],[data-sheet],[data-finding],[data-order],[data-problem]');
  if (!t || !chart) return;
  const P = chart.p;
  if (t.dataset.trace) {
    const did = +t.dataset.trace;
    const on = chart.traceDid !== did;
    setPatientTrace(on ? did : null);
    const i = chart.probIndex.get(did);
    openPanel(UI.panelProblem(i, P, chart, on));
  } else if (t.dataset.visit) {
    const k = +t.dataset.visit; focusVisit(k); openPanel(UI.panelVisit(k, P, chart));
  } else if (t.dataset.sheet) {
    const sh = chart.sheets.find((s) => s.sid === +t.dataset.sheet);
    if (sh) { openPanel(UI.panelSheet(sh, P, chart, chart.traceDid)); chart.hiRes = chart.hiRes || new Set(); chart.hiRes.add(sh.sid); texDirty = true; flyTo(chart.sheetPose(sh), 1.4, 0.04); }
  } else if (t.dataset.finding) {
    openPanel(UI.panelFinding(P.findings[+t.dataset.finding], P, chart));
  } else if (t.dataset.order) {
    const [k, oid] = t.dataset.order.split(':').map(Number);
    openPanel(UI.panelOrder(k, P.encounters[k].orders.find((o) => o.order_id === oid), P, chart));
  } else if (t.dataset.problem) {
    openPanel(UI.panelProblem(+t.dataset.problem, P, chart, chart.traceDid === P.problems[+t.dataset.problem].did));
  }
}

function openPanel(html) { $('#pbody').innerHTML = html; $('#pbody').scrollTop = 0; $('#panel').classList.add('open'); }
function closePanel() { $('#panel').classList.remove('open'); }

function onKey(ev) {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  if (touring) { if (ev.key === 'Escape') tour.stop(); return; }
  if (ev.key === 'Escape') {
    if ($('#panel').classList.contains('open')) closePanel();
    else if (chart && chart.traceDid != null) setPatientTrace(null);
    else if (level === 'patient') closePatient();
    else if (filt.trace) setTrace(null);
  }
  if (level === 'patient' && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
    const n = chart.p.encounters.length;
    const k = chart.focusVisit == null ? (ev.key === 'ArrowRight' ? 0 : n - 1) : Math.max(0, Math.min(n - 1, chart.focusVisit + (ev.key === 'ArrowRight' ? 1 : -1)));
    focusVisit(k);
  }
}

function hint() {
  $('#hint').innerHTML = level === 'patient'
    ? 'Click a problem-list tab to trace it · click any sheet to read it<br>double-click to zoom to a sheet · ← → step through visits · Esc to go back'
    : 'Drag to orbit · scroll to zoom · right-drag to pan<br>hover a chart to read its spine · click to open it';
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function tick(dt, doRender = true) {
  time += dt;
  tweens.tick(dt);
  if (archive) archive.update(dt, camera);
  if (chart) {
    chart.update(dt, time);
    if (texDirty) texDirty = !chart.paintTextures(6);
  }
  if (mouseMoved && !busy) {
    mouseMoved = false;
    if (level === 'hospital') hoverHospital();
    else if (level === 'patient' && chart) hoverPatient();
  }
  if (level === 'hospital') placeBadges();
  if (busy) stage.renderer.shadowMap.needsUpdate = true;
  stage.hold = busy || texDirty || tweens.busy;
  if (doRender) stage.render(dt);
  else stage.preRender(dt);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}
/** Advance the app deterministically (used for automated captures when rAF is throttled). */
async function step(seconds, fps = 30) {
  const n = Math.ceil(seconds * fps);
  for (let i = 0; i < n; i++) {
    tick(1 / fps, false);
    if (i % 15 === 14) await new Promise((r) => setTimeout(r, 0));
  }
  if (chart) while (texDirty) texDirty = !chart.paintTextures(50);
}
hint();
requestAnimationFrame(frame);
// ------------------------------------------------------------------ welcome + guided tour
function setTouring(on) {
  touring = on;
  document.body.classList.toggle('touring', on);
  controls.enabled = !on;
  if (on) { hideTip(); closePanel(); }
  if (!on) { hint(); canvas.style.cursor = ''; }
}
function showChartTip(i) {
  archive.hoverIdx = i;
  const v = archive.chartWorld(i).project(camera);
  clientXY = [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  showTip(UI.spineLabel(H.patients[i], H.chapters));
}
function hideChartTip() { archive.hoverIdx = -1; hideTip(); }
const tour = new Tour({
  flyTo, hospitalPose, setTrace, openPatient, closePatient, setPatientTrace, focusVisit, setMode, setTouring, showChartTip, hideChartTip,
  get archive() { return archive; }, get H() { return H; }, chart: () => chart,
});
function closeIntro() { $('#intro').classList.add('hidden'); }
$('#starttour').onclick = () => { closeIntro(); tour.start(); };
$('#explore').onclick = closeIntro;
$('#abouttour').onclick = () => { $('#intro').classList.remove('hidden'); };
$('#intro').addEventListener('click', (e) => { if (e.target.id === 'intro') closeIntro(); });

// "Why I built this" — Ivan Acuña's note. Audio only plays when the reader presses Listen.
const whyAudio = new Audio();
whyAudio.preload = 'none';
let whyDoc = null;
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
async function openWhy() {
  if (!whyDoc) {
    whyDoc = await fetch('why/why.json').then((r) => r.json());
    $('#whytitle').textContent = whyDoc.title;
    $('#whyauthor').textContent = whyDoc.author;
    $('#whybody').innerHTML = whyDoc.paragraphs.map((p, i) => `<p data-i="${i}">${esc(p.text)}</p>`).join('');
    $('#whybody').querySelectorAll('p').forEach((el) => (el.onclick = () => {
      const st = whyDoc.paragraphs[+el.dataset.i].start;
      if (st == null) return;
      if (!whyAudio.src) whyAudio.src = 'why/why-i-built-this.mp3';
      whyAudio.currentTime = st; whyAudio.play();
    }));
  }
  $('#why').classList.remove('hidden');
}
function closeWhy() { whyAudio.pause(); $('#why').classList.add('hidden'); }
$('#whyplay').onclick = () => {
  if (!whyAudio.src) whyAudio.src = 'why/why-i-built-this.mp3';
  whyAudio.paused ? whyAudio.play() : whyAudio.pause();
};
whyAudio.onplay = () => { $('#whyplay path').setAttribute('d', 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'); $('#whyplay span').textContent = 'Pause'; $('#whybody').classList.add('playing'); };
whyAudio.onpause = () => { $('#whyplay path').setAttribute('d', 'M8 5l11 7-11 7z'); $('#whyplay span').textContent = whyAudio.currentTime > 0.5 && !whyAudio.ended ? 'Resume' : 'Listen'; $('#whybody').classList.remove('playing'); };
whyAudio.onended = () => { whyAudio.currentTime = 0; };
whyAudio.ontimeupdate = () => {
  const t = whyAudio.currentTime, d = whyAudio.duration || 1;
  $('#whyprog').style.width = `${(t / d) * 100}%`;
  $('#whytime').textContent = `${fmtT(t)} / ${fmtT(whyAudio.duration || 0)}`;
  if (!whyDoc) return;
  let cur = -1;
  whyDoc.paragraphs.forEach((p, i) => { if (p.start != null && t >= p.start - 0.1) cur = i; });
  $('#whybody').querySelectorAll('p').forEach((el, i) => el.classList.toggle('on', i === cur));
  const on = $('#whybody p.on');
  if (on && !whyAudio.paused && on !== openWhy._last) { openWhy._last = on; on.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
};
document.querySelector('#why .bar').onclick = (e) => {
  if (!whyAudio.src) whyAudio.src = 'why/why-i-built-this.mp3';
  const r = e.currentTarget.getBoundingClientRect();
  const go = () => { whyAudio.currentTime = ((e.clientX - r.left) / r.width) * whyAudio.duration; };
  if (isNaN(whyAudio.duration)) { whyAudio.addEventListener('loadedmetadata', go, { once: true }); whyAudio.load(); } else go();
};
$('#whybtn').onclick = openWhy;
$('#introwhy').onclick = () => { closeIntro(); openWhy(); };
$('#whyclose').onclick = closeWhy;
$('#why').addEventListener('click', (e) => { if (e.target.id === 'why') closeWhy(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#why').classList.contains('hidden')) closeWhy(); });

boot().catch((e) => { console.error(e); $('#loadnote').textContent = 'Failed to load: ' + e.message; });

// debug hooks for automated screenshots
window.__app = {
  tour,
  step, tick, hover(x, y) { mouse.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); clientXY = [x, y]; mouseMoved = true; tick(1 / 30, false); },
  click() { if (level === 'hospital' && hoverI >= 0) openPatient(hoverI); else if (level === 'patient') onPatientClick(); },
  async snap(name) { for (let i = 0; i < 3; i++) stage.render(1 / 30); const data = stage.renderer.domElement.toDataURL('image/jpeg', 0.92); await fetch('http://127.0.0.1:8732', { method: 'POST', body: JSON.stringify({ name, data }) }); return name; },
  hospitalPose, get H() { return H; }, get archive() { return archive; }, get chart() { return chart; }, openPatient, closePatient, setTrace, setPatientTrace, setMode, focusVisit, flyTo, applyFilters, filt, get level() { return level; }, get busy() { return busy; }, stage };
