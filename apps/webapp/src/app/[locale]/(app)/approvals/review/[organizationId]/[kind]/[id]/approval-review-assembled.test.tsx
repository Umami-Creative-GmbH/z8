// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";

const navigation = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
	useRouter: () => navigation,
}));
// Server action transport boundaries; the arrival, detail panel, query and
// mutation hooks, Sheet, and TanStack reason form are assembled production code.
vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({
	prepareTimeCorrectionRevision: vi.fn(),
	requestTimeCorrection: vi.fn(),
}));
vi.mock("@/components/travel-expenses/report/actions", () => ({}));
vi.mock("@/lib/query", async () => ({
	useEmployeeClockStatuses: (
		await import("@/lib/query/use-employee-clock-statuses")
	).useEmployeeClockStatuses,
}));
vi.mock(
	"@/app/[locale]/(app)/settings/employees/employee-clock-status.actions",
	() => ({
		getEmployeeClockStatuses: async () => ({ success: true, data: {} }),
	}),
);

const { ApprovalReviewOutcome, ApprovalReviewLoading } = await import(
	"./approval-review-view"
);
const { default: ApprovalReviewError } = await import("./error");

const item: ApprovalInboxItem = {
	id: "9f000000-0000-4000-8000-000000001710",
	type: "absence_entry",
	entityId: "absence-1710",
	status: "pending",
	requester: {
		id: "employee-1710",
		name: "Review Requester",
		email: "requester@example.test",
		image: null,
		teamId: null,
	},
	summary: {
		title: "Absence Request",
		subtitle: "2026-11-20",
		detail: "Vacation · 3 days",
		badge: { label: "Vacation", color: null },
	},
	timing: {
		createdAt: "2026-11-10T00:00:00Z",
		resolvedAt: null,
		slaDeadline: null,
		ageDays: 1,
	},
	triage: {
		priority: "normal",
		riskLevel: "low",
		riskReasons: [],
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: "",
	},
	capabilities: {
		canApprove: true,
		canReject: true,
		canBulkApprove: false,
		requiresRejectReason: true,
	},
};
const path = `/approvals/review/org-1710/compatibility/${item.id}`;
const detail = () => ({
	item,
	actions: item.capabilities,
	sections: [
		{
			type: "text",
			title: "Submitted reason",
			body: "Actual submitted reason\nSecond line",
		},
	],
});
let client: QueryClient;

function show() {
	return render(
		<QueryClientProvider client={client}>
			<ApprovalReviewOutcome
				arrival={{ status: "ready", item }}
				reviewPath={path}
			/>
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
});
afterEach(() => {
	cleanup();
	client.clear();
	vi.unstubAllGlobals();
});

describe("assembled review arrival", () => {
	it("withholds stale list authority when the exact detail refuses, then reloads evidence", async () => {
		let refused = true;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				refused
					? new Response("Forbidden", { status: 403 })
					: Response.json(detail()),
			),
		);
		show();
		await screen.findByText(
			"Decision rights and evidence are unavailable. Retry before deciding.",
		);
		expect(
			(screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			screen.queryByText("Actual submitted reason", { exact: false }),
		).toBeNull();
		refused = false;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText(/Actual submitted reason\s+Second line/);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
					.disabled,
			).toBe(false),
		);
	});

	it("retains a failed rejection reason, guards pending dismissal and returns to Inbox only on success", async () => {
		let finish: ((response: Response) => void) | undefined;
		const bodies: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method !== "POST") return Response.json(detail());
				bodies.push(String(init.body));
				if (bodies.length === 1)
					return Response.json({ error: "Access changed" }, { status: 403 });
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			}),
		);
		show();
		await screen.findByText(/Actual submitted reason\s+Second line/);
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		const reason = screen.getByRole("textbox");
		fireEvent.change(reason, { target: { value: "  My reviewed reason  " } });
		fireEvent.click(screen.getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(bodies).toHaveLength(1));
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Confirm Rejection",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		expect((reason as HTMLTextAreaElement).value).toBe(
			"  My reviewed reason  ",
		);
		expect(navigation.push).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(finish).toBeDefined());
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(bodies).toEqual([
			'{"reason":"My reviewed reason"}',
			'{"reason":"My reviewed reason"}',
		]);
		await act(async () =>
			finish?.(
				Response.json({
					success: true,
					result: { id: item.id, type: item.type, status: "rejected" },
				}),
			),
		);
		await waitFor(() =>
			expect(navigation.push).toHaveBeenCalledWith("/approvals/inbox"),
		);
	});

	it("announces loading and keeps infrastructure recovery distinct from safe unavailability", () => {
		const loading = render(<ApprovalReviewLoading />);
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(
			screen.getByRole("heading", { level: 1, name: "Approval review" }),
		).toBeTruthy();
		loading.unmount();
		const retry = vi.fn();
		render(
			<ApprovalReviewError
				error={new Error("private database detail")}
				retry={retry}
			/>,
		);
		expect(screen.queryByText("private database detail")).toBeNull();
		expect(screen.queryByText("This approval is not available")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledOnce();
		expect(
			screen.getByRole("link", { name: "Open Inbox" }).getAttribute("href"),
		).toBe("/approvals/inbox");
	});
});
