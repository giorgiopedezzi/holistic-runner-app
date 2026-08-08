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
import { readBody, readBodyBuffer } from "../http/request.ts";

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

  const updateOutliers: Handler = async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
    const speedDelta = Number(body.outlier_speed_delta_per_sec);
    const cadenceDelta = Number(body.outlier_cadence_delta_per_sec);
    const minSpeedKmh = Number(body.outlier_min_speed_kmh);
    const minTrendGroupSize = Number(body.min_trend_group_size);
    if (!Number.isFinite(speedDelta) || speedDelta <= 0 || !Number.isFinite(cadenceDelta) || cadenceDelta <= 0 || !Number.isFinite(minSpeedKmh) || minSpeedKmh < 0) {
      return send(res, { error: "outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec and outlier_min_speed_kmh must be positive numbers (outlier_min_speed_kmh may be 0)" }, 400);
    }
    if (!Number.isInteger(minTrendGroupSize) || minTrendGroupSize < 2) {
      return send(res, { error: "min_trend_group_size must be an integer of at least 2" }, 400);
    }
    repo.updateOutliers({ $outlier_speed_delta_per_sec: speedDelta, $outlier_cadence_delta_per_sec: cadenceDelta, $outlier_min_speed_kmh: minSpeedKmh, $min_trend_group_size: minTrendGroupSize });
    return send(res, repo.get());
  };

  const updateTheme: Handler = async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
    if (!body.theme || !THEME_NAMES.includes(body.theme)) {
      return send(res, { error: `theme must be one of: ${THEME_NAMES.join(", ")}` }, 400);
    }
    repo.updateTheme({ $theme: body.theme });
    return send(res, repo.get());
  };

  // PUT /api/settings/background — selects a bundled preset, or clears back to
  // "none". Uploading a custom image is a separate POST (below), binary body.
  const updateBackground: Handler = async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
    if (body.background_kind !== "none" && body.background_kind !== "bundled") {
      return send(res, { error: "background_kind must be 'none' or 'bundled' (use POST /api/settings/background/upload for custom images)" }, 400);
    }
    if (body.background_kind === "bundled" && !body.background_value) {
      return send(res, { error: "background_value (preset id) is required when background_kind is 'bundled'" }, 400);
    }
    repo.updateBackground({
      $background_kind: body.background_kind,
      $background_value: body.background_kind === "bundled" ? (body.background_value ?? null) : null,
    });
    return send(res, repo.get());
  };

  const updateUnits: Handler = async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
    if (!body.unit_system || !UNIT_SYSTEMS.includes(body.unit_system)) {
      return send(res, { error: `unit_system must be one of: ${UNIT_SYSTEMS.join(", ")}` }, 400);
    }
    repo.updateUnits({ $unit_system: body.unit_system });
    return send(res, repo.get());
  };

  const updateDetailView: Handler = async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
    if (!body.activity_detail_view || !DETAIL_VIEWS.includes(body.activity_detail_view)) {
      return send(res, { error: `activity_detail_view must be one of: ${DETAIL_VIEWS.join(", ")}` }, 400);
    }
    repo.updateDetailView({ $activity_detail_view: body.activity_detail_view });
    return send(res, repo.get());
  };

  const backgroundImage: Handler = (_req, res) => {
    const row = repo.get() as unknown as SettingsRow;
    if (row.background_kind !== "custom" || !row.background_value) return send(res, { error: "No custom background set" }, 404);
    const filePath = path.join(backgroundsDir, row.background_value);
    if (!fs.existsSync(filePath)) return send(res, { error: "Background file missing" }, 404);
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
      return send(res, { error: `ext must be one of: ${Object.keys(IMAGE_EXT_MIME).join(", ")}` }, 400);
    }
    const buf = await readBodyBuffer(req);
    if (buf.length === 0) return send(res, { error: "Empty upload" }, 400);
    if (buf.length > 10 * 1024 * 1024) return send(res, { error: "Image too large (max 10MB)" }, 400);

    const prev = repo.get() as unknown as SettingsRow;
    const filename = `bg-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(backgroundsDir, filename), buf);
    if (prev.background_kind === "custom" && prev.background_value) {
      try { fs.unlinkSync(path.join(backgroundsDir, prev.background_value)); } catch { /* already gone, fine */ }
    }
    repo.updateBackground({ $background_kind: "custom", $background_value: filename });
    return send(res, repo.get());
  };

  return { get, updateOutliers, updateTheme, updateBackground, updateUnits, updateDetailView, backgroundImage, uploadBackground };
}
