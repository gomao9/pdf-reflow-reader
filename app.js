const $ = (selector) => document.querySelector(selector);
const pdfjs = window.pdfjsLib;

const state = {
  pdf: null,
  mode: 'reflow',
  page: 1,
  fontSize: 19,
  pageScale: 1,
  text: [],
  fileName: '',
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
};

if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function setStatus(message, kind = '') {
  ui.status.textContent = message;
  ui.status.className = `status${kind ? ` ${kind}` : ''}`;
  ui.status.hidden = !message;
}

function updatePageControls() {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(state.page, state.pdf.numPages));
  ui.pageInput.value = String(state.page);
  ui.pageInput.max = String(state.pdf.numPages);
  ui.pageCount.textContent = String(state.pdf.numPages);
}

function textLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], text: item.str.trim() });
  }

  return [...rows.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function openPdf(file) {
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
    state.fileName = file.name;
    state.page = 1;
    state.text = new Array(pdf.numPages);
    ui.fileName.textContent = file.name;
    ui.docMeta.textContent = `${pdf.numPages} ページ`;
    ui.welcome.hidden = true;
    ui.reader.hidden = false;
    updatePageControls();
    setStatus('本文を準備しています…');

    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      state.text[n - 1] = textLines((await page.getTextContent()).items);
    }

    setStatus('読み込み完了。リフロー表示では、文字を画面幅に合わせて表示します。');
    await render();
  } catch (error) {
    console.error(error);
    setStatus('PDFを開けませんでした。ファイルが破損していないか確認してください。', 'error');
  } finally {
    for (const input of ui.fileInputs) input.value = '';
  }
}

function pageModeFitWidth() {
  const targetWidth = Math.min(ui.viewer.clientWidth - 40, 960);
  return targetWidth / 1000;
}

function renderContinuousView() {
  ui.viewer.className = 'viewer continuous-view';
  ui.viewer.replaceChildren();

  const pages = [];
  for (let i = 0; i < state.text.length; i += 1) {
    const pageNumber = i + 1;
    const lines = state.text[i] || [];
    const article = document.createElement('article');
    article.className = 'continuous-page';
    article.id = `page-${pageNumber}`;

    const header = document.createElement('div');
    header.className = 'page-marker';
    header.textContent = `ページ ${pageNumber}`;
    article.append(header);

    if (!lines.length) {
      const note = document.createElement('p');
      note.className = 'page-empty';
      note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。';
      article.append(note);
    } else {
      for (const line of lines) {
        const p = document.createElement('p');
        p.className = 'text-line';
        p.style.fontSize = `${state.fontSize}px`;
        p.textContent = line;
        article.append(p);
      }
    }
    pages.push(article);
  }

  for (const page of pages) ui.viewer.append(page);
}

function renderReflowView() {
  ui.viewer.className = 'viewer reflow-view';
  ui.viewer.replaceChildren();

  const page = state.text[state.page - 1] || [];
  const article = document.createElement('article');
  article.className = 'reflow-page';
  article.id = `page-${state.page}`;

  const marker = document.createElement('div');
  marker.className = 'page-marker';
  marker.textContent = `ページ ${state.page}`;
  article.append(marker);

  if (!page.length) {
    const note = document.createElement('p');
    note.className = 'page-empty';
    note.textContent = 'このページから文字を抽出できません。スキャン画像のみのPDFは表示できません。';
    article.append(note);
  } else {
    for (const line of page) {
      const p = document.createElement('p');
      p.className = 'text-line';
      p.style.fontSize = `${state.fontSize}px`;
      p.textContent = line;
      article.append(p);
    }
  }

  ui.viewer.append(article);
}

async function renderPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const width = Math.max(260, Math.min(ui.viewer.clientWidth - 28, 1000));
  const viewport = page.getViewport({ scale: (width / base.width) * state.pageScale });
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas';
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  ui.viewer.className = 'viewer page-view';
  ui.viewer.replaceChildren(canvas);
}

async function render() {
  if (!state.pdf) return;
  updatePageControls();

  if (state.mode === 'page') {
    await renderPage();
    return;
  }

  if (state.mode === 'continuous') {
    renderContinuousView();
    return;
  }

  renderReflowView();
  const target = document.getElementById(`page-${state.page}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateTo(pageNumber) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(Number(pageNumber) || 1, state.pdf.numPages));
  updatePageControls();
  if (state.mode === 'reflow') {
    render();
    return;
  }
  if (state.mode === 'continuous') {
    render();
    return;
  }
  render().catch((error) => {
    console.error(error);
    setStatus('ページを表示できませんでした。', 'error');
  });
}

function showSearchResults(query) {
  ui.searchResults.replaceChildren();
  const results = [];
  state.text.forEach((lines, index) => {
    (lines || []).forEach((line) => {
      if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        results.push({ page: index + 1, line });
      }
    });
  });

  ui.searchResults.hidden = false;
  const heading = document.createElement('p');
  heading.className = 'results-heading';
  heading.textContent = results.length ? `検索結果 ${results.length} 件（先頭50件）` : '一致する結果はありません。';
  ui.searchResults.append(heading);

  for (const result of results.slice(0, 50)) {
    const button = document.createElement('button');
    button.className = 'result-item';
    button.type = 'button';
    button.textContent = `ページ ${result.page} — ${result.line}`;
    button.addEventListener('click', () => navigateTo(result.page));
    ui.searchResults.append(button);
  }
}

for (const input of ui.fileInputs) {
  input.addEventListener('change', (event) => openPdf(event.target.files?.[0]));
}

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', async () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('.mode-button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-pressed', String(active));
    });
    try {
      await render();
    } catch (error) {
      console.error(error);
      setStatus('表示を切り替えられませんでした。', 'error');
    }
  });
});

$('#prev-page').addEventListener('click', () => navigateTo(state.page - 1));
$('#next-page').addEventListener('click', () => navigateTo(state.page + 1));
ui.pageInput.addEventListener('change', () => navigateTo(ui.pageInput.value));
$('#font-size').addEventListener('input', (event) => {
  state.fontSize = Number(event.target.value);
  if (state.pdf && state.mode !== 'page') render();
});
$('#page-scale').addEventListener('input', (event) => {
  state.pageScale = Number(event.target.value);
  if (state.pdf && state.mode === 'page') renderPage();
});
$('#fit-width').addEventListener('click', () => {
  const scale = pageModeFitWidth();
  state.pageScale = scale;
  $('#page-scale').value = String(scale);
  if (state.pdf && state.mode === 'page') renderPage();
});

ui.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = ui.searchInput.value.trim();
  if (!state.pdf || !query) return;
  showSearchResults(query);
});

$('#close-file').addEventListener('click', async () => {
  if (state.pdf) await state.pdf.destroy();
  state.pdf = null;
  state.text = [];
  state.page = 1;
  state.fontSize = 19;
  state.pageScale = 1;
  $('#font-size').value = '19';
  $('#page-scale').value = '1';
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
