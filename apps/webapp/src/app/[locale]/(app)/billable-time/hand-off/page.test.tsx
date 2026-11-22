import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireBillableTimeSettingsAccessMock } = vi.hoisted(() => ({
	requireBillableTimeSettingsAccessMock: vi.fn(),
}));

vi.mock("@/lib/billable-time/settings-access", () => ({
	requireBillableTimeSettingsAccess: requireBillableTimeSettingsAccessMock,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("../../settings/billable-time/hand-off/hand-off-view", () => ({
	HandOffView: () => <div data-testid="hand-off-view">Hand-off workspace</div>,
}));

import BillableHandOffPage from "./page";

async function renderPageContent() {
	const page = BillableHandOffPage();
	const content = page.props.children as {
		type: () => Promise<React.ReactElement>;
	};
	return renderToStaticMarkup(await content.type());
}

describe("/billable-time/hand-off workspace (#1956)", () => {
	beforeEach(() => {
		requireBillableTimeSettingsAccessMock.mockReset();
	});

	it("renders the Hand-off workspace in page-frame with a contextual link to Billable Time settings", async () => {
		requireBillableTimeSettingsAccessMock.mockResolvedValue({
			authContext: { user: { id: "u1" } },
			organizationId: "org-1",
			settings: { enabled: true, currency: "EUR" },
		});

		const html = await renderPageContent();

		expect(requireBillableTimeSettingsAccessMock).toHaveBeenCalledTimes(1);
		expect(html).toContain("page-frame");
		expect(html).toContain("Billable Hand-off");
		expect(html).toContain('href="/settings/billable-time"');
		expect(html).toContain("Billable Time settings");
		expect(html).toContain("Hand-off workspace");
	});

	it("enforces org-admin and module-enabled access via requireBillableTimeSettingsAccess", async () => {
		requireBillableTimeSettingsAccessMock.mockRejectedValue(new Error("NEXT_REDIRECT:/settings"));

		await expect(renderPageContent()).rejects.toThrow("NEXT_REDIRECT:/settings");
	});
});
