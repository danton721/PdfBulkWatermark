import { renderPage, pageCount } from './pdf-view.js';
import { createWatermarkBox } from './watermark-box.js';

const state = {
  step: 1,
  files: [],
  watermark: null,          // { path, originalDataUrl, dataUrl, isPng, aspect }
  removeBg: false,
  bgCache: null,            // processed { dataUrl, aspect }
  global: { xFrac: 0.35, yFrac: 0.4, wFrac: 0.3, opacity: 0.5 },
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
        $('#rmbg').checked = false; state.removeBg = false;
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
  const prev = $('#wm-preview');
  prev.innerHTML = `<img src="${state.watermark.dataUrl}" style="max-width:320px;max-height:220px;background:
    repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/16px 16px;border:1px solid #e2e4e8"/>`;
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
  $('#rmbg').checked = false;
  await refreshWatermarkImage();
};

$('#rmbg').onchange = async (e) => {
  state.removeBg = e.target.checked;
  if (!state.watermark) return;
  await refreshWatermarkImage();
};

$('#opacity').oninput = (e) => {
  const v = Number(e.target.value);
  $('#op-val').textContent = String(v);
  state.global.opacity = v / 100;
  if (window.__wmBox3) window.__wmBox3.setOpacity(state.global.opacity);
};

// Initialize model-availability note.
(async () => {
  const ok = await window.api.isModelAvailable();
  if (!ok) {
    $('#rmbg').disabled = true;
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

// ---------- Screen 4: review all pages ----------
function effectiveFor(key) {
  const o = state.overrides[key];
  if (o && o.deleted) return null;
  if (o) return { xFrac: o.xFrac, yFrac: o.yFrac, wFrac: o.wFrac };
  return { xFrac: state.global.xFrac, yFrac: state.global.yFrac, wFrac: state.global.wFrac };
}

async function enterReview() {
  await buildPageList();
  const grid = document.getElementById('grid');
  document.getElementById('editor').hidden = true;
  grid.hidden = false;
  grid.innerHTML = '';
  state.pages.forEach((pg, idx) => {
    const key = `${pg.fileIndex}:${pg.pageIndex}`;
    const card = document.createElement('div');
    card.className = 'thumb';
    card.dataset.idx = String(idx);
    card.innerHTML = `<div class="thumb-canvas">loading…</div>
      <div class="thumb-label">file ${pg.fileIndex + 1}, p.${pg.pageIndex + 1}</div>`;
    grid.appendChild(card);
    card.onclick = () => openEditor(idx);
    lazyRenderThumb(card, pg, key);
  });
}

const thumbObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) { en.target.__render(); thumbObserver.unobserve(en.target); }
  });
}, { rootMargin: '200px' });

function lazyRenderThumb(card, pg, key) {
  card.__render = async () => {
    const holder = card.querySelector('.thumb-canvas');
    const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 200);
    holder.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'page-stage';
    stage.style.width = canvas.width + 'px';
    stage.style.height = canvas.height + 'px';
    stage.appendChild(canvas);
    holder.appendChild(stage);
    const eff = effectiveFor(key);
    if (eff) {
      const img = document.createElement('img');
      img.src = state.watermark.dataUrl;
      img.style.position = 'absolute';
      img.style.opacity = String(state.global.opacity);
      const w = eff.wFrac * canvas.width;
      img.style.left = (eff.xFrac * canvas.width) + 'px';
      img.style.top = (eff.yFrac * canvas.height) + 'px';
      img.style.width = w + 'px';
      img.style.height = (w / state.watermark.aspect) + 'px';
      stage.appendChild(img);
    }
  };
  thumbObserver.observe(card);
}

async function openEditor(idx) {
  const pg = state.pages[idx];
  const key = `${pg.fileIndex}:${pg.pageIndex}`;
  const ed = document.getElementById('editor');
  document.getElementById('grid').hidden = true;
  ed.hidden = false;
  ed.innerHTML = `<div style="margin-bottom:10px">
      <button id="ed-back">← All pages</button>
      <button id="ed-delete">Delete watermark on this page</button>
      <button id="ed-reset">Reset to default</button>
      <span style="color:#8a8f98;margin-left:8px">file ${pg.fileIndex + 1}, page ${pg.pageIndex + 1}</span>
    </div><div id="ed-stage"></div>`;

  const host = document.getElementById('ed-stage');
  host.textContent = 'Rendering…';
  const { canvas } = await renderPage(state.files[pg.fileIndex], pg.pageIndex + 1, 700);
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.width = canvas.width + 'px';
  stage.style.height = canvas.height + 'px';
  stage.appendChild(canvas);
  host.appendChild(stage);

  const eff = effectiveFor(key);
  let box = null;
  if (eff) {
    box = createWatermarkBox(stage, {
      dataUrl: state.watermark.dataUrl, aspect: state.watermark.aspect,
      opacity: state.global.opacity, placement: eff,
      onChange: (p) => { state.overrides[key] = { xFrac: p.xFrac, yFrac: p.yFrac, wFrac: p.wFrac }; }
    });
  }

  document.getElementById('ed-back').onclick = () => {
    document.getElementById('grid').hidden = false;
    ed.hidden = true;
    enterReview();
  };
  document.getElementById('ed-delete').onclick = () => {
    state.overrides[key] = { deleted: true };
    if (box) { box.destroy(); box = null; }
  };
  document.getElementById('ed-reset').onclick = () => {
    delete state.overrides[key];
    openEditor(idx); // re-render with global placement
  };
}

// ---------- Screen 5: save ----------
function enterSave() {
  document.getElementById('summary').innerHTML = '';
  document.getElementById('progress').innerHTML = '';
  document.getElementById('out-path').textContent = state.outputDir || '';
  renderSaveNav();
}

function renderSaveNav() {
  // Save button lives in the footer for step 5.
  const disabled = state.outputDir ? '' : 'disabled';
  document.getElementById('nav').innerHTML =
    `<button id="back">Back</button>
     <button id="save" class="primary" ${disabled}>Save watermarked PDFs</button>`;
  document.getElementById('back').onclick = () => window.__nav.show(4);
  document.getElementById('save').onclick = doSave;
}

document.getElementById('choose-out').onclick = async () => {
  const dir = await window.api.selectOutputDir();
  if (dir) { state.outputDir = dir; document.getElementById('out-path').textContent = dir; renderSaveNav(); }
};

window.api.onProgress((p) => {
  document.getElementById('progress').textContent =
    `Watermarking ${p.fileName}: page ${p.page + 1} / ${p.totalPages}`;
});

async function doSave() {
  document.getElementById('save').disabled = true;
  const job = {
    files: state.files,
    watermark: { dataUrl: state.watermark.dataUrl, isPng: state.watermark.isPng, aspect: state.watermark.aspect },
    global: state.global,
    overrides: state.overrides,
    outputDir: state.outputDir
  };
  const { results } = await window.api.generate(job);
  document.getElementById('progress').textContent = 'Done.';
  const ok = results.filter((r) => r.status === 'ok').length;

  // Build the summary with DOM nodes + textContent so file paths / error
  // messages (attacker-influenceable via filenames) cannot inject markup.
  const summary = document.getElementById('summary');
  summary.innerHTML = '';
  const heading = document.createElement('p');
  heading.textContent = `${ok} of ${results.length} files written to ${state.outputDir}.`;
  summary.appendChild(heading);
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span');
    name.textContent = r.file;
    const status = document.createElement('span');
    status.textContent = r.status + (r.reason ? ': ' + r.reason : '');
    row.append(name, status);
    summary.appendChild(row);
  }
  const openBtn = document.createElement('button');
  openBtn.className = 'primary';
  openBtn.textContent = 'Open output folder';
  openBtn.onclick = () => window.api.openFolder(state.outputDir);
  summary.appendChild(openBtn);
}

show(1);
