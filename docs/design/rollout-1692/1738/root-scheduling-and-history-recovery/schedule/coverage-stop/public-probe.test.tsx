/** @vitest-environment jsdom */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TolgeeProvider } from "@tolgee/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act as preactAct } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ShiftScheduler as CurrentShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { ShiftScheduler as PremergeShiftScheduler } from "@/components/scheduling/scheduler/merge1738-premerge-control";
import { createTestTolgee } from "@/test/render-with-translations";

// Explicit action transport and authenticated caller-context boundary. No internal hook,
// query state, component or scheduler/calendar implementation is replaced or preloaded.
const transport = vi.hoisted(() => ({
  coverage: vi.fn(), shifts: vi.fn(), templates: vi.fn(), compliance: vi.fn(),
  publish: vi.fn(), upsert: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
  getShifts: transport.shifts,
  getShiftTemplates: transport.templates,
  getScheduleComplianceSummary: transport.compliance,
  getPendingShiftRequests: async () => ({ success: true, data: [] }),
  getLocationsWithSubareas: async () => ({ success: true, data: [] }),
  suggestStaffingForShift: async () => ({ success: true, data: [] }),
  publishShifts: transport.publish, upsertShift: transport.upsert, deleteShift: transport.remove,
  approveShiftRequest: vi.fn(), rejectShiftRequest: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/coverage-rules/actions", () => ({
  getTargetHeatmapData: transport.coverage,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
  listEmployeesForSelect: async () => ({ success: true, data: { employees: [] } }),
}));
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({ validateEmployeeForShift: vi.fn() }));

const clients: QueryClient[] = [];
const ShiftScheduler = process.env.MERGE1738_CONSUMER === "before" ? PremergeShiftScheduler : CurrentShiftScheduler;
const draft = {
  id: "synthetic-shift-a", organizationId: "synthetic-org-a", employeeId: null,
  status: "draft", date: new Date("2026-11-15T23:00:00Z"), startTime: "09:00", endTime: "17:00",
  templateId: null, subareaId: "synthetic-reception", recurrenceId: null,
  publishedAt: null, publishedBy: null, notes: null, color: null,
  createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"),
  createdBy: "synthetic-planner", subarea: { id: "synthetic-reception", name: "Reception",
    location: { id: "synthetic-office", name: "Office" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  transport.shifts.mockResolvedValue({ success: true, data: [draft] });
  transport.templates.mockResolvedValue({ success: true, data: [] });
  transport.compliance.mockResolvedValue({ success: true, data: { summary: { totalFindings: 0 } } });
});

afterEach(async () => {
  preactAct(() => cleanup());
  for (const client of clients.splice(0)) client.clear();
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.unstubAllGlobals();
});

async function observe(label: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <TolgeeProvider tolgee={createTestTolgee()}>
      <ThemeProvider defaultTheme="light" enableSystem={false}>
        <UserPreferencesProvider timezone="Europe/Berlin" weekStartDay="monday">
          <QueryClientProvider client={client}>
            <ShiftScheduler organizationId="synthetic-org-a" organizationTimezone="Europe/Berlin"
              employeeId="synthetic-planner-a" isManager focusEmployeeId={null} focusDate="2026-11-16" />
          </QueryClientProvider>
        </UserPreferencesProvider>
      </ThemeProvider>
    </TolgeeProvider>,
  );
  await screen.findByRole("button", { name: "Publish (1)" });
  await waitFor(() => expect(transport.coverage).toHaveBeenCalled());
  // The historical calendar publishes its first range asynchronously. Let that real
  // range callback settle before inspecting the current control, rather than a retired DOM node.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const publish = await screen.findByRole("button", { name: "Publish (1)" }) as HTMLButtonElement;
  const user = userEvent.setup();
  await user.hover(publish);
  const tooltipText = await screen.findByText(/Publish 1 draft shift and notify employees|Warnings detected before publish/);
  const tooltip = tooltipText.closest('[data-slot="tooltip-content"]') ?? tooltipText;
  const alerts = screen.queryAllByRole("alert").map((element) => element.textContent);
  const coverageErrors = alerts.filter((text) => /coverage|staffing/i.test(text ?? ""));
  const receipt = {
    label, consumer: process.env.MERGE1738_CONSUMER ?? "current", coverageCalls: transport.coverage.mock.calls.length,
    coverageOutcome: await transport.coverage.mock.results[0].value,
    publishEnabled: !publish.disabled, tooltip: tooltip.textContent,
    alerts, coverageErrorCount: coverageErrors.length,
    retryButtons: screen.queryAllByRole("button", { name: /retry/i }).length,
    visibleBodyText: document.body.textContent,
    writes: { publish: transport.publish.mock.calls.length, upsert: transport.upsert.mock.calls.length,
      remove: transport.remove.mock.calls.length },
    boundary: "real ShiftScheduler/QueryClient/provider/hooks/overlay/PublishFab; mocked action transport and admitted caller props; jsdom, no browser or server-authorization claim",
  };
  const run = process.env.MERGE1738_ATTEMPT;
  if (!run) throw Error("Unique attempt label required");
  writeFileSync(path.resolve("../../.tmp/merge1738-audit", `${run}-${label}.json`), JSON.stringify(receipt, null, 2));
  return { receipt, coverageErrors };
}

it("healthy successful empty coverage offers the ordinary publish description", async () => {
  transport.coverage.mockResolvedValue({ success: true, data: [] });
  const { receipt } = await observe("healthy-empty");
  expect(receipt.coverageCalls).toBeGreaterThanOrEqual(1);
  expect(receipt.publishEnabled).toBe(true);
  expect(receipt.tooltip).toContain("Publish 1 draft shift and notify employees");
  expect(receipt.coverageErrorCount).toBe(0);
});

it("healthy understaffed coverage exposes the actual coverage warning", async () => {
  transport.coverage.mockResolvedValue({ success: true, data: [{
    date: new Date("2026-11-16T00:00:00Z"), subareaId: "synthetic-reception", subareaName: "Reception",
    locationName: "Office", status: "under", gapCount: 1, utilizationPercent: 0,
    totalRequired: 1, totalActual: 0, totalShortfall: 1,
  }] });
  const { receipt } = await observe("healthy-gap");
  expect(receipt.tooltip).toContain("Warnings detected before publish");
  expect(receipt.tooltip).toContain("minimum staffing requirements");
  expect(receipt.visibleBodyText).toContain("1 understaffed");
});

it("failed coverage stays visibly unavailable and offers local read Retry", async () => {
  transport.coverage.mockResolvedValue({ success: false, error: "Synthetic coverage transport unavailable" });
  const { receipt, coverageErrors } = await observe("coverage-failure");
  expect(receipt.coverageCalls).toBeGreaterThanOrEqual(1);
  expect(receipt.writes).toEqual({ publish: 0, upsert: 0, remove: 0 });
  expect(coverageErrors.length, "failed coverage must remain visibly unknown instead of sharing healthy-empty publish feedback").toBeGreaterThan(0);
  expect(receipt.retryButtons, "failed coverage needs local read Retry").toBeGreaterThan(0);
});
