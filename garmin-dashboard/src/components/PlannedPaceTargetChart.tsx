import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, chartGrid, chartTick, chartTooltipStyle } from "@/components/ui";
import { speedRampColor } from "@/components/activity/shared";
import { computePaceTargetStats, type PaceTargetBand, type PaceTargetBandModel } from "@/domain/planned-workout";
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

export function PlannedPaceTargetChart({ model }: { model: PaceTargetBandModel }) {
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

  return (
    <div data-testid="planned-pace-target-chart" role="img" aria-label={title} style={{ marginTop: 10 }}>
      <ChartCard title={title}>
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={domainPoints} margin={{ top: 8, right: 12, bottom: 28, left: 12 }}>
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
              <YAxis
                type="number"
                reversed
                domain={[yMin, yMax]}
                tick={chartTick}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={value => fmtPace(Number(value) / 60)}
                label={{ value: paceAxis, angle: -90, position: "insideLeft", fill: "var(--text-secondary)", fontSize: 11 }}
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
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
