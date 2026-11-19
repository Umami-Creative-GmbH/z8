import type { ReactNode } from "react";

/** One shared surface for an import batch's totals instead of a card around every number. */
export function ImportReviewSummaryStrip({
	items,
}: {
	items: readonly { key: string; label: string; value: ReactNode }[];
}) {
	return (
		<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
			{items.map((item) => (
				<div className="min-w-0 space-y-1 bg-card px-4 py-3" key={item.key}>
					<dt className="truncate text-muted-foreground text-sm" title={item.label}>
						{item.label}
					</dt>
					<dd className="font-semibold text-2xl tabular-nums">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}
