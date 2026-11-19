/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const display = vi.hoisted(() => ({
	userId: "actor-a",
	activeOrganizationId: "org-a",
	employeeId: "employee-a",
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => display,
}));

import { useReportQueryKey } from "./report-read-scope";
import { ReportWorkspaceScope } from "./report-workspace-scope";

afterEach(cleanup);

function Evidence({ read }: { read: () => Promise<string> }) {
	const query = useQuery({ queryKey: useReportQueryKey(["report", "same-id"]), queryFn: read });
	return <p>{query.data ?? "Loading"}</p>;
}

it.each(["userId", "activeOrganizationId", "employeeId"] as const)(
	"retires an old arrival across a %s change and return",
	async (field) => {
		Object.assign(display, {
			userId: "actor-a",
			activeOrganizationId: "org-a",
			employeeId: "employee-a",
		});
		const read = vi.fn(async () => "Authorized report evidence");
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Infinity } },
		});
		const view = (arrival: string) => (
			<QueryClientProvider client={client}>
				<ReportWorkspaceScope
					key={arrival}
					userId="actor-a"
					organizationId="org-a"
					employeeId="employee-a"
					arrival={arrival}
				>
					<Evidence read={read} />
				</ReportWorkspaceScope>
			</QueryClientProvider>
		);
		const rendered = render(view("arrival-1"));
		await screen.findByText("Authorized report evidence");
		const original = display[field];
		display[field] = "other";
		rendered.rerender(view("arrival-1"));
		expect(screen.queryByText("Authorized report evidence")).toBeNull();
		display[field] = original;
		rendered.rerender(view("arrival-1"));
		expect(screen.queryByText("Authorized report evidence")).toBeNull();
		rendered.rerender(view("arrival-2"));
		await screen.findByText("Authorized report evidence");
		expect(read).toHaveBeenCalledTimes(2);
	},
);

it.each(["userId", "activeOrganizationId", "employeeId"] as const)(
	"keeps a mounted workspace through refresh and requires a new read after a %s return",
	async (field) => {
		Object.assign(display, {
			userId: "actor-a",
			activeOrganizationId: "org-a",
			employeeId: "employee-a",
		});
		const read = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("Original report evidence")
			.mockResolvedValueOnce("Newly authorized evidence");
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Infinity } },
		});
		const view = (arrival: string) => (
			<QueryClientProvider client={client}>
				<ReportWorkspaceScope
					key="same-editable-report"
					userId="actor-a"
					organizationId="org-a"
					employeeId="employee-a"
					arrival={arrival}
				>
					<Evidence read={read} />
				</ReportWorkspaceScope>
			</QueryClientProvider>
		);
		const rendered = render(view("arrival-1"));
		const original = await screen.findByText("Original report evidence");
		rendered.rerender(view("arrival-2"));
		expect(screen.getByText("Original report evidence")).toBe(original);
		expect(read).toHaveBeenCalledTimes(1);

		const originalIdentity = display[field];
		display[field] = "other";
		rendered.rerender(view("arrival-2"));
		expect(screen.queryByText("Original report evidence")).toBeNull();
		display[field] = originalIdentity;
		rendered.rerender(view("arrival-2"));
		expect(screen.queryByText("Original report evidence")).toBeNull();
		expect(read).toHaveBeenCalledTimes(1);

		rendered.rerender(view("arrival-3"));
		expect(screen.queryByText("Original report evidence")).toBeNull();
		await screen.findByText("Newly authorized evidence");
		expect(read).toHaveBeenCalledTimes(2);
	},
);
