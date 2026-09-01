import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Area, ComposedChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, chartGrid, chartTick, chartTooltipStyle } from "@/components/ui";
import { speedRampColor, MARGIN_LEFT, MARGIN_RIGHT, AXIS_WIDTH, RIGHT_AXES_WIDTH } from "@/components/activity/shared";
import { PauseFlagShape } from "@/components/activity/PauseFlagShape";
import { computePaceTargetStats, type PaceTargetBand, type PaceTargetGap, type PaceTargetBandModel } from "@/domain/planned-workout";
import { fmtPace } from "@/utils/fmt";
import { distanceUnitLabel, getUnitSystem, kmToMi, paceUnitLabel } from "@/utils/units";

interface BandPoint {
  distanceM: number;
  paceRange: [number, number];
}

function displayDistance(distanceM: number): number {
  const km = distanceM / 1000;
  return getUnitSystem() === "imperial" ? kmToMi(km) : km;
}

function formatDistance(distanceM: number): string {
  return `${displayDistance(distanceM).toFixed(1)} ${distanceUnitLabel()}`;
}

function formatPaceRange(value: unknown): string {
  if (!Array.isArray(value) || value.length < 2) return "";
  const lower = Number(value[0]);
  const upper = Number(value[1]);
  return `${fmtPace(lower / 60)}–${fmtPace(upper / 60)} ${paceUnitLabel()}`;
}

function paceRampPosition(pace: number, slowest: number, mean: number, fastest: number): number {
  if (slowest === fastest) return 0.5;
  if (pace >= mean) return slowest === mean ? 0.5 : 0.5 * ((slowest - pace) / (slowest - mean));
  return fastest === mean ? 0.5 : 0.5 + 0.5 * ((mean - pace) / (mean - fastest));
}

function bandPoints(band: PaceTargetBand): BandPoint[] {
  return [
    { distanceM: band.startDistanceM, paceRange: [band.startPaceLowerSecPerKm, band.startPaceUpperSecPerKm] },
    { distanceM: band.endDistanceM, paceRange: [band.endPaceLowerSecPerKm, band.endPaceUpperSecPerKm] },
  ];
}

export function PlannedPaceTargetChart({ model, className = "mt-2.5" }: { model: PaceTargetBandModel; className?: string }) {
  const { t } = useTranslation();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bands = model.pieces.filter((piece): piece is PaceTargetBand => piece.kind === "band");
  if (bands.length === 0) return null;

  const stats = computePaceTargetStats(bands)!;
  const slowest = stats.slowestPaceSecPerKm;
  const fastest = stats.fastestPaceSecPerKm;
  const mean = stats.meanPaceSecPerKm;
  const paceBounds = bands.flatMap(band => [
    band.startPaceLowerSecPerKm, band.startPaceUpperSecPerKm,
    band.endPaceLowerSecPerKm, band.endPaceUpperSecPerKm,
  ]);
  const yMin = Math.min(...paceBounds);
  const yMax = Math.max(...paceBounds);
  const title = t("runplan.targetBands.title", "Planned pace targets");
  const distanceAxis = t(
    "runplan.targetBands.distanceAxis",
    `Planned distance (${distanceUnitLabel()})`,
    { unit: distanceUnitLabel() },
  );
  const paceAxis = t(
    "runplan.targetBands.paceAxis",
    `Pace (${paceUnitLabel()})`,
    { unit: paceUnitLabel() },
  );
  const tooltipName = t("runplan.targetBands.tooltipPace", "Target pace");
  const domainPoints = bands.flatMap(bandPoints);
  // A "stand" rest is real (zero-width) distance — the axis/total must never
  // move to make room for it (distance shown must match the actual planned
  // distance). So the little visual gap is purely a paint-over: a narrow
  // background-colored ReferenceArea erasing the seam between the two
  // touching bands, a couple of it wide either side of the rest's real
  // position, with the pause-flag pill on top of it. Neither the axis domain
  // (fixed at [0, totalDistanceM]) nor any plotted distance value changes.
  const standRestGaps = model.pieces.filter(
    (piece): piece is PaceTargetGap => piece.kind === "gap" && piece.restType === "stand" && piece.restDurationSec != null,
  );
  const gapHalfWidthM = Math.max(model.totalDistanceM * 0.01, 8);
  // Mirrors the real-activity pause flag (PauseFlagShape/`pauseDurationSec`)
  // so a "stand" rest reads the same way here as an actual GPS pause does on
  // the activity chart — same shape, same field name, reused directly.
  const standRestFlags = standRestGaps.map(gap => ({
    distanceM: (gap.startDistanceM + gap.endDistanceM) / 2, flag: 1, pauseDurationSec: gap.restDurationSec,
  }));

  return (
    <div data-testid="planned-pace-target-chart" role="img" aria-label={title} className={className}>
      <ChartCard title={title} subHeader={<span className="hra-text-secondary text-meta">{paceAxis}</span>}>
        <div className="h-52.5">
          <ResponsiveContainer width="100%" height="100%">
            {/* top:16 (not the chart's own default) gives the reused
                pause-flag pill room — see OverlayCharts.tsx's identical
                margin comment for why a smaller top margin clips it.
                left/right: the same fixed reservations the main activity
                chart's own left (speed) and right (HR) axes always keep
                (MetricStandaloneCard mirrors the right one too) — so this
                card's plot area lines up with the main chart's, and matching
                km ticks fall at the same x position on both sides. */}
            <ComposedChart data={domainPoints} margin={{ top: 16, right: MARGIN_RIGHT + RIGHT_AXES_WIDTH, bottom: 28, left: MARGIN_LEFT }}>
              <defs>
                {bands.map((band, index) => {
                  const start = speedRampColor(paceRampPosition(band.startTargetPaceSecPerKm, slowest, mean, fastest));
                  const end = speedRampColor(paceRampPosition(band.endTargetPaceSecPerKm, slowest, mean, fastest));
                  return (
                    <linearGradient key={index} id={`${id}-target-band-${index}`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={start} />
                      <stop offset="100%" stopColor={end} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis
                type="number"
                dataKey="distanceM"
                domain={[0, model.totalDistanceM]}
                tick={chartTick}
                tickLine={false}
                axisLine={false}
                tickFormatter={value => displayDistance(Number(value)).toFixed(1)}
                label={{ value: distanceAxis, position: "insideBottom", offset: -12, fill: "var(--text-secondary)", fontSize: 11 }}
              />
              {/* No inline rotated axis label — "Pace (min/km)" now sits as
                  a horizontal ChartCard subHeader instead, and width matches
                  AXIS_WIDTH (the main chart's own left/speed axis width) so
                  this card's plot area lines up with it. */}
              <YAxis
                type="number"
                reversed
                domain={[yMin, yMax]}
                tick={chartTick}
                tickLine={false}
                axisLine={false}
                width={AXIS_WIDTH}
                tickFormatter={value => fmtPace(Number(value) / 60)}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelFormatter={value => formatDistance(Number(value))}
                formatter={value => [formatPaceRange(value), tooltipName]}
              />
              {bands.map((band, index) => {
                const color = speedRampColor(paceRampPosition(
                  (band.startTargetPaceSecPerKm + band.endTargetPaceSecPerKm) / 2,
                  slowest,
                  mean,
                  fastest,
                ));
                return (
                  <Area
                    key={index}
                    data={bandPoints(band)}
                    type="linear"
                    dataKey="paceRange"
                    name={tooltipName}
                    fill={`url(#${id}-target-band-${index})`}
                    fillOpacity={0.55}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                );
              })}
              {standRestGaps.map((gap, index) => (
                <ReferenceArea
                  key={index}
                  x1={Math.max(0, gap.startDistanceM - gapHalfWidthM)}
                  x2={Math.min(model.totalDistanceM, gap.endDistanceM + gapHalfWidthM)}
                  fill="var(--bg-card)"
                  fillOpacity={1}
                  stroke="none"
                  ifOverflow="visible"
                />
              ))}
              {standRestFlags.length > 0 && (
                <>
                  <YAxis yAxisId="restFlag" domain={[0, 1]} hide width={0} />
                  <Scatter yAxisId="restFlag" data={standRestFlags} dataKey="flag" shape={PauseFlagShape} isAnimationActive={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
