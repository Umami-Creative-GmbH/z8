/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query";
import { InviteMemberDialog } from "./invite-member-dialog";

const {
	createKioskOnlyEmployeeMock,
	listTeamsMock,
	refreshMock,
	sendInvitationMock,
	toastErrorMock,
} = vi.hoisted(() => ({
	createKioskOnlyEmployeeMock: vi.fn(),
	listTeamsMock: vi.fn(),
	refreshMock: vi.fn(),
	sendInvitationMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	sendInvitation: sendInvitationMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => ({
	createKioskOnlyEmployeeAction: createKioskOnlyEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: listTeamsMock,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
	ActionPanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	ActionPanelFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectValue: () => null,
}));

const source = () =>
	readFileSync(join(process.cwd(), "src/components/organization/invite-member-dialog.tsx"), "utf8");

describe("InviteMemberDialog target team form", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listTeamsMock.mockResolvedValue({ success: true, data: [] });
	});

	function renderDialog() {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const onOpenChange = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<InviteMemberDialog
					organizationId="org-1"
					organizationName="Test Organization"
					currentMemberRole="admin"
					open
					onOpenChange={onOpenChange}
				/>
			</QueryClientProvider>,
		);

		return { invalidateQueries, onOpenChange };
	}

	function submitInvitation() {
		fireEvent.change(screen.getByLabelText("Email Address"), {
			target: { value: "new@example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));
	}

	it("uses TanStack Form and loads teams only while open", () => {
		const file = source();

		expect(file).toContain('import { useForm } from "@tanstack/react-form"');
		expect(file).toContain("useQuery");
		expect(file).toContain("useMutation");
		expect(file).toContain("useQueryClient");
		expect(file).toContain(
			'import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions"',
		);
		expect(file).toContain("queryKeys.teams.list(organizationId)");
		expect(file).toContain("enabled: open");
	});

	it("submits targetTeamId using the none sentinel and resets on success", () => {
		const file = source();

		expect(file).toContain('targetTeamId: "none"');
		expect(file).toContain('value.targetTeamId === "none" ? null : value.targetTeamId');
		expect(file).toContain("form.reset()");
	});

	it("invalidates invitations and employees after an invitation succeeds", async () => {
		sendInvitationMock.mockResolvedValue({ success: true });
		const { invalidateQueries, onOpenChange } = renderDialog();

		submitInvitation();

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.invitations.list("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(refreshMock).toHaveBeenCalledOnce();
	});

	it("invalidates neither query after a resolved invitation failure", async () => {
		sendInvitationMock.mockResolvedValue({ success: false, error: "Invitation failed" });
		const { invalidateQueries } = renderDialog();

		submitInvitation();

		await waitFor(() => expect(sendInvitationMock).toHaveBeenCalledOnce());
		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Invitation failed"));
		expect(invalidateQueries).not.toHaveBeenCalled();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("creates a kiosk-only employee without an email instead of inviting (#857)", async () => {
		createKioskOnlyEmployeeMock.mockResolvedValue({ success: true, data: { employeeId: "e-1" } });
		const { invalidateQueries, onOpenChange } = renderDialog();

		fireEvent.click(screen.getByRole("checkbox", { name: "Kiosk only, no email" }));
		expect(screen.queryByLabelText("Email Address")).toBeNull();
		fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
		fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Doe" } });
		fireEvent.click(screen.getByRole("button", { name: "Create employee" }));

		await waitFor(() =>
			expect(createKioskOnlyEmployeeMock).toHaveBeenCalledWith({
				firstName: "Jamie",
				lastName: "Doe",
				teamId: null,
			}),
		);
		expect(sendInvitationMock).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			}),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("shows why a kiosk-only employee could not be created", async () => {
		createKioskOnlyEmployeeMock.mockResolvedValue({
			success: false,
			error: "Only organization owners and admins can manage kiosk-only employees.",
			code: "not_allowed",
		});
		const { onOpenChange } = renderDialog();

		fireEvent.click(screen.getByRole("checkbox", { name: "Kiosk only, no email" }));
		fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
		fireEvent.click(screen.getByRole("button", { name: "Create employee" }));

		await waitFor(() =>
			expect(toastErrorMock).toHaveBeenCalledWith("You are not allowed to do this."),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("renders an accessible target team select below role", () => {
		const file = source();

		expect(file).toContain('htmlFor="targetTeam"');
		expect(file).toContain('id="targetTeam"');
		expect(file).toContain('aria-label={t("organization.invite.targetTeam"');
		expect(file.indexOf('htmlFor="role"')).toBeLessThan(file.indexOf('htmlFor="targetTeam"'));
	});
});
