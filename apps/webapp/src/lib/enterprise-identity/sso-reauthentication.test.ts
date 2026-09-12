import { describe, expect, it, vi } from "vitest";
import { startOrganizationSsoReauthentication } from "./sso-reauthentication";

describe("organization SSO reauthentication", () => {
	function fixture() {
		const start = vi.fn(
			async () =>
				new Response(JSON.stringify({ url: "https://idp.test/login" }), {
					headers: { "set-cookie": "oauth_state=signed; HttpOnly" },
				}),
		);
		return {
			start,
			dependencies: {
				getMembership: async () => true,
				getPolicy: async () => ({
					required: true,
					providerId: "verified-provider",
				}),
				start,
			},
		};
	}
	it("uses server policy and preserves state cookies and a target-org callback", async () => {
		const { dependencies, start } = fixture();
		const response = await startOrganizationSsoReauthentication(dependencies, {
			userId: "actor",
			organizationId: "locked",
			callbackUrl: "https://evil.test",
			origin: "https://app.test",
		});
		expect(response.headers.get("set-cookie")).toContain("oauth_state=signed");
		const input = start.mock.calls[0][0];
		expect(input.providerId).toBe("verified-provider");
		const callback = new URL(input.callbackURL);
		expect(callback.origin).toBe("https://app.test");
		expect(callback.pathname).toBe("/init");
		expect(callback.searchParams.get("organizationId")).toBe("locked");
		expect(callback.searchParams.get("callbackUrl")).toBe("/");
		expect(new URL(input.errorCallbackURL).searchParams.get("ssoError")).toBe(
			"1",
		);
	});
	it("does not start an IdP flow without approved membership or a configured provider", async () => {
		const { dependencies, start } = fixture();
		await expect(
			startOrganizationSsoReauthentication(
				{ ...dependencies, getMembership: async () => false },
				{
					userId: "actor",
					organizationId: "locked",
					origin: "https://app.test",
				},
			),
		).rejects.toThrow();
		await expect(
			startOrganizationSsoReauthentication(
				{
					...dependencies,
					getPolicy: async () => ({ required: true, providerId: null }),
				},
				{
					userId: "actor",
					organizationId: "locked",
					origin: "https://app.test",
				},
			),
		).rejects.toThrow();
		expect(start).not.toHaveBeenCalled();
	});
});
