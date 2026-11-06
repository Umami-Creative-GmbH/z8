"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useRef, useState } from "react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

interface PanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	submit: SubmitEquipment;
	pending: boolean;
}

/** An action panel that cannot be dismissed while its command is in flight. */
function EquipmentPanel({
	open,
	onOpenChange,
	pending,
	title,
	description,
	children,
}: Omit<PanelProps, "submit"> & {
	title: ReactNode;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<ActionPanel
			open={open}
			onOpenChange={(next) => {
				if (!pending) onOpenChange(next);
			}}
		>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{title}</ActionPanelTitle>
					<ActionPanelDescription>{description}</ActionPanelDescription>
				</ActionPanelHeader>
				{children}
			</ActionPanelContent>
		</ActionPanel>
	);
}

function PanelFooter({
	pending,
	onCancel,
	submitLabel,
	submitDisabled,
}: {
	pending: boolean;
	onCancel: () => void;
	submitLabel: string;
	submitDisabled?: boolean;
}) {
	const { t } = useTranslate();
	return (
		<ActionPanelFooter>
			<Button
				type="button"
				variant="outline"
				onClick={onCancel}
				disabled={pending}
			>
				{t("settings.equipment.cancel", "Cancel")}
			</Button>
			<Button type="submit" disabled={pending || submitDisabled}>
				{pending ? (
					<IconLoader2
						className="size-4 motion-safe:animate-spin"
						aria-hidden="true"
					/>
				) : null}
				{submitLabel}
			</Button>
		</ActionPanelFooter>
	);
}

export function EquipmentRetentionPanel({
	policy,
	...panel
}: PanelProps & { policy: EquipmentSetupView["policy"] }) {
	const { t } = useTranslate();
	return (
		<EquipmentPanel
			{...panel}
			title={
				policy
					? t("settings.equipment.retention.editTitle", "Edit record retention")
					: t(
							"settings.equipment.retention.configureTitle",
							"Configure record retention",
						)
			}
			description={t(
				"settings.equipment.retention.description",
				"Configure a finite period before operational equipment tracking can be used. No legal retention period is assumed.",
			)}
		>
			<RetentionForm key={policy?.revision ?? 0} policy={policy} {...panel} />
		</EquipmentPanel>
	);
}

function RetentionForm({
	policy,
	submit,
	pending,
	onOpenChange,
}: PanelProps & { policy: EquipmentSetupView["policy"] }) {
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
			const saved = await submit({
				kind: "configure_policy",
				requestId,
				retentionMonths: Number(value.months),
				expectedRevision: policy?.revision ?? 0,
			});
			if (saved) onOpenChange(false);
		},
	});
	return (
		// Client-side TanStack Form submit; the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="space-y-4">
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
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
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
									className="max-w-40"
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.equipment.retention.help",
									"Choose your organization's justified retention period. It starts at the latest activity on fully closed assignments. Outstanding returns and documented case holds prevent cleanup.",
								)}{" "}
								{t(
									"settings.equipment.retention.calendarBoundary",
									"Cleanup becomes eligible at organization-local midnight after the full anniversary day. Later activity, including releasing a case hold, starts the period again.",
								)}
							</TFormDescription>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</ActionPanelBody>
			<PanelFooter
				pending={pending}
				onCancel={() => onOpenChange(false)}
				submitLabel={t(
					"settings.equipment.retention.save",
					"Save retention policy",
				)}
			/>
		</form>
	);
}

export function EquipmentTypePanel({
	type,
	...panel
}: PanelProps & { type?: EquipmentTypeView }) {
	const { t } = useTranslate();
	return (
		<EquipmentPanel
			{...panel}
			title={
				type
					? t("settings.equipment.types.edit", "Edit equipment type")
					: t("settings.equipment.types.create", "New equipment type")
			}
			description={t(
				"settings.equipment.types.defaultHelp",
				"Defaults apply to future assignments. Existing return agreements stay as recorded.",
			)}
		>
			<TypeForm
				key={`${type?.id ?? "new"}:${type?.revision ?? 0}`}
				type={type}
				{...panel}
			/>
		</EquipmentPanel>
	);
}

function TypeForm({
	type,
	submit,
	pending,
	onOpenChange,
}: PanelProps & { type?: EquipmentTypeView }) {
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
			if (saved) onOpenChange(false);
		},
	});
	const modeLabels = {
		individual: t("settings.equipment.types.individual", "Individual items"),
		quantity: t("settings.equipment.types.quantity", "Quantity"),
	};
	return (
		// Client-side TanStack Form submit; the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="space-y-6">
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
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
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
							<Select
								value={field.state.value}
								onValueChange={(value) =>
									field.handleChange(
										value === "quantity" ? "quantity" : "individual",
									)
								}
								disabled={pending || type?.used}
							>
								<TFormControl>
									<SelectTrigger className="w-full" onBlur={field.handleBlur}>
										<SelectValue />
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="individual">
										{modeLabels.individual}
									</SelectItem>
									<SelectItem value="quantity">
										{modeLabels.quantity}
									</SelectItem>
								</SelectContent>
							</Select>
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
						<TFormItem className="flex items-start justify-between gap-4 rounded-lg border p-4">
							<div className="min-w-0 space-y-1">
								<TFormLabel>
									{t(
										"settings.equipment.types.returnDefault",
										"Return required by default",
									)}
								</TFormLabel>
								<TFormDescription>
									{t(
										"settings.equipment.types.returnDefaultHelp",
										"Turn off for equipment that employees keep, such as clothing.",
									)}
								</TFormDescription>
							</div>
							<TFormControl>
								<Switch
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked)}
									disabled={pending}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
			</ActionPanelBody>
			<PanelFooter
				pending={pending}
				onCancel={() => onOpenChange(false)}
				submitLabel={t("settings.equipment.types.save", "Save type")}
			/>
		</form>
	);
}

export function EquipmentItemPanel({
	types,
	...panel
}: PanelProps & { types: EquipmentTypeView[] }) {
	const { t } = useTranslate();
	return (
		<EquipmentPanel
			{...panel}
			title={t(
				"settings.equipment.items.registerTitle",
				"Register equipment item",
			)}
			description={t(
				"settings.equipment.items.description",
				"Register physical equipment by its organization identifier. Manufacturer serial numbers are optional and separate.",
			)}
		>
			<ItemForm types={types} {...panel} />
		</EquipmentPanel>
	);
}

function ItemForm({
	types,
	submit,
	pending,
	onOpenChange,
}: PanelProps & { types: EquipmentTypeView[] }) {
	const { t } = useTranslate();
	const [requestId] = useState(() => crypto.randomUUID());
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
					?.querySelector<HTMLElement>(`[data-focus-field="${name}"]`)
					?.focus();
		},
		onSubmit: async ({ value }) => {
			if (await submit({ ...value, kind: "register_item", requestId }))
				onOpenChange(false);
		},
	});
	return (
		// Client-side TanStack Form submit; the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			ref={element}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="space-y-6">
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
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
								{t("settings.equipment.items.type", "Equipment type")}
							</TFormLabel>
							<Select
								value={field.state.value || null}
								onValueChange={(value) => field.handleChange(value ?? "")}
								disabled={pending}
							>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<SelectTrigger
										className="w-full"
										data-focus-field="typeId"
										onBlur={field.handleBlur}
									>
										<SelectValue
											placeholder={t(
												"settings.equipment.items.selectType",
												"Select a type",
											)}
										/>
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									{individualTypes.map((type) => (
										<SelectItem key={type.id} value={type.id}>
											{type.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
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
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
								{t(
									"settings.equipment.items.identifier",
									"Equipment identifier",
								)}
							</TFormLabel>
							<TFormControl hasError={field.state.meta.errors.length > 0}>
								<Input
									name={field.name}
									data-focus-field="identifier"
									autoComplete="off"
									spellCheck={false}
									value={field.state.value}
									maxLength={100}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									disabled={pending}
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
									disabled={pending}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
			</ActionPanelBody>
			<PanelFooter
				pending={pending}
				onCancel={() => onOpenChange(false)}
				submitLabel={t("settings.equipment.items.register", "Register item")}
			/>
		</form>
	);
}
