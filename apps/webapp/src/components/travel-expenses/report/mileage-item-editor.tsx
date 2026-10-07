"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { withoutOverriddenRequirements } from "@/lib/travel-expenses/allowance-override";
import {
	type MileageCalculation,
	type MileageItemDraft,
	mileageItemMissingRequirements,
	parseMileageItemDraft,
} from "@/lib/travel-expenses/mileage";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import { AllowanceOverrideNotice } from "./allowance-override-notice";
import { DraftSaveStatus } from "./draft-save-status";
import { ItemRequirementsSection } from "./item-requirements-section";
import { MileageBreakdown } from "./mileage-breakdown";
import { mileageDraftMatches } from "./mileage-item-draft";
import { MileageItemFields } from "./mileage-item-fields";
import {
	fieldErrorMessage,
	type MileageFieldName,
	type MileageFormValues,
	toDraftInput,
} from "./mileage-item-form";
import { mileageRequirementLabel } from "./mileage-labels";
import { RemoveExpenseButton } from "./receipt-item-editor";
import { useMileageItemDraft } from "./use-mileage-item-draft";

/**
 * Autosaving editor of one mileage expense (#606). The employee enters the
 * date, route, distance and vehicle; the amount is always the server's
 * calculation with the organization's rate effective on that date.
 */
export function MileageItemEditor({
	reportId,
	item,
	reimbursementCurrency,
	onSaved,
	onDraftChange,
	removal,
}: {
	reportId: string;
	/** The item as last loaded; later loads never reset entered values. */
	item: ReportItemView;
	reimbursementCurrency: string;
	onSaved?: (item: ReportItemView) => void;
	/** The entered values as they change; null while any of them is malformed. */
	onDraftChange?: (draft: MileageItemDraft | null) => void;
	removal?: { label: string; remove: (expectedVersion: number) => Promise<boolean> };
}) {
	const { t } = useTranslate();
	const [removing, setRemoving] = useState(false);
	const { saver, state, form, saved, resolveWithTheirs } = useMileageItemDraft({
		reportId,
		item,
		onSaved,
		onDraftChange,
	});

	async function remove() {
		if (!removal) return;
		setRemoving(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await saver
			.flush()
			.then(() => removal.remove(saver.getState().version))
			.then((removed) => {
				if (removed) saver.discard();
			})
			.finally(() => setRemoving(false));
	}

	const fieldError = (field: MileageFieldName) =>
		state.status === "invalid"
			? fieldErrorMessage(t, field, state.fieldErrors?.[field])
			: undefined;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<DraftSaveStatus
						state={state}
						onRetry={() => saver.retry()}
						onKeepMine={() => saver.resolveConflict("keep_mine")}
						onUseTheirs={resolveWithTheirs}
					/>
				</div>
				{removal && (
					<RemoveExpenseButton
						label={removal.label}
						busy={removing}
						onConfirm={() => void remove()}
					/>
				)}
			</div>

			{/* Client-side autosave: submitting only flushes the draft saver; the editor needs JS. */}
			{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void saver.flush();
				}}
				className="grid gap-4"
			>
				<MileageItemFields form={form} fieldError={fieldError} />
			</form>

			<form.Subscribe selector={(formState) => formState.values}>
				{(values) => (
					<MileageItemOutcome
						id={item.id}
						values={values}
						saved={saved}
						currency={reimbursementCurrency}
					/>
				)}
			</form.Subscribe>
		</div>
	);
}

/** The calculation, override and open requirements of the entered values. */
function MileageItemOutcome({
	id,
	values,
	saved,
	currency,
}: {
	id: string;
	values: MileageFormValues;
	/** The latest server view: its calculation is shown while the entries match it. */
	saved: ReportItemView;
	currency: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const parsed = parseMileageItemDraft(toDraftInput(values));
	const draft = parsed.ok ? parsed.draft : null;
	const calculation =
		draft && mileageDraftMatches(draft, saved) ? (saved.mileage?.calculation ?? null) : null;
	// An administrator's override (#610) applies to the saved facts only.
	const override =
		draft && mileageDraftMatches(draft, saved) ? (saved.mileage?.override ?? null) : null;
	const missing = draft
		? withoutOverriddenRequirements(
				mileageItemMissingRequirements(draft, calculation ?? { status: "incomplete" }),
				override,
			)
		: null;
	return (
		<div className="space-y-4">
			{override && (
				<AllowanceOverrideNotice
					override={override}
					ordinary={calculation?.status === "calculated" ? calculation : null}
				/>
			)}
			<MileageCalculationPanel
				id={id}
				draftComplete={missing !== null && missing.length === 0}
				calculation={calculation}
				pending={draft !== null && !mileageDraftMatches(draft, saved)}
				currency={currency}
			/>
			<ItemRequirementsSection
				headingId={`${id}-requirements`}
				missing={missing}
				label={(requirement) =>
					mileageRequirementLabel(t, requirement, { locale, calculation, currency })
				}
			/>
		</div>
	);
}

/** The server's calculation of the saved entries, or why there is none. */
function MileageCalculationPanel({
	id,
	draftComplete,
	calculation,
	pending,
	currency,
}: {
	id: string;
	draftComplete: boolean;
	calculation: MileageCalculation | null;
	pending: boolean;
	currency: string;
}) {
	const { t } = useTranslate();
	const headingId = `${id}-mileage-calculation`;
	return (
		<section
			aria-labelledby={headingId}
			aria-live="polite"
			className="space-y-2 rounded-lg border p-4"
		>
			<h3 id={headingId} className="text-base font-semibold">
				{t("travelExpenses.report.mileage.calculationTitle", "Calculated mileage")}
			</h3>
			{pending ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.mileage.pending",
						"Calculated with your organization's rate once your changes are saved.",
					)}
				</p>
			) : calculation?.status === "calculated" ? (
				<MileageBreakdown facts={calculation} />
			) : calculation?.status === "policy_missing" ||
				calculation?.status === "currency_mismatch" ? (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("travelExpenses.report.mileage.noRateTitle", "No mileage rate applies")}
					</AlertTitle>
					<AlertDescription>
						{calculation.status === "policy_missing"
							? t(
									"travelExpenses.report.mileage.noRate",
									"No rate is invented: this expense stays in draft until an expense administrator adds a mileage rate covering its date.",
								)
							: t(
									"travelExpenses.report.mileage.otherCurrency",
									"The rate for this date is not in {currency}; mileage is never converted.",
									{ currency },
								)}
					</AlertDescription>
				</Alert>
			) : (
				<p className="text-sm text-muted-foreground">
					{draftComplete
						? t(
								"travelExpenses.report.mileage.pending",
								"Calculated with your organization's rate once your changes are saved.",
							)
						: t(
								"travelExpenses.report.mileage.enterFacts",
								"Enter the date, kilometres and vehicle to see the amount.",
							)}
				</p>
			)}
		</section>
	);
}
