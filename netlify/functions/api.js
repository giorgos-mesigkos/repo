/**
 * Το μοναδικό endpoint της εφαρμογής. Δεν αλλάζει ανά επιχείρηση.
 *
 * Η σελίδα στέλνει πάντα POST στο /api με { action, token, data } και παίρνει
 * JSON πίσω. Όλη η λογική είναι στο netlify/lib/core.js — εδώ μόνο συνδέουμε
 * την αποθήκευση (Netlify Blobs) και μεταφράζουμε αίτημα/απάντηση.
 */

const { getStore } = require("@netlify/blobs");
const { handle } = require("../lib/core.js");

// Netlify Blobs: δωρεάν αποθήκευση που έρχεται μαζί με το site. Δεν θέλει
// στήσιμο, ούτε νέο λογαριασμό — αρκεί το site να είναι στο Netlify.
const store = {
  async get(key) {
    const blobs = getStore("shift-planner");
    return blobs.get(key, { type: "text" });
  },
  async set(key, value) {
    const blobs = getStore("shift-planner");
    await blobs.set(key, value);
  },
};

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Μόνο POST." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Κακοδιατυπωμένο αίτημα." });
  }

  try {
    const result = await handle(store, payload);
    return json(result.status, result.body);
  } catch (err) {
    // Το σφάλμα μένει στα logs του Netlify. Στον χρήστη λέμε κάτι κατανοητό,
    // χωρίς τεχνικές λεπτομέρειες.
    console.error("shift-planner:", err);
    return json(500, { error: "Κάτι πήγε λάθος στον διακομιστή. Δοκίμασε ξανά." });
  }
};
