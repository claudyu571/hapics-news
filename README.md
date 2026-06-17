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
ediție, chiar dacă draftul brut nu le include.

Reguli:

- **Îmbogățește, nu distruge.** O preluare reușită suprascrie valoarea; una eșuată lasă
  indicatorul neatins (valorile manuale supraviețuiesc). Nu se inventează niciodată o valoare.
- **Doar ediția curentă** este îmbogățită (`editionDate` = azi), ca republicarea unei ediții
  din arhivă să nu suprascrie cu prețuri de azi.
- **ROBOR** rămâne manual până când se confirmă endpoint-ul BNR (site reproiectat) prin
  variabila `BNR_ROBOR_URL`; altfel valoarea existentă din draft este păstrată.
- **IRCC** este trimestrial: actualizează `IRCC_BY_QUARTER` din `scripts/fetch-indicators.mjs`
  la fiecare trimestru (următoarea schimbare: 1 iulie 2026 → 5,56%).

## Automatizare și publicare

Rutina Codex `Briefing Biziday Romania` este singurul producător de conținut. După redactare, rutina:

1. creează un draft care respectă schema JSON;
2. rulează `publish:edition`, testele și buildul;
3. face commit doar pentru fișierele ediției și push pe `main`;
4. așteaptă publicarea GitHub Pages;
5. verifică ediția live la `https://news.hapics.uk/data/latest.json`.

Un eșec de validare nu modifică ediția publicată. O nouă rulare în aceeași zi înlocuiește ediția acelei zile și păstrează o singură intrare în arhivă.

Workflow-ul `pages.yml` validează toate pull request-urile. Pentru push-urile pe `main`, publică directorul `dist` numai după ce testele și buildul reușesc. Nu este necesar niciun secret OpenAI în GitHub.

## GitHub Pages și DNS

- Repository: `claudyu571/hapics-news`
- Source: GitHub Actions
- Custom domain: `news.hapics.uk`
- DNS: CNAME `news` către `claudyu571.github.io`
- Cloudflare este folosit numai pentru administrarea DNS; nu sunt folosite Pages, Functions, D1 sau KV.
