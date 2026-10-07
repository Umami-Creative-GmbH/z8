"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import {
	type PaginatedResult,
	PlatformAdminService,
	type PlatformUser,
	type PlatformUserFilters,
	type UserSession,
} from "@/lib/effect/services/platform-admin.service";

export async function listUsersAction(
	filters: PlatformUserFilters,
	page: number,
	pageSize: number,
): Promise<ServerActionResult<PaginatedResult<PlatformUser>>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		yield* adminService.requirePlatformAdmin();

		// List users
		return yield* adminService.listUsers(filters, { page, pageSize });
	});

	return runServerActionSafe(effect);
}

export async function banUserAction(
	userId: string,
	reason: string,
	expiresAt: string | null,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Ban user
		yield* adminService.banUser(
			userId,
			reason,
			expiresAt ? new Date(expiresAt) : null,
			admin.userId,
		);

		revalidatePath("/platform-admin/users");
	});

	return runServerActionSafe(effect);
}

export async function unbanUserAction(userId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Unban user
		yield* adminService.unbanUser(userId, admin.userId);

		revalidatePath("/platform-admin/users");
	});

	return runServerActionSafe(effect);
}

export async function listUserSessionsAction(
	userId: string,
): Promise<ServerActionResult<UserSession[]>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		yield* adminService.requirePlatformAdmin();

		// List sessions
		return yield* adminService.listUserSessions(userId);
	});

	return runServerActionSafe(effect);
}

export async function revokeSessionAction(sessionId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Revoke session
		yield* adminService.revokeSession(sessionId, admin.userId);
	});

	return runServerActionSafe(effect);
}

export async function revokeAllUserSessionsAction(
	userId: string,
): Promise<ServerActionResult<number>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;

		// Verify platform admin access
		const admin = yield* adminService.requirePlatformAdmin();

		// Revoke all sessions
		return yield* adminService.revokeAllUserSessions(userId, admin.userId);
	});

	return runServerActionSafe(effect);
}
