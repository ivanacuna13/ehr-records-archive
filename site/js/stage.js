import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from './util.js';

/**
 * Renderer, camera, damped orbit controls, HDRI environment, blurred floor reflections and the
 * post stack (GTAO -> depth of field -> bloom -> filmic tone mapping).
 */
export class Stage {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060708);
    this.scene.fog = new THREE.FogExp2(0x060708, 0.045);

    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.03, 80);
    this.camera.position.set(0, 3.4, 9.5);

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.06;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.7;
    c.panSpeed = 0.6;
    c.screenSpacePanning = true;
    c.target.set(0, 1.25, -1.2);
    this.focusDistance = 8;

    this._setupReflection();
    this._setupComposer();
    this.frameTimes = [];
    this.qualityCooldown = 2;
    addEventListener('resize', () => this.resize());
  }

  async loadEnvironment(url) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const hdr = await new RGBELoader().loadAsync(url);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose(); pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.scene.environmentRotation = new THREE.Euler(0, 1.2, 0);
  }

  // ---------------------------------------------------------------- reflections
  _setupReflection() {
    this.reflScale = 0.5;
    const w = Math.max(2, Math.floor(innerWidth * this.dpr * this.reflScale));
    const h = Math.max(2, Math.floor(innerHeight * this.dpr * this.reflScale));
    this.reflRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflMatrix = new THREE.Matrix4();
    this.reflUniforms = {
      uReflTex: { value: this.reflRT.texture },
      uReflMatrix: { value: this.reflMatrix },
      uReflStrength: { value: 0.17 },
    };
    this.reflHidden = [];
  }

  /** Patch a MeshStandardMaterial so it adds a mip-blurred planar reflection (y = 0 plane). */
  makeReflective(material) {
    const u = this.reflUniforms;
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflUv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = uReflMatrix * (modelMatrix * vec4(transformed, 1.0));');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uReflTex;\nuniform float uReflStrength;\nvarying vec4 vReflUv;')
        .replace('#include <opaque_fragment>', `
          {
            vec2 ruv = vReflUv.xy / vReflUv.w;
            vec3 nV = normalize(vViewPosition);
            float fres = 0.18 + 0.82 * pow(1.0 - clamp(abs(dot(normal, -nV)), 0.0, 1.0), 4.0);
            float lod = 1.5 + roughnessFactor * 7.0;
            vec2 px = vec2(0.004) * (0.5 + roughnessFactor * 3.0);
            vec3 refl = textureLod(uReflTex, ruv, lod).rgb * 0.4
              + textureLod(uReflTex, ruv + vec2(px.x, px.y * .6), lod).rgb * 0.15
              + textureLod(uReflTex, ruv - vec2(px.x, px.y * .6), lod).rgb * 0.15
              + textureLod(uReflTex, ruv + vec2(-px.x * .6, px.y), lod).rgb * 0.15
              + textureLod(uReflTex, ruv + vec2(px.x * .6, -px.y), lod).rgb * 0.15;
            outgoingLight += refl * fres * uReflStrength * (1.0 - roughnessFactor * 0.6);
          }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'reflective';
    return material;
  }

  _renderReflection() {
    const cam = this.camera, rc = this.reflCam;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(p);
    rc.position.set(p.x, -p.y, p.z);
    rc.up.set(0, 1, 0).applyMatrix4(rot); rc.up.y *= -1;
    rc.lookAt(look.x, -look.y, look.z);
    rc.near = cam.near; rc.far = cam.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    rc.matrixWorldInverse.copy(rc.matrixWorld).invert();
    this.reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    const r = this.renderer;
    for (const o of this.reflHidden) o.visible = false;
    const fog = this.scene.fog;
    r.setRenderTarget(this.reflRT);
    r.clear();
    r.render(this.scene, rc);
    r.setRenderTarget(null);
    for (const o of this.reflHidden) o.visible = true;
    this.scene.fog = fog;
  }

  // ---------------------------------------------------------------- post
  _setupComposer() {
    const r = this.renderer, w = innerWidth, h = innerHeight;
    const comp = (this.composer = new EffectComposer(r));
    comp.setPixelRatio(this.dpr);
    comp.setSize(w, h);
    comp.addPass(new RenderPass(this.scene, this.camera));

    const gtao = (this.gtao = new GTAOPass(this.scene, this.camera, w, h));
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    comp.addPass(gtao);
    // thin overlays (highlighter ink, threads) must not occlude the paper they sit on
    this.aoHidden = new Set();
    const gtaoRender = gtao.render.bind(gtao);
    gtao.render = (...a) => {
      const hidden = [];
      for (const o of this.aoHidden) if (o.visible) { o.visible = false; hidden.push(o); }
      gtaoRender(...a);
      for (const o of hidden) o.visible = true;
    };

    const bokeh = (this.bokeh = new BokehPass(this.scene, this.camera, { focus: 8, aperture: 0.0004, maxblur: 0.0025 }));
    comp.addPass(bokeh);

    // AO and depth-of-field are low-frequency effects: run their scene passes at half resolution
    const gtaoSetSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    const bokehSetSize = bokeh.setSize.bind(bokeh);
    bokeh.setSize = (w, h) => { bokehSetSize(w, h); bokeh.renderTargetDepth.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); };
    const bloom = (this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.5, 1.0));
    comp.addPass(bloom);
    comp.addPass(new OutputPass());
    comp.setSize(w, h);
    this.dof = { aperture: 0.0004, maxblur: 0.0025 };
  }

  setDof(aperture, maxblur) { this.dof.aperture = aperture; this.dof.maxblur = maxblur; }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.reflRT.setSize(Math.max(2, Math.floor(w * this.dpr * this.reflScale)), Math.max(2, Math.floor(h * this.dpr * this.reflScale)));
  }

  /** Adaptive resolution: keep ~60fps by trading pixel ratio, never the scene. Hysteresis keeps
   *  it from oscillating (every resize costs a hitch): after a downshift it will not climb back
   *  for a while, and it only climbs when frames are comfortably fast. */
  _quality(dt) {
    if (this.hold) { this.frameTimes.length = 0; return; }
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.qualityCooldown -= dt;
    this.noUpshift = Math.max(0, (this.noUpshift || 0) - dt);
    if (this.qualityCooldown > 0 || this.frameTimes.length < 60) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const med = sorted[30];
    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let next = this.dpr;
    if (mean > 1 / 56 && this.dpr > 0.8) { next = Math.max(0.8, this.dpr - 0.2); this.noUpshift = 20; }
    else if (mean < 1 / 59 && this.dpr < this.maxDpr && this.noUpshift === 0) next = Math.min(this.maxDpr, this.dpr + 0.1);
    if (next !== this.dpr) {
      this.dpr = next;
      this.resize();
      this.qualityCooldown = 1.5;
      this.frameTimes.length = 0;
    }
  }

  preRender(dt, focusPoint) {
    this.controls.update();
    // depth of field follows the point of interest
    const fp = focusPoint || this.controls.target;
    const d = this.camera.position.distanceTo(fp);
    this.focusDistance = damp(this.focusDistance, d, 5, dt);
    const u = this.bokeh.uniforms;
    u.focus.value = this.focusDistance;
    u.aperture.value = damp(u.aperture.value, this.dof.aperture, 4, dt);
    u.maxblur.value = damp(u.maxblur.value, this.dof.maxblur, 4, dt);
  }

  render(dt, focusPoint) {
    this.preRender(dt, focusPoint);
    if (!this._noRefl) this._renderReflection();
    this.composer.render(dt);
    this._quality(dt);
  }
}
