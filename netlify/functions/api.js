/**
 * Το μοναδικό endpoint της εφαρμογής. Δεν αλλάζει ανά επιχείρηση.
 *
 * Η σελίδα στέλνει πάντα POST στο /api με { action, token, data } και παίρνει
 * JSON πίσω. Οι κανόνες είναι στο engine/rules.js — εδώ μόνο δίνουμε στους
 * κανόνες τα τρία πράγματα που τους λείπουν: την επιχείρηση, την αποθήκευση,
 * και την υπογραφή του "εισιτηρίου".
 */

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { COMPANY } = require("../../company-data.js");
const rules = require("../../engine/rules.js");

// Η μυστική φράση υπογράφει τις συνδέσεις. Προτιμάται η environment variable
// του Netlify, ώστε να μη βρίσκεται μέσα στα αρχεία του έργου.
const SECRET = process.env.SHIFT_SECRET || (COMPANY.security && COMPANY.security.secret) || "";

// Netlify Blobs: δωρεάν αποθήκευση που έρχεται μαζί με το site. Δεν θέλει
// στήσιμο ούτε νέο λογαριασμό — αρκεί το site να είναι στο Netlify.
// consistency: "strong" σημαίνει «δώσε μου πάντα την τελευταία εικόνα».
// Χωρίς αυτό το Netlify απαντάει γρήγορα αλλά μπορεί να δώσει παλιά
// δεδομένα για λίγη ώρα: ο ένας θα καταχωρούσε ρεπό και ο άλλος, από άλλο
// κινητό, δεν θα το έβλεπε — ή θα έσβηνε την καταχώρηση του πρώτου.
const blobs = () => getStore({ name: "shift-planner", consistency: "strong" });

const store = {
  async get(key) {
    return blobs().get(key, { type: "text" });
  },
  async set(key, value) {
    await blobs().set(key, value);
  },
};

const ctx = {
  company: COMPANY,
  store,
  sign: (text) => crypto.createHmac("sha256", SECRET).update(text).digest("hex").slice(0, 32),
};

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  // Σε αυτή τη μορφή function τα Netlify Blobs ΔΕΝ ρυθμίζονται μόνα τους:
  // πρέπει να τους δώσουμε το event πριν ζητήσουμε την αποθήκευση. Χωρίς
  // αυτή τη γραμμή κάθε διάβασμα σκάει με «The environment has not been
  // configured to use Netlify Blobs».
  connectLambda(event);

  if (event.httpMethod !== "POST") return json(405, { error: "Μόνο POST." });

  if (!SECRET) {
    return json(500, { error: "Λείπει η μυστική φράση (SHIFT_SECRET ή security.secret)." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Κακοδιατυπωμένο αίτημα." });
  }

  try {
    const result = await rules.handle(ctx, payload);
    return json(result.status, result.body);
  } catch (err) {
    // Το σφάλμα μένει στα logs του Netlify. Στον χρήστη λέμε κάτι κατανοητό,
    // χωρίς τεχνικές λεπτομέρειες.
    console.error("shift-planner:", err);
    return json(500, { error: "Κάτι πήγε λάθος στον διακομιστή. Δοκίμασε ξανά." });
  }
};
