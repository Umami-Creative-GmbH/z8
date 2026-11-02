import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card's status. Colour means status only: `info` is in progress, `success` a target met,
 * `warning` and `critical` a limit close or passed; `neutral` carries no status.
 */
export type KpiTone = "neutral" | "info" | "success" | "warning" | "critical";

const CHIP_TONE: Record<KpiTone, string> = {
	neutral: "bg-muted text-muted-foreground",
	info: "bg-primary/10 text-primary",
	success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	critical: "bg-destructive/10 text-destructive",
};

const BAR_TONE: Record<KpiTone, string> = {
	neutral: "bg-muted-foreground",
	info: "bg-primary",
	success: "bg-emerald-500",
	warning: "bg-amber-500",
	critical: "bg-destructive",
};

export interface KpiTrend {
	direction: "up" | "down" | "flat";
	label: string;
	/** More detail, e.g. both periods' figures, as the trend's accessible description. */
	detail?: string;
}

export interface KpiProgress {
	value: number;
	max: number;
	/** Where the value should be by now, drawn as a tick on the bar. */
	marker?: number;
	/** The bar's accessible name. */
	label: string;
}

interface KpiCardProps {
	label: string;
	icon?: ReactNode;
	value: ReactNode;
	tone?: KpiTone;
	trend?: KpiTrend;
	progress?: KpiProgress;
	/** One line under the value or bar, e.g. "26h of 40h · 2h ahead". */
	caption?: ReactNode;
	/** Small print at the bottom, e.g. a surcharge or an update interval. */
	footnote?: ReactNode;
	/** A sparkline beside the value; hidden on narrow layouts. */
	chart?: ReactNode;
	action?: ReactNode;
	className?: string;
}

function percentOf(value: number, max: number) {
	return Math.min(100, Math.max(0, (value / max) * 100));
}

function TrendLine({ trend }: { trend: KpiTrend }) {
	const Arrow =
		trend.direction === "up"
			? IconArrowUpRight
			: trend.direction === "down"
				? IconArrowDownRight
				: IconMinus;
	return (
		<p className="flex items-center gap-1 text-muted-foreground text-xs" title={trend.detail}>
			<Arrow aria-hidden className="size-3.5 shrink-0" />
			<span className="tabular-nums">{trend.label}</span>
			{trend.detail ? <span className="sr-only">{trend.detail}</span> : null}
		</p>
	);
}

function ProgressBar({ progress, tone }: { progress: KpiProgress; tone: KpiTone }) {
	return (
		<div
			role="progressbar"
			aria-label={progress.label}
			aria-valuemin={0}
			aria-valuemax={progress.max}
			aria-valuenow={progress.value}
			className="relative h-1.5 w-full rounded-full bg-muted"
		>
			<div
				className={cn("h-full rounded-full transition-[width]", BAR_TONE[tone])}
				style={{ width: `${percentOf(progress.value, progress.max)}%` }}
			/>
			{progress.marker !== undefined ? (
				<div
					aria-hidden
					className="-top-1 absolute h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
					style={{ left: `${percentOf(progress.marker, progress.max)}%` }}
				/>
			) : null}
		</div>
	);
}

/** One key figure with optional trend, progress toward a target and sparkline. */
export function KpiCard({
	label,
	icon,
	value,
	tone = "neutral",
	trend,
	progress,
	caption,
	footnote,
	chart,
	action,
	className,
}: KpiCardProps) {
	return (
		<Card data-slot="kpi-card" data-tone={tone} className={cn("gap-3 px-5 py-4", className)}>
			<div className="flex items-center gap-2.5">
				{icon ? (
					<span
						aria-hidden
						className={cn(
							"flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
							CHIP_TONE[tone],
						)}
					>
						{icon}
					</span>
				) : null}
				<h3 className="font-medium text-muted-foreground text-sm">{label}</h3>
			</div>
			<div className="flex items-end justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<p className="font-semibold text-2xl tabular-nums leading-none tracking-tight">{value}</p>
					{trend ? <TrendLine trend={trend} /> : null}
				</div>
				{chart ? <div className="hidden h-10 w-28 shrink-0 @xl/main:block">{chart}</div> : null}
			</div>
			{progress || caption ? (
				<div className="space-y-1.5">
					{progress ? <ProgressBar progress={progress} tone={tone} /> : null}
					{caption ? <p className="text-muted-foreground text-xs tabular-nums">{caption}</p> : null}
				</div>
			) : null}
			{footnote || action ? (
				<div className="mt-auto flex items-center justify-between gap-2">
					{footnote ? <p className="text-muted-foreground text-xs">{footnote}</p> : <span />}
					{action}
				</div>
			) : null}
		</Card>
	);
}
