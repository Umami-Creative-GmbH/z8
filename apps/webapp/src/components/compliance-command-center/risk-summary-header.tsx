import { Badge } from "@/components/ui/badge";
import type { ComplianceRiskSummary } from "@/lib/compliance-command-center/types";
import { COMPLIANCE_STATUS_I18N, renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function RiskSummaryHeader({
	summary,
	t,
}: {
	summary: ComplianceRiskSummary;
	t: Translate;
}) {
	return (
		<section className="rounded-xl border bg-card p-5">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<p className="text-sm text-muted-foreground">
						{t("compliance.commandCenter.overview", "Compliance overview")}
					</p>
					<h1 className="text-2xl font-semibold text-balance break-words">
						{renderComplianceText(t, summary.headline)}
					</h1>
				</div>
				<Badge variant={summary.status === "critical" ? "destructive" : "secondary"}>
					{renderComplianceText(t, COMPLIANCE_STATUS_I18N[summary.status])}
				</Badge>
			</div>
		</section>
	);
}
