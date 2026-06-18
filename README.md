# Hapics News

Website static pentru briefingul zilnic de știri, economie și piețe financiare, publicat prin GitHub Pages la `news.hapics.uk`.

## Dezvoltare locală

```bash
npm install
npm run dev
```

Verificare completă:

```bash
npm test
npm run test:news-delta
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

### Detectorul Biziday

Verificarea intraday folosește fluxul RSS Biziday, cu pagina principală drept fallback,
și compară articolele recente cu URL-urile deja folosite în ediția curentă:

```bash
npm run news:delta -- data/latest.json
```

Comanda emite un singur obiect JSON compact cu sursa verificării și articolele candidate.
Nu modifică fișiere. Dacă ambele surse Biziday sunt indisponibile, termină cu eroare,
iar ediția publicată rămâne neatinsă. Detectorul aplică o suprapunere de 30 de minute
față de `metadata.updatedAt`, apoi elimină URL-urile deja prezente în
`importantNews[].sourceUrl` sau `sources[].url`.

### Indicatori preluați automat

`publish:edition` rulează automat preluarea indicatorilor (`enrichIndicators`) înainte de
validare, deci nu e nevoie de pași suplimentari în rutină. Logica trăiește în
`scripts/fetch-indicators.mjs` și poate fi rulată și separat:

```bash
npm run fetch:indicators -- data/drafts/2026-06-17.json          # dry run
npm run fetch:indicators -- data/drafts/2026-06-17.json --write  # scrie în fișier
npm run publish:edition  -- data/drafts/2026-06-17.json --no-fetch  # publică fără preluare
```

Indicatori gestionați (creați automat dacă lipsesc, apoi completați): `eur-ron`
(BNR `nbrfxrates.xml`), `bet` și `rotx` (paginile de indici BVB), `robor` (zilnic, BNR)
și `ircc` (trimestrial, BNR). Astfel ROTX și separarea ROBOR/IRCC persistă în fiecare
ediție, chiar dacă draftul brut nu le include. Indicatorul vechi `robor-ircc` este
eliminat automat la îmbogățirea ediției curente.

Reguli:

- **Îmbogățește, nu distruge.** O preluare reușită suprascrie valoarea; una eșuată
  păstrează valorile manuale. ROBOR este marcat `stale` până când BNR răspunde din nou.
  Nu se inventează niciodată o valoare.
- **Doar ediția curentă** este îmbogățită (`editionDate` = azi), ca republicarea unei ediții
  din arhivă să nu suprascrie cu prețuri de azi.
- **ROBOR 3M** este preluat din exportul CSV al bazei interactive BNR, seria
  `BBZ_BOR3M`. Se folosește data observației publicată de BNR; la o eroare de
  preluare, ultima valoare este păstrată și marcată drept `stale`.
- **IRCC** este trimestrial: actualizează `IRCC_BY_QUARTER` din `scripts/fetch-indicators.mjs`
  la fiecare trimestru (următoarea schimbare: 1 iulie 2026 → 5,56%).

## Automatizare și publicare

Conținutul este produs de automatizări Codex standalone, în worktree-uri izolate:

- **07:30** — ediție completă, GPT-5.4 cu reasoning medium;
- **12:30, 17:30 și 22:30** — verificări incrementale, GPT-5.4 mini cu reasoning low.

Verificările intraday rulează mai întâi `news:delta`. Fără un subiect cu impact 4–5,
o confirmare/contrazicere din watchlist sau o schimbare materială de analiză, risc ori
semnal pentru fonduri, execuția se oprește fără diff, commit, deploy sau notificare.

La o publicare, automatizarea:

1. creează ediția completă sau actualizează incremental draftul zilei;
2. rulează `publish:edition` și `npm test`;
3. verifică faptul că sunt modificate numai fișierele ediției;
4. face commit și push pe `main`;
5. așteaptă publicarea GitHub Pages și verifică `https://news.hapics.uk/data/latest.json`.

Automatizarea nu rulează local `npm run build`. Buildul complet, inclusiv SSR și
prerender, aparține workflow-ului GitHub Pages și rulează numai după push.

Un eșec de validare nu modifică ediția publicată. O nouă rulare în aceeași zi înlocuiește ediția acelei zile și păstrează o singură intrare în arhivă.

Workflow-ul `pages.yml` validează toate pull request-urile. Pentru push-urile pe `main`, publică directorul `dist` numai după ce testele și buildul reușesc. Nu este necesar niciun secret OpenAI în GitHub.

## GitHub Pages și DNS

- Repository: `claudyu571/hapics-news`
- Source: GitHub Actions
- Custom domain: `news.hapics.uk`
- DNS: CNAME `news` către `claudyu571.github.io`
- Cloudflare este folosit numai pentru administrarea DNS; nu sunt folosite Pages, Functions, D1 sau KV.
