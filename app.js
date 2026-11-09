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
    openAsks: new Set(), // ποια ονόματα είναι ανοιχτά στο «Ζήτησαν κάτι»
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
    // Η «Διαχείριση»: η διεύθυνση τα βλέπει όλα. Ο υπεύθυνος προγράμματος
    // (λογίστρια) βλέπει μόνο το «Σβήσιμο»· το κλείδωμα ημερών μένει της
    // διεύθυνσης (το ελέγχει και ο διακομιστής).
    const seesAdminTab = seesPeople;
    document.querySelector('[data-view="admin"]').hidden = !seesAdminTab;
    $("admin-locks-block").hidden = !isAdmin;
    $("admin-deadline-block").hidden = !isAdmin;
    $("admin-clear-block").hidden = !seesAdminTab;
    $("admin-accounts-block").hidden = !seesAdminTab;
    $("admin-events-block").hidden = !isAdmin;
    if (seesAdminTab) setupClear();
    if (!seesPeople && state.view === "people") setView("mine");
    if (!seesAdminTab && state.view === "admin") setView("mine");
    if (!isAdmin) {
      // Αν πριν ήταν συνδεδεμένος ο υπεύθυνος στην ίδια συσκευή, δεν αφήνουμε
      // τα δικά του πράγματα στη σελίδα.
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

  function canWriteNotes() {
    return state.me.role === "admin" || state.me.role === "planner";
  }

  /**
   * «Ανακοινώσεις» στα «Τα δικά μου»: οι σημειώσεις που έγραψαν στο όνομά
   * τους η διεύθυνση και ο υπεύθυνος προγράμματος. Τις βλέπουν όλοι.
   */
  function renderMyNews() {
    const box = $("my-news");
    box.innerHTML = "";
    const staff = state.data.staff || {};
    const items = [];
    for (const [id, entry] of Object.entries(state.data.entries || {})) {
      const role = staff[id] && staff[id].role;
      if (role !== "admin" && role !== "planner") continue;
      for (const [key, d] of Object.entries((entry && entry.days) || {})) {
        if (d.kind === "note") items.push({ key, id, d });
      }
    }
    items.sort((a, b) => a.key.localeCompare(b.key));
    $("my-news-block").hidden = !items.length;
    for (const { key, id, d } of items) {
      const item = document.createElement("div");
      item.className = "item";
      const head = document.createElement("div");
      head.className = "item-head";
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = dateLabel(key);
      head.appendChild(date);
      item.appendChild(head);
      item.appendChild(requestRow(d, nameOf(id)));
      box.appendChild(item);
    }
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
    renderWeekAsks(canPlan);
    renderWeekEvents();

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
      const evs = (data.events || []).filter((e) => e.day === day);
      if (evs.length) {
        const mark = document.createElement("span");
        mark.className = "ev";
        mark.textContent = evs.length > 1 ? `🎉${evs.length}` : "🎉";
        cell.title = [cell.title, ...evs.map((e) => e.title)].filter(Boolean).join(" · ");
        mark.setAttribute("aria-label", `${evs.length} πάρτι/κρατήσεις`);
        cell.appendChild(mark);
      }
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
    const post = data.staff && data.staff[id] && data.staff[id].post;
    if (post) {
      const tag = document.createElement("span");
      tag.className = "rota-post";
      tag.textContent = post;
      name.appendChild(tag);
    }
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
    renderEventEditors();

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

  /* ---------------- πάρτι & κρατήσεις ----------------
     Τα βλέπουν όλοι στο «Πρόγραμμα». Τα γράφουν η διεύθυνση, ο υπεύθυνος
     προγράμματος και όσοι πάρουν άδεια. Τα τμήματα που διαλέγει κάθε πάρτι
     βλέπουν ειδοποίηση στα «Τα δικά μου» τις 7 μέρες πριν. */

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  /** «Σήμερα», «Αύριο» ή «Σε 3 μέρες» — για την ειδοποίηση. */
  function whenBadge(day, today) {
    const diff = Math.round((dateOf(day) - dateOf(today)) / 86400000);
    if (diff === 0) return "Σήμερα";
    if (diff === 1) return "Αύριο";
    return `Σε ${diff} μέρες`;
  }

  function eventCard(ev, opts) {
    const o = opts || {};
    const item = document.createElement("div");
    item.className = "item event";
    if (ev.day === o.today) item.classList.add("is-today");

    const head = document.createElement("div");
    head.className = "item-head";
    const when = document.createElement("span");
    when.className = "event-when";
    const hours = !ev.from ? "" : ev.to ? ` · ${ev.from}–${ev.to}` : ` · από ${ev.from}`;
    when.innerHTML = (o.badge ? `<span class="event-badge">${escape(o.badge)}</span>` : "")
      + escape(dateLabel(ev.day) + hours);
    head.appendChild(when);
    if (o.onEdit) {
      const edit = document.createElement("button");
      edit.className = "ghost small";
      edit.textContent = "Αλλαγή";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        o.onEdit(ev);
      });
      head.appendChild(edit);
    }
    item.appendChild(head);

    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = `🎉 ${ev.title}`;
    item.appendChild(title);

    const counts = document.createElement("div");
    counts.className = "event-counts";
    if (ev.kids) counts.appendChild(chip("", `<b>${plural(ev.kids, "παιδί", "παιδιά")}</b>`));
    if (ev.adults) counts.appendChild(chip("", `<b>${plural(ev.adults, "μεγάλος", "μεγάλοι")}</b>`));
    if (ev.kids && ev.adults) counts.appendChild(chip("", `σύνολο ${ev.kids + ev.adults}`));
    if (counts.childNodes.length) item.appendChild(counts);

    if (ev.description && !o.compact) {
      const d = document.createElement("div");
      d.className = "event-text";
      d.textContent = ev.description;
      item.appendChild(d);
    }
    if (ev.menu && !o.compact) {
      const l = document.createElement("span");
      l.className = "event-label";
      l.textContent = "Μενού";
      const m = document.createElement("div");
      m.className = "event-text";
      m.textContent = ev.menu;
      item.append(l, m);
    }
    if (ev.teams && ev.teams.length && !o.compact) {
      const t = document.createElement("div");
      t.className = "event-teams";
      t.textContent = `Ειδοποιούνται: ${ev.teams.join(", ")}`;
      item.appendChild(t);
    }
    return item;
  }

  function renderWeekEvents() {
    const data = state.rota;
    const list = data.events || [];
    const box = $("week-events");
    box.innerHTML = "";
    $("event-add").hidden = !data.canEvents;
    $("week-events-block").hidden = !list.length && !data.canEvents;
    if (!list.length) {
      box.innerHTML = '<p class="empty">Κανένα πάρτι ή κράτηση αυτή την εβδομάδα.</p>';
      return;
    }
    for (const ev of list) {
      box.appendChild(eventCard(ev, {
        today: data.today,
        onEdit: data.canEvents ? openEvent : null,
      }));
    }
  }

  /** Ειδοποιήσεις στα «Τα δικά μου»: πατάς και πας στο πρόγραμμα εκείνης της μέρας. */
  function renderAlerts() {
    const list = state.data.alerts || [];
    const box = $("alerts");
    box.innerHTML = "";
    $("alerts-block").hidden = !list.length;
    for (const ev of list) {
      const card = eventCard(ev, {
        today: state.data.today,
        badge: whenBadge(ev.day, state.data.today),
        compact: false,
      });
      card.title = "Δες το στο πρόγραμμα";
      card.addEventListener("click", () => {
        state.week = mondayOf(ev.day);
        state.rota = null;
        setView("week");
      });
      box.appendChild(card);
    }
  }

  function openEvent(ev) {
    const e = ev || {};
    state.event = { id: e.id || "", oldDay: e.day || "" };
    $("event-sheet-title").textContent = e.id ? "Αλλαγή πάρτι / κράτησης" : "Νέο πάρτι / κράτηση";
    $("event-title").value = e.title || "";
    // Νέο: προτείνεται σήμερα αν είναι μέσα στην εβδομάδα, αλλιώς η Δευτέρα της.
    const today = state.rota.today;
    const inWeek = state.rota.days.includes(today);
    $("event-day").value = e.day || (inWeek ? today : state.week);
    $("event-from").value = e.from || "";
    $("event-to").value = e.to || "";
    $("event-kids").value = e.kids ? String(e.kids) : "";
    $("event-adults").value = e.adults ? String(e.adults) : "";
    $("event-description").value = e.description || "";
    $("event-menu").value = e.menu || "";

    const teams = new Set(e.teams || []);
    const box = $("event-teams");
    box.innerHTML = "";
    for (const name of state.rota.departments || []) {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = name;
      input.checked = teams.has(name);
      label.append(input, ` ${name}`);
      box.appendChild(label);
    }
    if (!box.childNodes.length) box.innerHTML = '<p class="muted small">Δεν έχουν οριστεί τμήματα.</p>';

    $("event-delete").hidden = !e.id;
    $("event-error").hidden = true;
    $("event-sheet").hidden = false;
    $("event-title").focus();
  }

  function eventError(text) {
    $("event-error").textContent = text;
    $("event-error").hidden = false;
  }

  async function sendEvent(action, payload, okText) {
    $("event-save").disabled = true;
    try {
      state.rota = await api(action, { ...payload, week: state.week });
      $("event-sheet").hidden = true;
      renderWeek();
      // Οι ειδοποιήσεις στα «Τα δικά μου» έρχονται με τον μήνα.
      loadMonthQuiet();
      say(okText);
      setTimeout(() => {
        if ($("status").textContent === okText) say("");
      }, 2500);
    } catch (err) {
      eventError(err.message);
    } finally {
      $("event-save").disabled = false;
    }
  }

  async function loadMonthQuiet() {
    try {
      state.data = await api("month", { month: state.month });
      render();
    } catch {
      /* θα ξαναφορτωθεί με την επόμενη αλλαγή */
    }
  }

  function saveEvent() {
    const from = $("event-from").value;
    const to = $("event-to").value;
    if (to && !from) return eventError("Βάλε και τι ώρα ξεκινάει.");
    if (!$("event-title").value.trim()) return eventError("Γράψε τίτλο, π.χ. «Γενέθλια Μαρίας».");
    if (!$("event-day").value) return eventError("Διάλεξε μέρα.");
    const teams = [...document.querySelectorAll("#event-teams input:checked")].map((i) => i.value);
    sendEvent("saveEvent", {
      id: state.event.id || undefined,
      oldDay: state.event.oldDay || undefined,
      day: $("event-day").value,
      from,
      to,
      title: $("event-title").value,
      kids: $("event-kids").value,
      adults: $("event-adults").value,
      description: $("event-description").value,
      menu: $("event-menu").value,
      teams,
    }, "Αποθηκεύτηκε.");
  }

  function deleteEvent() {
    if (!state.event.id) return;
    if (!confirm("Να σβηστεί αυτό το πάρτι / κράτηση;")) return;
    sendEvent("deleteEvent", { id: state.event.id, day: state.event.oldDay }, "Σβήστηκε.");
  }

  /** Διαχείριση: ποιοι άλλοι γράφουν πάρτι & κρατήσεις. */
  function renderEventEditors() {
    const box = $("event-editors");
    box.innerHTML = "";
    const on = new Set(state.data.eventEditors || []);
    const staff = state.data.staff || {};
    for (const p of state.cfg.staff) {
      const role = staff[p.id] && staff[p.id].role;
      const always = role === "admin" || role === "planner";
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = always || on.has(p.id);
      input.disabled = always;
      input.addEventListener("change", () => setEventEditor(p.id, input.checked, input));
      label.append(input, ` ${p.name}`);
      if (always) {
        const note = document.createElement("span");
        note.className = "muted small";
        note.textContent = " — πάντα";
        label.appendChild(note);
      }
      box.appendChild(label);
    }
  }

  async function setEventEditor(staffId, on, input) {
    input.disabled = true;
    try {
      const out = await api("setEventEditor", { staffId, on });
      state.data.eventEditors = out.eventEditors;
      say(on ? "Δόθηκε άδεια." : "Αφαιρέθηκε η άδεια.");
      setTimeout(() => say(""), 2000);
    } catch (e) {
      input.checked = !on;
      say(e.message, true);
    } finally {
      input.disabled = false;
    }
  }

  /* ---------------- «Ζήτησαν κάτι αυτή την εβδομάδα» ----------------
     Για όσους φτιάχνουν το πρόγραμμα: τα ονόματα όσων έχουν αίτημα μέσα
     στην εβδομάδα που βλέπουν. Πατάς το όνομα και ανοίγει ακριβώς από κάτω
     τι ζήτησε, μέρα-μέρα. Οι ανακοινώσεις της διεύθυνσης δεν μετράνε. */

  function weekAsks() {
    const data = state.rota;
    const staff = data.staff || {};
    const order = [];
    for (const g of data.groups || []) order.push(...g.ids);
    for (const id of Object.keys(data.requests || {})) if (!order.includes(id)) order.push(id);

    const out = [];
    for (const id of order) {
      const role = staff[id] && staff[id].role;
      const boss = role === "admin" || role === "planner";
      const days = Object.entries((data.requests || {})[id] || {})
        .filter(([, w]) => !(boss && w.kind === "note"))
        .sort(([a], [b]) => a.localeCompare(b));
      if (days.length) out.push({ id, days });
    }
    return out;
  }

  function renderWeekAsks(canPlan) {
    const block = $("week-asks-block");
    const box = $("week-asks");
    box.innerHTML = "";
    block.hidden = !canPlan;
    if (!canPlan) return;

    const asks = weekAsks();
    if (!asks.length) {
      box.innerHTML = '<p class="empty">Κανείς δεν ζήτησε κάτι για αυτή την εβδομάδα.</p>';
      return;
    }
    for (const { id, days } of asks) {
      const item = document.createElement("div");
      item.className = "ask";
      const open = state.openAsks.has(id);
      item.classList.toggle("is-open", open);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ask-name";
      btn.setAttribute("aria-expanded", String(open));
      const kinds = [...new Set(days.map(([, w]) => w.kind))];
      btn.innerHTML = `<span class="ask-arrow" aria-hidden="true">▸</span>`
        + `<b>${escape(nameInRota(id))}</b>`
        + kinds.map((k) => `<i class="sw ${k}" aria-hidden="true"></i>`).join("")
        + `<span class="ask-count">${days.length}</span>`;

      const list = document.createElement("div");
      list.className = "ask-list";
      list.hidden = !open;
      for (const [day, w] of days) {
        const row = document.createElement("div");
        row.className = "ask-row";
        row.innerHTML = `<span class="date">${dateLabel(day)}</span>`;
        row.appendChild(requestRow(w, ""));
        list.appendChild(row);
      }

      btn.addEventListener("click", () => {
        const now = list.hidden;
        list.hidden = !now;
        item.classList.toggle("is-open", now);
        btn.setAttribute("aria-expanded", String(now));
        if (now) state.openAsks.add(id);
        else state.openAsks.delete(id);
      });
      item.append(btn, list);
      box.appendChild(item);
    }
  }

  /* ---------------- λογαριασμοί προσωπικού (Διαχείριση) ----------------
     Η διεύθυνση και ο υπεύθυνος προγράμματος βάζουν καινούργιους (όνομα +
     PIN που τους λέει ο ίδιος) και σβήνουν όσους φεύγουν. */

  async function loadAccounts() {
    try {
      showAccounts(await api("staffAccounts", {}));
    } catch (e) {
      say(e.message, true);
    }
  }

  function showAccounts(out) {
    state.accounts = out.accounts || [];
    if (out.config) {
      // Νέα λίστα ονομάτων παντού: σύνδεση, «Για ποιον;», σβήσιμο, πρόγραμμα.
      state.cfg = { ...state.cfg, staff: out.config.staff, staffGroups: out.config.staffGroups };
      fillStaffSelect($("login-staff"), true, "");
      fillStaffSelect($("clear-staff"), true);
    }

    state.posts = out.departments || [];
    state.subPosts = new Set(Object.values(out.subPosts || {}).flat());
    // Η φόρμα του καινούργιου: κρατάει ό,τι έχει ήδη τσεκαριστεί.
    const kept = state.newPosts ? state.newPosts.read() : { team: "", teams: [] };
    state.newPosts = postsEditor(state.posts, kept.team, kept.teams);
    $("acc-posts").replaceChildren(state.newPosts.el);

    const box = $("acc-list");
    box.innerHTML = "";
    const isAdmin = state.me.role === "admin";
    const ROLE = { admin: "διεύθυνση", planner: "υπεύθυνος προγράμματος" };
    for (const a of state.accounts) {
      const item = document.createElement("div");
      item.className = "item acc-item";
      const head = document.createElement("div");
      head.className = "item-head";
      item.appendChild(head);
      const text = document.createElement("span");
      const posts = a.team ? `★ ${a.team}` + (a.teams.length ? ` · ${a.teams.join(" · ")}` : "") : "χωρίς πόστο";
      text.innerHTML = `<b>${escape(a.name)}</b>`
        + (ROLE[a.role] ? ` <span class="muted small">${escape(ROLE[a.role])}</span>` : "")
        + `<span class="acc-posts-line small">${escape(posts)}</span>`;
      head.appendChild(text);
      const canRemove = a.id !== state.me.id && a.role !== "admin" && (a.role !== "planner" || isAdmin);
      const canPin = a.id === state.me.id || canRemove;
      const tools = document.createElement("span");
      tools.className = "acc-tools";
      const postBtn = document.createElement("button");
      postBtn.className = "ghost small";
      postBtn.textContent = "Πόστα";
      postBtn.addEventListener("click", () => togglePosts(a, item, postBtn));
      tools.appendChild(postBtn);
      if (canPin) {
        const pinBtn = document.createElement("button");
        pinBtn.className = "ghost small";
        pinBtn.textContent = "Αλλαγή PIN";
        pinBtn.addEventListener("click", () => changePin(a, pinBtn));
        tools.appendChild(pinBtn);
      }
      head.appendChild(tools);
      if (canRemove) {
        const btn = document.createElement("button");
        btn.className = "ghost small danger";
        btn.textContent = "Σβήσε";
        btn.addEventListener("click", () => removeAccount(a, btn));
        tools.appendChild(btn);
      }
      box.appendChild(item);
    }
  }

  function accountError(text) {
    const err = $("acc-error");
    err.textContent = text || "";
    err.hidden = !text;
  }

  async function addAccount() {
    const name = $("acc-name").value.trim();
    const pin = $("acc-pin").value.trim();
    if (!name) return accountError("Γράψε όνομα.");
    if (!/^\d{4}$/.test(pin)) return accountError("Το PIN πρέπει να είναι 4 ψηφία.");
    accountError("");
    $("acc-add").disabled = true;
    try {
      const posts = state.newPosts.read();
      state.newPosts = null; // ο επόμενος ξεκινάει με άδεια πόστα
      showAccounts(await api("addStaff", { name, pin, ...posts }));
      $("acc-name").value = "";
      $("acc-pin").value = "";
      state.rota = null; // να βγει και στον πίνακα του προγράμματος
      say(`Έτοιμος ο λογαριασμός «${name}». Μπαίνει με το όνομά του και το PIN ${pin}.`);
      setTimeout(() => say(""), 4000);
    } catch (e) {
      accountError(e.message);
    } finally {
      $("acc-add").disabled = false;
    }
  }

  /**
   * Επιλογή πόστων: ένα κουτάκι για κάθε πόστο που κάνει, και ένα ★ για το
   * βασικό. Το ★ τσεκάρει μόνο του και το κουτάκι· αν βγάλεις το κουτάκι του
   * βασικού, βασικό γίνεται το επόμενο τσεκαρισμένο.
   */
  function postsEditor(all, team, teams) {
    const el = document.createElement("div");
    el.className = "posts";
    const name = `main-${Math.random().toString(36).slice(2, 8)}`;
    const has = new Set([team, ...(teams || [])].filter(Boolean));
    const rows = [];

    const fixMain = () => {
      const main = rows.find((r) => r.star.checked);
      if (main && main.box.checked) return;
      if (main) main.star.checked = false;
      const first = rows.find((r) => r.box.checked);
      if (first) first.star.checked = true;
    };

    for (const post of all) {
      const row = document.createElement("div");
      row.className = "post-row";
      // Πόστο μέσα σε τμήμα (π.χ. «Σχάρα» στην «Παραγωγή»): λίγο πιο μέσα.
      if (state.subPosts && state.subPosts.has(post)) row.classList.add("is-sub");
      const label = document.createElement("label");
      label.className = "check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = has.has(post);
      label.append(box, ` ${post}`);

      const starLabel = document.createElement("label");
      starLabel.className = "post-star";
      starLabel.title = "Βασικό πόστο";
      const star = document.createElement("input");
      star.type = "radio";
      star.name = name;
      star.checked = post === team;
      starLabel.append(star, document.createTextNode(" ★ βασικό"));

      box.addEventListener("change", fixMain);
      star.addEventListener("change", () => { box.checked = true; });
      row.append(label, starLabel);
      el.appendChild(row);
      rows.push({ post, box, star });
    }
    if (!all.length) el.innerHTML = '<p class="muted small">Δεν έχουν οριστεί πόστα.</p>';
    fixMain();

    return {
      el,
      read() {
        const main = rows.find((r) => r.star.checked && r.box.checked);
        return {
          team: main ? main.post : "",
          teams: rows.filter((r) => r.box.checked && r !== main).map((r) => r.post),
        };
      },
    };
  }

  /** Ανοίγει / κλείνει την αλλαγή πόστων ακριβώς κάτω από το όνομα. */
  function togglePosts(a, item, btn) {
    const open = item.querySelector(".acc-edit");
    if (open) {
      open.remove();
      btn.classList.remove("is-on");
      return;
    }
    btn.classList.add("is-on");
    const box = document.createElement("div");
    box.className = "acc-edit";
    const editor = postsEditor(state.posts || [], a.team, a.teams);
    const save = document.createElement("button");
    save.className = "small";
    save.textContent = "Αποθήκευση πόστων";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        showAccounts(await api("setPosts", { staffId: a.id, ...editor.read() }));
        state.rota = null; // να μπει στη σωστή θέση στον πίνακα
        say(`Άλλαξαν τα πόστα του λογαριασμού «${a.name}».`);
        setTimeout(() => say(""), 3000);
      } catch (e) {
        save.disabled = false;
        say(e.message, true);
      }
    });
    box.append(editor.el, save);
    item.appendChild(box);
  }

  async function changePin(a, btn) {
    const mine = a.id === state.me.id;
    const pin = prompt(mine
      ? "Το νέο σου PIN (4 ψηφία):"
      : `Νέο PIN για «${a.name}» (4 ψηφία) — αυτό που θα σου πει ο ίδιος:`);
    if (pin === null) return;
    if (!/^\d{4}$/.test(pin.trim())) {
      say("Το PIN πρέπει να είναι 4 ψηφία. Δεν άλλαξε τίποτα.", true);
      return;
    }
    btn.disabled = true;
    try {
      showAccounts(await api("setPin", { staffId: a.id, pin: pin.trim() }));
      say(mine
        ? `Άλλαξε το PIN σου. Από την επόμενη σύνδεση μπαίνεις με ${pin.trim()}.`
        : `Άλλαξε το PIN του λογαριασμού «${a.name}». Μπαίνει πλέον με ${pin.trim()}.`);
      setTimeout(() => say(""), 4000);
    } catch (e) {
      btn.disabled = false;
      say(e.message, true);
    }
  }

  async function removeAccount(a, btn) {
    if (!confirm(`Να σβηστεί ο λογαριασμός «${a.name}»;\n\nΔεν θα μπορεί πια να μπει στην εφαρμογή. Ό,τι υπάρχει ήδη στα παλιά προγράμματα μένει.`)) return;
    btn.disabled = true;
    try {
      showAccounts(await api("removeStaff", { staffId: a.id }));
      state.rota = null;
      say(`Σβήστηκε ο λογαριασμός «${a.name}».`);
      setTimeout(() => say(""), 3000);
    } catch (e) {
      btn.disabled = false;
      say(e.message, true);
    }
  }

  /* ---------------- σβήσιμο (Διαχείριση) ----------------
     Ποτέ «τα πάντα»: διαλέγεις διάστημα (βάρδια ενός ατόμου, μέρα,
     εβδομάδα, μήνας) και τι σβήνεται. Ρωτάει πριν σβήσει. */

  let clearScope = "day";

  function setupClear() {
    clearScope = "day";
    fillStaffSelect($("clear-staff"), true);
    $("clear-day").value = state.cfg.today;
    $("clear-month").value = currentMonth(state.cfg.today);
    $("clear-shifts").checked = true;
    $("clear-requests").checked = false;
    $("clear-locks").checked = false;
    showClear();
  }

  function pickClearScope(scope) {
    clearScope = scope;
    showClear();
  }

  /** Τι διάστημα έχει διαλεχτεί: τα στοιχεία για τον διακομιστή και η περιγραφή του. */
  function clearRange() {
    const day = $("clear-day").value;
    if (clearScope === "month") {
      const month = $("clear-month").value;
      return /^\d{4}-\d{2}$/.test(month) ? { payload: { month }, label: `ολόκληρος ο μήνας, 1 – ${daysInMonth(month)} ${monthLabel(month)}` }
        : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    if (clearScope === "week") {
      const week = mondayOf(day);
      return { payload: { week }, label: `την εβδομάδα ${weekLabel(week)}` };
    }
    if (clearScope === "shift") {
      const staffId = $("clear-staff").value;
      if (!staffId) return null;
      const who = (state.cfg.staff.find((p) => p.id === staffId) || {}).name || staffId;
      return { payload: { day, staffId }, label: `${who}, ${dateLabel(day)}` };
    }
    return { payload: { day }, label: dateLabel(day) };
  }

  function clearWhat() {
    const isAdmin = state.me.role === "admin";
    return {
      shifts: $("clear-shifts").checked,
      requests: $("clear-requests").checked,
      locks: isAdmin && clearScope !== "shift" && $("clear-locks").checked,
    };
  }

  function showClear() {
    for (const b of document.querySelectorAll("#clear-scopes .kind")) {
      b.classList.toggle("is-on", b.dataset.scope === clearScope);
    }
    $("clear-staff-row").hidden = clearScope !== "shift";
    $("clear-day-row").hidden = clearScope === "month";
    $("clear-month-row").hidden = clearScope !== "month";
    $("clear-day-label").textContent = clearScope === "week"
      ? "Μια μέρα της εβδομάδας"
      : "Ποια μέρα;";
    // Το κλείδωμα είναι για όλους, όχι για ένα άτομο — και το σβήνει μόνο
    // η διεύθυνση, όπως και το βάζει.
    $("clear-locks-row").hidden = state.me.role !== "admin" || clearScope === "shift";

    const what = clearWhat();
    const names = [];
    if (what.shifts) names.push("πρόγραμμα");
    if (what.requests) names.push("αιτήματα");
    if (what.locks) names.push("κλειδωμένες μέρες");
    const range = clearRange();
    let text = "";
    if (!names.length) text = "Διάλεξε τι θα σβηστεί.";
    else if (!range) text = clearScope === "shift" ? "Διάλεξε εργαζόμενο και μέρα." : "Διάλεξε ημερομηνία.";
    else text = `Θα σβηστούν: ${names.join(", ")} — ${range.label}.`;
    $("clear-summary").textContent = text;
    $("clear-go").disabled = !names.length || !range;
  }

  async function runClear() {
    const range = clearRange();
    const what = clearWhat();
    if (!range) return;
    if (!confirm(`${$("clear-summary").textContent}\n\nΔεν γίνεται αναίρεση. Να σβηστούν;`)) return;

    $("clear-go").disabled = true;
    try {
      const out = await api("clearData", { scope: clearScope, what, ...range.payload });
      const c = out.cleared || {};
      const parts = [];
      if (c.shifts) parts.push(`${c.shifts} ${c.shifts === 1 ? "βάρδια" : "βάρδιες"}`);
      if (c.requests) parts.push(`${c.requests} ${c.requests === 1 ? "αίτημα" : "αιτήματα"}`);
      if (c.locks) parts.push(`${c.locks} ${c.locks === 1 ? "κλείδωμα" : "κλειδώματα"}`);
      // Ξαναφορτώνουμε ό,τι φαίνεται, για να μη μείνει κανείς με τα σβησμένα.
      state.rota = null;
      await loadMonth();
      const okText = parts.length
        ? `Σβήστηκαν: ${parts.join(", ")}.`
        : "Δεν υπήρχε τίποτα να σβηστεί σε αυτό το διάστημα.";
      say(okText);
      setTimeout(() => {
        if ($("status").textContent === okText) say("");
      }, 3500);
    } catch (e) {
      say(e.message, true);
    } finally {
      showClear();
    }
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
    renderAlerts();
    renderMyNews();
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
    // «Σημείωση» γράφουν μόνο η διεύθυνση και ο υπεύθυνος προγράμματος.
    const writesNotes = canWriteNotes();
    document.querySelector('#sheet-kinds [data-kind="note"]').hidden = !writesNotes;
    $("sheet-kinds").classList.toggle("two-kinds", !writesNotes);

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
    for (const b of document.querySelectorAll("#sheet-kinds .kind")) b.classList.remove("is-on");
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
    for (const b of document.querySelectorAll("#sheet-kinds .kind")) {
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
    if (!kind) {
      return sheetError(canWriteNotes()
        ? "Διάλεξε τι θέλεις: ρεπό, μόνο ώρες, ή σημείωση."
        : "Διάλεξε τι θέλεις: ρεπό ή μόνο ώρες.");
    }

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
    $("month-bar").hidden = view === "people" || view === "week" ||
      (view === "admin" && state.me?.role !== "admin");
    $("week-bar").hidden = view !== "week";

    // Το πρόγραμμα το φορτώνουμε την πρώτη φορά που θα το ζητήσει κάποιος,
    // για να μη φορτώνει δύο πράγματα κάθε φορά που μπαίνει στην εφαρμογή.
    if (view === "week" && !state.rota) loadWeek();
    if (view === "admin" && !$("admin-accounts-block").hidden) loadAccounts();
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

    for (const b of document.querySelectorAll("#clear-scopes .kind")) {
      b.addEventListener("click", () => pickClearScope(b.dataset.scope));
    }
    for (const id of ["clear-staff", "clear-day", "clear-month", "clear-shifts", "clear-requests", "clear-locks"]) {
      $(id).addEventListener("change", showClear);
      $(id).addEventListener("input", showClear);
    }
    $("clear-go").addEventListener("click", runClear);

    $("event-add").addEventListener("click", () => openEvent(null));
    $("acc-add").addEventListener("click", addAccount);
    $("acc-pin").addEventListener("input", () => {
      $("acc-pin").value = $("acc-pin").value.replace(/\D/g, "").slice(0, 4);
    });
    $("acc-pin").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addAccount();
    });
    $("event-save").addEventListener("click", saveEvent);
    $("event-delete").addEventListener("click", deleteEvent);
    $("event-close").addEventListener("click", () => {
      $("event-sheet").hidden = true;
    });
    $("event-sheet").addEventListener("click", (e) => {
      if (e.target === $("event-sheet")) $("event-sheet").hidden = true;
    });

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

    for (const b of document.querySelectorAll("#sheet-kinds .kind")) {
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
      $("event-sheet").hidden = true;
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
