// ── FIT binary parser ─────────────────────────────────────────────────────
// Decodes Garmin .FIT files into typed activity + track-point records.
//
// Key fixes vs original:
//  1. Base type mask corrected to 0x1f (was 0x9f — caused all uint32/sint32/float32
//     fields to be read as uint8, corrupting distance, speed, duration etc.)
//  2. sport field corrected to field 5 (was 2)
//  3. avg/max speed fall back to enhanced_avg/max_speed (fields 124/125)
//     when the legacy uint16 fields contain the invalid sentinel 0xFFFF
//  4. enhanced_speed in records is field 73 (was 82)
//  5. Running cadence uses avg_running_cadence (field 89, strides/min × 2)
//     when avg_cadence (field 56) is absent
//  6. activity date derived from start_time (field 2) not time_created in file_id
//  7. Developer field definitions are skipped correctly (hasDev flag)
//  8. total_ascent/total_descent are session fields 22/23 (was 24/25 — off
//     by the same kind of field-number mismap as cadence's 56/89; confirmed
//     against a real file's raw field dump: field 22=31, field 23=24 matched
//     the activity's known-correct ascent/descent, while the old 24/25 gave
//     36/0)
//  9. Developer field *payload* bytes (in the DATA message, after the fixed
//     fields) are now skipped too, not just the field definitions above —
//     the old code recorded that dev fields exist but never accounted for
//     their byte length when reading the matching data message, which
//     desynced every message after the first one with dev fields for the
//     rest of the file. Confirmed on real archived files: any activity with
//     a developer field on its session message (common on Forerunner 965
//     files — running-dynamics extensions) parsed with 0 track points
//     despite reporting a normal-looking activity summary, because the
//     desync started before any record (gNum 20) message was ever reached.

export interface FitActivity {
  filename: string;
  activity_date: string;   // ISO 8601
  date_only: string;       // YYYY-MM-DD
  sport: string;
  duration_sec: number | null;
  moving_time_sec: number | null; // total_timer_time — excludes auto-paused stretches
  distance_m: number | null;
  avg_pace_minkm: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  avg_speed_ms: number | null;
  max_speed_ms: number | null;
}

export interface FitTrackPoint {
  elapsed_sec: number | null;
  // Real wall-clock time (Unix seconds) — unlike elapsed_sec (which tracks
  // moving/timer time and freezes during an auto-pause), this always
  // advances, so a gap here that elapsed_sec doesn't show is exactly where
  // a pause happened and how long it was.
  timestamp_unix: number | null;
  distance_m: number | null;
  heart_rate: number | null;
  speed_ms: number | null;
  cadence: number | null;
  altitude_m: number | null;
  temperature: number | null;
  power: number | null;
  lat: number | null;
  lon: number | null;
}

export interface ParsedFit {
  activity: FitActivity;
  trackPoints: FitTrackPoint[];
}

// FIT timestamp epoch: 1989-12-31T00:00:00Z
const FIT_EPOCH_S = Math.floor(new Date("1989-12-31T00:00:00Z").getTime() / 1000);

// Invalid value sentinels
const INVALID_U32 = 0xFFFFFFFF;
const INVALID_U16 = 0xFFFF;
const INVALID_U8  = 0xFF;

const SPORT_MAP: Record<number, string> = {
  1: "running", 2: "cycling", 3: "transition", 4: "fitness_equipment",
  5: "swimming", 11: "walking", 15: "hiking", 17: "inline_skating",
};

// ── base type descriptors ─────────────────────────────────────────────────
interface BaseType {
  size: number;
  read: (buf: Buffer, pos: number, le: boolean) => number;
}

const BASE_TYPES: Record<number, BaseType> = {
  0:  { size:1, read:(b,p)=>b.readUInt8(p)                                    },
  1:  { size:1, read:(b,p)=>b.readInt8(p)                                     },
  2:  { size:1, read:(b,p)=>b.readUInt8(p)                                    },
  3:  { size:2, read:(b,p,le)=>le?b.readInt16LE(p):b.readInt16BE(p)           },
  4:  { size:2, read:(b,p,le)=>le?b.readUInt16LE(p):b.readUInt16BE(p)         },
  5:  { size:4, read:(b,p,le)=>le?b.readInt32LE(p):b.readInt32BE(p)           },
  6:  { size:4, read:(b,p,le)=>le?b.readUInt32LE(p):b.readUInt32BE(p)         },
  7:  { size:1, read:(b,p)=>b.readUInt8(p)                                    }, // string byte
  8:  { size:4, read:(b,p,le)=>le?b.readFloatLE(p):b.readFloatBE(p)           },
  9:  { size:8, read:(b,p,le)=>le?b.readDoubleLE(p):b.readDoubleBE(p)         },
  10: { size:1, read:(b,p)=>b.readUInt8(p)                                    },
  11: { size:2, read:(b,p,le)=>le?b.readUInt16LE(p):b.readUInt16BE(p)         },
  12: { size:4, read:(b,p,le)=>le?b.readUInt32LE(p):b.readUInt32BE(p)         },
  13: { size:1, read:(b,p)=>b.readUInt8(p)                                    },
};

// ── FIT session message (gNum=18) field map ───────────────────────────────
const SESSION_FIELDS: Record<number, string> = {
  2:  "start_time",             // uint32 — FIT epoch seconds
  5:  "sport",                  // uint8
  7:  "total_elapsed_time",     // uint32 — milliseconds
  8:  "total_timer_time",       // uint32 — milliseconds
  9:  "total_distance",         // uint32 — cm (÷100 → m)
  11: "total_calories",         // uint16 — kcal
  14: "avg_speed",              // uint16 — mm/s (÷1000 → m/s), 0xFFFF = invalid
  15: "max_speed",              // uint16 — mm/s, 0xFFFF = invalid
  16: "avg_heart_rate",         // uint8 — bpm
  17: "max_heart_rate",         // uint8 — bpm
  22: "total_ascent",           // uint16 — metres
  23: "total_descent",          // uint16 — metres
  56: "avg_cadence",            // uint8 — steps/min (cycling) or strides/min (running)
  89: "avg_running_cadence",    // uint8 — strides/min (×2 = steps/min)
  124:"enhanced_avg_speed",     // uint32 — mm/s, use when avg_speed = 0xFFFF
  125:"enhanced_max_speed",     // uint32 — mm/s, use when max_speed = 0xFFFF
};

// ── FIT record message (gNum=20) field map ────────────────────────────────
const RECORD_FIELDS: Record<number, string> = {
  0:  "position_lat",           // sint32 — semicircles (÷11930465 → °)
  1:  "position_long",          // sint32 — semicircles
  2:  "altitude",               // uint16 — (÷5)−500 → metres
  3:  "heart_rate",             // uint8 — bpm
  4:  "cadence",                // uint8 — rpm/strides per min
  5:  "distance",               // uint32 — cm (÷100 → m)
  6:  "speed",                  // uint16 — mm/s
  7:  "power",                  // uint16 — watts
  13: "temperature",            // sint8 — °C
  29: "elapsed_time",           // uint32 — ms
  73: "enhanced_speed",         // uint32 — mm/s (÷1000 → m/s)
  78: "enhanced_altitude",      // uint32 — (÷5)−500 → metres
  253:"timestamp",              // uint32 — FIT epoch seconds, real wall-clock time
};

interface FieldDef { num: number; size: number; btc: number; }
interface MsgDef   { gNum: number; fields: FieldDef[]; le: boolean; devFieldsTotalSize: number; }
type RawRecord     = Record<string, number | string>;

function parseFitBuffer(buf: Buffer): RawRecord[] {
  const headerLen = buf[0];
  if (headerLen < 12) throw new Error("Invalid FIT header");

  let pos = headerLen;
  const end = buf.length - 2;
  const defs: Record<number, MsgDef> = {};
  const records: RawRecord[] = [];

  while (pos < end) {
    const header = buf[pos];

    // compressed timestamp record — skip (we use elapsed_time from data)
    if (header & 0x80) { pos++; continue; }

    const isDef  = !!(header & 0x40);
    const hasDev = !!(header & 0x20);  // developer data flag
    const local  = header & 0x0f;

    if (isDef) {
      pos++;           // header byte
      pos++;           // reserved byte
      const arch  = buf[pos++];
      const le    = arch === 0;
      const gNum  = le ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos);
      pos += 2;
      const nf    = buf[pos++];
      const fields: FieldDef[] = [];

      for (let f = 0; f < nf; f++) {
        const num   = buf[pos++];
        const fSize = buf[pos++];
        // ── CRITICAL FIX ──────────────────────────────────────────────────
        // Base type byte: bit7=endian_ability, bits6-5=reserved, bits4-0=type_num
        // Correct mask is 0x1f (keep only bottom 5 bits).
        // Old code used 0x9f which kept bit7, so 0x86 (uint32) → 134 (unknown)
        // instead of 134 & 0x1f = 6 (uint32). This broke all 4-byte fields.
        const btc   = buf[pos++] & 0x1f;
        fields.push({ num, size: fSize, btc });
      }

      // Developer field definitions: 3 bytes each (field_num, size, dev_data_index).
      // ── CRITICAL FIX ──────────────────────────────────────────────────
      // The DATA message for this local type carries the developer fields'
      // actual payload appended after the fixed fields — those bytes must
      // be skipped when reading data messages below, or every message
      // after the first one with dev fields desyncs the rest of the file.
      // (Confirmed on a real archived file: a single unaccounted 14-byte
      // dev-field payload on a session message turned every subsequent
      // message — including every record — into garbage, leaving the
      // activity with 0 track points despite parsing "successfully.")
      // We don't decode developer field values (that needs the separate
      // field_description messages, out of scope here) — just their total
      // byte length, to stay aligned for every following message.
      let devFieldsTotalSize = 0;
      if (hasDev) {
        const nDevFields = buf[pos++];
        for (let f = 0; f < nDevFields; f++) {
          pos++;                             // field_num
          devFieldsTotalSize += buf[pos++];  // size
          pos++;                             // developer_data_index
        }
      }

      defs[local] = { gNum, fields, le, devFieldsTotalSize };

    } else {
      pos++; // header byte
      const def = defs[local];
      if (!def) { pos++; continue; }

      const row: RawRecord = { _g: def.gNum };

      for (const f of def.fields) {
        const bt = BASE_TYPES[f.btc] ?? BASE_TYPES[2];
        let val: number | string | null = null;

        if (f.btc === 7) {
          // string: read all bytes
          val = buf.slice(pos, pos + f.size).toString("latin1").replace(/\0/g, "");
        } else if (bt.size <= f.size && pos + f.size <= buf.length) {
          try { val = bt.read(buf, pos, def.le); } catch { /* skip bad read */ }
        }
        pos += f.size;

        if (val === null) continue;

        if (def.gNum === 18 && SESSION_FIELDS[f.num]) row[SESSION_FIELDS[f.num]] = val;
        if (def.gNum === 20 && RECORD_FIELDS[f.num])  row[RECORD_FIELDS[f.num]]  = val;
      }

      // Skip the developer field payload appended after the fixed fields —
      // see the matching comment in the definition-message branch above.
      pos += def.devFieldsTotalSize;

      if (def.gNum === 18 || def.gNum === 20) records.push(row);
    }
  }

  return records;
}

function resolveDate(session: RawRecord, filename: string): string {
  // Prefer start_time from session (field 2) — most accurate
  const st = session.start_time;
  if (typeof st === "number" && st > 0 && st !== INVALID_U32) {
    return new Date((st + FIT_EPOCH_S) * 1000).toISOString().replace("Z", "");
  }
  // Fallback: parse filename like "2024-08-01-07-30-00.fit"
  const m = filename.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  return new Date().toISOString().replace("Z", "");
}

function validNum(v: number | string | undefined, invalid: number): number | null {
  return typeof v === "number" && v !== invalid ? v : null;
}

export function parseFit(buf: Buffer, filename: string): ParsedFit {
  const raw     = parseFitBuffer(buf);
  const session = raw.find(r => r._g === 18) ?? {};
  const pts     = raw.filter(r => r._g === 20);

  const actDate  = resolveDate(session, filename);
  const dateOnly = actDate.slice(0, 10);

  const sportCode = typeof session.sport === "number" ? session.sport : 0;
  const sport     = SPORT_MAP[sportCode] ?? "other";

  // Duration: total_elapsed_time in ms (wall-clock, includes any pauses)
  const durSec = validNum(session.total_elapsed_time as number, INVALID_U32);
  // Moving time: total_timer_time in ms (excludes auto-paused stretches) —
  // the gap between this and total_elapsed_time is the activity's total
  // paused time, straight from Garmin, no heuristics.
  const timerSec = validNum(session.total_timer_time as number, INVALID_U32);

  // Distance: cm → m
  const distRaw = validNum(session.total_distance as number, INVALID_U32);
  const distM   = distRaw != null ? distRaw / 100 : null;

  // Speed: prefer enhanced (uint32, mm/s) over legacy (uint16, mm/s)
  const avgSpdRaw = validNum(session.enhanced_avg_speed as number, INVALID_U32)
                 ?? validNum(session.avg_speed as number, INVALID_U16);
  const maxSpdRaw = validNum(session.enhanced_max_speed as number, INVALID_U32)
                 ?? validNum(session.max_speed as number, INVALID_U16);

  const avgSpd = avgSpdRaw != null ? avgSpdRaw / 1000 : null;
  const maxSpd = maxSpdRaw != null ? maxSpdRaw / 1000 : null;
  const pace   = avgSpd && avgSpd > 0 ? 1000 / avgSpd / 60 : null;

  // Track points
  const trackPoints: FitTrackPoint[] = pts.map(r => {
    // Speed: prefer enhanced_speed (uint32, mm/s ÷ 1000) over speed (uint16, mm/s ÷ 1000)
    const spdRaw = validNum(r.enhanced_speed as number, INVALID_U32)
                ?? validNum(r.speed as number, INVALID_U16);
    const spd = spdRaw != null ? spdRaw / 1000 : null;

    // Altitude: prefer enhanced_altitude (uint32, (÷5)−500) over altitude (uint16, (÷5)−500)
    const altRaw = validNum(r.enhanced_altitude as number, INVALID_U32)
                ?? validNum(r.altitude as number, INVALID_U16);
    const alt = altRaw != null ? altRaw / 5 - 500 : null;

    // Distance: cm → m
    const distRaw = validNum(r.distance as number, INVALID_U32);

    // GPS: semicircles → degrees
    const latRaw = validNum(r.position_lat as number, 0x7FFFFFFF);
    const lonRaw = validNum(r.position_long as number, 0x7FFFFFFF);

    const tsRaw = validNum(r.timestamp as number, INVALID_U32);

    return {
      elapsed_sec: validNum(r.elapsed_time as number, INVALID_U32) != null
        ? (r.elapsed_time as number) / 1000 : null,
      timestamp_unix: tsRaw != null ? tsRaw + FIT_EPOCH_S : null,
      distance_m:  distRaw != null ? distRaw / 100 : null,
      heart_rate:  validNum(r.heart_rate as number, INVALID_U8),
      speed_ms:    spd,
      // Field 4 reports single-leg strides/min for running (same convention
      // as Strava's cadence stream) — × 2 for steps/min so Garmin and Strava
      // runs stay comparable on the same charts (see sync-strava.ts).
      cadence:     (() => {
        const raw = validNum(r.cadence as number, INVALID_U8);
        return raw != null ? (sport === "running" ? raw * 2 : raw) : null;
      })(),
      altitude_m:  alt,
      temperature: typeof r.temperature === "number" ? r.temperature : null,
      power:       validNum(r.power as number, INVALID_U16),
      lat:         latRaw != null ? latRaw / 11_930_465 : null,
      lon:         lonRaw != null ? lonRaw / 11_930_465 : null,
    };
  });

  // Session-level avg_cadence/avg_running_cadence (fields 56/89) proved
  // unreliable on real files (observed e.g. 1684 spm on a run that averaged
  // ~170 per its own per-record cadence stream — the field mapping doesn't
  // hold up the way session field 5/7/8 etc. do). Deriving the average from
  // the already-validated, already-scaled per-record cadence instead.
  const cadenceVals = trackPoints.map(p => p.cadence).filter((v): v is number => v != null);
  const avgCadence = cadenceVals.length > 0
    ? Math.round(cadenceVals.reduce((a, b) => a + b, 0) / cadenceVals.length)
    : null;

  const activity: FitActivity = {
    filename,
    activity_date:  actDate,
    date_only:      dateOnly,
    sport,
    duration_sec:    durSec != null ? durSec / 1000 : null,
    moving_time_sec: timerSec != null ? timerSec / 1000 : null,
    distance_m:     distM,
    avg_pace_minkm: pace,
    calories:       validNum(session.total_calories as number, INVALID_U16),
    avg_hr:         validNum(session.avg_heart_rate as number, INVALID_U8),
    max_hr:         validNum(session.max_heart_rate as number, INVALID_U8),
    avg_cadence:    avgCadence,
    ascent_m:       validNum(session.total_ascent as number, INVALID_U16),
    descent_m:      validNum(session.total_descent as number, INVALID_U16),
    avg_speed_ms:   avgSpd,
    max_speed_ms:   maxSpd,
  };

  return { activity, trackPoints };
}
