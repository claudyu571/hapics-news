import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distHtmlPath = path.join(root, "dist", "index.html");
const serverEntry = path.join(root, "dist-ssr", "entry-server.js");

const { render } = await import(pathToFileURL(serverEntry).href);
const { html, head } = render();

let template = fs.readFileSync(distHtmlPath, "utf8");

for (const marker of ["<!--app-html-->", "<!--app-head-->"]) {
  if (!template.includes(marker)) {
    console.error(`✗ prerender: marker ${marker} not found in dist/index.html`);
    process.exit(1);
  }
}

template = template.replace("<!--app-html-->", html).replace("<!--app-head-->", head);
fs.writeFileSync(distHtmlPath, template);

console.log("✓ prerender: injected edition markup + head tags into dist/index.html");
