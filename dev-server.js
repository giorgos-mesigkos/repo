/**
 * ΤΟΠΙΚΗ ΔΟΚΙΜΗ — δεν ανεβαίνει στο Netlify, δεν το πειράζεις.
 *
 * Τρέξε:  node dev-server.js
 * Άνοιξε: http://localhost:8787
 *
 * Κάνει ό,τι κάνει το Netlify, αλλά στον υπολογιστή σου: σερβίρει τη σελίδα
 * και απαντάει στο /api. Αντί για Netlify Blobs, γράφει σε ένα αρχείο JSON
 * μέσα στον φάκελο .dev-data — για να δοκιμάζεις χωρίς να ανεβάζεις τίποτα.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { handle } = require("./netlify/lib/core.js");

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.join(__dirname, ".dev-data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

/* ---------- Αποθήκευση σε αρχείο, στη θέση των Netlify Blobs ---------- */

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

const store = {
  async get(key) {
    const all = readAll();
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
  },
  async set(key, value) {
    const all = readAll();
    all[key] = value;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf8");
  },
};

/* ---------- Στατικά αρχεία ---------- */

// Μόνο αυτά τα αρχεία σερβίρονται. Το company-data.js ΔΕΝ είναι στη λίστα,
// όπως δεν ανεβαίνει ούτε στο Netlify: περιέχει τα PIN.
const PUBLIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "Μόνο POST." }));
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) req.destroy();
    });
    req.on("end", async () => {
      let out;
      try {
        out = await handle(store, JSON.parse(raw || "{}"));
      } catch (err) {
        console.error(err);
        out = { status: 500, body: { error: "Σφάλμα διακομιστή." } };
      }
      res.writeHead(out.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(out.body));
    });
    return;
  }

  const file = PUBLIC_FILES[url];
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Δεν βρέθηκε.");
  }
  try {
    const body = fs.readFileSync(path.join(__dirname, file[0]));
    res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Σφάλμα ανάγνωσης.");
  }
});

server.listen(PORT, () => {
  console.log(`Τοπική δοκιμή: http://localhost:${PORT}`);
});
