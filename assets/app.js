const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const colorMap = {
  violet: "#7558e8",
  coral: "#ff785f",
  mint: "#3ccca5",
  blue: "#55a6ee",
  yellow: "#e5a72c",
};

const state = {
  config: null,
  setIndex: [],
  sets: [],
  worksheets: [],
  currentSet: null,
  role: null,
  currentView: "dashboard",
  study: null,
  memoryTimer: null,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline mode unavailable", error));
  }
  bindGlobalEvents();
  try {
    const [config, setIndex, worksheetIndex] = await Promise.all([
      fetchJson("data/config.json"),
      fetchJson("data/sets/index.json"),
      fetchJson("worksheets/index.json"),
    ]);
    state.config = config;
    state.setIndex = setIndex.sets || [];
    state.worksheets = worksheetIndex.worksheets || [];
    await loadAllSets();
    restoreSession();
  } catch (error) {
    console.error(error);
    $("#auth-error").textContent = "KPZ se nepodařilo načíst. Spusť web přes lokální server a zkus to znovu.";
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Nepodařilo se načíst ${path}`);
  return response.json();
}

async function loadAllSets() {
  const loaded = await Promise.all(state.setIndex.map(async (entry) => {
    const draft = localStorage.getItem(`kpz:draft:${entry.id}`);
    const sql = draft || await fetch(`data/sets/${entry.file}`, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`Nepodařilo se načíst ${entry.file}`);
      return response.text();
    });
    return { ...parseStudySet(sql, entry.id), id: entry.id, file: entry.file, isDraft: Boolean(draft) };
  }));
  state.sets = loaded;
}

function bindGlobalEvents() {
  $("#auth-form").addEventListener("submit", handleLogin);
  $("#toggle-password").addEventListener("click", () => {
    const input = $("#access-code");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("#toggle-password").textContent = showing ? "Ukázat" : "Skrýt";
    $("#toggle-password").setAttribute("aria-label", showing ? "Zobrazit heslo" : "Skrýt heslo");
  });
  $("#logout-button").addEventListener("click", logout);
  $("#brand-home").addEventListener("click", () => showView("dashboard"));
  $("#set-search").addEventListener("input", renderSetGrid);
  $("#continue-button").addEventListener("click", resumeLastSet);
  $$('[data-action="dashboard"]').forEach((button) => button.addEventListener("click", () => showView("dashboard")));
  $$('[data-mode]').forEach((button) => button.addEventListener("click", () => startMode(button.dataset.mode)));
  $("#study-close").addEventListener("click", closeStudy);
  $$("[data-nav]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.nav)));
  $("#admin-set-select").addEventListener("change", () => populateAdminEditor($("#admin-set-select").value));
  $("#admin-new-set").addEventListener("click", createNewSetDraft);
  $("#admin-add-card").addEventListener("click", () => addAdminCard());
  $("#admin-save-local").addEventListener("click", saveAdminDraft);
  $("#admin-download-sql").addEventListener("click", downloadAdminSql);
  $("#admin-download-index").addEventListener("click", downloadSetIndex);
}

async function handleLogin(event) {
  event.preventDefault();
  const input = $("#access-code");
  const hash = await sha256(input.value);
  let role = null;
  if (hash === state.config.access.adminHash) role = "admin";
  else if ((state.config.access.studentHashes || [state.config.access.studentHash]).includes(hash)) role = "student";
  if (!role) {
    $("#auth-error").textContent = "Tenhle kód nesedí. Zkontroluj ho a zkus to znovu.";
    input.select();
    return;
  }
  sessionStorage.setItem("kpz:role", role);
  openApp(role);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function restoreSession() {
  const role = sessionStorage.getItem("kpz:role");
  if (role === "student" || role === "admin") openApp(role);
}

function openApp(role) {
  state.role = role;
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
  $("#admin-nav").hidden = role !== "admin";
  $("#role-pill").textContent = role === "admin" ? "Správce" : "Student";
  renderDashboard();
  renderWorksheets("Vše");
  showView("dashboard");
}

function logout() {
  sessionStorage.removeItem("kpz:role");
  clearInterval(state.memoryTimer);
  state.role = null;
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
  $("#access-code").value = "";
  $("#auth-error").textContent = "";
  $("#access-code").focus();
}

function showView(name) {
  if (name === "admin" && state.role !== "admin") name = "dashboard";
  state.currentView = name;
  $$(".view").forEach((view) => { view.hidden = view.id !== `${name}-view`; });
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.nav === name));
  if (name === "dashboard") renderDashboard();
  if (name === "worksheets") renderWorksheets("Vše");
  if (name === "admin") renderAdmin();
  $("#main-content").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDashboard() {
  renderSetGrid();
  const activity = getActivity();
  const last = activity.lastSet && state.sets.find((set) => set.id === activity.lastSet);
  $("#continue-panel").hidden = !last;
  if (last) {
    $("#continue-title").textContent = last.title;
    const progress = activity.progress?.[last.id] || 0;
    $("#continue-progress").style.width = `${Math.max(8, progress)}%`;
  }
}

function renderSetGrid() {
  const query = $("#set-search").value.trim().toLowerCase();
  const grid = $("#set-grid");
  grid.innerHTML = "";
  const sets = state.sets.filter((set) => `${set.title} ${set.description} ${set.subject}`.toLowerCase().includes(query));
  for (const set of sets) {
    const card = $("#set-card-template").content.firstElementChild.cloneNode(true);
    card.style.setProperty("--card-color", colorMap[set.color] || colorMap.violet);
    $(".set-subject", card).textContent = set.subject;
    $("h3", card).textContent = set.title;
    $("p", card).textContent = set.description;
    $(".set-size", card).textContent = `${czechCount(set.cards.length, "pojem", "pojmy", "pojmů")}${set.isDraft ? " · místní koncept" : ""}`;
    $("button", card).addEventListener("click", () => openSet(set.id));
    grid.append(card);
  }
  $("#empty-sets").hidden = sets.length > 0;
}

function openSet(id) {
  const set = state.sets.find((item) => item.id === id);
  if (!set) return;
  state.currentSet = set;
  const hero = $("#set-hero");
  hero.style.background = colorMap[set.color] || colorMap.violet;
  hero.innerHTML = `<p class="eyebrow">${escapeHtml(set.subject)}</p><h1>${escapeHtml(set.title)}</h1><p>${escapeHtml(set.description)}</p>`;
  $("#term-count").textContent = czechCount(set.cards.length, "pojem", "pojmy", "pojmů");
  $("#term-list").innerHTML = set.cards.map((card) => `<div class="term-row"><strong>${escapeHtml(card.term)}</strong><span>${escapeHtml(card.definition)}</span></div>`).join("");
  showView("set");
  recordActivity(set.id, null);
}

function resumeLastSet() {
  const id = getActivity().lastSet;
  if (id) openSet(id);
}

function startMode(mode) {
  if (!state.currentSet?.cards.length) return;
  state.study = { mode, index: 0, cards: shuffle([...state.currentSet.cards]), correct: 0, incorrect: 0, answered: false, transitioning: false };
  $$(".view").forEach((view) => { view.hidden = view.id !== "study-view"; });
  state.currentView = "study";
  $$(".nav-item").forEach((button) => button.classList.remove("active"));
  renderStudy();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeStudy() {
  clearInterval(state.memoryTimer);
  openSet(state.currentSet.id);
}

function renderStudy() {
  clearInterval(state.memoryTimer);
  const mode = state.study.mode;
  if (mode === "flashcards") renderFlashcards();
  else if (mode === "learn") renderLearn();
  else if (mode === "quiz") renderQuiz();
  else renderMemory();
}

function setStudyProgress(current, total) {
  $("#study-progress-bar").style.width = `${Math.round((current / total) * 100)}%`;
  $("#study-counter").textContent = `${Math.min(current, total)} / ${total}`;
}

function renderFlashcards() {
  const { cards, index } = state.study;
  const card = cards[index];
  setStudyProgress(index + 1, cards.length);
  $("#study-stage").innerHTML = `
    <div class="flashcard-score" aria-live="polite">
      <span class="score-wrong">Znovu <b id="flash-wrong-count">${state.study.incorrect}</b></span>
      <span class="score-right">Umím <b id="flash-right-count">${state.study.correct}</b></span>
    </div>
    <div class="flashcard-wrap" id="flashcard-wrap">
      <span class="swipe-stamp wrong">ZNOVU</span>
      <span class="swipe-stamp right">UMÍM</span>
      <button class="flashcard" id="active-flashcard" type="button" aria-label="Otočit kartičku. Přejeď vlevo pro znovu nebo vpravo pro umím.">
        <span class="flashcard-inner">
          <span class="flashcard-face front"><small>Pojem</small><strong>${escapeHtml(card.term)}</strong><span>Klikni nebo klepni pro otočení</span></span>
          <span class="flashcard-face back"><small>Definice</small><strong>${escapeHtml(card.definition)}</strong><span>Klikni nebo klepni pro návrat</span></span>
        </span>
      </button>
    </div>
    <div class="flashcard-controls">
      <button class="button button-wrong" id="card-wrong" type="button">← Znovu</button>
      <button class="button button-light" id="card-flip" type="button">Otočit</button>
      <button class="button button-right" id="card-right" type="button">Umím →</button>
    </div>
    <p class="flashcard-hint">Na telefonu přejeď prstem · na klávesnici použij ← a →</p>`;

  const flashcard = $("#active-flashcard");
  const wrap = $("#flashcard-wrap");
  let dragStartX = 0;
  let dragStartY = 0;
  let dragX = 0;
  let dragging = false;
  let pointerActive = false;
  let suppressClick = false;

  const flip = () => flashcard.classList.toggle("flipped");
  const resetDrag = () => {
    flashcard.classList.remove("dragging");
    flashcard.style.transform = "";
    wrap.classList.remove("drag-left", "drag-right");
    dragging = false;
    pointerActive = false;
    dragX = 0;
  };

  flashcard.addEventListener("click", () => {
    if (suppressClick) return;
    flip();
  });
  flashcard.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      gradeFlashcard(event.key === "ArrowRight");
    }
  });
  flashcard.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragX = 0;
    dragging = false;
    pointerActive = true;
    try { flashcard.setPointerCapture(event.pointerId); } catch {}
  });
  flashcard.addEventListener("pointermove", (event) => {
    if (!pointerActive) return;
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    dragging = true;
    dragX = deltaX;
    flashcard.classList.add("dragging");
    flashcard.style.transform = `translateX(${deltaX}px) rotate(${deltaX / 28}deg)`;
    wrap.classList.toggle("drag-left", deltaX < 0);
    wrap.classList.toggle("drag-right", deltaX > 0);
  });
  flashcard.addEventListener("pointerup", (event) => {
    pointerActive = false;
    try { flashcard.releasePointerCapture(event.pointerId); } catch {}
    if (!dragging) return;
    suppressClick = true;
    if (Math.abs(dragX) >= 70) gradeFlashcard(dragX > 0);
    else resetDrag();
    setTimeout(() => { suppressClick = false; }, 0);
  });
  flashcard.addEventListener("pointercancel", resetDrag);
  $("#card-flip").addEventListener("click", flip);
  $("#card-wrong").addEventListener("click", () => gradeFlashcard(false));
  $("#card-right").addEventListener("click", () => gradeFlashcard(true));
  flashcard.focus({ preventScroll: true });
}

function gradeFlashcard(gotIt) {
  if (state.study.transitioning) return;
  const studySession = state.study;
  state.study.transitioning = true;
  if (gotIt) state.study.correct += 1;
  else state.study.incorrect += 1;
  $("#flash-right-count").textContent = state.study.correct;
  $("#flash-wrong-count").textContent = state.study.incorrect;
  const flashcard = $("#active-flashcard");
  flashcard.classList.add(gotIt ? "swipe-right" : "swipe-left");
  setTimeout(() => {
    if (state.study !== studySession || state.study.mode !== "flashcards") return;
    if (state.study.index === state.study.cards.length - 1) {
      return renderResults(
        "Kartičky hotové",
        state.study.correct,
        state.study.cards.length,
        `${state.study.correct} umím · ${state.study.incorrect} zopakovat`,
      );
    }
    state.study.index += 1;
    state.study.transitioning = false;
    recordActivity(state.currentSet.id, ((state.study.index + 1) / state.study.cards.length) * 100);
    renderFlashcards();
  }, 220);
}

function renderLearn() {
  const { cards, index } = state.study;
  if (index >= cards.length) return renderResults("Kolo učení je hotové", state.study.correct, cards.length);
  const card = cards[index];
  setStudyProgress(index + 1, cards.length);
  $("#study-stage").innerHTML = `
    <div class="learn-prompt">
      <span class="question-label">Napiš odpovídající pojem</span>
      <h2>${escapeHtml(card.definition)}</h2>
      <form id="learn-form">
        <input class="learn-answer" id="learn-input" autocomplete="off" placeholder="Napiš odpověď" aria-label="Tvoje odpověď" required />
        <button class="button button-primary button-wide" type="submit">Zkontrolovat</button>
      </form>
      <div id="learn-feedback"></div>
    </div>`;
  $("#learn-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.study.answered) return advanceLearn();
    const answer = $("#learn-input").value;
    const correct = normalizeAnswer(answer) === normalizeAnswer(card.term);
    state.study.answered = true;
    if (correct) state.study.correct += 1;
    const feedback = $("#learn-feedback");
    feedback.innerHTML = `<div class="answer-feedback ${correct ? "correct" : "incorrect"}">${correct ? "Jo, správně!" : `Správná odpověď je <strong>${escapeHtml(card.term)}</strong>.`}</div><button class="button button-primary button-wide" id="learn-next" type="button">Pokračovat</button>`;
    $("#learn-form button").hidden = true;
    $("#learn-input").disabled = true;
    $("#learn-next").addEventListener("click", advanceLearn);
  });
  $("#learn-input").focus();
}

function advanceLearn() {
  state.study.index += 1;
  state.study.answered = false;
  recordActivity(state.currentSet.id, (state.study.index / state.study.cards.length) * 100);
  renderLearn();
}

function renderQuiz() {
  const limit = Math.min(10, state.study.cards.length);
  const { index } = state.study;
  if (index >= limit) return renderResults("Kvíz je hotový", state.study.correct, limit);
  const card = state.study.cards[index];
  const distractors = shuffle(state.currentSet.cards.filter((item) => item.term !== card.term)).slice(0, 3).map((item) => item.definition);
  const answers = shuffle([card.definition, ...distractors]);
  setStudyProgress(index + 1, limit);
  $("#study-stage").innerHTML = `
    <div class="quiz-question">
      <span class="question-label eyebrow">Vyber správnou definici</span>
      <h2>${escapeHtml(card.term)}</h2>
      <div class="answer-list">${answers.map((answer) => `<button class="answer-option" type="button" data-answer="${escapeAttribute(answer)}">${escapeHtml(answer)}</button>`).join("")}</div>
    </div>`;
  $$(".answer-option").forEach((button) => button.addEventListener("click", () => answerQuiz(button, card.definition, limit)));
}

function answerQuiz(button, correctAnswer, limit) {
  if (state.study.answered) return;
  state.study.answered = true;
  const isCorrect = button.dataset.answer === correctAnswer;
  if (isCorrect) state.study.correct += 1;
  $$(".answer-option").forEach((option) => {
    option.disabled = true;
    if (option.dataset.answer === correctAnswer) option.classList.add("correct");
  });
  if (!isCorrect) button.classList.add("incorrect");
  const next = document.createElement("button");
  next.className = "button button-primary button-wide";
  next.textContent = state.study.index === limit - 1 ? "Zobrazit výsledky" : "Další otázka";
  next.addEventListener("click", () => {
    state.study.index += 1;
    state.study.answered = false;
    recordActivity(state.currentSet.id, (state.study.index / limit) * 100);
    renderQuiz();
  });
  $(".quiz-question").append(next);
}

function renderMemory() {
  const pairs = shuffle([...state.currentSet.cards]).slice(0, Math.min(6, state.currentSet.cards.length));
  const deck = shuffle(pairs.flatMap((card, index) => [
    { pair: index, text: card.term, kind: "term" },
    { pair: index, text: card.definition, kind: "definition" },
  ])).map((card, index) => ({ ...card, id: index }));
  state.study.memory = { deck, open: [], matched: new Set(), moves: 0, seconds: 0, locked: false };
  setStudyProgress(0, pairs.length);
  $("#study-stage").innerHTML = `<div class="memory-meta"><span id="memory-moves">0 tahů</span><span id="memory-time">0:00</span></div><div class="memory-grid">${deck.map((card) => `<button class="memory-card" type="button" data-id="${card.id}">${escapeHtml(card.text)}</button>`).join("")}</div>`;
  $$(".memory-card").forEach((button) => button.addEventListener("click", () => flipMemoryCard(Number(button.dataset.id))));
  state.memoryTimer = setInterval(() => {
    state.study.memory.seconds += 1;
    const time = $("#memory-time");
    if (time) time.textContent = formatTime(state.study.memory.seconds);
  }, 1000);
}

function flipMemoryCard(id) {
  const memory = state.study.memory;
  if (memory.locked || memory.open.includes(id) || memory.matched.has(memory.deck[id].pair)) return;
  memory.open.push(id);
  $(`.memory-card[data-id="${id}"]`).classList.add("revealed");
  if (memory.open.length < 2) return;
  memory.moves += 1;
  $("#memory-moves").textContent = czechCount(memory.moves, "tah", "tahy", "tahů");
  const [firstId, secondId] = memory.open;
  const first = memory.deck[firstId];
  const second = memory.deck[secondId];
  const match = first.pair === second.pair && first.kind !== second.kind;
  if (match) {
    memory.matched.add(first.pair);
    memory.open = [];
    $(`.memory-card[data-id="${firstId}"]`).classList.add("matched");
    $(`.memory-card[data-id="${secondId}"]`).classList.add("matched");
    setStudyProgress(memory.matched.size, memory.deck.length / 2);
    if (memory.matched.size === memory.deck.length / 2) {
      clearInterval(state.memoryTimer);
      recordActivity(state.currentSet.id, 100);
      setTimeout(() => renderResults("Pexeso je hotové", memory.deck.length / 2, memory.deck.length / 2, `${czechCount(memory.moves, "tah", "tahy", "tahů")} · ${formatTime(memory.seconds)}`), 450);
    }
  } else {
    memory.locked = true;
    setTimeout(() => {
      $(`.memory-card[data-id="${firstId}"]`)?.classList.remove("revealed");
      $(`.memory-card[data-id="${secondId}"]`)?.classList.remove("revealed");
      memory.open = [];
      memory.locked = false;
    }, 750);
  }
}

function renderResults(title, correct, total, note = "") {
  setStudyProgress(total, total);
  const percent = Math.round((correct / total) * 100);
  recordActivity(state.currentSet.id, 100);
  $("#study-stage").innerHTML = `
    <div class="result-card">
      <div class="result-score">${percent}%</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${note || `${correct} z ${total} správně`}</p>
      <div class="learn-actions"><button class="button button-light" id="result-back" type="button">Zpět k sadě</button><button class="button button-primary" id="result-again" type="button">Ještě jednou</button></div>
    </div>`;
  $("#result-back").addEventListener("click", closeStudy);
  $("#result-again").addEventListener("click", () => startMode(state.study.mode));
}

function renderWorksheets(activeCategory = "Vše") {
  const categories = ["Vše", ...new Set(state.worksheets.map((item) => item.category))];
  $("#worksheet-filters").innerHTML = categories.map((category) => `<button class="filter-chip ${category === activeCategory ? "active" : ""}" type="button" data-category="${escapeAttribute(category)}">${escapeHtml(category)}</button>`).join("");
  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => renderWorksheets(button.dataset.category)));
  const worksheets = state.worksheets.filter((item) => activeCategory === "Vše" || item.category === activeCategory);
  $("#worksheet-grid").innerHTML = worksheets.map((item) => {
    const extension = item.file.split(".").pop().toUpperCase();
    const preview = item.thumbnail ? `<img src="worksheets/${escapeAttribute(item.thumbnail)}" alt="" />` : escapeHtml(extension);
    return `<article class="worksheet-card"><div class="worksheet-preview">${preview}</div><div class="worksheet-card-body"><span class="set-subject">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="worksheet-card-actions"><a class="button button-light" href="worksheets/${escapeAttribute(item.file)}" target="_blank" rel="noopener">Otevřít</a><a class="button button-secondary" href="worksheets/${escapeAttribute(item.file)}" download>Stáhnout</a></div></div></article>`;
  }).join("");
  $("#empty-worksheets").hidden = worksheets.length > 0;
}

function renderAdmin() {
  const select = $("#admin-set-select");
  select.innerHTML = state.sets.map((set) => `<option value="${escapeAttribute(set.id)}">${escapeHtml(set.title)}${set.isDraft ? " (koncept)" : ""}</option>`).join("");
  const chosenId = state.currentSet?.id && state.sets.some((set) => set.id === state.currentSet.id) ? state.currentSet.id : state.sets[0]?.id;
  if (chosenId) {
    select.value = chosenId;
    populateAdminEditor(chosenId);
  }
}

function populateAdminEditor(id) {
  const set = state.sets.find((item) => item.id === id);
  if (!set) return;
  $("#admin-title").value = set.title;
  $("#admin-subject").value = set.subject;
  $("#admin-description").value = set.description;
  $("#admin-color").value = set.color;
  $("#admin-filename").value = set.file;
  $("#admin-card-list").innerHTML = "";
  set.cards.forEach((card) => addAdminCard(card.term, card.definition));
  $("#admin-status").textContent = set.isDraft ? "Zobrazuje se místní koncept." : "";
}

function addAdminCard(term = "", definition = "") {
  const row = document.createElement("div");
  row.className = "admin-card-row";
  row.innerHTML = `<input class="admin-term" type="text" value="${escapeAttribute(term)}" placeholder="Pojem" aria-label="Pojem" /><input class="admin-definition" type="text" value="${escapeAttribute(definition)}" placeholder="Definice" aria-label="Definice" /><button class="remove-card" type="button" aria-label="Odstranit kartičku">×</button>`;
  $(".remove-card", row).addEventListener("click", () => row.remove());
  $("#admin-card-list").append(row);
  if (!term) $(".admin-term", row).focus();
}

function collectAdminSet() {
  const selectedId = $("#admin-set-select").value;
  const existing = state.sets.find((set) => set.id === selectedId);
  const filename = sanitizeFilename($("#admin-filename").value || `${slugify($("#admin-title").value)}.sql`);
  return {
    id: existing?.id || slugify($("#admin-title").value),
    file: filename,
    title: $("#admin-title").value.trim() || "Sada bez názvu",
    subject: $("#admin-subject").value.trim() || "Obecné",
    description: $("#admin-description").value.trim(),
    color: $("#admin-color").value,
    cards: $$(".admin-card-row").map((row) => ({
      term: $(".admin-term", row).value.trim(),
      definition: $(".admin-definition", row).value.trim(),
    })).filter((card) => card.term && card.definition),
    isDraft: true,
  };
}

function createNewSetDraft() {
  let id = `new-set-${Date.now()}`;
  const set = { id, file: "nova-studijni-sada.sql", title: "Nová studijní sada", subject: "Obecné", description: "Přidej krátký popis.", color: "violet", cards: [{ term: "První pojem", definition: "První definice" }], isDraft: true };
  state.sets.push(set);
  state.setIndex.push({ id, file: set.file });
  const select = $("#admin-set-select");
  const option = new Option(`${set.title} (koncept)`, id);
  select.add(option);
  select.value = id;
  populateAdminEditor(id);
  $("#admin-status").textContent = "Nový koncept je připravený. Přejmenuj ho, přidej kartičky a potom ho ulož nebo stáhni.";
}

function saveAdminDraft() {
  const edited = collectAdminSet();
  if (!edited.cards.length) {
    $("#admin-status").textContent = "Přidej alespoň jeden kompletní pojem a definici.";
    return;
  }
  const index = state.sets.findIndex((set) => set.id === edited.id);
  if (index >= 0) state.sets[index] = edited;
  else state.sets.push(edited);
  const indexEntry = state.setIndex.find((entry) => entry.id === edited.id);
  if (indexEntry) indexEntry.file = edited.file;
  else state.setIndex.push({ id: edited.id, file: edited.file });
  localStorage.setItem(`kpz:draft:${edited.id}`, serializeStudySet(edited));
  $("#admin-status").textContent = "Koncept je uložený v tomto prohlížeči.";
  renderAdmin();
  $("#admin-set-select").value = edited.id;
  populateAdminEditor(edited.id);
}

function downloadAdminSql() {
  const edited = collectAdminSet();
  if (!edited.cards.length) {
    $("#admin-status").textContent = "Před stažením přidej alespoň jednu kompletní kartičku.";
    return;
  }
  downloadText(edited.file, serializeStudySet(edited), "text/sql");
  $("#admin-status").textContent = `Soubor ${edited.file} je stažený. Nahraď jím odpovídající soubor v data/sets/.`;
}

function downloadSetIndex() {
  const edited = collectAdminSet();
  const manifest = { sets: state.setIndex.map((entry) => entry.id === edited.id ? { id: edited.id, file: edited.file } : entry) };
  if (!manifest.sets.some((entry) => entry.id === edited.id)) manifest.sets.push({ id: edited.id, file: edited.file });
  downloadText("index.json", `${JSON.stringify(manifest, null, 2)}\n`, "application/json");
  $("#admin-status").textContent = "Soubor index.json je stažený. Při přidání nebo přejmenování sady jím nahraď data/sets/index.json.";
}

function downloadText(filename, content, type, delay = 0) {
  setTimeout(() => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, delay);
}

function parseStudySet(sql, fallbackId) {
  const metadata = {};
  for (const match of sql.matchAll(/^--\s*([\w-]+)\s*:\s*(.+)$/gm)) metadata[match[1].toLowerCase()] = match[2].trim();
  const valuesIndex = sql.search(/\bVALUES\b/i);
  const tuples = valuesIndex < 0 ? [] : parseSqlTuples(sql.slice(valuesIndex + 6));
  const cards = tuples
    .map((values) => ({ term: values[0] || "", definition: values[1] || "", hint: values[2] || "", image: values[3] || "" }))
    .filter((card) => card.term && card.definition);
  return {
    id: metadata.id || fallbackId,
    title: metadata.title || fallbackId,
    subject: metadata.subject || "Obecné",
    description: metadata.description || "",
    color: metadata.color || "violet",
    cards,
  };
}

function parseSqlTuples(source) {
  const tuples = [];
  let tuple = null;
  let value = "";
  let inString = false;
  let wasQuoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      if (char === "'" && next === "'") { value += "'"; i += 1; }
      else if (char === "'") inString = false;
      else value += char;
      continue;
    }
    if (char === "'") { inString = true; wasQuoted = true; continue; }
    if (char === "(" && tuple === null) { tuple = []; value = ""; wasQuoted = false; continue; }
    if (tuple === null) continue;
    if (char === ",") { tuple.push(cleanSqlValue(value, wasQuoted)); value = ""; wasQuoted = false; continue; }
    if (char === ")") { tuple.push(cleanSqlValue(value, wasQuoted)); tuples.push(tuple); tuple = null; value = ""; continue; }
    value += char;
  }
  return tuples;
}

function cleanSqlValue(value, quoted) {
  const clean = value.trim();
  if (!quoted && clean.toUpperCase() === "NULL") return "";
  return clean;
}

function serializeStudySet(set) {
  const lines = [
    `-- id: ${set.id}`,
    `-- title: ${set.title}`,
    `-- subject: ${set.subject}`,
    `-- description: ${set.description}`,
    `-- color: ${set.color}`,
    "",
    "INSERT INTO cards (term, definition, hint, image) VALUES",
  ];
  set.cards.forEach((card, index) => {
    const end = index === set.cards.length - 1 ? ";" : ",";
    lines.push(`  ('${sqlEscape(card.term)}', '${sqlEscape(card.definition)}', NULL, NULL)${end}`);
  });
  return `${lines.join("\n")}\n`;
}

function sqlEscape(value) { return String(value).replaceAll("'", "''"); }

function czechCount(count, one, few, many) {
  const absolute = Math.abs(count);
  const word = absolute === 1 ? one : absolute >= 2 && absolute <= 4 ? few : many;
  return `${count} ${word}`;
}

function recordActivity(setId, progress) {
  const activity = getActivity();
  activity.lastSet = setId;
  activity.progress ||= {};
  if (progress !== null) activity.progress[setId] = Math.round(progress);
  localStorage.setItem("kpz:activity", JSON.stringify(activity));
}

function getActivity() {
  try { return JSON.parse(localStorage.getItem("kpz:activity")) || {}; }
  catch { return {}; }
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function normalizeAnswer(value) {
  return String(value).trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function slugify(value) { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "studijni-sada"; }
function sanitizeFilename(value) { const base = String(value).trim().replace(/[^a-zA-Z0-9._-]/g, "-"); return base.toLowerCase().endsWith(".sql") ? base : `${base}.sql`; }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }
