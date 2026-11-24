/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { STATUTORY_PUBLICATION_BLOCKED } from "@/lib/statutory/scheduling/publication-block";

const { publishShiftsMock, toastError } = vi.hoisted(() => ({
	publishShiftsMock: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (key: string) => `t:${key}` }),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({ publishShifts: publishShiftsMock }));

const { useShiftPublishFlow } = await import("./use-shift-publish-flow");

function renderPublishFlow() {
	const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useShiftPublishFlow({
				organizationId: "org",
				dateRange: { startDate: "2027-03-01", endDateExclusive: "2027-03-08" },
			}),
		{ wrapper },
	);
}

beforeEach(() => {
	toastError.mockReset();
	publishShiftsMock.mockReset();
});

it("shows the statutory publication block as translated text, not the server's English", async () => {
	publishShiftsMock.mockResolvedValue({
		success: false,
		code: "ValidationError",
		error: "Cannot publish: 1 shift finding(s) for 1 employee(s) break youth protection limits.",
		refusal: STATUTORY_PUBLICATION_BLOCKED,
	});
	const { result } = renderPublishFlow();

	act(() => result.current.publish());

	await waitFor(() => expect(toastError).toHaveBeenCalled());
	expect(toastError).toHaveBeenCalledWith("t:scheduling.scheduler.publish.failed", {
		description: "t:scheduling.scheduler.publish.statutoryBlocked",
	});
});

it("shows a toast, not an empty dialog, when the publish block lists nothing for this viewer", async () => {
	publishShiftsMock.mockResolvedValue({
		success: false,
		code: "ValidationError",
		error: "Cannot publish.",
		refusal: STATUTORY_PUBLICATION_BLOCKED,
		details: {
			statutoryFindings: { items: [], outsideScopeCount: 0, canOpenReviews: false },
		},
	});
	const { result } = renderPublishFlow();

	act(() => result.current.publish());

	await waitFor(() => expect(toastError).toHaveBeenCalled());
	expect(toastError).toHaveBeenCalledWith("t:scheduling.scheduler.publish.failed", {
		description: "t:scheduling.scheduler.publish.statutoryBlocked",
	});
	expect(result.current.isBlockedDialogOpen).toBe(false);
	expect(result.current.blockedFindings).toBeNull();
});

it("opens the blocked dialog when the only blocking findings concern employees outside scope", async () => {
	const statutoryFindings = { items: [], outsideScopeCount: 2, canOpenReviews: false };
	publishShiftsMock.mockResolvedValue({
		success: false,
		code: "ValidationError",
		error: "Cannot publish.",
		refusal: STATUTORY_PUBLICATION_BLOCKED,
		details: { statutoryFindings },
	});
	const { result } = renderPublishFlow();

	act(() => result.current.publish());

	await waitFor(() => expect(result.current.isBlockedDialogOpen).toBe(true));
	expect(result.current.blockedFindings).toEqual(statutoryFindings);
	expect(toastError).not.toHaveBeenCalled();
});
