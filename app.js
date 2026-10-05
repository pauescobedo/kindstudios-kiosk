(() => {
  "use strict";
  const cfg = window.APP_CONFIG;
  const $ = (selector) => document.querySelector(selector);
  const screens = document.querySelectorAll(".screen");
  const date = new Date(); date.setHours(0, 0, 0, 0);
  let selectedDate = new Date(date);
  let selectedChecklistKey = null;
  let archivedChecklistStatus = null;
  let studioCalendar = null;
  let users = [];
  let usersReady = false;
  let usersLoadPromise = null;
  let currentUser = null;
  let scanner = null;
  let nfcController = null;
  // Trasera en móvil para QR; webcam habitual en ordenador. Se puede cambiar manualmente.
  const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const defaultScannerCamera = () => isMobileDevice ? "environment" : "user";
  let activeCamera = defaultScannerCamera();
  let currentPdfTask = null;
  let currentPdf = null;
  let pdfZoom = 1;
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let pinchPreviewZoom = 1;

  // No usar toISOString(): cerca de medianoche puede restar un día por usar UTC.
  const formatKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const scheduleStart = cfg.scheduleRange?.start || "2026-09-04";
  const scheduleEnd = cfg.scheduleRange?.end || "2027-06-18";
  const dateFromKey = (key) => new Date(`${key}T12:00:00`);
  const buildFridayKeys = (start, end) => {
    const result = [], cursor = dateFromKey(start), last = dateFromKey(end);
    while (cursor.getDay() !== 5) cursor.setDate(cursor.getDate() + 1);
    while (cursor <= last) { result.push(formatKey(cursor)); cursor.setDate(cursor.getDate() + 7); }
    return result;
  };
  let checklistKeys = buildFridayKeys(cfg.checklistRange?.start || scheduleStart, cfg.checklistRange?.end || scheduleEnd);
  if (formatKey(selectedDate) < scheduleStart) selectedDate = dateFromKey(scheduleStart);
  if (formatKey(selectedDate) > scheduleEnd) selectedDate = dateFromKey(scheduleEnd);
  selectedChecklistKey = checklistKeys.find((key) => key >= formatKey(date)) || checklistKeys.at(-1) || null;
  const getReferenceChecklistKey = (now = new Date()) => checklistKeys.find((key) => key >= formatKey(now)) || checklistKeys.at(-1) || null;
  const updateChecklistTodayLabel = (now = new Date()) => {
    const referenceKey = getReferenceChecklistKey(now);
    $("#checklist-today-button").textContent = referenceKey === formatKey(now) ? "Hoy" : "Próximo viernes";
  };
  const isPlaceholder = (url) => !url || /REEMPLAZA/i.test(url);
  // Codifica cada carpeta/archivo sin convertir las barras: así nombres con `?`, espacios o paréntesis funcionan bien.
  const pdfUrl = (path) => path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const setStatus = (element, message, type = "") => { element.textContent = message; element.className = `status ${type}`; };
  const showScreen = (id) => { screens.forEach((screen) => screen.classList.toggle("active", screen.id === `${id}-screen`)); window.scrollTo(0, 0); };
  const findUser = (code, method = "barcode") => users.find((user) => {
    const accessCode = method === "credentials" ? (user.credentialsCode || user.code) : user.code;
    return String(accessCode).trim().toLowerCase() === String(code).trim().toLowerCase();
  });

  async function loadUsers() {
    if (usersLoadPromise) return usersLoadPromise;
    usersLoadPromise = (async () => {
      try {
        const response = await fetch("users.json?v=20260917-1", { cache: "no-store" });
        if (!response.ok) throw new Error("No disponible");
        const data = await response.json();
        users = Array.isArray(data.users) ? data.users : [];
      } catch (_) {
        users = [];
      } finally {
        usersReady = true;
      }
    })();
    return usersLoadPromise;
  }

  async function loadPdfConfig() {
    try {
      const response = await fetch("pdf-config.json?v=20261005-2", { cache: "no-store" });
      if (!response.ok) throw new Error("No disponible");
      const data = await response.json();
      cfg.schedules = data.schedules || {};
      cfg.collections = data.collections || {};
      cfg.externalLinks = data.externalLinks || {};
      if ($("#schedule-screen").classList.contains("active")) renderSchedule();
      if ($("#collection-screen").classList.contains("active")) showCollection($("#collection-screen").dataset.collectionKey || "");
    } catch (_) {
      // Sin conexión se muestran los estados vacíos, sin bloquear la app.
      cfg.schedules ||= {};
      cfg.collections ||= {};
      cfg.externalLinks ||= {};
    }
  }

  const isTeachingDate = (key, calendar = studioCalendar) => {
    if (!calendar) return true;
    const inPeriod = (calendar.teachingPeriods || []).some((period) => key >= period.start && key <= period.end);
    return inPeriod && !(calendar.closedDates || []).includes(key);
  };

  function updateChecklistKeys() {
    checklistKeys = buildFridayKeys(cfg.checklistRange?.start || scheduleStart, cfg.checklistRange?.end || scheduleEnd).filter((key) => isTeachingDate(key));
    if (!checklistKeys.includes(selectedChecklistKey)) selectedChecklistKey = getReferenceChecklistKey();
  }

  async function loadStudioCalendar() {
    try {
      const response = await fetch("studio-calendar.json?v=20260915-1", { cache: "no-store" });
      if (!response.ok) return;
      studioCalendar = await response.json();
      updateChecklistKeys();
      updateStudioStatus();
      if ($("#checklist-screen").classList.contains("active")) renderChecklist();
    } catch (_) {
      // Sin conexión, se mantiene el rango básico de la aplicación.
    }
  }

  const minutesFromTime = (value) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };

  function nextStudioOpening(now, calendar) {
    const candidate = new Date(now); candidate.setHours(0, 0, 0, 0);
    for (let offset = 0; offset <= 380; offset += 1) {
      if (offset) candidate.setDate(candidate.getDate() + 1);
      const key = formatKey(candidate);
      if (candidate.getDay() !== 5 || !isTeachingDate(key, calendar)) continue;
      const reduced = (calendar.reducedDates || []).includes(key);
      // La próxima apertura es el inicio real de actividad, no el tramo previo de preparación.
      const opening = reduced ? calendar.reducedHours.start : calendar.regularHours.openStart;
      if (offset || now.getHours() * 60 + now.getMinutes() < minutesFromTime(opening)) return { key, opening };
    }
    return null;
  }

  function updateStudioStatus(now = new Date()) {
    const status = $("#studio-status");
    if (!status) return;
    const key = formatKey(now), calendar = studioCalendar;
    let state = "closed", message = "Estudio cerrado", detail = "";
    if (calendar && now.getDay() === 5 && isTeachingDate(key, calendar)) {
      const minute = now.getHours() * 60 + now.getMinutes();
      if ((calendar.reducedDates || []).includes(key)) {
        const reduced = calendar.reducedHours;
        if (minute >= minutesFromTime(reduced.start) && minute < minutesFromTime(reduced.end)) { state = "reduced"; message = "Horario reducido"; detail = `${reduced.start} – ${reduced.end}`; }
      } else {
        const hours = calendar.regularHours;
        if (minute >= minutesFromTime(hours.openStart) && minute < minutesFromTime(hours.openEnd)) { state = "open"; message = "Estudio abierto"; detail = `Horario actual · ${hours.openStart} – ${hours.openEnd}`; }
        else if (minute >= minutesFromTime(hours.preOpenStart) && minute < minutesFromTime(hours.openStart)) { state = "soon"; message = "A punto de abrir"; detail = `Abre a las ${hours.openStart}`; }
        else if (minute >= minutesFromTime(hours.openEnd) && minute < minutesFromTime(hours.closeEnd)) { state = "soon"; message = "A punto de cerrar"; detail = `Cierra a las ${hours.closeEnd}`; }
      }
    }
    if (state === "closed" && calendar) {
      const next = nextStudioOpening(now, calendar);
      if (next) {
        const daysUntil = Math.round((dateFromKey(next.key) - dateFromKey(formatKey(now))) / 86_400_000);
        const when = daysUntil === 0 ? "Hoy" : daysUntil === 1 ? "Mañana" : daysUntil <= 14 ? "Este viernes" : formatDateLabel(dateFromKey(next.key));
        detail = `Próxima apertura: ${when} a las ${next.opening}`;
      }
    }
    status.dataset.state = state;
    status.innerHTML = `<span class="studio-light" aria-hidden="true"></span><span><strong>${message}</strong>${detail ? `<small>${detail}</small>` : ""}</span>`;
  }

  async function loadArchivedChecklistStatus() {
    try {
      const response = await fetch("checklist-status.json?v=20261005-1", { cache: "no-store" });
      if (!response.ok) return;
      archivedChecklistStatus = await response.json();
      if ($("#checklist-screen").classList.contains("active")) renderChecklist();
    } catch (_) {
      // Sin conexión se conservan las marcas locales del dispositivo.
    }
  }

  function updateClock() {
    const now = new Date();
    const day = new Intl.DateTimeFormat("es-ES", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    }).format(now);
    const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(now);
    const titledDay = `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
    $("#current-date-time").textContent = `${titledDay} · ${time}`;
    updateGreeting(now);
    updateChecklistTodayLabel(now);
    updateStudioStatus(now);
  }

  function updateGreeting(now = new Date()) {
    if (!currentUser) return;
    const hour = now.getHours();
    const greeting = hour >= 6 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 20 ? "Buenas tardes" : "Buenas noches";
    $("#greeting").textContent = currentUser.profile === "Guest" ? `¡${greeting}!` : `¡${greeting}, ${currentUser.name}!`;
  }

  function login(user) {
    if (!user) return false;
    currentUser = user;
    const expires = Date.now() + cfg.sessionMinutes * 60 * 1000;
    sessionStorage.setItem("controlAccessSession", JSON.stringify({ user, expires }));
    updateGreeting();
    updateDashboard(user.profile || "Admin");
    $("#manual-dialog").close();
    $("#scanner-dialog").close();
    if ($("#nfc-dialog").open) $("#nfc-dialog").close();
    stopScanner();
    stopNfc();
    showScreen("dashboard");
    return true;
  }

  function updateDashboard(profile) {
    document.querySelectorAll("#dashboard-screen [data-profiles]").forEach((card) => {
      const allowed = card.dataset.profiles.split(" ").includes(profile);
      card.hidden = !allowed;
      card.classList.toggle("cnt-card", (card.dataset.wideProfiles || "").split(" ").includes(profile));
      card.style.order = profile === "Member" ? (card.dataset.orderMember || "0") : "0";
    });
  }

  async function validate(code, statusElement, username = null, method = "credentials") {
    if (!usersReady) {
      setStatus(statusElement, "Cargando usuarios…", "");
      await loadUsers();
    }
    const normalizedCode = String(code || "").trim();
    const normalizedUsername = username === null ? null : String(username).trim();
    if (method === "credentials" && !normalizedCode) {
      if (!normalizedUsername) {
        setStatus(statusElement, "Introduce tu usuario o código interno.", "error");
        return;
      }
      const internalCodeUser = findUser(normalizedUsername, "barcode");
      if (internalCodeUser && login(internalCodeUser)) { setStatus(statusElement, "Acceso concedido.", "success"); return; }
      setStatus(statusElement, "Código interno no reconocido.", "error");
      return;
    }
    const user = findUser(code, method);
    if (method === "credentials" && user?.username && !normalizedUsername) {
      setStatus(statusElement, "Introduce tu usuario.", "error");
      return;
    }
    const usernameMatches = username === null || (user && String(user.username || "").trim().toLowerCase() === String(normalizedUsername).toLowerCase());
    if (user && usernameMatches && login(user)) { setStatus(statusElement, "Acceso concedido.", "success"); return; }
    const messages = {
      barcode: "Código QR no reconocido.",
      nfc: "Tarjeta no reconocida.",
      credentials: "Usuario o clave de acceso incorrectos."
    };
    setStatus(statusElement, messages[method] || "Acceso incorrecto.", "error");
  }

  function formatDateLabel(value) {
    const dateParts = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(value);
    const part = (type) => dateParts.find((item) => item.type === type)?.value || "";
    const weekday = `${part("weekday").charAt(0).toUpperCase()}${part("weekday").slice(1)}`;
    const month = `${part("month").charAt(0).toUpperCase()}${part("month").slice(1)}`;
    return `${weekday}, ${part("day")} de ${month} de ${part("year")}`;
  }

  function renderSchedule() {
    const key = formatKey(selectedDate);
    const entry = cfg.schedules?.[key];
    const label = formatDateLabel(selectedDate);
    const card = $("#schedule-card");
    $("#today-button").classList.toggle("active", key === formatKey(date));
    $("#previous-day").disabled = key <= scheduleStart;
    $("#next-day").disabled = key >= scheduleEnd;
    if (!entry) {
      card.innerHTML = `<p class="schedule-date">${label}</p><h2>No hay horarios programados</h2><p>No hay horarios programados para esta fecha.</p>`;
      return;
    }
    const link = isPlaceholder(entry.pdf) ? "" : `<button class="schedule-open-button" type="button" data-pdf="${entry.pdf}" data-pdf-title="${entry.title || "Horario del día"}" data-pdf-back="schedule" data-pdf-theme="schedule">Ver horario<span>›</span></button>`;
    const note = entry.note ? `<p>${entry.note}</p>` : "";
    card.innerHTML = `<p class="schedule-date">${label}</p><h2>${entry.title || "Horario"}</h2>${note}${link}`;
  }

  function renderChecklist() {
    const card = $("#checklist-card");
    if (!selectedChecklistKey) {
      card.innerHTML = `<h2>No hay checklists programadas</h2>`;
      return;
    }
    const selected = new Date(`${selectedChecklistKey}T12:00:00`);
    const entry = cfg.checklists?.[selectedChecklistKey] || {};
    const referenceKey = getReferenceChecklistKey();
    $("#checklist-today-button").classList.toggle("active", selectedChecklistKey === referenceKey);
    const groupKeys = entry.groups || ["teatroGroup3", "teatroGroup4"];
    const groups = cfg.checklistGroups || {};
    card.innerHTML = `<p class="schedule-date">${formatDateLabel(selected)}</p><h2>Checklist de alumno/as</h2><div class="checklist-groups">${groupKeys.map((key) => {
      const group = groups[key]; if (!group) return "";
      const archived = selectedChecklistKey < formatKey(new Date());
      const state = getChecklistState(key, group.students, archived);
      const time = group.time ? `<small>${group.time}</small>` : "";
      return `<details class="checklist-disclosure"><summary><span class="disclosure-title">${group.title}${time}</span><span class="disclosure-chevron">›</span></summary><div class="checklist-student-list">${group.students.map((student, index) => `<label class="checklist-student"><input type="checkbox" data-checklist-student="${index}" data-checklist-group="${key}"${state[index] ? " checked" : ""}${archived ? " disabled" : ""}><span>${student}</span></label>`).join("")}</div></details>`;
    }).join("")}</div>`;
  }

  function moveChecklist(step) {
    if (!selectedChecklistKey) return;
    const index = checklistKeys.indexOf(selectedChecklistKey);
    selectedChecklistKey = checklistKeys[Math.max(0, Math.min(checklistKeys.length - 1, index + step))];
    renderChecklist();
  }

  function moveSchedule(step) {
    const candidate = new Date(selectedDate);
    candidate.setDate(candidate.getDate() + step);
    const key = formatKey(candidate);
    if (key < scheduleStart || key > scheduleEnd) return;
    selectedDate = candidate;
    renderSchedule();
  }

  function checklistStorageKey(groupKey, key = selectedChecklistKey) { return `kind-studios-checklist-${key}-${groupKey}`; }

  function getChecklistState(groupKey, students, archived) {
    const checkedStudents = archived && archivedChecklistStatus?.dates?.[selectedChecklistKey]?.[groupKey]?.checkedStudents;
    if (Array.isArray(checkedStudents)) {
      return Object.fromEntries(students.map((student, index) => [index, checkedStudents.includes(student)]));
    }
    try { return JSON.parse(localStorage.getItem(checklistStorageKey(groupKey)) || "{}"); } catch (_) { return {}; }
  }

  function saveChecklistState(groupKey) {
    if (!groupKey) return;
    const state = {};
    document.querySelectorAll(`[data-checklist-student][data-checklist-group="${groupKey}"]`).forEach((input) => { state[input.dataset.checklistStudent] = input.checked; });
    localStorage.setItem(checklistStorageKey(groupKey), JSON.stringify(state));
  }

  const checkinStorageKey = (userId, key) => `kind-studios-checkin-${key}-${userId}`;

  function isViceGroupDay(key) {
    return isTeachingDate(key) && Boolean(cfg.checklists?.[key]?.groups?.includes("viceGroup"));
  }

  function checkinGroupForUser(user) {
    if (user?.profile === "ViceKid") return "viceGroup";
    if (user?.profile === "Special") return "teatroGroup4";
    return null;
  }

  function isCheckinDay(user, key) {
    if (user?.profile === "ViceKid") return isViceGroupDay(key);
    return user?.profile === "Special" && dateFromKey(key).getDay() === 5 && isTeachingDate(key);
  }

  const normalizedName = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  function openCheckinDialog() {
    const dialog = $("#checkin-dialog"), key = formatKey(new Date()), title = $("#checkin-dialog h2"), text = $("#checkin-dialog-text"), confirm = $("#confirm-checkin");
    if (!checkinGroupForUser(currentUser)) return;
    const isSpecial = currentUser.profile === "Special";
    $("#checkin-dialog .eyebrow").textContent = isSpecial ? "TEATRO MUSICAL" : "VICE GROUP";
    if (!isCheckinDay(currentUser, key)) {
      title.textContent = isSpecial ? "Hoy no hay clase" : "Hoy no hay ensayo";
      text.textContent = isSpecial ? "El Check In estará disponible el próximo viernes lectivo de Teatro Musical." : "El Check In estará disponible el próximo viernes con Vice Group.";
      confirm.hidden = true;
      confirm.disabled = true;
    } else {
      const checkin = localStorage.getItem(checkinStorageKey(currentUser.id, key));
      title.textContent = checkin ? "Check In completado" : "¿Confirmar Check In?";
      text.textContent = checkin ? `Tu asistencia se confirmó a las ${checkin}.` : isSpecial ? "Confirma tu llegada a Teatro Musical Grupo 4." : "Confirma tu llegada al ensayo de Vice Group.";
      confirm.hidden = Boolean(checkin);
      confirm.disabled = Boolean(checkin);
    }
    dialog.showModal();
  }

  function confirmCheckin() {
    const groupKey = checkinGroupForUser(currentUser), key = formatKey(new Date());
    if (!groupKey || !isCheckinDay(currentUser, key)) return;
    const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    localStorage.setItem(checkinStorageKey(currentUser.id, key), time);
    const students = cfg.checklistGroups?.[groupKey]?.students || [];
    const currentName = normalizedName(currentUser.name);
    const studentIndex = students.findIndex((student) => {
      const name = normalizedName(student);
      return name === currentName || name.startsWith(`${currentName} `);
    });
    if (studentIndex >= 0) {
      let state = {};
      try { state = JSON.parse(localStorage.getItem(checklistStorageKey(groupKey, key)) || "{}"); } catch (_) {}
      state[studentIndex] = true;
      localStorage.setItem(checklistStorageKey(groupKey, key), JSON.stringify(state));
    }
    $("#checkin-dialog").close();
    if ($("#checklist-screen").classList.contains("active")) renderChecklist();
  }

  async function openDocument(pdf, title, backTarget = "dashboard", theme = "schedule") {
    currentPdf = { pdf, title, backTarget, theme };
    pdfZoom = 1;
    return renderDocument();
  }

  async function renderDocument() {
    if (!currentPdf) return;
    const { pdf, title, backTarget, theme } = currentPdf;
    $("#document-title").textContent = title;
    $("#document-screen [data-back]").dataset.back = backTarget;
    $("#document-screen").dataset.theme = theme;
    const download = $("#document-download");
    download.href = pdfUrl(pdf);
    download.download = pdf.split("/").at(-1) || "documento.pdf";
    showScreen("document");
    const viewer = $("#document-viewer");
    viewer.replaceChildren();
    viewer.textContent = "Cargando PDF…";
    try {
      if (!window.pdfjsLib) throw new Error("PDF.js no disponible");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      currentPdfTask?.destroy();
      currentPdfTask = window.pdfjsLib.getDocument(pdfUrl(pdf));
      const documentPdf = await currentPdfTask.promise;
      viewer.replaceChildren();
      for (let pageNumber = 1; pageNumber <= documentPdf.numPages; pageNumber += 1) {
        const page = await documentPdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        // Renderizado único al tamaño base: el zoom posterior es visual y no vuelve a cargar el PDF.
        const viewport = page.getViewport({ scale: (viewer.clientWidth - 28) / baseViewport.width });
        const pageWrap = document.createElement("div");
        pageWrap.className = "pdf-page";
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * devicePixelRatio);
        canvas.height = Math.ceil(viewport.height * devicePixelRatio);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        pageWrap.append(canvas);
        viewer.append(pageWrap);
        pageWrap.dataset.baseWidth = String(Math.ceil(viewport.width));
        pageWrap.dataset.baseHeight = String(Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] }).promise;
      }
    } catch (_) {
      viewer.replaceChildren();
      const fallback = document.createElement("iframe");
      fallback.className = "pdf-fallback";
      fallback.src = pdfUrl(pdf);
      fallback.title = title;
      viewer.append(fallback);
    }
  }

  function applyPdfZoom(zoom) {
    document.querySelectorAll("#document-viewer .pdf-page").forEach((page) => {
      const width = Number(page.dataset.baseWidth), height = Number(page.dataset.baseHeight);
      if (!width || !height) return;
      page.style.width = `${Math.round(width * zoom)}px`;
      page.style.height = `${Math.round(height * zoom)}px`;
      const canvas = page.querySelector("canvas");
      if (canvas) { canvas.style.width = "100%"; canvas.style.height = "100%"; }
    });
  }

  function showCollection(key) {
    const titles = { threeOfAKind: "Three of a Kind", teatroMusical: "Teatro Musical", viceGroup: "Vice Group" };
    const items = cfg.collections?.[key] || [];
    $("#collection-title").textContent = titles[key];
    $("#collection-list").innerHTML = items.map((item) => {
      if (item.items) return `<details class="collection-disclosure"><summary><span class="disclosure-title">${item.title}<small>Selecciona una partitura</small></span><span class="disclosure-chevron">›</span></summary><div class="collection-sublist">${item.items.map((child) => `<button class="collection-subbutton" type="button" data-pdf="${child.pdf}" data-pdf-title="${child.title}" data-pdf-back="collection" data-pdf-theme="${key}">${child.title}<span>›</span></button>`).join("")}</div></details>`;
      if (item.pdf) return `<button class="collection-button" type="button" data-pdf="${item.pdf}" data-pdf-title="${item.title}" data-pdf-back="collection" data-pdf-theme="${key}">${item.title}<span>›</span></button>`;
      return `<button class="collection-button" type="button" disabled>${item.title}<small>Próximamente</small></button>`;
    }).join("");
    $("#collection-screen").dataset.theme = key;
    $("#collection-screen").dataset.collectionKey = key;
    showScreen("collection");
  }

  function openExternal(key) {
    const url = cfg.externalLinks?.[key];
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  async function startNfc() {
    const dialog = $("#nfc-dialog"), status = $("#nfc-status");
    if (!dialog.open) dialog.showModal();
    if (!("NDEFReader" in window)) {
      const isiPhone = /iPad|iPhone|iPod/.test(navigator.userAgent);
      setStatus(status, isiPhone ? "El iPhone tiene NFC, pero Safari y las apps web no permiten leer tarjetas NFC. Usa el código QR o las credenciales." : "NFC no está disponible en este navegador. Puedes usar la cámara o las credenciales.", "error");
      return;
    }
    try {
      setStatus(status, "Esperando la tarjeta…");
      nfcController = new AbortController();
      const reader = new NDEFReader();
      await reader.scan({ signal: nfcController.signal });
      reader.addEventListener("reading", ({ serialNumber, message }) => {
        const record = message.records[0];
        let code = serialNumber;
        if (record?.data) { try { code = new TextDecoder(record.encoding || "utf-8").decode(record.data); } catch (_) {} }
        validate(code, status, null, "nfc");
      }, { once: true });
    } catch (error) { if (error.name !== "AbortError") setStatus(status, "No se pudo leer la tarjeta. Prueba otra forma de acceso.", "error"); }
  }
  function stopNfc() { if (nfcController) { nfcController.abort(); nfcController = null; } }

  // Configuración sencilla: es la opción más compatible con móviles y ordenadores.
  async function startScanner(camera = activeCamera) {
    const dialog = $("#scanner-dialog"), status = $("#scanner-status");
    activeCamera = camera;
    if (!dialog.open) dialog.showModal();
    if (!window.Html5Qrcode) { setStatus(status, "No se ha podido cargar el escáner. Comprueba tu conexión.", "error"); return; }
    try {
      setStatus(status, "Abriendo la cámara…");
      scanner = new Html5Qrcode("reader");
      await scanner.start({ facingMode: activeCamera }, {
        fps: 10,
        // Mantiene la guía blanca cuadrada y la hace tan grande como permita la cámara.
        qrbox: (width, height) => {
          const side = Math.max(160, Math.round(Math.min(width, height) * 0.78));
          return { width: side, height: side };
        },
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      }, (code) => validate(code, status, null, "barcode"));
      setStatus(status, activeCamera === "user" ? "Escanea el código QR con la cámara frontal." : "Escanea el código QR con la cámara trasera.");
    } catch (_) {
      // Un intento fallido puede dejar el visor creado; límpialo para que el cambio manual de cámara funcione.
      if (scanner) {
        try { await scanner.stop(); } catch (_) {}
        try { scanner.clear(); } catch (_) {}
      }
      scanner = null;
      setStatus(status, "No se pudo iniciar la cámara. Comprueba el permiso o pulsa “Cambiar cámara”.", "error");
    }
  }
  async function stopScanner() { if (scanner) { try { await scanner.stop(); } catch (_) {} try { scanner.clear(); } catch (_) {} scanner = null; } }
  async function switchCamera() { await stopScanner(); await startScanner(activeCamera === "user" ? "environment" : "user"); }

  $("#brand-name").textContent = cfg.appName;
  // Una recarga exige identificarse de nuevo.
  sessionStorage.removeItem("controlAccessSession");
  updateClock();
  loadUsers();
  loadPdfConfig();
  loadArchivedChecklistStatus();
  loadStudioCalendar();
  // El reloj y el estado del estudio cambian en cuanto cambia el minuto.
  setInterval(updateClock, 1_000);
  $("#nfc-button").addEventListener("click", startNfc);
  // No pasar el evento del clic a startScanner: se interpretaría erróneamente como una cámara.
  // Cada acceso nuevo usa la trasera en móvil y la webcam en ordenador.
  $("#camera-button").addEventListener("click", () => { activeCamera = defaultScannerCamera(); startScanner(activeCamera); });
  $("#manual-button").addEventListener("click", () => { $("#manual-username").value = ""; $("#manual-code").value = ""; $("#manual-code").type = "password"; $("#toggle-password").textContent = "Mostrar"; $("#toggle-password").setAttribute("aria-label", "Mostrar clave de acceso"); $("#toggle-password").setAttribute("aria-pressed", "false"); setStatus($("#manual-status"), ""); $("#manual-dialog").showModal(); setTimeout(() => $("#manual-username").focus(), 100); });
  const submitManualCredentials = () => validate($("#manual-code").value, $("#manual-status"), $("#manual-username").value, "credentials");
  $("#submit-code").addEventListener("click", (event) => { event.preventDefault(); submitManualCredentials(); });
  [$("#manual-username"), $("#manual-code")].forEach((input) => input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submitManualCredentials(); } }));
  $("#toggle-password").addEventListener("click", () => {
    const input = $("#manual-code"), visible = input.type === "text";
    input.type = visible ? "password" : "text";
    $("#toggle-password").textContent = visible ? "Mostrar" : "Ocultar";
    $("#toggle-password").setAttribute("aria-label", visible ? "Mostrar clave de acceso" : "Ocultar clave de acceso");
    $("#toggle-password").setAttribute("aria-pressed", String(!visible));
  });
  $("#stop-camera").addEventListener("click", stopScanner);
  $("#switch-camera").addEventListener("click", switchCamera);
  $("#scanner-dialog").addEventListener("close", stopScanner);
  $("#stop-nfc").addEventListener("click", stopNfc);
  $("#nfc-dialog").addEventListener("close", stopNfc);
  $("#confirm-checkin").addEventListener("click", (event) => { event.preventDefault(); confirmCheckin(); });
  $("#logout-button").addEventListener("click", () => { sessionStorage.removeItem("controlAccessSession"); showScreen("access"); const status = $("#access-status"); setStatus(status, "Sesión cerrada"); setTimeout(() => { if (status.textContent === "Sesión cerrada") setStatus(status, ""); }, 10_000); });
  document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.section === "schedule") { renderSchedule(); showScreen("schedule"); }
    if (button.dataset.section === "checklist") { renderChecklist(); showScreen("checklist"); }
    if (button.dataset.section === "checkin") openCheckinDialog();
  }));
  document.querySelectorAll("[data-collection]").forEach((button) => button.addEventListener("click", () => showCollection(button.dataset.collection)));
  document.querySelectorAll("[data-external]").forEach((button) => button.addEventListener("click", () => openExternal(button.dataset.external)));
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-pdf]"); if (button) openDocument(button.dataset.pdf, button.dataset.pdfTitle, button.dataset.pdfBack, button.dataset.pdfTheme); });
  document.addEventListener("change", (event) => { if (event.target.matches("[data-checklist-student]")) saveChecklistState(event.target.dataset.checklistGroup); });
  document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.back)));
  $("#previous-day").addEventListener("click", () => moveSchedule(-1));
  $("#next-day").addEventListener("click", () => moveSchedule(1));
  $("#today-button").addEventListener("click", () => { selectedDate = new Date(date); if (formatKey(selectedDate) < scheduleStart) selectedDate = dateFromKey(scheduleStart); if (formatKey(selectedDate) > scheduleEnd) selectedDate = dateFromKey(scheduleEnd); renderSchedule(); });
  $("#previous-checklist").addEventListener("click", () => moveChecklist(-1));
  $("#next-checklist").addEventListener("click", () => moveChecklist(1));
  $("#checklist-today-button").addEventListener("click", () => {
    selectedChecklistKey = getReferenceChecklistKey();
    renderChecklist();
  });
  updateChecklistTodayLabel();
  const pinchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const viewer = $("#document-viewer");
  viewer.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2 && currentPdf) { pinchStartDistance = pinchDistance(event.touches); pinchStartZoom = pdfZoom; pinchPreviewZoom = pdfZoom; }
  }, { passive: true });
  viewer.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !pinchStartDistance || !currentPdf) return;
    event.preventDefault();
    const previewZoom = Math.min(2.5, Math.max(0.5, pinchStartZoom * (pinchDistance(event.touches) / pinchStartDistance)));
    pinchPreviewZoom = previewZoom;
    applyPdfZoom(previewZoom);
  }, { passive: false });
  viewer.addEventListener("touchend", (event) => {
    if (event.touches.length || !pinchStartDistance || !currentPdf) return;
    pdfZoom = pinchPreviewZoom;
    pinchStartDistance = 0;
    applyPdfZoom(pdfZoom);
  });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1 && !event.target.closest("#document-viewer")) event.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js?v=20261005-1", { updateViaCache: "none" }));
})();
