"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { saveMileageItemDraftAction } from "@/app/[locale]/(app)/travel-expenses/mileage-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { withoutOverriddenRequirements } from "@/lib/travel-expenses/allowance-override";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	MAX_ROUTE_LENGTH,
	MILEAGE_VEHICLES,
	type MileageCalculation,
	type MileageItemDraft,
	type MileageItemDraftInput,
	type MileageItemRequirement,
	mileageItemMissingRequirements,
	parseMileageItemDraft,
} from "@/lib/travel-expenses/mileage";
import { MAX_ACCOUNTING_REFERENCE_LENGTH } from "@/lib/travel-expenses/receipt-report";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import { AllowanceOverrideNotice } from "./allowance-override-notice";
import { DraftSaveStatus } from "./draft-save-status";
import { formatPlainDate } from "./format";
import { MileageBreakdown, vehicleLabel } from "./mileage-breakdown";
import { RemoveExpenseButton } from "./receipt-item-editor";
import { useDraftSaver } from "./use-draft-saver";

type Translate = ReturnType<typeof useTranslate>["t"];
type FormValues = { [K in keyof MileageItemDraft]: string };
type FieldName = keyof MileageItemDraft;

/** The entered mileage facts of a saved item. */
export function mileageDraftOf(item: ReportItemView): MileageItemDraft {
	return {
		expenseDate: item.expenseDate,
		route: item.mileage?.route ?? null,
		distanceKm: item.mileage?.distanceKm ?? null,
		vehicle: item.mileage?.vehicle ?? null,
		accountingReference: item.accountingReference,
	};
}

const DRAFT_FIELDS = [
	"expenseDate",
	"route",
	"distanceKm",
	"vehicle",
	"accountingReference",
] as const satisfies readonly FieldName[];

/** Whether entered mileage facts equal the saved item, so its calculation applies to them. */
export function mileageDraftMatches(draft: MileageItemDraft, item: ReportItemView): boolean {
	const saved = mileageDraftOf(item);
	return DRAFT_FIELDS.every((field) => draft[field] === saved[field]);
}

function toFormValues(draft: MileageItemDraft): FormValues {
	return {
		expenseDate: draft.expenseDate ?? "",
		route: draft.route ?? "",
		distanceKm: draft.distanceKm ?? "",
		vehicle: draft.vehicle ?? "",
		accountingReference: draft.accountingReference ?? "",
	};
}

function toDraftInput(values: FormValues): MileageItemDraftInput {
	const input = {} as MileageItemDraftInput;
	for (const key of Object.keys(values) as FieldName[]) {
		input[key] = values[key].trim() === "" ? null : values[key];
	}
	return input;
}

function fieldErrorMessage(t: Translate, field: FieldName, code: string | undefined) {
	if (!code) return undefined;
	if (code === "too_long")
		return t("travelExpenses.report.errors.tooLong", "This text is too long.");
	const messages: Partial<Record<FieldName, string>> = {
		expenseDate: t("travelExpenses.report.errors.expenseDate", "Enter a valid date."),
		distanceKm: t(
			"travelExpenses.report.mileage.errors.distance",
			"Enter the kilometres driven as a positive number with at most two decimals, e.g. 61.5.",
		),
		vehicle: t("travelExpenses.report.mileage.errors.vehicle", "Choose the vehicle you drove."),
	};
	return messages[field];
}

export function mileageRequirementLabel(
	t: Translate,
	requirement: MileageItemRequirement,
	context: { locale: string; calculation: MileageCalculation | null; currency: string },
) {
	switch (requirement) {
		case "expense_date":
			return t("travelExpenses.report.mileage.requirements.date", "Enter the date of the drive.");
		case "route":
			return t("travelExpenses.report.mileage.requirements.route", "Describe the route.");
		case "distance":
			return t(
				"travelExpenses.report.mileage.requirements.distance",
				"Enter the kilometres driven.",
			);
		case "vehicle":
			return t("travelExpenses.report.mileage.requirements.vehicle", "Choose the vehicle.");
		case "mileage_policy_missing": {
			const missing = context.calculation?.status === "policy_missing" ? context.calculation : null;
			return t(
				"travelExpenses.report.mileage.requirements.policyMissing",
				"Your organization has no mileage rate for {vehicle} on {date}. Ask an expense administrator to add a dated rate in the travel expense settings. Nothing is calculated until then.",
				{
					vehicle: vehicleLabel(t, missing?.vehicle ?? null) ?? "",
					date: missing ? formatPlainDate(context.locale, missing.expenseDate) : "",
				},
			);
		}
		case "mileage_currency":
			return t(
				"travelExpenses.report.mileage.requirements.currency",
				"The mileage rate for this date is in {policyCurrency}, but this report is reimbursed in {currency}. Ask an expense administrator to add a rate in {currency}.",
				{
					policyCurrency:
						context.calculation?.status === "currency_mismatch"
							? context.calculation.policyCurrency
							: "",
					currency: context.currency,
				},
			);
	}
}

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
	const locale = useLocale();
	const [removing, setRemoving] = useState(false);
	// The latest server view: its calculation is shown while the entries match it.
	const [saved, setSaved] = useState(item);
	const lastSaved = useRef<MileageItemDraftInput>(toDraftInput(toFormValues(mileageDraftOf(item))));

	const { saver, state } = useDraftSaver<MileageItemDraftInput, ReportItemView>({
		version: item.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.save.unsavedAfterClose",
					"Your latest changes to an expense could not be saved. Open it again to check it.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReportItemView>> => {
			const parsed = parseMileageItemDraft(values);
			const errors = parsed.ok ? null : parsed.errors;
			// Malformed fields keep their last saved value so valid edits still save.
			const saveable = { ...values };
			for (const field of Object.keys(errors ?? {}) as FieldName[]) {
				saveable[field] = lastSaved.current[field];
			}
			if (errors && !parseMileageItemDraft(saveable).ok) return { status: "invalid", errors };
			const result = await saveMileageItemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion,
				values: saveable,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					lastSaved.current = toDraftInput(toFormValues(mileageDraftOf(result.data.item)));
					setSaved(result.data.item);
					onSaved?.(result.data.item);
					return errors
						? { status: "invalid", errors, version: result.data.item.version }
						: { status: "saved", version: result.data.item.version };
				case "conflict":
					return { status: "conflict", version: result.data.item.version, item: result.data.item };
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => toFormValues(mileageDraftOf(item)));
	const form = useForm({
		defaultValues,
		listeners: {
			onChange: ({ formApi }) => {
				const values = toDraftInput(formApi.state.values);
				saver.change(values);
				const parsed = parseMileageItemDraft(values);
				onDraftChange?.(parsed.ok ? parsed.draft : null);
			},
		},
	});

	async function remove() {
		if (!removal) return;
		setRemoving(true);
		try {
			await saver.flush();
			if (await removal.remove(saver.getState().version)) saver.discard();
		} finally {
			setRemoving(false);
		}
	}

	const fieldError = (field: FieldName) =>
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
						onUseTheirs={() => {
							const theirs = state.conflict?.item;
							saver.resolveConflict("use_theirs");
							if (theirs) {
								lastSaved.current = toDraftInput(toFormValues(mileageDraftOf(theirs)));
								setSaved(theirs);
								form.reset(toFormValues(mileageDraftOf(theirs)), { keepDefaultValues: true });
								onDraftChange?.(mileageDraftOf(theirs));
							}
						}}
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

			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void saver.flush();
				}}
				className="grid gap-4"
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="expenseDate">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("expenseDate")}>
									{t("travelExpenses.report.mileage.fields.date", "Date of the drive")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("expenseDate")}>
									<DatePicker
										name="expenseDate"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("expenseDate")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="distanceKm">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!fieldError("distanceKm")}>
									{t("travelExpenses.report.mileage.fields.distance", "Kilometres driven")}
								</TFormLabel>
								<TFormControl hasError={!!fieldError("distanceKm")}>
									<Input
										name="distanceKm"
										inputMode="decimal"
										autoComplete="off"
										placeholder="0.0"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{fieldError("distanceKm")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
				</div>

				<form.Field name="route">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("route")}>
								{t("travelExpenses.report.mileage.fields.route", "Route")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("route")}>
								<Input
									name="route"
									autoComplete="off"
									maxLength={MAX_ROUTE_LENGTH}
									placeholder={t(
										"travelExpenses.report.mileage.fields.routePlaceholder",
										"e.g. Office Berlin – customer Potsdam – back",
									)}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("route")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="vehicle">
					{(field) => (
						<TFormItem>
							<RadioGroup
								aria-label={t("travelExpenses.report.mileage.fields.vehicle", "Vehicle")}
								value={field.state.value}
								onValueChange={(value) => field.handleChange(value)}
								className="gap-2"
							>
								<p
									className="text-sm font-medium data-[error=true]:text-destructive"
									data-error={!!fieldError("vehicle")}
								>
									{t("travelExpenses.report.mileage.fields.vehicle", "Vehicle")}
								</p>
								<div className="flex flex-wrap gap-x-6 gap-y-2">
									{MILEAGE_VEHICLES.map((vehicle) => (
										<Label key={vehicle} className="flex items-center gap-2 font-normal">
											<RadioGroupItem value={vehicle} />
											{vehicleLabel(t, vehicle)}
										</Label>
									))}
								</div>
							</RadioGroup>
							<TFormDescription>
								{t(
									"travelExpenses.report.mileage.fields.vehicleDescription",
									"Your own vehicle. Company cars and public transport are not mileage; add their receipts instead.",
								)}
							</TFormDescription>
							<TFormMessage>{fieldError("vehicle")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="accountingReference">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("accountingReference")}>
								{t(
									"travelExpenses.report.fields.accountingReference",
									"Accounting reference (optional)",
								)}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("accountingReference")}>
								<Input
									name="accountingReference"
									autoComplete="off"
									maxLength={MAX_ACCOUNTING_REFERENCE_LENGTH}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("accountingReference")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</form>

			<form.Subscribe selector={(formState) => formState.values}>
				{(values) => {
					const parsed = parseMileageItemDraft(toDraftInput(values));
					const draft = parsed.ok ? parsed.draft : null;
					const calculation =
						draft && mileageDraftMatches(draft, saved)
							? (saved.mileage?.calculation ?? null)
							: null;
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
								id={item.id}
								draftComplete={missing !== null && missing.length === 0}
								calculation={calculation}
								pending={draft !== null && !mileageDraftMatches(draft, saved)}
								currency={reimbursementCurrency}
							/>
							<section
								aria-labelledby={`${item.id}-requirements`}
								className="space-y-2 rounded-lg border p-4"
							>
								<h3 id={`${item.id}-requirements`} className="text-base font-semibold">
									{t("travelExpenses.report.requirements.title", "Still needed")}
								</h3>
								{missing === null ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.fixFields",
											"Correct the highlighted fields first.",
										)}
									</p>
								) : missing.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"travelExpenses.report.requirements.complete",
											"Everything for this expense is entered.",
										)}
									</p>
								) : (
									<ul className="list-disc space-y-1 pl-5 text-sm">
										{missing.map((requirement) => (
											<li key={requirement}>
												{mileageRequirementLabel(t, requirement, {
													locale,
													calculation,
													currency: reimbursementCurrency,
												})}
											</li>
										))}
									</ul>
								)}
							</section>
						</div>
					);
				}}
			</form.Subscribe>
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
