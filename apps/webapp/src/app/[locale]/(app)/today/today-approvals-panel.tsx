import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";

type TodayApprovalsPanelProps = {
	items: BriefingApprovalActionItem[];
	error?: string;
};

export function TodayApprovalsPanel({ items, error }: TodayApprovalsPanelProps) {
	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<CardTitle className="text-base">Approvals</CardTitle>
						<CardDescription>Requests waiting for a manager decision.</CardDescription>
					</div>
					<Badge variant={items.length > 0 ? "default" : "secondary"}>{items.length}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{error ? <SectionError message={error} /> : null}
				<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
					{items.length > 0
						? `${items.length} approval${items.length === 1 ? "" : "s"} waiting.`
						: "No approvals are waiting."}
				</p>
			</CardContent>
		</Card>
	);
}

function SectionError({ message }: { message: string }) {
	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
			{message}
		</div>
	);
}
