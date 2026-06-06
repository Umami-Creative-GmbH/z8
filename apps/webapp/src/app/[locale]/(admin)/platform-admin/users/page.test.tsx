/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, useQueryMock, invalidateQueriesMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	useQueryMock: vi.fn(),
	invalidateQueriesMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: useQueryMock,
	useQueryClient: () => ({
		invalidateQueries: invalidateQueriesMock,
	}),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) return _key;
			return Object.entries(params ?? {}).reduce(
				(value, [key, replacement]) => value.replace(`{${key}}`, String(replacement)),
				defaultValue,
			);
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({
		push: pushMock,
	}),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("./actions", () => ({
	banUserAction: vi.fn(),
	listUserSessionsAction: vi.fn(),
	listUsersAction: vi.fn(),
	revokeAllUserSessionsAction: vi.fn(),
	revokeSessionAction: vi.fn(),
	unbanUserAction: vi.fn(),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	AlertDialogAction: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div>loading</div>,
}));

vi.mock("@/components/ui/table", () => ({
	Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
	TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
	TableCell: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
		<td {...props}>{children}</td>
	),
	TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
	TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
	TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

import { listUsersAction } from "./actions";
import UsersPage from "./page";

describe("Platform admin users page", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/platform-admin/users");
		useQueryMock.mockReturnValue({
			data: {
				data: [
					{
						id: "usr_abcdef1234567890",
						name: "Ada Lovelace",
						email: "ada@example.com",
						emailVerified: true,
						role: "user",
						banned: false,
						banReason: null,
						banExpires: null,
						createdAt: new Date("2026-05-01T08:00:00Z"),
						image: "https://example.com/avatar.png",
						organizations: [
							{
								id: "org-acme",
								name: "Acme Corp",
								slug: "acme-corp",
								role: "owner",
								status: "approved",
							},
						],
					},
				],
				total: 1,
				page: 1,
				pageSize: 20,
				totalPages: 1,
			},
			isLoading: false,
			error: null,
		});
	});

	it("redacts full names while preserving email visibility", () => {
		render(<UsersPage />);

		expect(screen.getByText("User abcdef")).toBeTruthy();
		expect(screen.getByText("ada@example.com")).toBeTruthy();
		expect(screen.queryByText("Ada Lovelace")).toBeNull();
		expect(screen.queryByAltText("Ada Lovelace")).toBeNull();
	});

	it("shows organization memberships and roles for each user", () => {
		render(<UsersPage />);

		expect(screen.getByText("Organizations")).toBeTruthy();
		expect(screen.getByText("Acme Corp")).toBeTruthy();
		expect(screen.getByText("owner")).toBeTruthy();
	});

	it("passes organization filters through the query key and query function", async () => {
		window.history.replaceState(
			null,
			"",
			"/platform-admin/users?search=ada&status=active&organizationId=org-acme",
		);
		vi.mocked(listUsersAction).mockResolvedValue({
			success: true,
			data: {
				data: [],
				total: 0,
				page: 1,
				pageSize: 20,
				totalPages: 0,
			},
		});

		render(<UsersPage />);

		const queryConfig = useQueryMock.mock.calls.at(-1)?.[0];
		expect(queryConfig.queryKey).toEqual(["admin-users", "ada", "active", "org-acme", 1]);

		await queryConfig.queryFn();

		expect(listUsersAction).toHaveBeenCalledWith(
			{ search: "ada", status: "active", organizationId: "org-acme" },
			1,
			20,
		);
	});

	it("preserves organizationId when updating search filters", () => {
		vi.useFakeTimers();
		window.history.replaceState(null, "", "/platform-admin/users?organizationId=org-acme");

		render(<UsersPage />);
		fireEvent.change(screen.getByLabelText("Search users by email"), {
			target: { value: "ada" },
		});
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect(pushMock).toHaveBeenCalledWith(
			"/platform-admin/users?search=ada&organizationId=org-acme",
		);
	});
});
