/* =========================================================
   TaskFlow — Mobile-first To-Do
   Vanilla ES6+. Centralized state. Event delegation.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- CONSTANTS ---------- */
  const STORAGE_KEY = "taskflow.tasks.v1";
  const PROFILE_KEY = "taskflow.profile.v1";
  const PRIORITIES = ["low", "medium", "high"];
  const PRIORITY_LABEL = { low: "Rendah", medium: "Sedang", high: "Tinggi" };
  const LOCALE = "id-ID";

  // Legacy profiles that must be migrated away automatically.
  const LEGACY_NAMES = ["Alex Morgan"];
  const DEFAULT_PROFILE = { name: "Faisal Muchsin", role: "Librarian" };

  /* ---------- SAFE STORAGE ---------- */
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        console.warn("Storage read failed:", err);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        console.warn("Storage write failed:", err);
        return false;
      }
    }
  };

  /* ---------- STATE (single source of truth) ---------- */
  const state = {
    tasks: [],
    pendingDeleteId: null
  };

  /* ---------- DOM CACHE ---------- */
  const $ = (id) => document.getElementById(id);
  const dom = {
    avatarInitials: $("avatarInitials"),
    greeting: $("greeting"),
    userName: $("userName"),
    userRole: $("userRole"),
    currentDay: $("currentDay"),
    currentDate: $("currentDate"),
    form: $("taskForm"),
    input: $("taskInput"),
    inputError: $("taskInputError"),
    dueDate: $("dueDate"),
    dueTime: $("dueTime"),
    submitBtn: $("submitBtn"),
    activeList: $("activeList"),
    doneList: $("doneList"),
    activeEmpty: $("activeEmpty"),
    doneEmpty: $("doneEmpty"),
    activeCount: $("activeCount"),
    doneCount: $("doneCount"),
    statActive: $("statActive"),
    statDone: $("statDone"),
    statOverdue: $("statOverdue"),
    deleteAllBtn: $("deleteAllBtn"),
    toast: $("toast"),
    modal: $("modal"),
    modalTitle: $("modalTitle"),
    modalText: $("modalText"),
    modalConfirm: $("modalConfirm"),
    modalCancel: $("modalCancel")
  };

  /* ---------- UTILITIES ---------- */
  const uid = () =>
    "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

  const pad = (n) => String(n).padStart(2, "0");

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric" });
  };

  const formatTime = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  };

  const greetingFor = (hour) => {
    if (hour < 11) return "Selamat Pagi";
    if (hour < 15) return "Selamat Siang";
    if (hour < 18) return "Selamat Sore";
    return "Selamat Malam";
  };

  /* ---------- SANITIZE (defense-in-depth; we build DOM nodes anyway) ---------- */
  const sanitize = (str) => String(str).replace(/[<>]/g, "").trim();

  /* ---------- ELEMENT FACTORY (no innerHTML = XSS-safe) ---------- */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key in attrs) {
        const val = attrs[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === "class") node.className = val;
        else if (key === "text") node.textContent = val;
        else if (key === "html") node.innerHTML = val;
        else if (key.startsWith("on") && typeof val === "function") {
          node.addEventListener(key.slice(2), val);
        } else if (key === "dataset") {
          Object.assign(node.dataset, val);
        } else {
          node.setAttribute(key, val);
        }
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((child) => {
        if (child === null || child === undefined || child === false) return;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgIcon(pathD, size) {
    const s = size || 18;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", s);
    svg.setAttribute("height", s);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  /* ---------- TASK LOGIC ---------- */
  function isOverdue(task, now) {
    if (task.done || !task.dueDate) return false;
    const due = new Date(
      task.dueDate + "T" + (task.dueTime ? task.dueTime : "23:59")
    );
    if (isNaN(due)) return false;
    return due.getTime() < (now || new Date()).getTime();
  }

  function createTask({ title, priority, dueDate, dueTime }) {
    const now = new Date();
    return {
      id: uid(),
      title,
      priority: PRIORITIES.includes(priority) ? priority : "medium",
      dueDate: dueDate || "",
      dueTime: dueTime || "",
      done: false,
      createdAt: now.toISOString(),
      completedAt: null
    };
  }

  function findTask(id) {
    return state.tasks.find((t) => t.id === id) || null;
  }

  function persist() {
    storage.set(STORAGE_KEY, state.tasks);
  }

  /* ---------- RENDER: SINGLE TASK ---------- */
  const ICON_CHECK =
    "M9.55 17.6 4.4 12.45l1.42-1.42 3.73 3.73 8.63-8.63 1.42 1.42L9.55 17.6Z";
  const ICON_TRASH =
    "M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 9Zm3.5 2 .5 10h1l-.5-10h-1Zm4 0-.5 10h1l.5-10h-1Z";

  function renderTask(task, now) {
    const overdue = isOverdue(task, now);

    const check = el("button", {
      type: "button",
      class: "task__check",
      role: "checkbox",
      "aria-checked": task.done ? "true" : "false",
      "aria-label": task.done ? "Tandai tugas belum selesai" : "Tandai tugas selesai",
      dataset: { action: "toggle", id: task.id }
    }, svgIcon(ICON_CHECK, 16));

    const meta = el("div", { class: "task__meta" });

    meta.appendChild(
      el("span", {
        class: "chip chip--" + task.priority,
        text: PRIORITY_LABEL[task.priority]
      })
    );

    const created = new Date(task.createdAt);
    meta.appendChild(
      el("span", {
        class: "chip",
        text: "Dibuat " + created.toLocaleDateString(LOCALE, { month: "short", day: "numeric" })
      })
    );

    if (task.dueDate) {
      const dueText =
        "Tenggat " + formatDate(task.dueDate) + (task.dueTime ? " · " + formatTime(task.dueTime) : "");
      meta.appendChild(
        el("span", { class: "chip" + (overdue ? " chip--overdue" : ""), text: dueText })
      );
    }

    if (task.done) {
      meta.appendChild(el("span", { class: "chip chip--done", text: "Selesai" }));
    } else if (overdue) {
      meta.appendChild(el("span", { class: "chip chip--overdue", text: "Terlambat" }));
    }

    const body = el("div", { class: "task__body" }, [
      el("p", { class: "task__title", text: task.title }),
      meta
    ]);

    const del = el("button", {
      type: "button",
      class: "task__delete",
      title: "Hapus",
      "aria-label": "Hapus tugas: " + task.title,
      dataset: { action: "delete", id: task.id }
    }, svgIcon(ICON_TRASH, 18));

    const li = el("li", {
      class: [
        "task",
        "task--" + task.priority,
        task.done ? "is-done" : "",
        overdue ? "is-overdue" : ""
      ].filter(Boolean).join(" "),
      dataset: { id: task.id }
    }, [check, body, del]);

    return li;
  }

  /* ---------- RENDER: LIST ---------- */
  function renderList(container, tasks, now) {
    const frag = document.createDocumentFragment();
    tasks.forEach((task) => frag.appendChild(renderTask(task, now)));
    container.textContent = "";
    container.appendChild(frag);
  }

  /* ---------- RENDER: ALL ---------- */
  function render() {
    const now = new Date();
    const active = state.tasks.filter((t) => !t.done);
    const done = state.tasks.filter((t) => t.done);

    // Active: overdue first, then by priority weight, then newest
    const weight = { high: 0, medium: 1, low: 2 };
    active.sort((a, b) => {
      const ao = isOverdue(a, now) ? 0 : 1;
      const bo = isOverdue(b, now) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (weight[a.priority] !== weight[b.priority]) return weight[a.priority] - weight[b.priority];
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Done: most recently completed first
    done.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

    renderList(dom.activeList, active, now);
    renderList(dom.doneList, done, now);

    const overdueCount = active.filter((t) => isOverdue(t, now)).length;

    dom.activeCount.textContent = String(active.length);
    dom.doneCount.textContent = String(done.length);
    dom.statActive.textContent = String(active.length);
    dom.statDone.textContent = String(done.length);
    dom.statOverdue.textContent = String(overdueCount);

    dom.activeEmpty.classList.toggle("is-visible", active.length === 0);
    dom.doneEmpty.classList.toggle("is-visible", done.length === 0);

    dom.deleteAllBtn.disabled = state.tasks.length === 0;
  }


  /* ---------- TOAST ---------- */
  let toastTimer = null;
  function showToast(message, type) {
    if (toastTimer) clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.className = "toast is-visible" + (type ? " is-" + type : "");
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, 2200);
  }

  /* ---------- MODAL (promise-based confirm) ---------- */
  let modalResolve = null;
  let lastFocused = null;

  function openConfirm(title, text) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      lastFocused = document.activeElement;
      dom.modalTitle.textContent = title;
      dom.modalText.textContent = text;
      dom.modal.hidden = false;
      dom.modalConfirm.focus();
    });
  }

  function closeConfirm(result) {
    dom.modal.hidden = true;
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    if (modalResolve) {
      modalResolve(result);
      modalResolve = null;
    }
  }

  /* ---------- TASK ACTIONS ---------- */
  function addTask(data) {
    const task = createTask(data);
    state.tasks.unshift(task);
    persist();
    render();
    showToast("Tugas ditambahkan", "success");
  }

  function toggleTask(id) {
    const task = findTask(id);
    if (!task) return;
    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : null;
    persist();
    render();
    showToast(task.done ? "Tugas selesai" : "Tugas dikembalikan");
  }

  function removeTask(id, animate) {
    const apply = () => {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      persist();
      render();
      showToast("Tugas dihapus");
    };
    if (!animate) { apply(); return; }
    const node = dom.activeList.querySelector('[data-id="' + id + '"]') ||
                 dom.doneList.querySelector('[data-id="' + id + '"]');
    if (!node) { apply(); return; }
    node.classList.add("is-leaving");
    node.addEventListener("animationend", apply, { once: true });
    // Safety net if animation doesn't fire (reduced-motion, tab hidden)
    setTimeout(() => { if (state.tasks.some((t) => t.id === id)) apply(); }, 420);
  }

  async function deleteTask(id) {
    const task = findTask(id);
    if (!task) return;
    const ok = await openConfirm(
      "Hapus tugas?",
      '"' + task.title.slice(0, 60) + (task.title.length > 60 ? "…" : "") + '" akan dihapus.'
    );
    if (ok) removeTask(id, true);
  }

  async function deleteAll() {
    if (state.tasks.length === 0) return;
    const ok = await openConfirm(
      "Hapus semua tugas?",
      "Apakah Anda yakin ingin menghapus semua tugas? " + state.tasks.length +
        " tugas akan dihapus permanen. Tindakan ini tidak dapat dibatalkan."
    );
    if (!ok) return;
    state.tasks = [];
    persist();
    render();
    showToast("Semua tugas dihapus", "error");
  }


  /* ---------- FORM ---------- */
  function autoResize() {
    dom.input.style.height = "auto";
    dom.input.style.height = Math.min(dom.input.scrollHeight, 180) + "px";
  }

  function showInputError(message) {
    dom.inputError.textContent = message;
    dom.inputError.hidden = false;
    dom.input.classList.add("is-invalid");
  }

  function clearInputError() {
    dom.inputError.hidden = true;
    dom.inputError.textContent = "";
    dom.input.classList.remove("is-invalid");
  }

  function handleSubmit(event) {
    event.preventDefault();
    const title = sanitize(dom.input.value);

    if (!title) {
      showInputError("Silakan masukkan judul tugas.");
      dom.input.focus();
      return;
    }
    if (title.length > 200) {
      showInputError("Tugas terlalu panjang (maks. 200 karakter).");
      dom.input.focus();
      return;
    }
    clearInputError();

    const priorityInput = dom.form.querySelector('input[name="priority"]:checked');
    addTask({
      title,
      priority: priorityInput ? priorityInput.value : "medium",
      dueDate: dom.dueDate.value,
      dueTime: dom.dueTime.value
    });

    // Reset composer
    dom.input.value = "";
    dom.dueDate.value = "";
    dom.dueTime.value = "";
    const medium = dom.form.querySelector('input[name="priority"][value="medium"]');
    if (medium) medium.checked = true;
    autoResize();
    dom.input.focus();
  }

  /* ---------- EVENT DELEGATION ---------- */
  function bindListEvents(container) {
    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !container.contains(target)) return;
      const { action, id } = target.dataset;
      if (action === "toggle") toggleTask(id);
      else if (action === "delete") deleteTask(id);
    });
  }

  /* ---------- HEADER CLOCK (day + date, auto-updating) ---------- */
  let clockTimer = null;
  function renderClock() {
    const now = new Date();
    dom.currentDay.textContent = now.toLocaleDateString(LOCALE, { weekday: "long" });
    dom.currentDate.textContent = now.toLocaleDateString(LOCALE, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    dom.greeting.textContent = greetingFor(now.getHours());
  }

  function scheduleMidnightRefresh() {
    if (clockTimer) clearTimeout(clockTimer);
    const now = new Date();
    const next = startOfDay(now);
    next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime() + 1000;
    clockTimer = setTimeout(() => {
      renderClock();
      render(); // re-evaluate overdue states at day rollover
      scheduleMidnightRefresh();
    }, delay);
  }

  /* ---------- PROFILE ---------- */
  function loadProfile() {
    const stored = storage.get(PROFILE_KEY, null);

    // Migrate away any legacy profile (e.g. "Alex Morgan") so the new
    // defaults load immediately without a manual cache clear.
    const isLegacy =
      !stored ||
      typeof stored !== "object" ||
      LEGACY_NAMES.includes((stored.name || "").trim());

    const profile = isLegacy
      ? { ...DEFAULT_PROFILE }
      : {
          name: (stored.name || DEFAULT_PROFILE.name).trim() || DEFAULT_PROFILE.name,
          role: (stored.role || DEFAULT_PROFILE.role).trim() || DEFAULT_PROFILE.role
        };

    if (isLegacy) storage.set(PROFILE_KEY, profile);

    dom.userName.textContent = profile.name;
    dom.userRole.textContent = profile.role;
    dom.avatarInitials.textContent = profile.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  /* ---------- LOAD TASKS ---------- */
  function loadTasks() {
    const stored = storage.get(STORAGE_KEY, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        PRIORITIES.includes(t.priority)
    ).map((t) => ({
      id: t.id,
      title: sanitize(t.title),
      priority: t.priority,
      dueDate: typeof t.dueDate === "string" ? t.dueDate : "",
      dueTime: typeof t.dueTime === "string" ? t.dueTime : "",
      done: Boolean(t.done),
      createdAt: t.createdAt || new Date().toISOString(),
      completedAt: t.completedAt || null
    }));
  }

  /* ---------- INIT ---------- */
  function init() {
    loadProfile();
    renderClock();
    scheduleMidnightRefresh();

    state.tasks = loadTasks();
    render();

    // Composer
    dom.form.addEventListener("submit", handleSubmit);
    dom.input.addEventListener("input", () => {
      autoResize();
      if (!dom.inputError.hidden) clearInputError();
    });
    dom.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    });
    autoResize();

    // Lists (delegation)
    bindListEvents(dom.activeList);
    bindListEvents(dom.doneList);

    // Global actions
    dom.deleteAllBtn.addEventListener("click", deleteAll);

    // Modal
    dom.modalConfirm.addEventListener("click", () => closeConfirm(true));
    dom.modalCancel.addEventListener("click", () => closeConfirm(false));
    dom.modal.querySelector("[data-close-modal]").addEventListener("click", () => closeConfirm(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dom.modal.hidden) closeConfirm(false);
    });

    // Cross-tab sync
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) {
        state.tasks = loadTasks();
        render();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

