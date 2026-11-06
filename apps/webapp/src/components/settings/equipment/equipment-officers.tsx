"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { equipmentSelectClass } from "@/components/equipment/equipment-handovers";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { changeEquipmentOfficerGrant } from "@/lib/organization/equipment/actions";
import type {
	EquipmentOfficerChange,
	EquipmentOfficerView,
} from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";

export function EquipmentOfficers({ data }: { data: EquipmentOfficerView }) {
	const { t } = useTranslate();
	const [selected, setSelected] = useState("");
	const grant = data.grants.find((g) => g.employeeId === selected);
	return (
		<section
			className="space-y-4 rounded-lg border bg-card p-4"
			aria-labelledby="equipment-officers-title"
		>
			<div>
				<h2 id="equipment-officers-title" className="text-lg font-semibold">
					{t("settings.equipment.officers.title", "Equipment officers")}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					{t(
						"settings.equipment.officers.help",
						"Delegate equipment responsibility for the organization or selected teams and employees. Managers have no equipment access without a grant.",
					)}
				</p>
			</div>
			<TFormItem>
				<TFormLabel>
					{t("settings.equipment.officers.officer", "Equipment officer")}
				</TFormLabel>
				<TFormControl>
					<select
						name="officer"
						aria-label={t(
							"settings.equipment.officers.officer",
							"Equipment officer",
						)}
						className={equipmentSelectClass}
						value={selected}
						onChange={(e) => setSelected(e.target.value)}
					>
						<option value="">
							{t("settings.equipment.officers.choose", "Select an officer…")}
						</option>
						{data.employees
							.filter(
								(e) =>
									e.current || data.grants.some((g) => g.employeeId === e.id),
							)
							.map((e) => (
								<option key={e.id} value={e.id}>
									{e.name}
									{!e.current
										? ` · ${t("settings.equipment.custody.former", "Former employee")}`
										: ""}
								</option>
							))}
					</select>
				</TFormControl>
			</TFormItem>
			{selected ? (
				<OfficerGrantForm
					key={`${selected}:${grant?.revision ?? 0}`}
					data={data}
					employeeId={selected}
				/>
			) : null}
		</section>
	);
}

function OfficerGrantForm({
	data,
	employeeId,
}: {
	data: EquipmentOfficerView;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const grant = data.grants.find((g) => g.employeeId === employeeId);
	const current =
		data.employees.find((e) => e.id === employeeId)?.current ?? false;
	const [pending, startTransition] = useTransition();
	const [scopeError, setScopeError] = useState<string | null>(null);
	const identity = useRef<{ payload: string; id: string } | null>(null);
	function submit(
		command:
			| Omit<
					Extract<EquipmentOfficerChange, { kind: "set_officer_grant" }>,
					"requestId"
			  >
			| Omit<
					Extract<EquipmentOfficerChange, { kind: "revoke_officer_grant" }>,
					"requestId"
			  >,
	) {
		const payload = JSON.stringify(command);
		if (identity.current?.payload !== payload)
			identity.current = { payload, id: crypto.randomUUID() };
		const requestId = identity.current.id;
		startTransition(async () => {
			const result = await changeEquipmentOfficerGrant({
				...command,
				requestId,
			}).catch(() => null);
			if (!result?.success || !result.data.ok) {
				toast.error(
					t(
						"settings.equipment.officers.failed",
						"Responsibility could not be saved. Reload to check current access and revisions, then try again.",
					),
				);
				return;
			}
			toast.success(
				t(
					"settings.equipment.officers.saved",
					"Equipment responsibility saved.",
				),
			);
			router.refresh();
		});
	}
	const form = useForm({
		defaultValues: {
			scope: grant?.scope ?? "all",
			teamIds: grant?.teamIds ?? [],
			employeeIds: grant?.employeeIds ?? [],
		},
		onSubmit: ({ value }) => {
			if (
				value.scope === "selected" &&
				!value.teamIds.length &&
				!value.employeeIds.length
			) {
				setScopeError(
					t(
						"settings.equipment.officers.scopeRequired",
						"Select at least one team or employee.",
					),
				);
				return;
			}
			setScopeError(null);
			submit({
				kind: "set_officer_grant",
				employeeId,
				expectedRevision: grant?.revision ?? 0,
				...value,
				teamIds: value.scope === "all" ? [] : value.teamIds,
				employeeIds: value.scope === "all" ? [] : value.employeeIds,
			});
		},
	});
	return (
		<form
			className="space-y-4"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<p className="text-sm text-muted-foreground">
				{grant && !grant.revoked && current
					? t("settings.equipment.officers.active", "Responsibility is active.")
					: t(
							"settings.equipment.officers.inactive",
							"No active equipment responsibility.",
						)}
			</p>
			{current ? (
				<fieldset disabled={pending} className="space-y-4">
					<form.Field name="scope">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"settings.equipment.officers.scope",
										"Responsibility scope",
									)}
								</TFormLabel>
								<TFormControl>
									<select
										name={field.name}
										aria-label={t(
											"settings.equipment.officers.scope",
											"Responsibility scope",
										)}
										className={equipmentSelectClass}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(e) =>
											field.handleChange(
												e.target.value === "all" ? "all" : "selected",
											)
										}
									>
										<option value="all">
											{t(
												"settings.equipment.officers.all",
												"Whole organization",
											)}
										</option>
										<option value="selected">
											{t(
												"settings.equipment.officers.selected",
												"Selected teams and employees",
											)}
										</option>
									</select>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.scope}>
						{(scope) =>
							scope === "selected" ? (
								<div className="grid gap-4 sm:grid-cols-2">
									<form.Field name="teamIds">
										{(field) => (
											<ScopeChoices
												title={t("settings.equipment.officers.teams", "Teams")}
												choices={data.teams}
												value={field.state.value}
												onChange={field.handleChange}
											/>
										)}
									</form.Field>
									<form.Field name="employeeIds">
										{(field) => (
											<ScopeChoices
												title={t(
													"settings.equipment.officers.employees",
													"Employees",
												)}
												choices={data.employees}
												value={field.state.value}
												onChange={field.handleChange}
											/>
										)}
									</form.Field>
								</div>
							) : null
						}
					</form.Subscribe>
					<Button type="submit" disabled={pending}>
						{t("settings.equipment.officers.save", "Save responsibility")}
					</Button>
				</fieldset>
			) : null}
			{grant && !grant.revoked ? (
				<Button
					type="button"
					variant="destructive"
					disabled={pending}
					onClick={() =>
						submit({
							kind: "revoke_officer_grant",
							employeeId,
							expectedRevision: grant.revision,
						})
					}
				>
					{t("settings.equipment.officers.revoke", "Revoke responsibility")}
				</Button>
			) : null}
			{scopeError ? (
				<p role="alert" className="text-sm text-destructive">
					{scopeError}
				</p>
			) : null}
			{pending ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("settings.equipment.officers.saving", "Saving responsibility…")}
				</p>
			) : null}
		</form>
	);
}

function ScopeChoices({
	title,
	choices,
	value,
	onChange,
}: {
	title: string;
	choices: { id: string; name: string }[];
	value: string[];
	onChange: (ids: string[]) => void;
}) {
	const selected = new Set(value);
	return (
		<fieldset className="min-w-0 space-y-2">
			<legend className="mb-2 text-sm font-medium">{title}</legend>
			<div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
				{choices.map((choice) => (
					<label key={choice.id} className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							checked={selected.has(choice.id)}
							onChange={(e) =>
								onChange(
									e.target.checked
										? [...value, choice.id]
										: value.filter((id) => id !== choice.id),
								)
							}
						/>
						<span className="break-words">{choice.name}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
