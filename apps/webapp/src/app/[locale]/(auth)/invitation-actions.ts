"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { type AnyAppError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
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
				catch: (error): DatabaseError =>
					new DatabaseError({
						message: "Failed to load pending invitation",
						operation: "select",
						table: "invitation",
						cause: error,
					}),
			}),
		);

		if (!invitation) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Invitation not found or does not match the signed-in user",
						entityType: "invitation",
						entityId: invitationId,
					}),
				),
			);
		}

		yield* _(
			Effect.tryPromise({
				try: async () => {
					await db
						.update(authSchema.user)
						.set({ invitedVia: invitationId })
						.where(eq(authSchema.user.email, email));
				},
				catch: (error): DatabaseError =>
					new DatabaseError({
						message: "Failed to store pending invitation",
						operation: "update",
						table: "user",
						cause: error,
					}),
			}),
		);
	});

	return runServerActionSafe(
		effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<void, AnyAppError, never>,
	);
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
				catch: (error): DatabaseError =>
					new DatabaseError({
						message: "Failed to load user invitation state",
						operation: "select",
						table: "user",
						cause: error,
					}),
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
				catch: (error): DatabaseError =>
					new DatabaseError({
						message: "Failed to load pending invitation",
						operation: "select",
						table: "invitation",
						cause: error,
					}),
			}),
		);

		if (!invitation || invitation.expiresAt < new Date()) {
			return null;
		}

		return invitation.id;
	});

	return runServerActionSafe(
		effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<string | null, AnyAppError, never>,
	);
}
