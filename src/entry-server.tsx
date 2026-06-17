import { StrictMode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import App from "./App";
import { HeadTags } from "./components/HeadTags";
import type { Edition } from "./types/edition";
import latestData from "../data/latest.json";

const edition = latestData as unknown as Edition;

/**
 * Build-time render. `App` seeds itself from the same statically-imported
 * edition the client uses, so the markup here matches client hydration
 * exactly. No CSS is imported — styles ship via the client bundle.
 */
export function render() {
  const html = renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const head = renderToStaticMarkup(<HeadTags edition={edition} />);
  return { html, head };
}
