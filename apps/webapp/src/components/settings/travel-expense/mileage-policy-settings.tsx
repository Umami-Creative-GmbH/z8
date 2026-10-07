"use client";

import { IconAlertTriangle, IconExternalLink, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	activateMileagePolicyVersionAction,
	getMileagePolicySettings,
	type MileagePolicySettings,
	withdrawMileagePolicyVersionAction,
} from "@/app/[locale]/(app)/settings/travel-expenses/mileage-policy-actions";
import { formatPlainDate } from "@/components/travel-expenses/report/format";
import {
	formatRatePerKm,
	policySourceLabel,
	vehicleLabel,
} from "@/components/travel-expenses/report/mileage-breakdown";
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
import { MILEAGE_VEHICLES, type MileageVehicle } from "@/lib/travel-expenses/mileage";
import type { MileagePolicyInputErrors } from "@/lib/travel-expenses/mileage-policy-input";
import type { StatutoryMileageDefault } from "@/lib/travel-expenses/statutory-allowance-defaults";

type Translate = ReturnType<typeof useTranslate>["t"];
const queryKey = queryKeys.travelExpenses.mileagePolicy();

/** What the version dialog starts from: own rates, an adopted default, or a replacement. */
type DialogTarget =
	| { source: "organization"; effectiveFrom?: string; replacesVersionId?: string }
	| { source: "statutory_default"; entry: StatutoryMileageDefault };

function errorText(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t(
				"settings.travelExpenses.mileage.errors.date",
				"Choose the first day the rate applies.",
			);
		case "before_default_validity":
			return t(
				"settings.travelExpenses.mileage.errors.beforeDefault",
				"The statutory rates were verified only from this edition's start; choose a later date or enter your own rates for earlier days.",
			);
		case "invalid_currency":
			return t(
				"settings.travelExpenses.mileage.errors.currency",
				"Enter a three-letter currency code, e.g. EUR.",
			);
		case "invalid_rate":
			return t(
				"settings.travelExpenses.mileage.errors.rate",
				"Enter a positive rate per kilometre with at most four decimals, e.g. 0.30.",
			);
		case "rate_required":
			return t(
				"settings.travelExpenses.mileage.errors.rateRequired",
				"Enter a rate for at least one vehicle.",
			);
		case "too_long":
			return t("settings.travelExpenses.mileage.errors.tooLong", "This text is too long.");
		default:
			return t("settings.travelExpenses.mileage.errors.invalid", "Check this value.");
	}
}

/**
 * Dated mileage rates of the organization (#606). Every change activates a new
 * immutable version; submitted reports keep the version they were priced with.
 */
export function MileagePolicySettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getMileagePolicySettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const [target, setTarget] = useState<DialogTarget | null>(null);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.travelExpenses.mileage.title", "Mileage rates")}</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.mileage.description",
						"Rates per kilometre for business trips in employees' own vehicles. A rate applies from its start date until the next version starts. Submitted reports keep the rate they were calculated with.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{isLoading && <Skeleton aria-hidden="true" className="h-32 w-full" />}
				{isError && !data && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.mileage.loadFailed",
								"The mileage rates could not be loaded.",
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
				{data && <MileagePolicyContent data={data} onOpen={setTarget} />}
			</CardContent>
			<MileagePolicyVersionDialog
				key={target ? JSON.stringify(target) : "closed"}
				target={target}
				onClose={() => setTarget(null)}
			/>
		</Card>
	);
}

function MileagePolicyContent({
	data,
	onOpen,
}: {
	data: MileagePolicySettings;
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
						{t("settings.travelExpenses.mileage.emptyTitle", "No mileage rate is set up")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.travelExpenses.mileage.empty",
							"Employees can enter mileage, but it stays in draft until a rate covers its date. Adopt the verified statutory rates or enter your organization's own.",
						)}
					</AlertDescription>
				</Alert>
			)}

			<div className="flex flex-wrap gap-2">
				<Button type="button" onClick={() => onOpen({ source: "organization" })}>
					<IconPlus aria-hidden="true" className="mr-2 size-4" />
					{t("settings.travelExpenses.mileage.add", "Add rate version")}
				</Button>
			</div>

			{data.timeline.length > 0 && (
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.travelExpenses.mileage.validFrom", "Valid from")}
								</TableHead>
								<TableHead>
									{t("settings.travelExpenses.mileage.validUntil", "Valid until")}
								</TableHead>
								{MILEAGE_VEHICLES.map((vehicle) => (
									<TableHead key={vehicle}>{vehicleLabel(t, vehicle)}</TableHead>
								))}
								<TableHead>{t("settings.travelExpenses.mileage.source", "Source")}</TableHead>
								<TableHead>
									<span className="sr-only">{t("common.actions", "Actions")}</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.timeline.map((version) => (
								<TableRow key={version.id}>
									<TableCell>{formatPlainDate(locale, version.effectiveFrom)}</TableCell>
									<TableCell>
										{version.effectiveUntil
											? t("settings.travelExpenses.mileage.until", "until {date}", {
													date: formatPlainDate(locale, version.effectiveUntil),
												})
											: t("settings.travelExpenses.mileage.openEnded", "until further notice")}
									</TableCell>
									{MILEAGE_VEHICLES.map((vehicle) => (
										<TableCell key={vehicle} className="tabular-nums">
											{version.ratesPerKm[vehicle]
												? formatRatePerKm(
														locale,
														version.ratesPerKm[vehicle] ?? "",
														version.currency,
													)
												: t("settings.travelExpenses.mileage.notCovered", "not covered")}
										</TableCell>
									))}
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
											{t("settings.travelExpenses.mileage.replace", "Replace")}
										</Button>
										<WithdrawVersionButton
											versionId={version.id}
											effectiveFrom={version.effectiveFrom}
										/>
									</TableCell>
								</TableRow>
							))}
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
						{t("settings.travelExpenses.mileage.germanDefaultTitle", "German statutory flat rates")}
					</h3>
					<p className="text-sm">
						{MILEAGE_VEHICLES.map((vehicle) =>
							t("settings.travelExpenses.mileage.defaultRate", "{vehicle}: {rate} per km", {
								vehicle: vehicleLabel(t, vehicle) ?? vehicle,
								rate: formatRatePerKm(locale, entry.ratesPerKm[vehicle], entry.currency),
							}),
						).join(" · ")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.travelExpenses.mileage.defaultSource",
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
						{t("settings.travelExpenses.mileage.adopt", "Adopt these rates")}
					</Button>
				</section>
			))}

			{data.withdrawn.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						{t(
							"settings.travelExpenses.mileage.history",
							"Replaced and withdrawn versions ({count})",
							{ count: data.withdrawn.length },
						)}
					</summary>
					<ul className="mt-2 space-y-1 text-muted-foreground">
						{data.withdrawn.map((version) => (
							<li key={version.id}>
								{t(
									"settings.travelExpenses.mileage.historyEntry",
									"From {date}: {rates} · {source}",
									{
										date: formatPlainDate(locale, version.effectiveFrom),
										rates: Object.entries(version.ratesPerKm)
											.map(
												([vehicle, rate]) =>
													`${vehicleLabel(t, vehicle as MileageVehicle)} ${formatRatePerKm(locale, rate ?? "", version.currency)}`,
											)
											.join(", "),
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
			const result = await withdrawMileagePolicyVersionAction({ versionId });
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.mileage.withdrawFailed",
						"The rate version could not be withdrawn. Reload the versions and try again.",
					),
				);
				return;
			}
			toast.success(t("settings.travelExpenses.mileage.withdrawn", "Rate version withdrawn"));
			await queryClient.invalidateQueries({ queryKey });
		} finally {
			setBusy(false);
		}
	}
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="ghost" size="sm" disabled={busy}>
					{t("settings.travelExpenses.mileage.withdraw", "Withdraw")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.travelExpenses.mileage.withdrawTitle", "Withdraw this rate version?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.travelExpenses.mileage.withdrawDescription",
							"Mileage dated from {date} falls back to the previous version, or stays uncalculated if none exists. Submitted reports keep the rate they were calculated with.",
							{ date: formatPlainDate(locale, effectiveFrom) },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={() => void withdraw()}>
						{t("settings.travelExpenses.mileage.withdrawConfirm", "Withdraw version")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function MileagePolicyVersionDialog({
	target,
	onClose,
}: {
	target: DialogTarget | null;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [errors, setErrors] = useState<MileagePolicyInputErrors>({});
	// Set when another active version starts the same day; saving again replaces it.
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
			car: "",
			other_motor_vehicle: "",
			sourceReference: "",
			note: "",
		},
		onSubmit: async ({ value }) => {
			setErrors({});
			const result = await activateMileagePolicyVersionAction(
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
							ratesPerKm: { car: value.car, other_motor_vehicle: value.other_motor_vehicle },
							sourceReference: value.sourceReference,
							note: value.note,
							replacesVersionId: replaceVersionId,
						},
			);
			if (!result.success) {
				toast.error(
					t("settings.travelExpenses.mileage.saveFailed", "The mileage rate could not be saved."),
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
							"settings.travelExpenses.mileage.stale",
							"The rates changed meanwhile. Check the current versions and try again.",
						),
					);
					return;
				case "activated":
					await queryClient.invalidateQueries({ queryKey });
					toast.success(
						t("settings.travelExpenses.mileage.saved", "Mileage rate version activated"),
					);
					onClose();
			}
		},
	});

	return (
		<Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isDefault
							? t("settings.travelExpenses.mileage.adoptTitle", "Adopt the German statutory rates")
							: t("settings.travelExpenses.mileage.addTitle", "Add a mileage rate version")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.travelExpenses.mileage.dialogDescription",
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
									{t("settings.travelExpenses.mileage.validFrom", "Valid from")}
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
								"settings.travelExpenses.mileage.adoptDescription",
								"Rates and source are taken from the verified catalog: {reference} ({version}).",
								{ reference: target.entry.reference, version: target.entry.version },
							)}
						</p>
					) : (
						<>
							<form.Field name="currency">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={!!errors.currency}>
											{t("settings.travelExpenses.mileage.currency", "Currency")}
										</TFormLabel>
										<TFormControl hasError={!!errors.currency}>
											<Input
												name="currency"
												maxLength={3}
												autoComplete="off"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"settings.travelExpenses.mileage.currencyDescription",
												"Must match the reimbursement currency of reports; mileage is never converted.",
											)}
										</TFormDescription>
										<TFormMessage>{errorText(t, errors.currency)}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
							{MILEAGE_VEHICLES.map((vehicle) => (
								<form.Field key={vehicle} name={vehicle}>
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={!!errors[vehicle]}>
												{t("settings.travelExpenses.mileage.rateFor", "Rate per km: {vehicle}", {
													vehicle: vehicleLabel(t, vehicle) ?? vehicle,
												})}
											</TFormLabel>
											<TFormControl hasError={!!errors[vehicle]}>
												<Input
													name={vehicle}
													inputMode="decimal"
													autoComplete="off"
													placeholder="0.30"
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
											<TFormMessage>{errorText(t, errors[vehicle])}</TFormMessage>
										</TFormItem>
									)}
								</form.Field>
							))}
							{errors.rates && (
								<p className="text-sm text-destructive" role="alert">
									{errorText(t, errors.rates)}
								</p>
							)}
							<form.Field name="sourceReference">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={!!errors.sourceReference}>
											{t("settings.travelExpenses.mileage.sourceReference", "Source")}
										</TFormLabel>
										<TFormControl hasError={!!errors.sourceReference}>
											<Input
												name="sourceReference"
												autoComplete="off"
												placeholder={t(
													"settings.travelExpenses.mileage.sourceReferencePlaceholder",
													"e.g. Travel policy, works agreement 3/2026",
												)}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage>{errorText(t, errors.sourceReference)}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						</>
					)}

					<form.Field name="note">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={!!errors.note}>
									{t("settings.travelExpenses.mileage.note", "Note (optional)")}
								</TFormLabel>
								<TFormControl hasError={!!errors.note}>
									<Input
										name="note"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{errorText(t, errors.note)}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>

					{replaceVersionId && (
						<Alert>
							<IconAlertTriangle aria-hidden="true" className="size-4" />
							<AlertTitle>
								{t(
									"settings.travelExpenses.mileage.replaceTitle",
									"Replace the version starting that day",
								)}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.travelExpenses.mileage.replaceDescription",
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
										? t("settings.travelExpenses.mileage.replaceConfirm", "Replace version")
										: t("settings.travelExpenses.mileage.activate", "Activate version")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
