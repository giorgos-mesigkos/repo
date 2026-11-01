/* ============================================================
   ΟΙ ΚΑΝΟΝΕΣ — ΔΕΝ ΤΟ ΠΕΙΡΑΖΕΙΣ ΑΝΑ ΕΠΙΧΕΙΡΗΣΗ
   ============================================================
   Εδώ είναι ΟΛΗ η λογική: ποιος μπορεί να μπει, ποιος μπορεί να
   γράψει, ποια μέρα είναι κλειδωμένη, πότε λήγει η προθεσμία.

   Το ίδιο αρχείο τρέχει σε δύο μέρη:

     • στο Netlify, μέσα στη function  (netlify/functions/api.js)
     • στον browser, στη σελίδα επίδειξης (demo.html)

   Γι' αυτό δεν ξέρει τίποτα για το περιβάλλον του: η επιχείρηση,
   η αποθήκευση και η υπογραφή του "εισιτηρίου" του δίνονται από
   έξω, ως ctx = { company, store, sign }.

   Έτσι οι κανόνες γράφτηκαν μία φορά. Αν βελτιωθεί κάτι, ισχύει
   αυτόματα και στην πραγματική εφαρμογή και στην επίδειξη.
   ============================================================ */

(function (root) {
  "use strict";

  const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
  const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

  const ok = (body) => ({ status: 200, body });
  const fail = (status, message) => ({ status, body: { error: message } });

  /* ---------------- Βοηθήματα ---------------- */

  function findStaff(company, id) {
    return company.staff.find((p) => p.id === id && p.active !== false) || null;
  }

  /** Η σημερινή μέρα ως "2026-11-01", σε ώρα Ελλάδας. */
  function todayKey() {
    // Το en-CA δίνει ήδη τη μορφή YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  const monthOf = (day) => day.slice(0, 7);
  const pad = (n) => String(n).padStart(2, "0");

  /** Κόβει κείμενο που γράφει ο χρήστης, για να μη φουσκώνει η αποθήκευση. */
  function clean(text, max) {
    if (typeof text !== "string") return "";
    return text.replace(/\s+/g, " ").trim().slice(0, max);
  }

  const rulesOf = (company) => company.rules || {};

  /* ---------------- Το "εισιτήριο" της σύνδεσης ---------------- */

  /**
   * Ό,τι κρατάει ο browser μετά τη σύνδεση. Δεν περιέχει PIN.
   * Είναι υπογεγραμμένο, ώστε να μην μπορεί κάποιος να φτιάξει δικό του
   * και να παρουσιαστεί ως διαχειριστής.
   */
  function makeToken(ctx, person) {
    const payload = `${person.id}.${person.role || "staff"}`;
    return `${payload}.${ctx.sign(payload)}`;
  }

  /** Σύγκριση που δεν προδίδει πόσοι χαρακτήρες ταίριαξαν. */
  function sameText(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function readToken(ctx, token) {
    if (typeof token !== "string") return null;
    const bits = token.split(".");
    if (bits.length !== 3) return null;
    const person = findStaff(ctx.company, bits[0]);
    if (!person) return null;
    // Συγκρίνουμε με το token που ΘΑ βγάζαμε τώρα για αυτό το άτομο. Αν άλλαξε
    // ο ρόλος του στο company-data.js, το παλιό token παύει να ισχύει.
    return sameText(token, makeToken(ctx, person)) ? person : null;
  }

  /* ---------------- Δεδομένα μήνα ---------------- */

  async function loadMonth(ctx, month) {
    const raw = await ctx.store.get(`month-${month}`);
    if (!raw) return { lockedDays: {}, entries: {} };
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { lockedDays: data.lockedDays || {}, entries: data.entries || {} };
  }

  async function saveMonth(ctx, month, data) {
    await ctx.store.set(`month-${month}`, JSON.stringify(data));
  }

  /**
   * Έχει περάσει η προθεσμία για τον μήνα αυτόν;
   * Η προθεσμία είναι η <deadlineDayOfPreviousMonth> του προηγούμενου μήνα.
   * Ο διαχειριστής δεν δεσμεύεται από αυτήν.
   */
  function deadlinePassed(company, month) {
    const day = Number(rulesOf(company).deadlineDayOfPreviousMonth);
    if (!day) return false;
    const [y, m] = month.split("-").map(Number);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    return todayKey() > `${prev.y}-${pad(prev.m)}-${pad(day)}`;
  }

  /* ---------------- Τι επιτρέπεται να φτάσει στο κινητό ---------------- */

  /** Ρυθμίσεις χωρίς PIN και χωρίς μυστικά. */
  function publicConfig(company) {
    const r = rulesOf(company);
    return {
      brand: company.brand || {},
      theme: company.theme || {},
      copy: company.copy || {},
      rules: {
        maxOffPerDay: r.maxOffPerDay || 0,
        deadlineDayOfPreviousMonth: r.deadlineDayOfPreviousMonth || 0,
        allowPastDays: Boolean(r.allowPastDays),
      },
      staff: company.staff
        .filter((p) => p.active !== false)
        .map((p) => ({ id: p.id, name: p.name, team: p.team || "" })),
      today: todayKey(),
    };
  }

  /** Ονόματα και τμήματα, για να τα δείχνει ο πίνακας χωρίς δεύτερη κλήση. */
  function staffIndex(company) {
    const index = {};
    for (const p of company.staff) {
      index[p.id] = { name: p.name, team: p.team || "", role: p.role || "staff" };
    }
    return index;
  }

  /** Η κοινή απάντηση μετά από κάθε αλλαγή: όλος ο μήνας, φρέσκος. */
  function monthReply(ctx, month, data) {
    return ok({
      month,
      lockedDays: data.lockedDays,
      entries: data.entries,
      staff: staffIndex(ctx.company),
      today: todayKey(),
      closed: deadlinePassed(ctx.company, month),
    });
  }

  /* ---------------- Οι ενέργειες ---------------- */

  /** Σύνδεση με όνομα + PIN. */
  async function login(ctx, body) {
    const id = typeof body.id === "string" ? body.id : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    const person = findStaff(ctx.company, id);
    // Ίδιο μήνυμα για λάθος όνομα και για λάθος PIN: δεν αποκαλύπτουμε ποιο
    // από τα δύο έφταιγε.
    if (!person || !person.pin || !sameText(String(person.pin), pin)) {
      return fail(401, "Λάθος όνομα ή PIN.");
    }
    return ok({
      token: makeToken(ctx, person),
      me: {
        id: person.id,
        name: person.name,
        role: person.role || "staff",
        team: person.team || "",
      },
    });
  }

  /** Ο πίνακας ενός μήνα — όλα τα αιτήματα όλων. Τον βλέπει κάθε συνδεδεμένος. */
  async function month(ctx, body) {
    const m = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(m)) return fail(400, "Λάθος μήνας.");
    return monthReply(ctx, m, await loadMonth(ctx, m));
  }

  /**
   * Καταχώρηση / αλλαγή / σβήσιμο αιτήματος για ΜΙΑ μέρα.
   * Ο εργαζόμενος γράφει μόνο για τον εαυτό του — ο διαχειριστής για όποιον θέλει.
   */
  async function saveDay(ctx, body, person) {
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");

    const isAdmin = person.role === "admin";
    // Μόνο ο διαχειριστής δηλώνει για λογαριασμό άλλου. Αν το ζητήσει
    // εργαζόμενος, το λέμε καθαρά αντί να το αγνοήσουμε σιωπηλά.
    if (!isAdmin && body.staffId && String(body.staffId) !== person.id) {
      return fail(403, "Μπορείς να δηλώσεις μόνο για τον εαυτό σου.");
    }
    const targetId = isAdmin && body.staffId ? String(body.staffId) : person.id;
    const target = findStaff(ctx.company, targetId);
    if (!target) return fail(400, "Άγνωστος εργαζόμενος.");

    const m = monthOf(day);

    if (!isAdmin) {
      if (deadlinePassed(ctx.company, m)) {
        return fail(403, "Η προθεσμία για αυτόν τον μήνα έχει περάσει.");
      }
      if (!rulesOf(ctx.company).allowPastDays && day < todayKey()) {
        return fail(403, "Η μέρα αυτή έχει περάσει.");
      }
    }

    const data = await loadMonth(ctx, m);

    // Κλειδωμένη μέρα: μόνο ο διαχειριστής γράφει.
    if (!isAdmin && Object.prototype.hasOwnProperty.call(data.lockedDays, day)) {
      return fail(403, "Η μέρα είναι κλειδωμένη από τη διεύθυνση.");
    }

    const entry = data.entries[targetId] || { days: {}, note: "", updatedAt: "" };
    entry.days = entry.days || {};

    const kind = body.kind;
    if (kind === "clear") {
      delete entry.days[day];
    } else if (kind === "off") {
      entry.days[day] = { kind: "off", note: clean(body.note, 200) };
    } else if (kind === "limited") {
      const from = typeof body.from === "string" ? body.from : "";
      const to = typeof body.to === "string" ? body.to : "";
      if (!TIME.test(from) || !TIME.test(to)) return fail(400, "Συμπλήρωσε ώρα από και έως.");
      if (from === to) return fail(400, "Οι δύο ώρες είναι ίδιες.");
      entry.days[day] = { kind: "limited", from, to, note: clean(body.note, 200) };
    } else if (kind === "note") {
      const note = clean(body.note, 200);
      if (!note) return fail(400, "Γράψε τη σημείωση.");
      entry.days[day] = { kind: "note", note };
    } else {
      return fail(400, "Λάθος τύπος αιτήματος.");
    }

    entry.updatedAt = new Date().toISOString();
    data.entries[targetId] = entry;
    await saveMonth(ctx, m, data);
    return monthReply(ctx, m, data);
  }

  /** Η ελεύθερη σημείωση του εργαζόμενου για όλον τον μήνα. */
  async function saveNote(ctx, body, person) {
    const m = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(m)) return fail(400, "Λάθος μήνας.");
    if (person.role !== "admin" && deadlinePassed(ctx.company, m)) {
      return fail(403, "Η προθεσμία για αυτόν τον μήνα έχει περάσει.");
    }
    const data = await loadMonth(ctx, m);
    const entry = data.entries[person.id] || { days: {}, note: "", updatedAt: "" };
    entry.note = clean(body.note, 400);
    entry.updatedAt = new Date().toISOString();
    data.entries[person.id] = entry;
    await saveMonth(ctx, m, data);
    return monthReply(ctx, m, data);
  }

  /** Κλείδωμα / ξεκλείδωμα μέρας για όλους. Μόνο ο διαχειριστής. */
  async function lockDay(ctx, body, person) {
    if (person.role !== "admin") return fail(403, "Μόνο η διεύθυνση κλειδώνει μέρες.");
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");

    const m = monthOf(day);
    const data = await loadMonth(ctx, m);
    if (body.locked) {
      data.lockedDays[day] = clean(body.reason, 60) || "Κλειστή μέρα";
    } else {
      delete data.lockedDays[day];
    }
    await saveMonth(ctx, m, data);
    return monthReply(ctx, m, data);
  }

  const NEEDS_LOGIN = { month, saveDay, saveNote, lockDay };

  /**
   * Το μοναδικό σημείο εισόδου.
   * ctx     = { company, store, sign }
   * payload = { action, token, data }
   * Επιστρέφει { status, body }.
   */
  async function handle(ctx, payload) {
    const action = payload && typeof payload.action === "string" ? payload.action : "";
    const body = (payload && payload.data) || {};

    if (!ctx.company || !Array.isArray(ctx.company.staff) || !ctx.company.staff.length) {
      return fail(500, "Δεν έχει οριστεί προσωπικό στο company-data.js.");
    }
    if (action === "config") return ok(publicConfig(ctx.company));
    if (action === "login") return login(ctx, body);

    // Όλα τα υπόλοιπα θέλουν σύνδεση.
    const person = readToken(ctx, payload && payload.token);
    if (!person) return fail(401, "Χρειάζεται νέα σύνδεση.");

    const fn = NEEDS_LOGIN[action];
    if (!fn) return fail(400, "Άγνωστη ενέργεια.");
    return fn(ctx, body, person);
  }

  root.ShiftRules = { handle, publicConfig, todayKey };
})(typeof globalThis !== "undefined" ? globalThis : this);

// Στο Netlify (Node) το αρχείο φορτώνεται με require· στον browser με <script>.
if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.ShiftRules;
}
