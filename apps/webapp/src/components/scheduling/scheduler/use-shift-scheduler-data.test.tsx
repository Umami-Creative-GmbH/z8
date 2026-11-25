/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";

const german: Record<string, string> = {
	"scheduling:scheduling.scheduler.open": "Offene Schicht",
	"scheduling:scheduling.shiftDialog.draft": "Entwurf",
	"scheduling:scheduling.scheduler.assigned": "Zugewiesen",
};

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (key: string, fallback: string) => german[key] ?? fallback }),
}));

const draftOpenShift: ShiftWithRelations = {
	id: "shift-a",
	organizationId: "org-a",
	employeeId: null,
	status: "draft",
	date: new Date("2026-11-15T23:00:00Z"),
	startTime: "09:00",
	endTime: "17:00",
	templateId: null,
	subareaId: "reception",
	recurrenceId: null,
	publishedAt: null,
	publishedBy: null,
	notes: null,
	color: null,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
	createdBy: "planner",
	subarea: { id: "reception", name: "Reception", location: { id: "office", name: "Office" } },
};

/** Assigned to an employee whose name the planner cannot see. */
const unnamedAssignedShift: ShiftWithRelations = {
	...draftOpenShift,
	id: "shift-b",
	employeeId: "employee-b",
	status: "published",
	employee: null,
};

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts: async () => ({ success: true, data: [draftOpenShift, unnamedAssignedShift] }),
	getShiftTemplates: async () => ({ success: true, data: [] }),
	getScheduleComplianceSummary: async () => ({
		success: true,
		data: { summary: { totalFindings: 0 } },
	}),
	upsertShift: vi.fn(),
}));

const { useShiftSchedulerData } = await import("./use-shift-scheduler-data");

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useShiftSchedulerData calendar events (#2018)", () => {
	it("names open shifts and drafts in the planner's language", async () => {
		const { result } = renderHook(
			() =>
				useShiftSchedulerData({
					organizationId: "org-a",
					employeeId: "planner-a",
					organizationTimezone: "Europe/Berlin",
					dateRange: { startDate: "2026-11-16", endDateExclusive: "2026-11-23" },
					isManager: true,
				}),
			{ wrapper },
		);

		await waitFor(() => expect(result.current.events).toHaveLength(2));
		const titles = new Map(result.current.events.map((event) => [event.id, event.title]));
		expect(titles.get("shift-a")).toBe("[Entwurf] Offene Schicht");
		expect(titles.get("shift-b")).toBe("Zugewiesen");
	});
});

describe("useShiftSchedulerData statutory findings (#2026)", () => {
	it("keeps each viewer's findings to that viewer: a scoped manager never reads another planner's cached list", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const shared = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		const dateRange = { startDate: "2026-11-16", endDateExclusive: "2026-11-23" };
		const viewerKeys = () =>
			client
				.getQueryCache()
				.findAll({ queryKey: queryKeys.compliance.scheduleWarnings("org-a", dateRange) })
				.map((query) => query.queryKey);

		for (const employeeId of ["admin-a", "manager-a"]) {
			const { result } = renderHook(
				() =>
					useShiftSchedulerData({
						organizationId: "org-a",
						employeeId,
						organizationTimezone: "Europe/Berlin",
						dateRange,
						isManager: true,
					}),
				{ wrapper: shared },
			);
			await waitFor(() => expect(result.current.complianceSummary).toBeDefined());
		}

		expect(viewerKeys()).toHaveLength(2);
		expect(viewerKeys()).toEqual(
			expect.arrayContaining([
				[
					...queryKeys.compliance.scheduleWarnings("org-a", dateRange),
					"scheduling-viewer",
					"admin-a",
				],
				[
					...queryKeys.compliance.scheduleWarnings("org-a", dateRange),
					"scheduling-viewer",
					"manager-a",
				],
			]),
		);
	});
});
