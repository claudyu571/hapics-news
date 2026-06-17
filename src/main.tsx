import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-ext-500.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/newsreader/latin-ext-600.css";
import "./index.css";
import App from "./App";

const container = document.getElementById("root")!;
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Production HTML is prerendered, so #root already holds markup to hydrate.
// In dev there is no prerender step (#root is empty), so render fresh.
if (container.firstElementChild) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
