/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { ScheduleStatutoryFindings } from "@/lib/statutory/scheduling/findings-list";
import { STATUTORY_PUBLICATION_BLOCKED } from "@/lib/statutory/scheduling/publication-block";

const { publishShiftsMock, toastError } = vi.hoisted(() => ({
	publishShiftsMock: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback
				.replace(
					/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
					(_match, name: string, one: string, other: string) =>
						(Number(params?.[name]) === 1 ? one : other).replace("#", String(params?.[name])),
				)
				.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({ publishShifts: publishShiftsMock }));

const { PublishComplianceDialog } = await import("./publish-compliance-dialog");
const { PublishBlockedDialog } = await import("./publish-blocked-dialog");
const { useShiftPublishFlow } = await import("./use-shift-publish-flow");

const ANNA = "0b4f7d0e-5c3a-4a8e-9d55-6a1f0f3b9a01";
const RANGE = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

const nightWork: StatutoryComplianceFinding = {
	type: "statutory",
	employeeId: ANNA,
	findingId: `jarbschg_night_work:${ANNA}:shift:s1`,
	statutoryKind: "jarbschg_night_work",
	domain: "youth_protection",
	severity: "critical",
	subjectKey: "shift:s1",
	legalReference: "§ 14 JArbSchG",
	summary: {
		tier: "exceeded",
		used: { unit: "minutes", value: 60 },
		limit: { unit: "minutes", value: 0 },
	},
	day: "2027-03-02",
	acknowledgementStatus: "none",
	blocksPublication: true,
};

const blocking: ScheduleStatutoryFindings = {
	items: [
		{
			employeeName: "Anna Berg",
			finding: nightWork,
			period: { start: "2027-03-02", endExclusive: "2027-03-03" },
		},
	],
	outsideScopeCount: 1,
	canOpenReviews: false,
};

describe("PublishComplianceDialog", () => {
	it("lists the statutory findings the planner acknowledges: who, which limit, which day", () => {
		render(
			<PublishComplianceDialog
				open
				onOpenChange={vi.fn()}
				summary={{
					totalFindings: 1,
					byType: { restTime: 0, maxHours: 0, overtime: 0, statutory: 1 },
				}}
				statutoryFindings={{
					...blocking,
					items: [{ ...blocking.items[0], finding: { ...nightWork, blocksPublication: false } }],
					outsideScopeCount: 0,
				}}
				dateRange={RANGE}
				onConfirm={vi.fn()}
				isConfirming={false}
			/>,
		);

		const list = screen.getByRole("list", { name: "Statutory findings to acknowledge" });
		const [item] = within(list).getAllByRole("listitem");
		expect(within(item).getByText("Anna Berg")).toBeTruthy();
		expect(
			within(item).getByText("Under 18: 60 min of night work between 20:00 and 06:00"),
		).toBeTruthy();
		expect(within(item).getByText("Mar 2, 2027")).toBeTruthy();
		expect(within(item).queryByText("Blocks publishing")).toBeNull();
	});

	it("closes when the planner follows a finding's shift link, which may be the page they are on", () => {
		const onOpenChange = vi.fn();
		render(
			<PublishComplianceDialog
				open
				onOpenChange={onOpenChange}
				summary={{
					totalFindings: 1,
					byType: { restTime: 0, maxHours: 0, overtime: 0, statutory: 1 },
				}}
				statutoryFindings={blocking}
				dateRange={RANGE}
				onConfirm={vi.fn()}
				isConfirming={false}
			/>,
		);

		fireEvent.click(screen.getByRole("link", { name: "Show Anna Berg's shifts" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

describe("PublishBlockedDialog", () => {
	it("lists the findings that block publishing, so the planner knows what to change", () => {
		render(
			<PublishBlockedDialog
				open
				onOpenChange={vi.fn()}
				statutoryFindings={blocking}
				dateRange={RANGE}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Publishing refused" })).toBeTruthy();
		const list = screen.getByRole("list", { name: "Findings that block publishing" });
		const [item] = within(list).getAllByRole("listitem");
		expect(within(item).getByText("Anna Berg")).toBeTruthy();
		expect(within(item).getByText("Blocks publishing")).toBeTruthy();
		expect(within(item).getByText("Mar 2, 2027")).toBeTruthy();
		expect(
			within(item).getByRole("link", { name: "Show Anna Berg's shifts" }).getAttribute("href"),
		).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-02`);
		expect(screen.getByText("1 more finding concerns an employee you don't manage.")).toBeTruthy();
	});

	it("closes when the planner follows a finding's shift link, which may be the page they are on", () => {
		const onOpenChange = vi.fn();
		render(
			<PublishBlockedDialog
				open
				onOpenChange={onOpenChange}
				statutoryFindings={blocking}
				dateRange={RANGE}
			/>,
		);

		fireEvent.click(screen.getByRole("link", { name: "Show Anna Berg's shifts" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

describe("useShiftPublishFlow refusal", () => {
	const renderFlow = () => {
		const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		return renderHook(() => useShiftPublishFlow({ organizationId: "org", dateRange: RANGE }), {
			wrapper,
		});
	};

	it("opens the blocking findings instead of a toast when the refusal lists them", async () => {
		publishShiftsMock.mockResolvedValue({
			success: false,
			code: "ValidationError",
			error: "Cannot publish: 1 shift finding(s) for 1 employee(s) break youth protection limits.",
			refusal: STATUTORY_PUBLICATION_BLOCKED,
			details: { statutoryFindings: blocking },
		});
		const { result } = renderFlow();

		act(() => result.current.publish());

		await waitFor(() => expect(result.current.blockedFindings).toEqual(blocking));
		expect(result.current.isBlockedDialogOpen).toBe(true);
		expect(toastError).not.toHaveBeenCalled();

		act(() => result.current.setIsBlockedDialogOpen(false));
		expect(result.current.isBlockedDialogOpen).toBe(false);
	});

	it("carries the findings the planner acknowledges into the publish dialog", async () => {
		publishShiftsMock.mockResolvedValue({
			success: true,
			data: {
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 1,
					byType: { restTime: 0, maxHours: 0, overtime: 0, statutory: 1 },
				},
				evaluationFingerprint: "fp-1",
				statutoryFindings: blocking,
			},
		});
		const { result } = renderFlow();

		act(() => result.current.publish());

		await waitFor(() => expect(result.current.isComplianceDialogOpen).toBe(true));
		expect(result.current.pendingAcknowledgment?.statutoryFindings).toEqual(blocking);
	});
});
