/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

const german: Record<string, string> = {
	"scheduling:scheduling.scheduler.open": "Offene Schicht",
	"scheduling:scheduling.shiftDialog.draft": "Entwurf",
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

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts: async () => ({ success: true, data: [draftOpenShift] }),
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

		await waitFor(() => expect(result.current.events).toHaveLength(1));
		expect(result.current.events[0]?.title).toBe("[Entwurf] Offene Schicht");
	});
});
