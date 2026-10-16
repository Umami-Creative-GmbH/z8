// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ report: vi.fn(), refresh: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: remote.refresh }),
}));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	reportDrivingImpedimentAction: remote.report,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportDrivingImpediment } from "./report-impediment";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("reports inability without a private reason and announces immediate suspension", async () => {
	remote.report.mockResolvedValue({
		success: true,
		data: { reportId: "report" },
	});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ReportDrivingImpediment />
		</QueryClientProvider>,
	);
	expect(screen.queryByRole("textbox")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Report that I cannot drive" }),
	);
	await waitFor(() => expect(remote.report).toHaveBeenCalledTimes(1));
	expect(remote.report.mock.calls[0][0]).toEqual({
		commandId: expect.any(String),
	});
	expect((await screen.findByRole("status")).textContent).toContain(
		"All your class authorizations are suspended",
	);
	expect(remote.refresh).toHaveBeenCalledTimes(1);
});
