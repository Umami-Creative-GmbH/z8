import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	createRateLimitResponse: vi.fn(),
	getClientIp: vi.fn(),
	resolvePublicRedirectOrigin: vi.fn(),
	resolveStoreAppSignInOrigin: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: mockState.checkRateLimit,
	createRateLimitResponse: mockState.createRateLimitResponse,
	getClientIp: mockState.getClientIp,
}));
vi.mock("@/lib/domain/request-origin", () => ({
	resolvePublicRedirectOrigin: mockState.resolvePublicRedirectOrigin,
}));
vi.mock("@/lib/store-app/sign-in-origin", () => ({
	resolveStoreAppSignInOrigin: mockState.resolveStoreAppSignInOrigin,
}));

const { POST } = await import("./route");

// RFC 7636 appendix B.
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function start(body: unknown) {
	return new Request("https://ui.example.test/api/auth/app-sign-in", {
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
}

describe("POST /api/auth/app-sign-in", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.checkRateLimit.mockResolvedValue({ allowed: true });
		mockState.createRateLimitResponse.mockReturnValue(new Response("limited", { status: 429 }));
		mockState.getClientIp.mockReturnValue("127.0.0.1");
		mockState.resolvePublicRedirectOrigin.mockResolvedValue("https://ui.example.test");
		mockState.resolveStoreAppSignInOrigin.mockImplementation(
			async (_email: string, mainOrigin: string) => mainOrigin,
		);
	});

	it("starts the system-browser sign-in on the origin chosen for the email", async () => {
		mockState.resolveStoreAppSignInOrigin.mockResolvedValue("https://time.acme.example");

		const response = await POST(start({ email: "ada@acme.example", challenge: CHALLENGE }));

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mockState.resolveStoreAppSignInOrigin).toHaveBeenCalledWith(
			"ada@acme.example",
			"https://ui.example.test",
		);
		const { authorizeUrl } = await response.json();
		const url = new URL(authorizeUrl);
		expect(url.origin).toBe("https://time.acme.example");
		expect(url.pathname).toBe("/api/auth/app-login");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			app: "mobile",
			redirect: "z8mobile://auth/callback",
			challenge: CHALLENGE,
		});
	});

	it("answers an unknown address exactly like a known one on the main origin", async () => {
		const known = await (
			await POST(start({ email: "ada@example.test", challenge: CHALLENGE }))
		).json();
		const unknown = await (
			await POST(start({ email: "nobody-here@example.test", challenge: CHALLENGE }))
		).json();

		expect(unknown).toEqual(known);
		expect(Object.keys(known)).toEqual(["authorizeUrl"]);
	});

	it("checks the rate limit before looking at the email", async () => {
		mockState.checkRateLimit.mockResolvedValue({ allowed: false });

		const response = await POST(start({ email: "ada@acme.example", challenge: CHALLENGE }));

		expect(response.status).toBe(429);
		expect(mockState.checkRateLimit).toHaveBeenCalledWith("127.0.0.1", "auth");
		expect(mockState.resolveStoreAppSignInOrigin).not.toHaveBeenCalled();
	});

	it.each([
		["a malformed email", { email: "not-an-email", challenge: CHALLENGE }],
		["a missing challenge", { email: "ada@acme.example" }],
		["a challenge that is not an S256 value", { email: "ada@acme.example", challenge: "plain" }],
	])("refuses %s", async (_case, body) => {
		const response = await POST(start(body));

		expect(response.status).toBe(400);
		expect(mockState.resolveStoreAppSignInOrigin).not.toHaveBeenCalled();
	});
});
