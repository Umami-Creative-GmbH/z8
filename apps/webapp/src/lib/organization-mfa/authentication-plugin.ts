import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { PasskeyOptions } from "@better-auth/passkey";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import { z } from "zod";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { LocalMfaProof, MfaSession } from "./access";
import { hasRecentVerification } from "./policy";

export interface MfaAuthStore {
	revision(userId: string): Promise<number>;
	fingerprint(
		userId: string,
		method: "totp" | "passkey",
		factorId: string,
	): Promise<string | null>;
	saveProof(
		proof: LocalMfaProof & { revision: number; factorFingerprint: string },
	): Promise<void>;
	readProof(subject: MfaSession): Promise<LocalMfaProof | null>;
	readPrimary(
		subject: MfaSession,
	): Promise<{ method: string; verifiedAt: string } | null>;
	savePrimary(
		subject: MfaSession,
		method: "password" | "social" | "recovery",
		revision: number,
	): Promise<void>;
	recordRecovery(userId: string): Promise<void>;
	affected(userId: string): Promise<boolean>;
}

type PendingAuthentication = {
	userId: string;
	revision: number;
	session?: MfaSession;
	passwordVerified?: boolean;
	factorId?: string;
	factorFingerprint?: string;
	passkeyVerified?: boolean;
};
const pending = new WeakMap<object, PendingAuthentication>();
const asObject = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const field = (value: unknown, name: string) => {
	const found = asObject(value)[name];
	return typeof found === "string" ? found : undefined;
};

/** Only the installed passkey plugin calls this, after signature/challenge/origin/RP verification.
 * The UV bit is taken from the server's verification, never from request JSON. */
export const recordVerifiedMfaPasskey: NonNullable<
	NonNullable<PasskeyOptions["authentication"]>["afterVerification"]
> = async ({ verification }) => {
	const ctx = getCurrentAuthEndpointContext();
	if (ctx.path !== "/passkey/verify-authentication")
		throw new Error("Unexpected passkey verification context");
	const attempt = pending.get(ctx.context);
	if (
		attempt &&
		verification.verified &&
		verification.authenticationInfo.userVerified &&
		verification.authenticationInfo.credentialID === attempt.factorId
	)
		attempt.passkeyVerified = true;
};

const authenticationPaths = new Set([
	"/sign-in/email",
	"/callback/:id",
	"/oauth2/callback/:providerId",
	"/sso/callback",
	"/sso/callback/:providerId",
	"/sso/saml2/sp/acs/:providerId",
	"/reset-password",
	"/change-password",
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/verify-totp",
	"/two-factor/verify-backup-code",
	"/two-factor/generate-backup-codes",
	"/two-factor/get-totp-uri",
	"/passkey/verify-authentication",
	"/passkey/generate-register-options",
	"/passkey/verify-registration",
	"/passkey/delete-passkey",
]);
export function createMfaAuthenticationPlugin(
	store: MfaAuthStore,
): BetterAuthPlugin {
	return {
		id: "z8-mfa-authentication",
		rateLimit: [
			{
				pathMatcher: (path) => path === "/organization-mfa/verify-password",
				window: 60,
				max: 5,
			},
		],
		endpoints: {
			verifyMfaPassword: createAuthEndpoint(
				"/organization-mfa/verify-password",
				{ method: "POST", body: z.object({ password: z.string().min(1) }) },
				async (ctx) => {
					const subject = await getSessionFromCtx(ctx);
					if (!subject || subject.session.impersonatedBy)
						throw new APIError("UNAUTHORIZED");
					const revision = await store.revision(subject.user.id);
					const accounts = await ctx.context.internalAdapter.findAccounts(
						subject.user.id,
					);
					const credential = accounts.find(
						(entry) => entry.providerId === "credential" && entry.password,
					);
					if (
						!credential?.password ||
						!(await ctx.context.password.verify({
							hash: credential.password,
							password: ctx.body.password,
						}))
					)
						throw new APIError("UNAUTHORIZED", {
							message: "Password verification failed",
						});
					await store.savePrimary(subject.session, "password", revision);
					return ctx.json({ status: true });
				},
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) => authenticationPaths.has(ctx.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const body = asObject(ctx.body);
						const subject = await getSessionFromCtx(ctx);
						let userId = subject?.user.id;
						let passwordVerified = false;
						let factorId: string | undefined;
						let method: "totp" | "passkey" = "totp";
						if (
							ctx.path === "/sign-in/email" &&
							typeof body.email === "string"
						) {
							const user = await ctx.context.internalAdapter.findUserByEmail(
								body.email,
							);
							userId = user?.user.id;
						}
						if (ctx.path === "/reset-password") {
							const token = field(body, "token") ?? field(ctx.query, "token");
							if (token)
								userId = (
									await ctx.context.internalAdapter.findVerificationValue(
										`reset-password:${token}`,
									)
								)?.value;
						}
						if (ctx.path === "/passkey/verify-authentication") {
							const credentialID = field(body.response, "id");
							if (credentialID) {
								const key = await ctx.context.adapter.findOne<{
									id: string;
									userId: string;
								}>({
									model: "passkey",
									where: [{ field: "credentialID", value: credentialID }],
								});
								userId = key?.userId;
								// The verified result identifies the credential, rather than the database row ID.
								factorId = credentialID;
								method = "passkey";
							}
						}
						if (
							ctx.path === "/two-factor/verify-totp" ||
							ctx.path === "/two-factor/verify-backup-code"
						) {
							if (!subject) {
								const challengeCookie =
									ctx.context.createAuthCookie("two_factor");
								const challenge = await ctx.getSignedCookie(
									challengeCookie.name,
									ctx.context.secret,
								);
								if (challenge) {
									userId = (
										await ctx.context.internalAdapter.findVerificationValue(
											challenge,
										)
									)?.value;
									passwordVerified = !!userId;
								}
							} else {
								const primary = await store.readPrimary(subject.session);
								passwordVerified = primary?.method === "password";
								if (
									ctx.path === "/two-factor/verify-backup-code" &&
									(!passwordVerified ||
										!hasRecentVerification(
											primary?.verifiedAt,
											systemClock.nowInstant(),
										))
								)
									throw new APIError("FORBIDDEN", {
										code: "MFA_PASSWORD_REQUIRED",
										message:
											"Verify your password before using a recovery code",
									});
							}
							if (userId)
								factorId = (
									await ctx.context.adapter.findOne<{ id: string }>({
										model: "twoFactor",
										where: [{ field: "userId", value: userId }],
									})
								)?.id;
						}
						if (
							ctx.path === "/two-factor/verify-totp" &&
							subject &&
							!passwordVerified &&
							(await store.affected(subject.user.id))
						)
							throw new APIError("FORBIDDEN", {
								code: "MFA_PASSWORD_REQUIRED",
								message: "Verify your password before the authenticator code",
							});
						if (!userId) return;
						const revision = await store.revision(userId);
						let fingerprint: string | null = null;
						if (factorId) {
							let rowId: string | undefined = factorId;
							if (method === "passkey")
								rowId = (
									await ctx.context.adapter.findOne<{ id: string }>({
										model: "passkey",
										where: [{ field: "credentialID", value: factorId }],
									})
								)?.id;
							fingerprint = rowId
								? await store.fingerprint(userId, method, rowId)
								: null;
						}
						pending.set(ctx.context, {
							userId,
							revision,
							session: subject?.session,
							passwordVerified,
							factorId,
							factorFingerprint: fingerprint ?? undefined,
						});
						if (
							subject &&
							[
								"/two-factor/enable",
								"/two-factor/generate-backup-codes",
								"/two-factor/get-totp-uri",
								"/passkey/generate-register-options",
								"/passkey/verify-registration",
							].includes(ctx.path) &&
							(await store.affected(userId))
						) {
							if (subject.session.impersonatedBy)
								throw new APIError("FORBIDDEN");
							const keys = await ctx.context.adapter.findMany({
								model: "passkey",
								where: [{ field: "userId", value: userId }],
							});
							const factor = await ctx.context.adapter.findOne<{
								verified?: boolean;
							}>({
								model: "twoFactor",
								where: [{ field: "userId", value: userId }],
							});
							const enrolled =
								keys.length > 0 || (factor && factor.verified !== false);
							const proof = await store.readProof(subject.session);
							const primary = await store.readPrimary(subject.session);
							const recent =
								hasRecentVerification(
									proof?.verifiedAt,
									systemClock.nowInstant(),
								) ||
								(primary?.method === "recovery" &&
									hasRecentVerification(
										primary.verifiedAt,
										systemClock.nowInstant(),
									)) ||
								(!enrolled &&
									hasRecentVerification(
										primary?.verifiedAt,
										systemClock.nowInstant(),
									));
							if (!recent)
								throw new APIError("FORBIDDEN", {
									code: "MFA_RECENT_VERIFICATION_REQUIRED",
									message: enrolled
										? "Verify an existing authenticator or use recovery before adding a replacement"
										: "Verify your current sign-in method before enrolling",
								});
							if (
								ctx.path === "/passkey/generate-register-options" ||
								ctx.path === "/passkey/verify-registration"
							) {
								// The passkey plugin checks session creation rather than reauthentication.
								// Only this request may use the accepted five-minute evidence above.
								// Keep the durable session and its identity unchanged.
								ctx.context.session = {
									...subject,
									session: {
										...subject.session,
										createdAt: dateFromInstant(systemClock.nowInstant()),
									},
								};
							}
						}
					}),
				},
			],
			after: [
				{
					matcher: (ctx) => authenticationPaths.has(ctx.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const attempt = pending.get(ctx.context);
						pending.delete(ctx.context);
						const returned = asObject(ctx.context.returned);
						if (
							(ctx.context.returned instanceof APIError &&
								(ctx.context.returned.statusCode < 300 ||
									ctx.context.returned.statusCode >= 400)) ||
							returned.error
						)
							return;
						const fresh = ctx.context.newSession;
						const subject = fresh?.session ?? attempt?.session;
						const successful =
							typeof returned.token === "string" ||
							returned.status === true ||
							!!fresh;
						if (!successful) return;
						if (
							ctx.path === "/sign-in/email" &&
							fresh &&
							!returned.twoFactorRedirect &&
							typeof returned.token === "string"
						) {
							await store.savePrimary(
								fresh.session,
								"password",
								attempt?.revision ?? (await store.revision(fresh.user.id)),
							);
						}
						if (
							[
								"/callback/:id",
								"/oauth2/callback/:providerId",
								"/sso/callback",
								"/sso/callback/:providerId",
								"/sso/saml2/sp/acs/:providerId",
							].includes(ctx.path) &&
							fresh
						)
							await store.savePrimary(
								fresh.session,
								"social",
								await store.revision(fresh.user.id),
							);
						if (!attempt) return;
						if (ctx.path === "/two-factor/enable" && subject)
							await store.savePrimary(
								subject,
								"password",
								await store.revision(attempt.userId),
							);
						if (
							ctx.path === "/two-factor/verify-backup-code" &&
							subject &&
							attempt.passwordVerified
						) {
							await store.recordRecovery(attempt.userId);
							await store.savePrimary(
								subject,
								"recovery",
								await store.revision(attempt.userId),
							);
						}

						if (
							!subject ||
							subject.userId !== attempt.userId ||
							subject.impersonatedBy
						)
							return;
						if (
							(ctx.path === "/two-factor/verify-totp" &&
								attempt.passwordVerified) ||
							(ctx.path === "/passkey/verify-authentication" &&
								attempt.passkeyVerified)
						) {
							let factorId = attempt.factorId;
							const method =
								ctx.path === "/two-factor/verify-totp" ? "totp" : "passkey";
							if (method === "passkey" && factorId)
								factorId = (
									await ctx.context.adapter.findOne<{ id: string }>({
										model: "passkey",
										where: [{ field: "credentialID", value: factorId }],
									})
								)?.id;
							if (factorId && attempt.factorFingerprint)
								await store.saveProof({
									sessionId: subject.id,
									userId: subject.userId,
									method,
									factorId,
									verifiedAt: systemClock.nowInstant().toString(),
									revision: attempt.revision,
									factorFingerprint: attempt.factorFingerprint,
								});
						}
					}),
				},
			],
		},
	};
}
