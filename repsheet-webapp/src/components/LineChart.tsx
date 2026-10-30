import { useTranslation } from "react-i18next";
import { formatMonthOfDay } from "@/lib/dates";
import type { Point } from "@/lib/stats";
import { formatNumber } from "@/lib/units";

const W = 320;
const H = 150;
const PAD = { top: 12, right: 14, bottom: 22, left: 36 };

function niceTicks(min: number, max: number): number[] {
	if (min === max) {
		return [min];
	}
	const raw = (max - min) / 3;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step =
		[1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
	const ticks: number[] = [];
	for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
		ticks.push(Math.round(t * 100) / 100);
	}
	return ticks;
}

/** A progression line: one point per performance, last one emphasised. */
export function LineChart({
	points,
	format,
}: {
	points: Point[];
	format: (value: number) => string;
}) {
	const { t } = useTranslation();
	if (points.length === 0) {
		return null;
	}
	const values = points.map((p) => p.value);
	const rawMin = Math.min(...values);
	const rawMax = Math.max(...values);
	const spread = rawMax - rawMin || Math.max(1, rawMax * 0.1);
	const min = rawMin - spread * 0.15;
	const max = rawMax + spread * 0.15;
	const innerW = W - PAD.left - PAD.right;
	const innerH = H - PAD.top - PAD.bottom;
	const x = (i: number) =>
		PAD.left +
		(points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
	const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH;
	const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
	const area = `${x(0)},${PAD.top + innerH} ${line} ${x(points.length - 1)},${PAD.top + innerH}`;
	const last = points[points.length - 1];
	const first = points[0];

	return (
		<svg
			className="chart"
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={t("chart.label")}
		>
			{niceTicks(rawMin, rawMax).map((t) => (
				<g key={t}>
					<line
						x1={PAD.left}
						x2={W - PAD.right}
						y1={y(t)}
						y2={y(t)}
						className="chart-grid"
					/>
					<text
						x={PAD.left - 6}
						y={y(t) + 3}
						textAnchor="end"
						className="chart-label"
					>
						{formatNumber(t)}
					</text>
				</g>
			))}
			<polygon points={area} className="chart-area" />
			<polyline points={line} className="chart-line" />
			{last ? (
				<circle
					cx={x(points.length - 1)}
					cy={y(last.value)}
					r="4.5"
					className="chart-dot"
				/>
			) : null}
			{first ? (
				<text
					x={x(0)}
					y={H - 6}
					textAnchor={points.length === 1 ? "middle" : "start"}
					className="chart-label"
				>
					{formatMonthOfDay(first.date)}
				</text>
			) : null}
			{last && points.length > 1 ? (
				<text
					x={x(points.length - 1)}
					y={H - 6}
					textAnchor="end"
					className="chart-label"
				>
					{formatMonthOfDay(last.date)}
				</text>
			) : null}
			<title>{last ? format(last.value) : ""}</title>
		</svg>
	);
}
