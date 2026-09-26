// Printed forms. Every chart section is drawn as the paper form it would be in a real chart:
// labs = results table, vitals = flowsheet, medications = reconciliation table, allergies =
// red-banded alert sheet, imaging = radiology report, narrative sections = typed notes.
// Layout is computed in US-letter points (612 x 792) so highlight rectangles for findings map
// straight onto the 3D sheet regardless of texture resolution.

import { SECTION_LABEL, fmtDate } from './util.js';

export const PAGE_W = 612, PAGE_H = 792;
const MONO = '"IBM Plex Mono", "JetBrains Mono", monospace';
const SANS = 'Inter, system-ui, sans-serif';

export const FORM = {
  chief_complaint: { color: '#35698a', no: 'TRG-01', title: 'TRIAGE · CHIEF COMPLAINT' },
  hpi: { color: '#3d3d3d', no: 'PN-02', title: 'HISTORY OF PRESENT ILLNESS' },
  pmh: { color: '#6f5a35', no: 'HX-03', title: 'PAST MEDICAL HISTORY' },
  psh: { color: '#6f5a35', no: 'HX-04', title: 'PAST SURGICAL HISTORY' },
  medications: { color: '#2d7550', no: 'MED-05', title: 'MEDICATION RECONCILIATION' },
  allergies: { color: '#b3261e', no: 'ALG-06', title: 'ALLERGIES' },
  family_history: { color: '#6f5a35', no: 'HX-07', title: 'FAMILY HISTORY' },
  social_history: { color: '#6f5a35', no: 'HX-08', title: 'SOCIAL HISTORY' },
  vitals: { color: '#1d6f86', no: 'FS-09', title: 'VITAL SIGNS FLOWSHEET' },
  physical_exam: { color: '#3d3d3d', no: 'PE-10', title: 'PHYSICAL EXAMINATION' },
  labs: { color: '#6d47a0', no: 'LAB-11', title: 'LABORATORY RESULTS' },
  imaging: { color: '#24478a', no: 'RAD-12', title: 'RADIOLOGY REPORT' },
  other_studies: { color: '#24478a', no: 'DX-13', title: 'DIAGNOSTIC STUDIES' },
  pathology: { color: '#8a2f52', no: 'PATH-14', title: 'SURGICAL PATHOLOGY REPORT' },
  assessment: { color: '#3d3d3d', no: 'PN-15', title: 'ASSESSMENT' },
  plan: { color: '#3d3d3d', no: 'PN-16', title: 'PLAN' },
  ros: { color: '#3d3d3d', no: 'PN-17', title: 'REVIEW OF SYSTEMS' },
};

let _mctx;
const mctx = () => (_mctx = _mctx || document.createElement('canvas').getContext('2d'));

function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const rows = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

function barcode(g, x, y, w, h, id) {
  // patient ID label barcode: bars derived from the digits of the patient ID
  const digits = String(id).padStart(6, '0');
  let cx = x;
  const unit = w / (digits.length * 9 + 4);
  g.fillStyle = '#111';
  g.fillRect(cx, y, unit, h); cx += unit * 2;
  for (const d of digits) {
    const n = +d;
    for (let b = 0; b < 4; b++) {
      const bw = ((n >> b) & 1 ? 2 : 1) * unit;
      g.fillRect(cx, y, bw, h);
      cx += bw + unit;
    }
  }
  g.fillRect(x + w - unit, y, unit, h);
}

function header(g, doc, form) {
  const m = doc.meta;
  g.fillStyle = '#6d6a63';
  g.font = `600 7.5px ${SANS}`;
  g.fillText('SYNTHETIC GENERAL HOSPITAL', 40, 34);
  g.font = `500 7px ${MONO}`;
  g.fillText(`FORM ${form.no}`, 40, 45);
  // patient ID label (the sticker that keys every page to the patient)
  g.fillStyle = '#fbfaf6'; g.strokeStyle = '#c9c4b8'; g.lineWidth = 0.8;
  g.fillRect(392, 20, 180, 44); g.strokeRect(392, 20, 180, 44);
  g.fillStyle = '#161616';
  g.font = `600 9px ${MONO}`;
  g.fillText(`PT ${m.pid}`, 400, 33);
  g.font = `400 7.5px ${MONO}`;
  g.fillText(`${m.sex} · ${m.age}y · ENC ${m.eid}`, 400, 44);
  barcode(g, 400, 49, 120, 10, m.pid);
  // coloured title band (form colour)
  g.fillStyle = form.color;
  g.fillRect(40, 74, 532, 26);
  g.fillStyle = '#fff';
  g.font = `700 11px ${SANS}`;
  g.fillText(doc.title || form.title, 50, 91);
  // encounter meta row
  g.fillStyle = '#5c5a55';
  g.font = `500 7.5px ${SANS}`;
  const cells = [['DATE', fmtDate(m.date)], ['DEPARTMENT', m.dept], ['ATTENDING', m.attending], ['VISIT', (m.type || '').toUpperCase()]];
  let x = 40;
  const cw = [92, 170, 160, 110];
  cells.forEach(([k, v], i) => {
    g.fillStyle = '#8a867c'; g.font = `600 6.5px ${SANS}`; g.fillText(k, x, 114);
    g.fillStyle = '#1d1d1d'; g.font = `500 8.5px ${SANS}`; g.fillText(String(v || '—').slice(0, 34), x, 126);
    x += cw[i];
  });
  g.strokeStyle = '#d6d1c4'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(40, 134); g.lineTo(572, 134); g.stroke();
  return 152;
}

function footer(g, doc) {
  g.fillStyle = '#9a968c';
  g.font = `400 6.5px ${MONO}`;
  g.fillText(`section ${doc.sid} · ${doc.type}`, 40, 772);
  g.fillText('synthetic record — not a real patient', 400, 772);
}

// -------------------------------------------------------------------- body layouts
function narrative(g, doc, y0, fs, opts = {}) {
  const rects = [];
  const x0 = opts.x0 ?? 48, maxW = opts.maxW ?? 432, lh = fs * 1.45;
  let y = y0;
  g.font = `400 ${fs}px ${MONO}`;
  doc.lines.forEach((line, li) => {
    if (!line.trim()) { y += lh * 0.5; return; }
    const bullet = /^\s*[-•*]\s+/.test(line);
    const text = bullet ? line.replace(/^\s*[-•*]\s+/, '') : line;
    const ix = bullet ? x0 + fs * 1.4 : x0;
    const rows = wrap(g, text, maxW - (ix - x0));
    const top = y;
    rows.forEach((r, ri) => {
      if (opts.ruled) {
        g.strokeStyle = 'rgba(80,110,160,0.18)'; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(40, y + fs * 0.45); g.lineTo(480, y + fs * 0.45); g.stroke();
      }
      if (opts.check && ri === 0) {
        g.strokeStyle = '#6a665e'; g.lineWidth = 0.8; g.strokeRect(x0 - 14, y - fs * 0.8, fs * 0.8, fs * 0.8);
      }
      g.fillStyle = '#1b1b1b';
      if (bullet && ri === 0) g.fillText('•', x0 + 2, y);
      g.fillText(r, ix, y);
      y += lh;
    });
    rects[li] = [x0 - 4, top - fs * 1.0, x0 + maxW + 4, y - lh + fs * 0.45];
  });
  return { rects, y };
}

function parseLab(line) {
  const m = line.replace(/^\s*[-•*]\s*/, '').match(/^([^:]{2,80}):\s*(.+)$/);
  if (!m) return null;
  let [, name, rest] = m;
  let ref = '';
  const r = rest.match(/\((?:normal(?: range)?|ref(?:erence)?(?: range)?)\s*:?\s*([^)]*)\)/i);
  if (r) { ref = r[1].trim(); rest = rest.replace(r[0], '').trim(); }
  let flag = '';
  const v = parseFloat(rest.replace(/,/g, ''));
  if (!isNaN(v) && ref) {
    const rr = ref.replace(/,/g, '');
    let mm;
    if ((mm = rr.match(/([\d.]+)\s*[-–]\s*([\d.]+)/))) { if (v < +mm[1]) flag = 'L'; else if (v > +mm[2]) flag = 'H'; }
    else if ((mm = rr.match(/<\s*([\d.]+)/))) { if (v >= +mm[1]) flag = 'H'; }
    else if ((mm = rr.match(/>\s*([\d.]+)/))) { if (v <= +mm[1]) flag = 'L'; }
  }
  if (/positive|elevated|detected|abnormal/i.test(rest) && !/not detected|negative/i.test(rest)) flag = flag || '*';
  return { name: name.trim(), result: rest.trim(), ref, flag };
}

function labsLayout(g, doc, y0, fs) {
  const rects = [];
  let y = y0;
  const cols = [48, 250, 392, 468];
  g.fillStyle = '#efeaf6'; g.fillRect(40, y - 11, 440, 16);
  g.fillStyle = '#4b3a66'; g.font = `700 7px ${SANS}`;
  ['TEST', 'RESULT', 'REFERENCE', 'FLAG'].forEach((h, i) => g.fillText(h, cols[i], y));
  y += 18;
  let row = 0;
  doc.lines.forEach((line, li) => {
    if (!line.trim()) { y += 4; return; }
    const p = parseLab(line);
    const top = y;
    if (!p) {
      g.font = `italic 400 ${fs}px ${MONO}`; g.fillStyle = '#444';
      const rows = wrap(g, line, 430);
      rows.forEach((r) => { g.fillText(r, 48, y); y += fs * 1.45; });
      rects[li] = [44, top - fs, 484, y - fs * 1.45 + fs * 0.45];
      return;
    }
    g.font = `400 ${fs}px ${MONO}`;
    const nameRows = wrap(g, p.name, 190), resRows = wrap(g, p.result, 132), refRows = wrap(g, p.ref, 70);
    const h = Math.max(nameRows.length, resRows.length, refRows.length) * fs * 1.35;
    if (row % 2) { g.fillStyle = 'rgba(109,71,160,0.06)'; g.fillRect(40, top - fs - 1, 440, h + 3); }
    g.fillStyle = '#1b1b1b';
    nameRows.forEach((r, i) => g.fillText(r, cols[0], top + i * fs * 1.35));
    g.font = `${p.flag ? 700 : 400} ${fs}px ${MONO}`;
    g.fillStyle = p.flag ? '#a3261c' : '#1b1b1b';
    resRows.forEach((r, i) => g.fillText(r, cols[1], top + i * fs * 1.35));
    g.font = `400 ${fs * 0.88}px ${MONO}`; g.fillStyle = '#6b675e';
    refRows.forEach((r, i) => g.fillText(r, cols[2], top + i * fs * 1.35));
    if (p.flag) { g.fillStyle = '#a3261c'; g.font = `700 ${fs}px ${MONO}`; g.fillText(p.flag, cols[3], top); }
    y = top + h + 5;
    rects[li] = [42, top - fs - 1, 482, top + h - fs * 0.5];
    row++;
  });
  return { rects, y };
}

const VITAL_RX = [
  ['BP', 'Blood pressure', /(\d{2,3}\s*\/\s*\d{2,3})\s*mm\s*hg/i, 'mmHg', /blood pressure|systolic|diastolic|hypertens|hypotens/i],
  ['HR', 'Heart rate', /(?:heart rate|pulse)[^\d]{0,24}(\d{2,3})/i, 'bpm', /heart rate|pulse|tachycard|bradycard/i],
  ['RR', 'Respiratory rate', /respiratory rate[^\d]{0,24}(\d{1,2})/i, '/min', /respirat|tachypn/i],
  ['T', 'Temperature', /temperature[^\d]{0,24}([\d.]+\s*°?\s*[CF])/i, '', /temperat|fever|febrile|hypotherm/i],
  ['SpO₂', 'Oxygen saturation', /(?:oxygen saturation|spo2|o2 sat)[^\d]{0,24}(\d{2,3})\s*%/i, '%', /oxygen|saturation|spo2|hypox/i],
  ['BMI', 'Body mass index', /bmi[^\d]{0,12}([\d.]+)/i, 'kg/m²', /bmi|body mass|obes/i],
  ['Wt', 'Weight', /weigh[st]?[^\d]{0,16}([\d.]+\s*(?:kg|lb|pounds))/i, '', /weight/i],
];

function vitalsLayout(g, doc, y0, fs) {
  const text = doc.lines.join(' ');
  const rows = VITAL_RX.map(([k, name, rx, unit, match]) => {
    const m = text.match(rx);
    return m ? { k, name, value: m[1].replace(/\s+/g, ' '), unit, match } : null;
  }).filter(Boolean);
  const rowRects = [];
  let y = y0;
  // flowsheet grid
  g.fillStyle = '#e4f0f3'; g.fillRect(40, y - 11, 440, 16);
  g.fillStyle = '#1d5b6c'; g.font = `700 7px ${SANS}`;
  g.fillText('PARAMETER', 48, y); g.fillText(fmtDate(doc.meta.date).toUpperCase(), 250, y); g.fillText('UNIT', 392, y);
  y += 20;
  if (!rows.length) {
    g.fillStyle = '#6b675e'; g.font = `italic 400 ${fs}px ${MONO}`; g.fillText('no discrete values charted', 48, y); y += 20;
  }
  for (const r of rows) {
    g.strokeStyle = 'rgba(29,111,134,0.25)'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(40, y + 6); g.lineTo(480, y + 6); g.stroke();
    g.fillStyle = '#1b1b1b'; g.font = `600 ${fs}px ${SANS}`; g.fillText(`${r.k}  ${r.name}`, 48, y);
    g.font = `700 ${fs * 1.1}px ${MONO}`; g.fillText(r.value, 250, y);
    g.font = `400 ${fs * 0.9}px ${MONO}`; g.fillStyle = '#6b675e'; g.fillText(r.unit, 392, y);
    rowRects.push({ match: r.match, rect: [42, y - fs - 3, 482, y + 6] });
    y += fs * 2.1;
  }
  // grid verticals
  g.strokeStyle = 'rgba(29,111,134,0.18)';
  [240, 384].forEach((x) => { g.beginPath(); g.moveTo(x, y0 - 11); g.lineTo(x, y - fs); g.stroke(); });
  y += 14;
  g.fillStyle = '#8a867c'; g.font = `600 6.5px ${SANS}`; g.fillText('SOURCE ENTRY', 48, y); y += 16;
  const n = narrative(g, doc, y, fs * 0.92);
  return { rects: n.rects, y: n.y, rowRects };
}

function medsLayout(g, doc, y0, fs) {
  const rects = [];
  let y = y0;
  g.fillStyle = '#e3f1e9'; g.fillRect(40, y - 11, 440, 16);
  g.fillStyle = '#245c40'; g.font = `700 7px ${SANS}`;
  g.fillText('MEDICATION', 48, y); g.fillText('DOSE · ROUTE · FREQUENCY', 230, y);
  y += 19;
  doc.lines.forEach((line, li) => {
    if (!line.trim()) { y += 5; return; }
    const top = y;
    const item = line.match(/^\s*[-•*]\s*(.+)$/);
    if (item) {
      const s = item[1];
      const k = s.search(/\s\d/);
      const name = k > 0 ? s.slice(0, k) : s, dose = k > 0 ? s.slice(k + 1) : '';
      g.font = `600 ${fs}px ${MONO}`; g.fillStyle = '#1b1b1b';
      const nr = wrap(g, name, 170);
      g.font = `400 ${fs}px ${MONO}`;
      const dr = wrap(g, dose, 245);
      g.font = `600 ${fs}px ${MONO}`;
      nr.forEach((r, i) => g.fillText(r, 48, top + i * fs * 1.35));
      g.font = `400 ${fs}px ${MONO}`;
      dr.forEach((r, i) => g.fillText(r, 230, top + i * fs * 1.35));
      const h = Math.max(nr.length, dr.length) * fs * 1.35;
      g.strokeStyle = 'rgba(45,117,80,0.2)'; g.beginPath(); g.moveTo(40, top + h - fs * 0.6); g.lineTo(480, top + h - fs * 0.6); g.stroke();
      y = top + h + 4;
      rects[li] = [42, top - fs - 1, 482, top + h - fs * 0.6];
    } else {
      g.font = `400 ${fs}px ${MONO}`; g.fillStyle = /medications:?$/i.test(line.trim()) ? '#2d7550' : '#333';
      const rows = wrap(g, line, 430);
      rows.forEach((r) => { g.fillText(r, 48, y); y += fs * 1.45; });
      rects[li] = [44, top - fs, 484, y - fs];
    }
  });
  return { rects, y };
}

function allergyLayout(g, doc, y0, fs) {
  // red alert banner (real charts flag allergies in red so they cannot be missed)
  g.fillStyle = '#b3261e'; g.fillRect(40, y0 - 8, 532, 6);
  g.fillStyle = '#fdecea'; g.fillRect(40, y0, 440, 30);
  g.fillStyle = '#b3261e'; g.font = `800 12px ${SANS}`; g.fillText('⚠  ALLERGY ALERT', 52, y0 + 20);
  const n = narrative(g, doc, y0 + 62, fs * 1.4);
  return n;
}

function triageLayout(g, doc, y0, fs) {
  const m = doc.meta;
  const box = (x, y, w, h, k, v) => {
    g.strokeStyle = '#9fb7c6'; g.lineWidth = 0.8; g.strokeRect(x, y, w, h);
    g.fillStyle = '#35698a'; g.font = `700 6.5px ${SANS}`; g.fillText(k, x + 6, y + 11);
    g.fillStyle = '#1b1b1b'; g.font = `500 10px ${MONO}`; g.fillText(String(v || '—').slice(0, 28), x + 6, y + 26);
  };
  box(40, y0 - 6, 140, 34, 'ARRIVAL', fmtDate(m.date));
  box(186, y0 - 6, 150, 34, 'VISIT TYPE', (m.type || '').toUpperCase());
  box(342, y0 - 6, 138, 34, 'DEPARTMENT', m.dept);
  g.fillStyle = '#35698a'; g.font = `700 7px ${SANS}`; g.fillText("CHIEF COMPLAINT — IN THE PATIENT'S WORDS", 48, y0 + 52);
  g.strokeStyle = '#9fb7c6'; g.strokeRect(40, y0 + 40, 440, 150);
  return narrative(g, doc, y0 + 80, fs * 1.35, { maxW: 420 });
}

function radiologyLayout(g, doc, y0, fs) {
  const o = doc.meta.order;
  let y = y0;
  if (o) {
    const cells = [['ACCESSION', `#${o.order_id}`], ['MODALITY', (o.modality || '').toUpperCase().replace('_', ' ')], ['REGION', (o.region || '').replace('_', '/')], ['PRIORITY', (o.priority || '').toUpperCase()]];
    let x = 48;
    cells.forEach(([k, v]) => {
      g.fillStyle = '#6b7a99'; g.font = `700 6.5px ${SANS}`; g.fillText(k, x, y);
      g.fillStyle = k === 'PRIORITY' && /stat/i.test(v) ? '#b3261e' : '#1b1b1b'; g.font = `600 9px ${MONO}`; g.fillText(v, x, y + 12);
      x += 108;
    });
    y += 32;
    g.fillStyle = '#6b7a99'; g.font = `700 6.5px ${SANS}`; g.fillText('CLINICAL INDICATION', 48, y);
    g.fillStyle = '#1b1b1b'; g.font = `400 9px ${MONO}`; g.fillText(o.indication || '', 48, y + 12);
    y += 32;
  }
  g.fillStyle = '#24478a'; g.font = `700 7px ${SANS}`; g.fillText('FINDINGS / IMPRESSION', 48, y);
  return narrative(g, doc, y + 20, fs);
}

function paintBody(g, doc, fs) {
  const y0 = header(g, doc, FORM[doc.type] || FORM.hpi);
  switch (doc.type) {
    case 'labs': return labsLayout(g, doc, y0, fs);
    case 'vitals': return vitalsLayout(g, doc, y0, fs);
    case 'medications': return medsLayout(g, doc, y0, fs);
    case 'allergies': return allergyLayout(g, doc, y0, fs);
    case 'chief_complaint': return triageLayout(g, doc, y0, fs);
    case 'imaging': case 'other_studies': case 'pathology': return radiologyLayout(g, doc, y0, fs);
    case 'pmh': case 'psh': case 'family_history': case 'social_history': return narrative(g, doc, y0, fs, { ruled: true });
    case 'ros': return narrative(g, doc, y0, fs, { check: true, x0: 62, maxW: 418 });
    default: return narrative(g, doc, y0, fs);
  }
}

/** Compute layout (font size fitted to the page) + rectangles for each source line. */
export function layoutDoc(doc) {
  const g = mctx();
  let fs = 10;
  let res;
  for (let k = 0; k < 7; k++) {
    g.save();
    g.globalAlpha = 0;
    res = paintBody(g, doc, fs);
    g.restore();
    if (res.y < PAGE_H - 40) break;
    fs *= 0.88;
  }
  doc._fs = fs;
  doc._layout = res;
  return res;
}

/** Rectangle (page points) where a finding was abstracted from. */
export function findingRect(doc, f) {
  const L = doc._layout || layoutDoc(doc);
  if (doc.type === 'vitals' && L.rowRects) {
    const hit = L.rowRects.find((r) => r.match.test(f.name));
    if (hit) return hit.rect;
  }
  if (f.line != null && L.rects[f.line]) return L.rects[f.line];
  return null;
}

/** Paint a sheet to a canvas at the given pixel scale. Margin tags carry SNOMED / LOINC codes. */
export function renderDoc(doc, scale) {
  if (!doc._layout) layoutDoc(doc);
  const c = document.createElement('canvas');
  c.width = Math.round(PAGE_W * scale); c.height = Math.round(PAGE_H * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#f7f4ec'; g.fillRect(0, 0, PAGE_W, PAGE_H);
  // faint ruled margin
  g.strokeStyle = 'rgba(190,90,80,0.22)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(488, 140); g.lineTo(488, 760); g.stroke();
  paintBody(g, doc, doc._fs);
  // call-number tags in the margin for every finding abstracted from this sheet
  const used = new Map();
  for (const f of doc.findings || []) {
    const r = findingRect(doc, f);
    if (!r) continue;
    const key = Math.round(r[1]);
    const k = used.get(key) || 0; used.set(key, k + 1);
    if (k > 2) continue;
    const code = f.loinc ? `LOINC ${f.loinc}` : f.snomed ? `SCT ${f.snomed}` : '';
    if (!code) continue;
    const y = r[1] + 2 + k * 11;
    g.font = `500 6.5px ${MONO}`;
    const w = g.measureText(code).width + 8;
    g.fillStyle = f.present === 0 ? 'rgba(90,130,200,0.14)' : 'rgba(214,160,40,0.16)';
    g.fillRect(494, y, Math.min(w, 80), 9.5);
    g.strokeStyle = f.present === 0 ? 'rgba(90,130,200,0.6)' : 'rgba(170,120,20,0.6)';
    g.lineWidth = 0.6; g.strokeRect(494, y, Math.min(w, 80), 9.5);
    g.fillStyle = '#3b3526'; g.fillText(code, 498, y + 7, 74);
  }
  footer(g, doc);
  return c;
}

// -------------------------------------------------------------------- other chart objects
function sheetCanvas(scale, w = PAGE_W, h = PAGE_H, bg = '#f7f4ec') {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  return { c, g };
}

/** Face sheet: patient-level demographics — the page every chart opens on. */
export function renderFaceSheet(p, scale = 1.6) {
  const { c, g } = sheetCanvas(scale);
  const pr = p.profile || {};
  const doc = { meta: { pid: p.id, sex: p.sex, age: p.age, eid: '—', date: p.encounters[0]?.date, dept: 'Health Information Mgmt', attending: '—', type: 'face sheet' }, title: 'FACE SHEET · PATIENT DEMOGRAPHICS' };
  header(g, doc, { color: '#2b2b2b', no: 'FS-00' });
  let y = 160;
  const field = (k, v, x = 48, w = 520) => {
    g.fillStyle = '#8a867c'; g.font = `700 6.5px ${SANS}`; g.fillText(k, x, y);
    g.fillStyle = '#1b1b1b'; g.font = `500 10px ${MONO}`;
    const rows = wrap(g, v || '—', w);
    rows.slice(0, 4).forEach((r, i) => g.fillText(r, x, y + 13 + i * 13));
    return 13 + Math.min(rows.length, 4) * 13 + 8;
  };
  const two = (a, b) => { const h1 = field(a[0], a[1], 48, 240); const yy = y; y = yy; const h2 = field(b[0], b[1], 310, 250); y += Math.max(h1, h2); };
  two(['PATIENT ID', String(p.id)], ['AGE · SEX', `${p.age} · ${p.sex === 'F' ? 'Female' : p.sex === 'M' ? 'Male' : p.sex}`]);
  two(['RACE / ETHNICITY', p.race], ['INSURANCE', p.insurance]);
  two(['OCCUPATION', pr.occupation], ['SMOKING · ALCOHOL', `${pr.smoking_status || '—'} · ${pr.alcohol_use || '—'}`]);
  g.fillStyle = '#fdecea'; g.fillRect(40, y - 10, 532, 30);
  g.fillStyle = '#b3261e'; g.font = `800 7px ${SANS}`; g.fillText('ALLERGIES', 48, y + 1);
  g.font = `600 10px ${MONO}`; g.fillText((pr.allergies || ['—']).join(', ').slice(0, 80), 48, y + 14);
  y += 36;
  y += field('HOME MEDICATIONS', (pr.home_medications || []).map((m) => `${m.name} ${m.dose}`).join(' · '));
  y += field('CHRONIC CONDITIONS', (pr.chronic_conditions || []).join(' · '));
  y += field('SURGICAL HISTORY', (pr.surgical_history || []).join(' · '));
  y += field('FAMILY HISTORY', (pr.family_history || []).join(' · '));
  const encs = p.encounters;
  y += field('VISITS ON FILE', `${encs.length} encounters · ${fmtDate(encs[0]?.date)} – ${fmtDate(encs[encs.length - 1]?.date)}`);
  // filing call number
  g.fillStyle = '#efe9da'; g.fillRect(40, y, 532, 44);
  g.fillStyle = '#6f5a35'; g.font = `700 6.5px ${SANS}`; g.fillText('FILED UNDER (PRIMARY DIAGNOSIS · ICD-10 CHAPTER / BLOCK)', 48, y + 13);
  g.fillStyle = '#1b1b1b'; g.font = `700 12px ${MONO}`;
  g.fillText(`${p.primary?.code || '—'}  ${p.filing.block}`, 48, y + 32);
  g.font = `500 9px ${SANS}`; g.fillText((p.primary?.name || '').slice(0, 52), 250, y + 32);
  footer(g, { sid: 'profile', type: 'face_sheet' });
  return c;
}

/** Folder: manila back panel with the staggered tab carrying the visit label. */
export function renderFolder(e, idx, tabPos, scale = 1.2) {
  // folder panel is 612 x 792 page units + a tab 190 wide x 40 tall above it
  const W = 640, H = 830;
  const { c, g } = sheetCanvas(scale, W, H, 'rgba(0,0,0,0)');
  g.clearRect(0, 0, W, H);
  const tabX = 20 + tabPos * 210;
  g.fillStyle = '#d7bd84';
  g.beginPath();
  g.moveTo(0, 40); g.lineTo(tabX, 40); g.lineTo(tabX + 12, 2); g.lineTo(tabX + 188, 2); g.lineTo(tabX + 200, 40); g.lineTo(W, 40); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
  // label on the tab
  g.fillStyle = '#fbf8f0'; g.fillRect(tabX + 16, 7, 168, 29);
  g.fillStyle = '#1b1b1b'; g.font = `700 11px ${MONO}`; g.fillText(e.date, tabX + 22, 20);
  g.font = `600 7.5px ${SANS}`; g.fillStyle = '#5b574e';
  g.fillText(`${(e.type || '').toUpperCase()} · ${e.dept}`.slice(0, 34), tabX + 22, 31);
  // inner panel print
  g.fillStyle = 'rgba(120,90,40,0.5)'; g.font = `600 10px ${SANS}`;
  g.fillText(`ENCOUNTER ${e.id} · VISIT ${idx + 1}`, 30, 80);
  g.font = `400 9px ${SANS}`; g.fillText(e.attending || '', 30, 96);
  return c;
}

/** Imaging requisition: an outgoing half-sheet slip. */
export function renderOrderSlip(o, e, p, scale = 1.4) {
  const W = 612, H = 396;
  const { c, g } = sheetCanvas(scale, W, H, '#f6d9de');
  g.fillStyle = '#b2465c'; g.fillRect(0, 0, W, 34);
  g.fillStyle = '#fff'; g.font = `800 13px ${SANS}`; g.fillText('IMAGING REQUISITION', 24, 22);
  g.font = `600 10px ${MONO}`; g.fillText(`ORDER #${o.order_id}`, 470, 22);
  const f = (k, v, x, y, big) => {
    g.fillStyle = '#8a3a4c'; g.font = `700 7.5px ${SANS}`; g.fillText(k, x, y);
    g.fillStyle = '#1b1b1b'; g.font = `${big ? 700 : 500} ${big ? 15 : 11}px ${MONO}`; g.fillText(String(v || '—'), x, y + (big ? 20 : 16));
  };
  f('MODALITY', (o.modality || '').toUpperCase().replace('_', ' '), 24, 64, true);
  f('BODY REGION', (o.region || '').replace('_', ' / '), 230, 64, true);
  g.fillStyle = /stat/i.test(o.priority) ? '#b3261e' : '#2d7550';
  g.fillRect(470, 50, 118, 40);
  g.fillStyle = '#fff'; g.font = `800 16px ${SANS}`; g.fillText((o.priority || '').toUpperCase(), 486, 77);
  f('CLINICAL INDICATION', o.indication, 24, 124);
  f('ORDERING PROVIDER', o.provider, 24, 170);
  f('ORDER DATE', fmtDate(o.datetime), 300, 170);
  f('PATIENT', `PT ${p.id} · ${p.sex} · ${p.age}y`, 24, 216);
  f('ENCOUNTER', `${e.id} · ${e.dept}`, 300, 216);
  g.strokeStyle = '#b2465c'; g.setLineDash([4, 3]); g.strokeRect(12, 256, W - 24, 120); g.setLineDash([]);
  g.fillStyle = '#8a3a4c'; g.font = `700 7.5px ${SANS}`; g.fillText('RESULT RETURNS TO CHART AS', 24, 276);
  g.fillStyle = '#1b1b1b'; g.font = `500 11px ${MONO}`; g.fillText(`RADIOLOGY REPORT · section ${o.result_sid ?? '—'}`, 24, 294);
  return c;
}

/**
 * Problem list strip: the patient's master problem list. It lies in front of the hub; each row
 * sits on the ring of that diagnosis, and its tab is where that ring starts.
 */
export function renderProblemStrip(problems, rows, stripW, zMin, zMax, pxPerM) {
  const W = Math.round(stripW * pxPerM), H = Math.round((zMax - zMin) * pxPerM);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, W, H);
  const s = pxPerM / 1000; // 1 unit = 1 mm
  g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, W, 16 * s);
  g.fillStyle = '#fff'; g.font = `700 ${8.5 * s}px ${SANS}`; g.fillText('MASTER PROBLEM LIST', 42 * s, 11 * s);
  g.font = `500 ${6.5 * s}px ${MONO}`; g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillText('ICD-10-CM  ·  SNOMED CT', W - 118 * s, 11 * s);
  problems.forEach((p, i) => {
    const y = (rows[i].r - zMin) * pxPerM;
    const lh = rows[i].h * pxPerM;
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y + lh / 2); g.lineTo(W, y + lh / 2); g.stroke();
    const big = p.kind !== 'secondary';
    const fs = Math.min(lh * (big ? 0.42 : 0.5), (big ? 12 : 8.5) * s);
    g.fillStyle = '#1b1b1b'; g.font = `700 ${fs}px ${MONO}`;
    g.fillText(p.code, 42 * s, y + fs * 0.35);
    g.font = `${big ? 600 : 400} ${fs}px ${SANS}`;
    g.fillText(p.name.slice(0, 44), 104 * s, y + fs * 0.35, W - 190 * s);
    g.font = `400 ${fs * 0.72}px ${MONO}`; g.fillStyle = '#7b766b';
    g.fillText(`SCT ${p.snomed}`, W - 78 * s, y + fs * 0.3);
    g.font = `600 ${fs * 0.62}px ${SANS}`;
    g.fillText(p.kind.toUpperCase(), W - 78 * s, y - fs * 0.62);
  });
  return c;
}

/** Chart cover (inside face): patient label + filing call number. */
export function renderCover(p, chColor, scale = 1.0, outside = false) {
  const { c, g } = sheetCanvas(scale, 640, 780, '#d8bd86');
  if (outside) {
    // outside of the jacket: the chart label a clerk reads on the desk
    g.fillStyle = chColor; g.fillRect(0, 0, 60, 780);
    g.fillStyle = '#e9e2d0'; g.fillRect(150, 90, 380, 150);
    g.fillStyle = '#1b1b1b'; g.font = `800 34px ${MONO}`; g.fillText(`PT ${p.id}`, 175, 150);
    g.font = `600 17px ${SANS}`; g.fillText(`${p.sex === 'F' ? 'Female' : 'Male'} · ${p.age} years · ${p.encounters.length} visits`, 175, 185);
    g.font = `500 14px ${MONO}`; g.fillText(`${p.encounters[0].date.slice(0, 4)}–${p.encounters[p.encounters.length - 1].date.slice(0, 4)}`, 175, 212);
    g.fillStyle = '#e9e2d0'; g.fillRect(150, 560, 240, 130);
    g.fillStyle = '#1b1b1b'; g.font = `800 36px ${MONO}`; g.fillText(p.primary?.code || '', 170, 625);
    g.font = `600 15px ${MONO}`; g.fillText(p.filing.block, 170, 660);
    g.fillStyle = 'rgba(90,60,20,0.45)'; g.font = `700 13px ${SANS}`; g.fillText('MEDICAL RECORD · SYNTHETIC GENERAL HOSPITAL', 150, 740);
    return c;
  }
  g.fillStyle = chColor; g.fillRect(0, 0, 640, 60);
  g.fillStyle = '#fbf8f0'; g.fillRect(40, 110, 300, 120);
  g.fillStyle = '#1b1b1b'; g.font = `800 28px ${MONO}`; g.fillText(`PT ${p.id}`, 60, 160);
  g.font = `600 14px ${SANS}`; g.fillText(`${p.sex === 'F' ? 'Female' : 'Male'} · ${p.age} years`, 60, 190);
  g.font = `500 12px ${MONO}`; g.fillText(`${p.encounters.length} visits`, 60, 212);
  g.fillStyle = '#fbf8f0'; g.fillRect(40, 600, 200, 120);
  g.fillStyle = '#1b1b1b'; g.font = `800 30px ${MONO}`; g.fillText(p.primary?.code || '', 56, 660);
  g.font = `600 13px ${MONO}`; g.fillText(p.filing.block, 56, 690);
  g.fillStyle = 'rgba(90,60,20,0.4)'; g.font = `600 12px ${SANS}`; g.fillText('CONFIDENTIAL · SYNTHETIC RECORD', 330, 740);
  return c;
}

export { SECTION_LABEL };
