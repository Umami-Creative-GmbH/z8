import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";
import { describe, expect, it, vi } from "vitest";
import { type SecurityAlert, securityAlerts } from "./security-alerts";

const password = "Synthetic-password-123";
const newPassword = "Synthetic-password-456";
const client = { "x-forwarded-for": "203.0.113.7", "user-agent": "Synthetic Browser/1.0" };

async function setup() {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
		twoFactor: [],
	};
	const alerts: SecurityAlert[] = [];
	const sendResetPassword = vi.fn();
	const auth = betterAuth({
		baseURL: "https://app.example.com",
		secret: "synthetic-security-alert-secret-with-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: { enabled: true, sendResetPassword },
		rateLimit: { enabled: false },
		plugins: [
			securityAlerts(async (alert) => {
				alerts.push(alert);
			}),
			twoFactor({ issuer: "Z8" }),
			admin(),
		],
	});
	const context = await auth.$context;

	/** A user with a credential and a browser session cookie. */
	async function signedInUser(email = "person@example.com") {
		const user = await context.internalAdapter.createUser({
			name: "Person",
			email,
			emailVerified: true,
		});
		await context.internalAdapter.createAccount({
			userId: user.id,
			providerId: "credential",
			accountId: user.id,
			password: await context.password.hash(password),
		});
		const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
		const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
		return { user, headers: new Headers({ cookie, ...client }) };
	}

	/** A password reset token for the address, as the reset email would carry it. */
	async function resetToken(email: string) {
		sendResetPassword.mockClear();
		await auth.api.requestPasswordReset({ body: { email } });
		return sendResetPassword.mock.calls[0]?.[0]?.token as string;
	}

	/** Turns two-factor on as the security settings do: enable, then verify a TOTP code. */
	async function enableTwoFactor(headers: Headers) {
		await auth.api.enableTwoFactor({ body: { password }, headers });
		const secret = await symmetricDecrypt({
			key: context.secretConfig,
			data: String(data.twoFactor[0]?.secret),
		});
		const { code } = await auth.api.generateTOTP({ body: { secret } });
		const verified = await auth.api.verifyTOTP({ body: { code }, headers, returnHeaders: true });
		const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0];
		return new Headers({ cookie, ...client });
	}

	return { auth, context, alerts, signedInUser, resetToken, enableTwoFactor };
}

describe("security alerts (#1180)", () => {
	it("alerts the user whose password was changed, with the request's IP and user agent", async () => {
		const { auth, alerts, signedInUser } = await setup();
		const { user, headers } = await signedInUser();

		await auth.api.changePassword({
			body: { currentPassword: password, newPassword },
			headers,
		});

		expect(alerts).toEqual([
			{
				event: "password_changed",
				userId: user.id,
				ipAddress: "203.0.113.7",
				userAgent: "Synthetic Browser/1.0",
			},
		]);
	});

	it("alerts the user whose password a reset link replaced", async () => {
		const { auth, alerts, signedInUser, resetToken } = await setup();
		const { user } = await signedInUser();
		const token = await resetToken(user.email);

		await auth.api.resetPassword({
			body: { newPassword, token },
			headers: new Headers(client),
		});

		expect(alerts).toEqual([
			{
				event: "password_changed",
				userId: user.id,
				ipAddress: "203.0.113.7",
				userAgent: "Synthetic Browser/1.0",
			},
		]);
	});

	it("alerts the user, not the admin, when an admin sets the user's password", async () => {
		const { auth, context, alerts, signedInUser } = await setup();
		const { user } = await signedInUser();
		const { user: platformAdmin, headers } = await signedInUser("admin@example.com");
		await context.internalAdapter.updateUser(platformAdmin.id, { role: "admin" });

		await auth.api.setUserPassword({ body: { userId: user.id, newPassword }, headers });

		expect(alerts).toEqual([
			{
				event: "password_changed",
				userId: user.id,
				ipAddress: "203.0.113.7",
				userAgent: "Synthetic Browser/1.0",
			},
		]);
	});

	it("does not alert when a reset link sets a user's first password", async () => {
		const { auth, context, alerts, resetToken } = await setup();
		const user = await context.internalAdapter.createUser({
			name: "Social only",
			email: "social@example.com",
			emailVerified: true,
		});
		const token = await resetToken(user.email);

		await auth.api.resetPassword({ body: { newPassword, token }, headers: new Headers(client) });

		expect(await context.internalAdapter.findAccounts(user.id)).toHaveLength(1);
		expect(alerts).toEqual([]);
	});

	it("alerts the user once two-factor authentication is verified and on", async () => {
		const { alerts, signedInUser, enableTwoFactor } = await setup();
		const { user, headers } = await signedInUser();

		await enableTwoFactor(headers);

		expect(alerts).toEqual([
			{
				event: "two_factor_enabled",
				userId: user.id,
				ipAddress: "203.0.113.7",
				userAgent: "Synthetic Browser/1.0",
			},
		]);
	});

	it("does not alert when a user with two-factor signs in with a code", async () => {
		const { auth, context, alerts, signedInUser, enableTwoFactor } = await setup();
		const { user, headers } = await signedInUser();
		await enableTwoFactor(headers);
		alerts.length = 0;

		const signIn = await auth.api.signInEmail({
			body: { email: user.email, password },
			returnHeaders: true,
		});
		const challenge = new Headers({
			cookie: (signIn.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; "),
			...client,
		});
		const [twoFactorRow] = await context.adapter.findMany<{ secret: string }>({
			model: "twoFactor",
		});
		const secret = await symmetricDecrypt({
			key: context.secretConfig,
			data: String(twoFactorRow?.secret),
		});
		const { code } = await auth.api.generateTOTP({ body: { secret } });

		await expect(
			auth.api.verifyTOTP({ body: { code }, headers: challenge }),
		).resolves.toMatchObject({
			user: { id: user.id },
		});
		expect(alerts).toEqual([]);
	});

	it("alerts the user when two-factor authentication is turned off", async () => {
		const { auth, alerts, signedInUser, enableTwoFactor } = await setup();
		const { user, headers } = await signedInUser();
		const twoFactorHeaders = await enableTwoFactor(headers);
		alerts.length = 0;

		await auth.api.disableTwoFactor({ body: { password }, headers: twoFactorHeaders });

		expect(alerts).toEqual([
			{
				event: "two_factor_disabled",
				userId: user.id,
				ipAddress: "203.0.113.7",
				userAgent: "Synthetic Browser/1.0",
			},
		]);
	});
});
