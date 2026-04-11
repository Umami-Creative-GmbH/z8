import { Badge } from "@/components/ui/badge";
import type { ComplianceRiskSummary } from "@/lib/compliance-command-center/types";

export function RiskSummaryHeader({ summary }: { summary: ComplianceRiskSummary }) {
	return (
		<section className="rounded-xl border bg-card p-5">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<p className="text-sm text-muted-foreground">Compliance overview</p>
					<h1 className="text-2xl font-semibold text-balance break-words">{summary.headline}</h1>
				</div>
				<Badge variant={summary.status === "critical" ? "destructive" : "secondary"}>
					{summary.status}
				</Badge>
			</div>
		</section>
	);
}
