// ── fit-file-parser cross-validation ──────────────────────────────────────
// Side-by-side sanity check against the `fit-file-parser` npm package —
// an explicit, deliberate exception to this project's normal
// zero-runtime-dependency rule, scoped to binary FIT decoding only.
//
// This module never feeds the database. fit-parser.ts (the custom decoder,
// with its many field-mapping fixes validated against real files — see its
// own header comment) stays the sole source of truth for what gets
// persisted. This only flags large discrepancies on stdout so a human can
// look into them; it must never throw or otherwise affect ingestion.

import FitParser from "fit-file-parser";
import type { ParsedFit } from "./fit-parser.ts";

const DISCREPANCY_THRESHOLD_PCT = 1;

function pctDiff(primary: number, secondary: number): number {
  const denom = Math.max(Math.abs(primary), 1e-9);
  return (Math.abs(primary - secondary) / denom) * 100;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// fs.readFileSync's Buffer type is generic over ArrayBufferLike (could in
// principle be backed by a SharedArrayBuffer), but fit-file-parser's types
// require a concrete ArrayBuffer-backed Buffer. Node never actually backs a
// readFileSync result with a SharedArrayBuffer, so this cast is safe.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function tryParseSecondary(buf: Buffer, filename: string) {
  try {
    // m/s and m match fit-parser.ts's own internal units, so the two
    // outputs are comparable without an extra conversion step here.
    const parser = new FitParser({ mode: "list", speedUnit: "m/s", lengthUnit: "m" });
    return await parser.parseAsync(toArrayBuffer(buf));
  } catch (e) {
    console.warn(`  ⚠ cross-check (fit-file-parser) failed to parse ${filename}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// Compares total distance, avg heart rate, and track-point count — the
// three cheap, high-signal summary numbers most likely to expose a real
// decoding bug in either parser. Not a full field-by-field reconciliation:
// the two libraries use different internal field names/conventions (e.g.
// this project's cadence-doubling-for-running convention, see CLAUDE.md's
// FIT parser notes) that would need real design work to compare 1:1, and
// that's out of scope for a lightweight "did something break" check.
export async function crossValidateFitParser(buf: Buffer, filename: string, primary: ParsedFit): Promise<void> {
  const secondary = await tryParseSecondary(buf, filename);
  if (!secondary) return;

  const session = secondary.sessions?.[0];
  const secDistance = session ? asNumber(session.total_distance) : null;
  const secAvgHr    = session ? asNumber(session.avg_heart_rate) : null;
  const secPoints   = secondary.records?.length ?? null;

  const primDistance = primary.activity.distance_m;
  const primAvgHr    = primary.activity.avg_hr;
  const primPoints   = primary.trackPoints.length;

  const mismatches: string[] = [];

  if (primDistance != null && secDistance != null) {
    const diff = pctDiff(primDistance, secDistance);
    if (diff > DISCREPANCY_THRESHOLD_PCT) {
      mismatches.push(`distance ${primDistance.toFixed(1)}m vs ${secDistance.toFixed(1)}m (${diff.toFixed(1)}% diff)`);
    }
  }

  if (primAvgHr != null && secAvgHr != null) {
    const diff = pctDiff(primAvgHr, secAvgHr);
    if (diff > DISCREPANCY_THRESHOLD_PCT) {
      mismatches.push(`avg HR ${primAvgHr} vs ${secAvgHr} bpm (${diff.toFixed(1)}% diff)`);
    }
  }

  if (secPoints != null) {
    const diff = pctDiff(primPoints, secPoints);
    if (diff > DISCREPANCY_THRESHOLD_PCT) {
      mismatches.push(`track points ${primPoints} vs ${secPoints} (${diff.toFixed(1)}% diff)`);
    }
  }

  if (mismatches.length > 0) {
    console.warn(`  ⚠ cross-check discrepancy in ${filename}: ${mismatches.join("; ")}`);
  }
}
