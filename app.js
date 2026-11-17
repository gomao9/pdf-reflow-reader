const $ = (selector) => document.querySelector(selector);
const pdfjs = window.pdfjsLib;

const state = { pdf: null, mode: 'reflow', page: 1, fontSize: 19, zoom: 1, textByPage: [], pinch: null, pinchTimer: null };
const ui = {
  fileInputs: [$('#file-input'), $('#welcome-file-input')], welcome: $('#welcome'), reader: $('#reader'),
  fileName: $('#file-name'), docMeta: $('#doc-meta'), pageInput: $('#page-input'), pageCount: $('#page-count'),
  viewer: $('#viewer'), status: $('#status'), searchForm: $('#search-form'), searchInput: $('#search-input'), searchResults: $('#search-results'),
  modeButtons: [...document.querySelectorAll('.mode-button')], prevPage: $('#prev-page'), nextPage: $('#next-page'),
  fontSize: $('#font-size'), zoomRange: $('#zoom-range'), zoomValue: $('#zoom-value'), zoomOut: $('#zoom-out'), zoomIn: $('#zoom-in'),
  fitWidth: $('#fit-width'), closeFile: $('#close-file'),
};

if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
  ui.status.hidden = !message;
}
function clampPage() { if (state.pdf) state.page = Math.max(1, Math.min(state.page, state.pdf.numPages)); }
function updateControls() {
  clampPage();
  ui.pageInput.value = String(state.page);
  ui.pageInput.max = String(state.pdf ? state.pdf.numPages : 1);
  ui.pageCount.textContent = String(state.pdf ? state.pdf.numPages : 0);
  ui.zoomRange.value = String(Math.round(state.zoom * 100));
  ui.zoomValue.value = `${Math.round(state.zoom * 100)}%`;
  ui.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function textLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
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
  if (!pdfjs) { setStatus('PDF表示ライブラリーを読み込めません。ネットワーク接続を確認してください。', 'error'); return; }
  setStatus('PDFを読み込んでいます…');
  ui.viewer.replaceChildren(); ui.searchResults.hidden = true;
  try {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    state.pdf = pdf; state.page = 1; state.textByPage = [];
    ui.fileName.textContent = file.name; ui.docMeta.textContent = `${pdf.numPages} ページ`;
    ui.welcome.hidden = true; ui.reader.hidden = false;
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      state.textByPage[n - 1] = textLines((await page.getTextContent()).items);
    }
    updateControls(); setStatus('読み込み完了。ページ表示では拡大・縮小できます。'); await render();
  } catch (error) {
    console.error(error); setStatus('PDFを開けませんでした。ファイルが破損していないか確認してください。', 'error');
  } finally { ui.fileInputs.forEach((input) => { input.value = ''; }); }
}

function createTextPage(pageIndex, className) {
  const lines = state.textByPage[pageIndex] || [];
  const article = document.createElement('article');
  article.className = className; article.id = `page-${pageIndex + 1}`;
  const marker = document.createElement('div'); marker.className = 'page-marker'; marker.textContent = `ページ ${pageIndex + 1}`; article.append(marker);
  if (!lines.length) {
    const note = document.createElement('p'); note.className = 'page-empty';
    note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。'; article.append(note);
  } else {
    for (const line of lines) {
      const p = document.createElement('p'); p.className = 'text-line'; p.style.fontSize = `${state.fontSize}px`;
      p.style.lineHeight = `${state.fontSize * 1.8}px`; p.textContent = line; article.append(p);
    }
  }
  return article;
}

function renderReflow() {
  ui.viewer.className = 'viewer reflow-view'; ui.viewer.replaceChildren();
  ui.viewer.append(createTextPage(state.page - 1, 'reflow-page'));
}
function renderContinuous() {
  ui.viewer.className = 'viewer continuous-view'; ui.viewer.replaceChildren();
  for (let index = 0; index < state.textByPage.length; index += 1) ui.viewer.append(createTextPage(index, 'continuous-page'));
  updateCurrentPageFromScroll();
}

async function renderPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const fitScale = Math.min((ui.viewer.clientWidth - 24) / base.width, 1.5);
  const scale = fitScale * state.zoom;
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas'); canvas.className = 'pdf-canvas';
  canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
  const context = canvas.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: context, viewport }).promise;
  ui.viewer.className = 'viewer page-view'; ui.viewer.replaceChildren(canvas);
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
    const active = button.dataset.mode === mode;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  });
  render().catch((error) => { console.error(error); setStatus('表示を切り替えられませんでした。', 'error'); });
}
function navigateTo(value) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(Number(value) || 1, state.pdf.numPages)); updateControls();
  if (state.mode === 'continuous') {
    document.getElementById(`page-${state.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else render().catch((error) => { console.error(error); setStatus('ページを表示できませんでした。', 'error'); });
}
function setZoom(value, rerender = true) {
  state.zoom = Math.max(0.5, Math.min(3, value)); updateControls();
  if (rerender && state.pdf && state.mode === 'page') renderPage().catch((error) => { console.error(error); setStatus('ズーム表示を更新できませんでした。', 'error'); });
}
function showSearchResults(query) {
  ui.searchResults.replaceChildren(); const hits = [];
  state.textByPage.forEach((lines, index) => (lines || []).forEach((line) => {
    if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) hits.push({ page: index + 1, line });
  }));
  ui.searchResults.hidden = false;
  const heading = document.createElement('p'); heading.className = 'results-heading';
  heading.textContent = hits.length ? `検索結果 ${hits.length} 件（先頭50件）` : '一致する結果はありません。'; ui.searchResults.append(heading);
  hits.slice(0, 50).forEach((hit) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'result-item';
    button.textContent = `ページ ${hit.page} — ${hit.line}`; button.addEventListener('click', () => navigateTo(hit.page)); ui.searchResults.append(button);
  });
}
function updateCurrentPageFromScroll() {
  if (state.mode !== 'continuous') return;
  const pages = [...ui.viewer.querySelectorAll('.continuous-page')];
  const threshold = ui.viewer.getBoundingClientRect().top + 80;
  let current = pages[0];
  for (const page of pages) {
    if (page.getBoundingClientRect().top <= threshold) current = page; else break;
  }
  if (current) { state.page = Number(current.dataset.index || current.id.replace('page-', '')); updateControls(); }
}

ui.fileInputs.forEach((input) => input.addEventListener('change', (event) => loadPdf(event.target.files?.[0])));
ui.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
ui.prevPage.addEventListener('click', () => navigateTo(state.page - 1));
ui.nextPage.addEventListener('click', () => navigateTo(state.page + 1));
ui.pageInput.addEventListener('change', () => navigateTo(ui.pageInput.value));
ui.fontSize.addEventListener('input', (event) => { state.fontSize = Number(event.target.value); if (state.pdf && state.mode !== 'page') render(); });
ui.zoomRange.addEventListener('input', (event) => setZoom(Number(event.target.value) / 100));
ui.zoomOut.addEventListener('click', () => setZoom(state.zoom - 0.1));
ui.zoomIn.addEventListener('click', () => setZoom(state.zoom + 0.1));
ui.fitWidth.addEventListener('click', () => setZoom(1));
ui.searchForm.addEventListener('submit', (event) => { event.preventDefault(); const q = ui.searchInput.value.trim(); if (state.pdf && q) showSearchResults(q); });
ui.viewer.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });

// Native two-finger pinch zoom, finalized as a PDF.js rerender when the gesture ends.
ui.viewer.addEventListener('touchstart', (event) => {
  if (state.mode !== 'page' || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  state.pinch = { distance, zoom: state.zoom };
}, { passive: true });
ui.viewer.addEventListener('touchmove', (event) => {
  if (!state.pinch || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const nextZoom = Math.max(0.5, Math.min(3, state.pinch.zoom * distance / state.pinch.distance));
  state.zoom = nextZoom; updateControls();
  const canvas = ui.viewer.querySelector('canvas');
  if (canvas) canvas.style.transform = `scale(${nextZoom / (state.pinch.renderedZoom || state.pinch.zoom)})`;
  clearTimeout(state.pinchTimer);
  state.pinchTimer = setTimeout(() => { state.pinch = null; renderPage().catch((error) => console.error(error)); }, 140);
}, { passive: true });
ui.viewer.addEventListener('touchend', () => {
  if (!state.pinch) return;
  clearTimeout(state.pinchTimer); state.pinch = null;
  renderPage().catch((error) => { console.error(error); setStatus('ズーム表示を更新できませんでした。', 'error'); });
}, { passive: true });

ui.closeFile.addEventListener('click', async () => {
  if (state.pdf) await state.pdf.destroy();
  state.pdf = null; state.page = 1; state.textByPage = []; state.zoom = 1; state.fontSize = 19;
  ui.fontSize.value = '19'; ui.searchInput.value = ''; ui.searchResults.hidden = true;
  ui.reader.hidden = true; ui.welcome.hidden = false; ui.viewer.replaceChildren(); setStatus(''); updateControls();
});
window.addEventListener('resize', () => {
  if (state.pdf && state.mode === 'page') renderPage().catch((error) => console.error(error));
});
updateControls(); setStatus('');
