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
  await waitFor("document.readyState === 'complete' && document.querySelector('#auth-form') !== null", "application boot");
  await check("document.title.includes('KPZ')", "page title");
  await check("getComputedStyle(document.documentElement).colorScheme === 'dark'", "dark theme is default");
  await check("document.querySelector('.streak-card') === null", "streak removed");
  await check("document.querySelector('#auth-form button[type=\"submit\"]').textContent === 'Vstoupit do KPZ'", "Czech login interface");
  await check("!document.querySelector('#auth-screen').hidden", "password gate shown");
  await check(noHorizontalOverflow, "login fits 320px viewport");
  await evaluate(`document.querySelector('#access-code').value='kpz-admin'; document.querySelector('#auth-form').requestSubmit()`);
  await waitFor("!document.querySelector('#app-shell').hidden", "admin login");
  await check("document.documentElement.lang === 'cs'", "Czech document language");
  await check("document.querySelector('#role-pill').textContent === 'Správce'", "admin access");
  await check("document.querySelectorAll('.set-card').length === 3", "three study sets load");
  await check("document.querySelector('.set-card h3').textContent === 'Buňka a její části'", "Czech study content");
  await check(noHorizontalOverflow, "dashboard fits 320px viewport");

  await evaluate("document.querySelector('.set-card button').click()");
  await waitFor("!document.querySelector('#set-view').hidden", "set detail");
  await check("document.querySelectorAll('.term-row').length === 10", "set terms render");
  await check(noHorizontalOverflow, "set detail fits 320px viewport");
  await evaluate("document.querySelector('[data-mode=\"flashcards\"]').click()");
  await waitFor("document.querySelector('#active-flashcard') !== null", "flashcard mode");
  await evaluate("document.querySelector('#active-flashcard').click()");
  await check("document.querySelector('#active-flashcard').classList.contains('flipped')", "flashcard flips");
  await check(noHorizontalOverflow, "flashcards fit 320px viewport");
  await evaluate("document.querySelector('#card-right').click()");
  await waitFor("document.querySelector('#flash-right-count')?.textContent === '1' && document.querySelector('#study-counter')?.textContent.startsWith('2 /')", "flashcard right grading");
  await evaluate(`(() => { const card = document.querySelector('#active-flashcard'); const options = { bubbles: true, pointerId: 8, pointerType: 'touch', clientY: 100, isPrimary: true }; card.dispatchEvent(new PointerEvent('pointerdown', { ...options, clientX: 200 })); card.dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: 100 })); card.dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: 100 })); })()`);
  await waitFor("document.querySelector('#flash-wrong-count')?.textContent === '1' && document.querySelector('#study-counter')?.textContent.startsWith('3 /')", "flashcard swipe grading");
  await evaluate("document.querySelector('#study-close').click(); document.querySelector('[data-mode=\"quiz\"]').click()");
  await waitFor("document.querySelector('.answer-option') !== null", "quiz mode");
  await evaluate("document.querySelector('.answer-option').click()");
  await check("document.querySelectorAll('.answer-option:disabled').length > 0", "quiz answer scores");
  await evaluate("document.querySelector('#study-close').click(); document.querySelector('[data-mode=\"memory\"]').click()");
  await waitFor("document.querySelector('.memory-card') !== null", "memory mode");
  await check("document.querySelectorAll('.memory-card').length === 12", "memory board renders six pairs");

  await evaluate("document.querySelector('#study-close').click(); document.querySelector('[data-nav=\"worksheets\"]').click()");
  await check("document.querySelectorAll('.worksheet-card').length === 2", "worksheet gallery loads");
  await check(noHorizontalOverflow, "worksheets fit 320px viewport");
  await evaluate("document.querySelector('[data-nav=\"admin\"]').click()");
  await waitFor("!document.querySelector('#admin-view').hidden", "admin studio");
  await check("document.querySelectorAll('.admin-card-row').length > 0", "admin cards editable");
  await check("document.querySelector('#admin-download-index') !== null", "admin export controls available");
  await check(noHorizontalOverflow, "admin fits 320px viewport");
  await evaluate("document.querySelector('#logout-button').click(); document.querySelector('#access-code').value='vyzmizikovanej'; document.querySelector('#auth-form').requestSubmit()");
  await waitFor("!document.querySelector('#app-shell').hidden && document.querySelector('#role-pill').textContent === 'Student'", "student login");
  await check("document.querySelector('#admin-nav').hidden", "admin tools hidden from students");
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
