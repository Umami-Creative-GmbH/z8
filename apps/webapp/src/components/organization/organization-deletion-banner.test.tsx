/* @vitest-environment jsdom */

import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const store = vi.hoisted(() => ({
	deletedAt: null as string | null,
	isHydrated: true,
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationDeletedAt: () => store.deletedAt,
	useOrganizationSettings: (selector: (state: { isHydrated: boolean }) => unknown) =>
		selector({ isHydrated: store.isHydrated }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const { OrganizationDeletionBanner } = await import("./organization-deletion-banner");

describe("OrganizationDeletionBanner", () => {
	afterEach(() => {
		cleanup();
		store.deletedAt = null;
		store.isHydrated = true;
	});

	it("renders nothing while the organization is not scheduled for deletion", () => {
		const { container } = render(<OrganizationDeletionBanner />);

		expect(container.firstChild).toBeNull();
	});

	it("uses the warning tokens with foreground copy instead of a fixed amber palette", () => {
		store.deletedAt = new Date().toISOString();

		render(<OrganizationDeletionBanner />);

		const banner = screen.getByRole("alert");
		expect(banner.textContent).toContain("Organization Scheduled for Deletion");
		expect(banner.className).toContain("bg-warning/10");
		expect(banner.className).toContain("border-warning/40");
		expect(banner.className).toContain("text-foreground");
		expect(banner.className).not.toMatch(/amber|text-destructive/);
		// The Alert's `[&>svg]:text-current` outranks a class on the icon itself.
		expect(banner.className).toContain("[&>svg]:text-warning");
		expect(banner.className).not.toContain("[&>svg]:text-current");
		expect(screen.getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe(
			"/settings/organization",
		);
	});
});
