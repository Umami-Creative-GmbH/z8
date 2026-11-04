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
import {
	comparePlainDates,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import {
	type EquipmentAssignmentView,
	type EquipmentChange,
	type EquipmentCondition,
	type EquipmentView,
	equipmentConditionSchema,
} from "@/lib/organization/equipment/contracts";
import { conditionLabel, type EquipmentTranslate } from "./equipment-copy";
import {
	actualDateError,
	quantityError,
} from "./equipment-handover-validation";
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
export function useCommandIdentity() {
	const request = useRef<{ payload: string; id: string } | null>(null);
	return (payload: unknown) => {
		const serialized = JSON.stringify(payload);
		if (request.current?.payload !== serialized)
			request.current = { payload: serialized, id: crypto.randomUUID() };
		return request.current.id;
	};
}
interface StringField {
	name: string;
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
}
export function ActualDateField({
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
export function ConditionField({
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
export function NotesField({
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
export function QuantityField({
	field,
	pending,
	maximum,
	t,
}: {
	field: StringField;
	pending: boolean;
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
					type="number"
					inputMode="numeric"
					autoComplete="off"
					name={field.name}
					min={1}
					step={1}
					max={maximum ?? 2147483647}
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					disabled={pending}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
type IssueMode = "new" | "historical";
function useIssueEquipmentForm({
	mode,
	data,
	employeeId,
	submit,
}: {
	mode: IssueMode;
	data: EquipmentView;
	employeeId?: string;
	submit: SubmitHandover;
}) {
	const identity = useCommandIdentity();
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: {
			...handoverDefaults,
			unknownDate: false,
			itemId: "",
			typeId: "",
			identifier: "",
			serialNumber: "",
			quantity: "1",
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
			const type = data.availableQuantityTypes.find(
				(candidate) => candidate.id === value.itemId,
			);
			if (!item && !type && value.itemId !== "new") return;
			const common = {
				employeeId: value.employeeId,
				actualDate: value.actualDate,
				condition: value.condition,
				notes: value.notes,
				returnRequired: value.returnRequired,
				explicitDeadline:
					value.returnRequired && value.explicitDeadline
						? value.explicitDeadline
						: null,
			};
			if (mode === "historical") {
				const evidence = {
					...common,
					actualDate: value.unknownDate ? null : value.actualDate,
				};
				if (value.itemId === "new") {
					const payload = {
						...evidence,
						kind: "register_historical_individual" as const,
						typeId: value.typeId,
						identifier: value.identifier,
						serialNumber: value.serialNumber,
						expectedRevision: 0 as const,
					};
					await submit({ ...payload, requestId: identity(payload) });
				} else if (type) {
					const payload = {
						...evidence,
						kind: "record_historical_quantity" as const,
						typeId: type.id,
						quantity: Number(value.quantity),
						expectedRevision: type.revision,
					};
					await submit({ ...payload, requestId: identity(payload) });
				} else if (item) {
					const payload = {
						...evidence,
						kind: "record_historical_individual" as const,
						itemId: item.id,
						expectedRevision: item.revision,
					};
					await submit({ ...payload, requestId: identity(payload) });
				}
				return;
			}
			if (value.itemId === "new") {
				const payload = {
					...common,
					kind: "register_and_issue_individual" as const,
					typeId: value.typeId,
					identifier: value.identifier,
					serialNumber: value.serialNumber,
					expectedRevision: 0 as const,
				};
				await submit({ ...payload, requestId: identity(payload) });
			} else if (type) {
				const payload = {
					...common,
					kind: "issue_quantity" as const,
					typeId: type.id,
					quantity: Number(value.quantity),
					expectedRevision: type.revision,
				};
				await submit({ ...payload, requestId: identity(payload) });
			} else if (item) {
				const payload = {
					...common,
					kind: "issue_individual" as const,
					itemId: item.id,
					expectedRevision: item.revision,
				};
				await submit({ ...payload, requestId: identity(payload) });
			}
		},
	});
	return { form, element };
}
type IssueFormProps = HandoverActions & {
	data: EquipmentView;
	employeeId?: string;
};
export function IssueEquipmentForm(props: IssueFormProps) {
	return <EquipmentIssueForm {...props} mode="new" />;
}
export function HistoricalEquipmentForm(props: IssueFormProps) {
	return <EquipmentIssueForm {...props} mode="historical" />;
}
function EquipmentIssueForm({
	mode,
	data,
	employeeId,
	submit,
	pending,
	onCancel,
}: IssueFormProps & { mode: IssueMode }) {
	const { t } = useTranslate();
	const { form, element } = useIssueEquipmentForm({
		mode,
		data,
		employeeId,
		submit,
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
				{mode === "historical"
					? t("settings.equipment.historical.title", "Record existing holding")
					: t("settings.equipment.handover.issueTitle", "Issue equipment")}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.handover.zone",
					"Handover dates and deadlines use the organization’s timezone.",
				)}{" "}
				<span translate="no">{data.timezone}</span>
			</p>
			{mode === "historical" ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.historical.help",
						"Record equipment already held by a current or former employee. Entry time and recorder are saved separately from the actual issue date. This creates no physical receipt.",
					)}
				</p>
			) : null}
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
										"Select an available item or quantity type.",
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
										const selected =
											data.availableItems.find(
												(item) => item.id === e.target.value,
											) ??
											data.availableQuantityTypes.find(
												(type) => type.id === e.target.value,
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
											"Select an item or quantity type…",
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
									{data.availableQuantityTypes.map((type) => (
										<option key={type.id} value={type.id}>
											{type.name} ·{" "}
											{t(
												"settings.equipment.handover.quantityType",
												"Quantity",
											)}
										</option>
									))}
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
				<form.Subscribe selector={(state) => state.values.itemId}>
					{(selectedId) =>
						data.availableQuantityTypes.some(
							(type) => type.id === selectedId,
						) ? (
							<form.Field
								name="quantity"
								validators={{
									onSubmit: ({ value }) => quantityError(value, t),
								}}
							>
								{(field) => (
									<QuantityField field={field} pending={pending} t={t} />
								)}
							</form.Field>
						) : null
					}
				</form.Subscribe>
				<form.Field
					name="employeeId"
					validators={{
						onSubmit: ({ value }) =>
							!value
								? mode === "historical"
									? t(
											"settings.equipment.historical.employeeRequired",
											"Select a current or former employee.",
										)
									: t(
											"settings.equipment.handover.employeeRequired",
											"Select a current employee.",
										)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel required>
								{mode === "historical"
									? t(
											"settings.equipment.historical.employee",
											"Current or former employee",
										)
									: t(
											"settings.equipment.handover.employee",
											"Current employee",
										)}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<select
									name={field.name}
									aria-label={
										mode === "historical"
											? t(
													"settings.equipment.historical.employee",
													"Current or former employee",
												)
											: t(
													"settings.equipment.handover.employee",
													"Current employee",
												)
									}
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
										.filter(
											(employee) => mode === "historical" || !employee.former,
										)
										.map((employee) => (
											<option key={employee.id} value={employee.id}>
												{employee.name}
												{employee.former
													? ` · ${t("settings.equipment.custody.former", "Former employee")}`
													: ""}
											</option>
										))}
								</select>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				{mode === "historical" ? (
					<form.Field name="unknownDate">
						{(field) => (
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									name={field.name}
									checked={field.state.value}
									disabled={pending}
									onChange={(event) => {
										field.handleChange(event.target.checked);
										form.setFieldValue("actualDate", "");
									}}
								/>
								{t(
									"settings.equipment.historical.unknownDate",
									"Actual issue date is unknown",
								)}
							</label>
						)}
					</form.Field>
				) : null}
				<form.Subscribe selector={(state) => state.values.unknownDate}>
					{(unknown) =>
						mode === "historical" && unknown ? (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.equipment.historical.unknownHelp",
									"The actual issue date will remain unknown; the entry date will not replace it.",
								)}
							</p>
						) : (
							<form.Field
								name="actualDate"
								validators={{
									onSubmit: ({ value }) =>
										mode === "historical" && form.getFieldValue("unknownDate")
											? undefined
											: actualDateError(value, data.today, t),
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
						)
					}
				</form.Subscribe>
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
						: mode === "historical"
							? t(
									"settings.equipment.historical.save",
									"Save historical holding",
								)
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
									return form.getFieldValue("actualDate") &&
										comparePlainDates(
											parsePlainDate(value),
											parsePlainDate(form.getFieldValue("actualDate")),
										) < 0
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
								"Issued to keep: no deadline or return obligation. Equipment remains held until physically received back.",
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
		defaultValues: { ...handoverDefaults, quantity: "1" },
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const { quantity, ...handover } = value;
			const common = {
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				...handover,
			};
			const payload =
				assignment.trackingMode === "quantity"
					? {
							...common,
							kind: "receive_quantity" as const,
							quantity: Number(quantity),
						}
					: { ...common, kind: "receive_individual" as const };
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
				{assignment.trackingMode === "quantity" ? (
					<form.Field
						name="quantity"
						validators={{
							onSubmit: ({ value }) =>
								quantityError(
									value,
									t,
									assignment.returnRequired
										? assignment.outstandingQuantity
										: assignment.quantity -
												assignment.physicallyReceivedQuantity,
								),
						}}
					>
						{(field) => (
							<QuantityField
								field={field}
								pending={pending}
								maximum={
									assignment.returnRequired
										? assignment.outstandingQuantity
										: assignment.quantity -
											assignment.physicallyReceivedQuantity
								}
								t={t}
							/>
						)}
					</form.Field>
				) : null}
				<form.Field
					name="actualDate"
					validators={{
						onSubmit: ({ value }) =>
							actualDateError(value, today, t) ??
							(value &&
							assignment.issue.actualDate &&
							comparePlainDates(
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
					"Record only the quantity physically received, with its own condition and notes. Damaged individual items stay unavailable pending clearance.",
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
