/**
 * Drawing the stage with three.js: the camera, the floor and its glass case, one instanced mesh per
 * look, selection outlines and the placement ghost, and finding what the pointer is over.
 */
import * as THREE from "three";
import type { builder } from "../../logic";
import type { Ghost } from "./Stage";

export const css = (name: string, fallback: string) =>
  (typeof window === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

export interface World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly content: THREE.Group;
  readonly overlay: THREE.Group;
  readonly ground: THREE.Mesh;
  meshes: { mesh: THREE.InstancedMesh; ids: readonly string[] }[];
  view: { cx: number; cz: number; zoom: number; azimuth: number; span: number };
  render(): void;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

export function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const m = child as THREE.Mesh;
    if (m.geometry && m.geometry !== BOX) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else mat?.dispose();
  }
}

export function placeCamera(w: World3D, width: number, height: number): void {
  const { cx, cz, zoom, azimuth, span } = w.view;
  const aspect = width / Math.max(1, height);
  const half = (span / 2) * zoom;
  w.camera.left = -half * aspect;
  w.camera.right = half * aspect;
  w.camera.top = half;
  w.camera.bottom = -half;
  const r = span * 2;
  const a = (azimuth * Math.PI) / 180;
  // Isometric: 35.264° down, looking along a diagonal.
  w.camera.position.set(cx + r * Math.sin(a), r * 0.816, cz + r * Math.cos(a));
  w.camera.lookAt(cx, 0, cz);
  w.camera.near = 0.1;
  w.camera.far = r * 6;
  w.camera.updateProjectionMatrix();
}

export function buildFloor(w: World3D, area: builder.Scene["area"], grid: number): void {
  const floorColor = new THREE.Color(css("--surface", "#f8faf9"));
  w.ground.geometry.dispose();
  w.ground.geometry = new THREE.PlaneGeometry(area.w, area.d);
  (w.ground.material as THREE.MeshBasicMaterial).color = floorColor;
  w.ground.position.set(area.w / 2, 0, area.d / 2);
  const lines: number[] = [];
  const step = grid * Math.max(1, Math.ceil(Math.max(area.w, area.d) / grid / 400));
  for (let x = 0; x <= area.w + 1e-6; x += step) lines.push(x, 0.005, 0, x, 0.005, area.d);
  for (let z = 0; z <= area.d + 1e-6; z += step) lines.push(0, 0.005, z, area.w, 0.005, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const tiles = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: css("--line", "#c8d3ce") }),
  );
  // The glass case: the level's outline, lifted, like the edge of a vitrine.
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(area.w, Math.max(2.6, area.w / 20), area.d)),
    new THREE.LineBasicMaterial({
      color: css("--line-strong", "#a9b8b2"),
      transparent: true,
      opacity: 0.8,
    }),
  );
  edge.position.set(area.w / 2, Math.max(2.6, area.w / 20) / 2, area.d / 2);
  w.content.add(tiles, edge);
}

export function buildGroups(w: World3D, scene: builder.Scene): void {
  w.meshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  for (const g of scene.groups) {
    const count = g.ids.length;
    const material = new THREE.MeshLambertMaterial({
      transparent: g.opacity < 1,
      opacity: g.opacity,
      depthWrite: g.opacity >= 1,
    });
    const mesh = new THREE.InstancedMesh(BOX, material, count);
    for (let i = 0; i < count; i++) {
      const b = g.boxes;
      m.compose(
        new THREE.Vector3(b[i * 6] as number, b[i * 6 + 1] as number, b[i * 6 + 2] as number),
        q,
        new THREE.Vector3(b[i * 6 + 3] as number, b[i * 6 + 4] as number, b[i * 6 + 5] as number),
      );
      mesh.setMatrixAt(i, m);
      c.setRGB(
        g.colors[i * 3] as number,
        g.colors[i * 3 + 1] as number,
        g.colors[i * 3 + 2] as number,
        THREE.SRGBColorSpace,
      );
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = g.opacity < 1 ? 2 : 1;
    w.content.add(mesh);
    w.meshes.push({ mesh, ids: g.ids });
  }
}

/** Centre (x, y, z) and size (sx, sy, sz) of a box, as the scene's instance arrays store them. */
interface BoxAt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
}

function boxOutline(box: BoxAt, color: string): THREE.LineSegments {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(box.sx + 0.06, box.sy + 0.06, box.sz + 0.06)),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
  lines.position.set(box.x, box.y, box.z);
  lines.renderOrder = 5;
  return lines;
}

const boxOf = (b: Float32Array, i: number): BoxAt => ({
  x: b[i] as number,
  y: b[i + 1] as number,
  z: b[i + 2] as number,
  sx: b[i + 3] as number,
  sy: b[i + 4] as number,
  sz: b[i + 5] as number,
});

export function buildOverlay(
  w: World3D,
  scene: builder.Scene,
  selected: readonly string[],
  ghost: Ghost | undefined,
): void {
  disposeChildren(w.overlay);
  const cobalt = css("--cobalt", "#2f55d4");
  for (const id of selected) {
    const at = scene.where.get(id);
    const group = at && scene.groups.find((g) => g.key === at.group);
    if (!at || !group) continue;
    w.overlay.add(boxOutline(boxOf(group.boxes, at.index * 6), cobalt));
  }
  if (ghost) {
    const color = ghost.ok ? cobalt : css("--bad", "#c43d2b");
    const mesh = new THREE.Mesh(
      BOX,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    mesh.position.set(ghost.x + ghost.w / 2, ghost.h / 2, ghost.y + ghost.d / 2);
    mesh.scale.set(ghost.w, ghost.h, ghost.d);
    const box = {
      x: ghost.x + ghost.w / 2,
      y: ghost.h / 2,
      z: ghost.y + ghost.d / 2,
      sx: ghost.w,
      sy: ghost.h,
      sz: ghost.d,
    };
    w.overlay.add(mesh, boxOutline(box, color));
  }
}

export function create(canvas: HTMLCanvasElement): World3D {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a95, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  const content = new THREE.Group();
  const overlay = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground, content, overlay);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const w: World3D = {
    renderer,
    scene,
    camera,
    content,
    overlay,
    ground,
    meshes: [],
    view: { cx: 0, cz: 0, zoom: 1, azimuth: 45, span: 20 },
    render: () => renderer.render(scene, camera),
  };
  return w;
}

const ray = new THREE.Raycaster();

export function pointerOn(
  w: World3D,
  canvas: HTMLCanvasElement,
  e: { clientX: number; clientY: number },
) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(ndc, w.camera);
  const hits = ray.intersectObjects(
    w.meshes.map((m) => m.mesh),
    false,
  );
  // Glass (containments) is looked through: prefer the solid thing inside it.
  const solid = (h: THREE.Intersection) =>
    !((h.object as THREE.Mesh).material as THREE.Material).transparent;
  const first =
    hits.find((h) => h.instanceId !== undefined && solid(h)) ??
    hits.find((h) => h.instanceId !== undefined);
  const owner = first ? w.meshes.find((m) => m.mesh === first.object) : undefined;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const p = new THREE.Vector3();
  const onGround = ray.ray.intersectPlane(plane, p);
  return {
    point: onGround ? { x: p.x, y: p.z } : undefined,
    hit: owner && first?.instanceId !== undefined ? owner.ids[first.instanceId] : undefined,
  };
}
