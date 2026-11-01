/* ============================================================
   Η ΜΗΧΑΝΗ ΤΗΣ ΣΕΛΙΔΑΣ — ΔΕΝ ΤΟ ΠΕΙΡΑΖΕΙΣ ΑΝΑ ΕΠΙΧΕΙΡΗΣΗ
   ============================================================
   Όλα τα δεδομένα του πελάτη (όνομα, χρώματα, προσωπικό, PIN,
   κανόνες) είναι στο company-data.js και μένουν στον διακομιστή.
   Αυτό το αρχείο ζητάει ό,τι του χρειάζεται από το /api.

   Αν βελτιωθεί κάτι εδώ, το αρχείο αντιγράφεται αυτούσιο σε
   όλους τους πελάτες.
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const MONTHS = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου",
    "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
  const WEEKDAYS = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
  const KIND_LABEL = { off: "ΡΕΠΟ", limited: "ώρες", note: "σημείωση" };

  /* ---------------- κατάσταση ---------------- */

  const state = {
    cfg: null,      // ρυθμίσεις επιχείρησης (χωρίς PIN)
    me: null,       // ποιος είμαι
    token: null,    // το "εισιτήριο" της σύνδεσης
    month: "",      // "2026-11"
    data: null,     // τα δεδομένα του μήνα
    view: "mine",
    sheet: { day: "", kind: "", adminMode: false },
  };

  const STORAGE = "shift-planner-session";

  /* ---------------- λειτουργία επίδειξης ----------------
     Με ?demo=1 στο τέλος της διεύθυνσης, η σελίδα δεν μιλάει στον
     διακομιστή: τρέχει τους ΙΔΙΟΥΣ κανόνες (engine/rules.js) μέσα στον
     browser, με ψεύτικη επιχείρηση (demo-data.js) και αποθήκευση στη
     συσκευή. Χρήσιμο για επίδειξη σε πελάτη. */

  const DEMO = new URLSearchParams(location.search).has("demo");
  const DEMO_PREFIX = "shift-planner-demo:";
  const demoMemory = {};        // εφεδρεία, αν ο browser μπλοκάρει την αποθήκευση
  let demoCtx = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Δεν φόρτωσε το ${src}.`));
      document.head.appendChild(el);
    });
  }

  async function startDemo() {
    await loadScript("engine/rules.js");
    await loadScript("demo-data.js");
    demoCtx = {
      company: globalThis.DEMO_COMPANY,
      store: {
        async get(key) {
          try {
            return localStorage.getItem(DEMO_PREFIX + key);
          } catch {
            return Object.prototype.hasOwnProperty.call(demoMemory, key) ? demoMemory[key] : null;
          }
        },
        async set(key, value) {
          try {
            localStorage.setItem(DEMO_PREFIX + key, value);
          } catch {
            demoMemory[key] = value;
          }
        },
      },
      // Στην επίδειξη δεν υπάρχει τίποτα να προστατευτεί — μια απλή,
      // σταθερή υπογραφή αρκεί. Στο Netlify η υπογραφή είναι HMAC.
      sign: (text) => {
        let h = 0;
        for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
        return `0000000${(h >>> 0).toString(16)}`.slice(-8);
      },
    };
    $("demo-banner").hidden = false;
    $("demo-reset").addEventListener("click", resetDemo);
  }

  function resetDemo() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(DEMO_PREFIX)) localStorage.removeItem(key);
      }
      localStorage.removeItem(STORAGE);
    } catch {
      /* τίποτα */
    }
    for (const key of Object.keys(demoMemory)) delete demoMemory[key];
    location.reload();
  }

  /* ---------------- επικοινωνία ---------------- */

  async function api(action, data) {
    // Επίδειξη: οι ίδιοι κανόνες, τοπικά, χωρίς διακομιστή.
    if (DEMO) {
      const out = await globalThis.ShiftRules.handle(demoCtx, {
        action,
        token: state.token,
        data: data || {},
      });
      if (out.status !== 200) {
        if (out.status === 401 && state.token) logout();
        throw new Error(out.body.error || "Κάτι πήγε λάθος.");
      }
      return out.body;
    }

    const res = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: state.token, data: data || {} }),
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      throw new Error("Ο διακομιστής δεν απάντησε σωστά.");
    }
    if (!res.ok) {
      // Έληξε η σύνδεση: γύρνα στην οθόνη σύνδεσης αντί για σκέτο μήνυμα.
      if (res.status === 401 && state.token) logout();
      throw new Error(body.error || "Κάτι πήγε λάθος.");
    }
    return body;
  }

  /* ---------------- ημερομηνίες ---------------- */

  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (month, d) => `${month}-${pad(d)}`;

  function monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  function dateLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Δευτέρα
    return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
  }

  function daysInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /** Σε ποια στήλη πέφτει η 1η του μήνα (0 = Δευτέρα). */
  function firstColumn(month) {
    const [y, m] = month.split("-").map(Number);
    return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const total = y * 12 + (m - 1) + delta;
    return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
  }

  function currentMonth(today) {
    return today.slice(0, 7);
  }

  /* ---------------- μηνύματα ---------------- */

  function say(text, bad) {
    const box = $("status");
    if (!text) {
      box.hidden = true;
      return;
    }
    box.textContent = text;
    box.classList.toggle("is-bad", Boolean(bad));
    box.hidden = false;
  }

  /* ---------------- σύνδεση ---------------- */

  function applyTheme(cfg) {
    const root = document.documentElement;
    if (cfg.theme && cfg.theme.accent) root.style.setProperty("--accent", cfg.theme.accent);
    if (cfg.theme && cfg.theme.accentDark) root.style.setProperty("--accent-dark", cfg.theme.accentDark);

    const name = (cfg.brand && cfg.brand.name) || "Πρόγραμμα";
    document.title = `${name} · Πρόγραμμα προσωπικού`;
    $("login-brand").textContent = name;
    $("top-brand").textContent = name;
    $("login-tagline").textContent = (cfg.brand && cfg.brand.tagline) || "";
    $("login-note").textContent = (cfg.copy && cfg.copy.loginNote) || "";
    $("intro").textContent = (cfg.copy && cfg.copy.intro) || "";

    const emoji = cfg.brand && cfg.brand.favicon;
    if (emoji) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="48" font-size="48">${emoji}</text></svg>`;
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      document.head.appendChild(link);
    }
  }

  function fillStaffSelect(select, list, withBlank) {
    select.innerHTML = "";
    if (withBlank) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "— διάλεξε —";
      select.appendChild(o);
    }
    for (const p of list) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.team ? `${p.name} (${p.team})` : p.name;
      select.appendChild(o);
    }
  }

  async function doLogin() {
    const id = $("login-staff").value;
    const pin = $("login-pin").value.trim();
    const err = $("login-error");
    err.hidden = true;

    if (!id) return showLoginError("Διάλεξε το όνομά σου.");
    if (!/^\d{4}$/.test(pin)) return showLoginError("Το PIN είναι 4 ψηφία.");

    $("login-go").disabled = true;
    try {
      const out = await api("login", { id, pin });
      state.token = out.token;
      state.me = out.me;
      try {
        localStorage.setItem(STORAGE, JSON.stringify({ token: out.token, me: out.me }));
      } catch {
        /* ιδιωτική περιήγηση — η σύνδεση κρατάει μόνο όσο η καρτέλα */
      }
      $("login-pin").value = "";
      await enterApp();
    } catch (e) {
      showLoginError(e.message);
    } finally {
      $("login-go").disabled = false;
    }
  }

  function showLoginError(text) {
    const err = $("login-error");
    err.textContent = text;
    err.hidden = false;
  }

  function logout() {
    state.token = null;
    state.me = null;
    state.data = null;
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      /* τίποτα */
    }
    $("app").hidden = true;
    $("sheet").hidden = true;
    $("login").hidden = false;
  }

  /* ---------------- είσοδος στην εφαρμογή ---------------- */

  async function enterApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    $("top-me").textContent = state.me.role === "admin"
      ? `${state.me.name} · διαχειριστής`
      : state.me.name;
    const isAdmin = state.me.role === "admin";
    document.querySelector('[data-view="admin"]').hidden = !isAdmin;
    if (!isAdmin) {
      // Αν πριν ήταν συνδεδεμένος ο υπεύθυνος στην ίδια συσκευή, δεν αφήνουμε
      // τα δικά του πράγματα στη σελίδα.
      if (state.view === "admin") setView("mine");
      $("admin-calendar").innerHTML = "";
      $("admin-locked").innerHTML = "";
    }
    if (!state.month) state.month = currentMonth(state.cfg.today);
    await loadMonth();
  }

  async function loadMonth() {
    say("Φορτώνει…");
    try {
      state.data = await api("month", { month: state.month });
      say("");
      render();
    } catch (e) {
      say(e.message, true);
    }
  }

  /* ---------------- υπολογισμοί πίνακα ---------------- */

  /** Πόσοι ζήτησαν ρεπό τη μέρα αυτή, και τι έχω δηλώσει εγώ. */
  function dayFacts(key) {
    const entries = (state.data && state.data.entries) || {};
    let off = 0;
    const all = [];
    for (const [id, entry] of Object.entries(entries)) {
      const d = entry.days && entry.days[key];
      if (!d) continue;
      if (d.kind === "off") off++;
      all.push({ id, ...d });
    }
    const mine = entries[state.me.id] && entries[state.me.id].days
      ? entries[state.me.id].days[key]
      : null;
    return { off, all, mine, locked: state.data.lockedDays[key] };
  }

  function nameOf(id) {
    const s = state.data && state.data.staff && state.data.staff[id];
    return s ? s.name : id;
  }

  /* ---------------- ημερολόγιο ---------------- */

  function renderCalendar(container, adminMode) {
    container.innerHTML = "";

    for (const w of WEEKDAYS) {
      const h = document.createElement("div");
      h.className = "cal-head";
      h.textContent = w;
      container.appendChild(h);
    }

    for (let i = 0; i < firstColumn(state.month); i++) {
      const blank = document.createElement("div");
      blank.className = "cal-blank";
      container.appendChild(blank);
    }

    const maxOff = state.cfg.rules.maxOffPerDay;
    const total = daysInMonth(state.month);

    for (let d = 1; d <= total; d++) {
      const key = dayKey(state.month, d);
      const facts = dayFacts(key);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day";
      cell.dataset.day = key;
      if (key === state.data.today) cell.classList.add("is-today");
      if (key < state.data.today) cell.classList.add("is-past");
      if (facts.locked) cell.classList.add("is-locked");
      else if (maxOff && facts.off >= maxOff) cell.classList.add("is-busy");
      if (facts.mine) cell.classList.add(`mine-${facts.mine.kind}`);

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(d);
      cell.appendChild(num);

      const cnt = document.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = facts.locked ? "κλειστή" : facts.off ? `${facts.off} ρεπό` : "";
      cell.appendChild(cnt);

      const dot = document.createElement("span");
      dot.className = "dot";
      cell.appendChild(dot);

      const parts = [dateLabel(key)];
      if (facts.locked) parts.push(`κλειδωμένη: ${facts.locked}`);
      if (facts.off) parts.push(`${facts.off} ζήτησαν ρεπό`);
      cell.title = parts.join(" · ");
      cell.setAttribute("aria-label", parts.join(", "));

      cell.addEventListener("click", () => openSheet(key, adminMode));
      container.appendChild(cell);
    }
  }

  /* ---------------- λίστες ---------------- */

  function chip(kind, text) {
    const el = document.createElement("span");
    el.className = `chip ${kind}`;
    el.innerHTML = text;
    return el;
  }

  function describe(d) {
    if (d.kind === "off") return `<b>ΡΕΠΟ</b>${d.note ? ` · ${escape(d.note)}` : ""}`;
    if (d.kind === "limited") return `<b>${d.from}–${d.to}</b>${d.note ? ` · ${escape(d.note)}` : ""}`;
    return escape(d.note || "σημείωση");
  }

  function escape(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderMyList() {
    const box = $("my-list");
    box.innerHTML = "";
    const entry = (state.data.entries && state.data.entries[state.me.id]) || { days: {} };
    const keys = Object.keys(entry.days || {}).sort();

    if (!keys.length) {
      box.innerHTML = '<p class="empty">Δεν έχεις δηλώσει τίποτα για αυτόν τον μήνα. Πάτα μια μέρα στο ημερολόγιο.</p>';
      return;
    }
    for (const key of keys) {
      const d = entry.days[key];
      const item = document.createElement("div");
      item.className = "item";
      const head = document.createElement("div");
      head.className = "item-head";
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = dateLabel(key);
      head.appendChild(date);
      const edit = document.createElement("button");
      edit.className = "ghost small";
      edit.textContent = "Αλλαγή";
      edit.addEventListener("click", () => openSheet(key, false));
      head.appendChild(edit);
      item.appendChild(head);
      const chips = document.createElement("div");
      chips.className = "chips";
      chips.appendChild(chip(d.kind, describe(d)));
      item.appendChild(chips);
      box.appendChild(item);
    }
  }

  function renderAllDays() {
    const box = $("all-days");
    box.innerHTML = "";
    const total = daysInMonth(state.month);
    let shown = 0;

    for (let d = 1; d <= total; d++) {
      const key = dayKey(state.month, d);
      const facts = dayFacts(key);
      if (!facts.all.length && !facts.locked) continue;
      shown++;

      const item = document.createElement("div");
      item.className = "item";

      const head = document.createElement("div");
      head.className = "item-head";
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = dateLabel(key);
      head.appendChild(date);
      const count = document.createElement("span");
      count.className = "muted small";
      count.textContent = facts.off ? `${facts.off} ρεπό` : "";
      head.appendChild(count);
      item.appendChild(head);

      const chips = document.createElement("div");
      chips.className = "chips";
      if (facts.locked) chips.appendChild(chip("locked", `🔒 ${escape(facts.locked)}`));
      for (const entry of facts.all) {
        chips.appendChild(chip(entry.kind, `${escape(nameOf(entry.id))}: ${describe(entry)}`));
      }
      item.appendChild(chips);
      box.appendChild(item);
    }

    if (!shown) {
      box.innerHTML = '<p class="empty">Κανένα αίτημα για αυτόν τον μήνα ακόμα.</p>';
    }
  }

  function renderAllPeople() {
    const box = $("all-people");
    box.innerHTML = "";
    const entries = state.data.entries || {};
    let shown = 0;

    for (const p of state.cfg.staff) {
      const entry = entries[p.id];
      if (!entry) continue;
      const days = Object.values(entry.days || {});
      if (!days.length && !entry.note) continue;
      shown++;

      const offs = days.filter((d) => d.kind === "off").length;
      const lims = days.filter((d) => d.kind === "limited").length;

      const item = document.createElement("div");
      item.className = "item";
      const head = document.createElement("div");
      head.className = "item-head";
      const who = document.createElement("span");
      who.className = "date";
      who.textContent = p.team ? `${p.name} · ${p.team}` : p.name;
      head.appendChild(who);
      const sum = document.createElement("span");
      sum.className = "muted small";
      sum.textContent = `${offs} ρεπό · ${lims} με ώρες`;
      head.appendChild(sum);
      item.appendChild(head);

      if (entry.note) {
        const note = document.createElement("p");
        note.className = "muted small";
        note.style.margin = "0";
        note.textContent = `“${entry.note}”`;
        item.appendChild(note);
      }
      box.appendChild(item);
    }

    if (!shown) box.innerHTML = '<p class="empty">Καμία καταχώρηση.</p>';
  }

  function renderAdmin() {
    renderCalendar($("admin-calendar"), true);

    const box = $("admin-locked");
    box.innerHTML = "";
    const keys = Object.keys(state.data.lockedDays || {}).sort();
    if (!keys.length) {
      box.innerHTML = '<p class="empty">Καμία κλειδωμένη μέρα αυτόν τον μήνα.</p>';
    } else {
      for (const key of keys) {
        const item = document.createElement("div");
        item.className = "item item-head";
        const text = document.createElement("span");
        text.innerHTML = `<span class="date">${dateLabel(key)}</span> <span class="muted small">${escape(state.data.lockedDays[key])}</span>`;
        item.appendChild(text);
        const btn = document.createElement("button");
        btn.className = "ghost small";
        btn.textContent = "Ξεκλείδωσε";
        btn.addEventListener("click", () => setLock(key, false, ""));
        item.appendChild(btn);
        box.appendChild(item);
      }
    }

    const day = state.cfg.rules.deadlineDayOfPreviousMonth;
    $("admin-deadline").textContent = day
      ? `Οι εργαζόμενοι δηλώνουν για κάθε μήνα μέχρι τις ${day} του προηγούμενου μήνα. Εσύ δεν δεσμεύεσαι από την προθεσμία. Αλλάζει στο company-data.js.`
      : "Δεν υπάρχει προθεσμία — τα αιτήματα γίνονται δεκτά όποτε να 'ναι. Αλλάζει στο company-data.js.";
  }

  function render() {
    $("month-label").textContent = monthLabel(state.month);

    const entry = (state.data.entries && state.data.entries[state.me.id]) || {};
    $("my-note").value = entry.note || "";

    const closed = state.data.closed && state.me.role !== "admin";
    $("my-note").disabled = closed;
    $("save-note").disabled = closed;
    if (closed) {
      say(`Η προθεσμία για ${monthLabel(state.month)} έχει περάσει — μίλα στη διεύθυνση.`, true);
    }

    renderCalendar($("calendar"), false);
    renderMyList();
    renderAllDays();
    renderAllPeople();
    if (state.me.role === "admin") renderAdmin();
  }

  /* ---------------- παράθυρο μέρας ---------------- */

  function openSheet(day, adminMode) {
    const facts = dayFacts(day);
    state.sheet = { day, kind: "", adminMode: Boolean(adminMode) };

    $("sheet-title").textContent = dateLabel(day);
    $("sheet-error").hidden = true;
    $("sheet-note").value = "";
    $("sheet-from").value = "";
    $("sheet-to").value = "";
    $("sheet-hours").hidden = true;
    $("sheet-reason").value = facts.locked || "";

    const isAdmin = state.me.role === "admin";
    const info = [];
    if (facts.locked) info.push(`🔒 Κλειδωμένη: ${facts.locked}`);
    if (facts.off) info.push(`${facts.off} ζήτησαν ρεπό`);
    for (const e of facts.all) info.push(`${nameOf(e.id)}: ${e.kind === "limited" ? `${e.from}–${e.to}` : KIND_LABEL[e.kind]}`);
    $("sheet-info").textContent = info.join(" · ") || "Καμία καταχώρηση για αυτή τη μέρα.";

    // Ο admin μπορεί να δηλώσει για λογαριασμό άλλου.
    $("sheet-staff-row").hidden = !isAdmin;
    if (isAdmin) {
      fillStaffSelect($("sheet-staff"), state.cfg.staff, false);
      $("sheet-staff").value = state.me.id;
    }

    // Τα κουμπιά κλειδώματος φαίνονται μόνο στον admin.
    $("sheet-lock").hidden = !isAdmin;

    // Τι έχει δηλωθεί ήδη για το άτομο που βλέπουμε.
    preselect(facts.mine);

    const blocked = !isAdmin && (
      Boolean(facts.locked) ||
      state.data.closed ||
      (!state.cfg.rules.allowPastDays && day < state.data.today)
    );
    $("sheet-kinds").hidden = blocked;
    $("sheet-note-row").hidden = blocked;
    $("sheet-save").hidden = blocked;
    $("sheet-clear").hidden = blocked || !facts.mine;
    if (blocked) {
      $("sheet-error").textContent = facts.locked
        ? "Η μέρα είναι κλειδωμένη από τη διεύθυνση."
        : state.data.closed
          ? "Η προθεσμία για αυτόν τον μήνα έχει περάσει."
          : "Η μέρα αυτή έχει περάσει.";
      $("sheet-error").hidden = false;
    }

    $("sheet").hidden = false;
  }

  function preselect(d) {
    for (const b of document.querySelectorAll(".kind")) b.classList.remove("is-on");
    if (!d) {
      state.sheet.kind = "";
      $("sheet-hours").hidden = true;
      return;
    }
    pickKind(d.kind);
    if (d.kind === "limited") {
      $("sheet-from").value = d.from || "";
      $("sheet-to").value = d.to || "";
    }
    $("sheet-note").value = d.note || "";
  }

  function pickKind(kind) {
    state.sheet.kind = kind;
    for (const b of document.querySelectorAll(".kind")) {
      b.classList.toggle("is-on", b.dataset.kind === kind);
    }
    $("sheet-hours").hidden = kind !== "limited";
  }

  function sheetError(text) {
    const el = $("sheet-error");
    el.textContent = text;
    el.hidden = false;
  }

  async function saveSheet() {
    const { day, kind } = state.sheet;
    if (!kind) return sheetError("Διάλεξε τι θέλεις: ρεπό, μόνο ώρες, ή σημείωση.");

    const payload = { day, kind, note: $("sheet-note").value };
    if (kind === "limited") {
      payload.from = $("sheet-from").value;
      payload.to = $("sheet-to").value;
      if (!payload.from || !payload.to) return sheetError("Συμπλήρωσε ώρα από και έως.");
    }
    if (state.me.role === "admin") payload.staffId = $("sheet-staff").value;

    await send("saveDay", payload, "Καταχωρήθηκε.");
  }

  async function clearSheet() {
    const payload = { day: state.sheet.day, kind: "clear" };
    if (state.me.role === "admin") payload.staffId = $("sheet-staff").value;
    await send("saveDay", payload, "Σβήστηκε.");
  }

  async function setLock(day, locked, reason) {
    await send("lockDay", { day, locked, reason }, locked ? "Η μέρα κλειδώθηκε." : "Η μέρα ξεκλείδωσε.");
  }

  /** Στέλνει, ανανεώνει τον πίνακα, κλείνει το παράθυρο. */
  async function send(action, payload, okText) {
    $("sheet-save").disabled = true;
    try {
      state.data = await api(action, payload);
      $("sheet").hidden = true;
      render();
      say(okText);
      setTimeout(() => {
        if ($("status").textContent === okText) say("");
      }, 2500);
    } catch (e) {
      sheetError(e.message);
    } finally {
      $("sheet-save").disabled = false;
    }
  }

  async function saveMyNote() {
    $("save-note").disabled = true;
    try {
      state.data = await api("saveNote", { month: state.month, note: $("my-note").value });
      render();
      say("Η σημείωση αποθηκεύτηκε.");
    } catch (e) {
      say(e.message, true);
    } finally {
      $("save-note").disabled = false;
    }
  }

  /* ---------------- καρτέλες ---------------- */

  function setView(view) {
    state.view = view;
    for (const t of document.querySelectorAll(".tab")) {
      t.classList.toggle("is-on", t.dataset.view === view);
    }
    $("view-mine").hidden = view !== "mine";
    $("view-all").hidden = view !== "all";
    $("view-admin").hidden = view !== "admin";
  }

  /* ---------------- σύνδεση γεγονότων ---------------- */

  function wire() {
    $("login-go").addEventListener("click", doLogin);
    $("login-pin").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    $("logout").addEventListener("click", logout);

    for (const t of document.querySelectorAll(".tab")) {
      t.addEventListener("click", () => setView(t.dataset.view));
    }

    $("month-prev").addEventListener("click", () => {
      state.month = shiftMonth(state.month, -1);
      loadMonth();
    });
    $("month-next").addEventListener("click", () => {
      state.month = shiftMonth(state.month, 1);
      loadMonth();
    });

    for (const b of document.querySelectorAll(".kind")) {
      b.addEventListener("click", () => {
        pickKind(b.dataset.kind);
        $("sheet-error").hidden = true;
      });
    }

    $("sheet-save").addEventListener("click", saveSheet);
    $("sheet-clear").addEventListener("click", clearSheet);
    $("sheet-close").addEventListener("click", () => {
      $("sheet").hidden = true;
    });
    $("sheet").addEventListener("click", (e) => {
      if (e.target === $("sheet")) $("sheet").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $("sheet").hidden = true;
    });

    $("sheet-do-lock").addEventListener("click", () =>
      setLock(state.sheet.day, true, $("sheet-reason").value));
    $("sheet-do-unlock").addEventListener("click", () =>
      setLock(state.sheet.day, false, ""));

    // Ο admin αλλάζει άτομο: δείξε τι έχει δηλώσει εκείνος.
    $("sheet-staff").addEventListener("change", () => {
      const entries = state.data.entries || {};
      const who = $("sheet-staff").value;
      const d = entries[who] && entries[who].days ? entries[who].days[state.sheet.day] : null;
      preselect(d);
      $("sheet-clear").hidden = !d;
      $("sheet-error").hidden = true;
    });

    $("save-note").addEventListener("click", saveMyNote);
  }

  /* ---------------- ξεκίνημα ---------------- */

  async function start() {
    wire();
    try {
      if (DEMO) await startDemo();
      state.cfg = await api("config", {});
    } catch (e) {
      document.body.innerHTML =
        `<p style="padding:2rem;color:#fca5a5">Η εφαρμογή δεν φόρτωσε: ${escape(e.message)}</p>`;
      return;
    }
    applyTheme(state.cfg);
    fillStaffSelect($("login-staff"), state.cfg.staff, true);
    state.month = currentMonth(state.cfg.today);

    // Ήμουν ήδη συνδεδεμένος σε αυτό το κινητό;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
    } catch {
      saved = null;
    }
    if (saved && saved.token && saved.me) {
      state.token = saved.token;
      state.me = saved.me;
      try {
        await enterApp();
        return;
      } catch {
        logout();
      }
    }
    $("login").hidden = false;
  }

  start();
})();
