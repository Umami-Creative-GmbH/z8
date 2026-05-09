"use client";

import type { OrgChartGraph } from "./org-chart-types";

type OrgChartClientProps = {
	initialGraph: OrgChartGraph;
};

export function OrgChartClient({ initialGraph }: OrgChartClientProps) {
	return (
		<div className="flex min-h-[680px] items-center justify-center rounded-lg border bg-card text-card-foreground">
			<p className="text-sm text-muted-foreground">
				Org chart loaded with {initialGraph.nodes.length} nodes.
			</p>
		</div>
	);
}
