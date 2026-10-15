import type { ReactNode } from "react";
import { TableHeaderRow } from "@/components/ui/table";

/** A named subject, three numeric metrics, and a final summary column. */
export function MetricsTableHeader({
	name,
	metrics,
	summary,
}: {
	name: ReactNode;
	metrics: readonly [ReactNode, ReactNode, ReactNode];
	summary: ReactNode;
}) {
	return (
		<TableHeaderRow
			columns={[
				{ id: "name", label: name },
				{ id: "metric-1", label: metrics[0], className: "text-right" },
				{ id: "metric-2", label: metrics[1], className: "text-right" },
				{ id: "metric-3", label: metrics[2], className: "text-right" },
				{ id: "summary", label: summary },
			]}
		/>
	);
}
