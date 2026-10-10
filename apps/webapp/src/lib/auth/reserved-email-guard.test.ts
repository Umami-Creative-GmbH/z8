import { passkey } from "@better-auth/passkey";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { organization } from "better-auth/plugins/organization";
import { describe, expect, it, vi } from "vitest";
import { reservedEmailGuard } from "./reserved-email-guard";

const reservedEmail = "kiosk-0123456789abcdef@kiosk.invalid";
const password = "Synthetic-password-123";
const refused = { body: { code: "RESERVED_EMAIL" } };

async function setup() {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
		organization: [],
		member: [],
		invitation: [],
		passkey: [],
	};
	const sendResetPassword = vi.fn();
	const sendInvitationEmail = vi.fn();
	const auth = betterAuth({
		baseURL: "https://app.example.com",
		secret: "synthetic-reserved-email-secret-with-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: { enabled: true, sendResetPassword },
		rateLimit: { enabled: false },
		plugins: [
			reservedEmailGuard(),
			bearer(),
			organization({ sendInvitationEmail }),
			passkey({ rpID: "app.example.com", origin: "https://app.example.com" }),
			admin(),
		],
	});
	const context = await auth.$context;

	/** A user with a credential and a browser session cookie, signed in before any guard could object. */
	async function signedInUser(email: string) {
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
		return { user, headers: new Headers({ cookie }) };
	}

	/** Gives an existing user a reserved address behind Better Auth's back, as the kiosk-only writer does. */
	function reserve(userId: string) {
		const row = data.user.find((candidate) => candidate.id === userId);
		if (row) row.email = reservedEmail;
	}

	return { auth, context, sendResetPassword, sendInvitationEmail, signedInUser, reserve };
}

describe("reserved-email guard (#857)", () => {
	it("refuses email and password sign-in to a reserved address", async () => {
		const { auth, signedInUser, reserve } = await setup();
		const { user } = await signedInUser("person@example.com");
		reserve(user.id);

		await expect(
			auth.api.signInEmail({ body: { email: reservedEmail, password } }),
		).rejects.toMatchObject(refused);
	});

	it("refuses to create any session for a user with a reserved address", async () => {
		const { context, signedInUser, reserve } = await setup();
		const { user } = await signedInUser("person@example.com");
		reserve(user.id);

		await expect(context.internalAdapter.createSession(user.id)).rejects.toMatchObject(refused);
	});

	it("refuses to sign up with a reserved address", async () => {
		const { auth } = await setup();

		await expect(
			auth.api.signUpEmail({ body: { name: "Kiosk", email: reservedEmail, password } }),
		).rejects.toMatchObject(refused);
	});

	it("refuses a password reset request without sending anything", async () => {
		const { auth, sendResetPassword, signedInUser, reserve } = await setup();
		const { user } = await signedInUser("person@example.com");
		reserve(user.id);

		await expect(
			auth.api.requestPasswordReset({ body: { email: reservedEmail } }),
		).rejects.toMatchObject(refused);
		expect(sendResetPassword).not.toHaveBeenCalled();
	});

	it("refuses passkey enrolment for a session whose user now has a reserved address", async () => {
		const { auth, signedInUser, reserve } = await setup();
		const { user, headers } = await signedInUser("person@example.com");
		reserve(user.id);

		await expect(auth.api.generatePasskeyRegistrationOptions({ headers })).rejects.toMatchObject(
			refused,
		);
	});

	it("refuses an invitation to a reserved address", async () => {
		const { auth, sendInvitationEmail, signedInUser } = await setup();
		const { headers } = await signedInUser("owner@example.com");
		const org = await auth.api.createOrganization({
			body: { name: "Kiosk Org", slug: "kiosk-org" },
			headers,
		});

		await expect(
			auth.api.createInvitation({
				body: { organizationId: org?.id, email: reservedEmail, role: "member" },
				headers,
			}),
		).rejects.toMatchObject(refused);
		expect(sendInvitationEmail).not.toHaveBeenCalled();
	});

	it("refuses to change a user's address to a reserved one", async () => {
		const { context, signedInUser } = await setup();
		const { user } = await signedInUser("person@example.com");

		await expect(
			context.internalAdapter.updateUser(user.id, { email: reservedEmail }),
		).rejects.toMatchObject(refused);
	});

	it("refuses the admin plugin creating a user with a reserved address", async () => {
		const { auth } = await setup();

		// A server-side call needs no admin session, so only the guard stands in the way.
		await expect(
			auth.api.createUser({ body: { email: reservedEmail, name: "Kiosk", password } }),
		).rejects.toMatchObject(refused);
	});

	it("leaves ordinary addresses alone", async () => {
		const { auth, signedInUser } = await setup();
		await signedInUser("person@example.com");

		await expect(
			auth.api.signInEmail({ body: { email: "person@example.com", password } }),
		).resolves.toMatchObject({ user: { email: "person@example.com" } });
	});
});
