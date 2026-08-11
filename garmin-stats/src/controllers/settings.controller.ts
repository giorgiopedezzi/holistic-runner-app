/**
 * controllers/settings.controller.ts
 * HTTP boundary for the settings row + appearance: outlier/trend thresholds, theme,
 * background (bundled/none via PUT, custom image via POST upload, and streaming the
 * stored custom image back). Owns input validation; persists via the settings repo.
 */
import fs from "fs";
import path from "path";
import type { AppContext, Handler } from "../http/context.ts";
import type { SettingsRow } from "../db.ts";
import { send } from "../http/respond.ts";
import { readJsonBody, readBodyBuffer } from "../http/request.ts";
import { notFound, unprocessable, payloadTooLarge } from "../http/problem.ts";

// 'auto' is a valid stored value for theme/units — it means "resolve from the
// OS/browser at render time" (see useAppearance.ts); the backend just persists it.
const THEME_NAMES = ["dark", "light", "dark-blue", "light-warm", "auto"];
const UNIT_SYSTEMS = ["metric", "imperial", "auto"];
const DETAIL_VIEWS = ["accordion", "modal"];
const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

export function createSettingsController(ctx: AppContext) {
  const repo = ctx.repos.settings;
  const { backgroundsDir } = ctx;

  const get: Handler = (_req, res) => send(res, repo.get());

  // PUT /api/v1/settings/outliers — the Outlier-detection card's three values,
  // submitted together by its Save button → full replacement of that sub-resource
  // → PUT (rest-api §2, HRA-40). Its own path (not /thresholds): one card = one
  // sub-resource; the path names exactly what the body modifies.
  const updateOutliers: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    const speedDelta = Number(body.outlier_speed_delta_per_sec);
    const cadenceDelta = Number(body.outlier_cadence_delta_per_sec);
    const minSpeedKmh = Number(body.outlier_min_speed_kmh);
    if (!Number.isFinite(speedDelta) || speedDelta <= 0 || !Number.isFinite(cadenceDelta) || cadenceDelta <= 0 || !Number.isFinite(minSpeedKmh) || minSpeedKmh < 0) {
      throw unprocessable("outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec and outlier_min_speed_kmh must be positive numbers (outlier_min_speed_kmh may be 0).");
    }
    repo.updateOutliers({ $outlier_speed_delta_per_sec: speedDelta, $outlier_cadence_delta_per_sec: cadenceDelta, $outlier_min_speed_kmh: minSpeedKmh });
    return send(res, repo.get());
  };

  // PUT /api/v1/settings/thresholds — the Overview & Trends card's single value
  // (min trend group size), sent whole → PUT (rest-api §2, HRA-40).
  const updateThresholds: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    const minTrendGroupSize = Number(body.min_trend_group_size);
    if (!Number.isInteger(minTrendGroupSize) || minTrendGroupSize < 2) {
      throw unprocessable("min_trend_group_size must be an integer of at least 2.");
    }
    repo.updateThresholds({ $min_trend_group_size: minTrendGroupSize });
    return send(res, repo.get());
  };

  const updateTheme: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    if (!body.theme || !THEME_NAMES.includes(body.theme)) {
      throw unprocessable(`theme must be one of: ${THEME_NAMES.join(", ")}`);
    }
    repo.updateTheme({ $theme: body.theme });
    return send(res, repo.get());
  };

  // PUT /api/v1/settings/background — the complete representation of the background
  // sub-resource ({background_kind, background_value?}): selects a bundled preset, or
  // clears back to "none" → full replacement → PUT. Uploading a custom image is a
  // separate POST (below), binary body.
  const updateBackground: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    if (body.background_kind !== "none" && body.background_kind !== "bundled") {
      throw unprocessable("background_kind must be 'none' or 'bundled' (use POST /api/settings/background/upload for custom images).");
    }
    if (body.background_kind === "bundled" && !body.background_value) {
      throw unprocessable("background_value (preset id) is required when background_kind is 'bundled'.");
    }
    repo.updateBackground({
      $background_kind: body.background_kind,
      $background_value: body.background_kind === "bundled" ? (body.background_value ?? null) : null,
    });
    return send(res, repo.get());
  };

  const updateUnits: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    if (!body.unit_system || !UNIT_SYSTEMS.includes(body.unit_system)) {
      throw unprocessable(`unit_system must be one of: ${UNIT_SYSTEMS.join(", ")}`);
    }
    repo.updateUnits({ $unit_system: body.unit_system });
    return send(res, repo.get());
  };

  const updateDetailView: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<SettingsRow>>(req);
    if (!body.activity_detail_view || !DETAIL_VIEWS.includes(body.activity_detail_view)) {
      throw unprocessable(`activity_detail_view must be one of: ${DETAIL_VIEWS.join(", ")}`);
    }
    repo.updateDetailView({ $activity_detail_view: body.activity_detail_view });
    return send(res, repo.get());
  };

  const backgroundImage: Handler = (_req, res) => {
    const row = repo.get() as unknown as SettingsRow;
    if (row.background_kind !== "custom" || !row.background_value) throw notFound("No custom background set.");
    const filePath = path.join(backgroundsDir, row.background_value);
    if (!fs.existsSync(filePath)) throw notFound("Background file missing.");
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.writeHead(200, {
      "Content-Type": IMAGE_EXT_MIME[ext] ?? "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  };

  // POST /api/settings/background/upload?ext=jpg — raw image bytes as the body.
  const uploadBackground: Handler = async (req, res, url) => {
    const ext = (url.searchParams.get("ext") ?? "").toLowerCase();
    if (!IMAGE_EXT_MIME[ext]) {
      throw unprocessable(`ext must be one of: ${Object.keys(IMAGE_EXT_MIME).join(", ")}`);
    }
    const buf = await readBodyBuffer(req);
    if (buf.length === 0) throw unprocessable("Empty upload.");
    if (buf.length > 10 * 1024 * 1024) throw payloadTooLarge("Image too large (max 10MB).");

    const prev = repo.get() as unknown as SettingsRow;
    const filename = `bg-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(backgroundsDir, filename), buf);
    if (prev.background_kind === "custom" && prev.background_value) {
      try { fs.unlinkSync(path.join(backgroundsDir, prev.background_value)); } catch { /* already gone, fine */ }
    }
    repo.updateBackground({ $background_kind: "custom", $background_value: filename });
    return send(res, repo.get());
  };

  return { get, updateOutliers, updateThresholds, updateTheme, updateBackground, updateUnits, updateDetailView, backgroundImage, uploadBackground };
}
