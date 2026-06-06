/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({
		push: pushMock,
	}),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("./actions", () => ({
	deleteOrganizationAction: vi.fn(),
	listOrganizationsAction: vi.fn(),
	suspendOrganizationAction: vi.fn(),
	unsuspendOrganizationAction: vi.fn(),
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

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
		<input type="checkbox" {...props} />
	),
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

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import OrganizationsPage from "./page";

describe("Platform admin organizations page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: false,
			error: null,
		});
	});

	it("shows a load error instead of an empty state when organizations fail to load", () => {
		useQueryMock.mockReturnValue({
			data: undefined,
			isError: true,
			isLoading: false,
			error: new Error("Failed to list organizations"),
		});

		render(<OrganizationsPage />);

		expect(screen.getByText("Unable to load organizations")).toBeTruthy();
		expect(screen.getByText("Failed to list organizations")).toBeTruthy();
		expect(screen.queryByText("No organizations found")).toBeNull();
	});

	it("shows descriptive tooltips for organization action buttons", () => {
		useQueryMock.mockReturnValue({
			data: {
				data: [
					{
						id: "org-active",
						name: "Active Org",
						slug: "active-org",
						logo: null,
						createdAt: new Date("2026-01-01T00:00:00.000Z"),
						employeeCount: 3,
						memberCount: 4,
						isSuspended: false,
						suspendedReason: null,
						deletedAt: null,
					},
					{
						id: "org-suspended",
						name: "Suspended Org",
						slug: "suspended-org",
						logo: null,
						createdAt: new Date("2026-01-02T00:00:00.000Z"),
						employeeCount: 1,
						memberCount: 2,
						isSuspended: true,
						suspendedReason: "Billing issue",
						deletedAt: null,
					},
				],
				total: 2,
				page: 1,
				pageSize: 20,
				totalPages: 1,
			},
			isError: false,
			isLoading: false,
			error: null,
		});

		render(<OrganizationsPage />);

		expect(screen.getByText("Suspend organization")).toBeTruthy();
		expect(screen.getByText("Reactivate organization")).toBeTruthy();
		expect(screen.getAllByText("Delete organization")).toHaveLength(2);
	});

	it("links organization names and member counts to filtered users", () => {
		useQueryMock.mockReturnValue({
			data: {
				data: [
					{
						id: "org-active",
						name: "Active Org",
						slug: "active-org",
						logo: null,
						createdAt: new Date("2026-01-01T00:00:00.000Z"),
						employeeCount: 3,
						memberCount: 4,
						isSuspended: false,
						suspendedReason: null,
						deletedAt: null,
					},
				],
				total: 1,
				page: 1,
				pageSize: 20,
				totalPages: 1,
			},
			isError: false,
			isLoading: false,
			error: null,
		});

		render(<OrganizationsPage />);

		expect(screen.getByRole("link", { name: "Active Org" }).getAttribute("href")).toBe(
			"/platform-admin/users?organizationId=org-active",
		);
		expect(screen.getByRole("link", { name: "4" }).getAttribute("href")).toBe(
			"/platform-admin/users?organizationId=org-active",
		);
	});

	it("uses URL filters for the first organizations query", () => {
		window.history.replaceState(
			null,
			"",
			"/platform-admin/organizations?search=acme&status=suspended",
		);

		render(<OrganizationsPage />);

		expect(useQueryMock).toHaveBeenCalledTimes(1);
		const queryConfig = useQueryMock.mock.calls[0]?.[0];
		expect(queryConfig.queryKey).toEqual(["admin-organizations", "acme", "suspended", 1]);
	});
});
