import * as THREE from 'three';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Frame-rate independent exponential approach. */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

/** Minimal tween manager: every transition in the app goes through here, so nothing snaps. */
class Tweens {
  constructor() { this.list = []; }
  add({ duration = 1, delay = 0, ease = easeInOutCubic, update, complete }) {
    return new Promise((resolve) => {
      this.list.push({ t: -delay, duration, ease, update, complete, resolve });
    });
  }
  tick(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = clamp(tw.t / tw.duration, 0, 1);
      tw.update && tw.update(tw.ease(k), k);
      if (k >= 1) {
        this.list.splice(i, 1);
        tw.complete && tw.complete();
        tw.resolve();
      }
    }
  }
  get busy() { return this.list.length > 0; }
}
export const tweens = new Tweens();

// ICD-10 chapter palette: muted archival dyes, spaced in hue so neighbouring wings differ.
const CH_HUES = {
  1: [8, .55, .50], 2: [330, .38, .52], 3: [350, .50, .44], 4: [38, .70, .52], 5: [270, .30, .58],
  6: [215, .45, .55], 7: [185, .45, .48], 8: [160, .35, .45], 9: [0, .62, .46], 10: [195, .55, .52],
  11: [28, .55, .48], 12: [20, .35, .62], 13: [85, .30, .48], 14: [48, .55, .55], 15: [310, .42, .60],
  16: [290, .30, .66], 17: [240, .30, .60], 18: [60, .12, .62], 19: [120, .28, .42], 20: [0, 0, .55],
  21: [45, .10, .70], 22: [0, 0, .45],
};
export function chapterColor(no) {
  const [h, s, l] = CH_HUES[no] || [0, 0, .5];
  return new THREE.Color().setHSL(h / 360, s, l, THREE.SRGBColorSpace);
}
export function chapterCss(no) {
  const [h, s, l] = CH_HUES[no] || [0, 0, .5];
  return `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

// Year-of-last-visit retention bands (real paper-chart convention: a coloured year sticker).
const YEAR_HUES = ['#d9d4c7', '#e0b340', '#c9573f', '#4f86b8', '#5f9c63', '#8a63a8', '#d27d2c', '#3d9a9a', '#b8446b', '#6d6d6d', '#a2b83c'];
export function yearColor(year) {
  return YEAR_HUES[(((year - 2020) % YEAR_HUES.length) + YEAR_HUES.length) % YEAR_HUES.length];
}

// Problem ring colours (level 2): distinct, readable on dark, not the chapter palette.
const PROB = ['#f2b24c', '#6fc3ff', '#ff7b72', '#8ee08a', '#c79bff', '#ffd86b', '#4fd6c6', '#ff9fd0', '#b4c4ff', '#ffb38a', '#9be15d', '#e7e7e7'];
export const problemColor = (i) => PROB[i % PROB.length];

export const SECTION_LABEL = {
  chief_complaint: 'Chief Complaint', hpi: 'History of Present Illness', pmh: 'Past Medical History',
  psh: 'Past Surgical History', medications: 'Medications', allergies: 'Allergies',
  family_history: 'Family History', social_history: 'Social History', vitals: 'Vital Signs',
  physical_exam: 'Physical Exam', labs: 'Laboratory Results', imaging: 'Imaging Report',
  other_studies: 'Diagnostic Studies', pathology: 'Pathology Report', assessment: 'Assessment',
  plan: 'Plan', ros: 'Review of Systems',
};
export const FINDING_LABEL = {
  symptom: 'Symptom', sign: 'Exam sign', vital_sign: 'Vital sign', lab_value: 'Lab value',
  imaging_finding: 'Imaging finding', procedure_result: 'Study result', medication: 'Medication',
  history_item: 'History item', demographic: 'Demographic',
};
export const REL_LABEL = {
  pathognomonic: 'pathognomonic for', highly_suggestive: 'highly suggestive of', commonly_seen: 'commonly seen in',
  risk_factor: 'risk factor for', rules_out: 'argues against', protective: 'protective against',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
export const dateNum = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 864e5; };
export const fmtInt = (n) => n.toLocaleString('en-US');
