/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MembersTable } from "./members-table";
import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, values?: Record<string, unknown>) =>
			defaultValue?.replace("{count}", String(values?.count ?? "")) ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	cancelInvitation: vi.fn(),
	removeMember: vi.fn(),
	sendInvitation: vi.fn(),
	toggleEmployeeStatus: vi.fn(),
	updateMemberRole: vi.fn(),
}));

vi.mock("./edit-invitation-target-team-dialog", () => ({
	EditInvitationTargetTeamDialog: () => null,
}));

vi.mock("@/lib/query", async () => {
	const actual = await vi.importActual<typeof import("@/lib/query")>("@/lib/query");

	return {
		...actual,
		useEmployeeClockStatuses: () => ({
			getStatus: () => "unknown",
		}),
	};
});

const componentSource = () =>
	readFileSync(join(process.cwd(), "src/components/organization/members-table.tsx"), "utf8");

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const member = {
	member: {
		id: "member-1",
		role: "member",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		organizationId: "org-1",
		teamId: null,
		userId: "user-1",
	},
	user: {
		id: "user-1",
		name: "Active Alice",
		email: "alice@example.com",
		emailVerified: true,
		image: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	},
	employee: {
		id: "employee-1",
		isActive: true,
	},
};

const invitation = {
	id: "invitation-1",
	organizationId: "org-1",
	email: "pending@example.com",
	role: "member",
	status: "pending",
	expiresAt: new Date("2027-01-01T00:00:00.000Z"),
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	inviterId: "user-1",
	user: member.user,
	targetTeamId: null,
	targetTeam: null,
};

function renderMembersTable(defaultTab?: "members" | "invitations") {
	return renderWithQueryClient(
		<MembersTable
			organizationId="org-1"
			members={[member as never]}
			invitations={[invitation as never]}
			defaultTab={defaultTab}
			currentMemberRole="admin"
			currentUserId="user-1"
		/>,
	);
}

describe("MembersTable invitation target teams", () => {
	it("opens active members by default and pending invitations when requested", () => {
		const { unmount } = renderMembersTable();

		expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
			"Active Members",
		);
		expect(screen.getByRole("tabpanel").textContent).toContain("Active Alice");
		unmount();

		renderMembersTable("invitations");

		expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
			"Pending Invitations",
		);
		expect(within(screen.getByRole("tabpanel")).getByText("pending@example.com")).toBeTruthy();
	});

	it("allows callers to open pending invitations by default", () => {
		const file = componentSource();

		expect(file).toContain('defaultTab = "members"');
		expect(file).toContain('defaultTab?: "members" | "invitations"');
		expect(file).toContain("<Tabs defaultValue={defaultTab}");
	});

	it("resolves local target team updates from the submitted id", () => {
		const update = resolveInvitationTargetTeamUpdate("team-a", [
			{ id: "team-a", name: "Submitted Team" },
			{ id: "team-b", name: "Later Selected Team" },
		]);

		expect(update).toEqual({
			targetTeamId: "team-a",
			targetTeam: { id: "team-a", name: "Submitted Team" },
		});
	});

	it("shows pending invitation target teams and exposes the edit action", () => {
		const file = componentSource();

		expect(file).toContain(
			'import { EditInvitationTargetTeamDialog } from "./edit-invitation-target-team-dialog"',
		);
		expect(file).toContain('accessorKey: "targetTeam"');
		expect(file).toContain('organization.members.targetTeam", "Target Team"');
		expect(file).toContain('organization.members.noTargetTeam", "No team"');
		expect(file).toContain('organization.members.editTargetTeam", "Edit target team"');
		expect(file).toContain("<EditInvitationTargetTeamDialog");
	});

	it("preserves targetTeamId when resending pending invitations", () => {
		const file = componentSource();

		expect(file).toContain("targetTeamId: invitation.targetTeamId ?? null");
	});

	it("updates the local pending invitation target team after editing", () => {
		const table = componentSource();
		const dialog = readFileSync(
			join(process.cwd(), "src/components/organization/edit-invitation-target-team-dialog.tsx"),
			"utf8",
		);

		expect(dialog).toContain("onUpdated:");
		expect(dialog).toContain(
			'import { resolveInvitationTargetTeamUpdate } from "./edit-invitation-target-team-dialog.utils"',
		);
		expect(dialog).toContain("mutationFn: ({ targetTeamId }");
		expect(dialog).toContain("onSuccess: (result, variables)");
		expect(dialog).toContain(
			"const update = resolveInvitationTargetTeamUpdate(variables.targetTeamId, teams)",
		);
		expect(dialog).toContain("onUpdated(update)");
		expect(dialog).toContain("disabled={updateMutation.isPending}");
		expect(dialog).toContain("updateMutation.mutate({ targetTeamId: submittedTargetTeamId })");
		expect(table).toContain("handleInvitationTargetTeamUpdated");
		expect(table).toContain("setInvitations((currentInvitations) =>");
		expect(table).toContain("invitation.id === invitationId");
		expect(table).toContain("targetTeamId: update.targetTeamId");
		expect(table).toContain("targetTeam: update.targetTeam");
		expect(table).toContain("onUpdated={handleInvitationTargetTeamUpdated}");
	});

	it("keeps people-management components off the organization settings page", () => {
		const pageSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/settings/organizations/page.tsx"),
			"utf8",
		);
		const tabSource = readFileSync(
			join(process.cwd(), "src/components/organization/organization-tab.tsx"),
			"utf8",
		);
		const clientSource = readFileSync(
			join(process.cwd(), "src/components/organization/organizations-page-client.tsx"),
			"utf8",
		);

		expect(pageSource).not.toContain("type InvitationWithInviter");
		expect(pageSource).not.toContain("type MemberWithUserAndEmployee");
		expect(pageSource).not.toContain("db.query.invitation.findMany");
		expect(pageSource).not.toContain("db.query.member.findFirst");
		expect(pageSource).not.toContain(".from(authSchema.member)");
		expect(tabSource).not.toContain("InviteCodeManagement");
		expect(tabSource).not.toContain("PendingMembersCard");
		expect(tabSource).not.toContain("MembersTable");
		expect(tabSource).not.toContain("InviteMemberDialog");
		expect(clientSource).not.toContain("members:");
		expect(clientSource).not.toContain("invitations:");
	});
});
