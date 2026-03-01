"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	PlatformAdminService,
	type PlatformOrganization,
	type PlatformOrgFilters,
	type PaginatedResult,
} from "@/lib/effect/services/platform-admin.service";

export async function listOrganizationsAction(
	filters: PlatformOrgFilters,
	page: number,
	pageSize: number,
): Promise<ServerActionResult<PaginatedResult<PlatformOrganization>>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		yield* _(adminService.requirePlatformAdmin());

		// List organizations
		return yield* _(adminService.listOrganizations(filters, { page, pageSize }));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function suspendOrganizationAction(
	organizationId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Suspend organization
		yield* _(adminService.suspendOrganization(organizationId, reason, admin.userId));

		revalidatePath("/platform-admin/organizations");
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function unsuspendOrganizationAction(
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Unsuspend organization
		yield* _(adminService.unsuspendOrganization(organizationId, admin.userId));

		revalidatePath("/platform-admin/organizations");
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteOrganizationAction(
	organizationId: string,
	immediate: boolean,
	skipNotification: boolean,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Delete organization
		yield* _(
			adminService.deleteOrganization(
				organizationId,
				immediate,
				skipNotification,
				admin.userId,
			),
		);

		revalidatePath("/platform-admin/organizations");
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
