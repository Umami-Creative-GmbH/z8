"use client";

import { IconLoader2, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	authorizeAllowanceOverrideAction,
	getAllowanceExceptionItems,
	revokeAllowanceOverrideAction,
} from "@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions";
import { allowanceSituationLabel } from "@/components/travel-expenses/report/allowance-override-labels";
import { AllowanceOverrideNotice } from "@/components/travel-expenses/report/allowance-override-notice";
import { formatMoney, formatPlainDate } from "@/components/travel-expenses/report/format";
import { perDiemExceptionLabel } from "@/components/travel-expenses/report/per-diem-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import {
	type AllowanceOverrideError,
	MAX_OVERRIDE_BASIS_LENGTH,
	MAX_OVERRIDE_EVIDENCE_LENGTH,
	MAX_OVERRIDE_REASON_LENGTH,
	parseAllowanceOverrideDraft,
} from "@/lib/travel-expenses/allowance-override";
import type { AllowanceExceptionItem } from "@/lib/travel-expenses/allowance-override-store";
import type { PerDiemExceptionReason } from "@/lib/travel-expenses/per-diem";

type Translate = ReturnType<typeof useTranslate>["t"];
type FieldName = "amount" | "reason" | "evidence" | "calculationBasis";

const queryKey = queryKeys.travelExpenses.allowanceExceptions();

function fieldErrors(t: Translate, errors: AllowanceOverrideError[]) {
	const messages: Partial<Record<FieldName, string>> = {};
	for (const error of errors) {
		switch (error) {
			case "amount":
				messages.amount = t(
					"settings.travelExpenses.allowanceOverrides.errors.amount",
					"Enter the amount in the report currency, with at most two decimals. Mileage must be more than zero.",
				);
				break;
			case "reason":
				messages.reason = t(
					"settings.travelExpenses.allowanceOverrides.errors.reason",
					"Explain why the allowance is set manually.",
				);
				break;
			case "evidence":
				messages.evidence = t(
					"settings.travelExpenses.allowanceOverrides.errors.evidence",
					"Name the evidence the amount rests on, e.g. an official rate table or a confirmation.",
				);
				break;
			case "calculation_basis":
				messages.calculationBasis = t(
					"settings.travelExpenses.allowanceOverrides.errors.basis",
					"Show how the amount was calculated.",
				);
				break;
		}
	}
	return messages;
}

/** The entered facts of the expense, so the administrator sees what they authorize. */
function factsLine(locale: string, item: AllowanceExceptionItem): string {
	if (item.kind === "mileage") {
		return [
			item.expenseDate && formatPlainDate(locale, item.expenseDate),
			item.route,
			item.distanceKm &&
				new Intl.NumberFormat(locale, { style: "unit", unit: "kilometer" }).format(
					item.distanceKm as Intl.StringNumericLiteral,
				),
		]
			.filter(Boolean)
			.join(" · ");
	}
	const trip = item.itinerary;
	const at = (date: string | null, time: string | null, zone: string | null) =>
		[date && formatPlainDate(locale, date), time, zone && `(${zone})`].filter(Boolean).join(" ");
	return [
		trip
			? `${at(trip.startDate, trip.startTime, trip.startTimeZone)} – ${at(trip.endDate, trip.endTime, trip.endTimeZone)}`
			: null,
		item.destinations
			.map((destination) => destination.place)
			.filter(Boolean)
			.join(", "),
	]
		.filter(Boolean)
		.join(" · ");
}

function OverrideDialog({ item, onClose }: { item: AllowanceExceptionItem; onClose: () => void }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
	const form = useForm({
		defaultValues: { amount: "", reason: "", evidence: "", calculationBasis: "" },
		onSubmit: async ({ value }) => {
			const parsed = parseAllowanceOverrideDraft(value, {
				kind: item.kind,
				currency: item.reimbursementCurrency,
			});
			if (!parsed.ok) {
				setErrors(fieldErrors(t, parsed.errors));
				return;
			}
			setErrors({});
			const result = await authorizeAllowanceOverrideAction({
				reportId: item.reportId,
				itemId: item.itemId,
				expectedVersion: item.itemVersion,
				...value,
				replacesOverrideId: item.override?.id ?? null,
			});
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.allowanceOverrides.saveFailed",
						"The manual allowance could not be saved. Please retry.",
					),
				);
				return;
			}
			switch (result.data.kind) {
				case "authorized":
					toast.success(
						t("settings.travelExpenses.allowanceOverrides.saved", "Manual allowance authorized"),
					);
					break;
				case "invalid":
					setErrors(fieldErrors(t, result.data.errors));
					return;
				case "self_authorization":
					toast.error(
						t(
							"settings.travelExpenses.allowanceOverrides.self",
							"You cannot set an allowance on your own report.",
						),
					);
					return;
				default:
					toast.error(
						t(
							"settings.travelExpenses.allowanceOverrides.stale",
							"This expense changed or was submitted meanwhile. The list was refreshed.",
						),
					);
			}
			await queryClient.invalidateQueries({ queryKey });
			onClose();
		},
	});
	const field = (name: FieldName) => errors[name];

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{t(
							"settings.travelExpenses.allowanceOverrides.dialogTitle",
							"Set the allowance manually",
						)}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.travelExpenses.allowanceOverrides.dialogDescription",
							"{employee}: {facts}. The amount applies only to exactly these facts; the employee and the reviewer see it with your reason, evidence and calculation.",
							{ employee: item.employeeName, facts: factsLine(locale, item) },
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="amount">
						{(input) => (
							<TFormItem>
								<TFormLabel hasError={!!field("amount")}>
									{t("settings.travelExpenses.allowanceOverrides.amount", "Amount ({currency})", {
										currency: item.reimbursementCurrency,
									})}
								</TFormLabel>
								<TFormControl hasError={!!field("amount")}>
									<Input
										name="amount"
										inputMode="decimal"
										autoComplete="off"
										value={input.state.value}
										onChange={(event) => input.handleChange(event.target.value)}
										onBlur={input.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{field("amount")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="calculationBasis">
						{(input) => (
							<TFormItem>
								<TFormLabel hasError={!!field("calculationBasis")}>
									{t("settings.travelExpenses.allowanceOverrides.basis", "Calculation")}
								</TFormLabel>
								<TFormControl hasError={!!field("calculationBasis")}>
									<Textarea
										name="calculationBasis"
										rows={2}
										maxLength={MAX_OVERRIDE_BASIS_LENGTH}
										value={input.state.value}
										onChange={(event) => input.handleChange(event.target.value)}
										onBlur={input.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.travelExpenses.allowanceOverrides.basisDescription",
										"E.g. 2 partial days × 39.00 EUR + 1 full day × 58.00 EUR − breakfast 11.60 EUR.",
									)}
								</TFormDescription>
								<TFormMessage>{field("calculationBasis")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="reason">
						{(input) => (
							<TFormItem>
								<TFormLabel hasError={!!field("reason")}>
									{t("settings.travelExpenses.allowanceOverrides.reason", "Reason")}
								</TFormLabel>
								<TFormControl hasError={!!field("reason")}>
									<Textarea
										name="reason"
										rows={2}
										maxLength={MAX_OVERRIDE_REASON_LENGTH}
										value={input.state.value}
										onChange={(event) => input.handleChange(event.target.value)}
										onBlur={input.handleBlur}
									/>
								</TFormControl>
								<TFormMessage>{field("reason")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="evidence">
						{(input) => (
							<TFormItem>
								<TFormLabel hasError={!!field("evidence")}>
									{t("settings.travelExpenses.allowanceOverrides.evidence", "Evidence")}
								</TFormLabel>
								<TFormControl hasError={!!field("evidence")}>
									<Textarea
										name="evidence"
										rows={2}
										maxLength={MAX_OVERRIDE_EVIDENCE_LENGTH}
										value={input.state.value}
										onChange={(event) => input.handleChange(event.target.value)}
										onBlur={input.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.travelExpenses.allowanceOverrides.evidenceDescription",
										"What the amount rests on, e.g. the official rate table and edition, or a written confirmation.",
									)}
								</TFormDescription>
								<TFormMessage>{field("evidence")}</TFormMessage>
							</TFormItem>
						)}
					</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									) : (
										<IconShieldCheck aria-hidden="true" className="mr-2 size-4" />
									)}
									{t("settings.travelExpenses.allowanceOverrides.authorize", "Authorize allowance")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function reasonsLine(t: Translate, item: AllowanceExceptionItem): string | null {
	if (item.situation.kind !== "unsupported_case" || item.kind !== "per_diem") return null;
	return item.situation.reasons
		.map((reason) => perDiemExceptionLabel(t, reason as PerDiemExceptionReason))
		.join(" ");
}

function ExceptionRow({
	item,
	onAuthorize,
}: {
	item: AllowanceExceptionItem;
	onAuthorize: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [revoking, setRevoking] = useState(false);
	const reasons = reasonsLine(t, item);

	async function revoke() {
		if (!item.override) return;
		setRevoking(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await revokeAndRefresh(item.override.id).finally(() => setRevoking(false));
	}

	async function revokeAndRefresh(overrideId: string) {
		const result = await revokeAllowanceOverrideAction({
			reportId: item.reportId,
			itemId: item.itemId,
			expectedVersion: item.itemVersion,
			overrideId,
		});
		if (!result.success || result.data.kind !== "revoked") {
			toast.error(
				t(
					"settings.travelExpenses.allowanceOverrides.revokeFailed",
					"The manual allowance could not be revoked. The list was refreshed.",
				),
			);
		}
		await queryClient.invalidateQueries({ queryKey });
	}

	return (
		<li className="space-y-2 rounded-lg border p-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="font-medium">
					{item.employeeName}
					<span className="text-muted-foreground">
						{" · "}
						{item.kind === "mileage"
							? t("settings.travelExpenses.allowanceOverrides.mileage", "Mileage")
							: t("settings.travelExpenses.allowanceOverrides.perDiem", "Per diem")}
					</span>
				</p>
				<Badge variant="outline">{allowanceSituationLabel(t, item.situation)}</Badge>
			</div>
			<p className="text-sm text-muted-foreground">{factsLine(locale, item)}</p>
			{reasons && <p className="text-sm">{reasons}</p>}
			{item.ordinaryAmount && (
				<p className="text-sm text-muted-foreground">
					{t("settings.travelExpenses.allowanceOverrides.ordinary", "Policy result: {amount}", {
						amount: formatMoney(locale, item.ordinaryAmount, item.reimbursementCurrency),
					})}
				</p>
			)}
			{item.override && <AllowanceOverrideNotice override={item.override} ordinary={null} />}
			{item.ownReport ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.travelExpenses.allowanceOverrides.ownReport",
						"This is your own report: another expense administrator must decide.",
					)}
				</p>
			) : (
				<div className="flex flex-wrap gap-2">
					<Button type="button" size="sm" variant="secondary" onClick={onAuthorize}>
						{item.override
							? t("settings.travelExpenses.allowanceOverrides.replace", "Replace manual allowance")
							: t("settings.travelExpenses.allowanceOverrides.record", "Set allowance manually")}
					</Button>
					{item.override && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => void revoke()}
							disabled={revoking}
						>
							{revoking ? (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							) : (
								<IconTrash aria-hidden="true" className="mr-2 size-4" />
							)}
							{t("settings.travelExpenses.allowanceOverrides.revoke", "Revoke")}
						</Button>
					)}
				</div>
			)}
		</li>
	);
}

/**
 * Exceptional allowances (#610): mileage and per diem items of draft or
 * returned reports the server cannot calculate (no organization coverage, or
 * an itinerary outside the supported rules). An expense administrator sets an
 * evidenced manual amount for exactly the entered facts; employees never can,
 * and missing travel facts stay the employee's to enter.
 */
export function AllowanceOverridesSettingsCard() {
	const { t } = useTranslate();
	const [editing, setEditing] = useState<AllowanceExceptionItem | null>(null);
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getAllowanceExceptionItems();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.allowanceOverrides.title", "Exceptional allowances")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.allowanceOverrides.intro",
						"Mileage and per diem the system cannot calculate, because no policy covers them or the trip is outside the supported rules. Set the amount manually with its reason, evidence and calculation. It applies only to the facts it was set for and is shown to the employee and the reviewer.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-24 w-full" />}
				{isError && !data && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.allowanceOverrides.loadFailed",
								"Exceptional allowances could not be loaded.",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => void refetch()}
							disabled={isFetching}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && data.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.travelExpenses.allowanceOverrides.empty",
							"No draft report has an allowance that needs a manual calculation.",
						)}
					</p>
				)}
				{data && data.length > 0 && (
					<ul className="space-y-3">
						{data.map((item) => (
							<ExceptionRow key={item.itemId} item={item} onAuthorize={() => setEditing(item)} />
						))}
					</ul>
				)}
				{editing && <OverrideDialog item={editing} onClose={() => setEditing(null)} />}
			</CardContent>
		</Card>
	);
}
