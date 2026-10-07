"use client";

import { IconAlertTriangle, IconArrowRight, IconLoader2, IconTransform } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	type ConvertLegacyDraftOutcome,
	convertLegacyTravelExpenseDraftAction,
	getLegacyTravelExpenseConversion,
} from "@/app/[locale]/(app)/travel-expenses/legacy-draft-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import type { LegacyReceiptRefusal } from "@/lib/travel-expenses/legacy-draft-conversion-store";
import { Link, useRouter } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];
type Refusal = Exclude<ConvertLegacyDraftOutcome, { kind: "converted" }>;

function receiptReason(t: Translate, reason: LegacyReceiptRefusal): string {
	switch (reason) {
		case "unreadable":
			return t(
				"travelExpenses.legacyDraft.receipt.unreadable",
				"the stored file cannot be read right now",
			);
		case "identity_mismatch":
			return t(
				"travelExpenses.legacyDraft.receipt.mismatch",
				"the stored file no longer matches what was uploaded",
			);
		case "unsupported_type":
			return t(
				"travelExpenses.legacyDraft.receipt.unsupportedType",
				"the stored file is not a supported receipt type",
			);
		case "unsupported_storage":
			return t(
				"travelExpenses.legacyDraft.receipt.unsupportedStorage",
				"the file is kept in an unsupported storage",
			);
	}
}

function refusalText(t: Translate, refusal: Refusal): string {
	switch (refusal.kind) {
		case "not_draft":
		case "has_approval_history":
			return t(
				"travelExpenses.legacyDraft.notDraft",
				"This claim was already submitted. It keeps its original approval and cannot be continued as a report.",
			);
		case "receipt_unavailable":
			return t(
				"travelExpenses.legacyDraft.receiptUnavailable",
				"Nothing was changed because a receipt could not be carried over safely: {receipts}. Please retry later or ask your administrator to restore the file.",
				{
					receipts: refusal.attachments
						.map((attachment) => `${attachment.fileName} (${receiptReason(t, attachment.reason)})`)
						.join(", "),
				},
			);
	}
}

/**
 * Continues one of the employee's legacy drafts as a single-item report and
 * opens it (#616). Repeating the action opens the same report.
 */
export function ContinueLegacyDraftButton({
	claimId,
	size = "sm",
}: {
	claimId: string;
	size?: "sm" | "default";
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async () => {
			const result = await convertLegacyTravelExpenseDraftAction(claimId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: async (outcome) => {
			if (outcome.kind !== "converted") return;
			await queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.all });
			router.push(`/travel-expenses/reports/${outcome.reportId}`);
		},
	});
	const outcome = mutation.data;
	return (
		<div className="space-y-2">
			<Button
				type="button"
				size={size}
				variant="outline"
				disabled={mutation.isPending}
				onClick={() => mutation.mutate()}
			>
				{mutation.isPending ? (
					<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
				) : (
					<IconTransform aria-hidden="true" className="mr-2 size-4" />
				)}
				{t("travelExpenses.legacyDraft.continue", "Continue as report")}
			</Button>
			<div aria-live="polite">
				{(mutation.isError || (outcome && outcome.kind !== "converted")) && (
					<Alert variant="destructive">
						<IconAlertTriangle aria-hidden="true" className="size-4" />
						<AlertDescription>
							{outcome && outcome.kind !== "converted"
								? refusalText(t, outcome)
								: t(
										"travelExpenses.legacyDraft.failed",
										"The draft could not be continued. Please retry.",
									)}
						</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	);
}

const linkClass =
	"rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2";

/**
 * Actions of a row in the employee's legacy claim list: every claim can be
 * viewed; a draft is continued as a report (#616), or opens the report it was
 * continued as.
 */
export function LegacyClaimActions({
	claim,
}: {
	claim: { id: string; status: string; convertedReportId?: string | null };
}) {
	const { t } = useTranslate();
	if (claim.convertedReportId) {
		return (
			<Link className={linkClass} href={`/travel-expenses/reports/${claim.convertedReportId}`}>
				{t("travelExpenses.legacyDraft.openReport", "Open the report")}
			</Link>
		);
	}
	return (
		<div className="flex flex-wrap items-start gap-3">
			<Link className={linkClass} href={`/travel-expenses/${claim.id}`}>
				{t("travelExpenses.actions.viewClaim", "View claim")}
			</Link>
			{claim.status === "draft" && <ContinueLegacyDraftButton claimId={claim.id} />}
		</div>
	);
}

/**
 * On a legacy draft's detail page (#616): legacy drafts are no longer
 * submitted; the owner continues them as a report, or opens the report they
 * already continued it as.
 */
export function LegacyDraftConversionPanel({ claimId }: { claimId: string }) {
	const { t } = useTranslate();
	const { data, isError, isLoading, refetch, isFetching } = useQuery({
		queryKey: [...queryKeys.travelExpenses.detail(claimId), "legacy-conversion"],
		queryFn: async () => {
			const result = await getLegacyTravelExpenseConversion({ claimId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (isLoading) return null;
	return (
		<Card>
			<CardContent className="space-y-3 pt-6">
				<h2 className="text-lg font-semibold">
					{t("travelExpenses.legacyDraft.title", "Continue this draft")}
				</h2>
				{isError ? (
					<Alert variant="destructive">
						<IconAlertTriangle aria-hidden="true" className="size-4" />
						<AlertDescription className="flex flex-wrap items-center gap-2">
							{t(
								"travelExpenses.legacyDraft.loadFailed",
								"Unable to check this draft. Please retry.",
							)}
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={isFetching}
								onClick={() => void refetch()}
							>
								{t("common.retry", "Retry")}
							</Button>
						</AlertDescription>
					</Alert>
				) : data ? (
					<>
						<p className="text-sm text-muted-foreground">
							{t(
								"travelExpenses.legacyDraft.converted",
								"You continued this draft as an expense report. This claim stays here unchanged for reference.",
							)}
						</p>
						<Link
							href={`/travel-expenses/reports/${data.reportId}`}
							className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
						>
							{t("travelExpenses.legacyDraft.openReport", "Open the report")}
							<IconArrowRight aria-hidden="true" className="size-4" />
						</Link>
					</>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							{t(
								"travelExpenses.legacyDraft.description",
								"Drafts from the earlier claim form are now finished as expense reports. Your amount, dates, notes and receipts are carried over; anything the new form needs that this draft never recorded is left for you to complete. This claim itself stays unchanged.",
							)}
						</p>
						<ContinueLegacyDraftButton claimId={claimId} size="default" />
					</>
				)}
			</CardContent>
		</Card>
	);
}
