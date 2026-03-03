// ═══════════════════════════════════════════════════════════
//  server.js — Serveur web + cron pour trackers-stats
//  Lance: node server.js → http://localhost:3000
// ═══════════════════════════════════════════════════════════
const express = require('express');
const path = require('path');
const fs = require('fs');
const { main: runScrape, loadData, DATA_FILE } = require('./scrape');

// ── Config persistante (data/config.json) ───────────────
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

function loadAppConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch(e) { /* ignore */ }
  return { intervalMinutes: 10, startTime: '', trackers: {} };
}

function saveAppConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function applyConfigToEnv(cfg) {
  const envMap = {
    c411:   { user: 'C411_USERNAME',   pass: 'C411_PASSWORD'   },
    lacale: { user: 'LACALE_USERNAME', pass: 'LACALE_PASSWORD' },
    torr9:  { user: 'TORR9_USERNAME',  pass: 'TORR9_PASSWORD'  },
    abn:    { user: 'ABN_USERNAME',    pass: 'ABN_PASSWORD'    },
    tos:    { user: 'TOS_USERNAME',    pass: 'TOS_PASSWORD'    },
    gf:     { user: 'GF_USERNAME',     pass: 'GF_PASSWORD'     },
  };
  if (cfg.trackers) {
    for (const [id, keys] of Object.entries(envMap)) {
      const t = cfg.trackers[id] || {};
      if (t.username) process.env[keys.user] = t.username;
      if (t.password) process.env[keys.pass] = t.password;
    }
  }
}

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT) || 3000;

// Charger la config persistante au démarrage
const _initCfg = loadAppConfig();
applyConfigToEnv(_initCfg);

let INTERVAL = _initCfg.intervalMinutes || parseInt(process.env.SCRAPE_INTERVAL_MINUTES) || 10;
let START_TIME = _initCfg.startTime || process.env.SCRAPE_START_TIME || null; // format "HH:MM"

// État
let isRunning = false;
let lastScrape = null;
let nextScrape = null;
let scrapeTimer = null;

// ── Cache lecture stats ─────────────────────────────────
let _statsCache = null;
let _statsCacheTime = 0;

function loadDataCached() {
  const now = Date.now();
  if (_statsCache && now - _statsCacheTime < 5000) return _statsCache;
  _statsCache = loadData();
  _statsCacheTime = now;
  return _statsCache;
}

function invalidateStatsCache() {
  _statsCache = null;
  _statsCacheTime = 0;
}

// ── API ──────────────────────────────────────────────

// Données de scraping
app.get('/api/stats', (req, res) => {
  const data = loadDataCached();
  res.json(data);
});

// Status
app.get('/api/status', (req, res) => {
  res.json({
    isRunning,
    lastScrape,
    nextScrape,
    intervalMinutes: INTERVAL,
    startTime: START_TIME || null,
  });
});

// Scrape manuel
app.post('/api/scrape', async (req, res) => {
  if (isRunning) return res.json({ error: 'Scraping déjà en cours' });
  res.json({ message: 'Scraping lancé' });
  doScrape();
});

// Config : lecture
app.get('/api/config', (req, res) => {
  const cfg = loadAppConfig();
  const t = cfg.trackers || {};
  res.json({
    intervalMinutes: INTERVAL,
    startTime: START_TIME || '',
    C411_USERNAME:   (t.c411   || {}).username || '',
    LACALE_USERNAME: (t.lacale || {}).username || '',
    TORR9_USERNAME:  (t.torr9  || {}).username || '',
    ABN_USERNAME:    (t.abn    || {}).username || '',
    TOS_USERNAME:    (t.tos    || {}).username || '',
    GF_USERNAME:     (t.gf     || {}).username || '',
  });
});

// Config : écriture (intervalle + heure début + identifiants)
app.post('/api/config', (req, res) => {
  const { intervalMinutes, startTime, tracker, username, password } = req.body || {};

  if (intervalMinutes !== undefined || startTime !== undefined) {
    if (intervalMinutes !== undefined) {
      const mins = parseInt(intervalMinutes);
      if (!mins || mins < 1) return res.json({ error: 'Intervalle invalide' });
      INTERVAL = mins;
    }
    if (startTime !== undefined) {
      START_TIME = startTime || null;
    }
    const cfg = loadAppConfig();
    cfg.intervalMinutes = INTERVAL;
    cfg.startTime = START_TIME || '';
    saveAppConfig(cfg);
    scheduleNext();
    return res.json({ ok: true, intervalMinutes: INTERVAL, startTime: START_TIME });
  }

  if (tracker && username) {
    const validTrackers = ['c411', 'lacale', 'torr9', 'abn', 'tos', 'gf'];
    if (!validTrackers.includes(tracker)) return res.json({ error: 'Tracker inconnu' });
    const cfg = loadAppConfig();
    if (!cfg.trackers) cfg.trackers = {};
    if (!cfg.trackers[tracker]) cfg.trackers[tracker] = {};
    cfg.trackers[tracker].username = username;
    if (password) cfg.trackers[tracker].password = password;
    saveAppConfig(cfg);
    applyConfigToEnv(cfg);
    return res.json({ ok: true });
  }

  res.json({ error: 'Paramètres manquants' });
});

// Effacer l'historique
app.post('/api/clear', (req, res) => {
  try {
    const empty = { scrapes: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2));
    invalidateStatsCache();
    res.json({ ok: true });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ── Fichiers statiques ───────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Scraping périodique ──────────────────────────────────
async function doScrape() {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await runScrape();
    lastScrape = new Date().toISOString();
  } catch (err) {
    console.error('Erreur scrape:', err.message);
  }
  isRunning = false;
  invalidateStatsCache();
  scheduleNext();
}

function scheduleNext() {
  if (scrapeTimer) clearTimeout(scrapeTimer);
  const ms = msUntilNext();
  nextScrape = new Date(Date.now() + ms).toISOString();
  scrapeTimer = setTimeout(doScrape, ms);
  console.log(`Prochain scrape: ${new Date(nextScrape).toLocaleString('fr-FR')}`);
}

// Calcule les ms jusqu'au prochain slot aligné sur START_TIME
function msUntilNext() {
  const intervalMs = INTERVAL * 60000;
  if (!START_TIME || !/^\d{1,2}:\d{2}$/.test(START_TIME)) {
    return intervalMs;
  }
  const [h, m] = START_TIME.split(':').map(Number);

  // Ancre = aujourd'hui à START_TIME, en heure LOCALE du serveur
  const anchor = new Date();
  anchor.setHours(h, m, 0, 0);
  let anchorMs = anchor.getTime();

  const now = Date.now();

  // Si l'ancre est dans le futur (ex: il est 19h, start=20h),
  // reculer l'ancre d'un intervalle pour que le calcul converge
  // sur le prochain slot APRÈS now.
  if (anchorMs > now) {
    anchorMs -= intervalMs;
  }

  const diff = now - anchorMs;                          // toujours >= 0
  const elapsed = Math.floor(diff / intervalMs);         // nb de slots écoulés
  const next = anchorMs + (elapsed + 1) * intervalMs;   // prochain slot
  return Math.max(1000, next - now);
}



// ── Démarrage ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  TRACKERS-STATS — http://localhost:${PORT}`);
  console.log(`  Intervalle: ${INTERVAL} min${START_TIME ? ' • départ ' + START_TIME : ''}`);
  console.log(`  TZ serveur: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`════════════════════════════════════════════\n`);

  if (START_TIME) {
    // Si un heure de début est configurée : aligner le PREMIER scrape
    // sur le prochain slot (pas de scrape immédiat au boot)
    scheduleNext();
  } else {
    // Pas de START_TIME : premier scrape dans 5s, puis intervalle fixe
    setTimeout(doScrape, 5000);
  }
});
