import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComplianceSectionCard as ComplianceSectionCardModel } from "@/lib/compliance-command-center/types";
import { Link } from "@/navigation";
import { COMPLIANCE_STATUS_I18N, renderComplianceText } from "./localized-text";

type Translate = Parameters<typeof renderComplianceText>[0];

export function ComplianceSectionCard({
	section,
	t,
}: {
	section: ComplianceSectionCardModel;
	t: Translate;
}) {
	return (
		<Card>
			<CardHeader className="space-y-2">
				<CardTitle className="flex items-start justify-between gap-3">
					<span className="min-w-0 break-words text-balance">
						{renderComplianceText(t, section.headline)}
					</span>
					<span className="shrink-0 text-sm uppercase text-muted-foreground">
						{renderComplianceText(t, COMPLIANCE_STATUS_I18N[section.status])}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<ul className="space-y-2 text-sm text-muted-foreground">
					{section.facts.map((fact) => (
						<li className="break-words" key={typeof fact === "string" ? fact : fact.key}>
							{renderComplianceText(t, fact)}
						</li>
					))}
				</ul>
				<Link
					className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
					href={section.primaryLink.href}
				>
					{renderComplianceText(t, section.primaryLink.label)}
				</Link>
			</CardContent>
		</Card>
	);
}
