import { renderPage, pageCount } from './pdf-view.js';
import { createWatermarkBox } from './watermark-box.js';

const state = {
  step: 1,
  files: [],
  watermark: null,          // { path, originalDataUrl, dataUrl, isPng, aspect }
  removeBg: false,
  bgCache: null,            // processed { dataUrl, aspect }
  global: { xFrac: 0.35, yFrac: 0.4, wFrac: 0.3, opacity: 1 },
  overrides: {},            // pageKey -> {xFrac,yFrac,wFrac} | {deleted:true}
  pages: [],                // [{ fileIndex, pageIndex }]
  outputDir: null
};

const $ = (sel) => document.querySelector(sel);
const screens = [...document.querySelectorAll('.screen')];

function renderSteps() {
  const labels = ['Files', 'Watermark', 'Position', 'Review', 'Save'];
  $('#steps').innerHTML = labels.map((l, i) => {
    const n = i + 1;
    const cls = n === state.step ? 'active' : (n < state.step ? 'done' : '');
    return `<span class="step ${cls}">${n}. ${l}</span>`;
  }).join('');
}

function show(step) {
  state.step = step;
  screens.forEach((s) => { s.hidden = Number(s.dataset.screen) !== step; });
  renderSteps();
  renderNav();
  if (step === 3) enterPosition();
  if (step === 4) enterReview();
  if (step === 5) enterSave();
}

function canNext() {
  if (state.step === 1) return state.files.length > 0;
  if (state.step === 2) return !!state.watermark && (!state.removeBg || !!state.bgCache);
  if (state.step === 5) return false;
  return true;
}

function renderNav() {
  const back = state.step > 1
    ? `<button id="back">Back</button>` : `<span></span>`;
  const next = state.step < 5
    ? `<button id="next" class="primary" ${canNext() ? '' : 'disabled'}>Next</button>`
    : `<span></span>`;
  $('#nav').innerHTML = back + next;
  const b = $('#back'); if (b) b.onclick = () => show(state.step - 1);
  const n = $('#next'); if (n) n.onclick = () => show(state.step + 1);
}

// ---------- Screen 1: files ----------
function renderFileList() {
  $('#pdf-list').innerHTML = state.files.map((_f, i) =>
    `<div class="file-row"><span data-name="${i}"></span>
     <button data-remove="${i}">Remove</button></div>`).join('') || '<p style="color:#8a8f98">No files yet.</p>';
  state.files.forEach(async (f, i) => {
    const el = document.querySelector(`[data-name="${i}"]`);
    if (el) el.textContent = await window.api.basename(f);
  });
  document.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.onclick = () => { state.files.splice(Number(btn.dataset.remove), 1); renderFileList(); renderNav(); };
  });
}

$('#add-pdfs').onclick = async () => {
  const picked = await window.api.selectPdfs();
  for (const p of picked) if (!state.files.includes(p)) state.files.push(p);
  renderFileList(); renderNav();
};

// ---------- Screen 2: watermark ----------
function updateRmbgButtons() {
  const applied = state.removeBg && !!state.bgCache;
  $('#rmbg-btn').hidden = applied;
  $('#rmbg-undo').hidden = !applied;
}

async function refreshWatermarkImage() {
  // Determine the dataUrl/aspect actually used based on the removeBg toggle.
  if (state.removeBg) {
    if (!state.bgCache) {
      $('#rmbg-note').textContent = 'processing…';
      try {
        const r = await window.api.removeBackground(state.watermark.path);
        state.bgCache = { dataUrl: r.dataUrl, aspect: r.width / r.height };
      } catch (e) {
        $('#rmbg-note').textContent = 'failed: ' + e.message;
        state.removeBg = false;
      }
    }
    if (state.bgCache) {
      state.watermark.dataUrl = state.bgCache.dataUrl;
      state.watermark.isPng = true;
      state.watermark.aspect = state.bgCache.aspect;
      $('#rmbg-note').textContent = 'done';
    }
  } else {
    state.watermark.dataUrl = state.watermark.originalDataUrl;
    state.watermark.isPng = true; // originalDataUrl is a PNG data URL from Jimp
    $('#rmbg-note').textContent = '';
  }
  updateRmbgButtons();
  const prev = $('#wm-preview');
  prev.innerHTML = `<img id="wm-preview-img" src="${state.watermark.dataUrl}" style="max-width:320px;max-height:220px;background:
    repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/16px 16px;border:1px solid #e2e4e8;opacity:${state.global.opacity}"/>`;
  renderNav();
}

$('#choose-wm').onclick = async () => {
  const wm = await window.api.selectWatermark();
  if (!wm) return;
  state.watermark = {
    path: wm.path,
    originalDataUrl: wm.dataUrl,   // PNG data URL (Jimp-encoded), opaque
    dataUrl: wm.dataUrl,
    isPng: true,
    aspect: wm.width / wm.height
  };
  state.bgCache = null;
  state.removeBg = false;
  await refreshWatermarkImage();
};

$('#rmbg-btn').onclick = async () => {
  if (!state.watermark) return;
  state.removeBg = true;
  await refreshWatermarkImage();
};

$('#rmbg-undo').onclick = async () => {
  state.removeBg = false;
  await refreshWatermarkImage();
};

$('#opacity').oninput = (e) => {
  const v = Number(e.target.value);
  $('#op-val').textContent = String(v);
  state.global.opacity = v / 100;
  if (window.__wmBox3) window.__wmBox3.setOpacity(state.global.opacity);
  const previewImg = $('#wm-preview-img');
  if (previewImg) previewImg.style.opacity = String(state.global.opacity);
};

// Initialize model-availability note.
(async () => {
  const ok = await window.api.isModelAvailable();
  if (!ok) {
    $('#rmbg-btn').disabled = true;
    $('#rmbg-note').textContent = '(model not installed)';
  }
})();

window.__state = state;
window.__nav = { show, renderNav };

// ---------- shared: build the page list ----------
async function buildPageList() {
  state.pages = [];
  for (let fi = 0; fi < state.files.length; fi++) {
    const n = await pageCount(state.files[fi]);
    for (let pi = 0; pi < n; pi++) state.pages.push({ fileIndex: fi, pageIndex: pi });
  }
}

// ---------- Screen 3: position on first page ----------
async function enterPosition() {
  const host = document.getElementById('stage3');
  host.innerHTML = 'Rendering…';
  const { canvas } = await renderPage(state.files[0], 1, 720);
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.width = canvas.width + 'px';
  stage.style.height = canvas.height + 'px';
  stage.appendChild(canvas);
  host.appendChild(stage);
  if (window.__wmBox3) window.__wmBox3.destroy();
  window.__wmBox3 = createWatermarkBox(stage, {
    dataUrl: state.watermark.dataUrl,
    aspect: state.watermark.aspect,
    opacity: state.global.opacity,
    placement: { xFrac: state.global.xFrac, yFrac: state.global.yFrac, wFrac: state.global.wFrac },
    onChange: (p) => { state.global.xFrac = p.xFrac; state.global.yFrac = p.yFrac; state.global.wFrac = p.wFrac; }
  });
}

// ---------- Screen 4: review all pages (list left, editor right) ----------
function effectiveFor(key) {
  const o = state.overrides[key];
  if (o && o.deleted) return null;
  if (o) return { xFrac: o.xFrac, yFrac: o.yFrac, wFrac: o.wFrac };
  return { xFrac: state.global.xFrac, yFrac: state.global.yFrac, wFrac: state.global.wFrac };
}

let currentEditIdx = null;
const overlayUpdaters = new Map(); // pageKey -> (eff|null) => void

async function enterReview() {
  await buildPageList();
  overlayUpdaters.clear();
  currentEditIdx = null;
  const list = document.getElementById('page-list');
  list.innerHTML = '';
  state.pages.forEach((pg, idx) => {
    const key = `${pg.fileIndex}:${pg.pageIndex}`;
    const item = document.createElement('div');
    item.className = 'page-item';
    item.dataset.idx = String(idx);
    item.innerHTML = `<div class="page-item-canvas">loading…</div>
      <div class="page-item-label">file ${pg.fileIndex + 1}, p.${pg.pageIndex + 1}</div>`;
    list.appendChild(item);
    item.onclick = () => selectPage(idx);
    lazyRenderListItem(item, pg, key);
  });
  if (state.pages.length) {
    await selectPage(0);
  } else {
    document.getElementById('page-editor').innerHTML = '<p style="color:#8a8f98">No pages.</p>';
  }
}

const listObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) { en.target.__render(); listObserver.unobserve(en.target); }
  });
}, { rootMargin: '200px' });

function lazyRenderListItem(item, pg, key) {
  item.__render = async () => {
    const holder = item.querySelector('.page-item-canvas');
    const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 150);
    holder.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'page-stage';
    stage.style.width = canvas.width + 'px';
    stage.style.height = canvas.height + 'px';
    stage.appendChild(canvas);
    const overlayImg = document.createElement('img');
    overlayImg.className = 'thumb-overlay';
    overlayImg.src = state.watermark.dataUrl;
    overlayImg.style.opacity = String(state.global.opacity);
    stage.appendChild(overlayImg);
    holder.appendChild(stage);

    const updater = (eff) => {
      if (!eff) { overlayImg.style.display = 'none'; return; }
      overlayImg.style.display = '';
      const w = eff.wFrac * canvas.width;
      overlayImg.style.left = (eff.xFrac * canvas.width) + 'px';
      overlayImg.style.top = (eff.yFrac * canvas.height) + 'px';
      overlayImg.style.width = w + 'px';
      overlayImg.style.height = (w / state.watermark.aspect) + 'px';
    };
    overlayUpdaters.set(key, updater);
    updater(effectiveFor(key));
  };
  listObserver.observe(item);
}

async function selectPage(idx) {
  currentEditIdx = idx;
  document.querySelectorAll('#page-list .page-item').forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.idx) === idx);
  });

  const pg = state.pages[idx];
  const key = `${pg.fileIndex}:${pg.pageIndex}`;
  const ed = document.getElementById('page-editor');
  ed.innerHTML = `<div style="margin-bottom:10px">
      <button id="ed-delete">Delete watermark on this page</button>
      <button id="ed-reset">Reset to default</button>
      <span style="color:#8a8f98;margin-left:8px">file ${pg.fileIndex + 1}, page ${pg.pageIndex + 1}</span>
    </div><div id="ed-stage"></div>`;

  const host = document.getElementById('ed-stage');
  host.textContent = 'Rendering…';
  const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 760);
  if (currentEditIdx !== idx) return; // user switched pages while this was loading
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.width = canvas.width + 'px';
  stage.style.height = canvas.height + 'px';
  stage.appendChild(canvas);
  host.appendChild(stage);

  const refreshThumb = () => {
    const u = overlayUpdaters.get(key);
    if (u) u(effectiveFor(key));
  };

  const eff = effectiveFor(key);
  let box = null;
  if (eff) {
    box = createWatermarkBox(stage, {
      dataUrl: state.watermark.dataUrl, aspect: state.watermark.aspect,
      opacity: state.global.opacity, placement: eff,
      onChange: (p) => { state.overrides[key] = { xFrac: p.xFrac, yFrac: p.yFrac, wFrac: p.wFrac }; refreshThumb(); }
    });
  }

  document.getElementById('ed-delete').onclick = () => {
    state.overrides[key] = { deleted: true };
    if (box) { box.destroy(); box = null; }
    refreshThumb();
  };
  document.getElementById('ed-reset').onclick = () => {
    delete state.overrides[key];
    refreshThumb();
    selectPage(idx); // re-render editor with global placement
  };
}

// ---------- Screen 5: save (one button per file, shared output folder) ----------
function enterSave() {
  document.getElementById('out-path').textContent = state.outputDir || '';
  renderSaveList();
}

function renderSaveList() {
  const host = document.getElementById('save-list');
  host.innerHTML = '';
  state.files.forEach((file, idx) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span');
    name.textContent = file;
    window.api.basename(file).then((b) => { name.textContent = b; });

    const right = document.createElement('span');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';
    const status = document.createElement('span');
    status.style.color = '#8a8f98';
    status.style.fontSize = '13px';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Save';
    btn.disabled = !state.outputDir;
    btn.onclick = () => saveOneFile(idx, file, status);
    right.append(status, btn);

    row.append(name, right);
    host.appendChild(row);
  });
}

document.getElementById('choose-out').onclick = async () => {
  const dir = await window.api.selectOutputDir();
  if (dir) {
    state.outputDir = dir;
    document.getElementById('out-path').textContent = dir;
    renderSaveList();
  }
};

// Overrides are keyed by the GLOBAL file index (position in state.files). A
// single-file save job only contains one file at index 0, so keys must be
// remapped or a page's per-page override would silently fail to apply.
function overridesForSingleFile(fileIdx) {
  const prefix = `${fileIdx}:`;
  const out = {};
  for (const [key, val] of Object.entries(state.overrides)) {
    if (key.startsWith(prefix)) out[`0:${key.slice(prefix.length)}`] = val;
  }
  return out;
}

let activeSaveStatusEl = null;
window.api.onProgress((p) => {
  if (activeSaveStatusEl) activeSaveStatusEl.textContent = `page ${p.page + 1} / ${p.totalPages}`;
});

async function saveOneFile(idx, file, status) {
  const allButtons = document.querySelectorAll('#save-list button');
  allButtons.forEach((b) => { b.disabled = true; });
  activeSaveStatusEl = status;
  status.textContent = 'saving…';
  try {
    const job = {
      files: [file],
      watermark: { dataUrl: state.watermark.dataUrl, isPng: state.watermark.isPng, aspect: state.watermark.aspect },
      global: state.global,
      overrides: overridesForSingleFile(idx),
      outputDir: state.outputDir
    };
    const { results } = await window.api.generate(job);
    const r = results[0];
    if (r.status === 'ok') {
      const savedName = await window.api.basename(r.output);
      status.textContent = `saved as ${savedName}`;
    } else {
      status.textContent = `error: ${r.reason}`;
    }
  } catch (e) {
    status.textContent = 'error: ' + e.message;
  } finally {
    activeSaveStatusEl = null;
    allButtons.forEach((b) => { b.disabled = !state.outputDir; });
  }
}

show(1);
