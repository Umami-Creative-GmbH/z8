"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";

export async function storePendingInvitation(
	invitationId: string,
	email: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const invitation = yield* _(
			Effect.tryPromise({
				try: async () =>
					db.query.invitation.findFirst({
						where: and(
							eq(authSchema.invitation.id, invitationId),
							eq(authSchema.invitation.email, email),
							eq(authSchema.invitation.status, "pending"),
						),
					}),
				catch: (error) =>
					error instanceof Error ? error : new Error("Failed to load pending invitation"),
			}),
		);

		if (!invitation) {
			throw new Error("Invitation not found or does not match the signed-in user");
		}

		yield* _(
			Effect.tryPromise({
				try: async () => {
					await db
						.update(authSchema.user)
						.set({ invitedVia: invitationId })
						.where(eq(authSchema.user.email, email));
				},
				catch: (error) =>
					error instanceof Error ? error : new Error("Failed to store pending invitation"),
			}),
		);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getPendingInvitation(): Promise<ServerActionResult<string | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const userRecord = yield* _(
			Effect.tryPromise({
				try: async () =>
					db.query.user.findFirst({
						where: eq(authSchema.user.id, session.user.id),
						columns: {
							invitedVia: true,
						},
					}),
				catch: (error) =>
					error instanceof Error ? error : new Error("Failed to load user invitation state"),
			}),
		);
		const pendingInvitationId = userRecord?.invitedVia;

		if (!pendingInvitationId) {
			return null;
		}

		const invitation = yield* _(
			Effect.tryPromise({
				try: async () =>
					db.query.invitation.findFirst({
						where: and(
							eq(authSchema.invitation.id, pendingInvitationId),
							eq(authSchema.invitation.email, session.user.email),
							eq(authSchema.invitation.status, "pending"),
						),
					}),
				catch: (error) =>
					error instanceof Error ? error : new Error("Failed to load pending invitation"),
			}),
		);

		if (!invitation || invitation.expiresAt < new Date()) {
			return null;
		}

		return invitation.id;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}