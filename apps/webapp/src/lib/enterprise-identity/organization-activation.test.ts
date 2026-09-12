import { describe, expect, it, vi } from "vitest";
import { activateOrganization } from "./organization-activation";

describe("organization activation reauthentication", () => {
	it("does not automatically restart a completed SSO attempt that still lacks access", async () => {
		const request = vi.fn(async () =>
			Response.json({ code: "SSO_REQUIRED" }, { status: 403 }),
		);
		await expect(
			activateOrganization("locked", "/", request, false),
		).rejects.toThrow("SSO sign-in did not grant access");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("starts SSO on SSO_REQUIRED instead of redirecting to the app", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ code: "SSO_REQUIRED" }, { status: 403 }),
			)
			.mockResolvedValueOnce(Response.json({ url: "https://idp.test/login" }));
		expect(await activateOrganization("locked", "/reports", fetch)).toEqual({
			kind: "sso",
			url: "https://idp.test/login",
		});
		expect(fetch.mock.calls[1][0]).toBe("/api/organizations/sso");
		expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
			organizationId: "locked",
			callbackUrl: "/reports",
		});
	});
	it("preserves successful non-SSO switching and surfaces failures without navigation", async () => {
		expect(
			await activateOrganization(
				"open",
				"/",
				vi.fn(async () => Response.json({ hasEmployeeRecord: true })),
			),
		).toEqual({ kind: "active", hasEmployeeRecord: true });
		await expect(
			activateOrganization(
				"locked",
				"/",
				vi.fn(async () =>
					Response.json({ error: "Access denied" }, { status: 403 }),
				),
			),
		).rejects.toThrow("Access denied");
	});
});
