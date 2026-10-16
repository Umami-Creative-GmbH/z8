import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getAuthContext: vi.fn(),
	getAbility: vi.fn(),
	redirectWithLocale: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mocks.getAuthContext,
	getAbility: mocks.getAbility,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));

import EscalationPage from "./page";

async function open() {
	return EscalationPage().props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getAuthContext.mockResolvedValue({
		session: { activeOrganizationId: "org-1" },
	});
	mocks.getAbility.mockResolvedValue({ cannot: () => false });
});
describe("legacy escalation URL", () => {
	it("redirects an authorized caller to the combined Escalation tab", async () => {
		await expect(open()).rejects.toThrow(
			"redirect:/settings/approval-policies?tab=escalation",
		);
	});
	it("retains the existing Approval management permission check", async () => {
		mocks.getAbility.mockResolvedValue({ cannot: () => true });
		await expect(open()).rejects.toThrow("redirect:/settings");
		expect(mocks.redirectWithLocale).toHaveBeenCalledWith("/settings");
	});
	it("requires an active organization", async () => {
		mocks.getAuthContext.mockResolvedValue(null);
		await expect(open()).rejects.toThrow("redirect:/settings");
		expect(mocks.getAbility).not.toHaveBeenCalled();
	});
});
