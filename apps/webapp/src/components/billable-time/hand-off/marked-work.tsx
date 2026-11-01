"use client";

import { IconAlertTriangle, IconArrowsDiff, IconHistory, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import { groupChangedWork } from "@/lib/billable-time/hand-off/changed-work-groups";
import {
	parseResolutionInput,
	RESOLUTION_EXPLANATION_MAX_LENGTH,
	RESOLUTION_REFERENCE_MAX_LENGTH,
	type ResolutionFieldError,
	type ResolveItem,
} from "@/lib/billable-time/hand-off/resolution";
import type {
	MarkedWorkItemView,
	ResolutionHistoryEntryView,
	ResolveOutcomeView,
} from "@/lib/billable-time/hand-off/views";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { AmountDifference, useAmountDifferenceLabels } from "./amount-difference";
import { useHandOffLabels } from "./hand-off-labels";
import { WorkComparison } from "./work-comparison";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface ResolveMarksInput {
	items: ResolveItem[];
	explanation: string;
	accountingReference: string;
}

export type ResolveMarks = (input: ResolveMarksInput) => Promise<ActionResult<ResolveOutcomeView>>;

type ItemLabel = Pick<MarkedWorkItemView, "day" | "employeeName" | "projectName">;

/** Names a piece of invoiced work: its day, employee and project. */
export function useItemLabel() {
	const { t } = useTranslate();
	const labels = useHandOffLabels();
	return (item: ItemLabel) =>
		t("settings.billableTime.handOff.resolve.itemLabel", "{day} · {employee} · {project}", {
			day: labels.day(item.day),
			employee: item.employeeName,
			project: item.projectName,
		});
}

/**
 * Invoiced work marked as changed after invoicing (#1499): each comparison
 * item with its changed fields (since the last resolution), its comparison
 * with the hand-off values (#1501) and history, resolved one by one or several at
 * once with an explanation and an optional accounting reference. Items still
 * open when their draft was released (#1503) are shown read-only.
 */
export function MarkedWork({
	marked,
	resolve,
	onResolved,
	grouped = false,
}: {
	marked: readonly MarkedWorkItemView[];
	resolve: ResolveMarks;
	/** Reload the marked work: after resolving, or when it changed meanwhile. */
	onResolved: () => void;
	/**
	 * Group by customer, then invoice draft, oldest change first, with each
	 * draft's known amount differences subtotalled (#1502). For lists that span
	 * drafts.
	 */
	grouped?: boolean;
}) {
	const { t } = useTranslate();
	const labels = useHandOffLabels();
	const amounts = useAmountDifferenceLabels();
	const itemLabel = useItemLabel();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [resolving, setResolving] = useState<readonly MarkedWorkItemView[] | null>(null);
	const [historyOpen, setHistoryOpen] = useState<ReadonlySet<string>>(new Set());
	const [compareOpen, setCompareOpen] = useState<ReadonlySet<string>>(new Set());
	if (marked.length === 0) return null;

	// Open when released (#1503): read-only, never selectable or resolvable.
	const resolvable = marked.filter((item) => !item.openWhenReleased);
	const chosen = resolvable.filter((item) => selected.has(item.invoicedWorkId));
	const all = chosen.length === resolvable.length;
	const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => {
		const next = new Set(set);
		if (on) next.add(id);
		else next.delete(id);
		return next;
	};
	const selectAll = resolvable.length > 0 && (
		<div className="flex items-center gap-3 p-2">
			<Checkbox
				id="marked-work-select-all"
				checked={all ? true : chosen.length > 0 ? "indeterminate" : false}
				onCheckedChange={(checked) =>
					setSelected(
						checked === true ? new Set(resolvable.map((item) => item.invoicedWorkId)) : new Set(),
					)
				}
			/>
			<label htmlFor="marked-work-select-all" className="text-muted-foreground">
				{t("settings.billableTime.handOff.marks.selectAll", "Select all")}
			</label>
		</div>
	);

	const renderItem = (item: MarkedWorkItemView) => {
		const showHistory = historyOpen.has(item.invoicedWorkId);
		const showComparison = compareOpen.has(item.invoicedWorkId);
		return (
			<li key={item.invoicedWorkId} className="space-y-2 p-2">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					{!item.openWhenReleased && (
						<Checkbox
							aria-label={t("settings.billableTime.handOff.marks.select", "Select {item}", {
								item: itemLabel(item),
							})}
							checked={selected.has(item.invoicedWorkId)}
							onCheckedChange={(checked) =>
								setSelected((current) => toggle(current, item.invoicedWorkId, checked === true))
							}
						/>
					)}
					<span className="tabular-nums">{labels.day(item.day)}</span>
					<span>{item.employeeName}</span>
					<span className="text-muted-foreground">{item.projectName}</span>
					<span className="flex flex-wrap gap-1">
						{item.changedFields.map((field) => (
							<Badge key={field} variant="outline">
								{labels.changedField(field)}
							</Badge>
						))}
					</span>
					{item.openWhenReleased && (
						<Badge variant="secondary">
							{t("settings.billableTime.handOff.marks.openWhenReleased", "Open when released")}
						</Badge>
					)}
					<span className="ml-auto flex gap-1">
						<Button
							size="sm"
							variant="ghost"
							aria-expanded={showComparison}
							onClick={() =>
								setCompareOpen((current) => toggle(current, item.invoicedWorkId, !showComparison))
							}
						>
							<IconArrowsDiff aria-hidden="true" className="size-4" />
							{t("settings.billableTime.handOff.marks.compare", "Compare")}
						</Button>
						{item.history.length > 0 && (
							<Button
								size="sm"
								variant="ghost"
								aria-expanded={showHistory}
								onClick={() =>
									setHistoryOpen((current) => toggle(current, item.invoicedWorkId, !showHistory))
								}
							>
								<IconHistory aria-hidden="true" className="size-4" />
								{t("settings.billableTime.handOff.marks.history", "History ({count})", {
									count: item.history.length,
								})}
							</Button>
						)}
						{!item.openWhenReleased && (
							<Button size="sm" variant="ghost" onClick={() => setResolving([item])}>
								{t("settings.billableTime.handOff.marks.resolve", "Resolve")}
							</Button>
						)}
					</span>
				</div>
				<AmountDifference difference={item.comparison.amountDifference} />
				{showComparison && <WorkComparison comparison={item.comparison} label={itemLabel(item)} />}
				{showHistory && <ResolutionHistoryList entries={item.history} />}
			</li>
		);
	};

	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">
					{t("settings.billableTime.handOff.marks.title", "Changed after invoicing")}
				</h3>
				{resolvable.length > 0 && (
					<Button
						size="sm"
						variant="outline"
						disabled={chosen.length === 0}
						onClick={() => setResolving(chosen)}
					>
						{t(
							"settings.billableTime.handOff.marks.resolveSelected",
							"Resolve selected ({count})",
							{
								count: chosen.length,
							},
						)}
					</Button>
				)}
			</div>
			<p className="text-muted-foreground text-sm">
				{resolvable.length > 0
					? t(
							"settings.billableTime.handOff.marks.resolveHelp",
							"This invoiced work was corrected after its hand-off. Correct the invoice in the accounting tool if needed (for example with a credit note), then resolve the change with an explanation.",
						)
					: t(
							"settings.billableTime.handOff.marks.releasedHelp",
							"This invoiced work was corrected after its hand-off and was still open when the hand-off was released. It can no longer be resolved here. The current values show the work as it is now.",
						)}
			</p>
			<p className="text-muted-foreground text-xs">
				{t(
					"settings.billableTime.handOff.amount.note",
					"Amount differences are reconciliation information priced at the rate frozen at hand-off, not credit notes.",
				)}
			</p>
			{grouped ? (
				<div className="space-y-4 text-sm">
					{selectAll && <div className="rounded-md border">{selectAll}</div>}
					{groupChangedWork(marked).map((customer) => (
						<section
							key={customer.customerId}
							aria-labelledby={`changed-work-customer-${customer.customerId}`}
							className="space-y-2"
						>
							<h4 id={`changed-work-customer-${customer.customerId}`} className="font-medium">
								{customer.customerName}
							</h4>
							{customer.drafts.map((draft) => (
								<div key={draft.draftId} className="rounded-md border">
									<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b bg-muted/40 px-2 py-1.5">
										<p className="font-medium">
											{t("settings.billableTime.handOff.marks.draftHeading", "{title} · {period}", {
												title: draft.draft.title,
												period: labels.period(draft.draft.period),
											})}
										</p>
										<p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
											<span className="tabular-nums">
												{draft.subtotal === null
													? t(
															"settings.billableTime.handOff.amount.noSubtotal",
															"No known amount differences",
														)
													: draft.subtotalEstimated
														? t(
																"settings.billableTime.handOff.amount.subtotalEstimated",
																"Known amount differences: {amount} (includes estimates)",
																{ amount: amounts.amount(draft.subtotal, draft.currency) },
															)
														: t(
																"settings.billableTime.handOff.amount.subtotal",
																"Known amount differences: {amount}",
																{ amount: amounts.amount(draft.subtotal, draft.currency) },
															)}
											</span>
											{draft.unknownCount > 0 && (
												<span>
													{t(
														"settings.billableTime.handOff.amount.unknownCount",
														"{count, plural, one {# unknown difference not included} other {# unknown differences not included}}",
														{ count: draft.unknownCount },
													)}
												</span>
											)}
										</p>
									</div>
									<ul className="divide-y">{draft.items.map(renderItem)}</ul>
								</div>
							))}
						</section>
					))}
				</div>
			) : (
				<ul className="divide-y rounded-md border text-sm">
					{selectAll && <li>{selectAll}</li>}
					{marked.map(renderItem)}
				</ul>
			)}
			<ResolveMarksDialog
				items={resolving}
				resolve={resolve}
				onOpenChange={(open) => {
					if (!open) setResolving(null);
				}}
				onResolved={() => {
					setResolving(null);
					setSelected(new Set());
					onResolved();
				}}
			/>
		</section>
	);
}

function useFieldMessage() {
	const { t } = useTranslate();
	return (error: ResolutionFieldError): string => {
		switch (error.field) {
			case "explanation":
				return error.code === "required"
					? t(
							"settings.billableTime.handOff.resolve.explanationRequired",
							"Explain how the change was handled.",
						)
					: t(
							"settings.billableTime.handOff.resolve.explanationTooLong",
							"Keep the explanation to {max} characters.",
							{ max: RESOLUTION_EXPLANATION_MAX_LENGTH },
						);
			case "accountingReference":
				return t(
					"settings.billableTime.handOff.resolve.referenceTooLong",
					"Keep the reference to {max} characters.",
					{ max: RESOLUTION_REFERENCE_MAX_LENGTH },
				);
			case "items":
				return t(
					"settings.billableTime.handOff.resolve.itemsInvalid",
					"Choose the marked work to resolve.",
				);
		}
	};
}

type FormValues = { explanation: string; accountingReference: string };

/** Resolve one or more items with one explanation (#1499). Null `items` closes it. */
function ResolveMarksDialog({
	items,
	resolve,
	onOpenChange,
	onResolved,
}: {
	items: readonly MarkedWorkItemView[] | null;
	resolve: ResolveMarks;
	onOpenChange: (open: boolean) => void;
	onResolved: () => void;
}) {
	const { t } = useTranslate();
	return (
		<Dialog open={items !== null} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{t("settings.billableTime.handOff.resolve.title", "Resolve changed work")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.billableTime.handOff.resolve.description",
							"Record how the change was handled, for example with a credit note in the accounting tool. The hand-off and its lines stay as they are.",
						)}
					</DialogDescription>
				</DialogHeader>
				{items && (
					<ResolveMarksForm
						items={items}
						resolve={resolve}
						onCancel={() => onOpenChange(false)}
						onResolved={onResolved}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ResolveMarksForm({
	items,
	resolve,
	onCancel,
	onResolved,
}: {
	items: readonly MarkedWorkItemView[];
	resolve: ResolveMarks;
	onCancel: () => void;
	onResolved: () => void;
}) {
	const { t } = useTranslate();
	const itemLabel = useItemLabel();
	const fieldMessage = useFieldMessage();
	const [problem, setProblem] = useState<string | null>(null);
	/** Nothing was resolved: these items changed meanwhile, or their draft was released. */
	const [refused, setRefused] = useState<{
		reason: "stale" | "released";
		items: readonly MarkedWorkItemView[];
	} | null>(null);
	const resolveItems = items.map(({ invoicedWorkId, markVersion }) => ({
		invoicedWorkId,
		markVersion,
	}));
	const parse = (value: FormValues) => parseResolutionInput({ items: resolveItems, ...value });
	// The same rules the server applies, so a field's error clears as soon as its value is valid.
	const validators = (name: keyof FormValues) => ({
		onChange: ({ fieldApi }: { fieldApi: { form: { state: { values: FormValues } } } }) => {
			const parsed = parse(fieldApi.form.state.values);
			const error = parsed.ok ? undefined : parsed.errors.find((e) => e.field === name);
			return error ? fieldMessage(error) : undefined;
		},
	});

	const form = useForm({
		defaultValues: { explanation: "", accountingReference: "" } satisfies FormValues,
		// A field that was never touched has no error yet: submitting shows them all.
		canSubmitWhenInvalid: true,
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			const parsed = parse(value);
			if (!parsed.ok) {
				for (const error of parsed.errors) {
					if (error.field === "items") {
						setProblem(fieldMessage(error));
						continue;
					}
					const name = error.field;
					// Shown once: a change already reported this field.
					if (formApi.getFieldMeta(name)?.errorMap.onChange) continue;
					formApi.setFieldMeta(name, (meta) => ({
						...meta,
						errorMap: { ...meta.errorMap, onSubmit: fieldMessage(error) },
					}));
				}
				return;
			}
			const result = await resolve({ items: resolveItems, ...value });
			if (!result.success) {
				setProblem(result.error);
				return;
			}
			if (result.data.status !== "resolved") {
				const changed = new Set(result.data.invoicedWorkIds);
				setRefused({
					reason: result.data.status,
					items: items.filter((item) => changed.has(item.invoicedWorkId)),
				});
				return;
			}
			toast.success(
				t(
					"settings.billableTime.handOff.resolve.done",
					"{count, plural, one {# item resolved} other {# items resolved}}",
					{ count: result.data.resolved },
				),
			);
			onResolved();
		},
	});

	return (
		<form
			noValidate
			onSubmit={(event) => {
				// react-doctor-disable-next-line react-doctor/no-prevent-default
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
			className="grid gap-4"
		>
			<ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
				{items.map((item) => (
					<li key={item.invoicedWorkId} className="px-3 py-2">
						{itemLabel(item)}
					</li>
				))}
			</ul>
			<form.Field name="explanation" validators={validators("explanation")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("settings.billableTime.handOff.resolve.explanation", "Explanation")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="explanation"
								rows={4}
								maxLength={RESOLUTION_EXPLANATION_MAX_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="accountingReference" validators={validators("accountingReference")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t(
								"settings.billableTime.handOff.resolve.reference",
								"Accounting reference (optional)",
							)}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="accountingReference"
								autoComplete="off"
								maxLength={RESOLUTION_REFERENCE_MAX_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.billableTime.handOff.resolve.referenceHint",
								"For example the credit note number.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			{refused && (
				<Alert variant="destructive" role="alert">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription className="space-y-2">
						<p>
							{refused.reason === "released"
								? t(
										"settings.billableTime.handOff.resolve.released",
										"Nothing was resolved: the hand-off of this work was released, so its changes can no longer be resolved. Reload to see it.",
									)
								: t(
										"settings.billableTime.handOff.resolve.stale",
										"Nothing was resolved: this work changed since you opened it. Reload to review the changes.",
									)}
						</p>
						<ul className="list-disc pl-4">
							{refused.items.map((item) => (
								<li key={item.invoicedWorkId}>{itemLabel(item)}</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			)}
			{problem && (
				<Alert variant="destructive" role="alert">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>{problem}</AlertDescription>
				</Alert>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
							{t("common.cancel", "Cancel")}
						</Button>
						{refused ? (
							<Button type="button" onClick={onResolved}>
								{t("settings.billableTime.handOff.resolve.reload", "Reload")}
							</Button>
						) : (
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
								{t(
									"settings.billableTime.handOff.resolve.submit",
									"{count, plural, one {Resolve # item} other {Resolve # items}}",
									{ count: items.length },
								)}
							</Button>
						)}
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * Resolutions and earlier clears, newest first. `itemLabel` names each entry's
 * item when the list covers several items.
 */
export function ResolutionHistoryList({
	entries,
	itemLabel,
}: {
	entries: readonly ResolutionHistoryEntryView[];
	itemLabel?: (invoicedWorkId: string) => string | null;
}) {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const labels = useHandOffLabels();
	const when = (at: string) => formatInstant(parseInstant(at), display, "dateTimeMedium");
	const actor = (name: string | null) =>
		name ?? t("settings.billableTime.handOff.history.deletedUser", "a deleted user");
	return (
		<ol className="space-y-2 text-sm">
			{entries.map((entry) => {
				const item = itemLabel?.(entry.invoicedWorkId) ?? null;
				return (
					<li
						key={entry.kind === "resolution" ? entry.id : `${entry.invoicedWorkId}-${entry.at}`}
						className="space-y-1 rounded-md bg-muted/40 p-2"
					>
						{item && <p className="font-medium">{item}</p>}
						{entry.kind === "resolution" ? (
							<>
								<p className="text-muted-foreground">
									{t("settings.billableTime.handOff.history.resolved", "Resolved {at} by {actor}", {
										at: when(entry.at),
										actor: actor(entry.actorName),
									})}
								</p>
								<p className="whitespace-pre-wrap">{entry.explanation}</p>
								{entry.accountingReference && (
									<p>
										{t(
											"settings.billableTime.handOff.history.reference",
											"Reference: {reference}",
											{
												reference: entry.accountingReference,
											},
										)}
									</p>
								)}
								{entry.resolvedFields.length > 0 && (
									<span className="flex flex-wrap gap-1">
										{entry.resolvedFields.map((field) => (
											<Badge key={field} variant="outline">
												{labels.changedField(field)}
											</Badge>
										))}
									</span>
								)}
							</>
						) : (
							<>
								<p>
									{t(
										"settings.billableTime.handOff.history.legacy",
										"Cleared before resolutions were recorded",
									)}
								</p>
								<p className="text-muted-foreground">
									{t("settings.billableTime.handOff.history.legacyMeta", "{at} by {actor}", {
										at: when(entry.at),
										actor: actor(entry.actorName),
									})}
								</p>
							</>
						)}
					</li>
				);
			})}
		</ol>
	);
}
