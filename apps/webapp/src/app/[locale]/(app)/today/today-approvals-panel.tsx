import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
	BriefingActionSeverity,
	BriefingApprovalActionItem,
} from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";

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
						<CardTitle className="flex items-center gap-2 text-base">
							<IconInbox className="size-4 text-primary" aria-hidden="true" />
							Approvals
						</CardTitle>
						<CardDescription>Requests waiting for a manager decision.</CardDescription>
					</div>
					<Badge variant={items.length > 0 ? "default" : "secondary"}>{items.length}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{error ? <SectionError message={error} /> : null}
				{items.length > 0 ? (
					<div className="divide-y rounded-lg border">
						{items.slice(0, 5).map((item) => (
							<ApprovalRow key={item.id} item={item} />
						))}
					</div>
				) : (
					<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
						No approvals are waiting.
					</p>
				)}
				<Button asChild variant="outline" size="sm" className="w-full justify-between">
					<Link href="/approvals/inbox">
						Open inbox
						<IconArrowRight className="size-4" aria-hidden="true" />
					</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

function ApprovalRow({ item }: { item: BriefingApprovalActionItem }) {
	return (
		<Link
			href={item.href}
			className="group flex items-start justify-between gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="min-w-0 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<SeverityBadge severity={item.severity} />
					<span className="font-medium text-sm leading-snug">{item.title}</span>
				</div>
				<p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
			</div>
			<IconArrowRight
				className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</Link>
	);
}

function SeverityBadge({ severity }: { severity: BriefingActionSeverity }) {
	const label = {
		critical: "Critical",
		high: "High",
		warning: "Warning",
		info: "Info",
	}[severity];
	const variant =
		severity === "critical" ? "destructive" : severity === "info" ? "secondary" : "outline";

	return <Badge variant={variant}>{label}</Badge>;
}

function SectionError({ message }: { message: string }) {
	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
			{message}
		</div>
	);
}
