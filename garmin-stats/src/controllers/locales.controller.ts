/**
 * controllers/locales.controller.ts
 * Serves static translation bundles (GET /api/v1/locales/:lang) — flat
 * key→string JSON, one file per language under garmin-stats/locales/,
 * sibling to openapi.json/config.json/backgrounds/. Static content, not
 * DB-backed, so there's no service/repo layer: reads live off disk per
 * request (fs.readFileSync, no cache, no build step), same idiom as
 * docs.controller.ts's openapi.json serving.
 */
import fs from "fs";
import path from "path";
import type { AppContext, Handler } from "../http/context.ts";
import { notFound } from "../http/problem.ts";

// The two bundles under garmin-stats/locales/ — kept in sync with
// settings.controller.ts's LANGUAGES (minus 'auto', which never names a file).
const SUPPORTED_LANGUAGES = ["en", "it"];

export function createLocalesController(ctx: AppContext) {
  const localesDir = path.resolve(ctx.scriptsDir, "..", "locales");

  // GET /api/v1/locales/:lang — the raw key→string object, no envelope
  // (this isn't a collection resource). :lang is whitelisted against
  // SUPPORTED_LANGUAGES before it ever touches the filesystem.
  const get: Handler = (_req, res, url) => {
    const lang = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      throw notFound(`Unsupported language: ${lang}. Supported: ${SUPPORTED_LANGUAGES.join(", ")}`);
    }
    let body: string;
    try {
      body = fs.readFileSync(path.join(localesDir, `${lang}.json`), "utf8");
    } catch {
      throw notFound(`Locale file not found for language: ${lang}`);
    }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
    res.end(body);
  };

  return { get };
}
