"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import type {
	EquipmentSetupChange,
	EquipmentSetupView,
	EquipmentTypeView,
} from "@/lib/organization/equipment/contracts";

export type SubmitEquipment = (
	change: EquipmentSetupChange,
) => Promise<boolean>;
interface FormActions {
	submit: SubmitEquipment;
	pending: boolean;
}
const selectClass =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function EquipmentRetentionForm({
	policy,
	submit,
	pending,
}: FormActions & { policy: EquipmentSetupView["policy"] }) {
	const { t } = useTranslate();
	const [requestId] = useState(() => crypto.randomUUID());
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: { months: policy ? String(policy.retentionMonths) : "" },
		onSubmitInvalid: () => {
			element.current
				?.querySelector<HTMLInputElement>('[name="months"]')
				?.focus();
		},
		onSubmit: async ({ value }) => {
			await submit({
				kind: "configure_policy",
				requestId,
				retentionMonths: Number(value.months),
				expectedRevision: policy?.revision ?? 0,
			});
		},
	});
	return (
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4"
		>
			<form.Field
				name="months"
				validators={{
					onSubmit: ({ value }) =>
						!/^\d+$/.test(value) ||
						Number(value) < 1 ||
						Number(value) > 2147483647
							? t(
									"settings.equipment.validation.months",
									"Enter a positive whole number of months.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"settings.equipment.retention.label",
								"Closed-record retention (months)",
							)}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								name={field.name}
								autoComplete="off"
								type="number"
								inputMode="numeric"
								min={1}
								step={1}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								disabled={pending}
								className="max-w-xs"
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.equipment.retention.help",
								"Choose your organization's justified retention period. It starts at the latest activity on fully closed assignments. Outstanding returns and documented case holds prevent cleanup.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<Button type="submit" disabled={pending}>
				{t("settings.equipment.retention.save", "Save retention policy")}
			</Button>
		</form>
	);
}

export function EquipmentTypeForm({
	type,
	submit,
	pending,
	onCancel,
}: FormActions & { type?: EquipmentTypeView; onCancel: () => void }) {
	const { t } = useTranslate();
	const [requestId] = useState(() => crypto.randomUUID());
	const element = useRef<HTMLFormElement>(null);
	const form = useForm({
		onSubmitInvalid: () => {
			element.current
				?.querySelector<HTMLInputElement>('[name="name"]')
				?.focus();
		},
		defaultValues: {
			name: type?.name ?? "",
			trackingMode: type?.trackingMode ?? "individual",
			defaultReturnRequired: type?.defaultReturnRequired ?? true,
		},
		onSubmit: async ({ value }) => {
			const saved = await submit(
				type
					? {
							...value,
							kind: "update_type",
							id: type.id,
							expectedRevision: type.revision,
							requestId,
						}
					: { ...value, kind: "create_type", requestId },
			);
			if (saved) onCancel();
		},
	});
	return (
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border p-4"
		>
			<h3 className="font-medium">
				{type
					? t("settings.equipment.types.edit", "Edit equipment type")
					: t("settings.equipment.types.create", "New equipment type")}
			</h3>
			<form.Field
				name="name"
				validators={{
					onSubmit: ({ value }) =>
						!value.trim() || value.trim().length > 100
							? t(
									"settings.equipment.validation.name",
									"Enter a type name of up to 100 characters.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.equipment.types.name", "Type name")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								name={field.name}
								autoComplete="off"
								value={field.state.value}
								maxLength={100}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								disabled={pending}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="trackingMode">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.equipment.types.mode", "Tracking mode")}
						</TFormLabel>
						<TFormControl>
							<select
								aria-label={t("settings.equipment.types.mode", "Tracking mode")}
								name={field.name}
								autoComplete="off"
								className={selectClass}
								value={field.state.value}
								onChange={(e) =>
									field.handleChange(
										e.target.value === "quantity" ? "quantity" : "individual",
									)
								}
								onBlur={field.handleBlur}
								disabled={pending || type?.used}
							>
								<option value="individual">
									{t("settings.equipment.types.individual", "Individual items")}
								</option>
								<option value="quantity">
									{t("settings.equipment.types.quantity", "Quantity")}
								</option>
							</select>
						</TFormControl>
						<TFormDescription>
							{type?.used
								? t(
										"settings.equipment.types.fixed",
										"This type has been used. Its tracking mode is fixed; create a new type to use another mode.",
									)
								: t(
										"settings.equipment.types.modeHelp",
										"Track laptops by identity, or interchangeable equipment such as shirts by quantity.",
									)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="defaultReturnRequired">
				{(field) => (
					<TFormItem className="flex items-center gap-2">
						<TFormControl>
							<input
								aria-label={t(
									"settings.equipment.types.returnDefault",
									"Return required by default",
								)}
								name={field.name}
								type="checkbox"
								className="size-4 accent-primary"
								checked={field.state.value}
								onChange={(e) => field.handleChange(e.target.checked)}
								disabled={pending}
							/>
						</TFormControl>
						<TFormLabel>
							{t(
								"settings.equipment.types.returnDefault",
								"Return required by default",
							)}
						</TFormLabel>
					</TFormItem>
				)}
			</form.Field>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.types.defaultHelp",
					"Defaults apply to future assignments. Existing return agreements stay as recorded.",
				)}
			</p>
			<div className="flex gap-2">
				<Button type="submit" disabled={pending}>
					{t("settings.equipment.types.save", "Save type")}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={pending}
				>
					{t("settings.equipment.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}

export function EquipmentItemForm({
	types,
	configured,
	submit,
	pending,
}: FormActions & { types: EquipmentTypeView[]; configured: boolean }) {
	const { t } = useTranslate();
	const [requestId, setRequestId] = useState(() => crypto.randomUUID());
	const element = useRef<HTMLFormElement>(null);
	const individualTypes = types.filter(
		(type) => type.trackingMode === "individual",
	);
	const form = useForm({
		defaultValues: { typeId: "", identifier: "", serialNumber: "" },
		onSubmitInvalid: ({ formApi }) => {
			const name = (["typeId", "identifier"] as const).find(
				(field) => formApi.getFieldMeta(field)?.errors.length,
			);
			if (name)
				element.current
					?.querySelector<HTMLElement>(`[name="${name}"]`)
					?.focus();
		},
		onSubmit: async ({ value }) => {
			if (await submit({ ...value, kind: "register_item", requestId })) {
				form.reset();
				setRequestId(crypto.randomUUID());
			}
		},
	});
	const disabled = pending || !configured || individualTypes.length === 0;
	return (
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-4"
		>
			<form.Field
				name="typeId"
				validators={{
					onSubmit: ({ value }) =>
						!individualTypes.some((type) => type.id === value)
							? t(
									"settings.equipment.validation.type",
									"Select an active individually tracked type.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.equipment.items.type", "Equipment type")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<select
								aria-label={t(
									"settings.equipment.items.type",
									"Equipment type",
								)}
								name={field.name}
								autoComplete="off"
								className={selectClass}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								disabled={disabled}
							>
								<option value="">
									{t("settings.equipment.items.selectType", "Select a type")}
								</option>
								{individualTypes.map((type) => (
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
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="identifier"
					validators={{
						onSubmit: ({ value }) =>
							!value.trim() || value.trim().length > 100
								? t(
										"settings.equipment.validation.identifier",
										"Enter an equipment identifier of up to 100 characters.",
									)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t(
									"settings.equipment.items.identifier",
									"Equipment identifier",
								)}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<Input
									name={field.name}
									autoComplete="off"
									spellCheck={false}
									value={field.state.value}
									maxLength={100}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									disabled={disabled}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.equipment.items.identifierHelp",
									"Unique in your organization, ignoring surrounding spaces and letter case. Kept reserved after archival or retirement.",
								)}
							</TFormDescription>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="serialNumber">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t(
									"settings.equipment.items.serial",
									"Manufacturer serial number (optional)",
								)}
							</TFormLabel>
							<TFormControl>
								<Input
									name={field.name}
									autoComplete="off"
									spellCheck={false}
									value={field.state.value}
									maxLength={200}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									disabled={disabled}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
			</div>
			{!configured ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.errors.policy",
						"Configure closed-record retention before registering or issuing equipment.",
					)}
				</p>
			) : individualTypes.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.items.noTypes",
						"Add an active individually tracked type to register an item. Quantity types do not need item identities.",
					)}
				</p>
			) : null}
			<Button type="submit" disabled={disabled}>
				{t("settings.equipment.items.register", "Register item")}
			</Button>
		</form>
	);
}
