const $ = (selector) => document.querySelector(selector);
const pdfjs = window.pdfjsLib;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

const state = {
  pdf: null, mode: 'reflow', page: 1, fontSize: 19, zoom: 1,
  textByPage: [], renderTask: null, pinch: null,
};
const ui = {
  fileInputs: [$('#file-input'), $('#welcome-file-input')], welcome: $('#welcome'), reader: $('#reader'),
  fileName: $('#file-name'), docMeta: $('#doc-meta'), pageInput: $('#page-input'), pageCount: $('#page-count'),
  viewer: $('#viewer'), status: $('#status'), searchForm: $('#search-form'), searchInput: $('#search-input'),
  searchResults: $('#search-results'), modeButtons: [...document.querySelectorAll('.mode-button')],
  zoomControls: $('#zoom-controls'), zoomRange: $('#zoom-range'), zoomValue: $('#zoom-value'),
  zoomOut: $('#zoom-out'), zoomIn: $('#zoom-in'), fitWidth: $('#fit-width'), fontControl: $('#font-control'),
};

if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
  ui.status.hidden = !message;
}
function updateControls() {
  if (state.pdf) state.page = Math.max(1, Math.min(state.page, state.pdf.numPages));
  ui.pageInput.value = String(state.page);
  ui.pageInput.max = String(state.pdf?.numPages || 1);
  ui.pageCount.textContent = String(state.pdf?.numPages || 0);
  const percent = Math.round(state.zoom * 100);
  ui.zoomRange.value = String(percent);
  ui.zoomValue.textContent = percent === 100 ? '幅に合わせる' : `${percent}%`;
  ui.zoomControls.hidden = state.mode !== 'page';
  ui.fontControl.hidden = state.mode === 'page';
  $('#zoom-hint').hidden = state.mode !== 'page';
}
function textLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], text: item.str.trim() });
  }
  return [...rows.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
async function loadPdf(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    setStatus('PDFファイルを選択してください。', 'error'); return;
  }
  if (!pdfjs) { setStatus('PDFライブラリーを読み込めません。ネットワーク接続を確認してください。', 'error'); return; }
  setStatus('PDFを読み込んでいます…');
  ui.viewer.replaceChildren(); ui.searchResults.hidden = true;
  try {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    state.pdf = pdf; state.page = 1; state.zoom = 1; state.textByPage = [];
    ui.fileName.textContent = file.name; ui.docMeta.textContent = `${pdf.numPages} ページ`;
    ui.welcome.hidden = true; ui.reader.hidden = false;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      state.textByPage[n - 1] = textLines((await page.getTextContent()).items);
    }
    updateControls(); setStatus('読み込み完了。ページ表示では拡大・縮小できます。'); await render();
  } catch (error) {
    console.error(error); setStatus('PDFを開けませんでした。ファイルが破損していないか確認してください。', 'error');
  } finally { ui.fileInputs.forEach((input) => { input.value = ''; }); }
}
function appendTextPage(container, lines, number, className) {
  const article = document.createElement('article'); article.className = className; article.id = `page-${number}`;
  const marker = document.createElement('div'); marker.className = 'page-marker'; marker.textContent = `ページ ${number}`; article.append(marker);
  if (!lines?.length) {
    const note = document.createElement('p'); note.className = 'page-empty';
    note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。'; article.append(note);
  } else lines.forEach((line) => {
    const p = document.createElement('p'); p.className = 'text-line'; p.style.fontSize = `${state.fontSize}px`;
    p.style.lineHeight = `${state.fontSize * 1.8}px`; p.textContent = line; article.append(p);
  });
  container.append(article);
}
function renderReflow() {
  ui.viewer.className = 'viewer reflow-view'; ui.viewer.replaceChildren();
  appendTextPage(ui.viewer, state.textByPage[state.page - 1], state.page, 'reflow-page');
}
function renderContinuous() {
  ui.viewer.className = 'viewer continuous-view'; ui.viewer.replaceChildren();
  state.textByPage.forEach((lines, index) => appendTextPage(ui.viewer, lines, index + 1, 'continuous-page'));
}
async function renderPage() {
  if (!state.pdf) return;
  if (state.renderTask) { try { state.renderTask.cancel(); } catch (_) {} state.renderTask = null; }
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const fitScale = Math.min((ui.viewer.clientWidth - 24) / base.width, 1.5);
  const viewport = page.getViewport({ scale: fitScale * state.zoom });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas'); canvas.className = 'pdf-canvas';
  canvas.width = Math.ceil(viewport.width * dpr); canvas.height = Math.ceil(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d');
  ui.viewer.className = 'viewer page-view'; ui.viewer.replaceChildren(canvas);
  state.renderTask = page.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
  try { await state.renderTask.promise; }
  finally { state.renderTask = null; }
}
async function render() {
  if (!state.pdf) return;
  updateControls();
  if (state.mode === 'page') return renderPage();
  if (state.mode === 'continuous') return renderContinuous();
  renderReflow();
}
function setMode(mode) {
  state.mode = mode;
  ui.modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  render().catch((error) => { if (error.name !== 'RenderingCancelledException') { console.error(error); setStatus('表示を切り替えられませんでした。', 'error'); } });
}
function navigate(page) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(Number(page) || 1, state.pdf.numPages)); updateControls();
  if (state.mode === 'continuous') document.getElementById(`page-${state.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else render().catch((error) => { if (error.name !== 'RenderingCancelledException') console.error(error); });
}
function setZoom(value) {
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100)); updateControls();
  if (state.pdf && state.mode === 'page') renderPage().catch((error) => {
    if (error.name !== 'RenderingCancelledException') { console.error(error); setStatus('ズーム表示を更新できませんでした。', 'error'); }
  });
}
function showSearchResults(query) {
  ui.searchResults.replaceChildren(); const hits = [];
  state.textByPage.forEach((lines, index) => (lines || []).forEach((line) => {
    if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) hits.push({ page: index + 1, line });
  }));
  const heading = document.createElement('p'); heading.className = 'results-heading';
  heading.textContent = hits.length ? `検索結果 ${hits.length} 件（先頭50件）` : '一致する結果はありません。';
  ui.searchResults.append(heading); ui.searchResults.hidden = false;
  hits.slice(0, 50).forEach((hit) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'result-item';
    button.textContent = `ページ ${hit.page} — ${hit.line}`; button.addEventListener('click', () => navigate(hit.page)); ui.searchResults.append(button);
  });
}

ui.fileInputs.forEach((input) => input.addEventListener('change', (event) => loadPdf(event.target.files?.[0])));
ui.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#prev-page').addEventListener('click', () => navigate(state.page - 1));
$('#next-page').addEventListener('click', () => navigate(state.page + 1));
ui.pageInput.addEventListener('change', () => navigate(ui.pageInput.value));
$('#font-size').addEventListener('input', (event) => { state.fontSize = Number(event.target.value); if (state.pdf && state.mode !== 'page') render(); });
ui.zoomRange.addEventListener('input', (event) => setZoom(Number(event.target.value) / 100));
ui.zoomOut.addEventListener('click', () => setZoom(state.zoom - ZOOM_STEP));
ui.zoomIn.addEventListener('click', () => setZoom(state.zoom + ZOOM_STEP));
ui.fitWidth.addEventListener('click', () => setZoom(1));
ui.searchForm.addEventListener('submit', (event) => { event.preventDefault(); const query = ui.searchInput.value.trim(); if (state.pdf && query) showSearchResults(query); });

// Pinch is handled here (rather than relying on browser page zoom). Preview uses CSS
// for immediate feedback; on release PDF.js rerenders at the new scale for sharpness.
ui.viewer.addEventListener('touchstart', (event) => {
  if (state.mode !== 'page' || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  const canvas = ui.viewer.querySelector('canvas');
  state.pinch = {
    startDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    startZoom: state.zoom, canvas,
  };
}, { passive: true });
ui.viewer.addEventListener('touchmove', (event) => {
  if (state.mode !== 'page' || !state.pinch || event.touches.length !== 2) return;
  event.preventDefault();
  const [a, b] = event.touches;
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.pinch.startZoom * distance / state.pinch.startDistance));
  if (state.pinch.canvas) {
    state.pinch.canvas.style.transformOrigin = 'top left';
    state.pinch.canvas.style.transform = `scale(${state.zoom / state.pinch.startZoom})`;
  }
  updateControls();
}, { passive: false });
function finishPinch() {
  if (!state.pinch) return;
  state.pinch = null;
  setZoom(state.zoom);
}
ui.viewer.addEventListener('touchend', finishPinch, { passive: true });
ui.viewer.addEventListener('touchcancel', finishPinch, { passive: true });
$('#close-file').addEventListener('click', async () => {
  if (state.renderTask) { try { state.renderTask.cancel(); } catch (_) {} }
  if (state.pdf) await state.pdf.destroy();
  state.pdf = null; state.page = 1; state.zoom = 1; state.textByPage = [];
  ui.reader.hidden = true; ui.welcome.hidden = false; ui.viewer.replaceChildren(); ui.searchInput.value = ''; ui.searchResults.hidden = true;
  setStatus(''); updateControls();
});
window.addEventListener('resize', () => {
  if (state.pdf && state.mode === 'page') renderPage().catch((error) => { if (error.name !== 'RenderingCancelledException') console.error(error); });
});
updateControls(); setStatus('');
