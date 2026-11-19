(() => {
  "use strict";

  const WIDTH = 1000;
  const HEIGHT = 500;
  const DRAFT_KEY = "kpz:blind-map-draft";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

  const mapState = {
    initialized: false,
    loadPromise: null,
    sourceData: null,
    data: null,
    land: null,
    role: "student",
    view: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    pointer: null,
    editorActive: false,
    editorTool: "pan",
    editorItemId: null,
    draftPoints: [],
    round: [],
    results: [],
    roundIndex: 0,
    trainerStatus: "setup",
  };

  window.KPZMap = { show: showMapView };

  function showMapView(role) {
    mapState.role = role === "admin" ? "admin" : "student";
    initialize();
    q("#map-editor-toggle").hidden = mapState.role !== "admin";
    if (mapState.role !== "admin" && mapState.editorActive) closeEditor();
    return loadMapData();
  }

  function initialize() {
    if (mapState.initialized) return;
    mapState.initialized = true;
    bindControls();
    drawGraticule();
    applyViewBox();
  }

  async function loadMapData() {
    if (mapState.loadPromise) return mapState.loadPromise;
    mapState.loadPromise = Promise.all([
      fetch("data/maps/world-assignment.json", { cache: "no-store" }).then(checkResponse).then((response) => response.json()),
      fetch("data/maps/ne_110m_land.geojson", { cache: "force-cache" }).then(checkResponse).then((response) => response.json()),
    ]).then(([assignment, land]) => {
      mapState.sourceData = clone(assignment);
      mapState.data = readDraft() || clone(assignment);
      mapState.land = land;
      renderLand();
      populateCategoryControls();
      selectEditorItem(mapState.data.items[0]?.id || null);
      q("#blind-map").dataset.ready = "true";
      q("#map-canvas-hint").textContent = "Klikni na správné místo. Mapu posuneš tažením a přiblížíš kolečkem nebo tlačítky.";
    }).catch((error) => {
      console.error(error);
      q("#map-canvas-hint").textContent = "Mapu se nepodařilo načíst. Obnov stránku a zkus to znovu.";
      throw error;
    });
    return mapState.loadPromise;
  }

  function checkResponse(response) {
    if (!response.ok) throw new Error(`Map data request failed: ${response.url}`);
    return response;
  }

  function bindControls() {
    q("#map-start").addEventListener("click", () => startRound());
    q("#map-skip").addEventListener("click", () => submitMapAnswer(null));
    q("#map-next").addEventListener("click", nextQuestion);
    q("#map-new-round").addEventListener("click", resetTrainer);
    q("#map-retry-errors").addEventListener("click", retryErrors);
    q("#map-editor-toggle").addEventListener("click", () => mapState.editorActive ? closeEditor() : openEditor());
    q("#map-editor-close").addEventListener("click", closeEditor);
    q("#map-zoom-in").addEventListener("click", () => zoomMap(1.65));
    q("#map-zoom-out").addEventListener("click", () => zoomMap(1 / 1.65));
    q("#map-zoom-reset").addEventListener("click", resetMapView);
    q("#map-item-search").addEventListener("input", renderEditorList);
    q("#map-item-new").addEventListener("click", createMapItem);
    q("#map-item-apply").addEventListener("click", applyEditorFields);
    q("#map-target-clear").addEventListener("click", clearSelectedTarget);
    q("#map-item-delete").addEventListener("click", deleteSelectedItem);
    q("#map-finish-shape").addEventListener("click", finishEditorShape);
    q("#map-draft-save").addEventListener("click", saveMapDraft);
    q("#map-json-download").addEventListener("click", downloadMapJson);
    q("#map-draft-reset").addEventListener("click", resetMapDraft);
    qa("[data-map-tool]").forEach((button) => button.addEventListener("click", () => setEditorTool(button.dataset.mapTool)));

    const svg = q("#blind-map");
    svg.addEventListener("pointerdown", beginPointer);
    svg.addEventListener("pointermove", movePointer);
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", cancelPointer);
    svg.addEventListener("wheel", handleWheel, { passive: false });
  }

  function drawGraticule() {
    const layer = q("#map-grid-layer");
    layer.textContent = "";
    let path = "";
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = lonToX(lon);
      path += `M${x} 0V${HEIGHT}`;
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = latToY(lat);
      path += `M0 ${y}H${WIDTH}`;
    }
    layer.append(svgElement("path", { d: path }));
  }

  function renderLand() {
    const layer = q("#map-land-layer");
    layer.textContent = "";
    for (const feature of mapState.land.features || []) {
      const path = geometryPath(feature.geometry);
      if (path) layer.append(svgElement("path", { d: path }));
    }
  }

  function geometryPath(geometry) {
    if (!geometry) return "";
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.map((polygon) => polygon.map((ring) => ring.map(([lon, lat], index) => `${index ? "L" : "M"}${lonToX(lon).toFixed(2)} ${latToY(lat).toFixed(2)}`).join("") + "Z").join("")).join("");
  }

  function populateCategoryControls() {
    const allOption = `<option value="all">Všechny kategorie (${mapState.data.items.filter((item) => item.target).length})</option>`;
    const options = mapState.data.categories.map((category) => {
      const count = mapState.data.items.filter((item) => item.category === category.id && item.target).length;
      return `<option value="${escapeAttribute(category.id)}">${escapeHtml(category.label)} (${count})</option>`;
    }).join("");
    q("#map-category").innerHTML = allOption + options;
    q("#map-item-category").innerHTML = mapState.data.categories.map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHtml(category.label)}</option>`).join("");
    renderEditorList();
  }

  function startRound(forcedItems = null) {
    const available = forcedItems || filteredItems();
    if (!available.length) return;
    const requested = q("#map-round-size").value;
    const limit = requested === "all" ? available.length : Math.min(Number(requested), available.length);
    mapState.round = forcedItems ? [...forcedItems] : shuffle([...available]).slice(0, limit);
    mapState.results = [];
    mapState.roundIndex = 0;
    mapState.trainerStatus = "asking";
    q("#map-setup").hidden = true;
    q("#map-results").hidden = true;
    q("#map-question").hidden = false;
    askQuestion();
  }

  function filteredItems() {
    const category = q("#map-category").value;
    return mapState.data.items.filter((item) => item.target && (category === "all" || item.category === category));
  }

  function askQuestion() {
    clearMapAnswers();
    resetMapView();
    mapState.trainerStatus = "asking";
    const item = mapState.round[mapState.roundIndex];
    q("#map-question-category").textContent = categoryLabel(item.category);
    q("#map-question-title").textContent = item.title;
    q("#map-score").textContent = `${mapState.roundIndex + 1} / ${mapState.round.length} · správně ${mapState.results.filter((result) => result.correct).length}`;
    q("#map-feedback").hidden = true;
    q("#map-skip").disabled = false;
    q("#map-canvas-hint").textContent = "Klikni na správné místo. Mapu posuneš tažením.";
  }

  function submitMapAnswer(coordinates) {
    if (mapState.trainerStatus !== "asking") return;
    const item = mapState.round[mapState.roundIndex];
    const correct = coordinates ? targetContains(item.target, coordinates) : false;
    mapState.results.push({ item, correct });
    mapState.trainerStatus = "shown";
    q("#map-skip").disabled = true;
    revealTarget(item.target);
    if (coordinates) renderAnswerMarker(coordinates, correct);
    focusTarget(item.target);

    const feedback = q("#map-feedback");
    feedback.className = `map-feedback ${correct ? "correct" : "incorrect"}`;
    q("#map-feedback-title").textContent = correct ? "Správně" : coordinates ? "Vedle" : "Tady to je";
    q("#map-feedback-copy").textContent = correct ? `${item.title} je ve vybrané oblasti.` : `Správná oblast pro ${item.title} je zvýrazněná.`;
    q("#map-next").textContent = mapState.roundIndex === mapState.round.length - 1 ? "Zobrazit výsledek" : "Další místo";
    feedback.hidden = false;
  }

  function nextQuestion() {
    if (mapState.trainerStatus !== "shown") return;
    mapState.roundIndex += 1;
    if (mapState.roundIndex >= mapState.round.length) finishRound();
    else askQuestion();
  }

  function finishRound() {
    mapState.trainerStatus = "done";
    q("#map-question").hidden = true;
    q("#map-feedback").hidden = true;
    clearMapAnswers();
    resetMapView();
    const correct = mapState.results.filter((result) => result.correct).length;
    const errors = mapState.results.length - correct;
    q("#map-results-title").textContent = `${correct} z ${mapState.results.length} správně`;
    q("#map-results-copy").textContent = errors ? "Chyby můžeš zopakovat hned, nebo spustit nový náhodný test." : "Bez chyby. Zkus další výběr míst.";
    q("#map-retry-errors").hidden = errors === 0;
    q("#map-retry-errors").textContent = `Zopakovat chyby (${errors})`;
    q("#map-results-list").innerHTML = mapState.results.map((result) => `<div class="map-result-row ${result.correct ? "correct" : "incorrect"}"><span>${escapeHtml(result.item.title)} <small>${escapeHtml(categoryLabel(result.item.category))}</small></span><span>${result.correct ? "Správně" : "Vedle"}</span></div>`).join("");
    q("#map-results").hidden = false;
  }

  function retryErrors() {
    const errors = mapState.results.filter((result) => !result.correct).map((result) => result.item);
    if (errors.length) startRound(shuffle(errors));
  }

  function resetTrainer() {
    mapState.trainerStatus = "setup";
    q("#map-setup").hidden = false;
    q("#map-question").hidden = true;
    q("#map-feedback").hidden = true;
    q("#map-results").hidden = true;
    clearMapAnswers();
    resetMapView();
  }

  function beginPointer(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const svg = q("#blind-map");
    try { svg.setPointerCapture(event.pointerId); } catch {}
    mapState.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  }

  function movePointer(event) {
    const pointer = mapState.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    if (!pointer.moved && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.moved = true;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (!pointer.moved) return;
    const rect = q("#blind-map").getBoundingClientRect();
    mapState.view.x -= dx * mapState.view.width / Math.max(rect.width, 1);
    mapState.view.y -= dy * mapState.view.height / Math.max(rect.height, 1);
    clampView();
    applyViewBox();
    q("#blind-map").classList.add("is-panning");
  }

  function endPointer(event) {
    const pointer = mapState.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    try { q("#blind-map").releasePointerCapture(event.pointerId); } catch {}
    q("#blind-map").classList.remove("is-panning");
    mapState.pointer = null;
    if (!pointer.moved) handleMapTap(event.clientX, event.clientY);
  }

  function cancelPointer() {
    mapState.pointer = null;
    q("#blind-map").classList.remove("is-panning");
  }

  function handleMapTap(clientX, clientY) {
    const point = screenToMap(clientX, clientY);
    const coordinates = [xToLon(point.x), yToLat(point.y)];
    if (mapState.editorActive) handleEditorMapTap(coordinates);
    else submitMapAnswer(coordinates);
  }

  function handleWheel(event) {
    event.preventDefault();
    const point = screenToMap(event.clientX, event.clientY);
    zoomMap(Math.exp(-event.deltaY * 0.0015), point);
  }

  function zoomMap(factor, anchor = null) {
    const center = anchor || { x: mapState.view.x + mapState.view.width / 2, y: mapState.view.y + mapState.view.height / 2 };
    const old = { ...mapState.view };
    const width = Math.max(90, Math.min(WIDTH, old.width / factor));
    const height = width / 2;
    const rx = (center.x - old.x) / old.width;
    const ry = (center.y - old.y) / old.height;
    mapState.view = { x: center.x - width * rx, y: center.y - height * ry, width, height };
    clampView();
    applyViewBox();
  }

  function resetMapView() {
    mapState.view = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
    applyViewBox();
  }

  function clampView() {
    mapState.view.x = Math.max(0, Math.min(WIDTH - mapState.view.width, mapState.view.x));
    mapState.view.y = Math.max(0, Math.min(HEIGHT - mapState.view.height, mapState.view.y));
  }

  function applyViewBox() {
    const view = mapState.view;
    q("#blind-map").setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
  }

  function focusTarget(target) {
    const bounds = targetBounds(target);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    let width = Math.max(120, (bounds.maxX - bounds.minX) * 2.2);
    width = Math.min(WIDTH, width);
    const height = width / 2;
    mapState.view = { x: centerX - width / 2, y: centerY - height / 2, width, height };
    clampView();
    applyViewBox();
  }

  function targetBounds(target) {
    if (target.type === "point") {
      const [lon, lat] = target.coordinates;
      const center = lonLatToPoint([lon, lat]);
      const radiusY = Math.max(8, Number(target.radiusKm || 200) / 40);
      const radiusX = Math.min(160, radiusY / Math.max(.3, Math.cos(lat * Math.PI / 180)));
      return { minX: center.x - radiusX, maxX: center.x + radiusX, minY: center.y - radiusY, maxY: center.y + radiusY };
    }
    const points = target.coordinates.map(lonLatToPoint);
    return points.reduce((bounds, point) => ({ minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x), minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }

  function revealTarget(target) {
    const layer = q("#map-target-layer");
    layer.textContent = "";
    renderTarget(target, layer);
  }

  function renderTarget(target, layer, draft = false) {
    if (!target) return;
    const classPrefix = draft ? "draft" : "target";
    if (target.type === "point") {
      const [lon, lat] = target.coordinates;
      const point = lonLatToPoint(target.coordinates);
      const radiusY = Math.max(5, Number(target.radiusKm || 200) / 40);
      const radiusX = Math.min(180, radiusY / Math.max(.3, Math.cos(lat * Math.PI / 180)));
      layer.append(svgElement("ellipse", { class: `${classPrefix}-${draft ? "shape" : "point"}`, cx: point.x, cy: point.y, rx: radiusX, ry: radiusY }));
      return;
    }
    const path = target.coordinates.map((coordinate, index) => {
      const point = lonLatToPoint(coordinate);
      return `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }).join("") + (target.type === "polygon" ? "Z" : "");
    const attributes = { class: `${classPrefix}-${draft ? "shape" : target.type}`, d: path };
    if (!draft && target.type === "line") attributes["stroke-width"] = Math.max(8, Number(target.radiusKm || 150) / 20);
    layer.append(svgElement("path", attributes));
  }

  function renderAnswerMarker(coordinates, correct) {
    const layer = q("#map-marker-layer");
    const point = lonLatToPoint(coordinates);
    layer.append(svgElement("circle", { class: `map-marker ${correct ? "correct" : "incorrect"}`, cx: point.x, cy: point.y, r: 6 }));
  }

  function clearMapAnswers() {
    q("#map-target-layer").textContent = "";
    q("#map-marker-layer").textContent = "";
    if (!mapState.editorActive) q("#map-draft-layer").textContent = "";
  }

  function targetContains(target, coordinate) {
    if (!target) return false;
    if (target.type === "point") return haversineKm(coordinate, target.coordinates) <= Number(target.radiusKm || 200);
    if (target.type === "polygon" && pointInPolygon(coordinate, target.coordinates)) return true;
    return distanceToPolylineKm(coordinate, target.coordinates, target.type === "polygon") <= Number(target.radiusKm || 120);
  }

  function haversineKm([lon1, lat1], [lon2, lat2]) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function distanceToPolylineKm(point, coordinates, closed = false) {
    if (coordinates.length < 2) return Infinity;
    const segments = closed ? coordinates.length : coordinates.length - 1;
    let nearest = Infinity;
    for (let index = 0; index < segments; index += 1) {
      nearest = Math.min(nearest, distanceToSegmentKm(point, coordinates[index], coordinates[(index + 1) % coordinates.length]));
    }
    return nearest;
  }

  function distanceToSegmentKm([lon, lat], [lon1, lat1], [lon2, lat2]) {
    const cos = Math.cos(lat * Math.PI / 180);
    const px = lon * cos;
    const ax = lon1 * cos;
    const bx = lon2 * cos;
    const abx = bx - ax;
    const aby = lat2 - lat1;
    const length = abx * abx + aby * aby;
    const t = length ? Math.max(0, Math.min(1, ((px - ax) * abx + (lat - lat1) * aby) / length)) : 0;
    return Math.hypot(px - (ax + abx * t), lat - (lat1 + aby * t)) * 111.2;
  }

  function pointInPolygon([lon, lat], polygon) {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const [lonA, latA] = polygon[index];
      const [lonB, latB] = polygon[previous];
      if ((latA > lat) !== (latB > lat) && lon < (lonB - lonA) * (lat - latA) / (latB - latA) + lonA) inside = !inside;
    }
    return inside;
  }

  function openEditor() {
    if (mapState.role !== "admin") return;
    mapState.editorActive = true;
    mapState.trainerStatus = "setup";
    q("#map-editor").hidden = false;
    q(".map-canvas-shell").before(q("#map-editor"));
    q("#map-student-controls").hidden = true;
    q("#map-feedback").hidden = true;
    q("#map-results").hidden = true;
    q("#map-editor-toggle").textContent = "Spustit trenažér";
    q("#map-canvas-hint").textContent = "Editor je aktivní. Vyber pojem a nástroj pod mapou.";
    setEditorTool("pan");
    renderEditorList();
    renderSelectedTarget();
  }

  function closeEditor() {
    mapState.editorActive = false;
    mapState.draftPoints = [];
    q("#map-editor").hidden = true;
    q("#map-results").after(q("#map-editor"));
    q("#map-student-controls").hidden = false;
    q("#map-editor-toggle").textContent = "Upravit mapu";
    q("#map-draft-layer").textContent = "";
    resetTrainer();
  }

  function renderEditorList() {
    if (!mapState.data) return;
    const queryText = normalize(q("#map-item-search").value);
    const items = [...mapState.data.items].sort((first, second) => first.title.localeCompare(second.title, "cs")).filter((item) => normalize(item.title).includes(queryText));
    q("#map-item-list").innerHTML = items.map((item) => `<button class="${item.id === mapState.editorItemId ? "active" : ""}" type="button" data-map-item="${escapeAttribute(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(categoryLabel(item.category))}${item.target ? "" : " · bez geometrie"}</small></button>`).join("");
    qa("[data-map-item]").forEach((button) => button.addEventListener("click", () => selectEditorItem(button.dataset.mapItem)));
  }

  function selectEditorItem(id) {
    if (!mapState.data) return;
    const item = mapState.data.items.find((candidate) => candidate.id === id);
    mapState.editorItemId = item?.id || null;
    if (!item) return;
    q("#map-item-title").value = item.title;
    q("#map-item-category").value = item.category;
    q("#map-item-radius").value = Number(item.target?.radiusKm || 250);
    mapState.draftPoints = [];
    renderEditorList();
    renderSelectedTarget();
  }

  function selectedItem() {
    return mapState.data?.items.find((item) => item.id === mapState.editorItemId) || null;
  }

  function applyEditorFields() {
    const item = selectedItem();
    if (!item) return;
    item.title = q("#map-item-title").value.trim() || "Pojem bez názvu";
    item.category = q("#map-item-category").value;
    if (item.target) item.target.radiusKm = clampNumber(q("#map-item-radius").value, 10, 3000, 250);
    setEditorStatus("Údaje jsou použité v konceptu. Nezapomeň koncept uložit nebo stáhnout JSON.");
    populateCategoryControls();
    selectEditorItem(item.id);
  }

  function setEditorTool(tool) {
    mapState.editorTool = tool;
    mapState.draftPoints = [];
    qa("[data-map-tool]").forEach((button) => button.classList.toggle("active", button.dataset.mapTool === tool));
    q("#map-finish-shape").hidden = tool !== "line" && tool !== "polygon";
    q("#map-editor-instruction").textContent = tool === "point" ? "Klikni na střed cílové oblasti." : tool === "line" ? "Klikáním přidávej body linie a potom zvol Dokončit tvar." : tool === "polygon" ? "Klikáním obkresli oblast a potom zvol Dokončit tvar." : "Mapu můžeš posunout tažením nebo přiblížit.";
    renderSelectedTarget();
  }

  function handleEditorMapTap(coordinates) {
    const item = selectedItem();
    if (!item || mapState.editorTool === "pan") return;
    const radiusKm = clampNumber(q("#map-item-radius").value, 10, 3000, 250);
    if (mapState.editorTool === "point") {
      item.target = { type: "point", coordinates: roundCoordinate(coordinates), radiusKm };
      renderSelectedTarget();
      setEditorStatus("Bod byl nastaven.");
      return;
    }
    mapState.draftPoints.push(roundCoordinate(coordinates));
    renderSelectedTarget();
    setEditorStatus(`${mapState.draftPoints.length} vrcholů. Přidej další nebo dokonči tvar.`);
  }

  function finishEditorShape() {
    const item = selectedItem();
    const minimum = mapState.editorTool === "polygon" ? 3 : 2;
    if (!item || mapState.draftPoints.length < minimum) {
      setEditorStatus(`Tvar potřebuje alespoň ${minimum} body.`);
      return;
    }
    item.target = { type: mapState.editorTool, coordinates: [...mapState.draftPoints], radiusKm: clampNumber(q("#map-item-radius").value, 10, 3000, 250) };
    mapState.draftPoints = [];
    renderSelectedTarget();
    setEditorStatus("Tvar byl dokončen.");
  }

  function renderSelectedTarget() {
    const item = selectedItem();
    const targetLayer = q("#map-target-layer");
    const draftLayer = q("#map-draft-layer");
    targetLayer.textContent = "";
    draftLayer.textContent = "";
    if (item?.target) renderTarget(item.target, targetLayer);
    if (mapState.draftPoints.length) {
      renderTarget({ type: mapState.editorTool, coordinates: mapState.draftPoints, radiusKm: Number(q("#map-item-radius").value || 250) }, draftLayer, true);
      for (const coordinate of mapState.draftPoints) {
        const point = lonLatToPoint(coordinate);
        draftLayer.append(svgElement("circle", { class: "draft-node", cx: point.x, cy: point.y, r: 4 }));
      }
    }
  }

  function clearSelectedTarget() {
    const item = selectedItem();
    if (!item) return;
    item.target = null;
    mapState.draftPoints = [];
    renderSelectedTarget();
    renderEditorList();
    setEditorStatus("Geometrie byla odstraněna. Před stažením JSON nakresli novou.");
  }

  function createMapItem() {
    const base = "novy-pojem";
    let index = 1;
    let id = base;
    while (mapState.data.items.some((item) => item.id === id)) id = `${base}-${++index}`;
    const category = mapState.data.categories[0]?.id || "other";
    mapState.data.items.push({ id, title: "Nový pojem", category, target: null });
    selectEditorItem(id);
    setEditorTool("point");
    setEditorStatus("Nový pojem je připravený. Doplň název a klikni na mapu.");
  }

  function deleteSelectedItem() {
    const item = selectedItem();
    if (!item || !window.confirm(`Opravdu smazat pojem „${item.title}“?`)) return;
    mapState.data.items = mapState.data.items.filter((candidate) => candidate.id !== item.id);
    selectEditorItem(mapState.data.items[0]?.id || null);
    populateCategoryControls();
    setEditorStatus("Pojem byl odstraněn z konceptu.");
  }

  function saveMapDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(mapState.data));
      setEditorStatus("Koncept mapy je uložený v tomto prohlížeči.");
    } catch {
      setEditorStatus("Koncept se nepodařilo uložit.");
    }
  }

  function downloadMapJson() {
    const missing = mapState.data.items.filter((item) => !item.target);
    if (missing.length) {
      setEditorStatus(`JSON nelze stáhnout: ${missing.length} pojmů nemá geometrii.`);
      return;
    }
    const blob = new Blob([`${JSON.stringify(mapState.data, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = "world-assignment.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setEditorStatus("JSON je stažený. Nahraď jím data/maps/world-assignment.json.");
  }

  function resetMapDraft() {
    if (!window.confirm("Vrátit publikovaná data a zahodit lokální koncept mapy?")) return;
    localStorage.removeItem(DRAFT_KEY);
    mapState.data = clone(mapState.sourceData);
    populateCategoryControls();
    selectEditorItem(mapState.data.items[0]?.id || null);
    setEditorStatus("Editor používá znovu publikovaná data.");
  }

  function readDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      return draft?.items?.length && draft?.categories?.length ? draft : null;
    } catch {
      return null;
    }
  }

  function setEditorStatus(message) {
    q("#map-editor-status").textContent = message;
  }

  function categoryLabel(id) {
    return mapState.data?.categories.find((category) => category.id === id)?.label || id;
  }

  function screenToMap(clientX, clientY) {
    const svg = q("#blind-map");
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function lonLatToPoint([lon, lat]) { return { x: lonToX(lon), y: latToY(lat) }; }
  function lonToX(lon) { return (Number(lon) + 180) / 360 * WIDTH; }
  function latToY(lat) { return (90 - Number(lat)) / 180 * HEIGHT; }
  function xToLon(x) { return x / WIDTH * 360 - 180; }
  function yToLat(y) { return 90 - y / HEIGHT * 180; }
  function roundCoordinate([lon, lat]) { return [Number(lon.toFixed(4)), Number(lat.toFixed(4))]; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clampNumber(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback; }
  function normalize(value) { return String(value || "").toLocaleLowerCase("cs").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function shuffle(items) { for (let index = items.length - 1; index > 0; index -= 1) { const other = Math.floor(Math.random() * (index + 1)); [items[index], items[other]] = [items[other], items[index]]; } return items; }
  function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character])); }
  function escapeAttribute(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }
  function svgElement(name, attributes = {}) { const element = document.createElementNS(SVG_NS, name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); return element; }
})();
