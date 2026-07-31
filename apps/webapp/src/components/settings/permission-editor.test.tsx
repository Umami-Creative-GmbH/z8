/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionEditor } from "./permission-editor";

const mocks = vi.hoisted(() => ({ grant: vi.fn(), revoke: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/permissions/actions", () => ({
	grantTeamPermissions: mocks.grant,
	revokeTeamPermissions: mocks.revoke,
}));
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));
vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		id,
		checked,
		onCheckedChange,
	}: {
		id: string;
		checked: boolean;
		onCheckedChange: (checked: boolean) => void;
	}) => (
		<button
			type="button"
			aria-label={id}
			onClick={() => onCheckedChange(!checked)}
		/>
	),
}));
vi.mock("@/components/ui/label", () => ({
	Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectValue: () => null,
}));

describe("PermissionEditor mutation payloads", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.grant.mockResolvedValue({ success: true });
		mocks.revoke.mockResolvedValue({ success: true });
	});

	it("grants without exposing an organization ID", async () => {
		render(
			<PermissionEditor
				employeeId="employee-1"
				employeeName="Ada"
				availableTeams={[]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "canCreateTeams" }));
		fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

		await waitFor(() => expect(mocks.grant).toHaveBeenCalledOnce());
		expect(mocks.grant).toHaveBeenCalledWith({
			employeeId: "employee-1",
			teamId: null,
			permissions: {
				canCreateTeams: true,
				canManageTeamMembers: false,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
			},
		});
	});

	it("revokes without exposing an organization ID", async () => {
		render(
			<PermissionEditor
				employeeId="employee-1"
				employeeName="Ada"
				availableTeams={[]}
				currentPermissions={{
					teamId: null,
					canCreateTeams: true,
					canManageTeamMembers: false,
					canManageTeamSettings: false,
					canApproveTeamRequests: false,
				}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Revoke All" }));

		await waitFor(() => expect(mocks.revoke).toHaveBeenCalledOnce());
		expect(mocks.revoke).toHaveBeenCalledWith("employee-1", undefined);
	});
});
