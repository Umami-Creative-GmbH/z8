"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import type { Instant } from "@/lib/datetime/temporal-core";
import { withoutOverriddenRequirements } from "@/lib/travel-expenses/allowance-override";
import {
	type PerDiemDraftField,
	type PerDiemItinerary,
	parsePerDiemDraft,
	perDiemMissingRequirements,
} from "@/lib/travel-expenses/per-diem";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import { AllowanceOverrideNotice } from "./allowance-override-notice";
import { DraftSaveStatus } from "./draft-save-status";
import { ItemRequirementsSection } from "./item-requirements-section";
import { PerDiemCalculationPanel } from "./per-diem-calculation-panel";
import { perDiemDraftMatches } from "./per-diem-item-draft";
import { PerDiemItemFields } from "./per-diem-item-fields";
import {
	fieldErrorMessage,
	type PerDiemFormValues,
	type PerDiemTrip,
	toDraftInput,
} from "./per-diem-item-form";
import { perDiemRequirementLabel } from "./per-diem-labels";
import { RemoveExpenseButton } from "./receipt-item-editor";
import { usePerDiemItemDraft } from "./use-per-diem-item-draft";

/**
 * Autosaving editor of the trip's per diem (#609). The employee enters when
 * they left and came back (local date, time and zone), whether they stayed
 * overnight, and the meals provided on each travel day; the allowance is
 * always the server's daily calculation with the organization's dated rates.
 */
export function PerDiemItemEditor({
	reportId,
	item,
	reimbursementCurrency,
	trip,
	onSaved,
	onDraftChange,
	removal,
	now,
}: {
	reportId: string;
	/** The item as last loaded; later loads never reset entered values. */
	item: ReportItemView;
	reimbursementCurrency: string;
	/** The trip's travel dates as entered; the itinerary must match them. */
	trip: PerDiemTrip;
	onSaved?: (item: ReportItemView) => void;
	onDraftChange?: (draft: PerDiemItinerary | null) => void;
	removal?: { label: string; remove: (expectedVersion: number) => Promise<boolean> };
	/** The report's submission clock (`useSubmissionNow`): a per diem waits for its return (#685). */
	now: Instant;
}) {
	const { t } = useTranslate();
	const [removing, setRemoving] = useState(false);
	const { saver, state, form, saved, resolveWithTheirs } = usePerDiemItemDraft({
		reportId,
		item,
		trip,
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

	const fieldError = (field: PerDiemDraftField) =>
		state.status === "invalid"
			? fieldErrorMessage(t, state.fieldErrors?.[field] as string | undefined)
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
				className="grid gap-6"
			>
				<PerDiemItemFields
					form={form}
					fieldError={fieldError}
					itemId={item.id}
					destinations={trip.destinations}
				/>
			</form>

			<form.Subscribe selector={(formState) => formState.values}>
				{(values) => (
					<PerDiemItemOutcome
						id={item.id}
						values={values}
						saved={saved}
						trip={trip}
						currency={reimbursementCurrency}
						now={now}
					/>
				)}
			</form.Subscribe>
		</div>
	);
}

/** The daily calculation, override and open requirements of the entered values. */
function PerDiemItemOutcome({
	id,
	values,
	saved,
	trip,
	currency,
	now,
}: {
	id: string;
	values: PerDiemFormValues;
	/** The latest server view: its calculation is shown while the entries match it. */
	saved: ReportItemView;
	trip: PerDiemTrip;
	currency: string;
	now: Instant;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const parsed = parsePerDiemDraft(toDraftInput(values));
	const draft = parsed.ok ? parsed.itinerary : null;
	const matches = draft !== null && perDiemDraftMatches(draft, saved);
	const calculation = matches ? (saved.perDiem?.calculation ?? null) : null;
	// An administrator's override (#610) applies to the saved facts only.
	const override = matches ? (saved.perDiem?.override ?? null) : null;
	const missing = draft
		? withoutOverriddenRequirements(
				perDiemMissingRequirements(draft, calculation ?? { status: "incomplete" }, trip, now),
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
			<PerDiemCalculationPanel
				id={id}
				calculation={calculation}
				pending={draft !== null && !matches}
				currency={currency}
			/>
			<ItemRequirementsSection
				headingId={`${id}-requirements`}
				missing={missing}
				label={(requirement) =>
					perDiemRequirementLabel(t, requirement, {
						locale,
						calculation,
						currency,
						itinerary: draft,
					})
				}
			/>
		</div>
	);
}
