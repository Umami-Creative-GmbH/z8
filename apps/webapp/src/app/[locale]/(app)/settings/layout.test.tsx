/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { Suspense, use } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/settings/settings-breadcrumbs", () => ({
	SettingsBreadcrumbs: () => <nav aria-label="Settings breadcrumbs" />,
}));

vi.mock("@/components/settings/settings-nav", () => ({
	SettingsNav: () => <nav aria-label="Settings navigation" />,
}));

vi.mock("@/env", () => ({
	env: { BILLING_ENABLED: "false" },
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(),
}));

const { default: SettingsLayout } = await import("./layout");

const pendingContent = new Promise<never>(() => {});

function PendingContent() {
	use(pendingContent);
	return <div>Settings content</div>;
}

describe("SettingsLayout", () => {
	it("keeps navigation and breadcrumbs outside the child content boundary", () => {
		const layout = SettingsLayout({ children: <PendingContent /> });
		const [navigationBoundary, main] = layout.props.children;
		const [breadcrumbsBoundary, contentBoundary] = main.props.children;

		expect(navigationBoundary.type).toBe(Suspense);
		expect(breadcrumbsBoundary.type).toBe(Suspense);
		expect(breadcrumbsBoundary.props.children.type.name).toBe(
			"SettingsBreadcrumbs",
		);
		expect(contentBoundary.type).toBe(Suspense);
		expect(contentBoundary.props.fallback.type).toBe(SettingsContentLoading);
		expect(contentBoundary.props.children.props.children.type).toBe(
			PendingContent,
		);
	});

	it("shows the content fallback without hiding breadcrumbs while children wait", () => {
		const layout = SettingsLayout({ children: <PendingContent /> });
		const main = layout.props.children[1];

		render(main);

		expect(
			screen.getByRole("navigation", { name: "Settings breadcrumbs" }),
		).toBeTruthy();
		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
		expect(screen.queryByText("Settings content")).toBeNull();
	});
});
