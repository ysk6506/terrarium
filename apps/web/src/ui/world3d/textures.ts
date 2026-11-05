/**
 * Procedural textures, drawn once on a canvas: no image files to ship or wait for. Everything here is
 * the warm, matte look of design C (ADR-0037): a little grain, soft seams, no hard contrast.
 */
import * as THREE from "three";

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
};

function wrap(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A tiny deterministic generator, so a texture looks the same every time. */
function lcg(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Grain over a base colour, with a few soft blotches. */
export function grain(
  base: string,
  amount: number,
  opts: { size?: number; blotches?: number; seed?: number } = {},
): THREE.CanvasTexture {
  const size = opts.size ?? 256;
  const rnd = lcg(opts.seed ?? 7);
  const [c, g] = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] = (img.data[i] as number) + n;
    img.data[i + 1] = (img.data[i + 1] as number) + n;
    img.data[i + 2] = (img.data[i + 2] as number) + n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < (opts.blotches ?? 0); i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${0.02 + rnd() * 0.035})`;
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 8 + rnd() * 40, 0, 7);
    g.fill();
  }
  return wrap(c);
}

/** Wall panels: vertical seams and, for plant buildings, louvres. */
export function cladding(base: string, seam: string, louvres: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = seam;
    g.globalAlpha = 0.45;
    g.fillRect(x, 0, 2, 256);
    g.globalAlpha = 1;
    g.fillStyle = "rgba(255,255,255,.25)";
    g.fillRect(x + 2, 0, 2, 256);
  }
  if (louvres) {
    for (let y = 0; y < 256; y += 10) {
      g.fillStyle = "rgba(90,70,40,.22)";
      g.fillRect(0, y, 256, 3);
      g.fillStyle = "rgba(255,255,255,.3)";
      g.fillRect(0, y + 3, 256, 1);
    }
  }
  return wrap(c);
}

/** Rows of windows on a wall: one tile holds `rows` floors of `cols` bays; `band` adds a spandrel under each floor. */
export function facade(
  base: string,
  glass: string,
  frame: string,
  rows: number,
  cols: number,
  band: boolean,
): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const cw = 256 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.1;
      const y = r * rh + rh * 0.16;
      g.fillStyle = glass;
      g.fillRect(x, y, cw * 0.8, rh * 0.56);
      g.fillStyle = "rgba(255,255,255,.28)";
      g.fillRect(x, y, cw * 0.8, rh * 0.1);
      g.fillStyle = frame;
      g.fillRect(x + cw * 0.4 - 1, y, 2, rh * 0.56);
    }
  if (band)
    for (let r = 0; r < rows; r++) {
      g.fillStyle = "rgba(60,70,80,.18)";
      g.fillRect(0, r * rh + rh * 0.8, 256, rh * 0.07);
    }
  return wrap(c);
}

/** A perforated sheet, for rack doors and containment doors. */
export function perforated(base: string, hole: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = hole;
  for (let y = 4; y < 256; y += 6)
    for (let x = (y / 6) % 2 ? 3 : 0; x < 128; x += 6) {
      g.beginPath();
      g.arc(x + 2, y, 1.7, 0, 7);
      g.fill();
    }
  return wrap(c);
}

/** The top of an immersion tank seen from above: pale coolant with the dark handles of the servers standing in it. */
export function tankTop(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = "#bfe6e0";
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = "rgba(255,255,255,.35)";
  g.fillRect(0, 0, 128, 256 * 0.08);
  for (let i = 0; i < 12; i++) {
    const y = 14 + i * 19.5;
    g.fillStyle = "rgba(40,70,80,.55)";
    g.fillRect(14, y, 100, 9);
    g.fillStyle = "rgba(255,255,255,.4)";
    g.fillRect(14, y, 100, 2);
  }
  g.strokeStyle = "rgba(40,70,80,.7)";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 250);
  return wrap(c, 1, 1);
}

/** Raised-floor tiles: a thin joint around each, and grilles on the cold aisle's perforated ones. */
export function tiles(base: string, joint: string, grille: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = joint;
  g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  if (grille) {
    g.fillStyle = "rgba(40,60,70,.34)";
    for (let y = 24; y < 240; y += 14) for (let x = 24; x < 240; x += 14) g.fillRect(x, y, 8, 8);
  }
  return wrap(c);
}

/** Diagonal stripes: land that is for sale, a hazard edge. */
export function stripes(a: string, b: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = b;
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 16, 128);
    g.lineTo(i + 144, 0);
    g.lineTo(i + 128, 0);
    g.fill();
  }
  return wrap(c);
}

/** The coil of a rear-door heat exchanger: fine fins. */
export function coil(base: string, fin: string): THREE.CanvasTexture {
  const [c, g] = canvas(64, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = fin;
  for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 64, 1.2);
  g.fillStyle = "rgba(0,0,0,.12)";
  g.fillRect(30, 0, 4, 128);
  return wrap(c);
}

export type Front = "mesh" | "bezel" | "drive-bays" | "gpu-grille" | "ports" | "flat";

/** What a device looks like from the front, drawn for its maker's look. */
export function faceplate(
  front: Front,
  body: string,
  accent: string,
  units: number,
): THREE.CanvasTexture {
  const w = 512;
  const h = 40 * Math.max(1, units);
  const [c, g] = canvas(w, h);
  g.fillStyle = body;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,.12)";
  g.fillRect(0, 0, w, 2);
  g.fillStyle = "rgba(0,0,0,.35)";
  g.fillRect(0, h - 3, w, 3);
  paintFront(g, front, accent, w, h);
  g.fillStyle = accent;
  g.fillRect(w - 80, 8, 4, h - 16);
  g.fillStyle = "#37e07a";
  g.beginPath();
  g.arc(w - 56, h / 2, 3, 0, 7);
  g.fill();
  g.fillStyle = "#cfd6dc";
  g.fillRect(w - 40, h / 2 - 4, 22, 8);
  return wrap(c, 1, 1);
}

type Painter = (g: CanvasRenderingContext2D, accent: string, w: number, h: number) => void;

const FRONTS: Readonly<Record<Front, Painter>> = {
  mesh: (g, _accent, w, h) => {
    g.fillStyle = "rgba(0,0,0,.55)";
    for (let y = 6; y < h - 6; y += 5)
      for (let x = 40; x < w - 90; x += 5) g.fillRect(x, y, 2.4, 2.4);
  },
  "drive-bays": (g, accent, _w, h) => {
    const rows = Math.max(1, Math.round(h / 40));
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < 12; i++) {
        g.fillStyle = "rgba(0,0,0,.5)";
        g.fillRect(36 + i * 32, 6 + (r * h) / rows, 28, h / rows - 12);
        g.fillStyle = accent;
        g.fillRect(36 + i * 32 + 22, 9 + (r * h) / rows, 3, 3);
      }
  },
  "gpu-grille": (g, accent, w, h) => {
    g.fillStyle = "rgba(0,0,0,.6)";
    for (let y = 5; y < h - 5; y += 6)
      for (let x = 30; x < w - 100; x += 7) {
        g.beginPath();
        g.arc(x + ((y / 6) % 2 ? 3 : 0), y, 2.3, 0, 7);
        g.fill();
      }
    g.fillStyle = accent;
    g.fillRect(30, 3, w - 130, 2);
  },
  ports: (g, _accent, _w, h) => {
    for (let i = 0; i < 24; i++) {
      g.fillStyle = "#0a0c0e";
      g.fillRect(30 + i * 16, 8, 12, Math.min(12, h / 2 - 6));
      g.fillRect(30 + i * 16, h / 2 + 2, 12, Math.min(12, h / 2 - 6));
      g.fillStyle = i % 5 === 0 ? "#ffb02e" : "#37e07a";
      g.fillRect(33 + i * 16, 10, 3, 2);
      g.fillRect(33 + i * 16, h / 2 + 4, 3, 2);
    }
  },
  bezel: (g, _accent, w, h) => {
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(30, 8, w - 130, h - 16);
  },
  flat: (g, _accent, w, h) => {
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(30, 8, w - 130, h - 16);
  },
};

function paintFront(
  g: CanvasRenderingContext2D,
  front: Front,
  accent: string,
  w: number,
  h: number,
): void {
  FRONTS[front](g, accent, w, h);
}

/** A soft round sprite, for glows and plumes. */
export function glow(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return wrap(c, 1, 1);
}
