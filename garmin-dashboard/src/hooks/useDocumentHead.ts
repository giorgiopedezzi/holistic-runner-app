import { useEffect } from "react";

export interface DocumentHeadMeta {
  title: string;
  description?: string | null;
  canonicalPath?: string | null;
}

const MANAGED_ATTR = "data-hra-managed-meta";

// Client-side-only head management for the Guest public route family
// (HRA-368). This app has no server-side rendering, so this does not make a
// shared link unfurl correctly in a crawler that never executes JavaScript
// (e.g. Slack's unfurler) — that would need a small SSR/prerender layer,
// which is out of this Story's scope (flagged in the HRA-368 review
// comment). It still keeps document.title, the canonical link, and Open
// Graph/Twitter tags correct for a JS-capable client and for anyone
// inspecting the rendered DOM. `index.html`'s own `<meta name="robots">`
// stays the single source of truth for indexing — this hook never touches
// it (HRA-368 decision: keep the site-wide noindex hosted-demo policy).
export function useDocumentHead({ title, description, canonicalPath }: DocumentHeadMeta) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const created: HTMLElement[] = [];

    function add(tag: "link" | "meta", attrs: Record<string, string>) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      el.setAttribute(MANAGED_ATTR, "true");
      document.head.appendChild(el);
      created.push(el);
    }

    if (canonicalPath) {
      const href = `${window.location.origin}${canonicalPath}`;
      add("link", { rel: "canonical", href });
      add("meta", { property: "og:url", content: href });
    }
    add("meta", { property: "og:title", content: title });
    add("meta", { name: "twitter:title", content: title });
    add("meta", { property: "og:type", content: "profile" });
    add("meta", { name: "twitter:card", content: "summary" });
    if (description) {
      add("meta", { property: "og:description", content: description });
      add("meta", { name: "twitter:description", content: description });
    }

    return () => {
      document.title = previousTitle;
      created.forEach(el => el.remove());
    };
  }, [title, description, canonicalPath]);
}
