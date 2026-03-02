# trackers-stats

Scraping automatique des stats (nombre de torrents) de 4 trackers privés, avec dashboard web en temps réel.

## Trackers supportés

| Tracker | URL | Méthode |
|---------|-----|---------|
| **C411** | https://c411.org | Texte de la page d'accueil |
| **La Cale** | https://la-cale.space | Page `/stats`, attente JS |
| **Torr9** | https://torr9.xyz | Texte de la page d'accueil |
| **ABN** | https://abn.lol | Pagination calculée : `(dernière_page - 1) × 50 + torrents_dernière_page` |

## Installation

```bash
npm install
```

Copier `.env.example` → `.env` et remplir les identifiants :

```bash
cp .env.example .env
```

## Configuration (.env)

```env
SCRAPE_INTERVAL_MINUTES=10   # Intervalle de scraping en minutes
PORT=3000                    # Port du serveur web

C411_USERNAME=...
C411_PASSWORD=...

LACALE_USERNAME=...
LACALE_PASSWORD=...

TORR9_USERNAME=...
TORR9_PASSWORD=...

ABN_USERNAME=...
ABN_PASSWORD=...

# Optionnel
HEADLESS=true          # false = navigateur visible (debug)
CHROME_PATH=...        # Chemin personnalisé vers le navigateur
```

## Lancement

```bash
# Serveur web + scraping automatique
node server.js

# Dashboard : http://localhost:3000
```

```bash
# Scrape unique (sans serveur)
node scrape.js
```

## Dashboard

Accessible sur **http://localhost:3000**, 3 onglets :

- **Graphique** — Évolution par plage temporelle (6h / 24h / 7j / 30j / tout)
- **Tableau** — Historique complet, tri par colonne, filtre, pagination, export CSV
- **Paramètres** — Statut, prochain scrape, changement d'intervalle, édition des identifiants

## Docker / NAS

Le script détecte automatiquement Chromium sous Linux. S'assurer que Chromium est installé :

```dockerfile
RUN apt-get install -y chromium-browser
```

```env
HEADLESS=true
CHROME_PATH=/usr/bin/chromium-browser
```

## Structure

```
trackers-stats/
├── scrape.js          # Logique de scraping (4 trackers)
├── server.js          # Serveur Express + cron
├── public/
│   └── index.html     # Dashboard web (3 onglets)
├── data/
│   └── stats.json     # Historique des scrapes
├── .env               # Identifiants et config (non versionné)
└── .env.example       # Template de configuration
```
