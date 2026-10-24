// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberWithUserAndEmployee } from "./people-management-types";

const api = vi.hoisted(() => ({
	add: vi.fn(),
	remove: vi.fn(),
	preview: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en-GB" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	addTeamMember: api.add,
	removeTeamMember: api.remove,
	previewTeamMemberChangeDrivingImpact: api.preview,
}));
vi.mock("@/lib/query", () => ({
	queryKeys: { teams: { all: ["teams"] }, members: { all: ["members"] } },
	useEmployeeClockStatuses: () => ({ getStatus: () => undefined }),
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

import { TeamMembersDialog } from "./team-members-dialog";

const organizationId = "org-1425";
const teamId = "d1425000-0000-4000-8000-0000000000a1";
const employeeId = "d1425000-0000-4000-8000-000000000001";
const team = {
	id: teamId,
	organizationId,
	name: "Delivery",
} as Parameters<typeof TeamMembersDialog>[0]["team"];
const dana = {
	member: { id: "m1" },
	user: { id: "u1", name: "Dana Driver", email: "dana@example.test", image: null },
	employee: { id: employeeId, organizationId, teamId, position: null },
	teamMemberships: [{ teamId }],
} as unknown as MemberWithUserAndEmployee;

function renderDialog(allMembers: MemberWithUserAndEmployee[] = [dana]) {
	const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<TeamMembersDialog
				team={team}
				allMembers={allMembers}
				open
				onOpenChange={() => {}}
				canManageMembers
			/>
		</QueryClientProvider>,
	);
}
async function clickRemove() {
	const row = (await screen.findByText("Dana Driver")).closest(
		"div.flex.items-center.justify-between",
	);
	if (!(row instanceof HTMLElement)) throw new Error("member row missing");
	await userEvent.click(within(row).getByRole("button"));
}

describe("TeamMembersDialog former employees (#1438)", () => {
	const fern = {
		member: { id: "m2" },
		user: { id: "u2", name: "Fern Former", email: "fern@example.test", image: null },
		employee: { id: "d1425000-0000-4000-8000-000000000002", organizationId, teamId, position: null },
		teamMemberships: [{ teamId }],
		isFormerEmployee: true,
		formerSince: "2026-10-12",
	} as unknown as MemberWithUserAndEmployee;
	const gus = {
		member: { id: "m4" },
		user: { id: "u4", name: "Gus Gone", email: "gus@example.test", image: null },
		employee: { id: "d1425000-0000-4000-8000-000000000004", organizationId, teamId, position: null },
		teamMemberships: [{ teamId }],
		isFormerEmployee: true,
		formerSince: null,
	} as unknown as MemberWithUserAndEmployee;
	const otto = {
		member: { id: "m3" },
		user: { id: "u3", name: "Otto Outside", email: "otto@example.test", image: null },
		employee: { id: "d1425000-0000-4000-8000-000000000003", organizationId, teamId: null },
		teamMemberships: [],
		isFormerEmployee: true,
	} as unknown as MemberWithUserAndEmployee;

	it("hides former members until asked for, then marks them with the date they left", async () => {
		renderDialog([dana, fern, gus]);

		expect(await screen.findByText("Dana Driver")).toBeTruthy();
		expect(screen.queryByText("Fern Former")).toBeNull();
		expect(screen.getByText("Current Members (1)")).toBeTruthy();

		await userEvent.click(screen.getByRole("switch", { name: "Show former employees" }));

		const rowOf = (name: string) =>
			screen.getByText(name).closest("div.flex.items-center.justify-between") as HTMLElement;
		expect(within(rowOf("Fern Former")).getByText("Former since 12 Oct 2026")).toBeTruthy();
		expect(within(rowOf("Gus Gone")).getByText("Former · date not recorded")).toBeTruthy();
		expect(within(rowOf("Dana Driver")).queryByText(/Former/)).toBeNull();
	});

	it("never offers a former employee to add", () => {
		renderDialog([dana, otto]);

		// Otto is the only employee outside the team, and former: nobody is left to add.
		expect(screen.queryByText("Select an employee to add")).toBeNull();
		expect(screen.queryByRole("switch")).toBeNull();
	});
});

describe("TeamMembersDialog driving licence warning (#1425)", () => {
	const token = "a".repeat(64);
	const nobody = { success: true, data: { detail: "full", employees: [], previewToken: token } };
	const confirmed = { drivingLicencePreviewToken: token };
	beforeEach(() => {
		api.add.mockReset().mockResolvedValue({ success: true, data: undefined });
		api.remove.mockReset().mockResolvedValue({ success: true, data: undefined });
		api.preview.mockReset().mockResolvedValue(nobody);
		api.toast.success.mockReset();
		api.toast.error.mockReset();
	});

	it("removes at once when the change ends no driving authorization, confirming the empty preview", async () => {
		renderDialog();
		await clickRemove();
		await waitFor(() => expect(api.remove).toHaveBeenCalledWith(teamId, employeeId, confirmed));
		expect(api.preview).toHaveBeenCalledWith(teamId, employeeId, "remove");
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("warns who loses which classes before removing, and removes on confirmation", async () => {
		api.preview.mockResolvedValue({
			success: true,
			data: {
				detail: "full",
				employees: [{ employeeId, name: "Dana Driver", classCodes: ["B", "C"] }],
				previewToken: token,
			},
		});
		renderDialog();
		await clickRemove();
		const warning = await screen.findByRole("alertdialog", {
			name: "This team change ends driving authorizations",
		});
		expect(within(warning).getByText("B, C")).toBeTruthy();
		expect(api.remove).not.toHaveBeenCalled();
		await userEvent.click(
			within(warning).getByRole("button", { name: "Continue and end authorizations" }),
		);
		await waitFor(() => expect(api.remove).toHaveBeenCalledWith(teamId, employeeId, confirmed));
	});

	it("shows a team manager only that some driving authorizations end: no names or classes", async () => {
		api.preview.mockResolvedValue({
			success: true,
			data: { detail: "generic", affected: true, previewToken: token },
		});
		renderDialog();
		await clickRemove();
		const warning = await screen.findByRole("alertdialog", {
			name: "This team change ends driving authorizations",
		});
		expect(
			within(warning).getByText("This change ends driving authorizations for some employees."),
		).toBeTruthy();
		expect(within(warning).queryByRole("list")).toBeNull();
		await userEvent.click(
			within(warning).getByRole("button", { name: "Continue and end authorizations" }),
		);
		await waitFor(() => expect(api.remove).toHaveBeenCalledWith(teamId, employeeId, confirmed));
	});

	it("removes at once when a generic preview shows nothing ends", async () => {
		api.preview.mockResolvedValue({
			success: true,
			data: { detail: "generic", affected: false, previewToken: token },
		});
		renderDialog();
		await clickRemove();
		await waitFor(() => expect(api.remove).toHaveBeenCalledWith(teamId, employeeId, confirmed));
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("asks for a fresh review when the warning went stale before the save", async () => {
		api.remove.mockResolvedValue({
			success: false,
			error: "Who this change affects has changed in the meantime. Review it and try again.",
			code: "ValidationError",
			refusal: "stale_preview",
		});
		renderDialog();
		await clickRemove();
		await waitFor(() =>
			expect(api.toast.error).toHaveBeenCalledWith(
				"Who this change affects has changed in the meantime. Try the change again to review it.",
			),
		);
	});

	it("keeps the member when the warning is cancelled", async () => {
		api.preview.mockResolvedValue({
			success: true,
			data: {
				detail: "full",
				employees: [{ employeeId, name: "Dana Driver", classCodes: ["B"] }],
				previewToken: token,
			},
		});
		renderDialog();
		await clickRemove();
		const warning = await screen.findByRole("alertdialog");
		await userEvent.click(within(warning).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(api.remove).not.toHaveBeenCalled();
	});

	it("refuses the change when the warning can't be loaded", async () => {
		api.preview.mockResolvedValue({ success: false, error: "forbidden" });
		renderDialog();
		await clickRemove();
		await waitFor(() =>
			expect(api.toast.error).toHaveBeenCalledWith(
				"Couldn't check whether this change ends driving authorizations. Try again.",
			),
		);
		expect(api.remove).not.toHaveBeenCalled();
	});
});
