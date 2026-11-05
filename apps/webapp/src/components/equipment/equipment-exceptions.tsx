"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import {
	comparePlainDates,
	parseInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentExceptionView,
} from "@/lib/organization/equipment/contracts";
import {
	actualDateError,
	quantityError,
} from "./equipment-handover-validation";
import {
	ActualDateField,
	ConditionField,
	equipmentSelectClass,
	NotesField,
	QuantityField,
	type SubmitHandover,
	useCommandIdentity,
} from "./equipment-handovers";

interface ExceptionFormActions {
	assignment: EquipmentAssignmentView;
	pending: boolean;
	submit: SubmitHandover;
	onCancel: () => void;
}

export function CloseReturnForm({
	assignment,
	pending,
	submit,
	onCancel,
}: ExceptionFormActions) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: {
			outcome: "lost" as "lost" | "waived",
			quantity: "1",
			reason: "",
		},
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const payload = {
				kind: "close_return" as const,
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				outcome: value.outcome,
				quantity: Number(value.quantity),
				reason: value.reason.trim(),
			};
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<form
			ref={element}
			noValidate
			className="min-w-0 space-y-4 break-words rounded-lg border bg-card p-4"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{t("settings.equipment.exception.closeTitle", "Close required return")}{" "}
				· <span translate="no">{assignment.identifier}</span>
			</h3>
			<p className="text-sm text-muted-foreground">
				{assignment.holderName} ·{" "}
				{t(
					"settings.equipment.exception.closeHelp",
					"Lost or waived quantities close the return obligation without recording physical receipt. The equipment stays in custody until actually received.",
				)}
			</p>
			<fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
				<form.Field name="outcome">
					{(field) => (
						<TFormItem>
							<TFormLabel required>
								{t("settings.equipment.exception.outcome", "Outcome")}
							</TFormLabel>
							<TFormControl>
								<select
									className={equipmentSelectClass}
									aria-label={t(
										"settings.equipment.exception.outcome",
										"Outcome",
									)}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
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
					name="quantity"
					validators={{
						onSubmit: ({ value }) =>
							quantityError(value, t) ??
							(Number(value) > assignment.outstandingQuantity
								? t(
										"settings.equipment.exception.quantityExcess",
										"Quantity exceeds the remaining balance for this action.",
									)
								: undefined),
					}}
				>
					{(field) => (
						<QuantityField
							field={field}
							maximum={assignment.outstandingQuantity}
							pending={pending}
							t={t}
						/>
					)}
				</form.Field>
			</fieldset>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						!value.trim()
							? t(
									"settings.equipment.exception.reasonRequired",
									"Enter a reason for closing this return.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel required>
							{t("settings.equipment.exception.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Textarea
								autoComplete="off"
								name={field.name}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								maxLength={4000}
								disabled={pending}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{t("settings.equipment.exception.save", "Record closure")}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={pending}
				>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}

export function ReceiveExceptionForm({
	assignment,
	exception,
	today,
	timezone,
	pending,
	submit,
	onCancel,
}: ExceptionFormActions & {
	exception: EquipmentExceptionView;
	today: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const maximum = exception.quantity - exception.receivedQuantity;
	const form = useForm({
		defaultValues: {
			quantity: "1",
			actualDate: "",
			condition: "unknown" as "unknown" | "good" | "worn" | "damaged",
			notes: "",
		},
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const payload = {
				kind: "receive_exception" as const,
				assignmentId: assignment.id,
				exceptionId: exception.id,
				expectedRevision: assignment.revision,
				...value,
				quantity: Number(value.quantity),
			};
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<form
			ref={element}
			noValidate
			className="min-w-0 space-y-4 break-words rounded-lg border bg-card p-4"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{exception.kind === "lost"
					? t(
							"settings.equipment.exception.recoveryTitle",
							"Recover lost equipment",
						)
					: t(
							"settings.equipment.exception.waivedReceiptTitle",
							"Receive waived equipment",
						)}{" "}
				· <span translate="no">{assignment.identifier}</span>
			</h3>
			<p className="text-sm text-muted-foreground">
				{assignment.holderName} · <span translate="no">{timezone}</span> ·{" "}
				{exception.reason}
			</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.exception.recoveryHelp",
					"Record actual receipt linked to this decision. Its reason and original quantity remain in history. Damaged items require separate clearance before reissue.",
				)}
			</p>
			<fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="quantity"
					validators={{
						onSubmit: ({ value }) => quantityError(value, t, maximum),
					}}
				>
					{(field) => (
						<QuantityField
							field={field}
							pending={pending}
							maximum={maximum}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field
					name="actualDate"
					validators={{
						onSubmit: ({ value }) => {
							const error = actualDateError(value, today, t);
							if (error) return error;
							const earliest = parseInstant(exception.recordedAt)
								.toZonedDateTimeISO(timezone)
								.toPlainDate();
							return comparePlainDates(parsePlainDate(value), earliest) < 0 ||
								(assignment.issue.actualDate &&
									comparePlainDates(
										parsePlainDate(value),
										parsePlainDate(assignment.issue.actualDate),
									) < 0)
								? t(
										"settings.equipment.exception.receiptBeforeDecision",
										"Receipt cannot precede the exception decision or issuance.",
									)
								: undefined;
						},
					}}
				>
					{(field) => (
						<ActualDateField
							field={field}
							today={today}
							pending={pending}
							t={t}
						/>
					)}
				</form.Field>
				<form.Field name="condition">
					{(field) => (
						<ConditionField
							value={field.state.value}
							onChange={field.handleChange}
							disabled={pending}
							t={t}
						/>
					)}
				</form.Field>
			</fieldset>
			<form.Field name="notes">
				{(field) => <NotesField field={field} pending={pending} t={t} />}
			</form.Field>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{exception.kind === "lost"
						? t(
								"settings.equipment.exception.confirmRecovery",
								"Confirm recovery",
							)
						: t(
								"settings.equipment.exception.confirmWaivedReceipt",
								"Confirm waived receipt",
							)}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={pending}
				>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}

export function EquipmentExceptionTotals({
	assignment,
}: {
	assignment: EquipmentAssignmentView;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const totals = [
		{
			label: t("settings.equipment.exception.lostQuantity", "Lost quantity"),
			value: assignment.lostQuantity ?? 0,
		},
		{
			label: t(
				"settings.equipment.exception.waivedQuantity",
				"Return-waived quantity",
			),
			value: assignment.waivedQuantity ?? 0,
		},
		{
			label: t(
				"settings.equipment.exception.recoveredQuantity",
				"Recovered quantity",
			),
			value: assignment.recoveredQuantity ?? 0,
		},
	];
	if (!assignment.exceptions?.length) return null;
	return (
		<div className="space-y-2">
			<dl className="grid gap-3 text-sm sm:grid-cols-3">
				{totals.map((total) => (
					<div key={total.label}>
						<dt className="text-muted-foreground">{total.label}</dt>
						<dd className="tabular-nums">
							{total.value.toLocaleString(locale)}
						</dd>
					</div>
				))}
			</dl>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.exception.totalsHelp",
					"Recovered quantities are included in physical receipts. Lost and waived totals preserve the original decisions.",
				)}
			</p>
		</div>
	);
}

export function EquipmentExceptionEvidence({
	exception,
	timezone,
	pending,
	onReceive,
}: {
	exception: EquipmentExceptionView;
	timezone: string;
	pending: boolean;
	onReceive: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<li className="space-y-1 break-words text-sm">
			<p className="font-medium">
				{exception.kind === "lost"
					? t("settings.equipment.exception.lost", "Lost")
					: t("settings.equipment.exception.waived", "Return waived")}{" "}
				· {t("settings.equipment.handover.quantity", "Quantity")}:{" "}
				{exception.quantity.toLocaleString(locale)}
			</p>
			<p className="whitespace-pre-wrap">{exception.reason}</p>
			<p className="text-muted-foreground">
				{t("settings.equipment.custody.recordedBy", "Recorded by")}{" "}
				{exception.actorName ??
					t("settings.equipment.custody.removedActor", "Removed account")}{" "}
				·{" "}
				<time dateTime={exception.recordedAt}>
					{parseInstant(exception.recordedAt)
						.toZonedDateTimeISO(timezone)
						.toLocaleString(locale, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
				</time>{" "}
				<span translate="no">{timezone}</span>
			</p>
			<p className="tabular-nums">
				{exception.kind === "lost"
					? t(
							"settings.equipment.exception.recoveredQuantity",
							"Recovered quantity",
						)
					: t(
							"settings.equipment.exception.waivedReceivedQuantity",
							"Physically received after waiver",
						)}
				: {exception.receivedQuantity.toLocaleString(locale)}
			</p>
			{exception.canReceive ? (
				<Button variant="outline" disabled={pending} onClick={onReceive}>
					{exception.kind === "lost"
						? t("settings.equipment.exception.recover", "Record recovery")
						: t(
								"settings.equipment.exception.receiveWaived",
								"Record waived receipt",
							)}
				</Button>
			) : null}
		</li>
	);
}
