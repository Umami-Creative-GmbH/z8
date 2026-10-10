import { IconArrowLeft, IconUserShare } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApprovalTypeLabels } from "../../inbox/components/approval-type-labels";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import {
	type AbsenceDeputyDecision,
	loadDeputyDecisionsForAbsence,
} from "@/lib/approvals/deputy/cover-summary-store";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { getUserTimeFormat } from "@/lib/user-preferences/time-format-server";
import { isUuid } from "@/lib/validations/uuid";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/**
 * The approvals a covering deputy decided for the absent approver during one
 * absence (#1018): where the return summary links. Only the absent approver
 * sees it; `?deputy=` narrows it to one deputy.
 */


interface DeputyDecisionsPageProps {
	params: Promise<{ locale: string; absenceId: string }>;
	searchParams: Promise<{ deputy?: string | string[] }>;
}

type Translate = Awaited<ReturnType<typeof getTranslate>>;

function DecisionBadge({
	t,
	decision,
}: {
	t: Translate;
	decision: AbsenceDeputyDecision["decision"];
}) {
	return decision === "approved" ? (
		<Badge variant="secondary">
			{t("approvals:approvals.deputyDecisions.approved", "Approved")}
		</Badge>
	) : (
		<Badge variant="destructive">
			{t("approvals:approvals.deputyDecisions.rejected", "Rejected")}
		</Badge>
	);
}

async function DeputyDecisionsContent({ params, searchParams }: DeputyDecisionsPageProps) {
	const [{ locale, absenceId }, query, context, t] = await Promise.all([
		params,
		searchParams,
		getAuthContext(),
		getTranslate(),
	]);
	const deputy = isUuid(query.deputy) ? query.deputy : undefined;
	if (!isUuid(absenceId) || !context?.employee) notFound();

	const organizationId = context.employee.organizationId;
	const [result, timezone, timeFormat] = await Promise.all([
		loadDeputyDecisionsForAbsence(db, {
			organizationId,
			absenceId,
			viewerEmployeeId: context.employee.id,
			deputyEmployeeId: deputy,
		}),
		getEffectiveTimezone(context.user.id, organizationId),
		getUserTimeFormat(context.user.id),
	]);
	if (!result) notFound();

	const display = { locale, timezone, timeFormat };
	const typeLabels: Record<string, string> = getApprovalTypeLabels(t);
	const { startDate, endDate } = result.absence;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
			<div>
				<Button asChild size="sm" variant="ghost" className="-ml-2">
					<Link href="/approvals/inbox">
						<IconArrowLeft className="mr-2 size-4" aria-hidden="true" />
						{t("approvals:approvals.deputyDecisions.backToInbox", "Back to inbox")}
					</Link>
				</Button>
			</div>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconUserShare className="size-5" aria-hidden="true" />
						{t("approvals:approvals.deputyDecisions.title", "Decided by your deputy")}
					</CardTitle>
					<CardDescription>
						{startDate && endDate
							? t(
									"approvals:approvals.deputyDecisions.description",
									"Approvals decided for you while you were away ({dateRange}).",
									{ dateRange: formatAbsenceDateRange(startDate, endDate, locale) },
								)
							: t(
									"approvals:approvals.deputyDecisions.descriptionNoDates",
									"Approvals decided for you while you were away.",
								)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{result.decisions.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"approvals:approvals.deputyDecisions.empty",
								"Nobody decided approvals for you during this absence.",
							)}
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>
											{t("approvals:approvals.deputyDecisions.columns.request", "Request")}
										</TableHead>
										<TableHead>
											{t("approvals:approvals.deputyDecisions.columns.requester", "Requested by")}
										</TableHead>
										<TableHead>
											{t("approvals:approvals.deputyDecisions.columns.decision", "Decision")}
										</TableHead>
										<TableHead>
											{t("approvals:approvals.deputyDecisions.columns.deputy", "Decided by")}
										</TableHead>
										<TableHead>
											{t("approvals:approvals.deputyDecisions.columns.decidedAt", "Decided at")}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{result.decisions.map((decision) => (
										<TableRow key={decision.id} data-testid="deputy-decision-row">
											<TableCell>{typeLabels[decision.entityType] ?? decision.entityType}</TableCell>
											<TableCell>
												{decision.requesterName ??
													t("approvals:approvals.deputyDecisions.unknownRequester", "Unknown")}
											</TableCell>
											<TableCell>
												<DecisionBadge t={t} decision={decision.decision} />
											</TableCell>
											<TableCell>{decision.deputy.name}</TableCell>
											<TableCell className="tabular-nums">
												{formatInstant(instantFromDate(decision.decidedAt), display, "dateTimeMedium")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function DeputyDecisionsLoading() {
	return (
		<div aria-busy="true" className="flex flex-1 flex-col gap-4 p-4 pt-0" role="status">
			<Skeleton aria-hidden="true" className="h-8 w-32" />
			<Card>
				<CardHeader className="space-y-2">
					<Skeleton aria-hidden="true" className="h-6 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-full max-w-md" />
				</CardHeader>
				<CardContent className="space-y-3">
					<Skeleton aria-hidden="true" className="h-10 w-full" />
					<Skeleton aria-hidden="true" className="h-10 w-full" />
				</CardContent>
			</Card>
		</div>
	);
}

export default function DeputyDecisionsPage(props: DeputyDecisionsPageProps) {
	return (
		<Suspense fallback={<DeputyDecisionsLoading />}>
			<DeputyDecisionsContent {...props} />
		</Suspense>
	);
}
