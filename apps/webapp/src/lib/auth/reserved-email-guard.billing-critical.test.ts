import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { describe, expect, it } from "vitest";
import { reservedEmailGuard } from "./reserved-email-guard";

/**
 * Billing-critical (#886): a seat whose user has a reserved address is billed
 * as a cheaper kiosk seat, so the reserved-email guard is what stops anyone
 * from turning an ordinary employee into a kiosk-only one to pay less. No user
 * create or update may set a reserved address.
 *
 * The only writers outside Better Auth that set `user.email` are the
 * kiosk-only writer itself (the one legitimate reserved-address writer), the
 * demo generator (`demo.invalid`, never reserved) and the first platform-admin
 * setup, which creates a user before any organization exists, so never a seat.
 */

const reservedEmail = "kiosk-0123456789abcdef@kiosk.invalid";
const password = "Synthetic-password-123";
const refused = { body: { code: "RESERVED_EMAIL" } };

async function setup() {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		account: [],
		session: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "https://app.example.com",
		secret: "synthetic-reserved-email-secret-with-32-characters",
		database: memoryAdapter(data),
		emailAndPassword: { enabled: true },
		// z8 keeps change-email disabled; enabled here so only the guard can refuse it.
		user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } },
		rateLimit: { enabled: false },
		plugins: [reservedEmailGuard(), admin()],
	});
	const context = await auth.$context;

	async function signedInUser(email: string, options: { role?: string; verified?: boolean } = {}) {
		const user = await context.internalAdapter.createUser({
			name: "Person",
			email,
			emailVerified: options.verified ?? true,
			...(options.role ? { role: options.role } : {}),
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

	const storedEmail = (userId: string) => data.user.find((row) => row.id === userId)?.email;
	const reservedUsers = () =>
		data.user.filter((row) => String(row.email).toLowerCase().endsWith("@kiosk.invalid"));

	return { auth, context, signedInUser, storedEmail, reservedUsers };
}

describe("reserved-email guard is billing-critical (#886): no user create or update sets a reserved address", () => {
	it("is a plugin of z8's own auth configuration, not only of this test's", () => {
		// The cases below run the plugin in a minimal Better Auth; this pins that the
		// production configuration carries it too. auth-composition.test.ts checks the
		// loaded plugin ids (`z8-reserved-email-guard`) and their order.
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const authStart = source.indexOf("export const auth = betterAuth(");
		const pluginsStart = source.indexOf("plugins: [", authStart);
		expect(authStart).toBeGreaterThanOrEqual(0);
		expect(pluginsStart).toBeGreaterThan(authStart);
		const plugins = source.slice(pluginsStart);

		expect(plugins).toMatch(/^\s*reservedEmailGuard\(\),/m);
		expect(source).toMatch(
			/^import \{ reservedEmailGuard \} from "@\/lib\/auth\/reserved-email-guard";$/m,
		);
	});

	it("refuses /change-email to a reserved address and keeps the ordinary one", async () => {
		const { auth, signedInUser, storedEmail } = await setup();
		// Unverified, so without the guard the address would change at once.
		const { user, headers } = await signedInUser("person@example.com", { verified: false });

		await expect(
			auth.api.changeEmail({ body: { newEmail: reservedEmail }, headers }),
		).rejects.toMatchObject(refused);
		expect(storedEmail(user.id)).toBe("person@example.com");
	});

	it("still lets /change-email move to an ordinary address", async () => {
		const { auth, signedInUser, storedEmail } = await setup();
		const { user, headers } = await signedInUser("person@example.com", { verified: false });

		await auth.api.changeEmail({ body: { newEmail: "moved@example.com" }, headers });

		expect(storedEmail(user.id)).toBe("moved@example.com");
	});

	it("refuses the admin plugin updating a user to a reserved address", async () => {
		const { auth, signedInUser, storedEmail } = await setup();
		const { headers } = await signedInUser("admin@example.com", { role: "admin" });
		const { user } = await signedInUser("person@example.com");

		await expect(
			auth.api.adminUpdateUser({
				body: { userId: user.id, data: { email: reservedEmail } },
				headers,
			}),
		).rejects.toMatchObject(refused);
		expect(storedEmail(user.id)).toBe("person@example.com");
	});

	it("refuses every internal user update to a reserved address, however it is spelled", async () => {
		const { context, signedInUser, storedEmail } = await setup();
		const { user } = await signedInUser("person@example.com");

		await expect(
			context.internalAdapter.updateUser(user.id, { email: ` ${reservedEmail.toUpperCase()} ` }),
		).rejects.toMatchObject(refused);
		await expect(
			context.internalAdapter.updateUserByEmail("person@example.com", { email: reservedEmail }),
		).rejects.toMatchObject(refused);
		expect(storedEmail(user.id)).toBe("person@example.com");
	});

	it("refuses every user create with a reserved address", async () => {
		const { auth, context, reservedUsers } = await setup();

		await expect(
			auth.api.signUpEmail({ body: { name: "Kiosk", email: reservedEmail, password } }),
		).rejects.toMatchObject(refused);
		// A server-side admin create needs no admin session, so only the guard stands in the way.
		await expect(
			auth.api.createUser({ body: { email: reservedEmail, name: "Kiosk", password } }),
		).rejects.toMatchObject(refused);
		// Social, SSO and SCIM provisioning create users through the internal adapter.
		await expect(
			context.internalAdapter.createUser({ name: "Kiosk", email: reservedEmail }),
		).rejects.toMatchObject(refused);
		expect(reservedUsers()).toEqual([]);
	});
});
