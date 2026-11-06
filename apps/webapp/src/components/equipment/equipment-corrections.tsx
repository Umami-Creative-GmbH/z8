"use client";
import { IconPencil } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentCondition,
	EquipmentCorrectionView,
	EquipmentExceptionView,
	EquipmentHandoverView,
} from "@/lib/organization/equipment/contracts";
import { conditionLabel, type EquipmentTranslate } from "./equipment-copy";
import {
	type CorrectionTarget,
	correctionTargets,
} from "./equipment-correction-targets";
import { actualDateError } from "./equipment-handover-validation";
import {
	ActualDateField,
	ConditionField,
	EquipmentFormPanel,
	equipmentSelectClass,
	NotesField,
	type SubmitHandover,
	useCommandIdentity,
} from "./equipment-handovers";

export type { CorrectionTarget } from "./equipment-correction-targets";

type Selection = CorrectionTarget | null;
interface Actions {
	pending: boolean;
	submit: SubmitHandover;
	onCancel: () => void;
}
interface Field {
	name: string;
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
}
function TextField({
	field,
	label,
	multiline = false,
}: {
	field: Field;
	label: string;
	multiline?: boolean;
}) {
	const props = {
		name: field.name,
		value: field.state.value,
		onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
			field.handleChange(e.target.value),
		onBlur: field.handleBlur,
		maxLength: 4000,
		autoComplete: "off",
	};
	return (
		<TFormItem>
			<TFormLabel required>{label}</TFormLabel>
			<TFormControl hasError={field.state.meta.errors.length > 0}>
				{multiline ? <Textarea {...props} /> : <Input {...props} />}
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
function CountField({
	field,
	minimum,
	maximum = 2147483647,
	t,
}: {
	field: Field;
	minimum: number;
	maximum?: number;
	t: EquipmentTranslate;
}) {
	return (
		<TFormItem>
			<TFormLabel required>
				{t("settings.equipment.handover.quantity", "Quantity")}
			</TFormLabel>
			<TFormControl hasError={field.state.meta.errors.length > 0}>
				<Input
					name={field.name}
					type="number"
					inputMode="numeric"
					autoComplete="off"
					min={minimum}
					max={maximum}
					step={1}
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={field.handleBlur}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
const countError = (value: string, min: number, t: EquipmentTranslate) =>
	!/^\d+$/.test(value) ||
	!Number.isSafeInteger(Number(value)) ||
	Number(value) < min ||
	Number(value) > 2147483647
		? t(
				"settings.equipment.correction.validQuantity",
				"Enter a whole quantity within the allowed range.",
			)
		: undefined;
const reasonError = (value: string, t: EquipmentTranslate) =>
	!value.trim()
		? t(
				"settings.equipment.correction.reasonRequired",
				"Enter a reason for this amendment.",
			)
		: undefined;
function FormFrame({
	children,
	title,
	assignment,
	pending,
	onCancel,
	onSubmit,
	element,
}: {
	children: ReactNode;
	title: string;
	assignment: EquipmentAssignmentView;
	pending: boolean;
	onCancel: () => void;
	onSubmit: () => void;
	element: React.RefObject<HTMLFormElement | null>;
}) {
	const { t } = useTranslate();
	return (
		<EquipmentFormPanel
			element={element}
			pending={pending}
			onCancel={onCancel}
			onSubmit={onSubmit}
			title={title}
			description={
				<>
					<span translate="no">{assignment.identifier}</span> ·{" "}
					{assignment.holderName}
				</>
			}
			submitLabel={t("settings.equipment.correction.save", "Save amendment")}
		>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.correction.help",
					"The original evidence is kept. Every amendment records your reason, identity and entry time. Zero receipt quantity reverses mistaken receipt; it does not confirm a return.",
				)}
			</p>
			<fieldset className="min-w-0 space-y-4" disabled={pending}>
				{children}
			</fieldset>
		</EquipmentFormPanel>
	);
}
function useInvalidFocus() {
	const element = useRef<HTMLFormElement>(null);
	return {
		element,
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
	};
}
export function HandoverCorrectionForm({
	assignment,
	handover,
	kind,
	today,
	...actions
}: {
	assignment: EquipmentAssignmentView;
	handover: EquipmentHandoverView;
	kind: "issue" | "receipt";
	today: string;
} & Actions) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const { element, onSubmitInvalid } = useInvalidFocus();
	const form = useForm({
		defaultValues: {
			quantity: String(handover.quantity),
			actualDate: handover.actualDate ?? "",
			unknownDate: handover.actualDate === null,
			condition: handover.condition,
			notes: handover.notes ?? "",
			returnRequired: assignment.returnRequired,
			explicitDeadline: assignment.explicitDeadline ?? "",
			reason: "",
		},
		onSubmitInvalid,
		onSubmit: async ({ value }) => {
			const evidence = {
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				quantity: Number(value.quantity),
				condition: value.condition,
				notes: value.notes,
				reason: value.reason.trim(),
			};
			const payload =
				kind === "issue"
					? {
							...evidence,
							kind: "correct_issue" as const,
							actualDate: value.unknownDate ? null : value.actualDate,
							returnRequired: value.returnRequired,
							explicitDeadline:
								value.returnRequired && value.explicitDeadline
									? value.explicitDeadline
									: null,
							employmentPeriodId: assignment.employmentPeriodId,
						}
					: {
							...evidence,
							kind: "correct_receipt" as const,
							handoverId: handover.id,
							actualDate: value.actualDate,
						};
			await actions.submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<FormFrame
			{...actions}
			assignment={assignment}
			title={
				kind === "issue"
					? t("settings.equipment.correction.issue", "Correct issuance")
					: t("settings.equipment.correction.receipt", "Correct receipt")
			}
			element={element}
			onSubmit={() => void form.handleSubmit()}
		>
			<form.Field
				name="quantity"
				validators={{
					onSubmit: ({ value }) =>
						countError(value, kind === "receipt" ? 0 : 1, t) ??
						(assignment.trackingMode === "individual" && Number(value) > 1
							? t(
									"settings.equipment.correction.individualQuantity",
									"An identified item has quantity one.",
								)
							: undefined),
				}}
			>
				{(field) => (
					<CountField
						field={field}
						minimum={kind === "receipt" ? 0 : 1}
						maximum={assignment.trackingMode === "individual" ? 1 : undefined}
						t={t}
					/>
				)}
			</form.Field>
			{handover.historical && kind === "issue" ? (
				<form.Field name="unknownDate">
					{(field) => (
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name={field.name}
								checked={field.state.value}
								onChange={(e) => field.handleChange(e.target.checked)}
							/>
							{t(
								"settings.equipment.historical.dateUnknown",
								"Actual issue date unknown",
							)}
						</label>
					)}
				</form.Field>
			) : null}
			<form.Subscribe selector={(s) => s.values.unknownDate}>
				{(unknown) =>
					!unknown ? (
						<form.Field
							name="actualDate"
							validators={{
								onSubmit: ({ value }) => actualDateError(value, today, t),
							}}
						>
							{(field) => (
								<ActualDateField
									field={field}
									today={today}
									pending={actions.pending}
									t={t}
								/>
							)}
						</form.Field>
					) : null
				}
			</form.Subscribe>
			<form.Field name="condition">
				{(field) => (
					<ConditionField
						value={field.state.value}
						onChange={field.handleChange}
						disabled={actions.pending}
						t={t}
					/>
				)}
			</form.Field>
			<form.Field name="notes">
				{(field) => (
					<NotesField field={field} pending={actions.pending} t={t} />
				)}
			</form.Field>
			{kind === "issue" ? (
				<>
					<form.Field name="returnRequired">
						{(field) => (
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									name={field.name}
									checked={field.state.value}
									disabled={assignment.returnRequired}
									onChange={(e) => field.handleChange(e.target.checked)}
								/>
								{t(
									"settings.equipment.handover.returnRequired",
									"Return required",
								)}
							</label>
						)}
					</form.Field>
					{assignment.returnRequired ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.equipment.correction.waiverHelp",
								"Permission to keep required equipment uses the owner/admin waiver action. This amendment keeps the return requirement.",
							)}
						</p>
					) : null}
					<form.Subscribe selector={(s) => s.values.returnRequired}>
						{(required) =>
							required ? (
								<form.Field name="explicitDeadline">
									{(field) => (
										<TFormItem>
											<TFormLabel>
												{t(
													"settings.equipment.handover.deadline",
													"Explicit return deadline (optional)",
												)}
											</TFormLabel>
											<TFormControl>
												<Input
													type="date"
													name={field.name}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
										</TFormItem>
									)}
								</form.Field>
							) : null
						}
					</form.Subscribe>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.equipment.correction.lineage",
							"The holder, item and original employment context remain attached to this assignment.",
						)}
					</p>
				</>
			) : null}
			<form.Field
				name="reason"
				validators={{ onSubmit: ({ value }) => reasonError(value, t) }}
			>
				{(field) => (
					<TextField
						field={field}
						label={t(
							"settings.equipment.correction.reason",
							"Amendment reason",
						)}
						multiline
					/>
				)}
			</form.Field>
		</FormFrame>
	);
}
function ExceptionCorrectionForm({
	assignment,
	exception,
	...actions
}: {
	assignment: EquipmentAssignmentView;
	exception: EquipmentExceptionView;
} & Actions) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const { element, onSubmitInvalid } = useInvalidFocus();
	const form = useForm({
		defaultValues: {
			quantity: String(exception.quantity),
			outcome: exception.kind,
			decisionReason: exception.reason,
			reason: "",
		},
		onSubmitInvalid,
		onSubmit: async ({ value }) => {
			const payload = {
				kind: "correct_exception" as const,
				assignmentId: assignment.id,
				exceptionId: exception.id,
				expectedRevision: assignment.revision,
				quantity: Number(value.quantity),
				outcome: value.outcome,
				decisionReason: value.decisionReason,
				reason: value.reason.trim(),
			};
			await actions.submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<FormFrame
			{...actions}
			assignment={assignment}
			title={t("settings.equipment.correction.exception", "Correct exception")}
			element={element}
			onSubmit={() => void form.handleSubmit()}
		>
			<p className="text-sm">
				{t(
					"settings.equipment.correction.exceptionHelp",
					"Enter the effective remaining decision quantity. Zero reverses it fully. Existing physical recoveries must remain covered.",
				)}
			</p>
			<form.Field
				name="quantity"
				validators={{ onSubmit: ({ value }) => countError(value, 0, t) }}
			>
				{(field) => <CountField field={field} minimum={0} t={t} />}
			</form.Field>
			<form.Field name="outcome">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.equipment.exception.outcome", "Outcome")}
						</TFormLabel>
						<TFormControl>
							<select
								aria-label={t(
									"settings.equipment.exception.outcome",
									"Outcome",
								)}
								className={equipmentSelectClass}
								name={field.name}
								value={field.state.value}
								onChange={(e) =>
									field.handleChange(
										e.target.value === "lost" ? "lost" : "waived",
									)
								}
							>
								<option value="lost">
									{t("settings.equipment.exception.lost", "Lost")}
								</option>
								<option value="waived">
									{t("settings.equipment.exception.waived", "Return waived")}
								</option>
							</select>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="decisionReason"
				validators={{ onSubmit: ({ value }) => reasonError(value, t) }}
			>
				{(field) => (
					<TextField
						field={field}
						label={t(
							"settings.equipment.correction.decisionReason",
							"Effective decision reason",
						)}
						multiline
					/>
				)}
			</form.Field>
			<form.Field
				name="reason"
				validators={{ onSubmit: ({ value }) => reasonError(value, t) }}
			>
				{(field) => (
					<TextField
						field={field}
						label={t(
							"settings.equipment.correction.reason",
							"Amendment reason",
						)}
						multiline
					/>
				)}
			</form.Field>
		</FormFrame>
	);
}
function TransferCorrectionForm({
	assignment,
	receipt,
	transfer,
	today,
	...actions
}: {
	assignment: EquipmentAssignmentView;
	receipt: EquipmentHandoverView;
	transfer: NonNullable<EquipmentAssignmentView["correctionTransfers"]>[number];
	today: string;
} & Actions) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const { element, onSubmitInvalid } = useInvalidFocus();
	const form = useForm({
		defaultValues: {
			quantity: String(receipt.quantity),
			receiptDate: receipt.actualDate ?? "",
			issueDate: transfer.issue.actualDate ?? "",
			receiptCondition: receipt.condition,
			issueCondition: transfer.issue.condition,
			receiptNotes: receipt.notes ?? "",
			issueNotes: transfer.issue.notes ?? "",
			reason: "",
		},
		onSubmitInvalid,
		onSubmit: async ({ value }) => {
			const payload = {
				kind: "correct_transfer" as const,
				assignmentId: assignment.id,
				destinationAssignmentId: transfer.destinationAssignmentId,
				expectedRevision: assignment.revision,
				expectedDestinationRevision: transfer.expectedDestinationRevision,
				quantity: Number(value.quantity),
				receipt: {
					actualDate: value.receiptDate,
					condition: value.receiptCondition,
					notes: value.receiptNotes,
				},
				issue: {
					actualDate: value.issueDate,
					condition: value.issueCondition,
					notes: value.issueNotes,
				},
				reason: value.reason.trim(),
			};
			await actions.submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<FormFrame
			{...actions}
			assignment={assignment}
			title={t("settings.equipment.correction.transfer", "Correct transfer")}
			element={element}
			onSubmit={() => void form.handleSubmit()}
		>
			<p className="text-sm">
				{t(
					"settings.equipment.correction.transferHelp",
					"Both linked handovers are amended together. Later receipts, custody and exception decisions must still fit the resulting transfer.",
				)}
			</p>
			<form.Field
				name="quantity"
				validators={{ onSubmit: ({ value }) => countError(value, 1, t) }}
			>
				{(field) => (
					<CountField
						field={field}
						minimum={1}
						maximum={assignment.trackingMode === "individual" ? 1 : undefined}
						t={t}
					/>
				)}
			</form.Field>
			<fieldset className="space-y-3">
				<legend className="text-sm font-medium">
					{t(
						"settings.equipment.correction.sourceReceipt",
						"Source physical receipt",
					)}
				</legend>
				<form.Field
					name="receiptDate"
					validators={{
						onSubmit: ({ value }) => actualDateError(value, today, t),
					}}
				>
					{(field) => (
						<ActualDateField
							field={field}
							today={today}
							pending={actions.pending}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field name="receiptCondition">
					{(field) => (
						<ConditionField
							value={field.state.value}
							onChange={field.handleChange}
							disabled={actions.pending}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field name="receiptNotes">
					{(field) => (
						<NotesField field={field} pending={actions.pending} t={t} />
					)}
				</form.Field>
			</fieldset>
			<fieldset className="space-y-3">
				<legend className="text-sm font-medium">
					{t(
						"settings.equipment.correction.destinationIssue",
						"Destination issuance",
					)}
				</legend>
				<form.Field
					name="issueDate"
					validators={{
						onSubmit: ({ value }) => actualDateError(value, today, t),
					}}
				>
					{(field) => (
						<ActualDateField
							field={field}
							today={today}
							pending={actions.pending}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field name="issueCondition">
					{(field) => (
						<ConditionField
							value={field.state.value}
							onChange={field.handleChange}
							disabled={actions.pending}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field name="issueNotes">
					{(field) => (
						<NotesField field={field} pending={actions.pending} t={t} />
					)}
				</form.Field>
			</fieldset>
			<form.Field
				name="reason"
				validators={{ onSubmit: ({ value }) => reasonError(value, t) }}
			>
				{(field) => (
					<TextField
						field={field}
						label={t(
							"settings.equipment.correction.reason",
							"Amendment reason",
						)}
						multiline
					/>
				)}
			</form.Field>
		</FormFrame>
	);
}
/** "Correct a record": one entry per record the reader may amend. */
export function CorrectionMenu({
	assignment,
	disabled,
	onSelect,
}: {
	assignment: EquipmentAssignmentView;
	disabled: boolean;
	onSelect: (target: CorrectionTarget) => void;
}) {
	const { t } = useTranslate();
	const targets = correctionTargets(assignment);
	if (!targets.length) return null;
	const label = ({ target, index }: (typeof targets)[number]) => {
		switch (target.kind) {
			case "issue":
				return t("settings.equipment.correction.issue", "Correct issuance");
			case "receipt":
				return `${t("settings.equipment.correction.receipt", "Correct receipt")} ${index}`;
			case "exception":
				return `${t("settings.equipment.correction.exception", "Correct exception")} ${index}`;
			case "transfer":
				return `${t("settings.equipment.correction.transfer", "Correct transfer")} ${index}`;
		}
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" disabled={disabled}>
					<IconPencil className="size-4" aria-hidden="true" />
					{t("settings.equipment.correction.open", "Correct a record")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{targets.map((entry) => (
					<DropdownMenuItem
						key={`${entry.target.kind}:${"id" in entry.target ? entry.target.id : ""}`}
						onClick={() => onSelect(entry.target)}
					>
						{label(entry)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The amendment form for one target; renders inside an action panel. */
export function CorrectionEditor({
	assignment,
	selection,
	today,
	...actions
}: {
	assignment: EquipmentAssignmentView;
	selection: Selection;
	today: string;
} & Actions) {
	if (!selection) return null;
	switch (selection.kind) {
		case "issue":
			return assignment.canCorrect ? (
				<HandoverCorrectionForm
					key={`issue:${assignment.revision}`}
					assignment={assignment}
					handover={assignment.issue}
					kind="issue"
					today={today}
					{...actions}
				/>
			) : null;
		case "receipt": {
			const receipt = assignment.receipts.find((h) => h.id === selection.id);
			return receipt && assignment.canCorrectReceipt ? (
				<HandoverCorrectionForm
					key={`${receipt.id}:${assignment.revision}`}
					assignment={assignment}
					handover={receipt}
					kind="receipt"
					today={today}
					{...actions}
				/>
			) : null;
		}
		case "exception": {
			const exception = assignment.exceptions?.find(
				(e) => e.id === selection.id,
			);
			return exception && assignment.canCorrectException ? (
				<ExceptionCorrectionForm
					key={`${exception.id}:${assignment.revision}`}
					assignment={assignment}
					exception={exception}
					{...actions}
				/>
			) : null;
		}
		case "transfer": {
			const transfer = assignment.correctionTransfers?.find(
				(e) => e.destinationAssignmentId === selection.id,
			);
			const receipt = assignment.receipts.find(
				(h) => h.id === transfer?.receiptId,
			);
			return transfer && receipt && assignment.canCorrectReceipt ? (
				<TransferCorrectionForm
					key={`${transfer.destinationAssignmentId}:${assignment.revision}:${transfer.expectedDestinationRevision}`}
					assignment={assignment}
					transfer={transfer}
					receipt={receipt}
					today={today}
					{...actions}
				/>
			) : null;
		}
	}
}

/** Every amendment with its reason, author and the before/after values. */
export function CorrectionHistory({
	corrections,
	timezone,
}: {
	corrections: EquipmentCorrectionView[];
	timezone: string;
}) {
	return (
		<ol className="space-y-6">
			{corrections.map((c) => (
				<CorrectionEvidence key={c.id} correction={c} timezone={timezone} />
			))}
		</ol>
	);
}
function CorrectionEvidence({
	correction,
	timezone,
}: {
	correction: EquipmentCorrectionView;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const labels: Record<string, string> = {
		quantity: t("settings.equipment.handover.quantity", "Quantity"),
		actualDate: t(
			"settings.equipment.handover.actualDate",
			"Actual handover date",
		),
		condition: t("settings.equipment.handover.condition", "Condition"),
		notes: t("settings.equipment.handover.notes", "Notes (optional)"),
		returnRequired: t(
			"settings.equipment.handover.returnRequired",
			"Return required",
		),
		explicitDeadline: t(
			"settings.equipment.custody.explicitDeadline",
			"Explicit return deadline",
		),
		employmentPeriodId: t(
			"settings.equipment.correction.employmentContext",
			"Original employment context",
		),
		departureDeadline: t(
			"settings.equipment.custody.departureDeadline",
			"Departure return deadline",
		),
		departureId: t(
			"settings.equipment.correction.departureContext",
			"Original departure context",
		),
		deactivationId: t(
			"settings.equipment.correction.deactivationContext",
			"Original deactivation context",
		),
		kind: t("settings.equipment.exception.outcome", "Outcome"),
		reason: t(
			"settings.equipment.correction.decisionReason",
			"Effective decision reason",
		),
	};
	function value(
		field: string,
		v: string | number | boolean | null | undefined,
	) {
		if (v === null || v === undefined || v === "")
			return t("settings.equipment.correction.unknown", "Unknown / none");
		if (typeof v === "boolean")
			return v ? t("common.yes", "Yes") : t("common.no", "No");
		if (field === "condition")
			return conditionLabel(v as EquipmentCondition, t);
		if (field === "kind")
			return v === "lost"
				? t("settings.equipment.exception.lost", "Lost")
				: t("settings.equipment.exception.waived", "Return waived");
		if (typeof v === "number") return v.toLocaleString(locale);
		if (
			field === "actualDate" ||
			field === "explicitDeadline" ||
			field === "departureDeadline"
		)
			return parsePlainDate(String(v)).toLocaleString(locale, {
				dateStyle: "medium",
			});
		if (field === "employmentPeriodId")
			return t(
				"settings.equipment.correction.originalContext",
				"Preserved original employment",
			);
		if (field === "departureId" || field === "deactivationId")
			return t(
				"settings.equipment.correction.originalEnding",
				"Preserved original ending",
			);
		return String(v);
	}
	return (
		<li className="space-y-2 break-words text-sm">
			<p className="font-medium whitespace-pre-wrap">{correction.reason}</p>
			<p className="text-muted-foreground">
				{correction.actorName ??
					t("settings.equipment.custody.removedActor", "Removed account")}{" "}
				·{" "}
				<time dateTime={correction.recordedAt}>
					{parseInstant(correction.recordedAt)
						.toZonedDateTimeISO(timezone)
						.toLocaleString(locale, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
				</time>{" "}
				· <span translate="no">{timezone}</span>
			</p>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<caption className="sr-only">
						{t(
							"settings.equipment.correction.history",
							"Original records and amendments",
						)}
					</caption>
					<thead>
						<tr>
							<th scope="col" className="p-2">
								{t("settings.equipment.correction.field", "Field")}
							</th>
							<th scope="col" className="p-2">
								{t(
									"settings.equipment.correction.before",
									"Previously recorded",
								)}
							</th>
							<th scope="col" className="p-2">
								{t("settings.equipment.correction.after", "Amended values")}
							</th>
						</tr>
					</thead>
					<tbody>
						{Object.keys(correction.before).map((field) => (
							<tr key={field} className="border-t">
								<th scope="row" className="p-2 font-medium">
									{labels[field] ?? field}
								</th>
								<td className="p-2 whitespace-pre-wrap">
									{value(field, correction.before[field])}
								</td>
								<td className="p-2 whitespace-pre-wrap">
									{value(field, correction.after[field])}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</li>
	);
}
