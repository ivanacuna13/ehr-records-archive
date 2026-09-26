import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * All connective threads of an open chart in one draw call. Each thread is a tube whose
 * per-thread state (opacity, highlight, pulse start, length, colour, dash) lives in a small
 * float texture, so trace mode can light and pulse any subset without rebuilding geometry.
 */
export class ThreadSystem {
  constructor() {
    this.items = [];
    this.mesh = null;
    this.uniforms = {
      uState: { value: null },
      uTime: { value: 0 },
      uVis: { value: 0 },
      uSpeed: { value: 1.1 },
    };
  }

  add(points, { color = '#ffffff', radius = 0.0016, opacity = 0.35, dashed = false, segments = 48, curve = 'catmull', data = null } = {}) {
    const c = curve === 'line' ? new THREE.LineCurve3(points[0], points[1])
      : curve === 'bezier' ? new THREE.QuadraticBezierCurve3(points[0], points[1], points[2])
        : new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const len = c.getLength();
    const id = this.items.length;
    this.items.push({ curve: c, len, color: new THREE.Color(color), radius, opacity, dashed, segments, active: 0, pulse: -1, dim: 0, data, targetActive: 0, targetOpacity: opacity, curOpacity: opacity });
    return id;
  }

  build(parent) {
    const geos = this.items.map((it, id) => {
      const g = new THREE.TubeGeometry(it.curve, it.segments, it.radius, 5, false);
      const n = g.attributes.position.count;
      const ids = new Float32Array(n).fill(id);
      g.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
      g.deleteAttribute('normal');
      return g;
    });
    const N = Math.max(1, this.items.length);
    this.data = new Float32Array(N * 2 * 4);
    this.tex = new THREE.DataTexture(this.data, N, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.needsUpdate = true;
    this.uniforms.uState.value = this.tex;
    this._write();
    const geo = geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aId; varying float vId; varying vec2 vUv2;
        void main(){ vId = aId; vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uState; uniform float uTime; uniform float uVis; uniform float uSpeed;
        varying float vId; varying vec2 vUv2;
        void main(){
          int id = int(vId + 0.5);
          vec4 st = texelFetch(uState, ivec2(id, 0), 0);
          vec4 co = texelFetch(uState, ivec2(id, 1), 0);
          float len = st.a; float d = vUv2.x * len;
          float dash = co.a;
          if (dash > 0.5 && fract(d / 0.018) > 0.5) discard;
          float act = st.g;
          float alpha = st.r;
          vec3 col = co.rgb;
          float glow = 0.0;
          if (st.b >= 0.0) {
            float t = uTime - st.b;
            float head = t * uSpeed;
            float reached = smoothstep(0.0, 0.04, head - d);
            alpha = mix(alpha * 0.5, 1.0, reached);
            float period = max(len / uSpeed + 1.4, 2.2);
            float h2 = mod(t, period) * uSpeed;
            float k = h2 - d;
            glow = exp(-k * k / 0.0025) * step(-0.06, k) * 3.0;
            col = col * (1.0 + 1.6 * reached) + vec3(glow) * 0.8;
            alpha = max(alpha, glow);
          } else {
            col *= 1.25 + act * 1.6;
            alpha = mix(alpha, 1.0, act);
          }
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uVis);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    parent.add(this.mesh);
    return this.mesh;
  }

  _write() {
    const N = Math.max(1, this.items.length), D = this.data;
    this.items.forEach((it, i) => {
      D[i * 4 + 0] = it.curOpacity;
      D[i * 4 + 1] = it.active;
      D[i * 4 + 2] = it.pulse;
      D[i * 4 + 3] = it.len;
      const o = (N + i) * 4;
      D[o + 0] = it.color.r; D[o + 1] = it.color.g; D[o + 2] = it.color.b; D[o + 3] = it.dashed ? 1 : 0;
    });
    if (this.tex) this.tex.needsUpdate = true;
  }

  /** fn(item, index) -> {opacity, active, pulse} (any subset). */
  setState(fn) {
    this.items.forEach((it, i) => {
      const s = fn(it, i) || {};
      it.targetOpacity = s.opacity ?? it.opacity;
      it.targetActive = s.active ?? 0;
      it.pulse = s.pulse ?? -1;
    });
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    let ch = false;
    const k = 1 - Math.exp(-6 * dt);
    for (const it of this.items) {
      const a = it.active + (it.targetActive - it.active) * k;
      const o = it.curOpacity + (it.targetOpacity - it.curOpacity) * k;
      if (Math.abs(a - it.active) > 1e-4 || Math.abs(o - it.curOpacity) > 1e-4) ch = true;
      it.active = a; it.curOpacity = o;
    }
    if (ch || this._pulseDirty) { this._write(); this._pulseDirty = false; }
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.tex.dispose();
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
  }
}
