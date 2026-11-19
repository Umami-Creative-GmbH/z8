import { IconArrowLeft } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHeaderRow,
	TableRow,
} from "@/components/ui/table";
import type { AbsenceDeputyDecisions } from "@/lib/approvals/deputy/cover-summary-store";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
} from "@/lib/datetime/temporal-format";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { Link } from "@/navigation";
import type { getTranslate } from "@/tolgee/server";
import { getApprovalTypeLabels } from "../../inbox/components/approval-type-labels";

type Translate = Awaited<ReturnType<typeof getTranslate>>;

export function DeputyDecisionsHeader({
	t,
	scope,
}: {
	t: Translate;
	scope?: string;
}) {
	return (
		<PageHeader
			title={t(
				"approvals:approvals.deputyDecisions.title",
				"Decided by your deputy",
			)}
			scope={scope}
			description={t(
				"approvals:approvals.deputyDecisions.descriptionNoDates",
				"Approvals decided for you while you were away.",
			)}
			actions={
				<Button asChild variant="outline" size="sm">
					<Link href="/approvals/inbox">
						<IconArrowLeft className="size-4" aria-hidden="true" />
						{t(
							"approvals:approvals.deputyDecisions.backToInbox",
							"Back to inbox",
						)}
					</Link>
				</Button>
			}
		/>
	);
}

/** Server presentation only: the caller retains admission, scope and historical evidence. */
export function DeputyDecisionsView({
	result,
	display,
	t,
}: {
	result: AbsenceDeputyDecisions;
	display: DisplayContext;
	t: Translate;
}) {
	const { startDate, endDate } = result.absence;
	const typeLabels: Record<string, string> = getApprovalTypeLabels(t);
	const title = t(
		"approvals:approvals.deputyDecisions.title",
		"Decided by your deputy",
	);
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<DeputyDecisionsHeader
				t={t}
				scope={
					startDate && endDate
						? formatAbsenceDateRange(startDate, endDate, display.locale)
						: undefined
				}
			/>
			<div className="min-w-0 rounded-lg border bg-card text-card-foreground">
				{result.decisions.length === 0 ? (
					<p className="p-6 text-sm text-muted-foreground">
						{t(
							"approvals:approvals.deputyDecisions.empty",
							"Nobody decided approvals for you during this absence.",
						)}
					</p>
				) : (
					<Table mobileLayout="stacked" aria-label={title}>
						<TableHeaderRow
							columns={[
								{
									id: "request",
									label: t(
										"approvals:approvals.deputyDecisions.columns.request",
										"Request",
									),
								},
								{
									id: "requester",
									label: t(
										"approvals:approvals.deputyDecisions.columns.requester",
										"Requested by",
									),
								},
								{
									id: "decision",
									label: t(
										"approvals:approvals.deputyDecisions.columns.decision",
										"Decision",
									),
								},
								{
									id: "deputy",
									label: t(
										"approvals:approvals.deputyDecisions.columns.deputy",
										"Decided by",
									),
								},
								{
									id: "decidedAt",
									label: t(
										"approvals:approvals.deputyDecisions.columns.decidedAt",
										"Decided at",
									),
								},
							]}
						/>
						<TableBody>
							{result.decisions.map((decision) => (
								<TableRow key={decision.id} data-testid="deputy-decision-row">
									<TableCell className="whitespace-normal break-words font-medium">
										{typeLabels[decision.entityType] ?? decision.entityType}
									</TableCell>
									<TableCell className="whitespace-normal break-words">
										{decision.requesterName ??
											t(
												"approvals:approvals.deputyDecisions.unknownRequester",
												"Unknown",
											)}
									</TableCell>
									<TableCell>
										<Badge
											variant={
												decision.decision === "approved"
													? "secondary"
													: "destructive"
											}
										>
											{decision.decision === "approved"
												? t(
														"approvals:approvals.deputyDecisions.approved",
														"Approved",
													)
												: t(
														"approvals:approvals.deputyDecisions.rejected",
														"Rejected",
													)}
										</Badge>
									</TableCell>
									<TableCell className="whitespace-normal break-words">
										{decision.deputy.name}
									</TableCell>
									<TableCell className="tabular-nums">
										<time dateTime={decision.decidedAt.toISOString()}>
											{formatInstant(
												instantFromDate(decision.decidedAt),
												display,
												"dateTimeMedium",
											)}
										</time>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	);
}
