"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
	createCustomRole,
	updateCustomRole,
	setRolePermissions,
	type CustomRoleWithPermissions,
} from "@/app/[locale]/(app)/settings/roles/actions";
import {
	getPermissionsByCategory,
	getPermissionCategories,
	getPermissionKey,
	type PermissionDefinition,
} from "@/lib/authorization/permission-registry";
import { defineAbilityFor } from "@/lib/authorization/ability";
import type { PrincipalContext, Action, Subject } from "@/lib/authorization/types";

// ============================================
// INHERITED PERMISSIONS HELPER
// ============================================

/**
 * Compute which permissions a base tier inherits (from ability.ts logic)
 * so we can show them as disabled checked checkboxes.
 */
function getInheritedPermissions(
	baseTier: "admin" | "manager" | "employee",
): Set<string> {
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

export function RoleEditor({ role, onSaved, onCancel }: RoleEditorProps) {
	const isEditing = !!role;

	const [name, setName] = useState(role?.name ?? "");
	const [description, setDescription] = useState(role?.description ?? "");
	const [baseTier, setBaseTier] = useState<"admin" | "manager" | "employee">(
		role?.baseTier ?? "employee",
	);
	const [color, setColor] = useState(role?.color ?? "#6366f1");
	const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
		() => {
			if (!role) return new Set();
			return new Set(
				role.permissions.map((p) => getPermissionKey(p.action, p.subject)),
			);
		},
	);
	const [isSaving, setIsSaving] = useState(false);

	const inherited = useMemo(() => getInheritedPermissions(baseTier), [baseTier]);
	const categories = getPermissionCategories();
	const permsByCategory = getPermissionsByCategory();

	const togglePermission = (key: string) => {
		setSelectedPermissions((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const handleSave = async () => {
		if (!name.trim()) {
			toast.error("Role name is required");
			return;
		}

		setIsSaving(true);
		try {
			let roleId = role?.id;

			if (isEditing && roleId) {
				const updateResult = await updateCustomRole(roleId, {
					name,
					description,
					baseTier,
					color,
				});
				if (!updateResult.success) {
					toast.error(updateResult.error);
					return;
				}
			} else {
				const createResult = await createCustomRole({
					name,
					description,
					baseTier,
					color,
				});
				if (!createResult.success) {
					toast.error(createResult.error);
					return;
				}
				roleId = createResult.data.id;
			}

			// Set permissions (only non-inherited ones)
			const permsToSave = Array.from(selectedPermissions)
				.filter((key) => !inherited.has(key))
				.map((key) => {
					const [action, subject] = key.split(":");
					return { action: action!, subject: subject! };
				});

			const permResult = await setRolePermissions(roleId!, permsToSave);
			if (!permResult.success) {
				toast.error(permResult.error);
				return;
			}

			toast.success(isEditing ? "Role updated" : "Role created");
			onSaved();
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			{/* Basic Info */}
			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="role-name">Name</Label>
					<Input
						id="role-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Team Lead, HR Manager\u2026"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="role-tier">Base Tier</Label>
					<Select
						value={baseTier}
						onValueChange={(v) => setBaseTier(v as typeof baseTier)}
					>
						<SelectTrigger id="role-tier">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="employee">Employee</SelectItem>
							<SelectItem value="manager">Manager</SelectItem>
							<SelectItem value="admin">Admin</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="role-desc">Description</Label>
				<Textarea
					id="role-desc"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="What this role is for\u2026"
					rows={2}
				/>
			</div>

			{/* Color Picker */}
			<div className="space-y-2">
				<Label>Color</Label>
				<div className="flex gap-2">
					{COLOR_PRESETS.map((c) => (
						<button
							key={c}
							type="button"
							aria-label={`Select color ${c}`}
							className="h-7 w-7 rounded-full border-2 transition-[border-color,box-shadow]"
							style={{
								backgroundColor: c,
								borderColor: color === c ? "white" : "transparent",
								boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
							}}
							onClick={() => setColor(c)}
						/>
					))}
				</div>
			</div>

			{/* Permission Matrix */}
			<div className="space-y-4">
				<div>
					<Label className="text-base">Permissions</Label>
					<p className="text-sm text-muted-foreground">
						Select additional permissions for this role. Permissions inherited
						from the base tier are shown as locked.
					</p>
				</div>

				{categories.map((cat) => {
					const perms = permsByCategory[cat.id];
					if (!perms?.length) return null;

					return (
						<div key={cat.id} className="space-y-2">
							<h4 className="text-sm font-semibold">{cat.label}</h4>
							<div className="grid gap-2">
								{perms.map((perm) => {
									const key = getPermissionKey(perm.action, perm.subject);
									const isInherited = inherited.has(key);
									const isChecked = isInherited || selectedPermissions.has(key);

									return (
										<label
											key={key}
											className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/50 cursor-pointer"
										>
											<Checkbox
												checked={isChecked}
												onCheckedChange={() => {
													if (!isInherited) togglePermission(key);
												}}
												disabled={isInherited}
												className="mt-0.5"
											/>
											<div className="flex-1 space-y-0.5">
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium">
														{perm.label}
													</span>
													{isInherited && (
														<Badge variant="outline" className="text-xs">
															Inherited
														</Badge>
													)}
												</div>
												<p className="text-xs text-muted-foreground">
													{perm.description}
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

			{/* Actions */}
			<div className="flex justify-end gap-2 pt-2">
				<Button variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button onClick={handleSave} disabled={isSaving}>
					{isSaving && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
					{isEditing ? "Save Changes" : "Create Role"}
				</Button>
			</div>
		</div>
	);
}
