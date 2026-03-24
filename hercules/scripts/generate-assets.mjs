import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(root, 'assets');

fs.mkdirSync(assetsDir, { recursive: true });

const colors = {
  background: [6, 17, 15, 255],
  panel: [18, 37, 33, 255],
  ring: [125, 255, 207, 255],
  ringSoft: [53, 224, 161, 255],
  muscle: [231, 246, 240, 255],
  shadow: [12, 35, 31, 255],
  stroke: [178, 255, 231, 255],
};

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(filePath, width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const idx = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(filePath, png);
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function ellipseMask(nx, ny, cx, cy, rx, ry, angle = 0) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = nx - cx;
  const dy = ny - cy;
  const x = (dx * cos + dy * sin) / rx;
  const y = (-dx * sin + dy * cos) / ry;
  return 1 - Math.sqrt(x * x + y * y);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blend(base, top, alpha) {
  const inv = 1 - alpha;
  return [
    Math.round(base[0] * inv + top[0] * alpha),
    Math.round(base[1] * inv + top[1] * alpha),
    Math.round(base[2] * inv + top[2] * alpha),
    255,
  ];
}

function muscleShape(nx, ny) {
  const bicep = Math.max(0, ellipseMask(nx, ny, 0.47, 0.39, 0.16, 0.12, 0.3));
  const forearm = Math.max(0, ellipseMask(nx, ny, 0.64, 0.59, 0.135, 0.095, -0.86));
  const shoulder = Math.max(0, ellipseMask(nx, ny, 0.34, 0.31, 0.082, 0.076, 0));
  const hand = Math.max(0, ellipseMask(nx, ny, 0.73, 0.72, 0.042, 0.042, 0));
  const tricep = Math.max(0, ellipseMask(nx, ny, 0.39, 0.5, 0.07, 0.12, 0.22));
  const union = Math.max(bicep, forearm, shoulder, hand, tricep);

  const elbowCut = Math.max(0, ellipseMask(nx, ny, 0.55, 0.52, 0.072, 0.08, 0.18));
  const innerCut = Math.max(0, ellipseMask(nx, ny, 0.53, 0.46, 0.07, 0.052, -0.35));
  const wristCut = Math.max(0, ellipseMask(nx, ny, 0.69, 0.67, 0.026, 0.045, -0.25));
  const silhouette = Math.max(0, union - Math.max(elbowCut * 0.92, innerCut * 0.45, wristCut * 0.85));
  const fill = smoothstep(0.18, 0.22, silhouette);
  const outer = smoothstep(0.18, 0.22, silhouette);
  const inner = smoothstep(0.3, 0.34, silhouette);

  return {
    fill,
    edge: Math.max(0, outer - inner),
    bicep,
    forearm,
  };
}

function iconPixel(x, y, width, height) {
  const nx = x / width;
  const ny = y / height;
  const cx = 0.5;
  const cy = 0.5;
  const radius = dist(nx, ny, cx, cy);

  let color = colors.background;

  const vignette = smoothstep(0.15, 0.95, radius);
  color = blend(color, colors.panel, 0.25 * (1 - vignette));

  const outerRing = smoothstep(0.43, 0.41, radius) - smoothstep(0.49, 0.47, radius);
  if (outerRing > 0) {
    color = blend(color, colors.ring, outerRing * 0.95);
  }

  const innerGlow = smoothstep(0.40, 0.08, radius);
  color = blend(color, colors.ringSoft, innerGlow * 0.22);

  const muscle = muscleShape(nx, ny);
  if (muscle.fill > 0) {
    color = blend(color, colors.shadow, Math.min(0.92, muscle.fill * 0.72));
    color = blend(color, colors.muscle, muscle.fill * 0.96);
  }

  if (muscle.edge > 0) {
    color = blend(color, colors.stroke, muscle.edge * 0.34);
  }

  const bicepHighlight = Math.max(0, 1 - dist(nx, ny, 0.44, 0.35) / 0.11);
  if (bicepHighlight > 0 && muscle.bicep > 0.08) {
    color = blend(color, colors.ring, bicepHighlight * 0.18);
  }

  const forearmHighlight = Math.max(0, 1 - dist(nx, ny, 0.63, 0.58) / 0.1);
  if (forearmHighlight > 0 && muscle.forearm > 0.08) {
    color = blend(color, colors.ringSoft, forearmHighlight * 0.15);
  }

  return color;
}

function splashPixel(x, y, width, height) {
  const nx = x / width;
  const ny = y / height;
  const radius = dist(nx, ny, 0.5, 0.45);

  let color = blend(colors.background, colors.panel, smoothstep(0.95, 0.2, radius) * 0.8);
  const muscle = muscleShape(nx * 0.82 + 0.08, ny * 0.82 + 0.03);
  if (muscle.fill > 0) {
    color = blend(color, colors.shadow, muscle.fill * 0.55);
    color = blend(color, colors.muscle, muscle.fill * 0.96);
  }
  if (muscle.edge > 0) {
    color = blend(color, colors.stroke, muscle.edge * 0.25);
  }
  return color;
}

writePng(path.join(assetsDir, 'icon.png'), 1024, 1024, iconPixel);
writePng(path.join(assetsDir, 'adaptive-icon.png'), 1024, 1024, iconPixel);
writePng(path.join(assetsDir, 'splash-icon.png'), 1024, 1024, splashPixel);
writePng(path.join(assetsDir, 'favicon.png'), 256, 256, iconPixel);

console.log('Generated Hercules assets in', assetsDir);
