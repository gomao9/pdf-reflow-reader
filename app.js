const $ = (selector) => document.querySelector(selector);
const pdfjs = window.pdfjsLib;

const state = {
  pdf: null,
  mode: 'reflow',
  page: 1,
  fontSize: 19,
  pageScale: 1,
  textByPage: [],
};

const ui = {
  fileInputs: [$('#file-input'), $('#welcome-file-input')],
  welcome: $('#welcome'),
  reader: $('#reader'),
  fileName: $('#file-name'),
  docMeta: $('#doc-meta'),
  pageInput: $('#page-input'),
  pageCount: $('#page-count'),
  viewer: $('#viewer'),
  status: $('#status'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchResults: $('#search-results'),
  modeButtons: [...document.querySelectorAll('.mode-button')],
  prevPage: $('#prev-page'),
  nextPage: $('#next-page'),
  fontSize: $('#font-size'),
  pageScale: $('#page-scale'),
  fitWidth: $('#fit-width'),
  closeFile: $('#close-file'),
};

if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
  ui.status.hidden = !message;
}

function clampPage() {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(state.page, state.pdf.numPages));
}

function updatePageControls() {
  clampPage();
  ui.pageInput.value = String(state.page);
  ui.pageInput.max = String(state.pdf ? state.pdf.numPages : 1);
  ui.pageCount.textContent = String(state.pdf ? state.pdf.numPages : 0);
}

function textLines(items) {
  const rows = new Map();

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const yKey = Math.round(item.transform[5] / 3) * 3;
    if (!rows.has(yKey)) rows.set(yKey, []);
    rows.get(yKey).push({ x: item.transform[4], text: item.str.trim() });
  }

  return [...rows.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function loadPdf(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    setStatus('PDFファイルを選択してください。', 'error');
    return;
  }
  if (!pdfjs) {
    setStatus('PDF表示ライブラリーを読み込めませんでした。ネットワーク接続を確認して再読み込みしてください。', 'error');
    return;
  }

  setStatus('PDFを読み込んでいます…');
  ui.viewer.replaceChildren();
  ui.searchResults.hidden = true;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    state.pdf = pdf;
    state.page = 1;
    state.textByPage = [];

    ui.fileName.textContent = file.name;
    ui.docMeta.textContent = `${pdf.numPages} ページ`;
    ui.welcome.hidden = true;
    ui.reader.hidden = false;

    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const textContent = await page.getTextContent();
      state.textByPage[index - 1] = textLines(textContent.items);
    }

    setStatus('読み込み完了。リフロー表示では、文字を画面幅に合わせて表示します。');
    render();
  } catch (error) {
    console.error(error);
    setStatus('PDFを開けませんでした。ファイルが破損していないか確認してください。', 'error');
  } finally {
    for (const input of ui.fileInputs) input.value = '';
  }
}

function renderReflow() {
  ui.viewer.className = 'viewer reflow-view';
  ui.viewer.replaceChildren();

  const pageLines = state.textByPage[state.page - 1] || [];
  const article = document.createElement('article');
  article.className = 'reflow-page';
  article.id = `page-${state.page}`;

  const marker = document.createElement('div');
  marker.className = 'page-marker';
  marker.textContent = `ページ ${state.page}`;
  article.appendChild(marker);

  if (!pageLines.length) {
    const note = document.createElement('p');
    note.className = 'page-empty';
    note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。';
    article.appendChild(note);
  } else {
    for (const line of pageLines) {
      const p = document.createElement('p');
      p.className = 'text-line';
      p.style.fontSize = `${state.fontSize}px`;
      p.textContent = line;
      article.appendChild(p);
    }
  }

  ui.viewer.appendChild(article);
}

function renderContinuous() {
  ui.viewer.className = 'viewer continuous-view';
  ui.viewer.replaceChildren();

  for (let pageIndex = 0; pageIndex < state.textByPage.length; pageIndex += 1) {
    const lines = state.textByPage[pageIndex] || [];
    const article = document.createElement('article');
    article.className = 'continuous-page';
    article.id = `page-${pageIndex + 1}`;

    const marker = document.createElement('div');
    marker.className = 'page-marker';
    marker.textContent = `ページ ${pageIndex + 1}`;
    article.appendChild(marker);

    if (!lines.length) {
      const note = document.createElement('p');
      note.className = 'page-empty';
      note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。';
      article.appendChild(note);
    } else {
      for (const line of lines) {
        const p = document.createElement('p');
        p.className = 'text-line';
        p.style.fontSize = `${state.fontSize}px`;
        p.textContent = line;
        article.appendChild(p);
      }
    }

    ui.viewer.appendChild(article);
  }
}

async function renderPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const maxWidth = Math.min(ui.viewer.clientWidth - 24, 980);
  const scale = (maxWidth / base.width) * state.pageScale;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas';
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;

  ui.viewer.className = 'viewer page-view';
  ui.viewer.replaceChildren(canvas);
}

function setMode(mode) {
  state.mode = mode;
  ui.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  render();
}

async function render() {
  if (!state.pdf) return;
  updatePageControls();

  if (state.mode === 'page') {
    await renderPage();
    return;
  }

  if (state.mode === 'continuous') {
    renderContinuous();
    return;
  }

  renderReflow();
  const el = document.getElementById(`page-${state.page}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateTo(pageNumber) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(Number(pageNumber) || 1, state.pdf.numPages));
  updatePageControls();
  render();
}

function showSearchResults(query) {
  ui.searchResults.replaceChildren();
  const hits = [];

  state.textByPage.forEach((lines, pageIndex) => {
    (lines || []).forEach((line) => {
      if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        hits.push({ page: pageIndex + 1, line });
      }
    });
  });

  ui.searchResults.hidden = false;
  const heading = document.createElement('p');
  heading.className = 'results-heading';
  heading.textContent = hits.length ? `検索結果 ${hits.length} 件（先頭50件）` : '一致する結果はありません。';
  ui.searchResults.appendChild(heading);

  for (const hit of hits.slice(0, 50)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-item';
    button.textContent = `ページ ${hit.page} — ${hit.line}`;
    button.addEventListener('click', () => navigateTo(hit.page));
    ui.searchResults.appendChild(button);
  }
}

for (const input of ui.fileInputs) {
  input.addEventListener('change', (event) => loadPdf(event.target.files?.[0]));
}

ui.modeButtons.forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

ui.prevPage.addEventListener('click', () => navigateTo(state.page - 1));
ui.nextPage.addEventListener('click', () => navigateTo(state.page + 1));
ui.pageInput.addEventListener('change', () => navigateTo(ui.pageInput.value));
ui.fontSize.addEventListener('input', (event) => {
  state.fontSize = Number(event.target.value);
  if (state.pdf && state.mode !== 'page') render();
});
ui.pageScale.addEventListener('input', (event) => {
  state.pageScale = Number(event.target.value);
  if (state.pdf && state.mode === 'page') renderPage();
});
ui.fitWidth.addEventListener('click', () => {
  const base = Math.min(ui.viewer.clientWidth / 1000, 1.2);
  state.pageScale = Number(base.toFixed(2));
  ui.pageScale.value = String(state.pageScale);
  if (state.pdf && state.mode === 'page') renderPage();
});

ui.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = ui.searchInput.value.trim();
  if (!state.pdf || !query) return;
  showSearchResults(query);
});

ui.closeFile.addEventListener('click', async () => {
  if (state.pdf) await state.pdf.destroy();
  state.pdf = null;
  state.page = 1;
  state.textByPage = [];
  state.fontSize = 19;
  state.pageScale = 1;
  ui.fontSize.value = '19';
  ui.pageScale.value = '1';
  ui.reader.hidden = true;
  ui.welcome.hidden = false;
  ui.viewer.replaceChildren();
  ui.searchInput.value = '';
  ui.searchResults.hidden = true;
  setStatus('');
});

window.addEventListener('resize', () => {
  if (state.pdf && state.mode === 'page') {
    renderPage().catch((error) => console.error(error));
  }
});

updatePageControls();
setStatus('');
