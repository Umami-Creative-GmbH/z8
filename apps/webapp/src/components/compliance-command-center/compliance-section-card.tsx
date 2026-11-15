import { Badge } from "@/components/ui/badge";
import type { ComplianceSectionCard as ComplianceSectionCardModel } from "@/lib/compliance-command-center/types";
import { Link } from "@/navigation";
import {
	COMPLIANCE_SECTION_I18N,
	COMPLIANCE_STATUS_I18N,
	renderComplianceText,
} from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function ComplianceSectionCard({
	section,
	t,
}: {
	section: ComplianceSectionCardModel;
	t: Translate;
}) {
	return (
		<article
			aria-labelledby={`compliance-${section.key}`}
			className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
		>
			<div className="min-w-0 space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<h3
						id={`compliance-${section.key}`}
						className="font-semibold text-balance break-words"
					>
						{renderComplianceText(t, COMPLIANCE_SECTION_I18N[section.key])}
					</h3>
					<Badge
						variant={
							section.status === "critical" ? "destructive" : "secondary"
						}
					>
						{renderComplianceText(t, COMPLIANCE_STATUS_I18N[section.status])}
					</Badge>
				</div>
				<p className="break-words text-sm text-muted-foreground">
					{renderComplianceText(t, section.headline)}
				</p>
				<Link
					className="inline-flex min-h-9 items-center rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
					href={section.primaryLink.href}
				>
					{renderComplianceText(t, section.primaryLink.label)}
				</Link>
			</div>
			<ul className="min-w-0 space-y-2 text-sm text-muted-foreground tabular-nums">
				{section.facts.map((fact) => (
					<li
						className="break-words"
						key={typeof fact === "string" ? fact : fact.key}
					>
						{renderComplianceText(t, fact)}
					</li>
				))}
			</ul>
		</article>
	);
}
