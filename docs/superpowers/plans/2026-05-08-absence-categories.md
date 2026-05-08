# Absence Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-admin absence category CRUD to `/settings/vacation` and ensure every organization has useful default categories.

**Architecture:** Reuse the existing vacation settings tab shell, server action style, TanStack Query, and `ActionPanel` form patterns. Keep category defaults in one shared server-side module so the vacation page bootstrap and demo data cannot drift.

**Tech Stack:** Next.js App Router, React, TanStack Query, TanStack Form, Drizzle ORM, Effect server action helpers, Tolgee translations, pnpm.

---

## File Structure

- Create `apps/webapp/src/lib/absences/default-absence-categories.ts`: exports the default absence category definitions and an idempotent `ensureDefaultAbsenceCategoriesForOrganization` helper.
- Modify `apps/webapp/src/lib/demo/demo-data.service.ts`: reuse the shared default helper instead of local default category logic.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`: add absence category list/create/update/delete actions with org-admin authorization and organization scoping.
- Modify `apps/webapp/src/lib/query/keys.ts`: add `absenceCategories` query keys.
- Create `apps/webapp/src/components/settings/absence-category-form.tsx`: `ActionPanel` create/edit form using TanStack Form.
- Create `apps/webapp/src/components/settings/absence-categories-table.tsx`: table, toolbar, mutations, and delete/deactivate/reactivate flows.
- Modify `apps/webapp/src/components/settings/vacation-management.tsx`: add the new `Categories` tab between policies and assignments.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`: call the default seeding helper when the page loads and pass `canManageCategories` to the tab shell.

## Task 1: Shared Default Absence Categories

**Files:**
- Create: `apps/webapp/src/lib/absences/default-absence-categories.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`

- [ ] **Step 1: Create the shared defaults module**

Create `apps/webapp/src/lib/absences/default-absence-categories.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory } from "@/db/schema";

export const defaultAbsenceCategories = [
	{
		type: "vacation",
		name: "Vacation",
		description: "Paid time off",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: true,
		color: "#10b981",
	},
	{
		type: "sick",
		name: "Sick Leave",
		description: "Sick day",
		requiresWorkTime: false,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#ef4444",
	},
	{
		type: "personal",
		name: "Personal Day",
		description: "Personal time off",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#8b5cf6",
	},
	{
		type: "home_office",
		name: "Home Office",
		description: "Remote work day",
		requiresWorkTime: true,
		requiresApproval: false,
		countsAgainstVacation: false,
		color: "#3b82f6",
	},
	{
		type: "unpaid",
		name: "Unpaid Leave",
		description: "Unpaid absence",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#f59e0b",
	},
	{
		type: "parental",
		name: "Parental Leave",
		description: "Parental leave absence",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#06b6d4",
	},
	{
		type: "bereavement",
		name: "Bereavement",
		description: "Bereavement leave",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
		color: "#64748b",
	},
] satisfies Array<Omit<typeof absenceCategory.$inferInsert, "organizationId" | "isActive">>;

export async function ensureDefaultAbsenceCategoriesForOrganization(organizationId: string) {
	const existingCategories = await db.query.absenceCategory.findMany({
		where: eq(absenceCategory.organizationId, organizationId),
	});

	const existingTypes = new Set(existingCategories.map((category) => category.type));
	const categoriesToCreate = defaultAbsenceCategories
		.filter((category) => !existingTypes.has(category.type))
		.map((category) => ({
			...category,
			organizationId,
			isActive: true,
		}));

	if (categoriesToCreate.length === 0) {
		return { created: 0 };
	}

	await db.insert(absenceCategory).values(categoriesToCreate);

	return { created: categoriesToCreate.length };
}
```

- [ ] **Step 2: Replace demo-local defaults**

In `apps/webapp/src/lib/demo/demo-data.service.ts`, import the helper:

```ts
import { ensureDefaultAbsenceCategoriesForOrganization } from "@/lib/absences/default-absence-categories";
```

Replace the local `ensureDefaultAbsenceCategories` function body with:

```ts
async function ensureDefaultAbsenceCategories(organizationId: string) {
	await ensureDefaultAbsenceCategoriesForOrganization(organizationId);
}
```

- [ ] **Step 3: Run typecheck for defaults changes**

Run: `pnpm --filter webapp typecheck`

Expected: command exits successfully. If the package has no `typecheck` script, run `pnpm --filter webapp lint` and record that substitution.

## Task 2: Server Actions And Query Keys

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`
- Modify: `apps/webapp/src/lib/query/keys.ts`

- [ ] **Step 1: Add imports**

Update the schema import in `actions.ts` to include `absenceCategory`:

```ts
import {
	absenceCategory,
	employee,
	employeeVacationAllowance,
	vacationAdjustment,
	vacationAllowance,
} from "@/db/schema";
```

- [ ] **Step 2: Add absence category types and actions**

Append these exports to `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`:

```ts
type AbsenceCategoryType =
	| "home_office"
	| "sick"
	| "vacation"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom";

export async function getAbsenceCategoriesForSettings(
	organizationId: string,
): Promise<ServerActionResult<(typeof absenceCategory.$inferSelect)[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getAbsenceCategoriesForSettings:actor" }),
		);

		if (actor.organizationId !== organizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "absence_category",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		return yield* _(
			dbService.query("getAbsenceCategoriesForSettings", async () => {
				return await dbService.db.query.absenceCategory.findMany({
					where: eq(absenceCategory.organizationId, organizationId),
					orderBy: [desc(absenceCategory.isActive), desc(absenceCategory.createdAt)],
				});
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createAbsenceCategory(data: {
	organizationId: string;
	type: AbsenceCategoryType;
	name: string;
	description?: string | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color?: string | null;
}): Promise<ServerActionResult<typeof absenceCategory.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ organizationId: data.organizationId, queryName: "createAbsenceCategory:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "absence_category",
				action: "create",
			}),
		);

		const name = data.name.trim();
		if (!name) {
			yield* _(Effect.fail(new ConflictError({ message: "Name is required" })));
		}

		const dbService = yield* _(DatabaseService);
		const [created] = yield* _(
			dbService.query("createAbsenceCategory", async () => {
				return await dbService.db
					.insert(absenceCategory)
					.values({
						organizationId: data.organizationId,
						type: data.type,
						name,
						description: data.description?.trim() || null,
						requiresWorkTime: data.requiresWorkTime,
						requiresApproval: data.requiresApproval,
						countsAgainstVacation: data.countsAgainstVacation,
						color: data.color?.trim() || null,
						isActive: true,
					})
					.returning();
			}),
		);

		return created;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function updateAbsenceCategory(
	categoryId: string,
	data: {
		type: AbsenceCategoryType;
		name: string;
		description?: string | null;
		requiresWorkTime: boolean;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
		color?: string | null;
		isActive: boolean;
	},
): Promise<ServerActionResult<typeof absenceCategory.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "updateAbsenceCategory:actor" }));
		const dbService = yield* _(DatabaseService);
		const existing = yield* _(
			dbService.query("getAbsenceCategoryForUpdate", async () => {
				return await dbService.db.query.absenceCategory.findFirst({ where: eq(absenceCategory.id, categoryId) });
			}),
		);

		if (!existing) {
			yield* _(Effect.fail(new NotFoundError({ message: "Absence category not found", resource: "absence_category", id: categoryId })));
		}

		if (existing.organizationId !== actor.organizationId) {
			yield* _(Effect.fail(new AuthorizationError({ message: "Insufficient permissions", userId: actor.session.user.id, resource: "absence_category", action: "update" })));
		}

		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "absence_category",
				action: "update",
			}),
		);

		const name = data.name.trim();
		if (!name) {
			yield* _(Effect.fail(new ConflictError({ message: "Name is required" })));
		}

		const [updated] = yield* _(
			dbService.query("updateAbsenceCategory", async () => {
				return await dbService.db
					.update(absenceCategory)
					.set({
						type: data.type,
						name,
						description: data.description?.trim() || null,
						requiresWorkTime: data.requiresWorkTime,
						requiresApproval: data.requiresApproval,
						countsAgainstVacation: data.countsAgainstVacation,
						color: data.color?.trim() || null,
						isActive: data.isActive,
					})
					.where(eq(absenceCategory.id, categoryId))
					.returning();
			}),
		);

		return updated;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteAbsenceCategory(
	categoryId: string,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteAbsenceCategory:actor" }));
		const dbService = yield* _(DatabaseService);
		const existing = yield* _(
			dbService.query("getAbsenceCategoryForDelete", async () => {
				return await dbService.db.query.absenceCategory.findFirst({ where: eq(absenceCategory.id, categoryId) });
			}),
		);

		if (!existing) {
			yield* _(Effect.fail(new NotFoundError({ message: "Absence category not found", resource: "absence_category", id: categoryId })));
		}

		if (existing.organizationId !== actor.organizationId) {
			yield* _(Effect.fail(new AuthorizationError({ message: "Insufficient permissions", userId: actor.session.user.id, resource: "absence_category", action: "delete" })));
		}

		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "absence_category",
				action: "delete",
			}),
		);

		await dbService.query("deleteAbsenceCategory", async () => {
			await dbService.db.delete(absenceCategory).where(eq(absenceCategory.id, categoryId));
		});

		return { id: categoryId };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 3: Add query key**

In `apps/webapp/src/lib/query/keys.ts`, add after `absencePlanPreview`:

```ts
	absenceCategories: {
		all: ["absence-categories"] as const,
		list: (orgId: string) => ["absence-categories", orgId] as const,
	},
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter webapp typecheck`

Expected: PASS, or fix exact TypeScript errors before continuing.

## Task 3: Category Form

**Files:**
- Create: `apps/webapp/src/components/settings/absence-category-form.tsx`

- [ ] **Step 1: Create the form component**

Create `apps/webapp/src/components/settings/absence-category-form.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { createAbsenceCategory, updateAbsenceCategory } from "@/app/[locale]/(app)/settings/vacation/actions";
import { ActionPanel, ActionPanelBody, ActionPanelContent, ActionPanelDescription, ActionPanelFooter, ActionPanelHeader, ActionPanelTitle } from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const absenceTypes = ["vacation", "sick", "personal", "home_office", "unpaid", "parental", "bereavement", "custom"] as const;

export interface AbsenceCategoryForSettings {
	id: string;
	type: (typeof absenceTypes)[number];
	name: string;
	description: string | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color: string | null;
	isActive: boolean;
}

interface AbsenceCategoryFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	existingCategory?: AbsenceCategoryForSettings | null;
	onSuccess: () => void;
}

export function AbsenceCategoryForm({ open, onOpenChange, organizationId, existingCategory, onSuccess }: AbsenceCategoryFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: existingCategory
			? {
					name: existingCategory.name,
					type: existingCategory.type,
					description: existingCategory.description ?? "",
					requiresWorkTime: existingCategory.requiresWorkTime,
					requiresApproval: existingCategory.requiresApproval,
					countsAgainstVacation: existingCategory.countsAgainstVacation,
					color: existingCategory.color ?? "#3b82f6",
					isActive: existingCategory.isActive,
				}
			: {
					name: "",
					type: "custom" as const,
					description: "",
					requiresWorkTime: false,
					requiresApproval: true,
					countsAgainstVacation: false,
					color: "#3b82f6",
					isActive: true,
				},
		onSubmit: async ({ value }) => {
			setLoading(true);
			try {
				const result = existingCategory
					? await updateAbsenceCategory(existingCategory.id, value)
					: await createAbsenceCategory({ organizationId, ...value });

				if (result.success) {
					toast.success(existingCategory ? t("settings.vacation.categories.updated", "Category updated") : t("settings.vacation.categories.created", "Category created"));
					onSuccess();
					onOpenChange(false);
				} else {
					toast.error(result.error || t("settings.vacation.categories.saveFailed", "Failed to save category"));
				}
			} catch (_error) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			} finally {
				setLoading(false);
			}
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{existingCategory ? t("settings.vacation.categories.edit", "Edit Absence Category") : t("settings.vacation.categories.create", "Create Absence Category")}</ActionPanelTitle>
					<ActionPanelDescription>{t("settings.vacation.categories.description", "Configure the absence types employees can select when requesting time away.")}</ActionPanelDescription>
				</ActionPanelHeader>

				<form onSubmit={(event) => { event.preventDefault(); form.handleSubmit(); }} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-6">
						<form.Field name="name" validators={{ onChange: z.string().min(1, "Name is required").max(100, "Name too long") }}>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="absence-category-name">Name</Label>
									<Input id="absence-category-name" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} onBlur={field.handleBlur} placeholder="e.g., Training Day" />
								</div>
							)}
						</form.Field>

						<form.Field name="type">
							{(field) => (
								<div className="space-y-2">
									<Label>Type</Label>
									<Select value={field.state.value} onValueChange={(value) => field.handleChange(value as typeof absenceTypes[number])}>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>{absenceTypes.map((type) => <SelectItem key={type} value={type}>{type.replace("_", " ")}</SelectItem>)}</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => <div className="space-y-2"><Label htmlFor="absence-category-description">Description</Label><Input id="absence-category-description" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></div>}
						</form.Field>

						<form.Field name="color">
							{(field) => <div className="space-y-2"><Label htmlFor="absence-category-color">Color</Label><Input id="absence-category-color" type="color" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /></div>}
						</form.Field>

						<form.Field name="requiresApproval">
							{(field) => <label className="flex items-center gap-2"><Checkbox checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />Requires approval</label>}
						</form.Field>

						<form.Field name="countsAgainstVacation">
							{(field) => <label className="flex items-center gap-2"><Checkbox checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />Counts against vacation balance</label>}
						</form.Field>

						<form.Field name="requiresWorkTime">
							{(field) => <label className="flex items-center gap-2"><Checkbox checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />Requires work time on this day</label>}
						</form.Field>

						<form.Field name="isActive">
							{(field) => <div className="flex items-center justify-between rounded-lg border p-3"><Label>Active</Label><Switch checked={field.state.value} onCheckedChange={field.handleChange} /></div>}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
						<Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save category"}</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
```

- [ ] **Step 2: Run lint/typecheck**

Run: `pnpm --filter webapp typecheck`

Expected: PASS. Fix any JSX formatting or type issues before continuing.

## Task 4: Categories Table

**Files:**
- Create: `apps/webapp/src/components/settings/absence-categories-table.tsx`

- [ ] **Step 1: Create the categories table component**

Create `apps/webapp/src/components/settings/absence-categories-table.tsx` with this behavior:

```tsx
"use client";

import { IconDots, IconPencil, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteAbsenceCategory, getAbsenceCategoriesForSettings, updateAbsenceCategory } from "@/app/[locale]/(app)/settings/vacation/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { queryKeys } from "@/lib/query";
import { AbsenceCategoryForm, type AbsenceCategoryForSettings } from "./absence-category-form";

interface AbsenceCategoriesTableProps {
	organizationId: string;
	canManageCategories: boolean;
}

export function AbsenceCategoriesTable({ organizationId, canManageCategories }: AbsenceCategoriesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [editingCategory, setEditingCategory] = useState<AbsenceCategoryForSettings | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);
	const [categoryToDelete, setCategoryToDelete] = useState<AbsenceCategoryForSettings | null>(null);

	const queryKey = queryKeys.absenceCategories.list(organizationId);
	const { data: categories, isLoading, isFetching, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getAbsenceCategoriesForSettings(organizationId);
			if (!result.success) throw new Error(result.error || "Failed to fetch absence categories");
			return result.data as AbsenceCategoryForSettings[];
		},
	});

	const invalidate = () => queryClient.invalidateQueries({ queryKey });

	const statusMutation = useMutation({
		mutationFn: (category: AbsenceCategoryForSettings) => updateAbsenceCategory(category.id, { ...category, isActive: !category.isActive }),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.vacation.categories.statusUpdated", "Category status updated"));
				invalidate();
			} else {
				toast.error(result.error || t("settings.vacation.categories.statusFailed", "Failed to update status"));
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (categoryId: string) => deleteAbsenceCategory(categoryId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.vacation.categories.deleted", "Category deleted"));
				setCategoryToDelete(null);
				invalidate();
			} else {
				toast.error(result.error || t("settings.vacation.categories.deleteFailed", "Failed to delete category"));
			}
		},
	});

	const columns = useMemo<ColumnDef<AbsenceCategoryForSettings>[]>(() => [
		{ accessorKey: "name", header: t("settings.vacation.categories.name", "Name"), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
		{ accessorKey: "type", header: t("settings.vacation.categories.type", "Type"), cell: ({ row }) => <Badge variant="secondary">{row.original.type.replace("_", " ")}</Badge> },
		{ accessorKey: "requiresApproval", header: t("settings.vacation.categories.approval", "Approval"), cell: ({ row }) => row.original.requiresApproval ? "Required" : "Not required" },
		{ accessorKey: "countsAgainstVacation", header: t("settings.vacation.categories.balance", "Balance"), cell: ({ row }) => row.original.countsAgainstVacation ? "Deducts vacation" : "No deduction" },
		{ accessorKey: "isActive", header: t("settings.vacation.categories.status", "Status"), cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Active" : "Inactive"}</Badge> },
		{
			id: "actions",
			cell: ({ row }) => canManageCategories ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><IconDots className="size-4" /><span className="sr-only">Open menu</span></Button></DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditingCategory(row.original)}><IconPencil className="mr-2 size-4" />Edit</DropdownMenuItem>
						<DropdownMenuItem onClick={() => statusMutation.mutate(row.original)}>{row.original.isActive ? "Deactivate" : "Reactivate"}</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-destructive" onClick={() => setCategoryToDelete(row.original)}><IconTrash className="mr-2 size-4" />Delete</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null,
		},
	], [canManageCategories, statusMutation, t]);

	if (isLoading) return <DataTableSkeleton columnCount={6} rowCount={5} />;

	return (
		<div className="space-y-4">
			<DataTableToolbar searchPlaceholder="Search categories..." searchValue="" onSearchChange={() => {}} actions={(
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><IconRefresh className="mr-2 size-4" />Refresh</Button>
					{canManageCategories && <Button size="sm" onClick={() => setCreateFormOpen(true)}><IconPlus className="mr-2 size-4" />Add category</Button>}
				</div>
			)} />
			<DataTable columns={columns} data={categories ?? []} pageCount={1} />
			<AbsenceCategoryForm open={createFormOpen || editingCategory !== null} onOpenChange={(open) => { if (!open) { setCreateFormOpen(false); setEditingCategory(null); } }} organizationId={organizationId} existingCategory={editingCategory} onSuccess={invalidate} />
			<AlertDialog open={categoryToDelete !== null} onOpenChange={(open) => !open && setCategoryToDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader><AlertDialogTitle>Delete absence category?</AlertDialogTitle><AlertDialogDescription>This removes the category from future selection. If existing records reference it, the database may reject the delete; deactivate it instead.</AlertDialogDescription></AlertDialogHeader>
					<AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => categoryToDelete && deleteMutation.mutate(categoryToDelete.id)}>Delete</AlertDialogAction></AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
```

- [ ] **Step 2: Adjust for actual `DataTableToolbar`/`DataTable` props**

Compare the component with `apps/webapp/src/components/settings/vacation-policies-table.tsx` and align prop names exactly. Keep the table behavior above unchanged.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter webapp typecheck`

Expected: PASS.

## Task 5: Wire The New Tab And Lazy Defaults

**Files:**
- Modify: `apps/webapp/src/components/settings/vacation-management.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`

- [ ] **Step 1: Update `VacationManagement` props and imports**

In `apps/webapp/src/components/settings/vacation-management.tsx`, import the table:

```ts
import { AbsenceCategoriesTable } from "./absence-categories-table";
```

Add `canManageCategories: boolean;` to `VacationManagementProps` and function props.

- [ ] **Step 2: Add the tab between policies and assignments**

Update the tab list/content so it contains this order:

```tsx
<TabsTrigger value="policies">{t("settings.vacation.tab.policies", "Policies")}</TabsTrigger>
<TabsTrigger value="categories">{t("settings.vacation.tab.categories", "Categories")}</TabsTrigger>
<TabsTrigger value="assignments">{t("settings.vacation.tab.assignments", "Assignments")}</TabsTrigger>
```

Add content before assignments:

```tsx
<TabsContent value="categories" className="space-y-4">
	<AbsenceCategoriesTable organizationId={organizationId} canManageCategories={canManageCategories} />
</TabsContent>
```

- [ ] **Step 3: Seed defaults from the vacation settings page**

In `apps/webapp/src/app/[locale]/(app)/settings/vacation/page.tsx`, import:

```ts
import { ensureDefaultAbsenceCategoriesForOrganization } from "@/lib/absences/default-absence-categories";
```

After `organizationId` is validated, call:

```ts
await ensureDefaultAbsenceCategoriesForOrganization(organizationId);
```

Pass `canManageCategories={canManagePolicies}` to `VacationManagement`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter webapp typecheck`

Expected: PASS.

## Task 6: Verification And Review

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run formatting/lint/type verification**

Run: `pnpm --filter webapp lint`

Expected: PASS.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter webapp test`

Expected: PASS. If tests require unavailable env vars, record the skipped command and the missing dependency in the final response.

- [ ] **Step 3: Manual behavior check**

Start the app if dependencies are available:

```bash
pnpm dev
```

Expected in `/settings/vacation`: tabs are ordered `Policies`, `Categories`, `Assignments`; the Categories tab lists seeded defaults; org admins can create, edit, deactivate/reactivate, and delete categories.

- [ ] **Step 4: Completion summary**

Report changed files, verification commands, and any skipped checks. Do not commit unless the user explicitly asks for a commit.

## Self-Review

- Spec coverage: UI tab, org-admin CRUD, editable defaults, lazy default seeding, demo default reuse, and verification are all covered.
- Placeholder scan: no TBD/TODO placeholders remain; the plan includes explicit files, code, and commands.
- Type consistency: category type strings match `absenceTypeEnum`; form/table types use the same `AbsenceCategoryForSettings` interface; query key name is consistent across tasks.
