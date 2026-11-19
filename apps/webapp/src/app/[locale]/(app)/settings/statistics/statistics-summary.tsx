import { parseInstant } from "@/lib/datetime/temporal-core";
import { cn } from "@/lib/utils";

export interface StatisticsMetric {
	key: string;
	label: string;
	value: number;
	/** A unit written beside the value, when the label does not already name it. */
	unit?: string;
	/** Supporting detail under the value: a split, a pending count, a change. */
	detail?: string;
}

/** Columns per metric count, so the shared surface never shows an empty cell. */
const STRIP_COLUMNS: Record<number, string> = {
	1: "sm:max-w-sm",
	2: "sm:grid-cols-2",
	3: "sm:grid-cols-3",
	4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * One statistics section: a heading and its metrics as one summary strip, a
 * shared surface divided per metric, values aligned with their units.
 */
export function StatisticsSection({
	id,
	title,
	metrics,
	locale,
}: {
	id: string;
	title: string;
	metrics: StatisticsMetric[];
	locale: string;
}) {
	const numberFormat = new Intl.NumberFormat(locale);
	const headingId = `statistics-${id}`;

	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<h2 id={headingId} className="font-medium text-lg">
				{title}
			</h2>
			<dl
				className={cn(
					"grid gap-px overflow-hidden rounded-lg border bg-border",
					STRIP_COLUMNS[metrics.length] ?? STRIP_COLUMNS[4],
				)}
			>
				{metrics.map((metric) => (
					<div key={metric.key} className="min-w-0 space-y-1 bg-card p-4">
						<dt className="text-muted-foreground text-sm">{metric.label}</dt>
						<dd className="flex flex-wrap items-baseline gap-x-1.5">
							<span className="font-semibold text-2xl tracking-tight tabular-nums">
								{numberFormat.format(metric.value)}
							</span>
							{metric.unit ? (
								<span className="text-muted-foreground text-sm">{metric.unit}</span>
							) : null}
						</dd>
						{metric.detail ? (
							<dd className="text-muted-foreground text-xs tabular-nums">{metric.detail}</dd>
						) : null}
					</div>
				))}
			</dl>
		</section>
	);
}

/** A change between two counts, signed except at zero, in the reader's locale. */
export function formatSignedCount(value: number, locale: string) {
	return new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(value);
}

/**
 * When the statistics were read: the instant in the organization's time zone,
 * with the zone named, in the reader's locale.
 */
export function formatStatisticsFetchedAt(fetchedAt: string, locale: string, timeZone: string) {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
		timeZoneName: "short",
	};
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat(locale, options);
	} catch {
		formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	}
	return formatter.format(parseInstant(fetchedAt).epochMilliseconds);
}
