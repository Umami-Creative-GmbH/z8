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
	useRouter: () => ({
		push: pushMock,
	}),
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
	AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
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
	Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
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
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
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
});
