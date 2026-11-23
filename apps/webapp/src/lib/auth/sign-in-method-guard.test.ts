import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	invitationRows: [] as Array<{ id: string }>,
}));

vi.mock("@/db", () => {
	const chain = {
		select: () => chain,
		from: () => chain,
		where: () => chain,
		limit: async () => mockState.invitationRows,
	};
	return { db: chain };
});
vi.mock("@/lib/domain/domain-service", () => ({ getDomainConfig: vi.fn() }));
vi.mock("@/lib/domain/host-auth-config", () => ({ getPlatformAuthConfig: vi.fn() }));

const { assertSignInMethodAllowed } = await import("./sign-in-method-guard");

const policy = (overrides: Record<string, unknown>) => ({
	organizationId: "org_123",
	authConfig: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: true,
		passkeyEnabled: true,
		registrationEnabled: true,
		...overrides,
	},
});

async function refusal(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return (error as { body?: { code?: string } }).body?.code;
	}
	return null;
}

describe("sign-in method guard (#1885)", () => {
	beforeEach(() => {
		mockState.invitationRows = [];
	});

	it("leaves the main domain's methods alone", async () => {
		await expect(
			assertSignInMethodAllowed("/sign-up/email", null, "a@b.test"),
		).resolves.toBeUndefined();
	});

	it("refuses email and password sign-in and sign-up where they are off", async () => {
		const off = policy({ emailPasswordEnabled: false });
		expect(await refusal(assertSignInMethodAllowed("/sign-in/email", off, "a@b.test"))).toBe(
			"EMAIL_PASSWORD_DISABLED",
		);
		expect(await refusal(assertSignInMethodAllowed("/sign-up/email", off, "a@b.test"))).toBe(
			"EMAIL_PASSWORD_DISABLED",
		);
	});

	it("keeps sign-in open but refuses sign-up when registration is off", async () => {
		const closed = policy({ registrationEnabled: false });
		await expect(
			assertSignInMethodAllowed("/sign-in/email", closed, "a@b.test"),
		).resolves.toBeUndefined();
		expect(await refusal(assertSignInMethodAllowed("/sign-up/email", closed, "a@b.test"))).toBe(
			"REGISTRATION_DISABLED",
		);
	});

	it("lets someone with a pending invitation sign up while registration is off", async () => {
		mockState.invitationRows = [{ id: "invitation_1" }];
		await expect(
			assertSignInMethodAllowed(
				"/sign-up/email",
				policy({ registrationEnabled: false }),
				"a@b.test",
			),
		).resolves.toBeUndefined();
	});

	it("refuses with 400, which the sign-in page does not read as an unverified email", async () => {
		await assertSignInMethodAllowed(
			"/sign-in/email",
			policy({ emailPasswordEnabled: false }),
			"a@b.test",
		).catch((error: { statusCode?: number }) => {
			expect(error.statusCode).toBe(400);
		});
		expect.assertions(1);
	});
});
