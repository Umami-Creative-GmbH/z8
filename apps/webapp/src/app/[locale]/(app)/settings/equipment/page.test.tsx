import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	guard: vi.fn(),
	read: vi.fn(),
	detail: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: api.guard,
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	getEquipmentSetup: api.read,
	getEquipmentSetupDetail: api.detail,
	changeEquipmentSetup: vi.fn(),
	getEquipmentOfficerGrants: async () => ({
		success: true,
		data: { employees: [], teams: [], grants: [] },
	}),
	changeEquipmentOfficerGrant: vi.fn(),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));

import Page from "./page";

async function content() {
	return Page().props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	api.guard.mockResolvedValue({ organizationId: "org" });
	api.read.mockResolvedValue({
		success: true,
		data: { policy: null, types: [], selectableTypes: [], items: [] },
	});
});
it("renders the usable setup screen through its guarded route", async () => {
	const html = renderToStaticMarkup(await content());
	expect(html).toContain("Closed-record retention (months)");
	expect(html).toContain("Add type");
	expect(html).toContain("Register item");
});
it("does not load or expose setup when direct-route administration is refused", async () => {
	api.guard.mockRejectedValue(new Error("forbidden"));
	await expect(content()).rejects.toThrow("forbidden");
	expect(api.read).not.toHaveBeenCalled();
});
it("shows an accessible error when the authorized action refuses access", async () => {
	api.read.mockResolvedValue({ success: false, error: "denied" });
	const html = renderToStaticMarkup(await content());
	expect(html).toContain('role="alert"');
	expect(html).not.toContain("Register item");
});
