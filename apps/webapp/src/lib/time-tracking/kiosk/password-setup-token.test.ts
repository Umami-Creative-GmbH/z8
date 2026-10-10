import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { describe, expect, it, vi } from "vitest";
import { createPasswordSetupToken } from "./password-setup-token";

const email = "jamie@example.com";
const password = "Synthetic-password-123";

async function setup() {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "https://app.example.com",
		secret: "synthetic-password-setup-secret-with-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			sendResetPassword: vi.fn(),
		},
		emailVerification: { sendVerificationEmail: vi.fn() },
		rateLimit: { enabled: false },
	});
	const context = await auth.$context;
	// A former kiosk-only employee: a credential-less user whose address was replaced and verified.
	const user = await context.internalAdapter.createUser({
		name: "Jamie",
		email,
		emailVerified: true,
	});
	return { auth, context, user };
}

describe("password setup link for a former kiosk-only employee (#857)", () => {
	it("lets the user choose a password and then sign in", async () => {
		const { auth, context, user } = await setup();
		await expect(
			auth.api.signInEmail({ body: { email, password } }),
		).rejects.toMatchObject({ status: "UNAUTHORIZED" });

		const token = await createPasswordSetupToken(context, user.id);
		await expect(
			auth.api.resetPassword({ body: { newPassword: password, token } }),
		).resolves.toEqual({ status: true });

		await expect(auth.api.signInEmail({ body: { email, password } })).resolves.toMatchObject({
			user: { id: user.id, email },
		});
	});

	it("works once", async () => {
		const { auth, context, user } = await setup();
		const token = await createPasswordSetupToken(context, user.id);
		await auth.api.resetPassword({ body: { newPassword: password, token } });

		await expect(
			auth.api.resetPassword({ body: { newPassword: "Another-password-456", token } }),
		).rejects.toMatchObject({ status: "BAD_REQUEST" });
	});
});
