"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { type AnyAppError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

export async function storePendingInvitation(
	invitationId: string,
	email: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const invitation = yield* dbService.query("invitation.getPending", async () =>
			db.query.invitation.findFirst({
				where: and(
					eq(authSchema.invitation.id, invitationId),
					eq(authSchema.invitation.email, email),
					eq(authSchema.invitation.status, "pending"),
				),
			}),
		);

		if (!invitation) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Invitation not found or does not match the signed-in user",
					entityType: "invitation",
					entityId: invitationId,
				}),
			);
		}

		yield* dbService.query("invitation.storePending", async () => {
			await db
				.update(authSchema.user)
				.set({ invitedVia: invitationId })
				.where(eq(authSchema.user.email, email));
		});
	});

	return runServerActionSafe(
		effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<void, AnyAppError, never>,
	);
}

export async function getPendingInvitation(): Promise<ServerActionResult<string | null>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		const userRecord = yield* dbService.query("invitation.getUserInvitedVia", async () =>
			db.query.user.findFirst({
				where: eq(authSchema.user.id, session.user.id),
				columns: {
					invitedVia: true,
				},
			}),
		);
		const pendingInvitationId = userRecord?.invitedVia;

		if (!pendingInvitationId) {
			return null;
		}

		const invitation = yield* dbService.query("invitation.getPending", async () =>
			db.query.invitation.findFirst({
				where: and(
					eq(authSchema.invitation.id, pendingInvitationId),
					eq(authSchema.invitation.email, session.user.email),
					eq(authSchema.invitation.status, "pending"),
				),
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
