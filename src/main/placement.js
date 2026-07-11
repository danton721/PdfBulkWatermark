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

module.exports = { resolveEffective, fractionToPdfRect };
