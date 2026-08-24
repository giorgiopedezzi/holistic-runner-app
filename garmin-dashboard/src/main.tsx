import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted (no CDN request) — weights matching every --fw-* token in
// use (400/500/600/700, see index.css's typography-scale section).
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
