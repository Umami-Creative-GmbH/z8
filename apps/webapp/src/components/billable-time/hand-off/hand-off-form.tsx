"use client";

import { IconAlertTriangle, IconEye, IconLoader2, IconSend } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import { accountingProviderName } from "@/lib/billable-time/accounting/views";
import { formatBillableAmount } from "@/lib/billable-time/format";
import type {
	HandOffCustomerOption,
	HandOffPreview,
	HandOffWorkView,
} from "@/lib/billable-time/hand-off/views";
import { useHandOffLabels } from "./hand-off-labels";

/** The server actions the form calls (injected so the page owns them). */
export interface HandOffFormActions {
	preview(
		input: HandOffRequestValues,
	): Promise<{ ok: true; preview: HandOffPreview } | { ok: false; error: string }>;
	confirm(
		input: HandOffRequestValues & { idempotencyKey: string; fingerprint: string },
	): Promise<{ ok: true; draftId: string; pending: boolean } | { ok: false; error: string }>;
}

export interface HandOffRequestValues {
	customerId: string;
	periodFrom: string;
	periodTo: string;
	projectIds: string[] | null;
	includeTimesheet: boolean;
	locale: "en" | "de";
}

function previousMonth(timeZone: string) {
	const thisMonth = Temporal.Now.plainDateISO(timeZone).with({ day: 1 });
	const from = thisMonth.subtract({ months: 1 });
	return { from: from.toString(), to: thisMonth.subtract({ days: 1 }).toString() };
}

/**
 * A new hand-off (#903): choose a customer, a period and optionally some of its
 * projects, preview what would be handed off, then confirm one invoice draft.
 * A confirm that timed out is retried with the same key, so it never creates a
 * second draft.
 */
export function HandOffForm({
	customers,
	actions,
	onHandedOff,
}: {
	customers: readonly HandOffCustomerOption[];
	actions: HandOffFormActions;
	onHandedOff: (draftId: string) => void;
}) {
	const { t } = useTranslate();
	const { timezone, locale } = useDisplayContext();
	const id = useId();
	const [preview, setPreview] = useState<{
		values: HandOffRequestValues;
		data: HandOffPreview;
		key: string;
	} | null>(null);
	const [retryable, setRetryable] = useState(false);
	const [isConfirming, startConfirm] = useTransition();
	const period = previousMonth(timezone);

	const form = useForm({
		defaultValues: {
			customerId: "",
			periodFrom: period.from,
			periodTo: period.to,
			allProjects: true,
			projectIds: [] as string[],
			includeTimesheet: false,
			locale: (locale.startsWith("de") ? "de" : "en") as "en" | "de",
		},
		onSubmit: async ({ value }) => {
			const values: HandOffRequestValues = {
				customerId: value.customerId,
				periodFrom: value.periodFrom,
				periodTo: value.periodTo,
				projectIds: value.allProjects ? null : value.projectIds,
				includeTimesheet: value.includeTimesheet,
				locale: value.locale,
			};
			const result = await actions.preview(values);
			if (!result.ok) {
				setPreview(null);
				toast.error(result.error);
				return;
			}
			setRetryable(false);
			setPreview({ values, data: result.preview, key: crypto.randomUUID() });
		},
	});

	function confirm() {
		if (!preview) return;
		startConfirm(async () => {
			const result = await actions.confirm({
				...preview.values,
				idempotencyKey: preview.key,
				fingerprint: preview.data.fingerprint,
			});
			if (result.ok && result.pending) {
				// Keep the key: a retry finishes this hand-off and never creates a second draft.
				setRetryable(true);
				toast.warning(
					t(
						"settings.billableTime.handOff.pending",
						"The accounting tool did not confirm the draft yet. Retry the hand-off.",
					),
				);
				onHandedOff(result.draftId);
				return;
			}
			if (result.ok) {
				toast.success(
					t("settings.billableTime.handOff.confirmed", "The invoice draft was created"),
				);
				setPreview(null);
				setRetryable(false);
				onHandedOff(result.draftId);
				return;
			}
			// The attempt ended; a new confirm is a new hand-off.
			setRetryable(false);
			setPreview((current) => current && { ...current, key: crypto.randomUUID() });
			toast.error(result.error);
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.billableTime.handOff.new.title", "New hand-off")}</CardTitle>
				<CardDescription>
					{t(
						"settings.billableTime.handOff.new.description",
						"Create one invoice draft in the accounting tool from a customer's un-invoiced billable work. The accountant finalizes it there.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="customerId"
						validators={{
							onSubmit: ({ value }) =>
								value
									? undefined
									: t("settings.billableTime.handOff.form.customerRequired", "Choose a customer"),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.billableTime.handOff.form.customer", "Customer")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Select
										value={field.state.value}
										onValueChange={(value) => {
											field.handleChange(typeof value === "string" ? value : "");
											form.setFieldValue("allProjects", true);
											form.setFieldValue("projectIds", []);
											setPreview(null);
										}}
									>
										<SelectTrigger className="w-full">
											<SelectValue
												placeholder={t(
													"settings.billableTime.handOff.form.customerPlaceholder",
													"Choose a customer",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{customers.map((customer) => (
												<SelectItem key={customer.id} value={customer.id}>
													{customer.hasContactLink
														? customer.name
														: t(
																"settings.billableTime.handOff.form.customerNotLinked",
																"{name} (not linked)",
																{ name: customer.name },
															)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="periodFrom">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.billableTime.handOff.form.from", "From")}</TFormLabel>
									<TFormControl>
										<DatePicker
											value={field.state.value}
											onChange={(value) => {
												field.handleChange(value);
												setPreview(null);
											}}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="periodTo"
							validators={{
								onSubmit: ({ value, fieldApi }) =>
									value && value >= fieldApi.form.getFieldValue("periodFrom")
										? undefined
										: t(
												"settings.billableTime.handOff.form.periodInvalid",
												"The period cannot end before it starts",
											),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.billableTime.handOff.form.to", "To")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<DatePicker
											value={field.state.value}
											onChange={(value) => {
												field.handleChange(value);
												setPreview(null);
											}}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Subscribe selector={(state) => state.values.customerId}>
						{(customerId) => {
							const customer = customers.find((entry) => entry.id === customerId);
							if (!customer || customer.projects.length === 0) return null;
							return (
								<form.Field name="allProjects">
									{(allField) => (
										<fieldset className="space-y-2">
											<legend className="font-medium text-sm">
												{t("settings.billableTime.handOff.form.projects", "Projects")}
											</legend>
											<div className="flex items-center gap-2">
												<Checkbox
													id={`${id}-all`}
													checked={allField.state.value}
													onCheckedChange={(checked) => {
														allField.handleChange(checked === true);
														setPreview(null);
													}}
												/>
												<Label htmlFor={`${id}-all`}>
													{t("settings.billableTime.handOff.form.allProjects", "All projects")}
												</Label>
											</div>
											{!allField.state.value && (
												<form.Field
													name="projectIds"
													validators={{
														onSubmit: ({ value, fieldApi }) =>
															fieldApi.form.getFieldValue("allProjects") || value.length > 0
																? undefined
																: t(
																		"settings.billableTime.handOff.form.projectsRequired",
																		"Choose at least one project",
																	),
													}}
												>
													{(field) => (
														<div className="space-y-2 pl-6">
															{customer.projects.map((project) => (
																<div key={project.id} className="flex items-center gap-2">
																	<Checkbox
																		id={`${id}-${project.id}`}
																		checked={field.state.value.includes(project.id)}
																		onCheckedChange={(checked) => {
																			field.handleChange(
																				checked === true
																					? [...field.state.value, project.id]
																					: field.state.value.filter(
																							(value) => value !== project.id,
																						),
																			);
																			setPreview(null);
																		}}
																	/>
																	<Label htmlFor={`${id}-${project.id}`}>{project.name}</Label>
																</div>
															))}
															<TFormMessage field={field} />
														</div>
													)}
												</form.Field>
											)}
										</fieldset>
									)}
								</form.Field>
							);
						}}
					</form.Subscribe>

					<div className="grid gap-4 sm:grid-cols-2">
						<form.Field name="includeTimesheet">
							{(field) => (
								<div className="flex items-start gap-3">
									<Switch
										id={`${id}-timesheet`}
										checked={field.state.value}
										onCheckedChange={(checked) => {
											field.handleChange(checked === true);
											setPreview(null);
										}}
									/>
									<div className="space-y-1">
										<Label htmlFor={`${id}-timesheet`}>
											{t(
												"settings.billableTime.handOff.form.timesheet",
												"Add the timesheet as text lines",
											)}
										</Label>
										<p className="text-muted-foreground text-xs">
											{t(
												"settings.billableTime.handOff.form.timesheetHelp",
												"One line per work period, within the accounting tool's line limit. You can always download the timesheet.",
											)}
										</p>
									</div>
								</div>
							)}
						</form.Field>
						<form.Field name="locale">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("settings.billableTime.handOff.form.language", "Draft language")}
									</TFormLabel>
									<TFormControl>
										<Select
											value={field.state.value}
											onValueChange={(value) => {
												field.handleChange(value === "de" ? "de" : "en");
												setPreview(null);
											}}
										>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="en">
													{t("settings.billableTime.handOff.form.english", "English")}
												</SelectItem>
												<SelectItem value="de">
													{t("settings.billableTime.handOff.form.german", "German")}
												</SelectItem>
											</SelectContent>
										</Select>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					</div>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<Button type="submit" variant="outline" disabled={isSubmitting}>
								{isSubmitting ? (
									<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
								) : (
									<IconEye aria-hidden="true" className="mr-2 size-4" />
								)}
								{t("settings.billableTime.handOff.form.preview", "Preview")}
							</Button>
						)}
					</form.Subscribe>
				</form>

				{preview && (
					<HandOffPreviewView
						preview={preview.data}
						confirming={isConfirming}
						retryable={retryable}
						onConfirm={confirm}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function WorkList({
	title,
	items,
	hint,
}: {
	title: string;
	items: HandOffWorkView[];
	hint: string;
}) {
	const labels = useHandOffLabels();
	if (items.length === 0) return null;
	return (
		<details className="rounded-md border p-3">
			<summary className="cursor-pointer font-medium text-sm">
				{title} <Badge variant="secondary">{items.length}</Badge>
			</summary>
			<p className="mt-2 text-muted-foreground text-xs">{hint}</p>
			<ul className="mt-2 space-y-1 text-sm">
				{items.map((item) => (
					<li key={item.workPeriodId} className="flex flex-wrap gap-x-3">
						<span className="tabular-nums">{labels.day(item.day)}</span>
						<span>{item.employeeName}</span>
						<span className="text-muted-foreground">{item.projectName}</span>
						<span className="tabular-nums">{labels.hoursWithUnit(item.hours)}</span>
					</li>
				))}
			</ul>
		</details>
	);
}

/** What a confirm would hand off, and why it cannot yet. */
export function HandOffPreviewView({
	preview,
	confirming,
	retryable,
	onConfirm,
}: {
	preview: HandOffPreview;
	confirming: boolean;
	retryable: boolean;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const labels = useHandOffLabels();
	const money = (amount: string) => formatBillableAmount(locale, amount, preview.currency);
	const workLines = preview.lines.filter((line) => line.kind === "work");

	return (
		<section
			aria-label={t("settings.billableTime.handOff.preview.title", "Preview")}
			className="space-y-4 border-t pt-4"
		>
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="font-medium">{preview.customer.name}</span>
				<span className="text-muted-foreground">{labels.period(preview.period)}</span>
				{preview.connection && (
					<Badge variant="outline">{accountingProviderName(preview.connection.providerKind)}</Badge>
				)}
				{preview.contact && (
					<Badge variant="secondary">
						{preview.contact.contactNumber
							? `${preview.contact.contactName} (${preview.contact.contactNumber})`
							: preview.contact.contactName}
					</Badge>
				)}
			</div>

			{preview.blockers.length > 0 && (
				<div
					role="alert"
					className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
				>
					{preview.blockers.map((blocker) => (
						<p key={blocker.kind} className="flex items-start gap-2 text-destructive text-sm">
							<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
							{labels.blocker(blocker)}
						</p>
					))}
				</div>
			)}

			{workLines.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.billableTime.handOff.preview.line", "Line")}</TableHead>
							<TableHead className="text-right">
								{t("settings.billableTime.handOff.preview.hours", "Hours")}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.billableTime.handOff.preview.rate", "Rate")}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.billableTime.handOff.preview.amount", "Amount")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{workLines.map((line) => (
							<TableRow key={line.position}>
								<TableCell>{line.text}</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.hours && labels.hours(line.hours)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.rate && money(line.rate)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.amount && money(line.amount)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter>
						<TableRow>
							<TableCell>
								{t("settings.billableTime.handOff.preview.total", "Net total")}
								{preview.taxTreatment && (
									<span className="ml-2 text-muted-foreground text-xs">
										{t(
											"settings.billableTime.handOff.preview.taxHint",
											"plus tax by the tax treatment, applied in the accounting tool",
										)}
									</span>
								)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{labels.hours(preview.hours)}
							</TableCell>
							<TableCell />
							<TableCell className="text-right font-semibold tabular-nums">
								{money(preview.netTotal)}
							</TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			)}
			{preview.timesheetLineCount > 0 && (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.billableTime.handOff.preview.timesheetLines",
						"{count, plural, one {# timesheet text line is} other {# timesheet text lines are}} added to the draft.",
						{ count: preview.timesheetLineCount },
					)}
				</p>
			)}
			{preview.timesheetOmitted > 0 && (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.billableTime.handOff.preview.timesheetOmitted",
						"The accounting tool takes only so many lines: {count, plural, one {# work period is} other {# work periods are}} left out of the text lines. The timesheet download has all of them.",
						{ count: preview.timesheetOmitted },
					)}
				</p>
			)}

			<div className="space-y-2">
				<WorkList
					title={t("settings.billableTime.handOff.preview.unpriced", "Unpriced work")}
					hint={t(
						"settings.billableTime.handOff.preview.unpricedHint",
						"Billable work without a billable rate. Add a rate on the Billable rates page, then preview again.",
					)}
					items={preview.unpriced}
				/>
				<WorkList
					title={t("settings.billableTime.handOff.preview.heldBack", "Held-back work")}
					hint={t(
						"settings.billableTime.handOff.preview.heldBackHint",
						"A correction or submission for this work is still pending. It is left out until it is decided.",
					)}
					items={preview.heldBack}
				/>
				<WorkList
					title={t("settings.billableTime.handOff.preview.alreadyInvoiced", "Already invoiced")}
					hint={t(
						"settings.billableTime.handOff.preview.alreadyInvoicedHint",
						"This work is in another invoice draft and is left out.",
					)}
					items={preview.alreadyInvoiced}
				/>
				{preview.withoutCustomer.count > 0 && (
					<p className="rounded-md border p-3 text-sm">
						{t(
							"settings.billableTime.handOff.preview.withoutCustomer",
							"{count, plural, one {# billable work period} other {# billable work periods}} ({hours} h) on projects without a customer ({projects}) cannot be handed off.",
							{
								count: preview.withoutCustomer.count,
								hours: labels.hours(preview.withoutCustomer.hours),
								projects: preview.withoutCustomer.projects.join(", "),
							},
						)}
					</p>
				)}
				{preview.nonBillable.count > 0 && (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.billableTime.handOff.preview.nonBillable",
							"{count, plural, one {# non-billable work period} other {# non-billable work periods}} ({hours} h) are not handed off.",
							{
								count: preview.nonBillable.count,
								hours: labels.hours(preview.nonBillable.hours),
							},
						)}
					</p>
				)}
			</div>

			<div className="flex flex-wrap items-center justify-end gap-3">
				{retryable && (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.billableTime.handOff.preview.retryHint",
							"Retrying is safe: it finishes the same hand-off and never creates a second draft.",
						)}
					</p>
				)}
				<Button onClick={onConfirm} disabled={confirming || preview.blockers.length > 0}>
					{confirming ? (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
					) : (
						<IconSend aria-hidden="true" className="mr-2 size-4" />
					)}
					{retryable
						? t("settings.billableTime.handOff.preview.retry", "Retry hand-off")
						: t("settings.billableTime.handOff.preview.confirm", "Create invoice draft")}
				</Button>
			</div>
		</section>
	);
}
