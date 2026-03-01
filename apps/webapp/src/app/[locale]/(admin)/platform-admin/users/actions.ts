"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import {
	PlatformAdminService,
	type PlatformUser,
	type PlatformUserFilters,
	type PaginatedResult,
	type UserSession,
} from "@/lib/effect/services/platform-admin.service";

export async function listUsersAction(
	filters: PlatformUserFilters,
	page: number,
	pageSize: number,
): Promise<ServerActionResult<PaginatedResult<PlatformUser>>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		yield* _(adminService.requirePlatformAdmin());

		// List users
		return yield* _(adminService.listUsers(filters, { page, pageSize }));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function banUserAction(
	userId: string,
	reason: string,
	expiresAt: string | null,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Ban user
		yield* _(
			adminService.banUser(
				userId,
				reason,
				expiresAt ? new Date(expiresAt) : null,
				admin.userId,
			),
		);

		revalidatePath("/platform-admin/users");
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function unbanUserAction(
	userId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Unban user
		yield* _(adminService.unbanUser(userId, admin.userId));

		revalidatePath("/platform-admin/users");
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function listUserSessionsAction(
	userId: string,
): Promise<ServerActionResult<UserSession[]>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		yield* _(adminService.requirePlatformAdmin());

		// List sessions
		return yield* _(adminService.listUserSessions(userId));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function revokeSessionAction(
	sessionId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Revoke session
		yield* _(adminService.revokeSession(sessionId, admin.userId));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function revokeAllUserSessionsAction(
	userId: string,
): Promise<ServerActionResult<number>> {
	const effect = Effect.gen(function* (_) {
		const adminService = yield* _(PlatformAdminService);

		// Verify platform admin access
		const admin = yield* _(adminService.requirePlatformAdmin());

		// Revoke all sessions
		return yield* _(adminService.revokeAllUserSessions(userId, admin.userId));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
