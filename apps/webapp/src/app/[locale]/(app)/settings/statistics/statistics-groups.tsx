import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type { StatisticsCard } from "./statistics-cards";

/**
 * One statistics group: a heading and its KPI cards on one shared surface,
 * divided per card, as the working time summary lays out its KPIs.
 */
export function StatisticsGroup({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	const headingId = `statistics-${id}`;
	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<h2 id={headingId} className="font-medium text-lg">
				{title}
			</h2>
			{children}
		</section>
	);
}

const GRID_COLUMNS: Record<number, string> = {
	1: "sm:max-w-sm",
	2: "sm:grid-cols-2",
	3: "sm:grid-cols-3",
	4: "sm:grid-cols-2 xl:grid-cols-4",
};

/** The cards of one group on a shared surface, never leaving an empty cell. */
export function StatisticsCards({ cards }: { cards: StatisticsCard[] }) {
	return (
		<div
			className={cn(
				"grid gap-px overflow-hidden rounded-xl border bg-border",
				"[&>[data-slot=kpi-card]]:rounded-none [&>[data-slot=kpi-card]]:border-0 [&>[data-slot=kpi-card]]:shadow-none",
				GRID_COLUMNS[cards.length] ?? GRID_COLUMNS[4],
			)}
		>
			{cards.map((card) => (
				<KpiCard
					key={card.key}
					label={card.label}
					value={
						card.unit ? (
							<>
								{card.value}
								<span className="ml-1 font-normal text-muted-foreground text-sm">{card.unit}</span>
							</>
						) : (
							card.value
						)
					}
					tone={card.tone}
					trend={card.trend}
					progress={card.progress}
					caption={card.caption}
					action={
						card.link ? (
							<Link
								href={card.link.href}
								className="text-primary text-xs underline-offset-4 hover:underline focus-visible:underline"
							>
								{card.link.label}
							</Link>
						) : undefined
					}
				/>
			))}
		</div>
	);
}

/** Every attention figure is zero: nothing to act on right now. */
export function StatisticsAllClear({ message }: { message: string }) {
	return (
		<p
			role="status"
			className="flex items-center gap-2 rounded-xl border bg-card px-5 py-4 text-muted-foreground text-sm"
		>
			<IconCircleCheck
				aria-hidden
				className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
			/>
			{message}
		</p>
	);
}

/** A whole group could not be read: its figures stay unknown, never zero. */
export function StatisticsGroupError({ message }: { message: string }) {
	return (
		<p
			role="alert"
			className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-card px-5 py-4 text-destructive text-sm"
		>
			<IconAlertCircle aria-hidden className="size-4 shrink-0" />
			{message}
		</p>
	);
}

/** A group's placeholder while its figures load. */
export function StatisticsGroupSkeleton({
	cards,
	heading = "w-36",
}: {
	cards: number;
	heading?: string;
}) {
	return (
		<div className="space-y-3" aria-hidden="true">
			<Skeleton className={cn("h-6", heading)} />
			<div
				className={cn(
					"grid gap-px overflow-hidden rounded-xl border bg-border",
					GRID_COLUMNS[cards] ?? GRID_COLUMNS[4],
				)}
			>
				{Array.from({ length: cards }, (_, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
					<div key={index} className="space-y-3 bg-card px-5 py-4">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-7 w-16" />
						<Skeleton className="h-3 w-40" />
					</div>
				))}
			</div>
		</div>
	);
}
