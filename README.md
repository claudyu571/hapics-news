# Hapics News

Website static pentru briefingul zilnic de știri, economie și piețe financiare, publicat la `news.hapics.uk`.

## Dezvoltare locală

```bash
npm install
npm run dev
```

Verificare completă:

```bash
npm test
npm run build
```

## Date și publicare

- `data/latest.json` — ediția afișată implicit.
- `data/archive/YYYY-MM-DD.json` — edițiile istorice.
- `data/archive/index.json` — lista selectorului de arhivă.
- `data/drafts/` — ieșirea nepublicată a automatizării.
- `schema/edition.schema.json` — schema JSON validată înainte de build.

Publicarea manuală a unui draft valid:

```bash
npm run publish:edition -- data/drafts/2026-06-17.json
```

Comanda validează draftul, actualizează arhiva și `latest.json`, apoi revalidează întregul set de date.

## Automatizare

Workflow-ul `daily-brief.yml` pornește la 07:30 în `Europe/Bucharest`, inclusiv la schimbarea orei de vară. GitHub Actions rulează două cron-uri UTC, iar `scripts/schedule-window.mjs` permite doar execuția care cade în ora locală 07.

Repository secret necesar:

- `OPENAI_API_KEY` — folosit exclusiv de `openai/codex-action` pentru generarea ediției.

GitHub Actions validează JSON-ul, construiește site-ul, face commit și push. Cloudflare Pages publică automat acel push.

## Cloudflare Pages

Configurația țintă pentru proiectul `hapics-news`:

| Setare | Valoare |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output | `dist` |
| Node.js | `22` |
| Custom domain | `news.hapics.uk` |
| Preview deployments | active pentru branch-uri și pull request-uri |

Nu sunt folosite Pages Functions, D1 sau KV. Fișierul `public/_headers` configurează headerele de securitate și politica de cache.

Autentificare și deploy manual de verificare:

```bash
npx wrangler login
npx wrangler pages deploy dist --project-name hapics-news
```

Pentru fluxul cerut în producție, proiectul Pages trebuie conectat la repository-ul GitHub din Cloudflare Dashboard, nu menținut ca proiect de direct upload.
