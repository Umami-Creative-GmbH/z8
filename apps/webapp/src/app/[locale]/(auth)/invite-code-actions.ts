"use server";

/**
 * Invite-code actions that run before the caller is a member of the
 * organization: the join and sign-up flows. Invite-code management (create,
 * list, revoke) is an organization setting and lives under the settings route.
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Effect } from "effect";
import type { AnyAppError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	InviteCodeService,
	InviteCodeServiceLive,
	type ValidateInviteCodeResult,
} from "@/lib/effect/services/invite-code.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("InviteCodeActions");

const tracer = () => trace.getTracer("invite-codes");

type JoinResult = {
	success: boolean;
	status: "pending" | "approved";
	organizationName: string;
};

/** Runs `effect` inside a span named `name` and ends the span either way. */
function traced<A, E extends AnyAppError, R>(
	name: string,
	attributes: Record<string, string>,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
	return tracer().startActiveSpan(name, { attributes }, (span) =>
		effect.pipe(
			Effect.tap(() => Effect.sync(() => span.setStatus({ code: SpanStatusCode.OK }))),
			Effect.tapError((error) =>
				Effect.sync(() =>
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message,
					}),
				),
			),
			Effect.ensuring(Effect.sync(() => span.end())),
		),
	);
}

/**
 * Validate an invite code (public endpoint)
 */
export async function validateInviteCode(
	code: string,
): Promise<ServerActionResult<ValidateInviteCodeResult>> {
	const effect = Effect.gen(function* () {
		const inviteCodeService = yield* InviteCodeService;
		return yield* inviteCodeService.validateCode(code);
	});

	return runServerActionSafe(
		traced("validateInviteCode", { "inviteCode.code": code }, effect).pipe(
			Effect.provide(InviteCodeServiceLive),
		),
	);
}

/**
 * Store a pending invite code for a user (called after registration)
 * This is called after signup when the user registered via /join/{code}
 * The code will be processed after email verification
 */
export async function storePendingInviteCode(code: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const inviteCodeService = yield* InviteCodeService;

		yield* inviteCodeService.setPendingInviteCode(session.user.id, code);

		logger.info({ userId: session.user.id, code }, "Stored pending invite code for user");
	});

	return runServerActionSafe(
		traced("storePendingInviteCode", { "inviteCode.code": code }, effect).pipe(
			Effect.provide(InviteCodeServiceLive),
		),
	);
}

/**
 * Process a user's pending invite code (called after email verification)
 * This is typically called by the email verification callback or hook
 */
export async function processPendingInviteCode(): Promise<ServerActionResult<JoinResult | null>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const inviteCodeService = yield* InviteCodeService;

		const result = yield* inviteCodeService.processPendingInviteCode(session.user.id);

		if (!result) {
			return null;
		}

		logger.info(
			{
				userId: session.user.id,
				organizationId: result.organizationId,
				status: result.status,
			},
			"Processed pending invite code",
		);

		return {
			success: result.success,
			status: result.status,
			organizationName: result.organizationName,
		};
	});

	return runServerActionSafe(
		traced("processPendingInviteCode", {}, effect).pipe(Effect.provide(InviteCodeServiceLive)),
	);
}


/**
 * Use an invite code to join an organization (requires authentication)
 */
export async function redeemInviteCode(
	code: string,
	ipAddress?: string,
	userAgent?: string,
): Promise<ServerActionResult<JoinResult>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const inviteCodeService = yield* InviteCodeService;

		const result = yield* inviteCodeService.useCode({
			code,
			userId: session.user.id,
			ipAddress,
			userAgent,
		});

		return {
			success: result.success,
			status: result.status,
			organizationName: result.organizationName,
		};
	});

	return runServerActionSafe(
		traced("redeemInviteCode", { "inviteCode.code": code }, effect).pipe(
			Effect.provide(InviteCodeServiceLive),
		),
	);
}
