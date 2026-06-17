import type { Edition } from "../types/edition";

const SITE_URL = "https://news.hapics.uk/";
const SITE_NAME = "Hapics";

const truncate = (text: string, max = 200) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * SEO/social metadata for the current edition. Rendered to static markup at
 * build time by the prerender step and injected into <head>. Lives outside
 * #root, so it never participates in client hydration.
 */
export function HeadTags({ edition }: { edition: Edition }) {
  const { metadata, executiveSummary } = edition;
  const description = truncate(executiveSummary[0]?.text ?? metadata.title);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: metadata.title,
    description,
    inLanguage: "ro-RO",
    datePublished: metadata.editionDate,
    dateModified: metadata.updatedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME },
  };

  return (
    <>
      <link rel="canonical" href={SITE_URL} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ro_RO" />
      <meta property="og:title" content={metadata.title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={SITE_URL} />
      <meta property="article:published_time" content={metadata.editionDate} />
      <meta property="article:modified_time" content={metadata.updatedAt} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={metadata.title} />
      <meta name="twitter:description" content={description} />
      <script
        type="application/ld+json"
        // JSON-LD inside a <script>: neutralize "</" so a value can't close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
