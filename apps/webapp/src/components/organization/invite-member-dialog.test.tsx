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

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "actor-1" }, session: { activeOrganizationId: "org-1" } },
		isPending: false,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	sendInvitation: sendInvitationMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => ({
	createKioskOnlyEmployeeAction: createKioskOnlyEmployeeMock,
	getKioskOnlyEmployeeLocationsAction: async () => ({
		success: true,
		data: [
			{ id: "loc-store", name: "Store" },
			{ id: "loc-warehouse", name: "Warehouse" },
		],
	}),
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

vi.mock("@/app/[locale]/(app)/settings/projects/actions", () => ({
	getProjects: async () => ({
		success: true,
		data: [
			{ id: "6f1c1e9e-8a5c-4e0e-9a51-0c6f1f7c2b11", name: "Client rollout", isActive: true },
			{ id: "7a2d2f0f-9b6d-4f1f-8b62-1d7f2f8d3c22", name: "Archived pilot", isActive: false },
		],
	}),
}));

vi.mock("@/components/ui/select", async () => {
	const { createContext, useContext } = await import("react");
	const Choose = createContext<(value: string) => void>(() => {});
	return {
		Select: ({
			children,
			onValueChange,
		}: {
			children: ReactNode;
			onValueChange?: (value: string) => void;
		}) => <Choose.Provider value={onValueChange ?? (() => {})}>{children}</Choose.Provider>,
		SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
			const choose = useContext(Choose);
			return (
				<button type="button" role="option" aria-selected={false} onClick={() => choose(value)}>
					{children}
				</button>
			);
		},
		SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		SelectValue: () => null,
	};
});

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		id,
		value,
		min,
		onChange,
	}: {
		id: string;
		value?: string | null;
		min?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			id={id}
			data-min={min}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
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
					organizationToday="2026-11-23"
					settingsAccess="orgAdmin"
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
		// The admin picks the assigned locations whose kiosks accept the employee (#761).
		fireEvent.click(await screen.findByRole("checkbox", { name: "Warehouse" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Store" }));
		fireEvent.click(screen.getByRole("button", { name: "Create employee" }));

		await waitFor(() =>
			expect(createKioskOnlyEmployeeMock).toHaveBeenCalledWith({
				firstName: "Jamie",
				lastName: "Doe",
				teamId: null,
				locationIds: ["loc-warehouse", "loc-store"],
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

	it("invites an employee unless the admin chooses otherwise (#1995)", async () => {
		sendInvitationMock.mockResolvedValue({ success: true });
		renderDialog();

		expect(screen.queryByLabelText("Contracting company")).toBeNull();
		submitInvitation();

		await waitFor(() =>
			expect(sendInvitationMock).toHaveBeenCalledWith({
				email: "new@example.com",
				role: "member",
				canCreateOrganizations: false,
				targetTeamId: null,
				engagementKind: "employee",
			}),
		);
	});

	it("invites an External Contractor with contracting details, projects and a planned end (#1995)", async () => {
		sendInvitationMock.mockResolvedValue({ success: true });
		renderDialog();

		fireEvent.click(screen.getByRole("option", { name: /External Contractor/ }));
		fireEvent.change(screen.getByLabelText("Contracting company"), {
			target: { value: "Hopper Consulting GmbH" },
		});
		fireEvent.change(screen.getByLabelText("VAT ID"), { target: { value: "DE123456789" } });
		fireEvent.change(screen.getByLabelText("PO or cost center"), { target: { value: "PO-4711" } });
		fireEvent.change(screen.getByLabelText("Planned engagement end"), {
			target: { value: "2027-06-30" },
		});
		// Only active projects are offered.
		expect(screen.queryByRole("checkbox", { name: "Archived pilot" })).toBeNull();
		fireEvent.click(await screen.findByRole("checkbox", { name: "Client rollout" }));
		submitInvitation();

		await waitFor(() =>
			expect(sendInvitationMock).toHaveBeenCalledWith(
				expect.objectContaining({
					engagementKind: "contractor",
					contractor: {
						companyName: "Hopper Consulting GmbH",
						vatId: "DE123456789",
						referenceCode: "PO-4711",
						projectIds: ["6f1c1e9e-8a5c-4e0e-9a51-0c6f1f7c2b11"],
						plannedEndDate: "2027-06-30",
					},
				}),
			),
		);
	});

	it("offers only planned engagement ends after the organization's today (#1995)", async () => {
		renderDialog();

		fireEvent.click(screen.getByRole("option", { name: /External Contractor/ }));
		const plannedEnd = screen.getByLabelText("Planned engagement end");
		expect(plannedEnd.getAttribute("data-min")).toBe("2026-11-24");

		fireEvent.change(plannedEnd, { target: { value: "2026-11-23" } });
		submitInvitation();

		expect(await screen.findByText("The planned engagement end must be after today.")).toBeTruthy();
		expect(sendInvitationMock).not.toHaveBeenCalled();
	});

	it("renders an accessible target team select below role", () => {
		const file = source();

		expect(file).toContain('htmlFor="targetTeam"');
		expect(file).toContain('id="targetTeam"');
		expect(file).toContain('aria-label={t("organization.invite.targetTeam"');
		expect(file.indexOf('htmlFor="role"')).toBeLessThan(file.indexOf('htmlFor="targetTeam"'));
	});
});
