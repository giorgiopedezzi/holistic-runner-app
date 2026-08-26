import type { EventType, OffsetUnit, PaceValue } from "@/types/runplan";
import type { AnchorRowState } from "./planInstanceEditor.model";

const KM_PER_MILE = 1.60934;

export const STANDARD_DISTANCE_M: Partial<Record<EventType, number>> = {
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
  marathon: 42195,
};

export function goalTimeToSec(h: string, m: string, s: string): number | null {
  const hn = Number(h);
  const mn = Number(m);
  const sn = Number(s);
  if (![hn, mn, sn].every(n => Number.isFinite(n) && n >= 0)) return null;
  return hn * 3600 + mn * 60 + sn;
}

export function pad2(n: string): string {
  return String(Math.max(0, Number(n) || 0)).padStart(2, "0");
}

export function formatGoalTimeDigits(digits: string): string {
  const h = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const s = digits.slice(4, 6);
  if (digits.length <= 2) return h;
  if (digits.length <= 4) return `${h}:${m}`;
  return `${h}:${m}:${s}`;
}

export function sanitizeGoalTimeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function formatGoalTimeFromSec(totalSec: number): string {
  const total = Math.round(totalSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatPaceSecPerKm(sec: number): string {
  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}:${String(s).padStart(2, "0")}/km`;
}

export function parsePaceOverrideInput(raw: string, offsetUnit: OffsetUnit): PaceValue | null {
  const trimmed = raw.trim();
  const abs = /^(\d+):(\d{2})\/(km|mi)$/.exec(trimmed);
  if (abs) {
    const totalSec = parseInt(abs[1], 10) * 60 + parseInt(abs[2], 10);
    return { kind: "absolute", pace_sec_per_km: abs[3] === "km" ? totalSec : totalSec / KM_PER_MILE };
  }

  const off = /^([A-Za-z0-9_]+)([+-])(\d+(?:\.\d+)?)(s\/km|s\/mi)?$/.exec(trimmed);
  if (off) {
    const sign = off[2] === "+" ? 1 : -1;
    const amount = parseFloat(off[3]);
    const unit = (off[4] as OffsetUnit | undefined) ?? offsetUnit;
    const offsetSecPerKm = unit === "s/km" ? sign * amount : (sign * amount) / KM_PER_MILE;
    return { kind: "offset", anchor: off[1], offset_sec_per_km: offsetSecPerKm };
  }

  return null;
}

export function paceValueToAnchorRow(pv: PaceValue): AnchorRowState {
  if (pv.kind === "absolute") {
    return {
      absoluteValue: formatPaceSecPerKm(pv.pace_sec_per_km),
      relativeTo: "",
      sign: "+",
      seconds: "",
    };
  }
  return {
    absoluteValue: "",
    relativeTo: pv.anchor,
    sign: pv.offset_sec_per_km >= 0 ? "+" : "-",
    seconds: String(Math.abs(pv.offset_sec_per_km)),
  };
}
