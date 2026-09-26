import { esc, fmtDate, fmtInt, chapterCss, problemColor, SECTION_LABEL, FINDING_LABEL, REL_LABEL } from './util.js';
import { FORM } from './docs.js';

export const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ legend (one line per mapping)
const G = {
  wing: '<svg viewBox="0 0 22 14"><rect x="3" y="1" width="16" height="12" rx="1" fill="none" stroke="#b08d57"/><rect x="5" y="3" width="12" height="2" fill="#e8e0cc"/></svg>',
  block: '<svg viewBox="0 0 22 14"><rect x="4" y="5" width="14" height="5" rx="1" fill="#c9a262"/><rect x="6" y="6.3" width="10" height="2.4" fill="#f1ece0"/></svg>',
  chart: '<svg viewBox="0 0 22 14"><rect x="6" y="1" width="3" height="12" fill="#d6bb82"/><rect x="10" y="1" width="6" height="12" fill="#d6bb82"/><rect x="10" y="2" width="6" height="2" fill="#c04a3c"/></svg>',
  thick: '<svg viewBox="0 0 22 14"><rect x="3" y="2" width="3" height="10" fill="#d6bb82"/><rect x="8" y="2" width="5" height="10" fill="#d6bb82"/><rect x="15" y="2" width="5" height="10" fill="#d6bb82" opacity=".9"/></svg>',
  spine: '<svg viewBox="0 0 22 14"><rect x="7" y="0" width="8" height="14" fill="#d6bb82"/><rect x="7" y="1" width="8" height="2.5" fill="#4f86b8"/><rect x="8" y="5" width="6" height="5" fill="#f4f1e8"/><rect x="7" y="11" width="8" height="1.5" fill="#e0b340"/></svg>',
  hub: '<svg viewBox="0 0 22 14"><circle cx="11" cy="7" r="6" fill="none" stroke="#c9a262"/><rect x="8" y="4" width="6" height="6" fill="#efeadd"/></svg>',
  spoke: '<svg viewBox="0 0 22 14"><circle cx="4" cy="7" r="2" fill="#c9a262"/><path d="M6 7h10" stroke="#c9a262" stroke-width="1.4"/><rect x="16" y="4" width="4" height="6" fill="#d6bb82"/></svg>',
  folder: '<svg viewBox="0 0 22 14"><path d="M3 4h5l1-2h5l1 2h4v9H3z" fill="#d6bb82"/></svg>',
  sheets: '<svg viewBox="0 0 22 14"><rect x="4" y="7" width="12" height="6" fill="#efeadd" transform="skewX(-20)"/><rect x="6" y="4" width="12" height="6" fill="#f7f4ec" transform="skewX(-20)"/><rect x="8" y="1" width="12" height="6" fill="#fff" transform="skewX(-20)"/></svg>',
  ring: '<svg viewBox="0 0 22 14"><path d="M2 12 A10 10 0 0 1 20 12" fill="none" stroke="#f2b24c" stroke-width="1.6"/><circle cx="11" cy="2.2" r="1.8" fill="#f2b24c"/></svg>',
  dash: '<svg viewBox="0 0 22 14"><path d="M2 7h18" stroke="#6fc3ff" stroke-width="1.4" stroke-dasharray="2 2"/></svg>',
  tab: '<svg viewBox="0 0 22 14"><rect x="3" y="3" width="16" height="8" fill="#f4efe2"/><rect x="1" y="5" width="4" height="4" fill="#ff7b72"/></svg>',
  hl: '<svg viewBox="0 0 22 14"><rect x="2" y="2" width="18" height="10" fill="#f7f4ec"/><rect x="3" y="6" width="14" height="3" fill="#ffd23a" opacity=".7"/></svg>',
  thread: '<svg viewBox="0 0 22 14"><path d="M2 3 Q 10 3 20 12" fill="none" stroke="#8ee08a" stroke-width="1.2"/></svg>',
  code: '<svg viewBox="0 0 22 14"><rect x="2" y="3" width="18" height="8" rx="2" fill="none" stroke="#cfa865"/><path d="M5 7h12" stroke="#cfa865" stroke-dasharray="1.5 1"/></svg>',
  order: '<svg viewBox="0 0 22 14"><rect x="3" y="3" width="11" height="8" fill="#f6d9de"/><path d="M14 7h6m-2-2l2 2-2 2" stroke="#ff8fa6" fill="none"/></svg>',
  neg: '<svg viewBox="0 0 22 14"><rect x="2" y="2" width="18" height="10" fill="#f7f4ec"/><rect x="3" y="6" width="14" height="3" fill="#78aaff" opacity=".7"/></svg>',
};

export function buildLegend() {
  const L = (g, b, t) => `<div class="lg"><div class="g">${G[g]}</div><div><b>${b}</b> <span>${t}</span></div></div>`;
  $('#legendbody').innerHTML = `
    <div class="lg-h" data-l="1">Hospital · the archive</div>
    ${L('wing', 'Wing', '= an ICD-10 chapter; the lit sign gives its code range and chart count.')}
    ${L('block', 'Shelf label + divider', '= an ICD-10 block, the next level of the classification.')}
    ${L('chart', 'Chart', '= one patient, filed under the chapter and block of their primary diagnosis.')}
    ${L('thick', 'Thickness', '= number of visits in the chart, like a real paper record.')}
    ${L('spine', 'Spine', '= chapter colour band, primary ICD-10 call number, year-of-last-visit sticker.')}
    <div class="lg-h" data-l="2">Patient · the open chart</div>
    ${L('hub', 'Hub', '= the patient: open chart jacket and face sheet. Every record is keyed to it.')}
    ${L('spoke', 'Brass spoke', '= binds each visit folder to the patient.')}
    ${L('folder', 'Folder', '= one encounter, placed clockwise by date; the tab carries date and department.')}
    ${L('sheets', 'Sheets', '= that visit\'s chart sections, each printed as its own form.')}
    ${L('tab', 'Problem list', '= diagnoses held at patient level; each tab begins that diagnosis\'s ring.')}
    ${L('ring', 'Ring + beads', '= a diagnosis through time; a bead marks each visit where it was documented.')}
    ${L('dash', 'Dashed ring', '= time before the diagnosis was first documented.')}
    ${L('hl', 'Highlight', '= a finding, on the exact line it was abstracted from.')}
    ${L('neg', 'Blue highlight', '= a documented pertinent negative (absent finding).')}
    ${L('thread', 'Thread', '= finding supports that diagnosis at that visit (typed relation).')}
    ${L('code', 'Call-number tags', '= ICD-10 on tabs and spines, SNOMED CT / LOINC in sheet margins.')}
    ${L('order', 'Pink slip', '= imaging order leaving the visit; its thread returns to the radiology report.')}
  `;
  $('#legendtoggle').onclick = () => $('#legend').classList.toggle('collapsed');
}
export function legendLevel(level) {
  document.body.classList.toggle('lv2', level === 2);
  document.querySelectorAll('.lg-h').forEach((h) => h.classList.toggle('act', h.dataset.l === String(level)));
}

// ------------------------------------------------------------------ readout
export function renderReadout(tot, shown) {
  const cell = (k, v, all) => `<div><div class="k">${k}</div><div class="v">${fmtInt(v)}${all != null && all !== v ? `<small> / ${fmtInt(all)}</small>` : ''}</div></div>`;
  $('#readout').innerHTML = cell('Patients', shown.patients, tot.patients) + cell('Encounters', shown.encounters, tot.encounters) + cell('Documents', shown.documents, tot.documents);
}

// ------------------------------------------------------------------ spine tooltip (level 1)
export function spineLabel(p, chapters) {
  const ch = chapters.find((c) => c.no === p.ch);
  const top = p.dx.slice(0, 4).map(([c, n]) => `<li><code>${esc(c)}</code><span>${esc(n)}</span></li>`).join('');
  return `<div class="spine" style="--c:${chapterCss(p.ch)}">
    <div class="top"><span class="id">PT ${p.id}</span><span class="demo">${p.sex === 'F' ? 'F' : 'M'} · ${p.age} y</span><span class="call">${esc(p.pcode || '—')}</span></div>
    <div class="meta">${p.n} visits · ${p.span[0].slice(0, 4)}–${p.span[1].slice(0, 4)} · ${esc(ch?.name || '')} wing</div>
    <ul>${top}</ul>
  </div>`;
}

export function smallLabel(type, name, code) {
  return `<div class="lbl"><div class="t">${esc(type)}</div><div class="n">${esc(name)}</div>${code ? `<div class="c">${esc(code)}</div>` : ''}</div>`;
}

// ------------------------------------------------------------------ side panel content (level 2)
function docHtml(sh, P, traceDid) {
  const form = FORM[sh.doc.type] || FORM.hpi;
  const byLine = new Map();
  for (const f of sh.doc.findings) if (f.line != null) { if (!byLine.has(f.line)) byLine.set(f.line, []); byLine.get(f.line).push(f); }
  const lines = sh.doc.lines.map((l, i) => {
    const fs = byLine.get(i);
    if (!fs) return esc(l);
    const neg = fs.every((f) => f.present === 0);
    const lit = traceDid == null || fs.some((f) => f.links.some((x) => x.did === traceDid));
    return `<mark class="${neg ? 'neg' : ''} ${lit ? '' : 'dim'}" title="${esc(fs.map((f) => f.name).join(', '))}">${esc(l)}</mark>`;
  });
  return `<div class="doc"><div class="band" style="background:${form.color}">${esc(form.title)} · FORM ${form.no}</div>${lines.join('\n')}</div>`;
}

function codeChips(o) {
  const c = [];
  if (o.code) c.push(`<span class="cn">ICD-10 ${esc(o.code)}</span>`);
  if (o.snomed) c.push(`<span class="cn s">SNOMED ${esc(o.snomed)}</span>`);
  if (o.loinc) c.push(`<span class="cn l">LOINC ${esc(o.loinc)}</span>`);
  return `<div class="codes">${c.join('')}</div>`;
}

function dxChip(P, did, idx) {
  const pr = P.problems[idx];
  return `<span class="chip" data-trace="${did}"><i style="background:${problemColor(idx)}"></i>${esc(pr.code)} · ${esc(pr.name)}</span>`;
}

export function panelSheet(sh, P, chart, traceDid) {
  const e = P.encounters[sh.enc];
  const fl = sh.doc.findings;
  const items = fl.map((f) => {
    const sup = f.links.map((l) => { const i = chart.probIndex.get(l.did); return i == null ? '' : `<div class="dd">${esc(REL_LABEL[l.rel] || l.rel)} ${dxChip(P, l.did, i)}</div>`; }).join('');
    return `<div class="item" data-finding="${f.i}"><div class="sw" style="background:${f.present === 0 ? '#78aaff' : '#ffd23a'}"></div><div class="m"><div class="nm">${esc(f.name)}${f.value ? ` <span class="sub">— ${esc(f.value)}</span>` : ''}</div><div class="dd">${esc(FINDING_LABEL[f.type] || f.type)} · ${f.present === 0 ? 'absent' : 'present'} · ${esc(f.relevance || '')}</div>${sup}</div></div>`;
  }).join('');
  return `<div class="eyebrow">${esc(SECTION_LABEL[sh.doc.type] || sh.doc.type)} · visit ${sh.enc + 1}</div>
    <h2>${esc((FORM[sh.doc.type] || FORM.hpi).title)}</h2>
    <div class="sub">${fmtDate(e.date)} · ${esc(e.dept)} · ${esc(e.attending)}</div>
    <div class="codes"><span class="cn">section ${sh.sid}</span><span class="cn">encounter ${e.id}</span></div>
    <h3>Document</h3>${docHtml(sh, P, traceDid)}
    <h3>Findings abstracted from this sheet · ${fl.length}</h3>
    <div class="list">${items || '<div class="note">No coded findings were abstracted from this section.</div>'}</div>`;
}

export function panelFinding(f, P, chart) {
  const sh = chart.sheets.find((s) => s.sid === f.sid);
  const line = sh && f.line != null ? sh.doc.lines[f.line] : null;
  const e = P.encounters[chart.encIndex.get(f.enc)];
  const sup = f.links.map((l) => { const i = chart.probIndex.get(l.did); return i == null ? '' : `<div class="item" data-trace="${l.did}"><div class="sw" style="background:${problemColor(i)}"></div><div class="m"><div class="nm">${esc(P.problems[i].name)}</div><div class="dd">${esc(REL_LABEL[l.rel] || l.rel)} · ICD-10 ${esc(P.problems[i].code)}${l.freq != null ? ` · frequency ${Math.round(l.freq * 100)}%` : ''}</div></div></div>`; }).join('');
  return `<div class="eyebrow">Finding · ${esc(FINDING_LABEL[f.type] || f.type)}</div>
    <h2>${esc(f.name)}</h2>
    <div class="sub">${f.present === 0 ? 'Documented as absent (pertinent negative)' : 'Documented as present'}${f.value ? ` · ${esc(f.value)}` : ''}</div>
    ${codeChips(f)}
    <h3>Record</h3>
    <div class="kv">
      <div class="k">Value</div><div>${esc(f.value || '—')}${f.num != null ? ` <span class="sub">(${f.num})</span>` : ''}</div>
      <div class="k">Normal range</div><div>${esc(f.normal || '—')}</div>
      <div class="k">Relevance</div><div>${esc(f.relevance || '—')}</div>
      <div class="k">SNOMED</div><div>${esc(f.snomed_desc || '—')}</div>
      ${f.loinc ? `<div class="k">LOINC</div><div>${esc(f.loinc_desc || f.loinc)}</div>` : ''}
      <div class="k">Visit</div><div>${e ? `${fmtDate(e.date)} · ${esc(e.dept)}` : '—'}</div>
      <div class="k">Source</div><div>${sh ? `${esc(SECTION_LABEL[sh.doc.type])} · section ${sh.sid}${f.line != null ? `, line ${f.line + 1}` : ' (line not located)'}` : 'not placed on a document'}</div>
    </div>
    ${line ? `<h3>Source line</h3><div class="doc"><mark class="${f.present === 0 ? 'neg' : ''}">${esc(line)}</mark></div>` : ''}
    <h3>Supports · ${f.links.length}</h3><div class="list">${sup || '<div class="note">No typed link to a diagnosis documented at this visit.</div>'}</div>
    ${sh ? `<button class="cta" data-sheet="${sh.sid}">Open source document</button>` : ''}`;
}

export function panelProblem(i, P, chart, tracing) {
  const pr = P.problems[i];
  const nF = P.findings.filter((f) => f.links.some((l) => l.did === pr.did)).length;
  const visits = pr.docs.map((d) => {
    const k = chart.encIndex.get(d.enc); const e = P.encounters[k];
    const n = P.findings.filter((f) => f.enc === d.enc && f.links.some((l) => l.did === pr.did)).length;
    return `<div class="item" data-visit="${k}"><div class="sw" style="background:${problemColor(i)}"></div><div class="m"><div class="nm">${fmtDate(e.date)} · ${esc(e.dept)}</div><div class="dd">${esc(d.how)} · ${n} supporting finding${n === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  return `<div class="eyebrow">Problem list · ${esc(pr.kind)}</div>
    <h2>${esc(pr.name)}</h2>
    <div class="sub">${esc(pr.icd_desc || '')}</div>
    ${codeChips(pr)}
    <h3>Record</h3>
    <div class="kv">
      <div class="k">Category</div><div>${esc(pr.category || '—')}</div>
      <div class="k">Acuity</div><div>${esc(pr.acuity || '—')}</div>
      <div class="k">SNOMED term</div><div>${esc(pr.snomed_desc || '—')}</div>
      <div class="k">ICD-10 block</div><div class="mono">${esc(pr.block || '—')}</div>
      <div class="k">Evidence</div><div>${nF} linked findings</div>
      ${pr.primary ? '<div class="k">Filing</div><div>Primary diagnosis — this chart is shelved under it</div>' : ''}
    </div>
    <button class="cta" data-trace="${pr.did}">${tracing ? 'Stop trace' : 'Trace through the chart'}</button>
    <h3>Documented at ${pr.docs.length} visit${pr.docs.length === 1 ? '' : 's'}</h3><div class="list">${visits}</div>`;
}

export function panelVisit(k, P, chart) {
  const e = P.encounters[k];
  const docs = chart.folders[k].sheets.map((sh) => {
    const n = sh.doc.findings.length;
    return `<div class="item" data-sheet="${sh.sid}"><div class="sw" style="background:${(FORM[sh.doc.type] || FORM.hpi).color}"></div><div class="m"><div class="nm">${esc(SECTION_LABEL[sh.doc.type] || sh.doc.type)}</div><div class="dd">section ${sh.sid} · ${n} finding${n === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  const dx = P.problems.map((pr, i) => (pr.docs.some((d) => d.enc === e.id) ? dxChip(P, pr.did, i) : '')).join('');
  const orders = e.orders.map((o) => `<div class="item" data-order="${k}:${o.order_id}"><div class="sw" style="background:#f6a3b3"></div><div class="m"><div class="nm">${esc(o.modality)} · ${esc(o.region)}</div><div class="dd">${esc(o.priority)} · ${esc(o.indication)}</div></div></div>`).join('');
  return `<div class="eyebrow">Encounter · visit ${k + 1} of ${P.encounters.length}</div>
    <h2>${esc(e.cc)}</h2>
    <div class="sub">${fmtDate(e.date)} · ${esc(e.type)} · ${esc(e.dept)}</div>
    <div class="codes"><span class="cn">encounter ${e.id}</span></div>
    <h3>Record</h3>
    <div class="kv"><div class="k">Attending</div><div>${esc(e.attending)}</div><div class="k">Visit type</div><div>${esc(e.type)}</div><div class="k">Note source</div><div>${esc(e.method)}</div></div>
    <h3>Diagnoses documented</h3><div>${dx || '<span class="note">none</span>'}</div>
    ${orders ? `<h3>Orders</h3><div class="list">${orders}</div>` : ''}
    <h3>Documents in this folder · ${chart.folders[k].sheets.length}</h3><div class="list">${docs}</div>`;
}

export function panelOrder(k, o, P, chart) {
  const e = P.encounters[k];
  return `<div class="eyebrow">Imaging order · outgoing requisition</div>
    <h2>${esc(o.modality)} · ${esc(o.region)}</h2>
    <div class="sub">${fmtDate(o.datetime)} · ${esc(o.priority)}</div>
    <div class="codes"><span class="cn">order ${o.order_id}</span></div>
    <h3>Record</h3>
    <div class="kv"><div class="k">Indication</div><div>${esc(o.indication)}</div><div class="k">Ordered by</div><div>${esc(o.provider)}</div><div class="k">Priority</div><div>${esc(o.priority)}</div><div class="k">From visit</div><div>${fmtDate(e.date)} · ${esc(e.dept)}</div></div>
    ${o.result_sid ? `<button class="cta" data-sheet="${o.result_sid}">Open returned radiology report</button>` : '<div class="note">No result section on file.</div>'}`;
}

export function panelFace(P) {
  const pr = P.profile || {};
  const row = (k, v) => `<div class="k">${k}</div><div>${esc(v || '—')}</div>`;
  const dx = P.problems.map((p, i) => `<div class="item" data-problem="${i}"><div class="sw" style="background:${problemColor(i)}"></div><div class="m"><div class="nm">${esc(p.name)}</div><div class="dd"><span class="mono">${esc(p.code)}</span> · ${esc(p.kind)} · ${p.docs.length} visit${p.docs.length === 1 ? '' : 's'}</div></div></div>`).join('');
  return `<div class="eyebrow">Face sheet · patient</div>
    <h2>Patient ${P.id}</h2>
    <div class="sub">${P.age} years · ${P.sex === 'F' ? 'female' : 'male'} · ${P.encounters.length} visits</div>
    <div class="codes"><span class="cn">filed ${esc(P.primary?.code || '')} · ${esc(P.filing.block)}</span></div>
    <h3>Demographics</h3>
    <div class="kv">${row('Race / ethnicity', P.race)}${row('Insurance', P.insurance)}${row('Occupation', pr.occupation)}${row('Smoking', pr.smoking_status)}${row('Alcohol', pr.alcohol_use)}${row('Allergies', (pr.allergies || []).join(', '))}</div>
    <h3>Home medications</h3><div class="kv">${(pr.home_medications || []).map((m) => row(esc(m.name), m.dose)).join('') || '<div class="note">none</div>'}</div>
    <h3>Master problem list · ${P.problems.length}</h3><div class="list">${dx}</div>`;
}
