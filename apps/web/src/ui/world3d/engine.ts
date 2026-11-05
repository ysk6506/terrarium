/**
 * The renderer behind the 3D view: lights, sky, shadows, ambient occlusion, a tilt-shift blur and
 * anti-aliasing, drawn only when something changed (REQ-036). It knows nothing about worlds; layers
 * add objects to `content` and the camera rig moves `camera`.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { world3d } from "../../logic";

const { THEME, QUALITY_HIGH, QualityGovernor, startQuality } = world3d;

import { Materials } from "./materials";

export type Quality = world3d.Quality;

export interface Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The camera the picture is drawn with: `camera`, or the straight-down one while the airflow map is a plan (REQ-072). */
  readonly view: THREE.Camera;
  /** Everything the layers add goes here. */
  readonly content: THREE.Group;
  /** Drawn over the finished picture, with no blur and nothing in front of it: selections, the ghost of what would be built. */
  readonly overlay: THREE.Scene;
  readonly mats: Materials;
  readonly sun: THREE.DirectionalLight;
  /** A soft light that rides with the camera, for close-ups. */
  readonly fill: THREE.PointLight;
  quality: Quality;
  /** Ask for a new frame. */
  invalidate(): void;
  /** Keep drawing frames while an animation runs; call the returned function when it ends. */
  animate(): () => void;
  /** Called before every frame with the seconds since the last. */
  onFrame(listener: (dt: number, time: number) => void): () => void;
  /** Called after every frame that was drawn, so things on the page can follow the picture (labels). */
  afterRender(listener: () => void): () => void;
  resize(width: number, height: number): void;
  /** Aim the shadow camera at a region. */
  fitShadow(center: THREE.Vector3, radius: number): void;
  setFog(near: number, far: number): void;
  setTilt(amount: number, centre?: number): void;
  /** Draw a plan: an orthographic camera looking straight down from where `camera` is, no ambient occlusion, no blur. */
  setTopDown(on: boolean): void;
  readonly topDown: boolean;
  /** Fit the orthographic camera to what `camera` sees at this distance from its target; the rig calls it on every move. */
  frameOrtho(distance: number): void;
  setQuality(q: Quality): void;
  /** Frames drawn so far (for tests and for knowing a screenshot is ready). */
  readonly frames: () => number;
  /** Nothing is waiting to be drawn and nothing is moving. */
  idle(): boolean;
  dispose(): void;
}

const TILT_VERTEX =
  "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }";

/** A one-direction blur whose radius grows with the distance from a horizontal band: the miniature look. */
const TILT_FRAGMENT = `
  uniform sampler2D tDiffuse; uniform vec2 dir; uniform float amount; uniform float centre; uniform vec2 res;
  varying vec2 vUv;
  void main(){
    float d = abs(vUv.y - centre);
    float r = smoothstep(0.14, 0.52, d) * amount;
    if (r < 0.02) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
    vec4 c = vec4(0.0); float total = 0.0;
    for (int i = -6; i <= 6; i++) {
      float w = 1.0 - abs(float(i)) / 7.0;
      c += texture2D(tDiffuse, vUv + dir * float(i) * r / res) * w;
      total += w;
    }
    gl_FragColor = c / total;
  }`;

function tiltPass(dir: THREE.Vector2): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      dir: { value: dir },
      amount: { value: 2.2 },
      centre: { value: 0.52 },
      res: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: TILT_VERTEX,
    fragmentShader: TILT_FRAGMENT,
  });
}

function skyDome(): THREE.Mesh {
  const [top, mid, bottom] = THEME.sky;
  return new THREE.Mesh(
    new THREE.SphereGeometry(4000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(top) },
        mid: { value: new THREE.Color(mid) },
        bot: { value: new THREE.Color(bottom) },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h>0.0 ? mix(mid, top, pow(h,0.55)) : mix(mid, bot, pow(-h,0.5)); gl_FragColor = vec4(c,1.0); }",
    }),
  );
}

function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

/** The soft light of the sky and the sun that casts shadows. */
function addLights(scene: THREE.Scene): { sun: THREE.DirectionalLight; fill: THREE.PointLight } {
  const { hemisphere } = THEME;
  scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
  const sun = new THREE.DirectionalLight(THEME.sun.color, THEME.sun.intensity);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  const fill = new THREE.PointLight("#fff2dd", 0, 40, 1.6);
  scene.add(sun, sun.target, fill);
  return { sun, fill };
}

/** Image-based light from the sky itself, so metal and glass have something to reflect. */
function skyLight(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const dome = skyDome();
  skyScene.add(dome);
  const texture = pmrem.fromScene(skyScene, 0.02).texture;
  pmrem.dispose();
  return texture;
}

interface Post {
  readonly composer: EffectComposer;
  readonly render: RenderPass;
  readonly ao: GTAOPass;
  readonly smaa: SMAAPass;
  readonly tilts: readonly ShaderPass[];
}

function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }),
  );
  const render = new RenderPass(scene, camera);
  composer.addPass(render);
  const ao = new GTAOPass(scene, camera, 2, 2);
  ao.output = GTAOPass.OUTPUT.Default;
  composer.addPass(ao);
  const tilts = [tiltPass(new THREE.Vector2(1, 0)), tiltPass(new THREE.Vector2(0, 1))];
  for (const t of tilts) composer.addPass(t);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);
  return { composer, render, ao, smaa, tilts };
}

const SUN_DIRECTION = new THREE.Vector3(-160, 260, 120).normalize();

class StageEngine implements Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 9000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 9000);
  private flat = false;
  private orthoDistance = 30;
  readonly content = new THREE.Group();
  readonly overlay = new THREE.Scene();
  readonly mats = new Materials();
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.PointLight;
  private readonly sky = skyDome();
  private readonly post: Post;
  private readonly listeners = new Set<(dt: number, time: number) => void>();
  private readonly drawn = new Set<() => void>();
  private readonly governor = new QualityGovernor();
  private current: Quality = QUALITY_HIGH;
  private width = 0;
  private height = 0;
  private dirty = true;
  private tiltAmount = 2.2;
  private running = 0;
  private count = 0;
  private last = performance.now();
  private lastDrawn = 0;
  private raf = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = makeRenderer(canvas);
    this.scene.add(this.sky, this.content);
    this.scene.environment = skyLight(this.renderer);
    this.scene.environmentIntensity = 0.7;
    this.scene.fog = new THREE.Fog(THEME.sky[1], 400, 3000);
    ({ sun: this.sun, fill: this.fill } = addLights(this.scene));
    this.post = makePost(this.renderer, this.scene, this.camera);
    this.setQuality(
      startQuality(graphicsOf(this.renderer), new URLSearchParams(location.search).get("quality")),
    );
    this.raf = requestAnimationFrame(this.tick);
  }

  get quality(): Quality {
    return this.current;
  }

  get view(): THREE.Camera {
    return this.flat ? this.ortho : this.camera;
  }

  get topDown(): boolean {
    return this.flat;
  }

  setTopDown(on: boolean): void {
    if (on === this.flat) return;
    this.flat = on;
    this.post.render.camera = this.view;
    this.post.ao.camera = this.view;
    this.post.ao.enabled = this.current.ao && !on;
    for (const p of this.post.tilts) p.enabled = !on && this.tiltAmount > 0.01;
    this.frameOrtho(this.orthoDistance);
    this.dirty = true;
  }

  frameOrtho(distance: number): void {
    this.orthoDistance = distance;
    const half = distance * Math.tan((this.camera.fov * Math.PI) / 360);
    const o = this.ortho;
    o.position.copy(this.camera.position);
    o.quaternion.copy(this.camera.quaternion);
    const aspect = this.width > 0 && this.height > 0 ? this.width / this.height : 16 / 9;
    o.left = -half * aspect;
    o.right = half * aspect;
    o.top = half;
    o.bottom = -half;
    o.near = 0.1;
    o.far = distance * 4 + 400;
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
  }

  set quality(q: Quality) {
    this.setQuality(q);
  }

  readonly frames = (): number => this.count;

  idle(): boolean {
    return !this.dirty && this.running === 0;
  }

  invalidate(): void {
    this.dirty = true;
  }

  animate(): () => void {
    this.running++;
    this.dirty = true;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.running--;
    };
  }

  onFrame(listener: (dt: number, time: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  afterRender(listener: () => void): () => void {
    this.drawn.add(listener);
    return () => this.drawn.delete(listener);
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.post.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameOrtho(this.orthoDistance);
    this.syncTiltSize();
    this.dirty = true;
  }

  private syncTiltSize(): void {
    const ratio = this.renderer.getPixelRatio();
    for (const p of this.post.tilts)
      (p.uniforms.res?.value as THREE.Vector2).set(this.width * ratio, this.height * ratio);
  }

  fitShadow(center: THREE.Vector3, radius: number): void {
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2.2);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = radius * 5;
    cam.updateProjectionMatrix();
    this.dirty = true;
  }

  setFog(near: number, far: number): void {
    const fog = this.scene.fog as THREE.Fog;
    fog.near = near;
    fog.far = far;
    this.dirty = true;
  }

  setTilt(amount: number, centre = 0.52): void {
    this.tiltAmount = amount;
    for (const p of this.post.tilts) {
      (p.uniforms.amount as { value: number }).value = amount;
      (p.uniforms.centre as { value: number }).value = centre;
      p.enabled = amount > 0.01 && !this.flat;
    }
    this.dirty = true;
  }

  setQuality(q: Quality): void {
    this.current = q;
    this.governor.set(q);
    this.post.ao.enabled = q.ao && !this.flat;
    this.post.smaa.enabled = q.smaa;
    this.renderer.domElement.dataset.quality = q.name;
    this.applyShadowSize();
    this.applySamples(q.samples);
    const ratio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    if (ratio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(ratio);
      this.post.composer.setPixelRatio(ratio);
      this.syncTiltSize();
    }
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.post.composer.dispose();
    this.mats.dispose();
    this.renderer.dispose();
  }

  private applySamples(samples: number): void {
    for (const target of [this.post.composer.renderTarget1, this.post.composer.renderTarget2]) {
      if (target.samples === samples) continue;
      target.samples = samples;
      target.dispose();
    }
  }

  private applyShadowSize(): void {
    const size = this.current.shadow;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const l of this.listeners) l(dt, now / 1000);
    if (!this.dirty && this.running === 0) return;
    // A light picture keeps to its frame rate so a slow machine is not drawing all the time.
    if (this.current.maxFps > 0 && now - this.lastDrawn < 1000 / this.current.maxFps) return;
    this.lastDrawn = now;
    this.dirty = false;
    this.sky.position.copy(this.camera.position);
    const timed = this.governor.measuring();
    const started = performance.now();
    this.post.composer.render();
    if (this.overlay.children.length > 0) {
      this.renderer.autoClear = false;
      this.renderer.render(this.overlay, this.view);
      this.renderer.autoClear = true;
    }
    this.count++;
    if (timed) this.judge(started);
    else this.governor.passed();
    for (const l of this.drawn) l();
  };

  /** Wait for the graphics card to finish this frame to learn what it cost; when slow, draw a lighter picture. */
  private judge(started: number): void {
    this.renderer.getContext().finish();
    const next = this.governor.frame(performance.now() - started);
    if (next) this.setQuality(next);
  }
}

/** The name the machine gives its graphics ("NVIDIA ...", "SwiftShader ..."), or nothing when it keeps it private. */
function graphicsOf(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  return new StageEngine(canvas);
}
