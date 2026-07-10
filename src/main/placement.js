'use strict';

function resolveEffective(global, override) {
  if (!override) {
    return { xFrac: global.xFrac, yFrac: global.yFrac, wFrac: global.wFrac };
  }
  if (override.deleted) return null;
  return { xFrac: override.xFrac, yFrac: override.yFrac, wFrac: override.wFrac };
}

// p: {xFrac,yFrac,wFrac} with top-left origin. pageW/pageH in points.
// imageAspect = imgPixelWidth / imgPixelHeight. Returns pdf-lib rect (bottom-left origin).
function fractionToPdfRect(p, pageW, pageH, imageAspect) {
  const width = p.wFrac * pageW;
  const height = width / imageAspect;
  const x = p.xFrac * pageW;
  const y = pageH - (p.yFrac * pageH) - height;
  return { x, y, width, height };
}

// existsFn(name) => bool. Returns first non-colliding name, suffixing " (n)".
function nextAvailableName(existsFn, filename) {
  if (!existsFn(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);
  let n = 1;
  while (existsFn(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

module.exports = { resolveEffective, fractionToPdfRect, nextAvailableName };
