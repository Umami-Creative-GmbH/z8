"use client";

import { IconAlertTriangle, IconExternalLink, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	activatePerDiemPolicyVersionAction,
	getPerDiemPolicySettings,
	type PerDiemPolicySettings,
	withdrawPerDiemPolicyVersionAction,
} from "@/app/[locale]/(app)/settings/travel-expenses/per-diem-policy-actions";
import { formatMoney, formatPlainDate } from "@/components/travel-expenses/report/format";
import { policySourceLabel } from "@/components/travel-expenses/report/mileage-breakdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query/keys";
import {
	PER_DIEM_RATE_FIELDS,
	type PerDiemPolicyInputErrors,
} from "@/lib/travel-expenses/per-diem-policy-input";
import type {
	PerDiemRates,
	StatutoryPerDiemDefault,
} from "@/lib/travel-expenses/statutory-per-diem-defaults";

type Translate = ReturnType<typeof useTranslate>["t"];
const queryKey = queryKeys.travelExpenses.perDiemPolicy();

type DialogTarget =
	| { source: "organization"; effectiveFrom?: string; replacesVersionId?: string }
	| { source: "statutory_default"; entry: StatutoryPerDiemDefault };

function rateLabel(t: Translate, field: keyof PerDiemRates) {
	switch (field) {
		case "fullDay":
			return t("settings.travelExpenses.perDiem.fullDay", "Full day (24 hours away)");
		case "partialDay":
			return t(
				"settings.travelExpenses.perDiem.partialDay",
				"Travel day or more than 8 hours away",
			);
		case "breakfastDeduction":
			return t("settings.travelExpenses.perDiem.breakfast", "Deduction for a provided breakfast");
		case "lunchDeduction":
			return t("settings.travelExpenses.perDiem.lunch", "Deduction for a provided lunch");
		case "dinnerDeduction":
			return t("settings.travelExpenses.perDiem.dinner", "Deduction for a provided dinner");
	}
}

function errorText(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t(
				"settings.travelExpenses.perDiem.errors.date",
				"Choose the first day the rates apply.",
			);
		case "before_default_validity":
			return t(
				"settings.travelExpenses.perDiem.errors.beforeDefault",
				"The statutory amounts were verified only from this edition's start; choose a later date or enter your organization's own amounts for earlier days.",
			);
		case "invalid_currency":
			return t(
				"settings.travelExpenses.perDiem.errors.currency",
				"Enter a three-letter currency code, e.g. EUR.",
			);
		case "invalid_amount":
			return t(
				"settings.travelExpenses.perDiem.errors.amount",
				"Enter an amount with at most two decimals, e.g. 14.00.",
			);
		case "exceeds_full_day":
			return t(
				"settings.travelExpenses.perDiem.errors.exceedsFullDay",
				"This amount cannot exceed the full-day allowance.",
			);
		case "too_long":
			return t("settings.travelExpenses.perDiem.errors.tooLong", "This text is too long.");
		default:
			return t("settings.travelExpenses.perDiem.errors.invalid", "Check this value.");
	}
}

/**
 * Dated domestic per diem rates of the organization (#609). Every change
 * activates a new immutable version; submitted reports keep the versions
 * they were calculated with. Nothing applies until an administrator acts.
 */
export function PerDiemPolicySettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getPerDiemPolicySettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const [target, setTarget] = useState<DialogTarget | null>(null);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.travelExpenses.perDiem.title", "Per diem rates")}</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.perDiem.description",
						"Daily allowances for domestic trips and the deductions for meals the organization provides. Rates apply from their start date until the next version starts; submitted reports keep the rates they were calculated with.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{isLoading && <Skeleton aria-hidden="true" className="h-32 w-full" />}
				{isError && !data && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.perDiem.loadFailed",
								"The per diem rates could not be loaded.",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							disabled={isFetching}
							onClick={() => void refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <PerDiemPolicyContent data={data} onOpen={setTarget} />}
			</CardContent>
			<PerDiemPolicyVersionDialog
				key={target ? JSON.stringify(target) : "closed"}
				target={target}
				onClose={() => setTarget(null)}
			/>
		</Card>
	);
}

function PerDiemPolicyContent({
	data,
	onOpen,
}: {
	data: PerDiemPolicySettings;
	onOpen: (target: DialogTarget) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<>
			{data.timeline.length === 0 && (
				<Alert>
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("settings.travelExpenses.perDiem.emptyTitle", "No per diem rates are set up")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.travelExpenses.perDiem.empty",
							"Employees can enter per diem on trips, but it stays in draft until rates cover the travel days. Adopt the verified statutory amounts or enter your organization's own.",
						)}
					</AlertDescription>
				</Alert>
			)}

			<p className="text-sm text-muted-foreground">
				{t(
					"settings.travelExpenses.perDiem.rules",
					"Eligibility follows {reference} ({version}), verified for travel days from {from} to {through}. Other days, trips abroad and special itineraries are flagged for a manual calculation.",
					{
						reference: data.rules.reference,
						version: data.rules.version,
						from: formatPlainDate(locale, data.rules.validFrom),
						through: formatPlainDate(locale, data.rules.validThrough),
					},
				)}
			</p>

			<div className="flex flex-wrap gap-2">
				<Button type="button" onClick={() => onOpen({ source: "organization" })}>
					<IconPlus aria-hidden="true" className="mr-2 size-4" />
					{t("settings.travelExpenses.perDiem.add", "Add rate version")}
				</Button>
			</div>

			{data.timeline.length > 0 && (
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.travelExpenses.perDiem.validFrom", "Valid from")}
								</TableHead>
								<TableHead>
									{t("settings.travelExpenses.perDiem.validUntil", "Valid until")}
								</TableHead>
								<TableHead>{t("settings.travelExpenses.perDiem.amounts", "Amounts")}</TableHead>
								<TableHead>{t("settings.travelExpenses.perDiem.source", "Source")}</TableHead>
								<TableHead>
									<span className="sr-only">{t("common.actions", "Actions")}</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.timeline.map((version) => {
								const rates = version.rates.DE;
								return (
									<TableRow key={version.id}>
										<TableCell>{formatPlainDate(locale, version.effectiveFrom)}</TableCell>
										<TableCell>
											{version.effectiveUntil
												? t("settings.travelExpenses.perDiem.until", "until {date}", {
														date: formatPlainDate(locale, version.effectiveUntil),
													})
												: t("settings.travelExpenses.perDiem.openEnded", "until further notice")}
										</TableCell>
										<TableCell className="whitespace-normal text-sm tabular-nums">
											{rates ? (
												<ul>
													{PER_DIEM_RATE_FIELDS.map((field) => (
														<li key={field}>
															{rateLabel(t, field)}:{" "}
															{formatMoney(locale, rates[field], version.currency)}
														</li>
													))}
												</ul>
											) : (
												t("settings.travelExpenses.perDiem.notCovered", "no domestic rates")
											)}
										</TableCell>
										<TableCell className="max-w-64 whitespace-normal text-sm">
											{policySourceLabel(t, version.source)}
											{version.note && <p className="text-muted-foreground">{version.note}</p>}
										</TableCell>
										<TableCell className="whitespace-nowrap text-right">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() =>
													onOpen({
														source: "organization",
														effectiveFrom: version.effectiveFrom,
														replacesVersionId: version.id,
													})
												}
											>
												{t("settings.travelExpenses.perDiem.replace", "Replace")}
											</Button>
											<WithdrawVersionButton
												versionId={version.id}
												effectiveFrom={version.effectiveFrom}
											/>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

			{data.defaults.map((entry) => (
				<section
					key={entry.key}
					aria-labelledby={`${entry.key}-title`}
					className="space-y-2 rounded-lg border p-4"
				>
					<h3 id={`${entry.key}-title`} className="text-base font-semibold">
						{t(
							"settings.travelExpenses.perDiem.germanDefaultTitle",
							"German statutory domestic per diem",
						)}
					</h3>
					<ul className="text-sm tabular-nums">
						{PER_DIEM_RATE_FIELDS.map((field) => (
							<li key={field}>
								{rateLabel(t, field)}: {formatMoney(locale, entry.rates[field], entry.currency)}
							</li>
						))}
					</ul>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.travelExpenses.perDiem.defaultSource",
							"{reference}. Verified on {verifiedOn} against {version}; can be adopted from {validFrom}.",
							{
								reference: entry.reference,
								version: entry.version,
								verifiedOn: formatPlainDate(locale, entry.verifiedOn),
								validFrom: formatPlainDate(locale, entry.validFrom),
							},
						)}
					</p>
					<ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
						{entry.sources.map((source) => (
							<li key={source.url}>
								<a
									href={source.url}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
								>
									{source.label}
									<IconExternalLink aria-hidden="true" className="size-3.5" />
								</a>
							</li>
						))}
					</ul>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpen({ source: "statutory_default", entry })}
					>
						{t("settings.travelExpenses.perDiem.adopt", "Adopt these amounts")}
					</Button>
				</section>
			))}

			{data.withdrawn.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						{t(
							"settings.travelExpenses.perDiem.history",
							"Replaced and withdrawn versions ({count})",
							{ count: data.withdrawn.length },
						)}
					</summary>
					<ul className="mt-2 space-y-1 text-muted-foreground">
						{data.withdrawn.map((version) => (
							<li key={version.id}>
								{t(
									"settings.travelExpenses.perDiem.historyEntry",
									"From {date}: full day {fullDay}, partial day {partialDay} · {source}",
									{
										date: formatPlainDate(locale, version.effectiveFrom),
										fullDay: version.rates.DE
											? formatMoney(locale, version.rates.DE.fullDay, version.currency)
											: "–",
										partialDay: version.rates.DE
											? formatMoney(locale, version.rates.DE.partialDay, version.currency)
											: "–",
										source: policySourceLabel(t, version.source),
									},
								)}
							</li>
						))}
					</ul>
				</details>
			)}
		</>
	);
}

function WithdrawVersionButton({
	versionId,
	effectiveFrom,
}: {
	versionId: string;
	effectiveFrom: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	async function withdraw() {
		setBusy(true);
		try {
			const result = await withdrawPerDiemPolicyVersionAction({ versionId });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("settings.travelExpenses.perDiem.withdrawn", "Rate version withdrawn"));
			await queryClient.invalidateQueries({ queryKey });
		} finally {
			setBusy(false);
		}
	}
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="ghost" size="sm" disabled={busy}>
					{t("settings.travelExpenses.perDiem.withdraw", "Withdraw")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.travelExpenses.perDiem.withdrawTitle", "Withdraw this rate version?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.travelExpenses.perDiem.withdrawDescription",
							"Travel days from {date} fall back to the previous version, or stay uncalculated if none exists. Submitted reports keep the rates they were calculated with.",
							{ date: formatPlainDate(locale, effectiveFrom) },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={() => void withdraw()}>
						{t("settings.travelExpenses.perDiem.withdrawConfirm", "Withdraw version")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function PerDiemPolicyVersionDialog({
	target,
	onClose,
}: {
	target: DialogTarget | null;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [errors, setErrors] = useState<PerDiemPolicyInputErrors>({});
	const [replaceVersionId, setReplaceVersionId] = useState<string | null>(
		target?.source === "organization" ? (target.replacesVersionId ?? null) : null,
	);
	const isDefault = target?.source === "statutory_default";

	const form = useForm({
		defaultValues: {
			effectiveFrom:
				target?.source === "organization"
					? (target.effectiveFrom ?? "")
					: (target?.entry.validFrom ?? ""),
			currency: "EUR",
			fullDay: "",
			partialDay: "",
			breakfastDeduction: "",
			lunchDeduction: "",
			dinnerDeduction: "",
			sourceReference: "",
			note: "",
		},
		onSubmit: async ({ value }) => {
			setErrors({});
			const result = await activatePerDiemPolicyVersionAction(
				target?.source === "statutory_default"
					? {
							source: "statutory_default",
							defaultKey: target.entry.key,
							effectiveFrom: value.effectiveFrom,
							note: value.note,
							replacesVersionId: replaceVersionId,
						}
					: {
							source: "organization",
							effectiveFrom: value.effectiveFrom,
							currency: value.currency,
							rates: {
								fullDay: value.fullDay,
								partialDay: value.partialDay,
								breakfastDeduction: value.breakfastDeduction,
								lunchDeduction: value.lunchDeduction,
								dinnerDeduction: value.dinnerDeduction,
							},
							sourceReference: value.sourceReference,
							note: value.note,
							replacesVersionId: replaceVersionId,
						},
			);
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.travelExpenses.perDiem.saveFailed",
							"The per diem rates could not be saved.",
						),
				);
				return;
			}
			switch (result.data.status) {
				case "invalid":
					setErrors(result.data.errors);
					return;
				case "start_taken":
					setReplaceVersionId(result.data.existingVersionId);
					return;
				case "stale_replacement":
					setReplaceVersionId(null);
					await queryClient.invalidateQueries({ queryKey });
					toast.error(
						t(
							"settings.travelExpenses.perDiem.stale",
							"The rates changed meanwhile. Check the current versions and try again.",
						),
					);
					return;
				case "activated":
					await queryClient.invalidateQueries({ queryKey });
					toast.success(
						t("settings.travelExpenses.perDiem.saved", "Per diem rate version activated"),
					);
					onClose();
			}
		},
	});

	const textField = (
		name: "currency" | "sourceReference" | "note" | keyof PerDiemRates,
		label: string,
		options: { description?: string; placeholder?: string; decimal?: boolean } = {},
	) => (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={!!errors[name]}>{label}</TFormLabel>
					<TFormControl hasError={!!errors[name]}>
						<Input
							name={name}
							autoComplete="off"
							inputMode={options.decimal ? "decimal" : undefined}
							placeholder={options.placeholder}
							maxLength={name === "currency" ? 3 : undefined}
							value={field.state.value}
							onChange={(event) =>
								field.handleChange(
									name === "currency" ? event.target.value.toUpperCase() : event.target.value,
								)
							}
							onBlur={field.handleBlur}
						/>
					</TFormControl>
					{options.description && <TFormDescription>{options.description}</TFormDescription>}
					<TFormMessage>{errorText(t, errors[name])}</TFormMessage>
				</TFormItem>
			)}
		</form.Field>
	);

	return (
		<Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isDefault
							? t(
									"settings.travelExpenses.perDiem.adoptTitle",
									"Adopt the German statutory per diem",
								)
							: t("settings.travelExpenses.perDiem.addTitle", "Add a per diem rate version")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.travelExpenses.perDiem.dialogDescription",
							"The version applies from its start date until the next version starts. Earlier versions and submitted reports are not changed.",
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="effectiveFrom">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!errors.effectiveFrom}>
									{t("settings.travelExpenses.perDiem.validFrom", "Valid from")}
								</TFormLabel>
								<TFormControl hasError={!!errors.effectiveFrom}>
									<DatePicker
										name="effectiveFrom"
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
											setReplaceVersionId(null);
										}}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{errorText(t, errors.effectiveFrom)}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>

					{target?.source === "statutory_default" ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.travelExpenses.perDiem.adoptDescription",
								"Amounts and source are taken from the verified catalog: {reference} ({version}).",
								{ reference: target.entry.reference, version: target.entry.version },
							)}
						</p>
					) : (
						<>
							{textField("currency", t("settings.travelExpenses.perDiem.currency", "Currency"), {
								description: t(
									"settings.travelExpenses.perDiem.currencyDescription",
									"Must match the reimbursement currency of reports; per diem is never converted.",
								),
							})}
							{PER_DIEM_RATE_FIELDS.map((field) => (
								<div key={field}>
									{textField(field, rateLabel(t, field), { decimal: true, placeholder: "0.00" })}
								</div>
							))}
							{textField(
								"sourceReference",
								t("settings.travelExpenses.perDiem.sourceReference", "Source"),
								{
									placeholder: t(
										"settings.travelExpenses.perDiem.sourceReferencePlaceholder",
										"e.g. Travel policy, works agreement 3/2026",
									),
								},
							)}
						</>
					)}

					{textField("note", t("settings.travelExpenses.perDiem.note", "Note (optional)"))}

					{replaceVersionId && (
						<Alert>
							<IconAlertTriangle aria-hidden="true" className="size-4" />
							<AlertTitle>
								{t(
									"settings.travelExpenses.perDiem.replaceTitle",
									"Replace the version starting that day",
								)}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.travelExpenses.perDiem.replaceDescription",
									"An active version already starts on {date}. Saving replaces it; the replaced version is kept in the history.",
									{ date: formatPlainDate(locale, form.state.values.effectiveFrom || "") },
								)}
							</AlertDescription>
						</Alert>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									)}
									{replaceVersionId
										? t("settings.travelExpenses.perDiem.replaceConfirm", "Replace version")
										: t("settings.travelExpenses.perDiem.activate", "Activate version")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
