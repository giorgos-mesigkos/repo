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

  /* ---------------- Εβδομάδες ----------------
     Η εβδομάδα ξεκινάει ΔΕΥΤΕΡΑ και την ονομάζουμε με την ημερομηνία
     της Δευτέρας της, π.χ. "2026-11-02". Οι λογαριασμοί γίνονται σε UTC
     για να μην μπλέξουμε με αλλαγές ώρας: μετράμε μέρες, όχι ώρες. */

  function dateOf(day) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function keyOfDate(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  /** Η Δευτέρα της εβδομάδας στην οποία ανήκει αυτή η μέρα. */
  function mondayOf(day) {
    const date = dateOf(day);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return keyOfDate(date);
  }

  /** Οι επτά μέρες της εβδομάδας, Δευτέρα → Κυριακή. */
  function weekDays(monday) {
    const date = dateOf(monday);
    const out = [];
    for (let i = 0; i < 7; i++) {
      out.push(keyOfDate(date));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return out;
  }

  function shiftWeek(monday, weeks) {
    const date = dateOf(monday);
    date.setUTCDate(date.getUTCDate() + weeks * 7);
    return keyOfDate(date);
  }

  /** Κόβει κείμενο που γράφει ο χρήστης, για να μη φουσκώνει η αποθήκευση. */
  function clean(text, max) {
    if (typeof text !== "string") return "";
    return text.replace(/\s+/g, " ").trim().slice(0, max);
  }

  /** Όπως το clean, αλλά κρατάει τις αλλαγές γραμμής (περιγραφή, μενού). */
  function cleanLines(text, max) {
    if (typeof text !== "string") return "";
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, max);
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

  /* ---------------- Μόνιμα στοιχεία εργαζομένων ----------------
     Ό,τι ισχύει για κάθε μήνα: «θέλω μόνο 2 δωδεκάωρα και 3 πρωινά».
     Γράφεται μία φορά και μένει — δεν ξαναγράφεται κάθε μήνα. Γι' αυτό
     αποθηκεύεται χωριστά από τα αιτήματα του μήνα. */

  async function loadPeople(ctx) {
    const raw = await ctx.store.get("people");
    if (!raw) return {};
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return data && typeof data === "object" ? data : {};
  }

  async function savePeople(ctx, data) {
    await ctx.store.set("people", JSON.stringify(data));
  }

  /* ---------------- Το εβδομαδιαίο πρόγραμμα ----------------
     Αυτό είναι το ΤΕΛΙΚΟ πρόγραμμα: ποιος δουλεύει ποια μέρα και από τι
     ώρα ως τι ώρα. Το γράφει μόνο η διεύθυνση ή ο υπεύθυνος προγράμματος.

     Δεν έχει καμία σχέση με τα αιτήματα: τα αιτήματα είναι τι ΖΗΤΗΣΕ ο
     καθένας, εδώ είναι τι ΑΠΟΦΑΣΙΣΤΗΚΕ. Γι' αυτό αποθηκεύεται χωριστά,
     ανά εβδομάδα — όπως ακριβώς το χαρτί που κρεμιέται στην κουζίνα.

       shifts = { "nikos": { "2026-11-02": { from: "11:00", to: "18:00" } } }

     Μέρα χωρίς ώρες = ρεπό. Δεν αποθηκεύουμε τίποτα γι' αυτήν.

     Η βάρδια μπορεί να έχει και:
       from2/to2 : δεύτερο ωράριο την ίδια μέρα (σπαστό ωράριο)
       note      : σχόλιο για το πρώτο ωράριο, π.χ. «ταμείο»
       note2     : σχόλιο για το δεύτερο, π.χ. «σέρβις»
     Κάθε σχόλιο ανήκει στο δικό του ωράριο, γιατί στο σπαστό ωράριο ο
     άνθρωπος συχνά κάνει ΑΛΛΗ δουλειά το πρωί και άλλη το βράδυ.
     Όλα προαιρετικά — παλιές βάρδιες χωρίς αυτά δουλεύουν όπως πριν. */

  async function loadWeek(ctx, monday) {
    const raw = await ctx.store.get(`week-${monday}`);
    if (!raw) return { shifts: {} };
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { shifts: data.shifts || {} };
  }

  async function saveWeek(ctx, monday, data) {
    await ctx.store.set(`week-${monday}`, JSON.stringify(data));
  }

  /* ---------------- Πάρτι & κρατήσεις ----------------
     Π.χ. ένα παιδικό πάρτι γενεθλίων: μέρα, ώρα, πόσα παιδιά και πόσοι
     μεγάλοι, περιγραφή και μενού. Τα βλέπουν ΟΛΟΙ στο «Πρόγραμμα»· τα
     γράφουν η διεύθυνση, ο υπεύθυνος προγράμματος και όσοι πάρουν άδεια
     από τη διεύθυνση. Κάθε πάρτι λέει ποια τμήματα ειδοποιούνται.

     Αποθηκεύονται ανά μήνα:  events-2026-11 = { list: [ {...}, ... ] } */

  async function loadEvents(ctx, month) {
    const raw = await ctx.store.get(`events-${month}`);
    if (!raw) return { list: [] };
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { list: Array.isArray(data.list) ? data.list : [] };
  }

  async function saveEvents(ctx, month, data) {
    await ctx.store.set(`events-${month}`, JSON.stringify(data));
  }

  /** Οι άδειες που δίνει η διεύθυνση από την εφαρμογή: { events: [ids] }. */
  async function loadPerms(ctx) {
    const raw = await ctx.store.get("permissions");
    const data = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    return { events: Array.isArray(data.events) ? data.events : [] };
  }

  async function savePerms(ctx, data) {
    await ctx.store.set("permissions", JSON.stringify(data));
  }

  /** Ποιος γράφει πάρτι & κρατήσεις. */
  async function canEvents(ctx, person) {
    if (person.role === "admin" || person.role === "planner") return true;
    return (await loadPerms(ctx)).events.includes(person.id);
  }

  /** Τα τμήματα της επιχείρησης, για το «ποιοι ειδοποιούνται». */
  function departmentNames(company) {
    return groupedStaff(company).map((g) => g.name).filter((n) => n && n !== "Χωρίς τμήμα");
  }

  /** Τα πάρτι αυτών των ημερών, με σειρά μέρας και ώρας. */
  async function eventsForDays(ctx, days) {
    const set = new Set(days);
    const out = [];
    for (const m of [...new Set(days.map(monthOf))]) {
      for (const ev of (await loadEvents(ctx, m)).list) if (set.has(ev.day)) out.push(ev);
    }
    return out.sort((a, b) => (a.day + (a.from || "")).localeCompare(b.day + (b.from || "")));
  }

  /**
   * Η ειδοποίηση: πάρτι από σήμερα και για 7 μέρες. Τη βλέπουν όσοι είναι
   * σε τμήμα που διάλεξε το πάρτι, και όσοι γράφουν πάρτι (για να ξέρουν τι
   * έρχεται).
   */
  async function alertsFor(ctx, person, editor) {
    const today = todayKey();
    const days = [];
    const date = dateOf(today);
    for (let i = 0; i < 7; i++) {
      days.push(keyOfDate(date));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    const all = await eventsForDays(ctx, days);
    return all.filter((ev) =>
      editor || (person.team && Array.isArray(ev.teams) && ev.teams.includes(person.team)));
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
      // Με ποια σειρά και σε ποιες ομάδες μπαίνουν τα ονόματα στις λίστες.
      staffGroups: pickGroups(company),
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

  /**
   * Το προσωπικό χωρισμένο σε τμήματα, με τη ΣΕΙΡΑ που γράφτηκαν τα τμήματα
   * στο company-data.js — αυτή είναι και η σειρά των γραμμών στον πίνακα του
   * προγράμματος. Όποιος δεν ανήκει σε κανένα τμήμα μπαίνει στο τέλος.
   *
   * Αν η επιχείρηση δεν όρισε τμήματα, φτιάχνονται μόνα τους από τα "team"
   * που βρέθηκαν· αν δεν υπάρχουν ούτε αυτά, βγαίνει μία ομάδα χωρίς τίτλο.
   */
  function groupedStaff(company) {
    const active = company.staff.filter((p) => p.active !== false);
    const names = Array.isArray(company.departments) && company.departments.length
      ? company.departments.slice()
      : [...new Set(active.map((p) => p.team).filter(Boolean))];

    const groups = names.map((name) => ({ name, ids: [] }));
    const rest = { name: groups.length ? "Χωρίς τμήμα" : "", ids: [] };

    for (const p of active) {
      const group = groups.find((g) => g.name === p.team);
      (group || rest).ids.push(p.id);
    }
    if (rest.ids.length) groups.push(rest);
    return groups.filter((g) => g.ids.length);
  }

  /**
   * Η σειρά με την οποία εμφανίζεται το προσωπικό στις λίστες επιλογής
   * (ποιος είσαι, για ποιον δηλώνω): πρώτα η διεύθυνση, μετά ο υπεύθυνος
   * προγράμματος, και μετά όλοι οι υπόλοιποι ανά τμήμα.
   *
   * Οι δύο πρώτοι μπαίνουν σε ομάδα ΧΩΡΙΣ τίτλο: είναι λίγοι, τους ψάχνει
   * κανείς πρώτους, και δεν χρειάζεται να γράφει η λίστα τι δουλειά κάνουν.
   *
   * Ο ρόλος του καθενός δεν φεύγει από τον διακομιστή — φεύγει μόνο η σειρά.
   */
  function pickGroups(company) {
    const active = company.staff.filter((p) => p.active !== false);
    const first = { name: "", ids: [] };
    for (const p of active) if (p.role === "admin") first.ids.push(p.id);
    for (const p of active) if (p.role === "planner") first.ids.push(p.id);

    const taken = new Set(first.ids);
    const rest = groupedStaff(company)
      .map((g) => ({ name: g.name, ids: g.ids.filter((id) => !taken.has(id)) }))
      .filter((g) => g.ids.length);

    return first.ids.length ? [first, ...rest] : rest;
  }

  /** Η κοινή απάντηση μετά από κάθε αλλαγή: όλος ο μήνας, φρέσκος. */
  /**
   * Ποιος βλέπει τα μόνιμα στοιχεία ΟΛΩΝ: η διεύθυνση και όποιος έχει
   * αναλάβει να φτιάξει το πρόγραμμα.
   */
  function canSeePeople(person) {
    return person.role === "admin" || person.role === "planner";
  }

  /**
   * Ποιος ΓΡΑΦΕΙ το εβδομαδιαίο πρόγραμμα. Ίδιοι με παραπάνω: το αφεντικό
   * και ο υπεύθυνος προγράμματος. Οι υπόλοιποι το βλέπουν μόνο.
   */
  function canPlan(person) {
    return canSeePeople(person);
  }

  /**
   * Ποιος βλέπει τη στήλη με τις ΩΡΕΣ της εβδομάδας: η διεύθυνση, και όποιος
   * έχει seesHours: true στο company-data.js (τυπικά η λογίστρια).
   *
   * Προσοχή στο τι είναι αυτό: οι ΩΡΕΣ ΤΗΣ ΒΑΡΔΙΑΣ φαίνονται σε όλους — αυτό
   * είναι το πρόγραμμα, γι' αυτό υπάρχει. Άρα το σύνολο μπορεί να το βγάλει
   * με το χέρι όποιος κάτσει να το μετρήσει. Εδώ κρύβουμε τη στήλη, δεν
   * κλειδώνουμε μυστικό· ο λόγος είναι να μη συγκρίνονται μεταξύ τους οι
   * εργαζόμενοι μέσα από την εφαρμογή.
   */
  function canSeeHours(person) {
    return person.role === "admin" || person.seesHours === true;
  }

  /**
   * Τα μόνιμα στοιχεία που επιτρέπεται να φτάσουν σε αυτό το άτομο.
   * Ο απλός εργαζόμενος παίρνει ΜΟΝΟ τα δικά του — τα χρειάζεται για να τα
   * δει και να τα αλλάξει. Το φιλτράρισμα γίνεται εδώ και όχι στη σελίδα:
   * αλλιώς θα έφταναν στο κινητό του και ας μην του τα δείχναμε.
   */
  async function peopleFor(ctx, person) {
    const all = await loadPeople(ctx);
    if (canSeePeople(person)) return all;
    return all[person.id] ? { [person.id]: all[person.id] } : {};
  }

  async function monthReply(ctx, month, data, person) {
    return ok({
      month,
      lockedDays: data.lockedDays,
      entries: data.entries,
      // Τα μόνιμα πάνε μαζί σε κάθε απάντηση: η σελίδα τα χρειάζεται πάντα
      // και δεν αλλάζουν ανά μήνα.
      people: await peopleFor(ctx, person),
      canSeePeople: canSeePeople(person),
      staff: staffIndex(ctx.company),
      today: todayKey(),
      closed: deadlinePassed(ctx.company, month),
      ...(await eventExtras(ctx, person)),
    });
  }

  /** Ό,τι χρειάζεται η σελίδα για τα πάρτι, σε κάθε απάντηση μήνα. */
  async function eventExtras(ctx, person) {
    const editor = await canEvents(ctx, person);
    const out = { canEvents: editor, alerts: await alertsFor(ctx, person, editor) };
    // Μόνο η διεύθυνση βλέπει (και αλλάζει) ποιοι έχουν άδεια.
    if (person.role === "admin") out.eventEditors = (await loadPerms(ctx)).events;
    return out;
  }

  /**
   * Τι ζήτησε ο καθένας για τις μέρες αυτής της εβδομάδας, και ποιες από
   * αυτές είναι κλειδωμένες. Χρειάζεται για να βλέπει ο υπεύθυνος τα
   * αιτήματα πάνω στον πίνακα, την ώρα που φτιάχνει το πρόγραμμα.
   *
   * Μια εβδομάδα μπορεί να πέφτει σε δύο μήνες (π.χ. 30/11 – 6/12), γι'
   * αυτό διαβάζουμε όσους μήνες αγγίζει.
   */
  async function requestsForDays(ctx, days) {
    const inWeek = new Set(days);
    const requests = {};
    const lockedDays = {};

    for (const m of [...new Set(days.map(monthOf))]) {
      const data = await loadMonth(ctx, m);
      for (const [day, reason] of Object.entries(data.lockedDays)) {
        if (inWeek.has(day)) lockedDays[day] = reason;
      }
      for (const [id, entry] of Object.entries(data.entries)) {
        for (const [day, wish] of Object.entries(entry.days || {})) {
          if (!inWeek.has(day)) continue;
          requests[id] = requests[id] || {};
          requests[id][day] = wish;
        }
      }
    }
    return { requests, lockedDays };
  }

  /** Η κοινή απάντηση για το πρόγραμμα: όλη η εβδομάδα, φρέσκια. */
  async function weekReply(ctx, monday, data, person) {
    const days = weekDays(monday);
    const extra = await requestsForDays(ctx, days);
    return ok({
      week: monday,
      days,
      shifts: data.shifts,
      requests: extra.requests,
      lockedDays: extra.lockedDays,
      staff: staffIndex(ctx.company),
      groups: groupedStaff(ctx.company),
      canPlan: canPlan(person),
      canSeeHours: canSeeHours(person),
      today: todayKey(),
      events: await eventsForDays(ctx, days),
      canEvents: await canEvents(ctx, person),
      departments: departmentNames(ctx.company),
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
  async function month(ctx, body, person) {
    const m = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(m)) return fail(400, "Λάθος μήνας.");
    return monthReply(ctx, m, await loadMonth(ctx, m), person);
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

    const entry = data.entries[targetId] || { days: {}, updatedAt: "" };
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
      // Σημειώσεις (ανακοινώσεις) γράφουν μόνο η διεύθυνση και ο υπεύθυνος
      // προγράμματος. Ο εργαζόμενος γράφει τον λόγο του μέσα στο ρεπό ή στις ώρες.
      if (!canPlan(person)) {
        return fail(403, "Σημειώσεις γράφουν μόνο η διεύθυνση και ο υπεύθυνος προγράμματος.");
      }
      const note = clean(body.note, 200);
      if (!note) return fail(400, "Γράψε τη σημείωση.");
      entry.days[day] = { kind: "note", note };
    } else {
      return fail(400, "Λάθος τύπος αιτήματος.");
    }

    entry.updatedAt = new Date().toISOString();
    data.entries[targetId] = entry;
    await saveMonth(ctx, m, data);
    return monthReply(ctx, m, data, person);
  }

  /**
   * Τα μόνιμα του εργαζόμενου: τι θέλει γενικά, για κάθε μήνα.
   * Δεν δεσμεύεται από προθεσμία — δεν αφορά συγκεκριμένο μήνα.
   */
  async function saveProfile(ctx, body, person) {
    const month = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(month)) return fail(400, "Λάθος μήνας.");

    const people = await loadPeople(ctx);
    people[person.id] = {
      note: clean(body.note, 400),
      updatedAt: new Date().toISOString(),
    };
    await savePeople(ctx, people);
    // Γυρνάμε τον μήνα που κοιτάει η σελίδα, για να ανανεωθεί ολόκληρη.
    return monthReply(ctx, month, await loadMonth(ctx, month), person);
  }

  /**
   * Διαβάζει ένα ωράριο «από–έως». Και τα δύο κενά σημαίνει «δεν υπάρχει» —
   * έτσι το δεύτερο ωράριο του σπαστού είναι απλώς προαιρετικό, χωρίς
   * ξεχωριστό διακόπτη στα δεδομένα.
   */
  function readPart(from, to) {
    const a = typeof from === "string" ? from : "";
    const b = typeof to === "string" ? to : "";
    if (!a && !b) return { part: null };
    if (!TIME.test(a) || !TIME.test(b)) return { error: "Συμπλήρωσε ώρα από και έως." };
    if (a === b) return { error: "Οι δύο ώρες είναι ίδιες." };
    return { part: { from: a, to: b } };
  }

  /** Ελέγχει ότι η εβδομάδα που ζητήθηκε είναι όντως μια Δευτέρα. */
  function readWeek(body) {
    const w = typeof body.week === "string" ? body.week : "";
    if (!DAY_KEY.test(w) || mondayOf(w) !== w) return "";
    return w;
  }

  /** Το πρόγραμμα μιας εβδομάδας. Το βλέπει κάθε συνδεδεμένος. */
  async function week(ctx, body, person) {
    const w = readWeek(body);
    if (!w) return fail(400, "Λάθος εβδομάδα.");
    return weekReply(ctx, w, await loadWeek(ctx, w), person);
  }

  /**
   * Γράφει ή σβήνει ΕΝΑ κουτάκι του προγράμματος: ένα άτομο, μία μέρα.
   * Μόνο η διεύθυνση και ο υπεύθυνος προγράμματος.
   */
  async function saveShift(ctx, body, person) {
    if (!canPlan(person)) {
      return fail(403, "Το πρόγραμμα το γράφει η διεύθυνση ή ο υπεύθυνος προγράμματος.");
    }
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");

    const target = findStaff(ctx.company, typeof body.staffId === "string" ? body.staffId : "");
    if (!target) return fail(400, "Άγνωστος εργαζόμενος.");

    const monday = mondayOf(day);
    const data = await loadWeek(ctx, monday);
    const row = data.shifts[target.id] || {};

    if (body.kind === "clear") {
      delete row[day];
    } else {
      const first = readPart(body.from, body.to);
      if (first.error) return fail(400, first.error);
      const second = readPart(body.from2, body.to2);
      if (second.error) return fail(400, second.error);
      // Δεύτερο ωράριο χωρίς πρώτο δεν βγάζει νόημα — και θα κρυβόταν κιόλας,
      // αφού ο πίνακας δείχνει πρώτα το πρώτο.
      if (!first.part && second.part) return fail(400, "Συμπλήρωσε πρώτα το πρώτο ωράριο.");

      // Κοντά επίτηδες: τα σχόλια γράφονται ΜΕΣΑ στο κουτάκι του πίνακα, και
      // σε κινητό κάθε δέκα χαρακτήρες είναι μία ακόμα σειρά. Προτιμάμε να
      // κόβονται εδώ παρά να κρύβονται μετά από όσους δεν μπορούν να πατήσουν.
      const note = clean(body.note, 40);
      const note2 = clean(body.note2, 40);
      // Κάθε σχόλιο ανήκει στο δικό του ωράριο· χωρίς ωράριο δεν έχει πού να
      // σταθεί, και θα χανόταν σιωπηλά.
      if (!second.part && note2) {
        return fail(400, "Το σχόλιο του δεύτερου ωραρίου θέλει και ώρες.");
      }
      if (!first.part && !note) {
        // Ούτε ώρες ούτε σχόλιο: η μέρα αδειάζει.
        delete row[day];
      } else {
        const entry = {};
        if (first.part) Object.assign(entry, first.part);
        if (note) entry.note = note;
        if (second.part) {
          entry.from2 = second.part.from;
          entry.to2 = second.part.to;
          if (note2) entry.note2 = note2;
        }
        row[day] = entry;
      }
    }

    // Άτομο χωρίς καμία βάρδια δεν χρειάζεται να πιάνει χώρο.
    if (Object.keys(row).length) data.shifts[target.id] = row;
    else delete data.shifts[target.id];

    await saveWeek(ctx, monday, data);
    return weekReply(ctx, monday, data, person);
  }

  /**
   * Αντιγράφει ολόκληρη την προηγούμενη εβδομάδα πάνω σε αυτήν.
   * Οι περισσότερες εβδομάδες μοιάζουν μεταξύ τους: έτσι ο υπεύθυνος
   * ξεκινάει από κάτι έτοιμο και διορθώνει μόνο τις αλλαγές.
   *
   * ΣΒΗΝΕΙ ό,τι υπήρχε ήδη σε αυτή την εβδομάδα — η σελίδα ρωτάει πρώτα.
   */
  async function copyWeek(ctx, body, person) {
    if (!canPlan(person)) {
      return fail(403, "Το πρόγραμμα το γράφει η διεύθυνση ή ο υπεύθυνος προγράμματος.");
    }
    const w = readWeek(body);
    if (!w) return fail(400, "Λάθος εβδομάδα.");

    const from = shiftWeek(w, -1);
    const source = await loadWeek(ctx, from);
    if (!Object.keys(source.shifts).length) {
      return fail(400, "Η προηγούμενη εβδομάδα είναι άδεια — δεν υπάρχει τίποτα να αντιγραφεί.");
    }

    // Αντιστοιχούμε Δευτέρα με Δευτέρα, Τρίτη με Τρίτη κ.ο.κ.
    const fromDays = weekDays(from);
    const toDays = weekDays(w);
    const shifts = {};
    for (const [id, row] of Object.entries(source.shifts)) {
      if (!findStaff(ctx.company, id)) continue;   // έφυγε από την επιχείρηση
      const copy = {};
      fromDays.forEach((day, i) => {
        // Ολόκληρη η βάρδια: ώρες, δεύτερο ωράριο και σχόλιο.
        if (row[day]) copy[toDays[i]] = { ...row[day] };
      });
      if (Object.keys(copy).length) shifts[id] = copy;
    }

    const data = { shifts };
    await saveWeek(ctx, w, data);
    return weekReply(ctx, w, data, person);
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
    return monthReply(ctx, m, data, person);
  }

  /**
   * Σβήνει δεδομένα ΜΟΝΟ για το διάστημα που διαλέγει ο χρήστης — ποτέ τα
   * πάντα. Το διάστημα είναι ένα από τα:
   *   shift : μία βάρδια/μέρα ΕΝΟΣ ατόμου   { day, staffId }
   *   day   : μία μέρα, όλοι                { day }
   *   week  : μία εβδομάδα, όλοι            { week: Δευτέρα }
   *   month : ένας μήνας, όλοι              { month }
   * και διαλέγει τι σβήνεται: what = { shifts, requests, locks }
   *   shifts   : το εβδομαδιαίο πρόγραμμα (οι ώρες)
   *   requests : τα αιτήματα των εργαζομένων (ρεπό, μόνο ώρες, σημειώσεις)
   *   locks    : οι κλειδωμένες μέρες — μόνο η διεύθυνση, όπως και το
   *              κλείδωμα. Στο «shift» δεν έχει νόημα: το κλείδωμα είναι
   *              για όλους.
   * Τα μόνιμα στοιχεία των εργαζομένων («Τι θέλω γενικά») δεν αγγίζονται.
   * Η σελίδα ρωτάει πρώτα. Επιστρέφει πόσα σβήστηκαν από το καθένα.
   */
  async function clearData(ctx, body, person) {
    if (!canPlan(person)) {
      return fail(403, "Σβήνουν μόνο η διεύθυνση και ο υπεύθυνος προγράμματος.");
    }
    const scope = body.scope;
    const what = body.what && typeof body.what === "object" ? body.what : {};
    const wantShifts = what.shifts === true;
    const wantRequests = what.requests === true;
    const wantLocks = what.locks === true && scope !== "shift";
    if (what.locks === true && scope !== "shift" && person.role !== "admin") {
      return fail(403, "Τις κλειδωμένες μέρες τις σβήνει μόνο η διεύθυνση.");
    }
    if (!wantShifts && !wantRequests && !wantLocks) {
      return fail(400, "Διάλεξε τι θα σβηστεί.");
    }

    let days = [];
    let staffId = "";
    if (scope === "shift" || scope === "day") {
      const day = typeof body.day === "string" ? body.day : "";
      if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");
      days = [day];
      if (scope === "shift") {
        const target = findStaff(ctx.company, typeof body.staffId === "string" ? body.staffId : "");
        if (!target) return fail(400, "Διάλεξε εργαζόμενο.");
        staffId = target.id;
      }
    } else if (scope === "week") {
      const w = readWeek(body);
      if (!w) return fail(400, "Λάθος εβδομάδα.");
      days = weekDays(w);
    } else if (scope === "month") {
      const m = typeof body.month === "string" ? body.month : "";
      if (!MONTH_KEY.test(m)) return fail(400, "Λάθος μήνας.");
      const date = dateOf(`${m}-01`);
      while (keyOfDate(date).startsWith(m)) {
        days.push(keyOfDate(date));
        date.setUTCDate(date.getUTCDate() + 1);
      }
    } else {
      return fail(400, "Διάλεξε διάστημα.");
    }

    const daySet = new Set(days);
    const count = { shifts: 0, requests: 0, locks: 0 };

    // Πρόγραμμα: αποθηκεύεται ανά εβδομάδα — μια εβδομάδα μπορεί να μπαίνει
    // και σε δύο μήνες, γι' αυτό σβήνουμε μέρα-μέρα, όχι ολόκληρες εβδομάδες.
    if (wantShifts) {
      for (const monday of [...new Set(days.map(mondayOf))]) {
        const data = await loadWeek(ctx, monday);
        let changed = false;
        for (const [id, row] of Object.entries(data.shifts)) {
          if (staffId && id !== staffId) continue;
          for (const day of Object.keys(row)) {
            if (!daySet.has(day)) continue;
            delete row[day];
            count.shifts++;
            changed = true;
          }
          if (!Object.keys(row).length) delete data.shifts[id];
        }
        if (changed) await saveWeek(ctx, monday, data);
      }
    }

    // Αιτήματα και κλειδώματα: αποθηκεύονται ανά μήνα.
    if (wantRequests || wantLocks) {
      for (const m of [...new Set(days.map(monthOf))]) {
        const data = await loadMonth(ctx, m);
        let changed = false;
        if (wantRequests) {
          for (const [id, entry] of Object.entries(data.entries)) {
            if (staffId && id !== staffId) continue;
            const own = (entry && entry.days) || {};
            for (const day of Object.keys(own)) {
              if (!daySet.has(day)) continue;
              delete own[day];
              count.requests++;
              changed = true;
            }
          }
        }
        if (wantLocks) {
          for (const day of Object.keys(data.lockedDays)) {
            if (!daySet.has(day)) continue;
            delete data.lockedDays[day];
            count.locks++;
            changed = true;
          }
        }
        if (changed) await saveMonth(ctx, m, data);
      }
    }

    return ok({ cleared: count });
  }

  /**
   * Γράφει ή αλλάζει ένα πάρτι/κράτηση. Αν δοθεί id, αλλάζει το υπάρχον
   * (που βρίσκεται στη μέρα oldDay — μπορεί να μετακινηθεί σε άλλη μέρα).
   */
  async function saveEvent(ctx, body, person) {
    if (!(await canEvents(ctx, person))) {
      return fail(403, "Πάρτι και κρατήσεις γράφουν μόνο όσοι έχουν άδεια από τη διεύθυνση.");
    }
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");
    const time = readPart(body.from, body.to);
    if (time.error) return fail(400, time.error);
    const title = clean(body.title, 80);
    if (!title) return fail(400, "Γράψε τίτλο, π.χ. «Γενέθλια Μαρίας».");
    const count = (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : 0;
    };
    const known = new Set(departmentNames(ctx.company));
    const teams = Array.isArray(body.teams)
      ? [...new Set(body.teams.filter((t) => typeof t === "string" && known.has(t)))]
      : [];

    const id = typeof body.id === "string" && /^e-[a-z0-9-]{4,40}$/.test(body.id) ? body.id : "";
    let old = null;
    if (id) {
      const oldDay = typeof body.oldDay === "string" && DAY_KEY.test(body.oldDay) ? body.oldDay : day;
      const oldMonth = monthOf(oldDay);
      const data = await loadEvents(ctx, oldMonth);
      old = data.list.find((e) => e.id === id) || null;
      if (!old) return fail(404, "Το πάρτι δεν βρέθηκε — μπορεί να σβήστηκε.");
      data.list = data.list.filter((e) => e.id !== id);
      await saveEvents(ctx, oldMonth, data);
    }

    const ev = {
      id: id || `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      day,
      from: time.part ? time.part.from : "",
      to: time.part ? time.part.to : "",
      title,
      kids: count(body.kids),
      adults: count(body.adults),
      description: cleanLines(body.description, 800),
      menu: cleanLines(body.menu, 800),
      teams,
      createdBy: old ? old.createdBy : person.id,
      updatedBy: person.id,
      updatedAt: new Date().toISOString(),
    };
    const m = monthOf(day);
    const data = await loadEvents(ctx, m);
    data.list.push(ev);
    await saveEvents(ctx, m, data);

    const w = readWeek(body) || mondayOf(day);
    return weekReply(ctx, w, await loadWeek(ctx, w), person);
  }

  async function deleteEvent(ctx, body, person) {
    if (!(await canEvents(ctx, person))) {
      return fail(403, "Πάρτι και κρατήσεις σβήνουν μόνο όσοι έχουν άδεια από τη διεύθυνση.");
    }
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");
    const m = monthOf(day);
    const data = await loadEvents(ctx, m);
    data.list = data.list.filter((e) => e.id !== body.id);
    await saveEvents(ctx, m, data);
    const w = readWeek(body) || mondayOf(day);
    return weekReply(ctx, w, await loadWeek(ctx, w), person);
  }

  /** Η διεύθυνση δίνει ή παίρνει πίσω την άδεια για πάρτι & κρατήσεις. */
  async function setEventEditor(ctx, body, person) {
    if (person.role !== "admin") return fail(403, "Άδειες δίνει μόνο η διεύθυνση.");
    const target = findStaff(ctx.company, typeof body.staffId === "string" ? body.staffId : "");
    if (!target) return fail(400, "Άγνωστος εργαζόμενος.");
    const perms = await loadPerms(ctx);
    const set = new Set(perms.events);
    if (body.on) set.add(target.id);
    else set.delete(target.id);
    perms.events = [...set];
    await savePerms(ctx, perms);
    return ok({ eventEditors: perms.events });
  }

  const NEEDS_LOGIN = {
    month, saveDay, saveProfile, lockDay, week, saveShift, copyWeek, clearData,
    saveEvent, deleteEvent, setEventEditor,
  };

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
