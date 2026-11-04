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
import { Textarea } from "@/components/ui/textarea";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type EquipmentAssignmentView,
	type EquipmentChange,
	type EquipmentCondition,
	type EquipmentView,
	equipmentConditionSchema,
} from "@/lib/organization/equipment/contracts";
import { conditionLabel, type EquipmentTranslate } from "./equipment-copy";

export const equipmentSelectClass =
	"h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export type SubmitHandover = (change: EquipmentChange) => Promise<void>;
interface HandoverActions {
	submit: SubmitHandover;
	pending: boolean;
	onCancel: () => void;
}
const handoverDefaults = {
	actualDate: "",
	condition: "unknown" as EquipmentCondition,
	notes: "",
};

/** Preserve identity on uncertain retries; editing an unsaved payload starts a new command. */
function useCommandIdentity() {
	const request = useRef<{ payload: string; id: string } | null>(null);
	return (payload: unknown) => {
		const serialized = JSON.stringify(payload);
		if (request.current?.payload !== serialized)
			request.current = { payload: serialized, id: crypto.randomUUID() };
		return request.current.id;
	};
}
function actualDateError(value: string, today: string, t: EquipmentTranslate) {
	if (!value)
		return t(
			"settings.equipment.handover.dateRequired",
			"Enter the actual handover date.",
		);
	try {
		const date = parsePlainDate(value);
		if (date.toString() > today)
			return t(
				"settings.equipment.handover.futureDate",
				"The actual handover date cannot be in the future in the organization’s timezone.",
			);
	} catch {
		return t(
			"settings.equipment.handover.dateInvalid",
			"Enter a valid calendar date.",
		);
	}
	return undefined;
}
interface StringField {
	name: string;
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
}
function ActualDateField({
	field,
	today,
	pending,
	t,
}: {
	field: StringField;
	today: string;
	pending: boolean;
	t: EquipmentTranslate;
}) {
	return (
		<TFormItem>
			<TFormLabel required>
				{t("settings.equipment.handover.actualDate", "Actual handover date")}
			</TFormLabel>
			<TFormControl hasError={field.state.meta.errors.length > 0}>
				<Input
					type="date"
					name={field.name}
					autoComplete="off"
					max={today}
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={field.handleBlur}
					disabled={pending}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
function ConditionField({
	value,
	onChange,
	disabled,
	t,
}: {
	value: EquipmentCondition;
	onChange: (value: EquipmentCondition) => void;
	disabled: boolean;
	t: EquipmentTranslate;
}) {
	return (
		<TFormItem>
			<TFormLabel>
				{t("settings.equipment.handover.condition", "Condition")}
			</TFormLabel>
			<TFormControl>
				<select
					name="condition"
					aria-label={t("settings.equipment.handover.condition", "Condition")}
					className={equipmentSelectClass}
					value={value}
					onChange={(e) =>
						onChange(equipmentConditionSchema.parse(e.target.value))
					}
					disabled={disabled}
				>
					{equipmentConditionSchema.options.map((condition) => (
						<option key={condition} value={condition}>
							{conditionLabel(condition, t)}
						</option>
					))}
				</select>
			</TFormControl>
		</TFormItem>
	);
}
function NotesField({
	field,
	pending,
	t,
}: {
	field: StringField;
	pending: boolean;
	t: EquipmentTranslate;
}) {
	return (
		<TFormItem>
			<TFormLabel>
				{t("settings.equipment.handover.notes", "Notes (optional)")}
			</TFormLabel>
			<TFormControl>
				<Textarea
					name={field.name}
					autoComplete="off"
					maxLength={4000}
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={field.handleBlur}
					disabled={pending}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

function useIssueEquipmentForm({
	data,
	employeeId,
	submit,
}: {
	data: EquipmentView;
	employeeId?: string;
	submit: SubmitHandover;
}) {
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: {
			...handoverDefaults,
			itemId: "",
			typeId: "",
			identifier: "",
			serialNumber: "",
			employeeId: employeeId ?? "",
			returnRequired: true,
			explicitDeadline: "",
		},
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const item = data.availableItems.find(
				(candidate) => candidate.id === value.itemId,
			);
			if (!item && value.itemId !== "new") return;
			const payload = {
				...(!item
					? {
							kind: "register_and_issue_individual" as const,
							typeId: value.typeId,
							identifier: value.identifier,
							serialNumber: value.serialNumber,
							expectedRevision: 0 as const,
						}
					: {
							kind: "issue_individual" as const,
							itemId: item.id,
							expectedRevision: item.revision,
						}),
				employeeId: value.employeeId,
				actualDate: value.actualDate,
				condition: value.condition,
				notes: value.notes,
				returnRequired: value.returnRequired,
				explicitDeadline:
					value.returnRequired && value.explicitDeadline
						? value.explicitDeadline
						: null,
			} as const;
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return { form, element };
}

export function IssueEquipmentForm({
	data,
	employeeId,
	submit,
	pending,
	onCancel,
}: HandoverActions & { data: EquipmentView; employeeId?: string }) {
	const { t } = useTranslate();
	const { form, element } = useIssueEquipmentForm({ data, employeeId, submit });
	return (
		<form
			ref={element}
			noValidate
			className="space-y-4 rounded-lg border bg-card p-4"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{t(
					"settings.equipment.handover.issueTitle",
					"Issue an individual item",
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.handover.zone",
					"Handover dates and deadlines use the organization’s timezone.",
				)}{" "}
				<span translate="no">{data.timezone}</span>
			</p>
			<fieldset
				disabled={pending}
				className="grid min-w-0 gap-4 sm:grid-cols-2"
			>
				<form.Field
					name="itemId"
					validators={{
						onSubmit: ({ value }) =>
							!value
								? t(
										"settings.equipment.handover.itemRequired",
										"Select an available item.",
									)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel required>
								{t("settings.equipment.handover.item", "Equipment item")}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<select
									name={field.name}
									aria-label={t(
										"settings.equipment.handover.item",
										"Equipment item",
									)}
									className={equipmentSelectClass}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => {
										field.handleChange(e.target.value);
										const selected = data.availableItems.find(
											(item) => item.id === e.target.value,
										);
										if (selected) {
											form.setFieldValue(
												"returnRequired",
												selected.defaultReturnRequired,
											);
											form.setFieldValue("explicitDeadline", "");
										}
									}}
								>
									<option value="">
										{t(
											"settings.equipment.handover.selectItem",
											"Select an available item…",
										)}
									</option>
									{data.registrationTypes.length ? (
										<option value="new">
											{t(
												"settings.equipment.handover.registerNew",
												"Register a new item during issuance",
											)}
										</option>
									) : null}
									{data.availableItems.map((item) => (
										<option key={item.id} value={item.id}>
											{item.identifier} · {item.typeName}
										</option>
									))}
								</select>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
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
									name={field.name}
									aria-label={t(
										"settings.equipment.handover.employee",
										"Current employee",
									)}
									className={equipmentSelectClass}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									disabled={!!employeeId}
								>
									<option value="">
										{t(
											"settings.equipment.handover.selectEmployee",
											"Select a current employee…",
										)}
									</option>
									{data.employees
										.filter((employee) => !employee.former)
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
				<form.Field
					name="actualDate"
					validators={{
						onSubmit: ({ value }) => actualDateError(value, data.today, t),
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
			<form.Subscribe selector={(state) => state.values.itemId}>
				{(itemId) =>
					itemId === "new" ? (
						<RegistrationFields form={form} data={data} pending={pending} />
					) : null
				}
			</form.Subscribe>
			<ReturnAgreementFields form={form} pending={pending} />
			<form.Field name="notes">
				{(field) => <NotesField field={field} pending={pending} t={t} />}
			</form.Field>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{pending
						? t("settings.equipment.handover.saving", "Saving…")
						: t("settings.equipment.handover.issue", "Record issuance")}
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

function RegistrationFields({
	form,
	data,
	pending,
}: {
	form: ReturnType<typeof useIssueEquipmentForm>["form"];
	data: EquipmentView;
	pending: boolean;
}) {
	const { t } = useTranslate();
	return (
		<fieldset
			disabled={pending}
			className="grid gap-4 rounded-md border p-3 sm:grid-cols-2"
		>
			<legend className="px-1 text-sm font-medium">
				{t("settings.equipment.handover.newIdentity", "New item identity")}
			</legend>
			<form.Field
				name="typeId"
				validators={{
					onSubmit: ({ value }) =>
						!value
							? t(
									"settings.equipment.handover.typeRequired",
									"Select an equipment type.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel required>
							{t("settings.equipment.handover.type", "Equipment type")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<select
								aria-label={t(
									"settings.equipment.handover.type",
									"Equipment type",
								)}
								className={equipmentSelectClass}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => {
									field.handleChange(e.target.value);
									const type = data.registrationTypes.find(
										(type) => type.id === e.target.value,
									);
									if (type) {
										form.setFieldValue(
											"returnRequired",
											type.defaultReturnRequired,
										);
										form.setFieldValue("explicitDeadline", "");
									}
								}}
							>
								<option value="">
									{t(
										"settings.equipment.handover.selectType",
										"Select an equipment type…",
									)}
								</option>
								{data.registrationTypes.map((type) => (
									<option key={type.id} value={type.id}>
										{type.name}
									</option>
								))}
							</select>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="identifier"
				validators={{
					onSubmit: ({ value }) =>
						!value.trim()
							? t(
									"settings.equipment.handover.identifierRequired",
									"Enter an equipment identifier.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel required>
							{t(
								"settings.equipment.handover.identifier",
								"Equipment identifier",
							)}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								name={field.name}
								spellCheck={false}
								value={field.state.value}
								maxLength={100}
								autoComplete="off"
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="serialNumber">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"settings.equipment.handover.serial",
								"Manufacturer serial number (optional)",
							)}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								spellCheck={false}
								value={field.state.value}
								maxLength={200}
								autoComplete="off"
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
		</fieldset>
	);
}

function ReturnAgreementFields({
	form,
	pending,
}: {
	form: ReturnType<typeof useIssueEquipmentForm>["form"];
	pending: boolean;
}) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field name="returnRequired">
				{(field) => (
					<label className="flex items-center gap-2 text-sm">
						<input
							name={field.name}
							type="checkbox"
							checked={field.state.value}
							disabled={pending}
							onChange={(e) => {
								field.handleChange(e.target.checked);
								if (!e.target.checked)
									form.setFieldValue("explicitDeadline", "");
							}}
						/>
						{t("settings.equipment.handover.returnRequired", "Return required")}
					</label>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.returnRequired}>
				{(required) =>
					required ? (
						<form.Field
							name="explicitDeadline"
							validators={{
								onSubmit: ({ value }) => {
									if (!value) return undefined;
									try {
										parsePlainDate(value);
									} catch {
										return t(
											"settings.equipment.handover.dateInvalid",
											"Enter a valid calendar date.",
										);
									}
									return value < form.getFieldValue("actualDate")
										? t(
												"settings.equipment.handover.deadlineInvalid",
												"The return deadline must be on or after the handover date.",
											)
										: undefined;
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
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											disabled={pending}
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
								"Issued to keep: no deadline or return obligation. This item remains held until physically received back.",
							)}
						</p>
					)
				}
			</form.Subscribe>
		</>
	);
}

export function ReceiveEquipmentForm({
	assignment,
	today,
	timezone,
	submit,
	pending,
	onCancel,
}: HandoverActions & {
	assignment: EquipmentAssignmentView;
	today: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: { ...handoverDefaults },
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const payload = {
				kind: "receive_individual",
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				...value,
			} as const;
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<form
			ref={element}
			noValidate
			className="space-y-4 rounded-lg border bg-card p-4"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{t(
					"settings.equipment.handover.receiveTitle",
					"Confirm physical receipt",
				)}{" "}
				· <span translate="no">{assignment.identifier}</span>
			</h3>
			<p className="text-sm text-muted-foreground">
				{assignment.holderName} · <span translate="no">{timezone}</span>
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="actualDate"
					validators={{
						onSubmit: ({ value }) =>
							actualDateError(value, today, t) ??
							(value && value < assignment.issue.actualDate
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
			</div>
			<form.Field name="notes">
				{(field) => <NotesField field={field} pending={pending} t={t} />}
			</form.Field>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.handover.receiptHelp",
					"Record receipt only after the item is physically back. Damaged equipment stays unavailable pending clearance.",
				)}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{pending
						? t("settings.equipment.handover.saving", "Saving…")
						: t("settings.equipment.handover.receive", "Record receipt")}
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
