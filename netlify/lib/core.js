/**
 * Η ΜΗΧΑΝΗ ΤΟΥ ΔΙΑΚΟΜΙΣΤΗ — δεν αλλάζει ανά επιχείρηση.
 *
 * Όλοι οι κανόνες ζουν εδώ και μόνο εδώ: ποιος μπορεί να μπει, ποιος
 * μπορεί να γράψει, ποια μέρα είναι κλειδωμένη. Ο browser δεν αποφασίζει
 * τίποτα από αυτά — ό,τι στέλνει ελέγχεται ξανά εδώ.
 *
 * Η αποθήκευση δίνεται από έξω (store), ώστε το ίδιο αρχείο να δουλεύει
 * και στο Netlify (Netlify Blobs) και τοπικά (απλό αρχείο JSON).
 */

const crypto = require("crypto");
const { COMPANY } = require("../../company-data.js");

const SECRET =
  process.env.SHIFT_SECRET || (COMPANY.security && COMPANY.security.secret) || "";

/* ---------------- Βοηθήματα ---------------- */

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const ok = (body) => ({ status: 200, body });
const fail = (status, message) => ({ status, body: { error: message } });

function findStaff(id) {
  return COMPANY.staff.find((p) => p.id === id && p.active !== false) || null;
}

/** Η σημερινή μέρα ως "2026-11-01", σε τοπική ώρα Ελλάδας. */
function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // το en-CA δίνει ήδη μορφή YYYY-MM-DD
}

function monthOf(dayKey) {
  return dayKey.slice(0, 7);
}

/** Κόβει κείμενο που γράφει ο χρήστης, για να μη φουσκώνει η αποθήκευση. */
function clean(text, max) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/* ---------------- Συνδέσεις ---------------- */

/**
 * Το "εισιτήριο" που κρατάει ο browser μετά τη σύνδεση. Δεν περιέχει PIN.
 * Είναι υπογεγραμμένο, οπότε δεν μπορεί κάποιος να φτιάξει δικό του και να
 * παρουσιαστεί ως admin.
 */
function makeToken(person) {
  const payload = `${person.id}.${person.role}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

function readToken(token) {
  if (typeof token !== "string") return null;
  const bits = token.split(".");
  if (bits.length !== 3) return null;
  const person = findStaff(bits[0]);
  if (!person) return null;
  // Συγκρίνουμε με το token που ΘΑ βγάζαμε τώρα για αυτό το άτομο. Αν άλλαξε
  // ο ρόλος του στο company-data.js, το παλιό token παύει να ισχύει.
  const expected = makeToken(person);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return person;
}

/* ---------------- Δεδομένα μήνα ---------------- */

function emptyMonth() {
  return { lockedDays: {}, entries: {} };
}

async function loadMonth(store, month) {
  const raw = await store.get(`month-${month}`);
  if (!raw) return emptyMonth();
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    lockedDays: data.lockedDays || {},
    entries: data.entries || {},
  };
}

async function saveMonth(store, month, data) {
  await store.set(`month-${month}`, JSON.stringify(data));
}

/**
 * Έχει περάσει η προθεσμία για τον μήνα αυτόν;
 * Ο admin δεν δεσμεύεται από προθεσμία.
 */
function deadlinePassed(month) {
  const day = Number(COMPANY.rules && COMPANY.rules.deadlineDayOfPreviousMonth);
  if (!day) return false;
  const today = todayKey();
  const [y, m] = month.split("-").map(Number);
  // Η προθεσμία είναι η <day> του προηγούμενου μήνα.
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const limit = `${prev.y}-${String(prev.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return today > limit;
}

/* ---------------- Τι βλέπει η σελίδα ---------------- */

/** Οι ρυθμίσεις που επιτρέπεται να φτάσουν στο κινητό — χωρίς PIN, χωρίς μυστικά. */
function publicConfig() {
  return {
    brand: COMPANY.brand,
    theme: COMPANY.theme,
    copy: COMPANY.copy || {},
    rules: {
      maxOffPerDay: (COMPANY.rules && COMPANY.rules.maxOffPerDay) || 0,
      deadlineDayOfPreviousMonth:
        (COMPANY.rules && COMPANY.rules.deadlineDayOfPreviousMonth) || 0,
      allowPastDays: Boolean(COMPANY.rules && COMPANY.rules.allowPastDays),
    },
    staff: COMPANY.staff
      .filter((p) => p.active !== false)
      .map((p) => ({ id: p.id, name: p.name, team: p.team || "" })),
    today: todayKey(),
  };
}

/** Ονόματα και τμήματα, για να τα δείχνει ο πίνακας χωρίς δεύτερη κλήση. */
function staffIndex() {
  const index = {};
  for (const p of COMPANY.staff) {
    index[p.id] = { name: p.name, team: p.team || "", role: p.role || "staff" };
  }
  return index;
}

/* ---------------- Οι ενέργειες ---------------- */

const actions = {
  /** Ρυθμίσεις + λίστα ονομάτων. Δεν θέλει σύνδεση — δεν περιέχει τίποτα κρυφό. */
  async config() {
    return ok(publicConfig());
  },

  /** Σύνδεση με όνομα + PIN. */
  async login(store, body) {
    const id = typeof body.id === "string" ? body.id : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    const person = findStaff(id);
    // Ίδιο μήνυμα και για λάθος όνομα και για λάθος PIN: δεν αποκαλύπτουμε
    // ποιο από τα δύο έφταιγε.
    if (!person || !person.pin || person.pin !== pin) {
      return fail(401, "Λάθος όνομα ή PIN.");
    }
    return ok({
      token: makeToken(person),
      me: { id: person.id, name: person.name, role: person.role || "staff", team: person.team || "" },
    });
  },

  /** Ο πίνακας ενός μήνα — όλα τα αιτήματα όλων. Τον βλέπει κάθε συνδεδεμένος. */
  async month(store, body, person) {
    const month = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(month)) return fail(400, "Λάθος μήνας.");
    const data = await loadMonth(store, month);
    return ok({
      month,
      lockedDays: data.lockedDays,
      entries: data.entries,
      staff: staffIndex(),
      today: todayKey(),
      closed: deadlinePassed(month),
    });
  },

  /**
   * Καταχώρηση/αλλαγή/σβήσιμο αιτήματος για ΜΙΑ μέρα.
   * Ο εργαζόμενος γράφει μόνο για τον εαυτό του — ο admin για όποιον θέλει.
   */
  async saveDay(store, body, person) {
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");

    const isAdmin = person.role === "admin";
    const targetId = isAdmin && body.staffId ? String(body.staffId) : person.id;
    const target = findStaff(targetId);
    if (!target) return fail(400, "Άγνωστος εργαζόμενος.");
    if (!isAdmin && targetId !== person.id) {
      return fail(403, "Μπορείς να δηλώσεις μόνο για τον εαυτό σου.");
    }

    const month = monthOf(day);

    if (!isAdmin) {
      if (deadlinePassed(month)) return fail(403, "Η προθεσμία για αυτόν τον μήνα έχει περάσει.");
      if (!publicConfig().rules.allowPastDays && day < todayKey()) {
        return fail(403, "Η μέρα αυτή έχει περάσει.");
      }
    }

    const data = await loadMonth(store, month);

    // Κλειδωμένη μέρα: ο admin την άνοιξε για κανέναν. Μόνο ο ίδιος γράφει.
    if (!isAdmin && Object.prototype.hasOwnProperty.call(data.lockedDays, day)) {
      return fail(403, "Η μέρα είναι κλειδωμένη από τη διεύθυνση.");
    }

    const entry = data.entries[targetId] || { days: {}, note: "", updatedAt: "" };
    entry.days = entry.days || {};

    const kind = body.kind;
    if (kind === "clear") {
      delete entry.days[day];
    } else if (kind === "off") {
      entry.days[day] = { kind: "off", note: clean(body.note, 120) };
    } else if (kind === "limited") {
      const from = typeof body.from === "string" ? body.from : "";
      const to = typeof body.to === "string" ? body.to : "";
      if (!TIME.test(from) || !TIME.test(to)) return fail(400, "Συμπλήρωσε ώρα από και έως.");
      if (from === to) return fail(400, "Οι δύο ώρες είναι ίδιες.");
      entry.days[day] = { kind: "limited", from, to, note: clean(body.note, 120) };
    } else if (kind === "note") {
      const note = clean(body.note, 120);
      if (!note) return fail(400, "Γράψε τη σημείωση.");
      entry.days[day] = { kind: "note", note };
    } else {
      return fail(400, "Λάθος τύπος αιτήματος.");
    }

    entry.updatedAt = new Date().toISOString();
    data.entries[targetId] = entry;
    await saveMonth(store, month, data);

    return ok({ month, lockedDays: data.lockedDays, entries: data.entries, staff: staffIndex(), today: todayKey() });
  },

  /** Η ελεύθερη σημείωση του εργαζόμενου για όλον τον μήνα. */
  async saveNote(store, body, person) {
    const month = typeof body.month === "string" ? body.month : "";
    if (!MONTH_KEY.test(month)) return fail(400, "Λάθος μήνας.");
    if (person.role !== "admin" && deadlinePassed(month)) {
      return fail(403, "Η προθεσμία για αυτόν τον μήνα έχει περάσει.");
    }
    const data = await loadMonth(store, month);
    const entry = data.entries[person.id] || { days: {}, note: "", updatedAt: "" };
    entry.note = clean(body.note, 400);
    entry.updatedAt = new Date().toISOString();
    data.entries[person.id] = entry;
    await saveMonth(store, month, data);
    return ok({ month, lockedDays: data.lockedDays, entries: data.entries, staff: staffIndex(), today: todayKey() });
  },

  /** Κλείδωμα / ξεκλείδωμα μέρας για όλους. Μόνο ο admin. */
  async lockDay(store, body, person) {
    if (person.role !== "admin") return fail(403, "Μόνο η διεύθυνση κλειδώνει μέρες.");
    const day = typeof body.day === "string" ? body.day : "";
    if (!DAY_KEY.test(day)) return fail(400, "Λάθος ημερομηνία.");
    const month = monthOf(day);
    const data = await loadMonth(store, month);

    if (body.locked) {
      data.lockedDays[day] = clean(body.reason, 60) || "Κλειστή μέρα";
    } else {
      delete data.lockedDays[day];
    }
    await saveMonth(store, month, data);
    return ok({ month, lockedDays: data.lockedDays, entries: data.entries, staff: staffIndex(), today: todayKey() });
  },
};

/**
 * Το μοναδικό σημείο εισόδου. Δέχεται το όνομα της ενέργειας και το σώμα του
 * αιτήματος, και επιστρέφει { status, body }.
 */
async function handle(store, payload) {
  const action = payload && typeof payload.action === "string" ? payload.action : "";
  const body = (payload && payload.data) || {};

  if (!SECRET) {
    return fail(500, "Λείπει η μυστική φράση (SHIFT_SECRET ή security.secret).");
  }

  if (action === "config") return actions.config();
  if (action === "login") return actions.login(store, body);

  // Όλα τα υπόλοιπα θέλουν σύνδεση.
  const person = readToken(payload && payload.token);
  if (!person) return fail(401, "Χρειάζεται νέα σύνδεση.");

  const fn = { month: actions.month, saveDay: actions.saveDay, saveNote: actions.saveNote, lockDay: actions.lockDay }[action];
  if (!fn) return fail(400, "Άγνωστη ενέργεια.");
  return fn(store, body, person);
}

module.exports = { handle, publicConfig, todayKey };
