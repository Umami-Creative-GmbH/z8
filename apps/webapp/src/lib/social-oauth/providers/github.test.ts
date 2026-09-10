import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "./github";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub verified email selection", () => {
	it("verifies a public profile email against the authenticated email endpoint", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ id: 7, email: "person@example.com" }))
				.mockResolvedValueOnce(
					Response.json([{ email: "person@example.com", primary: true, verified: true }]),
				),
		);
		await expect(githubProvider.getUserInfo("token")).resolves.toMatchObject({
			email: "person@example.com",
			emailVerified: true,
		});
	});

	it("selects a verified address instead of an unverified public profile email", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ id: 7, email: "unverified@example.com" }))
				.mockResolvedValueOnce(
					Response.json([
						{ email: "unverified@example.com", primary: true, verified: false },
						{ email: "verified@example.com", primary: false, verified: true },
					]),
				),
		);
		await expect(githubProvider.getUserInfo("token")).resolves.toMatchObject({
			email: "verified@example.com",
			emailVerified: true,
		});
	});

	it.each([Response.json([]), new Response(null, { status: 403 })])(
		"fails closed when no verified address can be retrieved",
		async (emailsResponse) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValueOnce(Response.json({ id: 7, email: "public@example.com" }))
					.mockResolvedValueOnce(emailsResponse),
			);
			await expect(githubProvider.getUserInfo("token")).rejects.toThrow();
		},
	);
});
