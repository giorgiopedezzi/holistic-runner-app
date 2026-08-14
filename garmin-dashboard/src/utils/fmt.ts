import { getUnitSystem, kmToMi, mToFt, kgToLb, paceKmToMi, kmhToMph } from "./units";

// Pace is passed in as minutes-per-km (this app's internal/backend unit,
// regardless of display system) and converted to minutes-per-mile here when
// imperial is selected — callers append their own unit suffix via
// paceUnitLabel() (utils/units.ts), fmtPace never does (kept from before the
// unit toggle existed, to avoid touching every call site's signature).
export function fmtPace(minKm: number | null | undefined): string {
  if (!minKm || minKm > 30) return "—";
  const val = getUnitSystem() === "imperial" ? paceKmToMi(minKm) : minKm;
  const m = Math.floor(val);
  const s = Math.round((val - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  // Round the total first, then derive h/m/s from the rounded integer —
  // rounding each part separately can carry a 59.6s remainder up to "60"
  // instead of rolling over into the next minute.
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtKm(meters: number | null | undefined): string {
  if (!meters) return "—";
  if (getUnitSystem() === "imperial") {
    const miles = kmToMi(meters / 1000);
    return miles >= 0.1
      ? `${miles.toFixed(2)} mi`
      : `${Math.round(mToFt(meters))} ft`;
  }
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

export function fmtWeight(kg: number | null | undefined): string {
  if (kg == null) return "—";
  return getUnitSystem() === "imperial" ? `${kgToLb(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

// Elevation (ascent/descent/altitude) — always whole-number, no decimals,
// same convention this app already used for meters before the unit toggle.
export function fmtElevation(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return getUnitSystem() === "imperial" ? `${Math.round(mToFt(meters))} ft` : `${Math.round(meters)} m`;
}

// Speed, from m/s (this app's internal unit) — km/h or mph.
export function fmtSpeed(metersPerSec: number | null | undefined): string {
  if (metersPerSec == null) return "—";
  const kmh = metersPerSec * 3.6;
  return getUnitSystem() === "imperial" ? `${kmhToMph(kmh).toFixed(1)}` : `${kmh.toFixed(1)}`;
}

export function fmtPercent(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)}%` : "—";
}

export function fmtBpm(v: number | null | undefined): string {
  return v != null ? `${Math.round(v)} bpm` : "—";
}

// Formats an already-unit-scaled minutes value as m:ss. Unlike fmtPace, this
// does NOT convert units — callers pass a value already in its final display
// unit (OverviewTab pre-scales pace to min/mi before calling this; SettingsTab's
// min/km preview stays metric-only regardless of the app's unit system). See
// docs/frontend.md's double-conversion note. Single home for what were two
// identical local copies (HRA-68 dedup).
export function fmtMinSecRaw(value: number): string {
  const m = Math.floor(value);
  const s = Math.round((value - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
