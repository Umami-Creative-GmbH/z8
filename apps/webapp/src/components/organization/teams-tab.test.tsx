// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScopedTeam } from "@/app/[locale]/(app)/settings/teams/team-scope";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({ deleteTeam: vi.fn() }));
vi.mock("@/lib/query", () => ({
	queryKeys: { teams: { all: ["teams"], list: (id: string) => ["teams", id] } },
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./create-team-dialog", () => ({ CreateTeamDialog: () => null }));
vi.mock("./edit-team-dialog", () => ({ EditTeamDialog: () => null }));
vi.mock("./team-members-dialog", () => ({
	TeamMembersDialog: () => null,
	isFormerTeamMember: () => false,
}));
vi.mock("./team-card", () => ({
	TeamCard: ({ team, onDelete }: { team: ScopedTeam; onDelete?: () => void }) => (
		<button type="button" onClick={onDelete}>
			Delete {team.name}
		</button>
	),
}));

import { deleteTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import { TeamsTab } from "./teams-tab";

const team = {
	id: "team-1",
	organizationId: "org-1",
	name: "Delivery",
	description: null,
	primaryManagerId: null,
	canManageMembers: true,
	canManageSettings: true,
} as unknown as ScopedTeam;

describe("TeamsTab delete confirmation", () => {
	it("names the team in the delete dialog title", async () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<TeamsTab
					teams={[team]}
					members={[]}
					canAccessOrganizationAdminSurface
					canCreateTeams
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete Delivery" }));

		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain("Delete team Delivery?");
		expect(dialog.textContent).toContain('This will permanently delete the team "Delivery".');
		expect(dialog.textContent).not.toContain("Are you sure?");
	});

	it("keeps the dialog open, restores the team and shows the refusal when deletion fails", async () => {
		vi.mocked(deleteTeam).mockResolvedValue({
			success: false,
			error: "Team still owns shift templates",
		} as never);
		render(
			<QueryClientProvider client={new QueryClient()}>
				<TeamsTab
					teams={[team]}
					members={[]}
					canAccessOrganizationAdminSurface
					canCreateTeams
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete Delivery" }));
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "Delete Team" }));

		await waitFor(() => expect(deleteTeam).toHaveBeenCalledWith({ teamId: "team-1" }));
		expect((await screen.findByRole("alert")).textContent).toBe("Team still owns shift templates");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete Delivery", hidden: true })).toBeTruthy();
	});

	it("omits a manual toolbar refresh button", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<TeamsTab
					teams={[team]}
					members={[]}
					canAccessOrganizationAdminSurface
					canCreateTeams
					organizationId="org-1"
				/>
			</QueryClientProvider>,
		);

		expect(screen.queryByRole("button", { name: /Refresh/i })).toBeNull();
	});
});
