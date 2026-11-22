"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import {
	createCustomRole,
	setRolePermissions,
	updateCustomRole,
} from "@/app/[locale]/(app)/settings/roles/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientForm } from "@/components/ui/client-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { defineAbilityFor } from "@/lib/authorization/ability";
import {
	getPermissionCategories,
	getPermissionKey,
	getPermissionsByCategory,
	isValidPermission,
} from "@/lib/authorization/permission-registry";
import type { PrincipalContext } from "@/lib/authorization/types";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";

// ============================================
// INHERITED PERMISSIONS HELPER
// ============================================

/**
 * Compute which permissions a base tier inherits (from ability.ts logic)
 * so we can show them as disabled checked checkboxes.
 */
function getInheritedPermissions(baseTier: "admin" | "manager" | "employee"): Set<string> {
	const principal: PrincipalContext = {
		userId: "placeholder",
		isPlatformAdmin: false,
		activeOrganizationId: "placeholder",
		orgMembership: null,
		employee: {
			id: "placeholder",
			organizationId: "placeholder",
			role: baseTier,
			teamId: "placeholder-team",
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: baseTier === "manager" ? ["placeholder-managed"] : [],
		customRoles: [],
	};

	const ability = defineAbilityFor(principal);
	const inherited = new Set<string>();

	const allPerms = Object.values(getPermissionsByCategory()).flat();
	for (const perm of allPerms) {
		if (ability.can(perm.action, perm.subject)) {
			inherited.add(getPermissionKey(perm.action, perm.subject));
		}
	}

	return inherited;
}

// ============================================
// COLOR PRESETS
// ============================================

const COLOR_PRESETS = [
	"#6366f1", // Indigo
	"#8b5cf6", // Violet
	"#ec4899", // Pink
	"#f43f5e", // Rose
	"#f97316", // Orange
	"#eab308", // Yellow
	"#22c55e", // Green
	"#14b8a6", // Teal
	"#06b6d4", // Cyan
	"#3b82f6", // Blue
];

// ============================================
// COMPONENT
// ============================================

interface RoleEditorProps {
	role?: CustomRoleWithPermissions;
	onSaved: () => void;
	onCancel: () => void;
}

type BaseTier = "admin" | "manager" | "employee";

interface RoleEditorValues {
	name: string;
	description: string;
	baseTier: BaseTier;
	color: string;
	permissions: string[];
}

function initialRolePermissions(role?: CustomRoleWithPermissions): string[] {
	if (!role) return [];
	// A retired permission still stored on the role (e.g. finance, #748) would fail validation on save.
	return Array.from(
		new Set(
			role.permissions
				.filter((p) => isValidPermission(p.action, p.subject))
				.map((p) => getPermissionKey(p.action, p.subject)),
		),
	);
}

function toggleKey(keys: string[], key: string): string[] {
	return keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
}

export function RoleEditor({ role, onSaved, onCancel }: RoleEditorProps) {
	const { t } = useTranslate();
	const isEditing = !!role;
	const submittingRef = useRef(false);
	const createdRoleIdRef = useRef<string | undefined>(role?.id);

	const categories = getPermissionCategories();
	const permsByCategory = getPermissionsByCategory();

	const validateName = (value: string) =>
		value.trim()
			? undefined
			: t("settings.roles.editor.errors.nameRequired", "Role name is required");

	const form = useForm({
		defaultValues: {
			name: role?.name ?? "",
			description: role?.description ?? "",
			baseTier: (role?.baseTier ?? "employee") as BaseTier,
			color: role?.color ?? "#6366f1",
			permissions: initialRolePermissions(role),
		} satisfies RoleEditorValues,
		onSubmit: async ({ value }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				let roleId = createdRoleIdRef.current;

				if (roleId) {
					const updateResult = await updateCustomRole({
						roleId,
						input: {
							name: value.name,
							description: value.description,
							baseTier: value.baseTier,
							color: value.color,
						},
					}).catch(() => null);
					if (!updateResult?.success) {
						toast.error(
							actionErrorMessage(t, updateResult, {}, [
								"settings.roles.editor.errors.updateFailed",
								"Failed to update role",
							]),
						);
						return;
					}
				} else {
					const createResult = await createCustomRole({
						name: value.name,
						description: value.description,
						baseTier: value.baseTier,
						color: value.color,
					}).catch(() => null);
					if (!createResult?.success) {
						toast.error(
							actionErrorMessage(t, createResult, {}, [
								"settings.roles.editor.errors.createFailed",
								"Failed to create role",
							]),
						);
						return;
					}
					roleId = createResult.data.id;
					createdRoleIdRef.current = roleId;
				}

				const inherited = getInheritedPermissions(value.baseTier);
				// Set permissions (only non-inherited ones)
				const permsToSave = value.permissions.flatMap((key) => {
					if (inherited.has(key)) {
						return [];
					}

					const [action, subject] = key.split(":");
					return [{ action: action!, subject: subject! }];
				});

				const permResult = await setRolePermissions({
					roleId,
					permissions: permsToSave,
				}).catch(() => null);
				if (!permResult?.success) {
					toast.error(
						actionErrorMessage(t, permResult, {}, [
							"settings.roles.editor.errors.permissionsFailed",
							"Failed to save role permissions",
						]),
					);
					return;
				}

				toast.success(
					isEditing
						? t("settings.roles.toast.updated", "Role updated")
						: t("settings.roles.toast.created", "Role created"),
				);
				onSaved();
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	return (
		<ClientForm
			className="space-y-6"
			noValidate
			onSubmit={() => {
				if (submittingRef.current) return;
				void form.handleSubmit();
			}}
		>
			{/* Basic Info */}
			<div className="grid grid-cols-2 gap-4">
				<form.Field
					name="name"
					validators={{
						onSubmit: ({ value }) => validateName(value),
						onChange: ({ value, fieldApi }) =>
							fieldApi.state.meta.errors.length > 0 ? validateName(value) : undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)} required>
								{t("settings.roles.editor.name", "Name")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="name"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(
										"settings.roles.editor.namePlaceholder",
										"e.g. Team Lead, HR Manager\u2026",
									)}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="baseTier">
					{(field) => (
						<TFormItem>
							<TFormLabel>{t("settings.roles.editor.baseTier", "Base Tier")}</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as BaseTier)}
							>
								<TFormControl>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="employee">
										{t("settings.roles.baseTiers.employee", "Employee")}
									</SelectItem>
									<SelectItem value="manager">
										{t("settings.roles.baseTiers.manager", "Manager")}
									</SelectItem>
									<SelectItem value="admin">
										{t("settings.roles.baseTiers.admin", "Admin")}
									</SelectItem>
								</SelectContent>
							</Select>
						</TFormItem>
					)}
				</form.Field>
			</div>

			<form.Field name="description">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("settings.roles.editor.description", "Description")}</TFormLabel>
						<TFormControl>
							<Textarea
								name="description"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"settings.roles.editor.descriptionPlaceholder",
									"What this role is for\u2026",
								)}
								rows={2}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>

			{/* Color Picker */}
			<form.Field name="color">
				{(field) => (
					<div className="space-y-2">
						<Label>{t("settings.roles.editor.color", "Color")}</Label>
						<div className="flex gap-2">
							{COLOR_PRESETS.map((c) => (
								<button
									key={c}
									type="button"
									aria-pressed={field.state.value === c}
									aria-label={t("settings.roles.editor.selectColor", "Select color {color}", {
										color: c,
									})}
									className="size-7 rounded-full border-2 transition-[border-color,box-shadow]"
									style={{
										backgroundColor: c,
										borderColor: field.state.value === c ? "white" : "transparent",
										boxShadow: field.state.value === c ? `0 0 0 2px ${c}` : "none",
									}}
									onClick={() => field.handleChange(c)}
								/>
							))}
						</div>
					</div>
				)}
			</form.Field>

			{/* Permission Matrix */}
			<form.Subscribe selector={(state) => state.values.baseTier}>
				{(baseTier) => {
					const inherited = getInheritedPermissions(baseTier);
					return (
						<form.Field name="permissions">
							{(field) => {
								const selectedPermissions = new Set(field.state.value);
								return (
									<div className="space-y-4">
										<div>
											<Label className="text-base">
												{t("settings.roles.editor.permissions", "Permissions")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.roles.editor.permissionsHelp",
													"Select additional permissions for this role. Permissions inherited from the base tier are shown as locked.",
												)}
											</p>
										</div>

										{categories.map((cat) => {
											const perms = permsByCategory[cat.id];
											if (!perms?.length) return null;

											return (
												<div key={cat.id} className="space-y-2">
													<h4 className="text-sm font-semibold">{t(cat.labelKey, cat.label)}</h4>
													<div className="grid gap-2">
														{perms.map((perm) => {
															const key = getPermissionKey(perm.action, perm.subject);
															const isInherited = inherited.has(key);
															const isChecked = isInherited || selectedPermissions.has(key);

															return (
																<label
																	key={key}
																	className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50"
																>
																	<Checkbox
																		checked={isChecked}
																		onCheckedChange={() => {
																			if (!isInherited) {
																				field.handleChange(toggleKey(field.state.value, key));
																			}
																		}}
																		disabled={isInherited}
																		className="mt-0.5"
																	/>
																	<div className="flex-1 space-y-0.5">
																		<div className="flex items-center gap-2">
																			<span className="text-sm font-medium">
																				{t(perm.labelKey, perm.label)}
																			</span>
																			{isInherited && (
																				<Badge variant="outline" className="text-xs">
																					{t("settings.roles.editor.inherited", "Inherited")}
																				</Badge>
																			)}
																		</div>
																		<p className="text-xs text-muted-foreground">
																			{t(perm.descriptionKey, perm.description)}
																		</p>
																	</div>
																</label>
															);
														})}
													</div>
												</div>
											);
										})}
									</div>
								);
							}}
						</form.Field>
					);
				}}
			</form.Subscribe>

			{/* Actions */}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
							{t("common:actions.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{isEditing
								? t("settings.roles.actions.saveChanges", "Save Changes")
								: t("settings.roles.actions.create", "Create Role")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</ClientForm>
	);
}
