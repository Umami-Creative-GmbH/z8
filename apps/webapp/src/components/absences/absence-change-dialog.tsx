"use client";

import { HistoricalVacationReconciliationPanel } from "./historical-vacation-reconciliation-panel";
import type {
	ReconciliationProof,
	ReconciliationSource,
} from "@/lib/absences/vacation-reconciliation-types";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { submitAbsenceChangeAction } from "@/app/[locale]/(app)/absences/change-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import type { AbsenceChangeKind } from "@/lib/absences/change-request-types";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";

type ChangeAbsence = Pick<
	AbsenceWithCategory,
	"id" | "startDate" | "endDate" | "startPeriod" | "endPeriod"
> & { category: Pick<AbsenceWithCategory["category"], "name" | "type"> };
interface AbsenceChangeDialogProps {
	absence: ChangeAbsence;
	kind: AbsenceChangeKind;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged?: () => void;
}

function useAbsenceChangeForm(
	input: Omit<AbsenceChangeDialogProps, "open"> & {
		onError: (message: string | null) => void;
		focusInvalid: () => void;
		reconciliation: {
			current: { signature: string; proof: ReconciliationProof } | null;
		};
	},
) {
	const { t } = useTranslate();
	return useForm({
		defaultValues: {
			startDate: input.absence.startDate,
			endDate: input.absence.endDate,
			startPeriod: input.absence.startPeriod,
			endPeriod: input.absence.endPeriod,
			coverage: "keep" as "keep" | "choose",
			reason: "",
		},
		onSubmitInvalid: input.focusInvalid,
		onSubmit: async ({ value }) => {
			input.onError(null);
			try {
				const result = await submitAbsenceChangeAction(
					input.kind === "cancel"
						? {
								absenceId: input.absence.id,
								kind: input.kind,
								reason: value.reason.trim(),
							}
						: {
								absenceId: input.absence.id,
								kind: input.kind,
								proposed: {
									startDate: value.startDate,
									endDate: value.endDate,
									startPeriod: value.startPeriod,
									endPeriod: value.endPeriod,
								},
								coverage: value.coverage,
								historicalReconciliation:
									input.reconciliation.current?.signature ===
									JSON.stringify({
										kind: "change",
										absenceId: input.absence.id,
										proposed: {
											startDate: value.startDate,
											endDate: value.endDate,
											startPeriod: value.startPeriod,
											endPeriod: value.endPeriod,
										},
										coverage: value.coverage,
									})
										? input.reconciliation.current.proof
										: undefined,
								reason: value.reason.trim(),
							},
				);
				if (!result.success) {
					input.onError(result.error);
					return;
				}
				toast.success(
					t("absences.change.submitted", "Request sent for approval"),
				);
				input.onChanged?.();
				input.onOpenChange(false);
			} catch {
				input.onError(
					t(
						"absences.change.failed",
						"Could not submit the request. Please try again.",
					),
				);
			}
		},
	});
}
type ChangeForm = ReturnType<typeof useAbsenceChangeForm>;

function DateFields({ form }: { form: ChangeForm }) {
	const { t } = useTranslate();
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{(["startDate", "endDate"] as const).map((name) => (
				<form.Field
					key={name}
					name={name}
					validators={{
						onSubmit: ({ value }) =>
							!value
								? t("absences.change.dateRequired", "A date is required")
								: undefined,
					}}
				>
					{(field) => {
						const invalid = field.state.meta.errors.length > 0;
						return (
							<TFormItem>
								<TFormLabel required hasError={invalid}>
									{name === "startDate"
										? t("absences.change.startDate", "Start date")
										: t("absences.change.endDate", "End date")}
								</TFormLabel>
								<TFormControl hasError={invalid}>
									<Input
										type="date"
										name={field.name}
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						);
					}}
				</form.Field>
			))}
		</div>
	);
}

const SELECT_CLASS =
	"w-full rounded-md border bg-background p-2 text-foreground focus-visible:ring-2 focus-visible:ring-ring";
function CoverageFields({ form }: { form: ChangeForm }) {
	const { t } = useTranslate();
	const periodOptions = (
		<>
			<option value="full_day">
				{t("absences.change.fullDay", "Full day")}
			</option>
			<option value="am">{t("absences.change.morning", "Morning")}</option>
			<option value="pm">{t("absences.change.afternoon", "Afternoon")}</option>
		</>
	);
	return (
		<>
			<form.Field name="coverage">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("absences.change.coverage", "Coverage")}</TFormLabel>
						<TFormControl>
							<select
								aria-label={t("absences.change.coverage", "Coverage")}
								name={field.name}
								autoComplete="off"
								className={SELECT_CLASS}
								value={field.state.value}
								onChange={(event) =>
									field.handleChange(
										event.target.value === "choose" ? "choose" : "keep",
									)
								}
							>
								<option value="keep">
									{t(
										"absences.change.keepHours",
										"Keep recorded hours and coverage",
									)}
								</option>
								<option value="choose">
									{t(
										"absences.change.chooseCoverage",
										"Choose full-day or half-day coverage",
									)}
								</option>
							</select>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.coverage}>
				{(coverage) =>
					coverage === "choose" ? (
						<div className="grid gap-4 sm:grid-cols-2">
							{(["startPeriod", "endPeriod"] as const).map((name) => (
								<form.Field key={name} name={name}>
									{(field) => {
										const label =
											name === "startPeriod"
												? t(
														"absences.change.startCoverage",
														"Start day coverage",
													)
												: t("absences.change.endCoverage", "End day coverage");
										return (
											<TFormItem>
												<TFormLabel>{label}</TFormLabel>
												<TFormControl>
													<select
														aria-label={label}
														name={field.name}
														autoComplete="off"
														className={SELECT_CLASS}
														value={field.state.value}
														onChange={(event) =>
															field.handleChange(
																event.target.value as DayPeriod,
															)
														}
													>
														{periodOptions}
													</select>
												</TFormControl>
											</TFormItem>
										);
									}}
								</form.Field>
							))}
						</div>
					) : null
				}
			</form.Subscribe>
		</>
	);
}

export function AbsenceChangeDialog(props: AbsenceChangeDialogProps) {
	const { absence, kind, open, onOpenChange } = props;
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [error, setError] = useState<string | null>(null);
	const formElement = useRef<HTMLFormElement>(null);
	const reconciliation = useRef<{
		signature: string;
		proof: ReconciliationProof;
	} | null>(null);
	const form = useAbsenceChangeForm({
		...props,
		reconciliation,
		onError: setError,
		focusInvalid: () => {
			setTimeout(
				() =>
					formElement.current
						?.querySelector<HTMLElement>("[aria-invalid='true']")
						?.focus(),
				0,
			);
		},
	});
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<form
					ref={formElement}
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{kind === "cancel"
								? t(
										"absences.change.cancelTitle",
										"Request absence cancellation",
									)
								: t("absences.change.title", "Request absence change")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"absences.change.pendingExplanation",
								"The recorded absence stays effective until another approver accepts your request.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						<p className="text-sm">
							{absence.category.name}:{" "}
							{formatPlainDateRange(
								parsePlainDate(absence.startDate),
								parsePlainDate(absence.endDate),
								locale,
								"dateMedium",
							)}
						</p>
						{kind === "change" ? (
							<>
								<DateFields form={form} />
								<CoverageFields form={form} />
							</>
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"absences.change.cancelExplanation",
									"Approval cancels the entire absence. Linked sick notes are deleted only when cancellation is approved.",
								)}
							</p>
						)}
						{absence.category.type === "sick" ? (
							<p className="text-sm text-muted-foreground">
								{t(
									"absences.change.vacationExplanation",
									"Full-day sickness may replace overlapping vacation on approval. Shortening or cancelling sickness does not restore earlier vacation; submit a new vacation request if you still need time off.",
								)}
							</p>
						) : null}
						<form.Field
							name="reason"
							validators={{
								onSubmit: ({ value }) =>
									!value.trim()
										? t(
												"absences.change.reasonRequired",
												"A reason is required",
											)
										: undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel
										required
										hasError={field.state.meta.errors.length > 0}
									>
										{t("absences.change.reason", "Reason")}
									</TFormLabel>
									<TFormControl hasError={field.state.meta.errors.length > 0}>
										<Textarea
											name={field.name}
											autoComplete="off"
											value={field.state.value}
											maxLength={2000}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						{error ? (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						) : null}
						{kind === "change" ? (
							<form.Subscribe selector={(state) => state.values}>
								{(value) => {
									const source: ReconciliationSource = {
										kind: "change",
										absenceId: absence.id,
										proposed: {
											startDate: value.startDate,
											endDate: value.endDate,
											startPeriod: value.startPeriod,
											endPeriod: value.endPeriod,
										},
										coverage: value.coverage,
									};
									const signature = JSON.stringify(source);
									return (
										<HistoricalVacationReconciliationPanel
											key={signature}
											source={source}
											onReviewed={(proof) => {
												reconciliation.current = proof
													? { signature, proof }
													: null;
											}}
										/>
									);
								}}
							</form.Subscribe>
						) : null}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(busy) => (
								<Button type="submit" disabled={busy}>
									{busy ? (
										<IconLoader2
											className="mr-2 size-4 animate-spin motion-reduce:animate-none"
											aria-hidden="true"
										/>
									) : null}
									{t("absences.change.submit", "Submit request")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
