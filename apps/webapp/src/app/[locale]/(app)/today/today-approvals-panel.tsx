"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";

type TodayApprovalsPanelProps = {
	items: BriefingApprovalActionItem[];
	error?: string;
};

type ApprovalDecision = "approve" | "reject";

type ApprovalDecisionResponse = {
	success?: boolean;
	error?: string;
};

const REJECT_REASON = "Rejected from manager daily briefing.";

export function TodayApprovalsPanel({ items, error }: TodayApprovalsPanelProps) {
	const router = useRouter();
	const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);
	const [isRefreshPending, startRefreshTransition] = useTransition();
	const isBusy = actingApprovalId !== null || isRefreshPending;

	function decideApproval(item: BriefingApprovalActionItem, decision: ApprovalDecision) {
		if (isBusy) {
			return;
		}

		setActingApprovalId(item.approvalId);

		postApprovalDecision(item.approvalId, decision)
			.then((result) => {
				if (!result.success) {
					toast.error(result.error || fallbackError(decision));
					return;
				}

				toast.success(decision === "approve" ? "Request approved" : "Request rejected");
				startTransition(() => {
					startRefreshTransition(() => {
						router.refresh();
					});
				});
			})
			.catch(() => {
				toast.error(fallbackError(decision));
			})
			.finally(() => {
				setActingApprovalId(null);
			});
	}

	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<h2 className="font-semibold text-base leading-none">Approvals</h2>
						<CardDescription className="break-words">
							Requests waiting for a manager decision.
						</CardDescription>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Badge variant={items.length > 0 ? "default" : "secondary"}>{items.length}</Badge>
						<Button asChild size="sm" variant="outline">
							<Link href="/approvals/inbox">Open inbox</Link>
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{error ? <SectionError message={error} /> : null}
				{items.length > 0 ? (
					<ul aria-label="Pending approvals" className="space-y-3">
						{items.map((item) => (
							<li
								className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between"
								key={item.id}
							>
								<div className="min-w-0 space-y-1">
									<p className="break-words font-medium text-sm">{item.title}</p>
									<p className="break-words text-muted-foreground text-sm">{item.summary}</p>
									<p className="truncate text-muted-foreground text-xs">
										{item.requesterName} - {item.description}
									</p>
								</div>
								<div className="flex shrink-0 gap-2">
									<Button
										aria-label={`Reject ${item.title}`}
										disabled={isBusy}
										onClick={() => decideApproval(item, "reject")}
										size="sm"
										type="button"
										variant="outline"
									>
										Reject
									</Button>
									<Button
										aria-label={`Approve ${item.title}`}
										disabled={isBusy}
										onClick={() => decideApproval(item, "approve")}
										size="sm"
										type="button"
									>
										Approve
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
						No approvals are waiting.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

async function postApprovalDecision(
	approvalId: string,
	decision: ApprovalDecision,
): Promise<ApprovalDecisionResponse> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}/${decision}`, {
		method: "POST",
		...(decision === "reject"
			? {
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reason: REJECT_REASON }),
				}
			: {}),
	});

	const payload: unknown = await response.json();
	const parsed = parseApprovalDecisionResponse(payload);

	if (!response.ok || !parsed.success) {
		return { success: false, error: parsed.error };
	}

	return { success: true };
}

function parseApprovalDecisionResponse(payload: unknown): ApprovalDecisionResponse {
	if (!isRecord(payload)) {
		return { success: false };
	}

	return {
		success: payload.success === true,
		error: typeof payload.error === "string" ? payload.error : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function fallbackError(decision: ApprovalDecision) {
	return decision === "approve" ? "Unable to approve request" : "Unable to reject request";
}

function SectionError({ message }: { message: string }) {
	return (
		<div
			className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
			role="alert"
		>
			{message}
		</div>
	);
}
