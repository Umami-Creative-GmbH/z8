"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import {
	comparePlainDates,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentCondition,
	EquipmentView,
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

function useTransferEquipmentForm({
	assignment,
	submit,
}: {
	assignment: EquipmentAssignmentView;
	submit: SubmitHandover;
}) {
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const maximum = assignment.quantity - assignment.physicallyReceivedQuantity;
	const form = useForm({
		defaultValues: {
			employeeId: "",
			quantity: "1",
			receipt: {
				actualDate: "",
				condition: "unknown" as EquipmentCondition,
				notes: "",
			},
			issue: {
				actualDate: "",
				condition: "unknown" as EquipmentCondition,
				notes: "",
				returnRequired: assignment.transfer?.defaultReturnRequired ?? true,
				explicitDeadline: "",
			},
		},
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			if (!assignment.transfer) return;
			const payload = {
				kind: "transfer_equipment" as const,
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				expectedIssuanceRevision: assignment.transfer.expectedIssuanceRevision,
				employeeId: value.employeeId,
				quantity: Number(value.quantity),
				receipt: value.receipt,
				issue: {
					...value.issue,
					explicitDeadline:
						value.issue.returnRequired && value.issue.explicitDeadline
							? value.issue.explicitDeadline
							: null,
				},
			};
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return { form, element, maximum };
}

export function TransferEquipmentForm({
	assignment,
	data,
	submit,
	pending,
	onCancel,
}: {
	assignment: EquipmentAssignmentView;
	data: EquipmentView;
	submit: SubmitHandover;
	pending: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const { form, element, maximum } = useTransferEquipmentForm({
		assignment,
		submit,
	});

	return (
		<form
			ref={element}
			noValidate
			className="space-y-4 rounded-lg border bg-card p-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{t("settings.equipment.transfer.title", "Transfer equipment")}
			</h3>
			<p className="break-words text-sm">
				<span translate="no">{assignment.identifier}</span> ·{" "}
				{assignment.holderName}
			</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.transfer.help",
					"Confirm physical receipt and a new issuance together. Both handovers are saved or neither is saved. Dates use the organization’s timezone.",
				)}{" "}
				<span translate="no">{data.timezone}</span>
			</p>
			<fieldset
				disabled={pending}
				className="min-w-0 space-y-4 rounded-md border p-3"
			>
				<legend className="px-1 text-sm font-medium">
					{t(
						"settings.equipment.transfer.receipt",
						"Receipt from current holder",
					)}
				</legend>
				{assignment.trackingMode === "quantity" ? (
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
				) : null}
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field
						name="receipt.actualDate"
						validators={{
							onSubmit: ({ value }) =>
								actualDateError(value, data.today, t) ??
								(comparePlainDates(
									parsePlainDate(value),
									parsePlainDate(assignment.issue.actualDate),
								) < 0
									? t(
											"settings.equipment.handover.receiptBeforeIssue",
											"Receipt cannot precede the recorded issuance.",
										)
									: undefined),
						}}
					>
						{(field) => (
							<ActualDateField
								field={field}
								today={data.today}
								pending={pending}
								t={t}
							/>
						)}
					</form.Field>
					<form.Field name="receipt.condition">
						{(field) => (
							<ConditionField
								value={field.state.value}
								onChange={field.handleChange}
								disabled={pending}
								t={t}
							/>
						)}
					</form.Field>
				</div>
				<form.Field name="receipt.notes">
					{(field) => <NotesField field={field} pending={pending} t={t} />}
				</form.Field>
				{assignment.trackingMode === "individual" ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.equipment.transfer.damagedHelp",
							"Damaged individual equipment must be received and separately cleared before a new issuance. Record receipt on its own if clearance is needed.",
						)}
					</p>
				) : null}
			</fieldset>
			<fieldset
				disabled={pending}
				className="min-w-0 space-y-4 rounded-md border p-3"
			>
				<legend className="px-1 text-sm font-medium">
					{t("settings.equipment.transfer.issue", "New issuance")}
				</legend>
				<form.Field
					name="employeeId"
					validators={{
						onSubmit: ({ value }) =>
							!value
								? t(
										"settings.equipment.handover.employeeRequired",
										"Select a current employee.",
									)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel required>
								{t("settings.equipment.handover.employee", "Current employee")}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<select
									aria-label={t(
										"settings.equipment.handover.employee",
										"Current employee",
									)}
									name={field.name}
									className={equipmentSelectClass}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								>
									<option value="">
										{t(
											"settings.equipment.handover.selectEmployee",
											"Select a current employee…",
										)}
									</option>
									{data.employees
										.filter(
											(employee) =>
												!employee.former &&
												employee.id !== assignment.employeeId,
										)
										.map((employee) => (
											<option key={employee.id} value={employee.id}>
												{employee.name}
											</option>
										))}
								</select>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field
						name="issue.actualDate"
						validators={{
							onSubmit: ({ value }) => {
								const invalid = actualDateError(value, data.today, t);
								if (invalid) return invalid;
								const receiptDate = form.getFieldValue("receipt.actualDate");
								if (
									!actualDateError(receiptDate, data.today, t) &&
									comparePlainDates(
										parsePlainDate(value),
										parsePlainDate(receiptDate),
									) < 0
								)
									return t(
										"settings.equipment.transfer.issueBeforeReceipt",
										"New issuance cannot precede physical receipt.",
									);
								return undefined;
							},
						}}
					>
						{(field) => (
							<ActualDateField
								field={field}
								today={data.today}
								pending={pending}
								t={t}
							/>
						)}
					</form.Field>
					<form.Field name="issue.condition">
						{(field) => (
							<ConditionField
								value={field.state.value}
								onChange={field.handleChange}
								disabled={pending}
								t={t}
							/>
						)}
					</form.Field>
				</div>
				<TransferReturnTerms form={form} />
				<form.Field name="issue.notes">
					{(field) => <NotesField field={field} pending={pending} t={t} />}
				</form.Field>
			</fieldset>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{pending
						? t("settings.equipment.handover.saving", "Saving…")
						: t(
								"settings.equipment.transfer.confirm",
								"Confirm receipt and issuance",
							)}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}

function TransferReturnTerms({
	form,
}: {
	form: ReturnType<typeof useTransferEquipmentForm>["form"];
}) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field name="issue.returnRequired">
				{(field) => (
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name={field.name}
							autoComplete="off"
							checked={field.state.value}
							onChange={(event) => {
								field.handleChange(event.target.checked);
								if (!event.target.checked)
									form.setFieldValue("issue.explicitDeadline", "");
							}}
						/>
						{t("settings.equipment.handover.returnRequired", "Return required")}
					</label>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.issue.returnRequired}>
				{(required) =>
					required ? (
						<form.Field
							name="issue.explicitDeadline"
							validators={{
								onSubmit: ({ value }) => {
									if (!value) return undefined;
									try {
										const deadline = parsePlainDate(value);
										const date = form.getFieldValue("issue.actualDate");
										if (
											date &&
											comparePlainDates(deadline, parsePlainDate(date)) < 0
										)
											return t(
												"settings.equipment.handover.deadlineInvalid",
												"The return deadline must be on or after the handover date.",
											);
									} catch {
										return t(
											"settings.equipment.handover.dateInvalid",
											"Enter a valid calendar date.",
										);
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t(
											"settings.equipment.handover.deadline",
											"Explicit return deadline (optional)",
										)}
									</TFormLabel>
									<TFormControl hasError={field.state.meta.errors.length > 0}>
										<Input
											type="date"
											name={field.name}
											autoComplete="off"
											value={field.state.value}
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
					) : (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.equipment.handover.keepHelp",
								"Issued to keep: no deadline or return obligation. Equipment remains held until physically received back.",
							)}
						</p>
					)
				}
			</form.Subscribe>
		</>
	);
}
