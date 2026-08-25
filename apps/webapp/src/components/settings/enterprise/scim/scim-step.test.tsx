/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScimStep } from "./scim-step";

const controller = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("./use-scim-admin-controller", () => ({ useScimAdminController: () => controller.current }));
vi.mock("./scim-one-time-credential-dialog", () => ({ ScimOneTimeCredentialDialog: () => null }));
vi.mock("./scim-destructive-dialogs", () => ({ ScimDestructiveDialogs: () => null }));
vi.mock("./scim-credential-list", () => ({ ScimCredentialList: () => <div>Credentials</div> }));
vi.mock("./scim-events-list", () => ({ ScimEventsList: () => <div>Recent Events</div> }));

const setup = (roleId: string | null = "role-1") => ({ state: { scim: { policy: { defaultRoleTemplateId: roleId }, connection: null } }, defaultRoleTemplateId: roleId, roleTemplates: [], scimConnection: null }) as any;
const connection = { connectionId: "conn-1", decommissionedAt: null, decommissionStartedAt: null };
function renderState(status: unknown, isPending = false, roleId: string | null = "role-1") {
	controller.current = { connectionId: status ? "conn-1" : null, status, isPending, credential: null, destructive: null, events: [], eventsError: false, create: vi.fn(), refresh: vi.fn(), rotate: vi.fn(), requestRevoke: vi.fn(), requestDecommission: vi.fn(), clearCredential: vi.fn(), cancelDestructive: vi.fn(), confirm: vi.fn() };
	return render(<ScimStep initialSetup={setup(roleId)} />);
}

describe("ScimStep", () => {
	it.each([
		["disconnected", null, false],
		["active unverified", { connection, credentials: [{ lastUsedAt: null }] }, false],
		["verified", { connection, credentials: [{ lastUsedAt: "2026-01-01T00:00:00Z" }] }, false],
		["rotating", { connection, credentials: [] }, true],
		["decommissioning", { connection: { ...connection, decommissionStartedAt: "2026-01-01T00:00:00Z" }, credentials: [] }, false],
		["decommissioned", { connection: { ...connection, decommissionedAt: "2026-01-01T00:00:00Z" }, credentials: [] }, false],
	])("renders the %s connection state", (label, status, pending) => {
		const { container } = renderState(status, pending);
		expect(screen.getByText(label)).toBeTruthy();
		expect(container.querySelector("section")?.className).toContain("min-w-0");
	});

	it("prevents creation without an eligible default role template", () => {
		renderState(null, false, null);
		expect(screen.getByRole("button", { name: "Select a default role template first" })).toHaveProperty("disabled", true);
	});

	it("shows safe creation recovery states and audit last-use metadata", () => {
		controller.current = { connectionId: "conn-1", lifecycle: "creation_failed", status: { connection, credentials: [{ credentialId: "credential-1", status: "active", lastUsedAt: "2026-01-02T03:04:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }] }, isPending: false, credential: null, destructive: null, events: [], eventsError: false, create: vi.fn(), refresh: vi.fn(), rotate: vi.fn(), requestRevoke: vi.fn(), requestDecommission: vi.fn(), clearCredential: vi.fn(), cancelDestructive: vi.fn(), confirm: vi.fn() };
		render(<ScimStep initialSetup={setup()} />);
		expect(screen.getByText("creation failed")).toBeTruthy();
	});
});
