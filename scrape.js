// ═══════════════════════════════════════════════════════════
//  scrape.js — Script unique de scraping de trackers privés
//  Usage: node scrape.js
//  Sauvegarde dans data/stats.json
// ═══════════════════════════════════════════════════════════
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// ── Config ───────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data', 'stats.json');

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
// Linux (Docker)
const CHROME_LINUX = '/usr/bin/google-chrome-stable';
const CHROMIUM_LINUX = '/usr/bin/chromium-browser';
const CHROMIUM_LINUX2 = '/usr/bin/chromium';

function findBrowser() {
  for (const p of [process.env.CHROME_PATH, BRAVE, CHROME, EDGE, CHROME_LINUX, CHROMIUM_LINUX, CHROMIUM_LINUX2].filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Aucun navigateur trouvé. Définissez CHROME_PATH ou installez Chromium.');
}

// ── Helpers ──────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(tracker, msg) {
  const t = new Date().toLocaleTimeString('fr-FR');
  console.log(`[${t}] [${tracker}] ${msg}`);
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { scrapes: [] };
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Attend que Cloudflare passe (s'il y en a)
 */
async function waitForCloudflare(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const title = await page.title();
    const html = await page.content();
    const isCF =
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      html.includes('challenge-platform') ||
      html.includes('__CF$cv$params') ||
      html.includes('cf-chl-bypass');
    if (!isCF) return true;
    await sleep(2000);
  }
  return false; // timeout, on continue quand même
}

/**
 * Extrait un nombre de torrents depuis le texte visible de la page
 */
async function extractTorrentCount(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText || '';

    // Regex pour trouver "X torrents" ou "torrents: X" ou variantes
    const patterns = [
      /(\d[\d\s.,]*)\s*torrents?\b/gi,
      /torrents?\s*[:\-–]\s*(\d[\d\s.,]*)/gi,
      /total\s*(?:des?\s*)?torrents?\s*[:\-–]?\s*(\d[\d\s.,]*)/gi,
      // Variantes de trackers privés FR
      /(\d[\d\s.,]*)\s*cargais/gi,       // La Cale utilise "cargaisons"
      /(\d[\d\s.,]*)\s*uploads?\b/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const numStr = match[1].replace(/[\s.]/g, '').replace(/,/g, '');
        const num = parseInt(numStr, 10);
        if (num > 50 && num < 10_000_000) return num;
      }
    }

    // Fallback : chercher dans les scripts JSON
    for (const s of document.querySelectorAll('script')) {
      const c = s.textContent || '';
      for (const p of [/"torrentCount"\s*:\s*(\d+)/, /"totalTorrents"\s*:\s*(\d+)/,
                        /"total_torrents"\s*:\s*(\d+)/, /"torrents"\s*:\s*(\d+)/,
                        /"nbTorrents"\s*:\s*(\d+)/]) {
        const m = c.match(p);
        if (m) { const n = parseInt(m[1], 10); if (n > 50) return n; }
      }
    }

    return null;
  });
}

// ═══════════════════════════════════════════════════════════
//  SCRAPERS
// ═══════════════════════════════════════════════════════════

/**
 * C411 — https://c411.org (Nuxt 3)
 */
async function scrapeC411(page) {
  const user = process.env.C411_USERNAME;
  const pass = process.env.C411_PASSWORD;
  if (!user || !pass) throw new Error('Identifiants manquants');

  log('C411', 'Ouverture de la page de login...');
  await page.goto('https://c411.org/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForCloudflare(page);
  await sleep(2000);

  // Login
  log('C411', 'Connexion...');
  await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 15000 });

  const userField = await page.$('input[name="username"]') || await page.$('input[type="text"]');
  const passField = await page.$('input[type="password"]');
  if (!userField || !passField) throw new Error('Formulaire de login introuvable');

  await userField.click({ clickCount: 3 });
  await userField.type(user, { delay: 20 });
  await passField.click({ clickCount: 3 });
  await passField.type(pass, { delay: 20 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(3000);
  log('C411', `Après login: ${page.url()}`);

  // Page d'accueil (c'est là que le nombre de torrents est affiché)
  log('C411', 'Navigation vers la page d\'accueil...');
  await page.goto('https://c411.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCloudflare(page);
  await sleep(5000);

  const count = await extractTorrentCount(page);

  if (count) {
    log('C411', `Trouvé: ${count.toLocaleString('fr-FR')} torrents`);
  } else {
    const preview = await page.evaluate(() => document.body.innerText.substring(0, 300));
    log('C411', `Pas trouvé. Aperçu: ${preview}`);
  }
  return count;
}

/**
 * La Cale — https://la-cale.space (Next.js RSC, stats client-side)
 */
async function scrapeLaCale(page) {
  const user = process.env.LACALE_USERNAME;
  const pass = process.env.LACALE_PASSWORD;
  if (!user || !pass) throw new Error('Identifiants manquants');

  log('La Cale', 'Ouverture de la page de login...');
  await page.goto('https://la-cale.space/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForCloudflare(page);
  await sleep(2000);

  // Login
  log('La Cale', 'Connexion...');
  await page.waitForSelector('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', { timeout: 15000 });

  const emailField = await page.$('input[name="email"]') || await page.$('input[type="email"]') || await page.$('input[type="text"]');
  const passField = await page.$('input[type="password"]');
  if (!emailField || !passField) throw new Error('Formulaire de login introuvable');

  await emailField.click({ clickCount: 3 });
  await emailField.type(user, { delay: 20 });
  await passField.click({ clickCount: 3 });
  await passField.type(pass, { delay: 20 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(3000);
  log('La Cale', `Après login: ${page.url()}`);

  // Stats (Registres de la Flotte)
  log('La Cale', 'Navigation vers /stats...');
  await page.goto('https://la-cale.space/stats', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCloudflare(page);

  // La page charge les stats côté client, il faut attendre
  log('La Cale', 'Attente du chargement client-side...');
  await sleep(10000);

  // Extraire le nombre de "cargaisons" (= torrents dans le thème pirate de La Cale)
  const count = await page.evaluate(() => {
    const text = document.body.innerText || '';

    // Chercher "X CARGAIS" ou "X cargaisons" ou "X torrents"
    const patterns = [
      /(\d[\d\s.,]*)\s*cargais/gi,
      /(\d[\d\s.,]*)\s*torrents?\b/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const numStr = match[1].replace(/[\s.]/g, '').replace(/,/g, '');
        const num = parseInt(numStr, 10);
        if (num > 50 && num < 10_000_000) return num;
      }
    }

    // Fallback: chercher dans les scripts JSON
    for (const s of document.querySelectorAll('script')) {
      const c = s.textContent || '';
      for (const p of [/"torrentCount"\s*:\s*(\d+)/, /"totalTorrents"\s*:\s*(\d+)/,
                        /"torrents"\s*:\s*(\d+)/, /"nbTorrents"\s*:\s*(\d+)/]) {
        const m = c.match(p);
        if (m) { const n = parseInt(m[1], 10); if (n > 50) return n; }
      }
    }

    return null;
  });

  if (count) {
    log('La Cale', `Trouvé: ${count.toLocaleString('fr-FR')} torrents (cargaisons)`);
  } else {
    const preview = await page.evaluate(() => document.body.innerText.substring(0, 300));
    log('La Cale', `Pas trouvé. Aperçu: ${preview}`);
  }
  return count;
}

/**
 * Torr9 — https://torr9.xyz (Next.js SPA)
 */
async function scrapeTorr9(page) {
  const user = process.env.TORR9_USERNAME;
  const pass = process.env.TORR9_PASSWORD;
  if (!user || !pass) throw new Error('Identifiants manquants');

  log('Torr9', 'Ouverture du site...');
  await page.goto('https://torr9.xyz', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForCloudflare(page);
  await sleep(3000);

  // Naviguer vers login
  log('Torr9', 'Page de login...');
  await page.goto('https://torr9.xyz/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCloudflare(page);
  await sleep(3000);

  // Login
  log('Torr9', 'Connexion...');
  await page.waitForSelector('input[type="text"], input[name="username"], input[type="email"]', { timeout: 15000 });

  const userField = await page.$('input[name="username"]') || await page.$('input[name="email"]') || await page.$('input[type="text"]');
  const passField = await page.$('input[type="password"]');
  if (!userField || !passField) throw new Error('Formulaire de login introuvable');

  await userField.click({ clickCount: 3 });
  await userField.type(user, { delay: 20 });
  await passField.click({ clickCount: 3 });
  await passField.type(pass, { delay: 20 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(3000);
  log('Torr9', `Après login: ${page.url()}`);

  // Page d'accueil (pas de /stats sur Torr9)
  log('Torr9', 'Navigation vers la page d\'accueil...');
  await page.goto('https://torr9.xyz/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCloudflare(page);
  await sleep(5000);

  const count = await extractTorrentCount(page);
  if (count) {
    log('Torr9', `Trouvé: ${count.toLocaleString('fr-FR')} torrents`);
  } else {
    const preview = await page.evaluate(() => document.body.innerText.substring(0, 200));
    log('Torr9', `Pas trouvé. Aperçu: ${preview}`);
  }
  return count;
}

/**
 * ABN — https://abn.lol (ASP.NET MVC, pagination calculée)
 * Pas de page "total", on calcule : (dernière_page - 1) * 50 + torrents_sur_dernière_page
 */
async function scrapeABN(page) {
  const user = process.env.ABN_USERNAME;
  const pass = process.env.ABN_PASSWORD;
  if (!user || !pass) throw new Error('Identifiants manquants (ABN_USERNAME / ABN_PASSWORD dans .env)');

  log('ABN', 'Ouverture de https://abn.lol/Home/Login ...');
  try {
    await page.goto('https://abn.lol/Home/Login', { waitUntil: 'networkidle2', timeout: 90000 });
  } catch {
    await page.goto('https://abn.lol/Home/Login', { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await waitForCloudflare(page);

  const currentUrl = page.url();
  log('ABN', `Page: ${currentUrl} — "${await page.title()}"`);

  if (!currentUrl.includes('/Login') && !currentUrl.includes('/login')) {
    log('ABN', 'Déjà connecté, on saute le login');
  } else {
    // Sélecteurs confirmés : name="Username" / name="Password" / button[type="submit"]
    await page.waitForSelector('input[name="Username"]', { timeout: 15000 });
    await page.type('input[name="Username"]', user, { delay: 30 });
    await page.type('input[name="Password"]', pass, { delay: 30 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(3000);

    const urlAfter = page.url();
    log('ABN', `Après login: ${urlAfter}`);
    if (urlAfter.includes('/Login') || urlAfter.includes('/login')) {
      const errMsg = await page.evaluate(() => {
        const el = document.querySelector('.validation-summary-errors, .text-danger');
        return el ? el.textContent.trim() : null;
      });
      throw new Error(`Login ABN échoué${errMsg ? ': ' + errMsg : ' — identifiants incorrects ?'}`);
    }
  }

  // Page des torrents (première page)
  log('ABN', 'Navigation vers /Torrent...');
  try {
    await page.goto('https://abn.lol/Torrent', { waitUntil: 'networkidle2', timeout: 90000 });
  } catch {
    await page.goto('https://abn.lol/Torrent', { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await waitForCloudflare(page);
  await sleep(3000);

  // Trouver la dernière page : bouton » (&#187;) = dernier bouton non-disabled avec data-page
  const lastPage = await page.evaluate(() => {
    const pager = document.querySelector('.mvc-grid-pager');
    if (!pager) return null;
    // Le bouton » est le DERNIER bouton non-disabled avec data-page
    const buttons = Array.from(pager.querySelectorAll('button[data-page]'))
      .filter(b => !b.classList.contains('disabled') && b.getAttribute('tabindex') !== '-1');
    if (!buttons.length) return null;
    return parseInt(buttons[buttons.length - 1].getAttribute('data-page'), 10);
  });

  if (!lastPage) throw new Error('Impossible de trouver le nombre de pages (pager introuvable)');
  log('ABN', `Dernière page détectée: ${lastPage}`);

  // Cliquer sur le bouton » pour naviguer à la dernière page
  log('ABN', 'Navigation vers la dernière page...');
  await page.evaluate(() => {
    const pager = document.querySelector('.mvc-grid-pager');
    const buttons = Array.from(pager.querySelectorAll('button[data-page]'))
      .filter(b => !b.classList.contains('disabled') && b.getAttribute('tabindex') !== '-1');
    buttons[buttons.length - 1].click();
  });

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await sleep(4000); // laisser le temps au rendu JS

  // Compter les torrents sur la dernière page via les liens torrent_link_*
  const lastPageRows = await page.evaluate(() => {
    return document.querySelectorAll('a[id^="torrent_link_"]').length;
  });

  if (lastPageRows === 0) throw new Error('Aucun torrent trouvé sur la dernière page');

  // Calcul total : (N-1) * 50 + torrents_dernière_page
  const total = (lastPage - 1) * 50 + lastPageRows;
  log('ABN', `Page ${lastPage} → ${lastPageRows} torrents → Total calculé: ${total.toLocaleString('fr-FR')}`);

  return total;
}

// ─── UNIT3D — Scraper générique (TheOldSchool, GF, ...) ────
/**
 * Fonctionne sur tout tracker UNIT3D v8/v9.
 * Login /login  →  /stats  →  panel Torrents (Livewire lazy)
 */
async function scrapeUnit3D(page, siteId, baseUrl, user, pass) {
  if (!user || !pass) throw new Error(`Identifiants manquants pour ${siteId}`);

  log(siteId, `Login → ${baseUrl}/login`);
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await waitForCloudflare(page);
  await sleep(2000);

  const currentUrl = page.url();
  log(siteId, `Page: ${currentUrl} — "${await page.title()}"`);

  if (!currentUrl.includes('/login')) {
    log(siteId, 'Déjà connecté');
  } else {
    // UNIT3D : champ "username" (parfois "email")
    const userField = await page.$('input[name="username"]') ||
                      await page.$('input[name="email"]') ||
                      await page.$('input[id="username"]');
    const passField = await page.$('input[type="password"]');
    if (!userField || !passField) {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(i => `type=${i.type} name=${i.name} id=${i.id}`)
      );
      log(siteId, `Inputs disponibles: ${inputs.join(' | ')}`);
      throw new Error('Formulaire de login introuvable');
    }
    await userField.click({ clickCount: 3 });
    await userField.type(user, { delay: 30 });
    await passField.click({ clickCount: 3 });
    await passField.type(pass, { delay: 30 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
      page.click('button[type="submit"]').catch(() => passField.press('Enter')),
    ]);
    await sleep(2000);

    const urlAfter = page.url();
    log(siteId, `Après login: ${urlAfter}`);
    if (urlAfter.includes('/login')) {
      const errMsg = await page.evaluate(() => {
        const el = document.querySelector('.alert-danger, .validation-errors, [class*="error"], .text-danger');
        return el ? el.textContent.trim().substring(0, 120) : null;
      });
      throw new Error(`Login ${siteId} échoué${errMsg ? ': ' + errMsg : ' — identifiants incorrects ?'}`);
    }
  }

  // Page stats
  log(siteId, 'Navigation vers /stats...');
  try {
    await page.goto(`${baseUrl}/stats`, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch {
    await page.goto(`${baseUrl}/stats`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await waitForCloudflare(page);
  await sleep(2000);

  // Livewire utilise x-intersect : scroller pour déclencher le lazy load
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Attendre que le panel Torrents soit chargé (remplace "Loading...")
  await page.waitForFunction(() => {
    for (const panel of document.querySelectorAll('.panelV2')) {
      const h = panel.querySelector('.panel__heading, h2');
      if (h && /^torrents$/i.test(h.textContent.trim())) {
        const body = panel.querySelector('.panel__body');
        return body && !body.textContent.includes('Loading...');
      }
    }
    return false;
  }, { timeout: 30000 }).catch(() => null);

  // Extraire le compte de torrents du panel
  const count = await page.evaluate(() => {
    for (const panel of document.querySelectorAll('.panelV2')) {
      const h = panel.querySelector('.panel__heading, h2');
      if (!h || !/^torrents$/i.test(h.textContent.trim())) continue;
      const text = panel.textContent;
      // Cherche "Total torrents : 12,345" ou "12,345 torrents" etc.
      const patterns = [
        /total(?:\s+des?)?\s+torrents?\s*:?\s*([\d,\s]+)/i,
        /([\d,\s]+)\s+total(?:\s+des?)?\s+torrents?/i,
        /([\d]+[\d,\s]*)(?=\s+torrents?\b)/i,
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m) {
          const n = parseInt(m[1].replace(/[,\s]/g, ''));
          if (n > 50) return n;
        }
      }
      // Fallback : premier grand nombre dans le panel
      const numMatch = text.match(/(\d{3,}[\d,]*)/);
      if (numMatch) {
        const n = parseInt(numMatch[1].replace(/,/g, ''));
        if (n > 50) return n;
      }
    }
    return null;
  });

  if (!count) {
    const fallback = await extractTorrentCount(page);
    if (fallback) { log(siteId, `Fallback: ${fallback.toLocaleString('fr-FR')} torrents`); return fallback; }
    throw new Error('Impossible de trouver le nombre de torrents sur /stats');
  }

  log(siteId, `Trouvé: ${count.toLocaleString('fr-FR')} torrents`);
  return count;
}

async function scrapeTOS(page) {
  return scrapeUnit3D(
    page, 'TOS',
    'https://theoldschool.cc',
    process.env.TOS_USERNAME,
    process.env.TOS_PASSWORD
  );
}

async function scrapeGF(page) {
  return scrapeUnit3D(
    page, 'GF',
    'https://generation-free.org',
    process.env.GF_USERNAME,
    process.env.GF_PASSWORD
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  TRACKERS-STATS — Scraping');
  console.log(`  ${new Date().toLocaleString('fr-FR')}`);
  console.log('══════════════════════════════════════════════\n');

  const executablePath = findBrowser();
  const headless = process.env.HEADLESS !== 'false'; // headless par défaut (Docker), HEADLESS=false pour debug
  console.log(`Navigateur: ${executablePath} (${headless ? 'headless' : 'visible'})\n`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=fr-FR',
    ],
    defaultViewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const results = { c411: null, lacale: null, torr9: null, abn: null, tos: null, gf: null };

  // Scrape chaque tracker séquentiellement (un seul navigateur)
  const trackers = [
    { id: 'c411',   name: 'C411',     fn: scrapeC411   },
    { id: 'lacale', name: 'La Cale',  fn: scrapeLaCale },
    { id: 'torr9',  name: 'Torr9',    fn: scrapeTorr9  },
    { id: 'abn',    name: 'ABN',      fn: scrapeABN    },
    { id: 'tos',    name: 'TOS',      fn: scrapeTOS    },
    { id: 'gf',     name: 'GF',       fn: scrapeGF     },
  ];

  for (const tracker of trackers) {
    const page = await browser.newPage();
    try {
      const count = await tracker.fn(page);
      results[tracker.id] = count !== null ? { torrents: count, status: 'ok' } : { torrents: null, status: 'no_data' };
    } catch (err) {
      log(tracker.name, `ERREUR: ${err.message}`);
      results[tracker.id] = { torrents: null, status: 'error', error: err.message };
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close().catch(() => {});

  // Sauvegarder
  const entry = {
    timestamp: new Date().toISOString(),
    trackers: results,
  };

  const data = loadData();
  data.scrapes.push(entry);
  saveData(data);

  // Résumé
  console.log('\n──────────────────────────────────────────────');
  console.log('  RÉSUMÉ');
  console.log('──────────────────────────────────────────────');
  for (const [id, r] of Object.entries(results)) {
    const label = r.torrents ? r.torrents.toLocaleString('fr-FR') + ' torrents' : r.status;
    const icon = r.torrents ? '✓' : '✗';
    console.log(`  ${icon} ${id}: ${label}`);
  }
  console.log(`\n  Sauvegardé dans ${DATA_FILE}`);
  console.log(`  Total entrées: ${data.scrapes.length}\n`);

  return entry;
}

// Si lancé directement: node scrape.js
if (require.main === module) {
  main().catch(err => {
    console.error('Erreur fatale:', err);
    process.exit(1);
  });
}

module.exports = { main, loadData, DATA_FILE };
