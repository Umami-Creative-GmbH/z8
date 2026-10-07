"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import {
	type PaginatedResult,
	PlatformAdminService,
	type PlatformOrganization,
	type PlatformOrgFilters,
} from "@/lib/effect/services/platform-admin.service";

export async function listOrganizationsAction(
	filters: PlatformOrgFilters,
	page: number,
	pageSize: number,
): Promise<ServerActionResult<PaginatedResult<PlatformOrganization>>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		yield* adminService.requirePlatformAdmin();

		// List organizations
		return yield* adminService.listOrganizations(filters, { page, pageSize });
	});

	return runServerActionSafe(effect);
}

export async function suspendOrganizationAction(
	organizationId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Suspend organization
		yield* adminService.suspendOrganization(organizationId, reason, admin.userId);

		revalidatePath("/platform-admin/organizations");
	});

	return runServerActionSafe(effect);
}

export async function unsuspendOrganizationAction(
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Unsuspend organization
		yield* adminService.unsuspendOrganization(organizationId, admin.userId);

		revalidatePath("/platform-admin/organizations");
	});

	return runServerActionSafe(effect);
}

export async function deleteOrganizationAction(
	organizationId: string,
	immediate: boolean,
	skipNotification: boolean,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Delete organization
		yield* adminService.deleteOrganization(
			organizationId,
			immediate,
			skipNotification,
			admin.userId,
		);

		revalidatePath("/platform-admin/organizations");
	});

	return runServerActionSafe(effect);
}
