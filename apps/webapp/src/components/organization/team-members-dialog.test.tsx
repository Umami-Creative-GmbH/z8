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

function renderDialog() {
	const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<TeamMembersDialog
				team={team}
				allMembers={[dana]}
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
