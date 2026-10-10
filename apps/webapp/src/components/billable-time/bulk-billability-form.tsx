"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import {
	BULK_BILLABILITY_SKIP_REASONS,
	type BulkBillabilitySkipReason,
	type BulkBillabilitySummary,
	type BulkBillabilityTally,
} from "@/lib/billable-time/bulk-billability";
import type { ServerActionResult } from "@/lib/effect/result";

export interface BulkBillabilityChoice {
	/** Employee-local day of each work period's start, `YYYY-MM-DD`, both inclusive. */
	fromDay: string;
	toDay: string;
	billable: boolean;
}

export interface BulkBillabilityPreviewData {
	summary: BulkBillabilitySummary;
	fingerprint: string;
}

export type BulkBillabilityApplyData =
	| { status: "applied"; summary: BulkBillabilitySummary; failed: BulkBillabilityTally }
	| { status: "stale"; preview: BulkBillabilityPreviewData };

export interface BulkBillabilityFormProps {
	initialRange: { fromDay: string; toDay: string };
	onPreview: (
		choice: BulkBillabilityChoice,
	) => Promise<ServerActionResult<BulkBillabilityPreviewData>>;
	onApply: (
		choice: BulkBillabilityChoice & { fingerprint: string },
	) => Promise<ServerActionResult<BulkBillabilityApplyData>>;
	/** Called once work was changed. */
	onApplied?: () => void;
}

type View =
	| { kind: "choosing" }
	| {
			kind: "preview";
			choice: BulkBillabilityChoice;
			preview: BulkBillabilityPreviewData;
			stale: boolean;
	  }
	| {
			kind: "applied";
			summary: BulkBillabilitySummary;
			failed: BulkBillabilityTally;
	  };

/**
 * Marks a project's completed work in a date range billable or non-billable
 * (#901): choose, preview the counts, then apply exactly that preview. The
 * server re-plans on apply and answers with a fresh preview when the work
 * changed in between.
 */
export function BulkBillabilityForm({
	initialRange,
	onPreview,
	onApply,
	onApplied,
}: BulkBillabilityFormProps) {
	const { t } = useTranslate();
	const id = useId();
	const [view, setView] = useState<View>({ kind: "choosing" });
	const [error, setError] = useState<string | null>(null);
	const [applying, setApplying] = useState(false);

	const resetPreview = () => {
		setView({ kind: "choosing" });
		setError(null);
	};

	const form = useForm({
		defaultValues: {
			fromDay: initialRange.fromDay,
			toDay: initialRange.toDay,
			target: "billable" as "billable" | "non_billable",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			const choice: BulkBillabilityChoice = {
				fromDay: value.fromDay,
				toDay: value.toDay,
				billable: value.target === "billable",
			};
			const result = await onPreview(choice).catch(() => null);
			if (!result) {
				setError(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			if (!result.success) {
				setError(result.error);
				return;
			}
			setView({ kind: "preview", choice, preview: result.data, stale: false });
		},
	});

	const apply = async () => {
		if (view.kind !== "preview") return;
		setApplying(true);
		setError(null);
		const result = await onApply({
			...view.choice,
			fingerprint: view.preview.fingerprint,
		}).catch(() => null);
		setApplying(false);
		if (!result) {
			setError(t("common.unexpectedError", "An unexpected error occurred"));
			return;
		}
		if (!result.success) {
			setError(result.error);
			return;
		}
		if (result.data.status === "stale") {
			setView({ kind: "preview", choice: view.choice, preview: result.data.preview, stale: true });
			return;
		}
		setView({ kind: "applied", summary: result.data.summary, failed: result.data.failed });
		onApplied?.();
	};

	const requiredDay = (value: string) =>
		value ? undefined : t("settings.billableTime.bulk.dateRequired", "Choose a date");

	return (
		<div className="space-y-6">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.billableTime.bulk.help",
						"Changes completed work on this project. Dates are each employee's local day the work started. Work with a pending correction or submission is held back.",
					)}
				</p>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="fromDay" validators={{ onSubmit: ({ value }) => requiredDay(value) }}>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.billableTime.bulk.fromDay", "From")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
											resetPreview();
										}}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field
						name="toDay"
						validators={{
							onSubmit: ({ value, fieldApi }) =>
								requiredDay(value) ??
								(value < fieldApi.form.getFieldValue("fromDay")
									? t(
											"settings.billableTime.bulk.rangeOrder",
											"The end date must not be before the start date",
										)
									: undefined),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.billableTime.bulk.toDay", "To")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
											resetPreview();
										}}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				</div>
				<form.Field name="target">
					{(field) => (
						<fieldset className="space-y-2">
							<legend className="text-sm font-medium">
								{t("settings.billableTime.bulk.target", "Mark the work as")}
							</legend>
							<RadioGroup
								value={field.state.value}
								onValueChange={(value) => {
									field.handleChange(value === "non_billable" ? "non_billable" : "billable");
									resetPreview();
								}}
								className="flex gap-6"
							>
								<div className="flex items-center gap-2">
									<RadioGroupItem id={`${id}-billable`} value="billable" />
									<Label htmlFor={`${id}-billable`}>
										{t("settings.billableTime.bulk.billable", "Billable")}
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem id={`${id}-non-billable`} value="non_billable" />
									<Label htmlFor={`${id}-non-billable`}>
										{t("settings.billableTime.bulk.nonBillable", "Non-billable")}
									</Label>
								</div>
							</RadioGroup>
						</fieldset>
					)}
				</form.Field>
				{view.kind === "choosing" && (
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<div className="flex justify-end">
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									)}
									{t("settings.billableTime.bulk.preview", "Preview")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				)}
			</form>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{view.kind === "preview" && (
				<div className="space-y-4">
					{view.stale && (
						<Alert>
							<AlertDescription>
								{t(
									"settings.billableTime.bulk.stale",
									"The work changed since the preview. Nothing was changed; check the new preview and apply again.",
								)}
							</AlertDescription>
						</Alert>
					)}
					<BulkBillabilitySummaryTable summary={view.preview.summary} mode="preview" />
					<div className="flex justify-end gap-2">
						<Button type="button" variant="outline" disabled={applying} onClick={resetPreview}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							disabled={applying || view.preview.summary.change.count === 0}
							onClick={() => void apply()}
						>
							{applying && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{t("settings.billableTime.bulk.apply", "Apply")}
						</Button>
					</div>
				</div>
			)}

			{view.kind === "applied" && (
				<div className="space-y-4">
					<BulkBillabilitySummaryTable summary={view.summary} failed={view.failed} mode="result" />
					<div className="flex justify-end">
						<Button type="button" variant="outline" onClick={resetPreview}>
							{t("settings.billableTime.bulk.again", "Change more work")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function useSkipReasonLabels(): Record<BulkBillabilitySkipReason, string> {
	const { t } = useTranslate();
	return {
		invoiced: t(
			"settings.billableTime.bulk.skipped.invoiced",
			"Invoiced: in an invoice draft, never changed in bulk",
		),
		held_back: t(
			"settings.billableTime.bulk.skipped.heldBack",
			"Held back: a correction or submission is pending",
		),
	};
}

function BulkBillabilitySummaryTable({
	summary,
	failed,
	mode,
}: {
	summary: BulkBillabilitySummary;
	failed?: BulkBillabilityTally;
	mode: "preview" | "result";
}) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const skipLabels = useSkipReasonLabels();
	const hours = useMemo(
		() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
		[locale],
	);
	const formatHours = (minutes: number) =>
		t("settings.billableTime.bulk.hours", "{hours} h", { hours: hours.format(minutes / 60) });

	const changeLabel =
		mode === "preview"
			? summary.billable
				? t("settings.billableTime.bulk.willMarkBillable", "Will be marked billable")
				: t("settings.billableTime.bulk.willMarkNonBillable", "Will be marked non-billable")
			: summary.billable
				? t("settings.billableTime.bulk.markedBillable", "Marked billable")
				: t("settings.billableTime.bulk.markedNonBillable", "Marked non-billable");
	const rows: { key: string; label: string; tally: BulkBillabilityTally; strong?: boolean }[] = [
		{ key: "change", label: changeLabel, tally: summary.change, strong: true },
		{
			key: "already",
			label: summary.billable
				? t("settings.billableTime.bulk.alreadyBillable", "Already billable")
				: t("settings.billableTime.bulk.alreadyNonBillable", "Already non-billable"),
			tally: summary.alreadyInTarget,
		},
		...BULK_BILLABILITY_SKIP_REASONS.map((reason) => ({
			key: reason,
			label: skipLabels[reason],
			tally: summary.skipped[reason],
		})),
		...(failed && failed.count > 0
			? [
					{
						key: "failed",
						label: t(
							"settings.billableTime.bulk.failed",
							"Not changed: the work changed while applying",
						),
						tally: failed,
					},
				]
			: []),
	];

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{t("settings.billableTime.bulk.outcome", "Work")}</TableHead>
					<TableHead className="text-right">
						{t("settings.billableTime.bulk.workPeriods", "Work periods")}
					</TableHead>
					<TableHead className="text-right">
						{t("settings.billableTime.bulk.hoursColumn", "Hours")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.key}>
						<TableCell className={row.strong ? "font-medium" : undefined}>{row.label}</TableCell>
						<TableCell className="text-right tabular-nums">{row.tally.count}</TableCell>
						<TableCell className="text-right tabular-nums">
							{formatHours(row.tally.minutes)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
