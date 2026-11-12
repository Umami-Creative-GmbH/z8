/* @vitest-environment jsdom */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as authSchema from "@/db/auth-schema";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import { render } from "@/test/render-with-translations";

vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	deleteOrganization: vi.fn(),
	recoverOrganization: vi.fn(),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { OrganizationDangerZoneCard } = await import("./organization-danger-zone-card");

const organization = {
	id: "org-1",
	name: "Acme",
	deletedAt: null,
} as typeof authSchema.organization.$inferSelect;

function renderCard(settingsAccess: SettingsAccess | null) {
	return render(
		<OrganizationDangerZoneCard organization={organization} settingsAccess={settingsAccess} />,
	);
}

describe("OrganizationDangerZoneCard by settings access", () => {
	afterEach(cleanup);

	it.each(["owner", "orgAdmin"] as const)("shows the delete control to an %s", (access) => {
		renderCard(access);

		expect(screen.getByRole("button", { name: /Delete Organization/ })).toBeTruthy();
	});

	it.each([
		["a scoped manager", "scopedManager"],
		["an org member", "member"],
		["a former employee (no settings access)", null],
	] as const)("shows nothing to %s", (_label, access) => {
		renderCard(access);

		expect(screen.queryByText("Danger Zone")).toBeNull();
		expect(screen.queryByRole("button", { name: /Delete Organization/ })).toBeNull();
	});
});
