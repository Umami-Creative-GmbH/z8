"use client";

import { IconCurrencyEuro, IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getEmployeeMinijobMonitorAction,
	recordMinijobExternalOffsetAction,
	voidMinijobExternalOffsetAction,
} from "@/app/[locale]/(app)/settings/employees/minijob-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";
import type {
	MinijobExternalOffsetView,
	MinijobMonitorView,
	MinijobMonthDetail,
} from "@/lib/statutory/minijob/minijob-monitor-view";
import {
	formatEuroCents,
	formatMinijobMonth,
	MinijobTierBadge,
	minijobExceedanceLabel,
} from "./minijob-labels";
import {
	MINIJOB_REVIEWS_QUERY_KEY,
	minijobMonitorQueryKey,
	minijobMonitorQueryPrefix,
} from "./minijob-query-keys";

// Minijob earnings monitor on Employee Detail (#1989). Org admins see EUR amounts and edit the
// employee's external Minijob earnings; scoped managers see the warning tier of each month only.

type Translate = ReturnType<typeof useTranslate>["t"];

const OFFSET_REFUSALS = {
	statutory_period_overlap: [
		"settings.contracts.minijob.offsets.refusal.overlap",
		"The period overlaps existing earnings.",
	],
	statutory_invalid_range: [
		"settings.contracts.minijob.offsets.refusal.range",
		"The last month must not be before the first month.",
	],
	statutory_invalid_value: [
		"settings.contracts.minijob.offsets.refusal.value",
		"Enter a monthly amount of 0 or more.",
	],
	statutory_note_required: [
		"settings.contracts.minijob.offsets.refusal.note",
		"Record where the earnings come from.",
	],
	statutory_release_single_day: [
		"settings.contracts.minijob.offsets.refusal.range",
		"The last month must not be before the first month.",
	],
} satisfies RefusalMessages<EmployeeContextRefusal>;

/** External earnings change the monitor and the exceedances in Reviews & Conflicts. */
function refreshAfterOffsetChange(queryClient: QueryClient, employeeId: string) {
	void queryClient.invalidateQueries({ queryKey: minijobMonitorQueryPrefix(employeeId) });
	void queryClient.invalidateQueries({ queryKey: MINIJOB_REVIEWS_QUERY_KEY });
}

function MonthsTable({
	view,
	locale,
	t,
}: {
	view: MinijobMonitorView;
	locale: string;
	t: Translate;
}) {
	const months = view.months.filter((month) => month.isMinijob);
	const full = view.audience === "full";
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("settings.contracts.minijob.column.month", "Month")}</TableHead>
						<TableHead>{t("settings.contracts.minijob.column.monthly", "Monthly limit")}</TableHead>
						<TableHead>
							{t("settings.contracts.minijob.column.rolling", "Rolling 12 months")}
						</TableHead>
						{full && (
							<TableHead>
								{t("settings.contracts.minijob.column.exceedance", "Exceedance")}
							</TableHead>
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{months.map((month) => {
						const detail = full ? (month as MinijobMonthDetail) : null;
						return (
							<TableRow key={month.month}>
								<TableCell className="whitespace-nowrap font-medium">
									{formatMinijobMonth(month.month, locale)}
									{month.month === view.currentMonth && (
										<span className="ml-2 text-muted-foreground text-xs">
											{t("settings.contracts.minijob.currentMonth", "(current)")}
										</span>
									)}
								</TableCell>
								<TableCell>
									<div className="flex flex-col gap-1">
										<MinijobTierBadge tier={month.tier} documented={month.documented} t={t} />
										{detail && detail.capCents !== null && (
											<span className="text-muted-foreground text-xs tabular-nums">
												{t("settings.contracts.minijob.amountOfCap", "{amount} of {cap}", {
													amount: formatEuroCents(detail.totalCents, locale),
													cap: formatEuroCents(detail.capCents, locale),
												})}
												{detail.plannedCents > 0 &&
													` · ${t("settings.contracts.minijob.planned", "{amount} planned", {
														amount: formatEuroCents(detail.plannedCents, locale),
													})}`}
												{detail.externalCents > 0 &&
													` · ${t(
														"settings.contracts.minijob.external",
														"{amount} other Minijobs",
														{
															amount: formatEuroCents(detail.externalCents, locale),
														},
													)}`}
											</span>
										)}
										{detail && detail.missingWageMinutes > 0 && (
											<span className="text-amber-700 text-xs dark:text-amber-400">
												{t(
													"settings.contracts.minijob.missingWage",
													"Some work has no hourly wage in its terms and is not counted.",
												)}
											</span>
										)}
									</div>
								</TableCell>
								<TableCell>
									<div className="flex flex-col gap-1">
										<MinijobTierBadge tier={month.rollingTier} t={t} />
										{detail &&
											detail.rollingTotalCents !== null &&
											detail.rollingCapCents !== null && (
												<span className="text-muted-foreground text-xs tabular-nums">
													{t("settings.contracts.minijob.amountOfCap", "{amount} of {cap}", {
														amount: formatEuroCents(detail.rollingTotalCents, locale),
														cap: formatEuroCents(detail.rollingCapCents, locale),
													})}
												</span>
											)}
									</div>
								</TableCell>
								{detail && (
									<TableCell className="text-xs">
										{detail.exceedance ? minijobExceedanceLabel(detail.exceedance.status, t) : "—"}
									</TableCell>
								)}
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

interface OffsetFormValues {
	fromMonth: string;
	lastMonth: string;
	amountEuro: number;
	sourceEmployer: string;
	note: string;
}

function AddOffsetForm({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (value: OffsetFormValues) => {
			const result = await recordMinijobExternalOffsetAction({
				employeeId,
				fromMonth: value.fromMonth,
				lastMonth: value.lastMonth || null,
				amountCents: Math.round(value.amountEuro * 100),
				sourceEmployer: value.sourceEmployer.trim() || null,
				note: value.note,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, OFFSET_REFUSALS));
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.minijob.offsets.saved", "External Minijob earnings saved"),
			);
			refreshAfterOffsetChange(queryClient, employeeId);
			onDone();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: {
			fromMonth: "",
			lastMonth: "",
			amountEuro: Number.NaN,
			sourceEmployer: "",
			note: "",
		} as OffsetFormValues,
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value);
		},
	});
	const monthRequired = (value: string) =>
		/^\d{4}-\d{2}$/.test(value)
			? undefined
			: t("settings.contracts.minijob.offsets.monthRequired", "Choose a month.");

	return (
		<form
			noValidate
			aria-busy={mutation.isPending}
			className="space-y-4 rounded-lg border p-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-3">
				<form.Field
					name="fromMonth"
					validators={{
						onChange: ({ value }) => monthRequired(value),
						onSubmit: ({ value }) => monthRequired(value),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.contracts.minijob.offsets.fromMonth", "First month")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									type="month"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</TFormControl>
							<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="lastMonth"
					validators={{
						onChangeListenTo: ["fromMonth"],
						onChange: ({ value, fieldApi }) =>
							value && value < fieldApi.form.getFieldValue("fromMonth")
								? t(
										"settings.contracts.minijob.offsets.refusal.range",
										"The last month must not be before the first month.",
									)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.contracts.minijob.offsets.lastMonth", "Last month (optional)")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									type="month"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.contracts.minijob.offsets.lastMonthHelp",
									"Leave empty while the other Minijob continues.",
								)}
							</TFormDescription>
							<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="amountEuro"
					validators={{
						onSubmit: ({ value }) =>
							Number.isFinite(value) && value >= 0
								? undefined
								: t(
										"settings.contracts.minijob.offsets.refusal.value",
										"Enter a monthly amount of 0 or more.",
									),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.contracts.minijob.offsets.amount", "Monthly earnings (EUR)")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									type="number"
									inputMode="decimal"
									min={0}
									step={0.01}
									className="tabular-nums"
									name={field.name}
									value={Number.isNaN(field.state.value) ? "" : field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.valueAsNumber)}
								/>
							</TFormControl>
							<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field name="sourceEmployer">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.contracts.minijob.offsets.sourceEmployer", "Other employer (optional)")}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="note"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t(
									"settings.contracts.minijob.offsets.refusal.note",
									"Record where the earnings come from.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.minijob.offsets.note", "Source")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name={field.name}
								value={field.state.value}
								placeholder={t(
									"settings.contracts.minijob.offsets.notePlaceholder",
									"For example: payslip of the other Minijob",
								)}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onDone}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" size="sm" disabled={mutation.isPending}>
					{mutation.isPending && (
						<IconLoader2
							className="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					)}
					{t("settings.contracts.minijob.offsets.save", "Save earnings")}
				</Button>
			</div>
		</form>
	);
}

function VoidOffsetForm({
	employeeId,
	offset,
	onDone,
}: {
	employeeId: string;
	offset: MinijobExternalOffsetView;
	onDone: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (reason: string) => {
			const result = await voidMinijobExternalOffsetAction({
				employeeId,
				offsetId: offset.id,
				reason,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, OFFSET_REFUSALS));
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.minijob.offsets.voided", "External Minijob earnings voided"),
			);
			refreshAfterOffsetChange(queryClient, employeeId);
			onDone();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value.reason);
		},
	});
	const reasonRequired = (value: string) =>
		value.trim()
			? undefined
			: t(
					"settings.contracts.minijob.offsets.voidReasonRequired",
					"Record why the earnings are voided.",
				);

	return (
		<form
			noValidate
			className="flex flex-wrap items-start gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="reason" validators={{ onSubmit: ({ value }) => reasonRequired(value) }}>
				{(field) => (
					<TFormItem className="min-w-56 flex-1">
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name={field.name}
								aria-label={t(
									"settings.contracts.minijob.offsets.voidReason",
									"Why void these earnings?",
								)}
								placeholder={t(
									"settings.contracts.minijob.offsets.voidReason",
									"Why void these earnings?",
								)}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<Button type="submit" size="sm" variant="destructive" disabled={mutation.isPending}>
				{t("settings.contracts.minijob.offsets.confirmVoid", "Void")}
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={onDone}>
				{t("common.cancel", "Cancel")}
			</Button>
		</form>
	);
}

function ExternalOffsets({
	employeeId,
	offsets,
	locale,
}: {
	employeeId: string;
	offsets: readonly MinijobExternalOffsetView[];
	locale: string;
}) {
	const { t } = useTranslate();
	const [adding, setAdding] = useState(false);
	const [voiding, setVoiding] = useState<string | null>(null);

	return (
		<section className="space-y-3" aria-labelledby={`minijob-offsets-${employeeId}`}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id={`minijob-offsets-${employeeId}`} className="font-medium text-sm">
					{t("settings.contracts.minijob.offsets.title", "Earnings from other Minijobs")}
				</h3>
				{!adding && (
					<Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.contracts.minijob.offsets.add", "Add earnings")}
					</Button>
				)}
			</div>
			{adding && <AddOffsetForm employeeId={employeeId} onDone={() => setAdding(false)} />}
			{offsets.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("settings.contracts.minijob.offsets.empty", "No other Minijob recorded.")}
				</p>
			) : (
				<ul className="space-y-2">
					{offsets.map((offset) => (
						<li key={offset.id} className="space-y-2 rounded-md border p-3 text-sm">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div>
									<p className="font-medium tabular-nums">
										{t("settings.contracts.minijob.offsets.perMonth", "{amount} a month", {
											amount: formatEuroCents(offset.amountCents, locale, offset.currency),
										})}
									</p>
									<p className="text-muted-foreground text-xs">
										{offset.lastMonth
											? t("settings.contracts.minijob.offsets.range", "{from} – {until}", {
													from: formatMinijobMonth(offset.fromMonth, locale),
													until: formatMinijobMonth(offset.lastMonth, locale),
												})
											: t("settings.contracts.minijob.offsets.since", "Since {from}", {
													from: formatMinijobMonth(offset.fromMonth, locale),
												})}
										{offset.sourceEmployer ? ` · ${offset.sourceEmployer}` : ""}
									</p>
									<p className="text-muted-foreground text-xs">{offset.note}</p>
								</div>
								{voiding !== offset.id && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => setVoiding(offset.id)}
									>
										<IconTrash className="size-4" aria-hidden="true" />
										{t("settings.contracts.minijob.offsets.void", "Void")}
									</Button>
								)}
							</div>
							{voiding === offset.id && (
								<VoidOffsetForm
									employeeId={employeeId}
									offset={offset}
									onDone={() => setVoiding(null)}
								/>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export interface EmployeeMinijobMonitorCardProps {
	readonly employeeId: string;
	/** The viewer and their active organization: the cached figures are theirs alone. */
	readonly userId: string;
	readonly organizationId: string;
}

/**
 * Renders nothing unless the employee has Minijob terms in the shown months. The server decides
 * what the viewer may see: org admins get amounts, everyone else tiers only.
 */
export function EmployeeMinijobMonitorCard({
	employeeId,
	userId,
	organizationId,
}: EmployeeMinijobMonitorCardProps) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: minijobMonitorQueryKey(userId, organizationId, employeeId),
		queryFn: async () => {
			const result = await getEmployeeMinijobMonitorAction({ employeeId });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 60 * 1000,
	});
	const view = query.data;
	if (!view || !view.applies) return null;
	return <MinijobMonitorContent employeeId={employeeId} view={view} />;
}

function MinijobMonitorContent({
	employeeId,
	view,
}: {
	employeeId: string;
	view: MinijobMonitorView;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCurrencyEuro className="size-5 text-primary" aria-hidden="true" />
					{t("settings.contracts.minijob.title", "Minijob earnings limit")}
				</CardTitle>
				<CardDescription>
					{view.audience === "full"
						? t(
								"settings.contracts.minijob.descriptionAdmin",
								"Earned wages, planned shifts and earnings from other Minijobs against the monthly limit in force each month and the rolling 12 months (§ 8 Abs. 1 Nr. 1 SGB IV).",
							)
						: t(
								"settings.contracts.minijob.descriptionRestricted",
								"How close this employee is to the Minijob earnings limit. Amounts are visible to organization admins only.",
							)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<MonthsTable view={view} locale={locale} t={t} />
				{view.audience === "full" && (
					<ExternalOffsets employeeId={employeeId} offsets={view.externalOffsets} locale={locale} />
				)}
			</CardContent>
		</Card>
	);
}
