import { Link } from "@/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComplianceSectionCard as ComplianceSectionCardModel } from "@/lib/compliance-command-center/types";

export function ComplianceSectionCard({ section }: { section: ComplianceSectionCardModel }) {
	return (
		<Card>
			<CardHeader className="space-y-2">
				<CardTitle className="flex items-start justify-between gap-3">
					<span className="min-w-0 break-words text-balance">{section.headline}</span>
					<span className="shrink-0 text-sm uppercase text-muted-foreground">
						{section.status}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<ul className="space-y-2 text-sm text-muted-foreground">
					{section.facts.map((fact) => (
						<li className="break-words" key={fact}>
							{fact}
						</li>
					))}
				</ul>
				<Link
					className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
					href={section.primaryLink.href}
				>
					{section.primaryLink.label}
				</Link>
			</CardContent>
		</Card>
	);
}
