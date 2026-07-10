// A draggable + corner-resizable watermark overlay. Stores state in fraction space
// (relative to the container's pixel size) so it maps across different page sizes.
export function createWatermarkBox(container, opts) {
  const { dataUrl, aspect, onChange } = opts;
  let placement = { ...opts.placement };
  let opacity = opts.opacity ?? 1;

  const box = document.createElement('div');
  box.className = 'wm-box';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.draggable = false;
  box.appendChild(img);
  const handle = document.createElement('div');
  handle.className = 'wm-handle';
  box.appendChild(handle);
  container.appendChild(box);

  function px() { return { w: container.clientWidth, h: container.clientHeight }; }

  function apply() {
    const { w, h } = px();
    const width = placement.wFrac * w;
    const height = width / aspect;
    box.style.left = (placement.xFrac * w) + 'px';
    box.style.top = (placement.yFrac * h) + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    box.style.opacity = String(opacity);
  }

  function clamp() {
    const { w, h } = px();
    const width = placement.wFrac * w;
    const height = width / aspect;
    placement.xFrac = Math.min(Math.max(0, placement.xFrac), Math.max(0, (w - width) / w));
    placement.yFrac = Math.min(Math.max(0, placement.yFrac), Math.max(0, (h - height) / h));
  }

  // Dragging the body.
  box.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    const { w, h } = px();
    const startX = e.clientX, startY = e.clientY;
    const sx = placement.xFrac, sy = placement.yFrac;
    const move = (ev) => {
      placement.xFrac = sx + (ev.clientX - startX) / w;
      placement.yFrac = sy + (ev.clientY - startY) / h;
      clamp(); apply(); onChange && onChange({ ...placement });
    };
    const up = () => {
      box.releasePointerCapture(e.pointerId);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
  });

  // Resizing from the bottom-right handle (top-left anchored, aspect locked).
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const { w } = px();
    const startX = e.clientX;
    const sw = placement.wFrac;
    const move = (ev) => {
      const deltaFrac = (ev.clientX - startX) / w;
      placement.wFrac = Math.min(Math.max(0.03, sw + deltaFrac), 1);
      clamp(); apply(); onChange && onChange({ ...placement });
    };
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  apply();

  return {
    setPlacement(p) { placement = { ...p }; clamp(); apply(); },
    setOpacity(o) { opacity = o; apply(); },
    getPlacement() { return { ...placement }; },
    destroy() { box.remove(); }
  };
}
