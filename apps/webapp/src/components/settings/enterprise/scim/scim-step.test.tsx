/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScimStep } from "./scim-step";

const controller = vi.hoisted(() => ({
	current: {} as Record<string, unknown>,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("./use-scim-admin-controller", () => ({
	useScimAdminController: () => controller.current,
}));
vi.mock("./scim-one-time-credential-dialog", () => ({
	ScimOneTimeCredentialDialog: () => null,
}));
vi.mock("./scim-destructive-dialogs", () => ({
	ScimDestructiveDialogs: () => null,
}));
vi.mock("./scim-credential-list", () => ({
	ScimCredentialList: () => <div>Credentials</div>,
}));
vi.mock("./scim-events-list", () => ({
	ScimEventsList: () => <div>Recent Events</div>,
}));

const setup = (roleId: string | null = "role-1") =>
	({
		scim: { policy: { defaultRoleTemplateId: roleId }, connection: null },
	}) as any;
const connection = {
	connectionId: "conn-1",
	decommissionedAt: null,
	decommissionStartedAt: null,
};
function renderState(
	status: unknown,
	isPending = false,
	roleId: string | null = "role-1",
) {
	controller.current = {
		connectionId: status ? "conn-1" : null,
		status,
		isPending,
		credential: null,
		destructive: null,
		events: [],
		eventsError: false,
		create: vi.fn(),
		refresh: vi.fn(),
		rotate: vi.fn(),
		requestRevoke: vi.fn(),
		requestDecommission: vi.fn(),
		clearCredential: vi.fn(),
		cancelDestructive: vi.fn(),
		confirm: vi.fn(),
	};
	return render(
		<ScimStep
			setup={setup(roleId)}
			defaultRoleTemplateId={roleId}
			endpoint="https://app.example.test/api/auth/scim/v2"
		/>,
	);
}

describe("ScimStep", () => {
	it.each([
		["disconnected", null, false],
		[
			"active unverified",
			{ connection, credentials: [{ lastUsedAt: null }] },
			false,
		],
		[
			"verified",
			{ connection, credentials: [{ lastUsedAt: "2026-01-01T00:00:00Z" }] },
			false,
		],
		["rotating", { connection, credentials: [] }, true, "rotate"],
		[
			"decommissioning",
			{
				connection: {
					...connection,
					decommissionStartedAt: "2026-01-01T00:00:00Z",
				},
				credentials: [],
			},
			false,
		],
		[
			"decommissioned",
			{
				connection: { ...connection, decommissionedAt: "2026-01-01T00:00:00Z" },
				credentials: [],
			},
			false,
		],
	])(
		"renders the %s connection state",
		(label, status, pending, pendingAction) => {
			controller.current = {
				connectionId: status ? "conn-1" : null,
				status,
				pendingAction,
				isPending: pending,
				credential: null,
				destructive: null,
				events: [],
				eventsError: false,
				create: vi.fn(),
				refresh: vi.fn(),
				rotate: vi.fn(),
				requestRevoke: vi.fn(),
				requestDecommission: vi.fn(),
				clearCredential: vi.fn(),
				cancelDestructive: vi.fn(),
				confirm: vi.fn(),
			};
			const { container } = render(
				<ScimStep
					setup={setup()}
					defaultRoleTemplateId="role-1"
					endpoint="https://app.example.test/api/auth/scim/v2"
				/>,
			);
			expect(screen.getByText(label)).toBeTruthy();
			expect(container.querySelector("section")?.className).toContain(
				"min-w-0",
			);
		},
	);

	it("prevents creation without an eligible default role template", () => {
		renderState(null, false, null);
		expect(
			screen.getByRole("button", {
				name: "Select a default role template first",
			}),
		).toHaveProperty("disabled", true);
	});

	it("shows safe creation recovery states and audit last-use metadata", () => {
		controller.current = {
			connectionId: "conn-1",
			lifecycle: "creation_failed",
			status: {
				connection,
				credentials: [
					{
						credentialId: "credential-1",
						status: "active",
						lastUsedAt: "2026-01-02T03:04:00.000Z",
						expiresAt: "2027-01-01T00:00:00.000Z",
					},
				],
			},
			isPending: false,
			credential: null,
			destructive: null,
			events: [],
			eventsError: false,
			create: vi.fn(),
			refresh: vi.fn(),
			rotate: vi.fn(),
			requestRevoke: vi.fn(),
			requestDecommission: vi.fn(),
			clearCredential: vi.fn(),
			cancelDestructive: vi.fn(),
			confirm: vi.fn(),
		};
		render(
			<ScimStep
				setup={setup()}
				defaultRoleTemplateId="role-1"
				endpoint="https://app.example.test/api/auth/scim/v2"
			/>,
		);
		expect(screen.getByText("creation failed")).toBeTruthy();
	});

	it("gates duplicate initiation and mutations while creation is in progress", () => {
		controller.current = {
			connectionId: null,
			lifecycle: "creating",
			status: null,
			isPending: false,
			credential: null,
			destructive: null,
			events: [],
			eventsError: false,
			create: vi.fn(),
			refresh: vi.fn(),
			rotate: vi.fn(),
			requestRevoke: vi.fn(),
			requestDecommission: vi.fn(),
			clearCredential: vi.fn(),
			cancelDestructive: vi.fn(),
			confirm: vi.fn(),
		};
		render(
			<ScimStep
				setup={setup()}
				defaultRoleTemplateId="role-1"
				endpoint="https://app.example.test/api/auth/scim/v2"
			/>,
		);
		expect(screen.getByText("creating")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Creating SCIM connection" }),
		).toHaveProperty("disabled", true);
		expect(
			screen.queryByRole("button", { name: "Rotate credential" }),
		).toBeNull();
	});

	it("labels an in-flight create as creating rather than rotating", () => {
		controller.current = {
			connectionId: null,
			lifecycle: null,
			pendingAction: "create",
			status: null,
			isPending: true,
			credential: null,
			destructive: null,
			events: [],
			eventsError: false,
			create: vi.fn(),
			refresh: vi.fn(),
			rotate: vi.fn(),
			requestRevoke: vi.fn(),
			requestDecommission: vi.fn(),
			clearCredential: vi.fn(),
			cancelDestructive: vi.fn(),
			confirm: vi.fn(),
		};
		render(
			<ScimStep
				setup={setup()}
				defaultRoleTemplateId="role-1"
				endpoint="https://app.example.test/api/auth/scim/v2"
			/>,
		);
		expect(screen.getByText("creating")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Creating SCIM connection" }),
		).toHaveProperty("disabled", true);
		expect(screen.queryByText("rotating")).toBeNull();
	});

	it.each([
		["refresh", "refreshing"],
		["revoke", "revoking"],
		["decommission", "decommissioning"],
	])("labels pending %s without showing rotating", (pendingAction, label) => {
		controller.current = {
			connectionId: "conn-1",
			lifecycle: null,
			pendingAction,
			status: { connection, credentials: [] },
			isPending: true,
			credential: null,
			destructive: null,
			events: [],
			eventsError: false,
			create: vi.fn(),
			refresh: vi.fn(),
			rotate: vi.fn(),
			requestRevoke: vi.fn(),
			requestDecommission: vi.fn(),
			clearCredential: vi.fn(),
			cancelDestructive: vi.fn(),
			confirm: vi.fn(),
		};
		render(
			<ScimStep
				setup={setup()}
				defaultRoleTemplateId="role-1"
				endpoint="https://app.example.test/api/auth/scim/v2"
			/>,
		);
		expect(screen.getByText(label)).toBeTruthy();
		expect(screen.queryByText("rotating")).toBeNull();
	});

	it("gates actions while decommission reconciliation is deferred", () => {
		controller.current = {
			connectionId: "conn-1",
			lifecycle: "decommissioning",
			status: { connection, credentials: [] },
			isPending: false,
			credential: null,
			destructive: null,
			events: [],
			eventsError: false,
			create: vi.fn(),
			refresh: vi.fn(),
			rotate: vi.fn(),
			requestRevoke: vi.fn(),
			requestDecommission: vi.fn(),
			clearCredential: vi.fn(),
			cancelDestructive: vi.fn(),
			confirm: vi.fn(),
		};
		render(
			<ScimStep
				setup={setup()}
				defaultRoleTemplateId="role-1"
				endpoint="https://app.example.test/api/auth/scim/v2"
			/>,
		);
		expect(screen.getByText("decommissioning")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Rotate credential" }),
		).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Decommission" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("renders the server-provided absolute SCIM endpoint", () => {
		renderState(null);
		expect(
			screen.getByText("https://app.example.test/api/auth/scim/v2"),
		).toBeTruthy();
	});
});
