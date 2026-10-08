import type * as React from "react";

import { cn } from "@/lib/utils";

/** Where a step stands: recorded, happening now, or still to come. */
export type TimelineItemState = "done" | "current" | "upcoming";

function Timeline({ className, ...props }: React.ComponentProps<"ol">) {
	return <ol data-slot="timeline" className={cn("grid", className)} {...props} />;
}

/**
 * One step of a vertical timeline: a marker on the connecting line, the step's
 * title with its time on the right, and an optional description below. The
 * current step is marked in the brand color; upcoming steps stay muted.
 */
function TimelineItem({
	state = "done",
	title,
	time,
	dateTime,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"li">, "title"> & {
	state?: TimelineItemState;
	title: React.ReactNode;
	/** The formatted time; `dateTime` is its machine-readable instant or date. */
	time?: React.ReactNode;
	dateTime?: string;
}) {
	return (
		<li
			data-slot="timeline-item"
			data-state={state}
			aria-current={state === "current" ? "step" : undefined}
			className={cn(
				"group/timeline-item relative grid grid-cols-[0.625rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0",
				className,
			)}
			{...props}
		>
			<span
				aria-hidden="true"
				className="absolute top-5 bottom-1 left-[calc(0.3125rem-0.5px)] w-px bg-border group-last/timeline-item:hidden"
			/>
			<span
				aria-hidden="true"
				className={cn(
					"mt-1.5 size-2.5 rounded-full",
					state === "done" && "bg-muted-foreground/70",
					state === "current" && "bg-primary ring-4 ring-primary/15",
					state === "upcoming" && "bg-muted-foreground/30",
				)}
			/>
			<div className="min-w-0">
				<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
					<p
						className={cn(
							"min-w-0 break-words text-sm",
							state === "upcoming" ? "text-muted-foreground" : "font-medium",
						)}
					>
						{title}
					</p>
					{time && (
						<time
							dateTime={dateTime}
							className="shrink-0 text-xs text-muted-foreground tabular-nums"
						>
							{time}
						</time>
					)}
				</div>
				{children && (
					<div className="mt-1 break-words text-sm text-muted-foreground">{children}</div>
				)}
			</div>
		</li>
	);
}

export { Timeline, TimelineItem };
