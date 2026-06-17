import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  Minus,
  Radio,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { formatRomanianDate, formatRomanianNumber, readingTimeMinutes } from "./lib/utils";
import type { ArchiveIndex, Edition } from "./types/edition";
import latestData from "../data/latest.json";

// The latest edition is known at build time and baked into the bundle, so the
// first render is synchronous and identical on the server (prerender) and the
// client (hydration). validate:data gates the build, so the cast is safe.
const INITIAL_EDITION = latestData as unknown as Edition;

// Reader-facing update rhythm: noutățile sunt verificate la aceste ore
// (Europe/Bucharest) și publicate intraday doar când apar schimbări relevante.
// A se menține în sincron cu programul rutinei.
const UPDATE_TIMES = "07:30, 12:30, 17:30 și 22:30";

// Reading order (matches the single-column mobile flow). The narrative columns
// are numbered 01–06; the indicators/risks rail sits alongside on desktop, so
// it reads as a parallel panel (n: null) rather than steps in the sequence.
const sections = [
  { id: "sumar", label: "Rezumat", n: "01" },
  { id: "stiri", label: "Știri", n: "02" },
  { id: "romania", label: "România", n: "03" },
  { id: "fonduri", label: "Fonduri", n: "04" },
  { id: "indicatori", label: "Indicatori", n: null },
  { id: "riscuri", label: "Riscuri", n: null },
  { id: "monitorizat", label: "De monitorizat", n: "05" },
  { id: "concluzie", label: "Concluzie", n: "06" },
] as const;

function SectionHeading({ number, eyebrow, title }: { number?: string; eyebrow: string; title: string }) {
  return (
    <header className={number ? "section-heading" : "section-heading section-heading--plain"}>
      {number && <span className="section-number">{number}</span>}
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </header>
  );
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {children}<ExternalLink aria-hidden="true" />
    </a>
  );
}

function ImpactDots({ value }: { value: number }) {
  return (
    <span className="impact-dots" aria-label={`Impact ${value} din 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < value ? "is-active" : ""} />
      ))}
    </span>
  );
}

function TrendIcon({ trend }: { trend: "în creștere" | "stabil" | "în scădere" }) {
  if (trend === "în creștere") return <ArrowUp aria-hidden="true" />;
  if (trend === "în scădere") return <ArrowDown aria-hidden="true" />;
  return <Minus aria-hidden="true" />;
}

function App() {
  const [edition, setEdition] = useState<Edition>(INITIAL_EDITION);
  const [archive, setArchive] = useState<ArchiveIndex>({ editions: [] });
  const [selectedDate, setSelectedDate] = useState("latest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The latest edition is baked into the bundle, so the first paint needs no
  // fetch. Only the archive index is loaded at runtime, and it is
  // non-critical: a failure simply leaves the selector with the current
  // edition rather than blanking the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/data/archive/index.json", { cache: "no-cache" });
        if (!response.ok) return;
        const index = (await response.json()) as ArchiveIndex;
        if (!cancelled) setArchive(index);
      } catch {
        // ignore: the selector falls back to showing only the current edition
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEdition = async (value: string) => {
    setSelectedDate(value);
    setError(null);
    if (value === "latest") {
      setEdition(INITIAL_EDITION);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/data/archive/${value}.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error("Ediția selectată nu a putut fi încărcată.");
      setEdition((await response.json()) as Edition);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A apărut o eroare.");
    } finally {
      setLoading(false);
    }
  };

  const updatedLabel = useMemo(
    () => formatRomanianDate(edition.metadata.updatedAt, true),
    [edition],
  );

  const readingTime = useMemo(() => readingTimeMinutes(edition), [edition]);

  return (
    <>
      <a className="skip-link" href="#continut">Sari la conținut</a>
      <div className="reading-progress" aria-hidden="true" />

      <header className="topbar">
        <a href="#top" className="brand" aria-label="Hapics, începutul paginii">
          <span className="brand-mark">H</span>
          <span>
            <strong>HAPICS</strong>
            <small>Briefingul de dimineață</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="live-status"><Radio aria-hidden="true" /> Ediția curentă</span>
          <span className="updated"><Clock3 aria-hidden="true" /> Actualizat {updatedLabel}</span>
        </div>
        <Select value={selectedDate} onValueChange={loadEdition} disabled={loading}>
          <SelectTrigger aria-label="Selectează ediția din arhivă">
            <CalendarDays aria-hidden="true" className="size-4 text-muted" />
            <SelectValue placeholder="Arhivă" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Ediția curentă</SelectItem>
            {archive.editions.map((item) => (
              <SelectItem value={item.date} key={item.date}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="header-notice">
        <p className="update-cadence"><Clock3 aria-hidden="true" /> Verificăm noutățile la {UPDATE_TIMES} (ora României) și publicăm pe parcursul zilei doar la schimbări relevante.</p>
      </div>

      <nav className="mobile-section-nav" aria-label="Secțiunile ediției">
        {sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.label}</a>)}
      </nav>

      <div className="page-shell" id="top">
        <aside className="section-rail" aria-label="Cuprins">
          <p className="rail-label">În ediția de azi</p>
          <nav>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={s.n ? undefined : "is-panel"}>
                <span>{s.n ?? "·"}</span>{s.label}
              </a>
            ))}
          </nav>
          <div className="rail-note">
            <ShieldAlert aria-hidden="true" />
            <p>Faptele, interpretările și incertitudinile sunt afișate separat.</p>
          </div>
        </aside>

        <main className="edition" id="continut">
          {error && <div className="inline-error" role="alert">{error}</div>}
          {loading && <div className="loading-bar" aria-hidden="true" />}

          <header className="edition-masthead reveal">
            <div className="edition-kicker">
              <span>{formatRomanianDate(`${edition.metadata.editionDate}T12:00:00+03:00`)}</span>
              <span>Lectură: {readingTime} {readingTime === 1 ? "minut" : "minute"}</span>
              <span>{edition.importantNews.length} subiecte-cheie</span>
            </div>
            <h1>{edition.metadata.title}</h1>
            <div className="edition-status-row">
              <Badge variant={edition.metadata.status === "demo" ? "warning" : "accent"}>
                {edition.metadata.status === "demo" ? "Ediție demonstrativă" : "Publicat"}
              </Badge>
              {edition.metadata.sourceCoverage === "partial" && (
                <span className="coverage-note"><CircleAlert aria-hidden="true" /> Acoperire parțială a surselor</span>
              )}
            </div>
          </header>

          <div className="editorial-grid">
            <div className="primary-start">
              <section id="sumar" className="content-section reveal delay-1">
                <SectionHeading number="01" eyebrow="În 90 de secunde" title="Rezumat executiv" />
                <ol className="summary-list">
                  {edition.executiveSummary.map((item, index) => (
                    <li key={item.id}>
                      <span className="summary-index">{String(index + 1).padStart(2, "0")}</span>
                      <p>{item.text}</p>
                      <Badge>{item.category}</Badge>
                    </li>
                  ))}
                </ol>
              </section>

              <section id="stiri" className="content-section">
                <SectionHeading number="02" eyebrow="Fapte confirmate" title="Știrile importante" />
                <div className="news-list">
                  {edition.importantNews.map((item, index) => (
                    <article className="news-item" key={item.id}>
                      <div className="news-order">{String(index + 1).padStart(2, "0")}</div>
                      <div className="news-content">
                        <div className="news-tags">
                          <Badge variant="accent">{item.category}</Badge>
                          {item.isSecondary && <Badge variant="outline">Sursă secundară</Badge>}
                        </div>
                        <h3>{item.title}</h3>
                        <div className="fact-block">
                          <span><CheckCircle2 aria-hidden="true" /> Fapt</span>
                          <p>{item.fact}</p>
                        </div>
                        <div className="interpretation-block">
                          <span><Gauge aria-hidden="true" /> Interpretare</span>
                          <p>{item.interpretation}</p>
                        </div>
                        <div className="news-footer">
                          <span><b>Impact</b> {item.impactLabel} <ImpactDots value={item.impact} /></span>
                          <span><b>Orizont</b> {item.horizon}</span>
                          <SourceLink href={item.sourceUrl}>{item.sourceName}</SourceLink>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section id="romania" className="content-section">
                <SectionHeading number="03" eyebrow="Cadru local" title="Interpretare pentru România" />
                <div className="analysis-facts">
                  <p className="mini-label">Baza factuală</p>
                  <ul>{edition.romaniaAnalysis.factBase.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                </div>
                <div className="analysis-columns">
                  <article><span>01 / Politic</span><p>{edition.romaniaAnalysis.political}</p></article>
                  <article><span>02 / Economic</span><p>{edition.romaniaAnalysis.economic}</p></article>
                </div>
                <blockquote>{edition.romaniaAnalysis.interpretation}</blockquote>
              </section>

              <section id="fonduri" className="content-section">
                <SectionHeading number="04" eyebrow="Nu sunt recomandări" title="Semnale pentru fonduri" />
                <div className="signal-table" role="table" aria-label="Semnale generale pentru fonduri">
                  <div className="signal-header" role="row">
                    <span>Expunere</span><span>Semnal</span><span>Forță</span><span>Orizont</span>
                  </div>
                  {edition.investmentFundSignals.map((signal) => (
                    <div className="signal-row" role="row" key={signal.id}>
                      <div><strong>{signal.label}</strong><p>{signal.rationale}</p></div>
                      <Badge variant={signal.direction === "pozitiv" ? "accent" : signal.direction === "negativ" ? "warning" : "outline"}>{signal.direction}</Badge>
                      <ImpactDots value={signal.strength} />
                      <span>{signal.horizon}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="market-rail" aria-label="Indicatori și scoruri de risc">
              <div className="market-rail-inner">
                <section id="indicatori" className="rail-section">
                  <SectionHeading eyebrow="Tablou rapid" title="Indicatorii zilei" />
                  <div className="indicator-list">
                    {edition.indicators.map((indicator) => (
                      <article key={indicator.id} className="indicator-item">
                        <div>
                          <span>{indicator.label}</span>
                          <strong>{formatRomanianNumber(indicator.value)}{indicator.unit === "%" ? "" : " "}<small>{indicator.unit}</small></strong>
                        </div>
                        <Badge variant={indicator.freshness === "current" ? "accent" : "warning"}>
                          {indicator.freshness === "current" ? "La zi" : indicator.freshness === "stale" ? "Date vechi" : "Indisponibil"}
                        </Badge>
                        <p>{formatRomanianDate(`${indicator.referenceDate}T12:00:00+03:00`)}</p>
                        <SourceLink href={indicator.sourceUrl}>{indicator.sourceName}</SourceLink>
                        {indicator.note && <small className="indicator-note">{indicator.note}</small>}
                      </article>
                    ))}
                  </div>
                </section>

                <Separator />

                <section id="riscuri" className="rail-section">
                  <SectionHeading eyebrow="Scală 1–5" title="Scoruri de risc" />
                  <div className="risk-list">
                    {edition.riskScores.map((risk) => (
                      <article key={risk.id}>
                        <div className="risk-topline">
                          <span>{risk.label}</span>
                          <strong>{risk.score}<small>/5</small></strong>
                        </div>
                        <div className="risk-track"><span style={{ width: `${risk.score * 20}%` }} /></div>
                        <p>{risk.description}</p>
                        <small className={`trend trend-${risk.trend.replaceAll(" ", "-")}`}>
                          <TrendIcon trend={risk.trend} />{risk.trend}
                        </small>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </aside>

            <div className="primary-end">
              <section id="monitorizat" className="content-section watch-section">
                <SectionHeading number="05" eyebrow="Semnale neconfirmate" title="De monitorizat" />
                <p className="section-intro">Aici rămân informațiile incomplete, contradictorii sau fără confirmare suficientă.</p>
                <div className="watch-list">
                  {edition.watchlist.map((item) => (
                    <article key={item.id}>
                      <div>
                        <Badge variant="warning">{item.status}</Badge>
                        <h3>{item.title}</h3>
                        <p>{item.why}</p>
                      </div>
                      <div className="trigger"><span>Intră în ediție când</span><p>{item.trigger}</p></div>
                      {item.sourceUrl && <SourceLink href={item.sourceUrl}>Sursă de urmărit</SourceLink>}
                    </article>
                  ))}
                </div>
              </section>

              <section id="concluzie" className="conclusion-section">
                <span className="conclusion-number">06</span>
                <p className="eyebrow">Concluzia dimineții</p>
                <h2>{edition.conclusion.title}</h2>
                <p className="conclusion-body">{edition.conclusion.body}</p>
                <ul>{edition.conclusion.actionPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              </section>
            </div>
          </div>

          <section className="sources-section" aria-labelledby="sources-title">
            <div>
              <p className="eyebrow">Transparență</p>
              <h2 id="sources-title">Sursele ediției</h2>
            </div>
            <div className="source-list">
              {edition.sources.map((source) => (
                <SourceLink href={source.url} key={source.id}>{source.name}</SourceLink>
              ))}
            </div>
          </section>

          <footer>
            <div className="footer-brand"><span className="brand-mark">H</span><strong>HAPICS</strong></div>
            <p>Conținut informativ. Nu reprezintă consultanță financiară, juridică sau recomandare de investiții.</p>
            <a href="#top">Înapoi sus <ArrowRight aria-hidden="true" /></a>
          </footer>
        </main>
      </div>
    </>
  );
}

export default App;
