/**
 * Το μοναδικό endpoint της εφαρμογής. Δεν αλλάζει ανά επιχείρηση.
 *
 * Η σελίδα στέλνει πάντα POST στο /api με { action, token, data } και παίρνει
 * JSON πίσω. Οι κανόνες είναι στο engine/rules.js — εδώ μόνο δίνουμε στους
 * κανόνες τα τρία πράγματα που τους λείπουν: την επιχείρηση, την αποθήκευση,
 * και την υπογραφή του "εισιτηρίου".
 *
 * Γραμμένο στη σύγχρονη μορφή function (export default + Response). Η παλιά
 * μορφή (exports.handler) δεν κάνει εδώ για δύο λόγους: το Netlify σταματάει
 * να τη δέχεται από τον Ιούλιο 2027, και — το κρίσιμο — σε εκείνη τη μορφή η
 * αποθήκευση ΔΕΝ μπορεί να διαβάσει με ισχυρή συνέπεια.
 */

import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import companyData from "../../company-data.js";
import rules from "../../engine/rules.js";

const { COMPANY } = companyData;

// Η μυστική φράση υπογράφει τις συνδέσεις. Προτιμάται η environment variable
// του Netlify, ώστε να μη βρίσκεται μέσα στα αρχεία του έργου.
const SECRET = process.env.SHIFT_SECRET || (COMPANY.security && COMPANY.security.secret) || "";

// Netlify Blobs: δωρεάν αποθήκευση που έρχεται μαζί με το site. Δεν θέλει
// στήσιμο ούτε νέο λογαριασμό — αρκεί το site να είναι στο Netlify.
//
// consistency: "strong" σημαίνει «δώσε μου πάντα την τελευταία εικόνα».
// Χωρίς αυτό το Netlify απαντάει γρήγορα αλλά μπορεί να δώσει παλιά δεδομένα
// για λίγη ώρα: ο ένας θα καταχωρούσε ρεπό και ο άλλος, από άλλο κινητό, δεν
// θα το έβλεπε — ή, χειρότερα, θα έγραφε από πάνω του.
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

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Μόνο POST." });

  if (!SECRET) {
    return json(500, { error: "Λείπει η μυστική φράση (SHIFT_SECRET ή security.secret)." });
  }

  let payload;
  try {
    payload = await req.json();
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
