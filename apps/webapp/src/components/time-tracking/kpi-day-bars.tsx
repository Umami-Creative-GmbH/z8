import type { TimeKpiDay } from "@/lib/time-tracking/time-kpis";
import { cn } from "@/lib/utils";

const HEIGHT = 40;
const SLOT = 10;
const BAR = 7;
/** Bars never scale to less than an hour, so a short day stays short. */
const MIN_SCALE_MINUTES = 60;

/**
 * One bar per day of a period: its day total, a faint line at its required time, and an empty
 * slot for each day still ahead.
 */
export function KpiDayBars({
	days,
	today,
	describeDay,
}: {
	days: TimeKpiDay[];
	today: string;
	describeDay: (day: TimeKpiDay) => string;
}) {
	const scale = Math.max(
		MIN_SCALE_MINUTES,
		...days.map((day) => Math.max(day.workedMinutes, day.requiredMinutes)),
	);
	const y = (minutes: number) => HEIGHT - (minutes / scale) * HEIGHT;

	return (
		<svg
			viewBox={`0 0 ${days.length * SLOT} ${HEIGHT}`}
			preserveAspectRatio="none"
			className="size-full overflow-visible"
			aria-hidden
		>
			{days.map((day, index) => {
				const x = index * SLOT + (SLOT - BAR) / 2;
				return (
					<g key={day.date}>
						<title>{describeDay(day)}</title>
						{/* A full-height hit area, so every day shows its tooltip. */}
						<rect x={index * SLOT} y={0} width={SLOT} height={HEIGHT} fill="transparent" />
						{day.upcoming ? (
							<rect x={x} y={HEIGHT - 2} width={BAR} height={2} rx={1} className="fill-muted" />
						) : (
							<rect
								x={x}
								y={y(day.workedMinutes)}
								width={BAR}
								height={HEIGHT - y(day.workedMinutes)}
								rx={1.5}
								className={cn(day.date === today ? "fill-primary" : "fill-primary/45")}
							/>
						)}
						{day.requiredMinutes > 0 ? (
							<line
								x1={x - 1}
								x2={x + BAR + 1}
								y1={y(day.requiredMinutes)}
								y2={y(day.requiredMinutes)}
								className="stroke-foreground/35"
								strokeWidth={1}
								vectorEffect="non-scaling-stroke"
							/>
						) : null}
					</g>
				);
			})}
		</svg>
	);
}
