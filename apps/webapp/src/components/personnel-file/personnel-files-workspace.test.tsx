// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PersonnelFilesWorkspace } from "./personnel-files-workspace";

const boundary = vi.hoisted(() => ({
	refresh: vi.fn(),
	scope: { userId: "officer", activeOrganizationId: "org" },
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "officer" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	}),
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: boundary.refresh }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const employees = [
	{ id: "anna", name: "Anna Example", employeeNumber: "001", isActive: true },
	{ id: "ben", name: "Ben Former", employeeNumber: "002", isActive: false },
];
const capability = {
	payslipBatches: false,
	documentRequests: true,
	sickLeave: false,
	officerSettings: false,
};
const props = {
	readId: "server-read",
	userId: "officer",
	organizationId: "org",
	employees,
	capability,
	attention: <a href="/personnel-files/anna">Expiring certificate</a>,
};
beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = { userId: "officer", activeOrganizationId: "org" };
});

it("leads with attention then employee records and retains scoped destinations and former identity", () => {
	render(<PersonnelFilesWorkspace {...props} />);
	expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
	const directory = screen.getByRole("region", { name: "Employee records" });
	expect(
		within(directory)
			.getByRole("link", { name: /Anna Example/ })
			.getAttribute("href"),
	).toBe("/personnel-files/anna");
	expect(
		within(directory).getByRole("link", {
			name: /Ben Former.*Former employee/,
		}),
	).toBeTruthy();
	expect(
		screen.getByText("Expiring certificate").compareDocumentPosition(directory) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	const destinations = screen.getByRole("navigation", {
		name: "Personnel file workflows",
	});
	expect(
		within(destinations)
			.getAllByRole("link")
			.map((link) => link.getAttribute("href")),
	).toEqual(["/personnel-files/document-requests", "/personnel-files/due-for-deletion"]);
	expect(screen.queryByRole("link", { name: "Payslip batch" })).toBeNull();
});

it("distinguishes unknown directory from an empty scope and retries the server owner", () => {
	render(<PersonnelFilesWorkspace {...props} employees={null} />);
	expect(screen.queryByText("No employees are in your scope yet.")).toBeNull();
	expect(screen.getByRole("alert").textContent).toContain("Employee records could not be loaded");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledTimes(1);
});

it("keeps empty scope guidance and only capability-admitted workflow links", () => {
	render(
		<PersonnelFilesWorkspace
			{...props}
			employees={[]}
			capability={{
				payslipBatches: true,
				documentRequests: false,
				sickLeave: true,
				officerSettings: true,
			}}
		/>,
	);
	expect(screen.getByText("No employees are in your scope yet.")).toBeTruthy();
	expect(screen.getByText(/Contact an organization administrator/)).toBeTruthy();
	for (const href of [
		"/personnel-files/payslip-batches",
		"/personnel-files/sick-leave",
		"/settings/personnel-files",
	])
		expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === href)).toBe(
			true,
		);
	expect(screen.queryByRole("link", { name: "Document requests" })).toBeNull();
});

it("hides previous and late-arriving records and open attention panels after scope changes", () => {
	const { rerender } = render(<PersonnelFilesWorkspace {...props} />);
	boundary.scope.activeOrganizationId = "other";
	rerender(<PersonnelFilesWorkspace {...props} />);
	expect(screen.queryByText("Anna Example")).toBeNull();
	expect(screen.queryByText("Expiring certificate")).toBeNull();
	boundary.scope = { userId: "other-user", activeOrganizationId: "org" };
	rerender(<PersonnelFilesWorkspace {...props} />);
	expect(screen.queryByRole("navigation")).toBeNull();
});
