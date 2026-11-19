/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({ readConversion: vi.fn(), convert: vi.fn(), push: vi.fn() }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ isPending: false, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
  authClient: { $store: { atoms: { session: {
    get: () => ({ isPending: false, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
    subscribe: () => () => {},
  } } } },
}));
vi.mock("@/navigation", () => ({
  useRouter: () => ({ push: external.push, refresh: vi.fn(), replace: vi.fn() }),
  Link: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
  getLegacyTravelExpenseConversion: external.readConversion,
  convertLegacyTravelExpenseDraftAction: external.convert,
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { TravelExpenseClaimDetail as BaselineDetail } from "@/components/travel-expenses/review1748-independent-baseline-detail";

const claimId = "4053401f-806e-4839-ae66-96b9fa36c054";
const employee = { employeeId: "synthetic-employee", organizationId: "synthetic-org", role: "employee" as const };
const detail = {
  claim: {
    id: claimId, organizationId: "synthetic-org", employeeId: employee.employeeId,
    type: "receipt", status: "draft", tripStartDate: null, tripEndDate: null, tripDateTimeZone: null,
    originalAmount: "12.50", originalCurrency: "EUR", calculatedAmount: "12.50", calculatedCurrency: "EUR",
    destinationCity: null, destinationCountry: null, notes: "Synthetic original draft evidence",
    createdAt: "2026-04-01T10:00:00Z", submittedAt: null, decidedAt: null,
  },
  attachments: [{ id: "synthetic-receipt", fileName: "synthetic-receipt.pdf", checksumSha256: null }],
  decisions: [], intermediateDecisions: [],
};
const clients: QueryClient[] = [];
const available = { success: true, data: { reportId: "synthetic-converted-report" } };
const outage = { success: false, error: "Synthetic temporary service outage" };
const unavailableText = "Draft continuation is not available for the current reader.";
const outageText = "Unable to check this draft. Please retry.";
const reportLink = () => screen.queryByRole("link", { name: "Open the report" });

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function mount(baseline = false) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/context") return Response.json({
      user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" }, employee, organizationSettings: null,
    });
    expect(url).toBe(`/api/travel-expenses/${claimId}`);
    return Response.json(detail);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const Component = baseline ? BaselineDetail : TravelExpenseClaimDetail;
  render(<QueryClientProvider client={client}>
    <OrganizationContextProvider initialContext={{ userId: "synthetic-reader", organizationId: "synthetic-org", employee, organizationSettings: null, updatedAt: Date.now() }}>
      <Component userId="synthetic-reader" organizationId="synthetic-org" employeeId={employee.employeeId} claimId={claimId} />
    </OrganizationContextProvider>
  </QueryClientProvider>);
  return client;
}
async function refresh(client: QueryClient) {
  await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
}
function claimEvidenceRemains() {
  expect(screen.getByText(detail.claim.notes)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Download synthetic-receipt.pdf" })).toBeTruthy();
}

it("independent positive control: available conversion link survives a transient failure and Retry recovers", async () => {
  external.readConversion.mockResolvedValueOnce(available).mockResolvedValueOnce(outage).mockResolvedValueOnce(available);
  const client = mount();
  await screen.findByRole("link", { name: "Open the report" });
  await refresh(client);
  await screen.findByText(outageText);
  expect(reportLink()?.getAttribute("href")).toBe("/travel-expenses/reports/synthetic-converted-report");
  claimEvidenceRemains();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(screen.queryByText(outageText)).toBeNull());
  expect(reportLink()).toBeTruthy();
  expect(external.readConversion).toHaveBeenCalledTimes(3);
});

it.each(["Unauthorized", "Travel expense claim not found"])("independent initial conversion refusal control: %s", async (error) => {
  external.readConversion.mockResolvedValueOnce({ success: false, error });
  mount();
  await screen.findByText(unavailableText);
  expect(reportLink()).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
  claimEvidenceRemains();
});

it.each(["Unauthorized", "Travel expense claim not found"])("pinned 85d6 baseline conversion control hides cached report link after refusal and transient failure: %s", async (error) => {
  external.readConversion.mockResolvedValueOnce(available).mockResolvedValueOnce({ success: false, error }).mockResolvedValueOnce(outage);
  const client = mount(true);
  await screen.findByRole("link", { name: "Open the report" });
  await refresh(client);
  await screen.findByText(outageText);
  expect(reportLink()).toBeNull();
  await refresh(client);
  await vi.waitFor(() => expect(external.readConversion).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  expect(reportLink()).toBeNull();
  claimEvidenceRemains();
});

it("independent critical objection: conversion-owner withdrawal remains hidden after a later transient failure without fresh success", async () => {
  external.readConversion.mockResolvedValueOnce(available)
    .mockResolvedValueOnce({ success: false, error: "Unauthorized" })
    .mockResolvedValueOnce(outage);
  const client = mount();
  await screen.findByRole("link", { name: "Open the report" });
  await refresh(client);
  await screen.findByText(unavailableText);
  expect(reportLink()).toBeNull();
  claimEvidenceRemains();
  await refresh(client);
  await screen.findByText(outageText);
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  expect(external.readConversion).toHaveBeenCalledTimes(3);
  expect(external.convert).not.toHaveBeenCalled();
  expect(external.push).not.toHaveBeenCalled();
  claimEvidenceRemains();
  expect({ reportLinkVisible: Boolean(reportLink()) }).toEqual({ reportLinkVisible: false });
});
