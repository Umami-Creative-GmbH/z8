/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ScimCredentialList } from "./scim-credential-list";
let locale = "en-US";
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			params
				? Object.entries(params).reduce(
						(value, [key, replacement]) =>
							value.replaceAll(`{${key}}`, replacement),
						fallback,
					)
				: fallback,
	}),
	useTolgee: () => ({ getLanguage: () => locale }),
}));
it("formats last use as a UTC audit instant and keeps null metadata empty", () => {
	render(
		<ScimCredentialList
			pending={false}
			onRevoke={vi.fn()}
			credentials={[
				{
					credentialId: "credential-1",
					status: "active",
					lastUsedAt: "2026-01-02T03:04:00.000Z",
					expiresAt: "2027-01-01T00:00:00.000Z",
				} as any,
				{
					credentialId: "credential-2",
					status: "revoked",
					lastUsedAt: null,
					expiresAt: "2027-01-01T00:00:00.000Z",
				} as any,
			]}
		/>,
	);
	expect(
		screen.getByRole("status", { name: "Last used: Jan 2, 2026, 3:04 AM UTC" }),
	).toBeTruthy();
	expect(screen.getByText("Not yet used")).toBeTruthy();
});

it("formats expiry timestamps with an explicit UTC timezone", () => {
	locale = "fr-FR";
	const originalFormatter = Intl.DateTimeFormat;
	const formatter = vi.fn(function (...args: any[]) {
		return new originalFormatter(...args);
	});
	vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: formatter });
	render(
		<ScimCredentialList
			pending={false}
			onRevoke={vi.fn()}
			credentials={[
				{
					credentialId: "credential-1",
					status: "active",
					lastUsedAt: null,
					expiresAt: "2027-01-01T00:00:00.000Z",
				} as any,
			]}
		/>,
	);
	expect(formatter).toHaveBeenCalledWith("fr-FR", {
		dateStyle: "medium",
		timeZone: "UTC",
	});
});
