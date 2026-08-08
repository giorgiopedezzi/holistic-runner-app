/**
 * controllers/docs.controller.ts
 * Serves the API contract (GET /api/openapi.json) and a rendered docs page
 * (GET /api/docs). The docs page is a SELF-CONTAINED, dependency-free, no-CDN
 * HTML/JS renderer (fetches the spec same-origin and lists every endpoint) — it
 * honours the project's zero-runtime-dependency + local-only constraints, which a
 * CDN-loaded Swagger UI / Redoc would violate. Additive routes: no existing
 * endpoint's behaviour changes.
 */
import fs from "fs";
import path from "path";
import type { AppContext, Handler } from "../http/context.ts";

// Self-contained docs page. No external resources; fetches /api/openapi.json
// (same origin) and renders it with vanilla JS. Kept free of backticks / ${…}
// so it embeds cleanly in this module's own template literal.
const DOCS_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Garmin Stats API — Docs</title>',
  '<style>',
  ':root{color-scheme:light dark;--bg:#0f1420;--card:#1e2330;--bd:#2b3242;--fg:#e6e9ef;--mut:#9aa4b8;--ok:#17a06c;}',
  '@media(prefers-color-scheme:light){:root{--bg:#f6f7f9;--card:#fff;--bd:#e3e6ea;--fg:#1a1f29;--mut:#5b6472;}}',
  'body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}',
  '.wrap{max-width:960px;margin:0 auto;padding:24px}',
  'h1{margin:0 0 4px}.desc{color:var(--mut);white-space:pre-wrap;margin:0 0 20px}',
  '.tag{margin:26px 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}',
  '.op{border:1px solid var(--bd);background:var(--card);border-radius:8px;margin:8px 0;overflow:hidden}',
  '.op>summary{cursor:pointer;padding:10px 12px;display:flex;gap:10px;align-items:center;list-style:none}',
  '.op>summary::-webkit-details-marker{display:none}',
  '.m{font-weight:700;font-size:11px;padding:3px 7px;border-radius:5px;color:#fff;min-width:52px;text-align:center}',
  '.m.get{background:#3a8ef5}.m.post{background:#17a06c}.m.put{background:#f59e0b}.m.delete{background:#e24b4a}',
  '.path{font-family:ui-monospace,monospace}.sum{color:var(--mut);margin-left:auto;text-align:right}',
  '.body{padding:4px 14px 14px;border-top:1px solid var(--bd)}',
  '.body h4{margin:12px 0 4px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}',
  'table{width:100%;border-collapse:collapse}td{padding:3px 8px 3px 0;vertical-align:top}',
  '.code{font-family:ui-monospace,monospace}.st{font-weight:700}.mut{color:var(--mut)}',
  'a{color:#3a8ef5}',
  '</style></head><body><div class="wrap">',
  '<h1 id="title">API docs</h1><p class="desc" id="desc"></p>',
  '<p class="mut">Raw spec: <a href="/api/openapi.json">/api/openapi.json</a></p>',
  '<div id="out">Loading…</div></div>',
  '<script>',
  'fetch("/api/openapi.json").then(function(r){return r.json()}).then(function(s){',
  '  document.getElementById("title").textContent=s.info.title+" v"+s.info.version;',
  '  document.getElementById("desc").textContent=s.info.description||"";',
  '  var byTag={};var order=[];',
  '  Object.keys(s.paths).forEach(function(p){',
  '    Object.keys(s.paths[p]).forEach(function(m){',
  '      var op=s.paths[p][m];var t=(op.tags&&op.tags[0])||"other";',
  '      if(!byTag[t]){byTag[t]=[];order.push(t)}',
  '      byTag[t].push({p:p,m:m,op:op});',
  '    });',
  '  });',
  '  var out=document.getElementById("out");out.innerHTML="";',
  '  order.forEach(function(t){',
  '    var h=document.createElement("div");h.className="tag";h.textContent=t;out.appendChild(h);',
  '    byTag[t].forEach(function(e){',
  '      var d=document.createElement("details");d.className="op";',
  '      var sm=document.createElement("summary");',
  '      var mb=document.createElement("span");mb.className="m "+e.m;mb.textContent=e.m.toUpperCase();',
  '      var pt=document.createElement("span");pt.className="path";pt.textContent=e.p;',
  '      var su=document.createElement("span");su.className="sum";su.textContent=e.op.summary||"";',
  '      sm.appendChild(mb);sm.appendChild(pt);sm.appendChild(su);d.appendChild(sm);',
  '      var b=document.createElement("div");b.className="body";',
  '      var params=(e.op.parameters||[]).map(function(x){return x.$ref?x.$ref.split("/").pop():x.name});',
  '      var html="";',
  '      if(params.length){html+="<h4>Parameters</h4><div class=code>"+params.join(", ")+"</div>"}',
  '      html+="<h4>Responses</h4><table>";',
  '      Object.keys(e.op.responses).forEach(function(code){',
  '        var rd=e.op.responses[code].description||"";',
  '        html+="<tr><td class=st>"+code+"</td><td class=mut>"+rd+"</td></tr>";',
  '      });',
  '      html+="</table>";',
  '      b.innerHTML=html;d.appendChild(b);out.appendChild(d);',
  '    });',
  '  });',
  '}).catch(function(err){document.getElementById("out").textContent="Failed to load spec: "+err});',
  '</script></body></html>',
].join("\n");

export function createDocsController(ctx: AppContext) {
  const specPath = path.resolve(ctx.scriptsDir, "..", "openapi.json");

  const spec: Handler = (_req, res) => {
    let body: string;
    try {
      body = fs.readFileSync(specPath, "utf8");
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "openapi.json not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
    res.end(body);
  };

  const ui: Handler = (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(DOCS_HTML);
  };

  return { spec, ui };
}
