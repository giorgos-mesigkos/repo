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
  const MONTHS_SHORT = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν",
    "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
  const WEEKDAYS = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
  // Για τις στήλες του εβδομαδιαίου πίνακα, όπου ο χώρος είναι ελάχιστος.
  const WEEKDAYS_2 = ["ΔΕ", "ΤΡ", "ΤΕ", "ΠΕ", "ΠΑ", "ΣΑ", "ΚΥ"];
  const KIND_LABEL = { off: "ΡΕΠΟ", limited: "ώρες", note: "σημείωση" };

  /* ---------------- κατάσταση ---------------- */

  const state = {
    cfg: null,      // ρυθμίσεις επιχείρησης (χωρίς PIN)
    me: null,       // ποιος είμαι
    token: null,    // το "εισιτήριο" της σύνδεσης
    month: "",      // "2026-11"
    data: null,     // τα δεδομένα του μήνα
    week: "",       // η Δευτέρα της εβδομάδας που βλέπουμε, "2026-11-02"
    rota: null,     // το πρόγραμμα αυτής της εβδομάδας
    clip: null,     // αντιγραμμένο ωράριο, έτοιμο για επικόλληση
    view: "mine",
    sheet: { day: "", kind: "", adminMode: false },
    shift: { day: "", staffId: "" },
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

  /** «Τετ 23» — ο μήνας φαίνεται ήδη στην κορυφή, δεν τον ξαναλέμε. */
  function dayShort(key) {
    const [y, m, d] = key.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return `${WEEKDAYS[wd]} ${d}`;
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

  /* ---- εβδομάδες: ξεκινούν Δευτέρα και τις λέμε με την ημερομηνία της ---- */

  function dateOf(day) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function keyOfDate(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function mondayOf(day) {
    const date = dateOf(day);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return keyOfDate(date);
  }

  function shiftWeek(monday, weeks) {
    const date = dateOf(monday);
    date.setUTCDate(date.getUTCDate() + weeks * 7);
    return keyOfDate(date);
  }

  /** «2 – 8 Νοεμβρίου 2026», ή «30 Νοε – 6 Δεκ 2026» όταν αλλάζει ο μήνας. */
  function weekLabel(monday) {
    const [, m1, d1] = monday.split("-").map(Number);
    const end = shiftWeek(monday, 0);
    const last = keyOfDate(new Date(dateOf(end).getTime() + 6 * 86400000));
    const [y2, m2, d2] = last.split("-").map(Number);
    return m1 === m2
      ? `${d1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`
      : `${d1} ${MONTHS_SHORT[m1 - 1]} – ${d2} ${MONTHS_SHORT[m2 - 1]} ${y2}`;
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

    // Λογότυπο: αν δεν έχει οριστεί, μένει κρυφό και φαίνεται μόνο το όνομα.
    const logo = (cfg.brand && cfg.brand.logo) || "";
    for (const id of ["login-logo", "top-logo"]) {
      const el = $(id);
      if (logo) {
        el.src = logo;
        el.alt = name;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    }

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

  /**
   * Χωρίς τόνους, χωρίς κεφαλαία, με ένα σίγμα — ώστε το «γιαννης» να βρίσκει
   * τον «Γιάννη Κ.» και το «σοφια» τη «Σοφία Α.». Σε ελληνικά ονόματα χωρίς
   * αυτό η αναζήτηση δεν θα έβρισκε σχεδόν τίποτα.
   */
  function fold(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/ς/g, "σ");
  }

  /**
   * Γεμίζει μια λίστα ονομάτων: πρώτα η διεύθυνση και ο υπεύθυνος
   * προγράμματος (χωρίς τίτλο ομάδας), μετά τα τμήματα με τη σειρά τους.
   * Το τμήμα γράφεται μία φορά, ως τίτλος — όχι σε παρένθεση δίπλα σε κάθε
   * όνομα, που σε μεγάλη επιχείρηση γεμίζει την οθόνη.
   *
   * Το `filter` κρατάει μόνο όσους ταιριάζουν· επιστρέφει πόσοι έμειναν.
   */
  function fillStaffSelect(select, withBlank, filter) {
    const names = {};
    for (const p of state.cfg.staff) names[p.id] = p.name;

    const needle = fold(filter || "").trim();
    select.innerHTML = "";

    const blank = withBlank ? document.createElement("option") : null;
    if (blank) {
      blank.value = "";
      select.appendChild(blank);
    }

    let shown = 0;
    let onlyOne = "";

    for (const group of state.cfg.staffGroups || []) {
      // Ταιριάζει και το τμήμα: γράφεις «σερβις» και βλέπεις όλο το σέρβις.
      const ids = group.ids.filter((id) =>
        !needle || fold(names[id] || id).includes(needle) || fold(group.name).includes(needle));
      if (!ids.length) continue;

      const box = group.name ? document.createElement("optgroup") : select;
      if (group.name) box.label = group.name;

      for (const id of ids) {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = names[id] || id;
        box.appendChild(o);
        shown++;
        onlyOne = id;
      }
      if (group.name) select.appendChild(box);
    }

    if (blank) {
      blank.textContent = shown ? "— διάλεξε —" : "— κανένα όνομα δεν ταιριάζει —";
    }
    // Έμεινε ένας: διάλεξέ τον, να μην ξαναπατάει τη λίστα.
    if (shown === 1) select.value = onlyOne;
    return shown;
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
    // Το πρόγραμμα εξαρτάται από τον ρόλο: αν μπει άλλος στην ίδια συσκευή,
    // δεν του το δείχνουμε όπως το έβλεπε ο προηγούμενος. Δεν αρκεί να
    // ξεχάσουμε τα δεδομένα — σβήνουμε και τον πίνακα από την οθόνη, αλλιώς
    // ο επόμενος βλέπει για λίγο τον πίνακα του προηγούμενου (με τις ώρες)
    // μέχρι να φορτώσει ο δικός του.
    state.rota = null;
    state.clip = null;
    $("rota").innerHTML = "";
    $("week-tools").hidden = true;
    $("clip-bar").hidden = true;
    $("week-help").textContent = "";
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      /* τίποτα */
    }
    $("app").hidden = true;
    $("sheet").hidden = true;
    // Η αναζήτηση καθαρίζει: ο επόμενος ξεκινάει από ολόκληρη τη λίστα και
    // δεν βλέπει τι έψαξε ο προηγούμενος.
    $("login-search").value = "";
    if (state.cfg) fillStaffSelect($("login-staff"), true, "");
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
    // Τα μόνιμα στοιχεία όλων τα βλέπει το αφεντικό και όποιος φτιάχνει το
    // πρόγραμμα. Ο διακομιστής ούτως ή άλλως δεν τα στέλνει στους υπόλοιπους.
    const seesPeople = isAdmin || state.me.role === "planner";
    document.querySelector('[data-view="people"]').hidden = !seesPeople;
    document.querySelector('[data-view="admin"]').hidden = !isAdmin;
    if (!seesPeople && state.view === "people") setView("mine");
    if (!isAdmin) {
      // Αν πριν ήταν συνδεδεμένος ο υπεύθυνος στην ίδια συσκευή, δεν αφήνουμε
      // τα δικά του πράγματα στη σελίδα.
      if (state.view === "admin") setView("mine");
      $("admin-calendar").innerHTML = "";
      $("admin-locked").innerHTML = "";
    }
    if (!state.month) state.month = currentMonth(state.cfg.today);
    if (!state.week) state.week = mondayOf(state.cfg.today);
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

  /** Το σύντομο: τι ζήτησε. Μπαίνει μέσα στην ετικέτα. */
  function shortOf(d) {
    if (d.kind === "off") return "ΡΕΠΟ";
    if (d.kind === "limited") return `${d.from}–${d.to}`;
    return "σημείωση";
  }

  /**
   * Μία γραμμή: ετικέτα με το τι ζήτησε, και από κάτω ο λόγος με δικά του
   * λόγια. Ο λόγος μπαίνει ξεχωριστά και όχι μέσα στην ετικέτα, γιατί σε
   * κινητό μια ολόκληρη πρόταση μέσα σε στρογγυλή ετικέτα γίνεται δυσανάγνωστη.
   */
  function requestRow(d, who) {
    const row = document.createElement("div");
    row.className = "who";
    const label = who ? `<b>${escape(who)}</b> · ${shortOf(d)}` : `<b>${shortOf(d)}</b>`;
    row.appendChild(chip(d.kind, label));
    if (d.note) {
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = d.note;
      row.appendChild(why);
    }
    return row;
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
      item.appendChild(requestRow(d, ""));
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
      item.appendChild(head);

      const rows = document.createElement("div");
      rows.className = "who-list";
      if (facts.locked) {
        const locked = document.createElement("div");
        locked.className = "who";
        locked.appendChild(chip("locked", `🔒 ${escape(facts.locked)}`));
        rows.appendChild(locked);
      }
      for (const entry of facts.all) {
        rows.appendChild(requestRow(entry, nameOf(entry.id)));
      }
      item.appendChild(rows);
      box.appendChild(item);
    }

    if (!shown) {
      box.innerHTML = '<p class="empty">Κανένα αίτημα για αυτόν τον μήνα ακόμα.</p>';
    }
  }

  /**
   * Ένα κουτί ανά εργαζόμενο: τι θέλει γενικά τον μήνα, και όλες του οι μέρες
   * μαζεμένες. Εμφανίζονται ΟΛΟΙ, ακόμα κι όσοι δεν δήλωσαν τίποτα — ώστε να
   * φαίνεται ποιος λείπει πριν κλείσει το πρόγραμμα.
   */
  function renderPeople() {
    const box = $("people-list");
    box.innerHTML = "";
    const people = state.data.people || {};

    for (const p of state.cfg.staff) {
      const note = (people[p.id] && people[p.id].note) || "";

      const item = document.createElement("div");
      item.className = "item";

      const head = document.createElement("div");
      head.className = "item-head";
      const who = document.createElement("span");
      who.className = "date";
      who.textContent = p.team ? `${p.name} · ${p.team}` : p.name;
      head.appendChild(who);
      item.appendChild(head);

      if (note) {
        const wish = document.createElement("p");
        wish.className = "wish";
        wish.textContent = `“${note}”`;
        item.appendChild(wish);
      } else {
        const none = document.createElement("p");
        none.className = "empty";
        none.style.margin = "0";
        none.textContent = "Δεν έχει γράψει τι θέλει.";
        item.appendChild(none);
      }

      box.appendChild(item);
    }
  }

  /* ============================================================
     ΤΟ ΠΡΟΓΡΑΜΜΑ ΤΗΣ ΕΒΔΟΜΑΔΑΣ
     ============================================================
     Ο πίνακας που κρεμιέται στην κουζίνα, σε οθόνη: κάτω από κάθε μέρα,
     δίπλα σε κάθε όνομα, η ώρα που μπαίνει και η ώρα που σχολάει.
     Οι γραμμές είναι χωρισμένες σε τμήματα, με τη σειρά που γράφτηκαν
     στο company-data.js. Άδειο κουτάκι = ρεπό. */

  async function loadWeek() {
    say("Φορτώνει…");
    try {
      state.rota = await api("week", { week: state.week });
      say("");
      renderWeek();
    } catch (e) {
      say(e.message, true);
    }
  }

  /** Πόσα λεπτά κρατάει ένα ωράριο. Αν η ώρα που σχολάει είναι «μικρότερη»
      από την ώρα που μπήκε, περνάει τα μεσάνυχτα (18:00 → 00:00). */
  function spanMinutes(from, to) {
    const a = Number(from.slice(0, 2)) * 60 + Number(from.slice(3));
    let b = Number(to.slice(0, 2)) * 60 + Number(to.slice(3));
    if (b <= a) b += 24 * 60;
    return b - a;
  }

  /** Τα ωράρια μιας βάρδιας: ένα, ή δύο αν είναι σπαστή. Καθένα με το δικό
      του σχόλιο — στο σπαστό ωράριο η δουλειά αλλάζει μέσα στην ίδια μέρα. */
  function partsOf(shift) {
    const parts = [];
    if (shift.from && shift.to) {
      parts.push({ from: shift.from, to: shift.to, note: shift.note || "" });
    }
    if (shift.from2 && shift.to2) {
      parts.push({ from: shift.from2, to: shift.to2, note: shift.note2 || "" });
    }
    return parts;
  }

  /** Όλη η μέρα του εργαζόμενου σε λεπτά — και τα δύο ωράρια μαζί. */
  function shiftMinutes(shift) {
    return partsOf(shift).reduce((sum, p) => sum + spanMinutes(p.from, p.to), 0);
  }

  /** «12:00–16:00 & 18:00–23:00» — για τα μηνύματα και τις υποδείξεις. */
  function shiftText(shift) {
    return partsOf(shift).map((p) => `${p.from}–${p.to}`).join(" & ");
  }

  function hoursText(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}:${pad(m)}` : String(h);
  }

  /** Τι είχε ζητήσει ο εργαζόμενος για τη μέρα αυτή, με λόγια. */
  function wishText(w) {
    const why = w.note ? ` — ${w.note}` : "";
    if (w.kind === "off") return `ζήτησε ρεπό${why}`;
    if (w.kind === "limited") return `μπορεί ${w.from}–${w.to}${why}`;
    return w.note || "σημείωση";
  }

  function nameInRota(id) {
    const s = state.rota && state.rota.staff && state.rota.staff[id];
    return s ? s.name : id;
  }

  function renderWeek() {
    const data = state.rota;
    if (!data) return;
    const canPlan = Boolean(data.canPlan);
    // Η στήλη με τις ώρες είναι μόνο για τη διεύθυνση και τη λογίστρια.
    const showHours = Boolean(data.canSeeHours);

    disarmCopy();
    $("week-label").textContent = weekLabel(state.week);
    $("week-tools").hidden = !canPlan;

    // Όσο υπάρχει αντιγραμμένο ωράριο, ο πίνακας είναι σε «επικόλληση»: το
    // λέει η ταινία από πάνω, και υπάρχει πάντα το «Τέλος» για να σταματήσει.
    const pasting = Boolean(canPlan && state.clip);
    $("clip-bar").hidden = !pasting;
    if (pasting) {
      $("clip-what").textContent = `Αντιγραμμένο: ${clipText()} — πάτα ένα κουτάκι για να μπει.`;
    }
    $("week-help").textContent = (canPlan
      ? "Πάτα ένα κουτάκι και βάλε τι ώρα μπαίνει και τι ώρα σχολάει. Παύλα = ρεπό. Αν δουλεύει δύο φορές την ίδια μέρα, πάτα «Σπαστό ωράριο» — κάθε ωράριο έχει το δικό του σχόλιο (π.χ. «ταμείο» το πρωί, «σέρβις» το βράδυ). Για να μην ξαναγράφεις τα ίδια, πάτα «Αντιγραφή» σε μια βάρδια και μετά όσα κουτάκια θες. Το χρωματιστό σημαδάκι στη γωνία δείχνει τι είχε ζητήσει ο εργαζόμενος για εκείνη τη μέρα."
      : "Το πρόγραμμα της εβδομάδας, όπως το έφτιαξε η διεύθυνση. Παύλα = ρεπό. Η δική σου γραμμή είναι τονισμένη.")
      + " Σε κινητό σύρε τον πίνακα πλάγια για να δεις όλη την εβδομάδα.";

    const table = $("rota");
    table.innerHTML = "";
    table.classList.toggle("is-pasting", pasting);

    /* --- η γραμμή με τις μέρες --- */
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

    const corner = document.createElement("th");
    corner.className = "name-col";
    corner.textContent = "ΟΝΟΜΑ";
    headRow.appendChild(corner);

    data.days.forEach((day, i) => {
      const cell = document.createElement("th");
      cell.className = "day-col";
      if (day === data.today) cell.classList.add("is-today");
      if (data.lockedDays[day]) {
        cell.classList.add("is-locked");
        cell.title = `Κλειδωμένη μέρα: ${data.lockedDays[day]}`;
      }
      const wd = document.createElement("span");
      wd.className = "wd";
      wd.textContent = WEEKDAYS_2[i];
      const dn = document.createElement("span");
      dn.className = "dn";
      dn.textContent = String(Number(day.slice(8)));
      cell.append(wd, dn);
      headRow.appendChild(cell);
    });

    if (showHours) {
      const sumHead = document.createElement("th");
      sumHead.className = "sum-col";
      sumHead.textContent = "ΩΡΕΣ";
      headRow.appendChild(sumHead);
    }

    head.appendChild(headRow);
    table.appendChild(head);

    /* --- οι γραμμές, τμήμα-τμήμα --- */
    const body = document.createElement("tbody");
    for (const group of data.groups) {
      if (group.name) {
        const row = document.createElement("tr");
        row.className = "group";
        const cell = document.createElement("th");
        cell.colSpan = data.days.length + (showHours ? 2 : 1);
        // Σε <span> για να μένει ο τίτλος ορατός όσο σέρνεις τον πίνακα πλάγια.
        const label = document.createElement("span");
        label.textContent = group.name;
        cell.appendChild(label);
        row.appendChild(cell);
        body.appendChild(row);
      }
      for (const id of group.ids) body.appendChild(rotaRow(id, canPlan, showHours));
    }
    table.appendChild(body);
  }

  function rotaRow(id, canPlan, showHours) {
    const data = state.rota;
    const row = document.createElement("tr");
    if (id === state.me.id) row.className = "is-me";

    const name = document.createElement("th");
    name.className = "name-col";
    name.scope = "row";
    name.textContent = nameInRota(id);
    row.appendChild(name);

    const shifts = data.shifts[id] || {};
    const wishes = data.requests[id] || {};
    let minutes = 0;

    for (const day of data.days) {
      const td = document.createElement("td");
      if (day === data.today) td.classList.add("is-today");

      const shift = shifts[day];
      const wish = wishes[day];
      const locked = data.lockedDays[day];

      // Όποιος δεν γράφει το πρόγραμμα παίρνει απλό κουτάκι, όχι κουμπί —
      // για να μην του φαίνεται ότι μπορεί να το αλλάξει.
      const box = document.createElement(canPlan ? "button" : "span");
      box.className = "cell";
      if (canPlan) box.type = "button";
      if (locked) box.classList.add("is-locked");

      // Κάθε ωράριο μπαίνει στη δική του σειρά, με την ίδια διάταξη που έχει
      // και το χαρτί: μπαίνει πάνω-αριστερά, σχολάει κάτω-δεξιά. Το σπαστό
      // ωράριο είναι απλώς δύο τέτοιες σειρές.
      const parts = shift ? partsOf(shift) : [];
      for (const part of parts) {
        const block = document.createElement("span");
        block.className = "part";
        const from = document.createElement("span");
        from.className = "t-from";
        from.textContent = part.from;
        const to = document.createElement("span");
        to.className = "t-to";
        to.textContent = part.to;
        block.append(from, to);
        // Το σχόλιο γράφεται μέσα στο κουτάκι, κάτω από τις δικές του ώρες:
        // αλλιώς δεν θα το έβλεπε κανείς από το κινητό του, και στο σπαστό
        // ωράριο δεν θα ήξερε σε ποιο από τα δύο αναφέρεται.
        if (part.note) {
          const note = document.createElement("span");
          note.className = "c-note";
          note.textContent = part.note;
          block.appendChild(note);
        }
        box.appendChild(block);
      }
      if (!parts.length) {
        const none = document.createElement("span");
        none.className = "t-none";
        none.textContent = "–";
        box.appendChild(none);
        // Σχόλιο σε μέρα ρεπό: εξηγεί γιατί λείπει ο άνθρωπος.
        if (shift && shift.note) {
          const note = document.createElement("span");
          note.className = "c-note";
          note.textContent = shift.note;
          box.appendChild(note);
        }
      }
      if (shift) minutes += shiftMinutes(shift);

      const notes = [];
      if (shift) notes.push(...[shift.note, shift.note2].filter(Boolean));
      if (wish) {
        box.classList.add(`wish-${wish.kind}`);
        notes.push(wishText(wish));
      }
      if (locked) notes.push(`κλειδωμένη: ${locked}`);
      const label = `${nameInRota(id)} · ${dateLabel(day)}${parts.length ? ` · ${shiftText(shift)}` : " · ρεπό"}`;
      box.title = notes.length ? `${label} · ${notes.join(" · ")}` : label;
      box.setAttribute("aria-label", box.title);

      // Σε λειτουργία επικόλλησης το πάτημα βάζει το αντιγραμμένο ωράριο·
      // αλλιώς ανοίγει το παραθυράκι για να το γράψεις.
      if (canPlan) {
        box.addEventListener("click", () =>
          (state.clip ? pasteInto(id, day) : openShift(id, day)));
      }
      td.appendChild(box);
      row.appendChild(td);
    }

    if (showHours) {
      const sum = document.createElement("td");
      sum.className = "sum-col";
      sum.textContent = minutes ? hoursText(minutes) : "";
      row.appendChild(sum);
    }
    return row;
  }

  /* ---- το παραθυράκι ενός κουτακιού ---- */

  function openShift(staffId, day) {
    const data = state.rota;
    state.shift = { staffId, day };

    const shift = (data.shifts[staffId] || {})[day];
    const wish = (data.requests[staffId] || {})[day];

    $("shift-title").textContent = `${nameInRota(staffId)} · ${dateLabel(day)}`;

    const info = [];
    if (data.lockedDays[day]) info.push(`🔒 Κλειδωμένη μέρα: ${data.lockedDays[day]}`);
    if (wish) info.push(wishText(wish));
    $("shift-info").textContent = info.join(" · ") || "Δεν έχει ζητήσει τίποτα για αυτή τη μέρα.";

    $("shift-from").value = (shift && shift.from) || "";
    $("shift-to").value = (shift && shift.to) || "";
    $("shift-from2").value = (shift && shift.from2) || "";
    $("shift-to2").value = (shift && shift.to2) || "";
    $("shift-note").value = (shift && shift.note) || "";
    $("shift-note2").value = (shift && shift.note2) || "";
    // Το δεύτερο ωράριο φαίνεται μόνο αν υπάρχει ήδη· αλλιώς το ανοίγει το
    // κουμπί, για να μη ζητάμε τέσσερις ώρες από όποιον θέλει δύο.
    showSplit(Boolean(shift && shift.from2));
    $("shift-clear").hidden = !shift;
    $("shift-error").hidden = true;
    $("shift-sheet").hidden = false;
  }

  /* ---- αντιγραφή ωραρίου ----
     Τα ίδια ωράρια επαναλαμβάνονται συνέχεια: ο ίδιος άνθρωπος πέντε μέρες
     στην ίδια βάρδια, ή όλη η κουζίνα στο ίδιο ωράριο. Αντί να γράφεται
     ξανά και ξανά, αντιγράφεται μία φορά και μετά μπαίνει με ΕΝΑ πάτημα σε
     όσα κουτάκια θέλει — γι' αυτό η επικόλληση δεν περνάει από το
     παραθυράκι: θα ήταν τρία πατήματα αντί για ένα. */

  function copyShift() {
    const read = readShiftFields();
    if (read.error) return shiftError(read.error);
    if (!read.shift.from) {
      return shiftError("Δεν υπάρχει ωράριο για αντιγραφή — βάλε πρώτα ώρες.");
    }
    state.clip = read.shift;
    $("shift-sheet").hidden = true;
    renderWeek();
    say("Αντιγράφηκε. Πάτα όποιο κουτάκι θες για να μπει — όσες φορές θες.");
  }

  function clipText() {
    const c = state.clip;
    if (!c) return "";
    const parts = partsOf({ ...c, note2: c.note2 })
      .map((p) => (p.note ? `${p.from}–${p.to} ${p.note}` : `${p.from}–${p.to}`));
    return parts.join(" & ");
  }

  /** Βάζει το αντιγραμμένο ωράριο σε ένα κουτάκι, χωρίς ερωτήσεις. */
  async function pasteInto(staffId, day) {
    try {
      state.rota = await api("saveShift", { staffId, day, week: state.week, ...state.clip });
      renderWeek();
      say(`${nameInRota(staffId)} · ${dayShort(day)}: ${clipText()}`);
    } catch (e) {
      say(e.message, true);
    }
  }

  function stopPaste() {
    state.clip = null;
    renderWeek();
    say("");
  }

  /** Δείχνει ή κρύβει το δεύτερο ωράριο (σπαστό). Κρύβοντάς το, το αδειάζει. */
  function showSplit(on) {
    $("shift-second").hidden = !on;
    $("shift-split").textContent = on ? "Σβήσε το δεύτερο ωράριο" : "+ Σπαστό ωράριο";
    $("shift-split").classList.toggle("is-armed", on);
    if (!on) {
      $("shift-from2").value = "";
      $("shift-to2").value = "";
      $("shift-note2").value = "";
    }
  }

  function shiftError(text) {
    const el = $("shift-error");
    el.textContent = text;
    el.hidden = false;
  }

  /**
   * Διαβάζει το παραθυράκι της βάρδιας. Επιστρέφει { shift } ή { error }.
   * Οι ίδιοι έλεγχοι ξαναγίνονται στον διακομιστή — εδώ είναι μόνο για να
   * πάρει ο χρήστης απάντηση αμέσως, χωρίς να περιμένει το δίκτυο.
   */
  function readShiftFields() {
    const shift = {
      from: $("shift-from").value,
      to: $("shift-to").value,
      note: $("shift-note").value.trim(),
      from2: $("shift-from2").value,
      to2: $("shift-to2").value,
      note2: $("shift-note2").value.trim(),
    };
    // Σκέτο σχόλιο σε μέρα ρεπό επιτρέπεται — εξηγεί γιατί λείπει ο άνθρωπος.
    if (!shift.from && !shift.to && !shift.note) {
      return { error: "Συμπλήρωσε τις ώρες ή γράψε ένα σχόλιο. Για ρεπό, πάτα «Ρεπό»." };
    }
    if ((shift.from && !shift.to) || (shift.to && !shift.from)) {
      return { error: "Συμπλήρωσε και τις δύο ώρες του πρώτου ωραρίου." };
    }
    if ((shift.from2 && !shift.to2) || (shift.to2 && !shift.from2)) {
      return { error: "Συμπλήρωσε και τις δύο ώρες του δεύτερου ωραρίου." };
    }
    if (!shift.from2 && shift.note2) {
      return { error: "Το σχόλιο του δεύτερου ωραρίου θέλει και ώρες." };
    }
    return { shift };
  }

  async function saveShift() {
    const read = readShiftFields();
    if (read.error) return shiftError(read.error);
    const { staffId, day } = state.shift;
    await sendWeek("saveShift", { staffId, day, ...read.shift }, "Μπήκε στο πρόγραμμα.");
  }

  async function clearShift() {
    const { staffId, day } = state.shift;
    await sendWeek("saveShift", { staffId, day, kind: "clear" }, "Μπήκε ρεπό.");
  }

  /** Στέλνει, ξαναζωγραφίζει τον πίνακα, κλείνει το παραθυράκι. */
  async function sendWeek(action, payload, okText) {
    $("shift-save").disabled = true;
    try {
      state.rota = await api(action, { ...payload, week: state.week });
      $("shift-sheet").hidden = true;
      renderWeek();
      say(okText);
      setTimeout(() => {
        if ($("status").textContent === okText) say("");
      }, 2500);
    } catch (e) {
      shiftError(e.message);
    } finally {
      $("shift-save").disabled = false;
    }
  }

  /**
   * Οι περισσότερες εβδομάδες μοιάζουν μεταξύ τους. Αντί να ξαναγράφει ο
   * υπεύθυνος 25 άτομα επί 7 μέρες, αντιγράφει και διορθώνει τις αλλαγές.
   */
  let copyArmed = 0;

  async function copyPrevWeek() {
    const btn = $("week-copy");

    // Σβήνει ό,τι υπάρχει ήδη, άρα θέλει επιβεβαίωση. Δεύτερο πάτημα στο ίδιο
    // κουμπί αντί για παραθυράκι του browser: σε κινητό δουλεύει παντού.
    //
    // Η προειδοποίηση μπαίνει ΜΕΣΑ στο κουμπί και όχι από πάνω του: αν
    // εμφανιζόταν μήνυμα πιο πάνω στη σελίδα, το κουμπί θα κατέβαινε και το
    // δεύτερο πάτημα θα έπεφτε στο κενό.
    if (!copyArmed) {
      copyArmed = setTimeout(disarmCopy, 8000);
      btn.textContent = "Σίγουρα; Πάτα ξανά";
      btn.classList.add("is-armed");
      return;
    }
    disarmCopy();

    btn.disabled = true;
    try {
      state.rota = await api("copyWeek", { week: state.week });
      renderWeek();
      say("Αντιγράφηκε η προηγούμενη εβδομάδα. Τώρα διόρθωσε μόνο ό,τι αλλάζει.");
    } catch (e) {
      say(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function disarmCopy() {
    clearTimeout(copyArmed);
    copyArmed = 0;
    const btn = $("week-copy");
    btn.textContent = "Αντίγραψε την προηγούμενη εβδομάδα";
    btn.classList.remove("is-armed");
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

    const mine = (state.data.people && state.data.people[state.me.id]) || {};

    // Το «τι θέλω γενικά» θέλει ξεχωριστό πάτημα για να αποθηκευτεί. Αν ο
    // χρήστης έχει ήδη γράψει κάτι και δεν το έχει αποθηκεύσει, ΔΕΝ του το
    // σβήνουμε επειδή έτυχε να ξαναζωγραφιστεί η σελίδα (π.χ. μόλις
    // καταχώρησε μια μέρα) — αλλιώς χάνει ό,τι έγραψε χωρίς να το καταλάβει.
    const noteBox = $("my-note");
    const savedNote = mine.note || "";
    if (noteBox.value === (noteBox.dataset.saved || "")) noteBox.value = savedNote;
    noteBox.dataset.saved = savedNote;
    showNoteState();

    // Η προθεσμία αφορά μόνο τα αιτήματα του μήνα. Το «τι θέλω γενικά» δεν
    // ανήκει σε μήνα, οπότε γράφεται όποτε να 'ναι.
    const closed = state.data.closed && state.me.role !== "admin";
    if (closed) {
      say(`Η προθεσμία για ${monthLabel(state.month)} έχει περάσει — μίλα στη διεύθυνση.`, true);
    }

    renderCalendar($("calendar"), false);
    renderMyList();
    renderAllDays();
    if (state.data.canSeePeople) renderPeople();
    else $("people-list").innerHTML = "";
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
      // Κάθε φορά που ανοίγει η μέρα, η αναζήτηση ξεκινάει καθαρή και
      // διαλεγμένος είναι ο ίδιος — η συνηθισμένη περίπτωση.
      $("sheet-search").value = "";
      $("sheet-search-row").hidden = state.cfg.staff.length <= 8;
      fillStaffSelect($("sheet-staff"), false);
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

  /** Άλλαξε το άτομο στο «Για ποιον;»: δείξε τι έχει δηλώσει εκείνο. */
  function showPickedStaff() {
    const entries = (state.data && state.data.entries) || {};
    const who = $("sheet-staff").value;
    const d = entries[who] && entries[who].days ? entries[who].days[state.sheet.day] : null;
    preselect(d);
    $("sheet-clear").hidden = !d;
    $("sheet-error").hidden = true;
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
    // Με την αναζήτηση η λίστα μπορεί να μείνει άδεια. Χωρίς αυτόν τον έλεγχο
    // θα στέλναμε κενό άτομο και ο διακομιστής θα το χρέωνε στον ίδιο τον
    // διαχειριστή — σιωπηλά, σε λάθος άνθρωπο.
    if (state.me.role === "admin") {
      if (!$("sheet-staff").value) return sheetError("Διάλεξε για ποιον δηλώνεις.");
      payload.staffId = $("sheet-staff").value;
    }

    await send("saveDay", payload, "Καταχωρήθηκε.");
  }

  async function clearSheet() {
    const payload = { day: state.sheet.day, kind: "clear" };
    if (state.me.role === "admin") {
      if (!$("sheet-staff").value) return sheetError("Διάλεξε για ποιον δηλώνεις.");
      payload.staffId = $("sheet-staff").value;
    }
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
      // Άλλαξαν τα αιτήματα ή οι κλειδωμένες μέρες: ο πίνακας του
      // προγράμματος τα δείχνει, οπότε θα ξαναφορτωθεί φρέσκος.
      state.rota = null;
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

  /** Δείχνει την προειδοποίηση όσο η σημείωση του μήνα είναι αναποθήκευτη. */
  function showNoteState() {
    const box = $("my-note");
    $("note-unsaved").hidden = box.value === (box.dataset.saved || "");
  }

  async function saveMyNote() {
    $("save-note").disabled = true;
    try {
      state.data = await api("saveProfile", { month: state.month, note: $("my-note").value });
      // Δείχνουμε ακριβώς ό,τι αποθηκεύτηκε, ώστε να μη μείνει η σελίδα να λέει
      // "αναποθήκευτο" για ένα κενό που κόπηκε στο καθάρισμα.
      const stored = ((state.data.people || {})[state.me.id] || {}).note || "";
      $("my-note").value = stored;
      $("my-note").dataset.saved = stored;
      render();
      say("Αποθηκεύτηκε. Ισχύει για κάθε μήνα.");
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
    $("view-week").hidden = view !== "week";
    $("view-all").hidden = view !== "all";
    $("view-people").hidden = view !== "people";
    $("view-admin").hidden = view !== "admin";

    // Κάθε καρτέλα έχει τη δική της μπάρα: μήνα ή εβδομάδα. Στους
    // «Εργαζόμενους» καμία — τα στοιχεία τους είναι μόνιμα.
    $("month-bar").hidden = view === "people" || view === "week";
    $("week-bar").hidden = view !== "week";

    // Το πρόγραμμα το φορτώνουμε την πρώτη φορά που θα το ζητήσει κάποιος,
    // για να μη φορτώνει δύο πράγματα κάθε φορά που μπαίνει στην εφαρμογή.
    if (view === "week" && !state.rota) loadWeek();
  }

  /* ---------------- σύνδεση γεγονότων ---------------- */

  function wire() {
    $("login-go").addEventListener("click", doLogin);
    $("login-pin").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });

    $("login-search").addEventListener("input", () => {
      fillStaffSelect($("login-staff"), true, $("login-search").value);
      $("login-error").hidden = true;
    });
    $("login-search").addEventListener("keydown", (e) => {
      // Enter μέσα στην αναζήτηση: πήγαινε στο PIN, μη στέλνεις τη φόρμα.
      if (e.key !== "Enter") return;
      e.preventDefault();
      if ($("login-staff").value) $("login-pin").focus();
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

    $("week-prev").addEventListener("click", () => {
      state.week = shiftWeek(state.week, -1);
      loadWeek();
    });
    $("week-next").addEventListener("click", () => {
      state.week = shiftWeek(state.week, 1);
      loadWeek();
    });
    $("week-copy").addEventListener("click", copyPrevWeek);

    $("shift-save").addEventListener("click", saveShift);
    $("shift-copy").addEventListener("click", copyShift);
    $("clip-done").addEventListener("click", stopPaste);
    $("shift-clear").addEventListener("click", clearShift);
    $("shift-split").addEventListener("click", () => {
      showSplit($("shift-second").hidden);
      $("shift-error").hidden = true;
    });
    $("shift-close").addEventListener("click", () => {
      $("shift-sheet").hidden = true;
    });
    $("shift-sheet").addEventListener("click", (e) => {
      if (e.target === $("shift-sheet")) $("shift-sheet").hidden = true;
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
      if (e.key !== "Escape") return;
      $("sheet").hidden = true;
      $("shift-sheet").hidden = true;
    });

    $("sheet-do-lock").addEventListener("click", () =>
      setLock(state.sheet.day, true, $("sheet-reason").value));
    $("sheet-do-unlock").addEventListener("click", () =>
      setLock(state.sheet.day, false, ""));

    // Ο admin αλλάζει άτομο: δείξε τι έχει δηλώσει εκείνος.
    $("sheet-staff").addEventListener("change", showPickedStaff);

    $("sheet-search").addEventListener("input", () => {
      // Αν η αναζήτηση αφήσει έναν, διαλέγεται μόνος του· αν αλλάξει ο
      // διαλεγμένος, πρέπει να αλλάξει και το τι δείχνει από κάτω.
      if (fillStaffSelect($("sheet-staff"), false, $("sheet-search").value)) showPickedStaff();
      else $("sheet-error").hidden = true;
    });
    $("sheet-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });

    $("save-note").addEventListener("click", saveMyNote);
    $("my-note").addEventListener("input", showNoteState);
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
    // Σε μικρή επιχείρηση η αναζήτηση είναι περιττή — χωράνε όλοι στη ματιά.
    // Από εννιά άτομα και πάνω αρχίζει το ψάξιμο, οπότε εμφανίζεται.
    $("login-search-row").hidden = state.cfg.staff.length <= 8;
    fillStaffSelect($("login-staff"), true, "");
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
