import * as THREE from 'three';
import { esc, clock } from './util.js';

// Guided tour: each stop flies the camera, drives the real UI (trace, open chart, scrub,
// assemble) and plays a narrated clip. When it ends the visitor is back in free roam.

const sleep = (s) => clock.sleep(s);

export class Tour {
  constructor(api) {
    this.api = api;
    this.steps = null;
    this.running = false;
    this.muted = false;
    this.paused = false;
    this.bar = document.querySelector('#tourbar');
    this.bar.querySelector('#tnext').onclick = () => this.skip();
    this.bar.querySelector('#texit').onclick = () => this.stop();
    this.bar.querySelector('#tpause').onclick = () => this.togglePause();
    this.bar.querySelector('#tmute').onclick = () => this.toggleMute();
  }

  async load() {
    if (!this.steps) this.steps = await fetch('tour/narration.json').then((r) => r.json());
    return this.steps;
  }

  // ---------------------------------------------------------------- per-stop choreography
  actions() {
    const A = this.api;
    const wingPose = (no, dist = 3.1, h = 1.3) => {
      const w = A.archive.wings.find((x) => x.ch.no === no);
      const face = new THREE.Vector3(-Math.sin(w.phi), 0, Math.cos(w.phi));
      const target = w.pos.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(face, 0.1);
      return { target, position: target.clone().addScaledVector(face, dist).add(new THREE.Vector3(0.25, 0.35, 0)) };
    };
    const pid = 1672;
    return {
      welcome: async () => { A.setTrace(null); await A.flyTo(A.hospitalPose(), 3.2, 0.04); },
      wings: async () => { await A.flyTo(wingPose(9), 3.2, 0.08); },
      charts: async () => {
        const w = A.archive.wings.find((x) => x.ch.no === 9);
        const i = w.idx[Math.floor(w.idx.length * 0.42)];
        const cw = A.archive.chartWorld(i), f = A.archive.chartFacing(i);
        await A.flyTo({ target: cw.clone(), position: cw.clone().addScaledVector(f, 0.72).add(new THREE.Vector3(0.12, 0.1, 0)) }, 2.6, 0.05);
        A.showChartTip(i);
      },
      trace: async () => {
        A.hideChartTip();
        A.flyTo(A.hospitalPose(), 2.8, 0.05);
        await sleep(1.2);
        A.setTrace('I10');
      },
      open: async () => {
        await sleep(1.5);
        A.setTrace(null);
        await A.openPatient(A.H.patients.findIndex((p) => p.id === pid));
      },
      hub: async () => {
        const c = A.chart();
        await A.flyTo({ target: new THREE.Vector3(0, 0.95, -0.25 * c.Rf), position: new THREE.Vector3(-1.1, 2.3, 2.6) }, 3, 0.03);
      },
      rings: async () => {
        await A.flyTo({ target: new THREE.Vector3(0.1, 0.74, 0.35), position: new THREE.Vector3(0.3, 2.35, 2.0) }, 2.6, 0.03);
      },
      evidence: async () => {
        const c = A.chart();
        A.flyTo(c.overviewPose(), 2.4, 0.03);
        await sleep(0.8);
        A.setPatientTrace(c.p.primary.did);
      },
      reading: async () => {
        await sleep(1.0);
        A.setPatientTrace(null);
        await A.focusVisit(2);
      },
      assembled: async () => { await A.setMode(false); },
      closing: async () => { await A.closePatient(); },
    };
  }

  // ---------------------------------------------------------------- playback
  play(id) {
    return new Promise((resolve) => {
      const step = this.steps.find((s) => s.id === id);
      const fallback = Math.max(3, step.text.split(/\s+/).length / 2.6);
      this._resolveAudio = resolve;
      if (clock.virtual) {
        // record mode: log where each clip starts; the audio is laid in afterwards
        (window.__recordLog = window.__recordLog || []).push({ id, t: clock.t });
        clock.sleep(step.duration || fallback).then(resolve);
        return;
      }
      if (this.muted) { this._timer = setTimeout(resolve, fallback * 1000); return; }
      const a = (this.audio = new Audio(`tour/${id}.mp3`));
      a.onended = () => resolve();
      a.onerror = () => { this._timer = setTimeout(resolve, fallback * 1000); };
      a.play().catch(() => { this._timer = setTimeout(resolve, fallback * 1000); });
    });
  }

  skip() {
    if (this.audio) { this.audio.pause(); }
    clearTimeout(this._timer);
    if (this.paused) this.togglePause();
    this._resolveAudio && this._resolveAudio();
  }

  togglePause() {
    this.paused = !this.paused;
    this.bar.querySelector('#tpause').textContent = this.paused ? 'Resume' : 'Pause';
    if (this.audio) this.paused ? this.audio.pause() : this.audio.play().catch(() => {});
    if (!this.paused && this._resume) { const r = this._resume; this._resume = null; r(); }
  }

  toggleMute() {
    this.muted = !this.muted;
    this.bar.querySelector('#tmute').textContent = this.muted ? 'Sound off' : 'Sound on';
    if (this.audio) this.audio.muted = this.muted;
  }

  stop() {
    this.stopped = true;
    this.skip();
  }

  caption(i) {
    const s = this.steps[i];
    this.bar.querySelector('#tstep').textContent = `${i + 1} / ${this.steps.length}`;
    this.bar.querySelector('#ttitle').textContent = s.title;
    this.bar.querySelector('#ttext').innerHTML = esc(s.text);
    this.bar.querySelector('#tdots').innerHTML = this.steps.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
  }

  async start() {
    if (this.running) return;
    await this.load();
    this.running = true; this.stopped = false; this.paused = false;
    this.api.setTouring(true);
    this.bar.classList.remove('hidden');
    const acts = this.actions();
    try {
      for (let i = 0; i < this.steps.length && !this.stopped; i++) {
        this.caption(i);
        const s = this.steps[i];
        await Promise.all([this.play(s.id), acts[s.id]()]);
        if (this.paused) await new Promise((r) => (this._resume = r));
        if (!this.stopped) await sleep(0.6);
      }
    } catch (e) {
      console.error('tour', e);
    }
    this.bar.classList.add('hidden');
    this.running = false;
    this.api.setTouring(false);
  }
}
