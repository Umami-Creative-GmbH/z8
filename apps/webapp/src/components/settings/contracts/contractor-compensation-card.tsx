"use client";

import { IconLoader2, IconPlus, IconReceipt2, IconX } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	endContractorTerms,
	getContractorCompensation,
	setContractorTerms,
} from "@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions";
import { ContractorStatementExport } from "@/components/contractor-statements/contractor-statement-export";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ContractorCompensationRecord } from "@/lib/contractor-compensation/store";
import type { ServerActionResult } from "@/lib/effect/result";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { CONTRACTOR_COMPENSATION_REFUSALS } from "./contractor-compensation-refusals";
import { ContractorDetailsForm } from "./contractor-details-form";
import { ContractorTermsForm, compensationInputOf } from "./contractor-terms-form";
import { ContractorTermsHistory } from "./contractor-terms-summary";

export const contractorCompensationQueryKey = (employeeId: string) =>
	["contractor-compensation", employeeId] as const;

export interface ContractorCompensationCardProps {
	employeeId: string;
	/** Render without the card frame, e.g. inside an action panel. */
	bare?: boolean;
	/** Called after terms or details were saved, e.g. to refresh an overview. */
	onChanged?: () => void;
}

/**
 * An External Contractor's compensation (#1998): effective-dated hourly or
 * daily terms and the contracting company, VAT ID and PO reference. Org admins
 * only; the actions refuse everyone else. Renders nothing for someone who
 * never had a contractor engagement.
 */
export function ContractorCompensationCard({
	employeeId,
	bare,
	onChanged,
}: ContractorCompensationCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = contractorCompensationQueryKey(employeeId);
	const record = useQuery({
		queryKey,
		queryFn: async (): Promise<ContractorCompensationRecord> => {
			const result = await getContractorCompensation({ employeeId });
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS, () =>
						t(
							"settings.contracts.contractors.loadError",
							"Contractor compensation could not be loaded",
						),
					),
				);
			}
			return result.data;
		},
	});

	const data = record.data;
	// Anyone who was ever a contractor keeps the card: earlier terms and, even
	// without any, the statement of their (then unpriced) contractor work.
	if (data && !data.hadContractorEngagement) return null;
	// On an employee's detail page whether the card applies is unknown until the
	// record arrives, so it shows nothing meanwhile; a bare panel is opened for a
	// known contractor and shows the loading state.
	if (record.isPending && !bare) return null;

	const isContractor = data?.activeEngagementKind === "contractor";
	const refresh = (next: Partial<ContractorCompensationRecord>) => {
		queryClient.setQueryData<ContractorCompensationRecord>(queryKey, (previous) =>
			previous ? { ...previous, ...next } : previous,
		);
		onChanged?.();
	};

	const body = record.isPending ? (
		<div className="flex items-center justify-center p-4" role="status">
			<IconLoader2
				aria-hidden="true"
				className="size-6 text-muted-foreground motion-safe:animate-spin"
			/>
			<span className="sr-only">{t("common.loading", "Loading")}</span>
		</div>
	) : record.isError || !data ? (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-sm text-destructive" role="alert">
				{record.error?.message ??
					t(
						"settings.contracts.contractors.loadError",
						"Contractor compensation could not be loaded",
					)}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={record.isFetching}
				onClick={() => void record.refetch()}
			>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	) : (
		<div className="space-y-6">
			<ContractorTermsSection
				employeeId={employeeId}
				record={data}
				canEdit={isContractor}
				onSaved={refresh}
			/>
			{isContractor && (
				<ContractorDetailsForm
					employeeId={employeeId}
					record={data}
					onSaved={(details) => refresh({ details })}
				/>
			)}
			{/* Contractor Time & Fee Statements (#2000), also of earlier engagements. */}
			<section className="border-t pt-4">
				<ContractorStatementExport
					employeeId={employeeId}
					audience="admin"
					today={data.today}
					bare
				/>
			</section>
		</div>
	);

	const header = (
		<div className="min-w-0 space-y-1">
			<div className="flex flex-wrap items-center gap-2 font-semibold">
				<IconReceipt2 aria-hidden="true" className="size-5" />
				{t("settings.contracts.contractors.title", "External Contractor compensation")}
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.contracts.contractors.description",
					"What this External Contractor is paid, by hour or by day, from which date. Only organization admins see these rates; they never change employee contracts or payroll.",
				)}
			</p>
		</div>
	);

	if (bare) {
		return (
			<div className="space-y-4">
				{header}
				{body}
			</div>
		);
	}
	return (
		<Card>
			<CardHeader>{header}</CardHeader>
			<CardContent>{body}</CardContent>
		</Card>
	);
}

type SavedTerms = Pick<ContractorCompensationRecord, "history" | "termsInEffectId">;
type ChangeResult = ServerActionResult<SavedTerms & { changed: boolean }>;

/** The terms history with "Set rate" and "End rate" for the active engagement. */
function ContractorTermsSection({
	employeeId,
	record,
	canEdit,
	onSaved,
}: {
	employeeId: string;
	record: ContractorCompensationRecord;
	canEdit: boolean;
	onSaved: (saved: SavedTerms) => void;
}) {
	const { t } = useTranslate();
	const [mode, setMode] = useState<"set" | "end" | null>(null);
	// The server marks the terms pricing applies today (clipped to their engagement).
	const inEffect = record.history.find((terms) => terms.id === record.termsInEffectId) ?? null;
	// Only the active engagement's terms can be ended; earlier engagements' stay as recorded.
	const endable = record.history.filter(
		(terms) => terms.employmentPeriodId === record.contractorEngagementId,
	);

	const apply = async (change: Promise<ChangeResult>): Promise<boolean> => {
		const result = await change.catch(() => null);
		if (!result) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			return false;
		}
		if (!result.success) {
			toast.error(actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS));
			return false;
		}
		onSaved({ history: result.data.history, termsInEffectId: result.data.termsInEffectId });
		toast.success(
			result.data.changed
				? t("settings.contracts.contractors.saved", "Contractor terms saved")
				: mode === "end"
					? t(
							"settings.contracts.contractors.nothingEnded",
							"No rate applied on that date, so nothing changed",
						)
					: t("settings.contracts.contractors.unchanged", "These terms already apply"),
		);
		setMode(null);
		return true;
	};

	return (
		<section className="space-y-4" aria-labelledby={`contractor-terms-${employeeId}`}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 id={`contractor-terms-${employeeId}`} className="text-sm font-medium">
					{t("settings.contracts.contractors.termsHeading", "Rates")}
				</h3>
				{canEdit && mode === null && (
					<div className="flex flex-wrap gap-2">
						<Button size="sm" onClick={() => setMode("set")}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.contracts.contractors.setTerms", "Set rate")}
						</Button>
						{endable.length > 0 && (
							<Button size="sm" variant="outline" onClick={() => setMode("end")}>
								<IconX aria-hidden="true" className="mr-2 size-4" />
								{t("settings.contracts.contractors.endTerms", "End rate")}
							</Button>
						)}
					</div>
				)}
			</div>
			{!canEdit && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.contracts.contractors.readOnly",
						"This person has no active External Contractor engagement. Earlier contractor rates stay on record.",
					)}
				</p>
			)}
			{mode !== null && (
				<ContractorTermsForm
					mode={mode}
					record={record}
					inEffect={inEffect}
					endable={endable}
					onCancel={() => setMode(null)}
					onSubmit={(value) =>
						apply(
							mode === "end"
								? endContractorTerms({ employeeId, effectiveFrom: value.effectiveFrom })
								: setContractorTerms({
										employeeId,
										effectiveFrom: value.effectiveFrom,
										compensation: compensationInputOf(value),
									}),
						)
					}
				/>
			)}
			<ContractorTermsHistory record={record} inEffect={inEffect} />
		</section>
	);
}
