# trackers-stats

Dashboard web qui scrape et historise le nombre de torrents de trackers privés francais.

## Trackers supportés

| Tracker | URL | Moteur |
|---|---|---|
| C411 | https://c411.org | Nuxt 3 — texte page d'accueil |
| La Cale | https://la-cale.space | Next.js RSC — page /stats |
| Torr9 | https://torr9.xyz | Next.js SPA — page d'accueil |
| A** | https://a**.***| ASP.NET MVC — pagination calculée |
| TheOldSchool | https://theoldschool.cc | UNIT3D — page /stats Livewire |
| Generation-Free | https://generation-free.org | UNIT3D — page /stats Livewire |

## Fonctionnalités

- Scraping automatique à intervalle configurable, avec alignement sur une heure fixe
- 3 tentatives par tracker en cas d'échec
- Dashboard web : graphique (12 plages temporelles), tableau (groupement jour/semaine/mois), paramètres
- Export PNG et CSV
- Configuration complète via la WebUI — aucun fichier de config à éditer
- Les identifiants sont stockés dans `data/config.json` (non versionné)

## Déploiement Docker (recommandé)

```bash
git clone https://github.com/l-at-nnes/trackers-stats.git
cd trackers-stats
docker compose up -d --build
```

L'application est disponible sur `http://<ip>:3000`.

Les identifiants se configurent dans l'onglet **Paramètres** de la WebUI et sont sauvegardés dans `data/config.json` sur l'hôte (volume bind-mount).

## Mise à jour

```bash
git pull
docker compose up -d --build
```

Les données dans `data/` ne sont jamais écrasées.

## Sans Docker

Node.js 18+ et Chromium requis.

```bash
npm install
node server.js
```

Le script détecte automatiquement Brave, Chrome, Edge ou Chromium.
Pour forcer un chemin : variable d'environnement `CHROME_PATH`.

## Structure

```
trackers-stats/
├── scrape.js          # Logique de scraping (6 trackers, 3 essais/tracker)
├── server.js          # Serveur Express + planificateur
├── public/
│   └── index.html     # Dashboard web
├── data/
│   ├── config.json    # Identifiants et config (non versionné, géré par la WebUI)
│   └── stats.json     # Historique des scrapes (non versionné)
├── Dockerfile
└── docker-compose.yml
```

## Sécurité

`data/config.json` et `data/stats.json` sont dans `.gitignore` et ne sont jamais commités.
