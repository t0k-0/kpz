import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = process.env.KPZ_ROOT ? resolve(process.env.KPZ_ROOT) : resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = 4173;
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profilePath = join(tmpdir(), `kpz-smoke-${Date.now()}`);
const contentTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".sql": "text/plain", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".md": "text/markdown" };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(root)) throw new Error("Bad path");
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": contentTypes[extname(path)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveReady) => server.listen(port, "127.0.0.1", resolveReady));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--remote-allow-origins=*",
  "--remote-debugging-port=9223",
  `--user-data-dir=${profilePath}`,
  `http://127.0.0.1:${port}/`,
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
let chromeError = "";
chrome.stderr.on("data", (chunk) => { chromeError += chunk; });

const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
let socket;
let nextId = 0;
const pending = new Map();
const exceptions = [];

try {
  let page;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const pages = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json());
      page = pages.find((candidate) => candidate.type === "page" && candidate.url.startsWith(`http://127.0.0.1:${port}`));
      if (page) break;
    } catch {}
    await pause(200);
  }
  if (!page) throw new Error(`Chrome DevTools did not start. ${chromeError.trim()}`);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolveResult, rejectResult } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rejectResult(new Error(message.error.message));
      else resolveResult(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
  });

  const send = (method, params = {}) => new Promise((resolveResult, rejectResult) => {
    const id = ++nextId;
    pending.set(id, { resolveResult, rejectResult });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (expression, label) => {
    if (!(await evaluate(expression))) throw new Error(`Check failed: ${label}`);
    console.log(`PASS ${label}`);
  };

  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
  await pause(150);
  const noHorizontalOverflow = "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1";
  await waitFor("document.readyState !== 'loading' && document.documentElement.dataset.kpzReady === 'true'", "application boot");
  await check("document.title.includes('KPZ')", "page title");
  await waitFor("getComputedStyle(document.documentElement).colorScheme === 'dark'", "theme stylesheet");
  await check("getComputedStyle(document.documentElement).colorScheme === 'dark'", "dark theme is default");
  await check("document.querySelector('.streak-card') === null", "streak removed");
  await check("document.querySelector('#auth-form button[type=\"submit\"]').textContent === 'Vstoupit do KPZ'", "Czech login interface");
  await check("!document.querySelector('#auth-screen').hidden", "password gate shown");
  await check("getComputedStyle(document.querySelector('#auth-screen')).backgroundImage === 'none'", "login has no gradient");
  await check("getComputedStyle(document.querySelector('.auth-card')).borderRadius === '16px'", "shared surface radius");
  await check(noHorizontalOverflow, "login fits 320px viewport");
  await evaluate(`document.querySelector('#access-code').value='kpz-admin'; document.querySelector('#auth-form').requestSubmit()`);
  await waitFor("!document.querySelector('#app-shell').hidden", "admin login");
  await check("document.documentElement.lang === 'cs'", "Czech document language");
  await check("document.querySelector('#role-pill').textContent === 'Správce'", "admin access");
  await check("state.sets.length > 0 && document.querySelectorAll('.set-card').length === state.sets.length", "study sets load");
  await check("(() => { const shown = [...document.querySelectorAll('.subject-heading h3')].map((heading) => heading.textContent); const expected = [...new Set(state.sets.map((set) => set.subject))].sort(new Intl.Collator('cs', { sensitivity: 'base' }).compare); return shown.join('|') === expected.join('|'); })()", "home is grouped into sorted subjects");
  await check("document.querySelector('.set-card h3').textContent.length > 0", "Czech study content");
  await check("getComputedStyle(document.querySelector('.set-card-main')).borderRadius === '16px' && getComputedStyle(document.querySelector('#continue-panel')).backgroundImage === 'none'", "flat dashboard surfaces");
  await check(noHorizontalOverflow, "dashboard fits 320px viewport");
  await evaluate("document.querySelector('[data-nav=\"map\"]').click()");
  await waitFor("document.querySelector('#blind-map').dataset.ready === 'true'", "blind map data");
  await check("[...document.querySelectorAll('#map-land-layer path')].some((path) => path.getAttribute('d').length > 1000) && document.querySelectorAll('#map-category option').length === 14", "Natural Earth map and assignment categories load");
  await check("fetch('data/maps/world-assignment.json').then((response) => response.json()).then((data) => data.items.filter((item) => item.category === 'rivers').every((item) => item.target.type === 'line' && item.target.coordinates.length >= 3))", "rivers use line corridors");
  await check("!document.querySelector('#map-editor-toggle').hidden", "map editor is available to admin");
  await check(noHorizontalOverflow, "blind map fits 320px viewport");
  await evaluate("document.querySelector('#map-start').click()");
  await waitFor("!document.querySelector('#map-question').hidden", "blind map round starts");
  await evaluate("document.querySelector('#map-skip').click()");
  await waitFor("!document.querySelector('#map-feedback').hidden && document.querySelector('#map-feedback-title').textContent === 'Tady to je'", "Nevim reveals the target");
  await evaluate("document.querySelector('#map-next').click()");
  await waitFor("document.querySelector('#map-feedback').hidden && !document.querySelector('#map-skip').disabled", "blind map continues after Nevim");
  await evaluate(`(() => { const map = document.querySelector('#blind-map'); const rect = map.getBoundingClientRect(); const options = { bubbles: true, pointerId: 9, pointerType: 'mouse', button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; map.dispatchEvent(new PointerEvent('pointerdown', options)); map.dispatchEvent(new PointerEvent('pointerup', options)); })()`);
  await waitFor("!document.querySelector('#map-feedback').hidden && document.querySelector('#map-target-layer').children.length > 0", "blind map answer reveals target");
  await evaluate("document.querySelector('#map-editor-toggle').click()");
  await waitFor("!document.querySelector('#map-editor').hidden", "blind map editor opens");
  await check("document.querySelectorAll('#map-item-list [data-map-item]').length >= 184 && document.querySelectorAll('[data-map-tool]').length === 4", "map editor contains all assignment terms and drawing tools");
  await evaluate("document.querySelector('[data-map-tool=\"point\"]').click(); (() => { const map = document.querySelector('#blind-map'); const rect = map.getBoundingClientRect(); const options = { bubbles: true, pointerId: 10, pointerType: 'mouse', button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }; map.dispatchEvent(new PointerEvent('pointerdown', options)); map.dispatchEvent(new PointerEvent('pointerup', options)); })()");
  await check("document.querySelector('#map-target-layer .target-point') !== null", "admin can draw a map point");
  await evaluate("document.querySelector('[data-nav=\"dashboard\"]').click()");
  await waitFor("!document.querySelector('#dashboard-view').hidden", "return from map");
  await evaluate("document.querySelector('#set-search').value=state.sets[0].subject; document.querySelector('#set-search').dispatchEvent(new Event('input', { bubbles: true }))");
  await check("document.querySelectorAll('.subject-section').length >= 1 && [...document.querySelectorAll('.subject-heading h3')].every((heading) => heading.textContent.toLocaleLowerCase().includes(state.sets[0].subject.toLocaleLowerCase()))", "search hides empty subject sections");

  await evaluate("document.querySelector('.set-card button').click()");
  await waitFor("!document.querySelector('#set-view').hidden", "set detail");
  await check("document.querySelectorAll('.term-row').length === state.currentSet.cards.length", "set terms render");
  await check("getComputedStyle(document.querySelector('.set-hero')).borderRadius === '16px' && getComputedStyle(document.querySelector('.mode-grid')).borderRadius === '16px'", "uniform set-detail radius");
  await check("document.querySelector('#random-order').checked && state.randomOrder", "random queue is enabled by default");
  await check(noHorizontalOverflow, "set detail fits 320px viewport");
  await evaluate("document.querySelector('#random-order').checked=false; document.querySelector('#random-order').dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-mode=\"flashcards\"]').click()");
  await waitFor("document.querySelector('#active-flashcard') !== null", "flashcard mode");
  await check("state.study.cards.every((card, index) => card === state.currentSet.cards[index]) && localStorage.getItem('kpz:random-order') === 'false'", "switch disables queue shuffling and saves preference");
  await evaluate("document.querySelector('#active-flashcard').click()");
  await check("document.querySelector('#active-flashcard').classList.contains('flipped')", "flashcard flips");
  await check("getComputedStyle(document.querySelector('.flashcard-face.back')).backgroundImage === 'none' && getComputedStyle(document.querySelector('.flashcard-face')).borderRadius === '16px'", "flat flashcard surfaces");
  await check(noHorizontalOverflow, "flashcards fit 320px viewport");
  await evaluate("document.querySelector('#card-right').click()");
  await waitFor("document.querySelector('#flash-right-count')?.textContent === '1' && document.querySelector('#study-counter')?.textContent.startsWith('2 /')", "flashcard right grading");
  await evaluate(`(() => { const card = document.querySelector('#active-flashcard'); const options = { bubbles: true, pointerId: 8, pointerType: 'touch', clientY: 100, isPrimary: true }; card.dispatchEvent(new PointerEvent('pointerdown', { ...options, clientX: 200 })); card.dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: 100 })); card.dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: 100 })); })()`);
  await waitFor("document.querySelector('#flash-wrong-count')?.textContent === '1' && document.querySelector('#study-counter')?.textContent.startsWith('3 /')", "flashcard swipe grading");
  await evaluate("document.querySelector('#study-close').click(); document.querySelector('#random-order').checked=true; document.querySelector('#random-order').dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-mode=\"quiz\"]').click()");
  await waitFor("document.querySelector('.answer-option') !== null", "quiz mode");
  await evaluate("document.querySelector('.answer-option').click()");
  await check("document.querySelectorAll('.answer-option:disabled').length > 0", "quiz answer scores");
  await evaluate("document.querySelector('#study-close').click(); document.querySelector('[data-mode=\"memory\"]').click()");
  await waitFor("document.querySelector('.memory-card') !== null", "memory mode");
  await check("document.querySelectorAll('.memory-card').length === 12", "memory board renders six pairs");

  await evaluate("document.querySelector('#study-close').click(); document.querySelector('[data-nav=\"worksheets\"]').click()");
  await check("document.querySelectorAll('.worksheet-card').length === 7", "worksheet gallery loads all documents");
  await check(noHorizontalOverflow, "worksheets fit 320px viewport");
  await evaluate("document.querySelector('[data-nav=\"admin\"]').click()");
  await waitFor("!document.querySelector('#admin-view').hidden", "admin studio");
  await check("document.querySelectorAll('.admin-card-row').length > 0", "admin cards editable");
  await check("document.querySelector('.admin-image') && document.querySelector('.admin-image-fit')", "admin image controls available");
  await evaluate(`(() => { const row = document.querySelector('.admin-card-row'); row.querySelector('.admin-image').value = location.origin + '/assets/icon.svg'; row.querySelector('.admin-image-fit').value = 'cover'; const saved = serializeStudySet(collectAdminSet()); window.__imageCard = parseStudySet(saved, 'image-test').cards[0]; })()`);
  await check("window.__imageCard.image.endsWith('/assets/icon.svg') && window.__imageCard.imageFit === 'cover'", "image URL and crop mode survive SQL export");
  await evaluate("state.study = { mode: 'flashcards', index: 0, cards: [window.__imageCard], correct: 0, incorrect: 0, answered: false, transitioning: false }; renderFlashcards()");
  await check("document.querySelector('.flashcard-image') && getComputedStyle(document.querySelector('.flashcard-image')).objectFit === 'cover'", "URL image renders cropped on flashcard");
  await evaluate("state.currentSet = { id: 'image-test', cards: [window.__imageCard, { term: 'Jiný organismus', definition: 'Jiná definice', image: '', imageFit: 'contain' }] }; state.study = { mode: 'quiz', index: 0, cards: [window.__imageCard], correct: 0, incorrect: 0, answered: false }; renderQuiz()");
  await check("document.querySelector('.quiz-question .prompt-image') && [...document.querySelectorAll('.answer-option')].some((option) => option.textContent === window.__imageCard.term)", "image identification works in quiz mode");
  await evaluate("state.study = { mode: 'memory', index: 0, cards: [window.__imageCard], correct: 0, incorrect: 0, answered: false }; renderMemory()");
  await check("(() => { const pair = state.study.memory.deck; return pair.some((card) => card.kind === 'image') && pair.some((card) => card.kind === 'definition' && card.text === window.__imageCard.definition) && !pair.some((card) => card.kind === 'term'); })()", "image memory pairs picture with definition");
  await evaluate("clearInterval(state.memoryTimer); state.study = { mode: 'memory', index: 0, cards: [{ term: 'Název', definition: 'Definice', image: '', imageFit: 'contain' }], correct: 0, incorrect: 0, answered: false }; renderMemory()");
  await check("(() => { const pair = state.study.memory.deck; return pair.some((card) => card.kind === 'term' && card.text === 'Název') && pair.some((card) => card.kind === 'definition' && card.text === 'Definice'); })()", "text memory pairs title with definition");
  await evaluate("clearInterval(state.memoryTimer)");
  await check("document.querySelector('#admin-download-index') !== null", "admin export controls available");
  await check(noHorizontalOverflow, "admin fits 320px viewport");
  await evaluate("document.querySelector('#logout-button').click(); document.querySelector('#access-code').value='vyzmizikovanej'; document.querySelector('#auth-form').requestSubmit()");
  await waitFor("!document.querySelector('#app-shell').hidden && document.querySelector('#role-pill').textContent === 'Student'", "student login");
  await check("document.querySelector('#admin-nav').hidden", "admin tools hidden from students");
  await evaluate("document.querySelector('[data-nav=\"map\"]').click()");
  await check("document.querySelector('#map-editor-toggle').hidden", "map editor hidden from students");
  await evaluate("document.querySelector('#logout-button').click(); document.querySelector('#access-code').value='vyzmizikovana'; document.querySelector('#auth-form').requestSubmit()");
  await waitFor("!document.querySelector('#app-shell').hidden && document.querySelector('#role-pill').textContent === 'Student'", "second student code login");
  await check("document.querySelector('#admin-nav').hidden", "second student code has student-only access");
  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(", ")}`);
  console.log("KPZ browser smoke test passed.");
} finally {
  socket?.close();
  chrome.kill();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
