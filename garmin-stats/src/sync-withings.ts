/**
 * sync-withings.ts
 * Fetches body measurements from the Withings API and saves them to SQLite.
 * Usage: npm run sync:withings [-- --from 2023-01-01] [-- --to 2023-06-01] [-- --verbose]
 */

import { loadConfig, getArg, hasFlag } from "./config.ts";
import { openDb, initSchema, bodyMeasurementParams } from "./db.ts";
import { getValidToken } from "./withings-auth.ts";
import type { BodyMeasurementRow } from "./db.ts";

const config  = loadConfig();
const VERBOSE = hasFlag("--verbose") || hasFlag("-v");
const FROM    = getArg("--from");
const TO      = getArg("--to");

const MEAS_URL  = "https://wbsapi.withings.net/measure";

// Withings measure-type codes (verified against the official type table —
// there is no direct "BMI" type; it has to be computed from weight/height).
// Previously: bmi used type 5, which is actually Fat Free Mass, and
// heart_rate used type 9, which is Diastolic Blood Pressure — both wrong.
const MEAS_TYPE = {
  weight: 1, fat_ratio: 6, fat_mass: 8, muscle_mass: 76,
  hydration: 77, bone_mass: 88, heart_rate: 11,
} as const;
const HEIGHT_TYPE = 4; // meters — fetched separately, see fetchHeightHistory()

interface MeasGroup {
  date: number; attrib: number;
  measures: Array<{ value: number; type: number; unit: number }>;
}

async function fetchMeasurements(accessToken: string, startTs: number, endTs: number): Promise<MeasGroup[]> {
  const all: MeasGroup[] = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      action: "getmeas", meastypes: Object.values(MEAS_TYPE).join(","),
      category: "1", startdate: String(startTs),
      enddate: String(endTs),
      offset: String(offset), limit: "200",
    });
    const res  = await fetch(`${MEAS_URL}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json() as { status: number; body: { measuregrps: MeasGroup[]; more: number; offset: number } };
    if (json.status !== 0) throw new Error(`Withings API error (status ${json.status})`);
    all.push(...(json.body.measuregrps ?? []));
    if (!json.body.more) break;
    offset = json.body.offset;
  }
  return all;
}

interface HeightPoint { date: number; heightM: number; }

// Height rarely appears bundled with a routine weigh-in — it's usually set
// once in the Health Mate app — so it's fetched as its own all-time query
// rather than folded into the ranged fetchMeasurements() call.
async function fetchHeightHistory(accessToken: string): Promise<HeightPoint[]> {
  const params = new URLSearchParams({
    action: "getmeas", meastypes: String(HEIGHT_TYPE),
    category: "1", startdate: "0", enddate: String(Math.floor(Date.now() / 1000)),
    offset: "0", limit: "200",
  });
  const res  = await fetch(`${MEAS_URL}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json() as { status: number; body: { measuregrps: MeasGroup[] } };
  if (json.status !== 0) throw new Error(`Withings API error fetching height (status ${json.status})`);
  return (json.body.measuregrps ?? [])
    .map((g): HeightPoint | null => {
      const m = g.measures.find(x => x.type === HEIGHT_TYPE);
      return m ? { date: g.date, heightM: m.value * Math.pow(10, m.unit) } : null;
    })
    .filter((h): h is HeightPoint => h !== null)
    .sort((a, b) => a.date - b.date);
}

// Most recent height on record at or before `ts` (falls back to the
// earliest known height if `ts` predates all of them — height is
// essentially constant for an adult, so this is a reasonable default).
function heightAt(history: HeightPoint[], ts: number): number | null {
  if (history.length === 0) return null;
  let best = history[0].heightM;
  for (const h of history) {
    if (h.date > ts) break;
    best = h.heightM;
  }
  return best;
}

function decodeGroup(grp: MeasGroup, heightM: number | null): BodyMeasurementRow | null {
  if (grp.attrib > 2) return null;
  const get = (type: number): number | null => {
    const m = grp.measures.find(m => m.type === type);
    return m ? m.value * Math.pow(10, m.unit) : null;
  };
  const weight = get(MEAS_TYPE.weight);
  if (!weight) return null;
  const measAt = new Date(grp.date * 1000).toISOString().replace("Z", "");
  return {
    measured_at:    measAt,
    date_only:      measAt.slice(0, 10),
    weight_kg:      weight,
    fat_ratio:      get(MEAS_TYPE.fat_ratio),
    fat_mass_kg:    get(MEAS_TYPE.fat_mass),
    muscle_mass_kg: get(MEAS_TYPE.muscle_mass),
    hydration_kg:   get(MEAS_TYPE.hydration),
    bone_mass_kg:   get(MEAS_TYPE.bone_mass),
    bmi:            heightM ? Math.round((weight / (heightM * heightM)) * 10) / 10 : null,
    heart_rate:     get(MEAS_TYPE.heart_rate),
  };
}

async function main(): Promise<void> {
  console.log("=== Garmin Stats — Sync Withings ===\n");
  const db = openDb();
  initSchema(db);
  const accessToken = await getValidToken(config, db);

  const heightHistory = await fetchHeightHistory(accessToken);
  if (heightHistory.length === 0) {
    console.log("No height on record with Withings — BMI will be left null until you add your height in the Health Mate app.");
  } else {
    console.log(`Using height ${heightHistory[heightHistory.length - 1].heightM.toFixed(2)} m for BMI`);
  }

  const last = db.prepare("SELECT MAX(measured_at) AS last FROM body_measurements").get() as { last: string | null };
  const startTs = FROM ? Math.floor(new Date(FROM).getTime() / 1000)
    : last?.last ? Math.floor(new Date(last.last).getTime() / 1000) - 86400
    : Math.floor(Date.now() / 1000) - 2 * 365 * 86400;
  const endTs = TO ? Math.floor(new Date(TO).getTime() / 1000) + 86400 - 1 // inclusive of the whole end day
    : Math.floor(Date.now() / 1000);

  console.log(`Fetching from ${new Date(startTs * 1000).toISOString().slice(0, 10)} to ${new Date(endTs * 1000).toISOString().slice(0, 10)}…`);
  const groups = await fetchMeasurements(accessToken, startTs, endTs);
  console.log(`  Total groups: ${groups.length}`);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO body_measurements
      (measured_at, date_only, weight_kg, fat_ratio, fat_mass_kg,
       muscle_mass_kg, hydration_kg, bone_mass_kg, bmi, heart_rate)
    VALUES
      ($measured_at, $date_only, $weight_kg, $fat_ratio, $fat_mass_kg,
       $muscle_mass_kg, $hydration_kg, $bone_mass_kg, $bmi, $heart_rate)
  `);

  let imported = 0, skipped = 0;
  db.exec("BEGIN");
  try {
    for (const grp of groups) {
      const row = decodeGroup(grp, heightAt(heightHistory, grp.date));
      if (!row) { skipped++; continue; }
      const info = stmt.run(bodyMeasurementParams(row));
      if (info.changes > 0) {
        imported++;
        if (VERBOSE) console.log(`  ✓  ${row.date_only}  ${row.weight_kg?.toFixed(1)} kg`);
      } else skipped++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  console.log(`\nResults:\n  Imported : ${imported}\n  Skipped  : ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
