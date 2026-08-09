// ── Ollama workout classifier ─────────────────────────────────────────────
// Calls a local Ollama instance (see config.json's "ollama" block) to
// classify a run against six hardcoded rules. Plain `fetch`, no new runtime
// dependency — Ollama's HTTP API is unauthenticated on localhost, same
// external-API-via-fetch pattern as sync-strava.ts/sync-withings.ts.
//
// Never called from sync-garmin.ts/sync-strava.ts — classification is
// strictly on-demand (server.ts's /classify routes), so Ollama being slow or
// down can never block or slow down a sync.

import { loadConfig } from "../config.ts";
import type { WorkoutSummary } from "../domain/workout-metrics.ts";

// The six canonical labels — also duplicated in garmin-dashboard's
// types/api.ts (no shared package between the two npm projects in this
// repo, same as every other cross-cutting enum/constant here, e.g.
// SPORT_COLOR's keys). Keep both lists in sync if these ever change.
export const WORKOUT_CLASSIFICATIONS = [
  "Recovery Run",
  "Long Session",
  "Repeats/Intervals",
  "Progressive Run",
  "Fartlek",
  "Tapasciata / Light Maintenance",
] as const;
export type WorkoutClassification = typeof WORKOUT_CLASSIFICATIONS[number];

export interface ClassificationResult {
  classification: WorkoutClassification;
  explanation: string;
}

function fmtPace(minKm: number | null): string {
  if (minKm == null || !Number.isFinite(minKm)) return "n/a";
  const m = Math.floor(minKm);
  const s = Math.round((minKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// System prompt hardcodes the classification rules verbatim, then
// interpolates the pre-reduced summary (never the raw per-second array —
// that's the whole point of workout-metrics.ts).
function buildPrompt(summary: WorkoutSummary): string {
  const distanceKm = summary.distanceM != null ? (summary.distanceM / 1000).toFixed(2) : "n/a";
  const durationMin = summary.durationSec != null ? (summary.durationSec / 60).toFixed(1) : "n/a";
  const splitsText = summary.splits.length
    ? summary.splits.map(s =>
        `  Split ${s.index + 1} (${(s.distanceM / 1000).toFixed(2)}km): ${fmtPace(s.avgPaceMinKm)}, ${s.avgHr != null ? `${s.avgHr}bpm` : "no HR"}`
      ).join("\n")
    : "  (not enough distance data for splits)";

  return `You are a running-workout classifier. Classify the run described below into EXACTLY ONE of these six categories, using these rules:

- Recovery Run: Short-to-moderate distance, stable easy/low pace, low heart rate (Zone 1/2).
- Long Session: High distance/duration, low pace variance, baseline endurance heart rate.
- Repeats/Intervals: Rhythmic, repeating sawtooth pace/HR fluctuations between extreme highs and recovery lows.
- Progressive Run: Descending staircase pattern (each sequential 1-km split is systematically faster than the last).
- Fartlek: High overall pace variance with highly irregular, unstructured speed spikes and varying recovery lengths.
- Tapasciata / Light Maintenance: Casual slow overall pace, containing multiple distinct "Zero-Pace Events" (pauses/stops).

Workout data:
- Sport: ${summary.sport ?? "unknown"}
- Distance: ${distanceKm} km
- Duration: ${durationMin} min
- Average heart rate: ${summary.avgHr != null ? `${summary.avgHr} bpm` : "n/a"}
- Pace standard deviation: ${summary.paceStdDevMinKm != null ? `${summary.paceStdDevMinKm.toFixed(2)} min/km` : "n/a"}
- Zero-Pace Events (stops > 5s): ${summary.zeroPaceEvents}
- Per-split breakdown (pace, heart rate):
${splitsText}

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"classification": "<one of: Recovery Run, Long Session, Repeats/Intervals, Progressive Run, Fartlek, Tapasciata / Light Maintenance>", "explanation": "<1-2 sentence explanation citing the specific numbers above>"}`;
}

interface OllamaGenerateResponse {
  response: string;
  [key: string]: unknown;
}

export async function classifyWorkout(summary: WorkoutSummary): Promise<ClassificationResult> {
  const config = loadConfig();
  const prompt = buildPrompt(summary);

  let res: Response;
  try {
    res = await fetch(`${config.ollama.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // format: "json" is a real Ollama /api/generate parameter that
      // constrains the model's output to valid JSON — avoids fragile
      // free-text parsing regardless of which model is configured.
      body: JSON.stringify({ model: config.ollama.model, prompt, format: "json", stream: false }),
    });
  } catch (e) {
    throw new Error(`Ollama not reachable at ${config.ollama.host} — is it running? (${e instanceof Error ? e.message : String(e)})`);
  }

  if (!res.ok) {
    throw new Error(`Ollama API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json() as OllamaGenerateResponse;
  let parsed: { classification?: unknown; explanation?: unknown };
  try {
    parsed = JSON.parse(data.response);
  } catch {
    throw new Error(`Ollama returned non-JSON output: ${data.response.slice(0, 200)}`);
  }

  // Validated against the known enum rather than trusted verbatim — a model
  // drifting from the requested format (wrong label, extra whitespace,
  // synonym) must surface as an error, not silently persist a bogus
  // classification value nothing else in the app recognizes.
  const classification = parsed.classification;
  if (typeof classification !== "string" || !(WORKOUT_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    throw new Error(`Ollama returned an unrecognized classification: ${JSON.stringify(classification)}`);
  }

  return {
    classification: classification as WorkoutClassification,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
  };
}
