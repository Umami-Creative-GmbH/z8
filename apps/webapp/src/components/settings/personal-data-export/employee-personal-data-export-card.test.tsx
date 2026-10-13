/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeePersonalDataExportCard } from "./employee-personal-data-export-card";

const actions = vi.hoisted(() => ({
	list: vi.fn(),
	request: vi.fn(),
	download: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en", timezone: "UTC", timeFormat: "24h" }),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/personal-data-export.actions", () => ({
	getEmployeePersonalDataExportsAction: actions.list,
	requestEmployeePersonalDataExportAction: actions.request,
}));
vi.mock("@/app/[locale]/(app)/settings/my-data/actions", () => ({
	getPersonalDataExportDownloadUrl: actions.download,
}));

const completed = {
	id: "export-1",
	kind: "admin",
	status: "completed",
	createdAt: "2026-10-01T08:00:00Z",
	completedAt: "2026-10-01T08:05:00Z",
	expiresAt: "2026-10-08T08:05:00Z",
	sizeBytes: 2048,
};

function renderCard(isOwnRecord: boolean) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<EmployeePersonalDataExportCard
				organizationId="org-1"
				employeeId="employee-1"
				isOwnRecord={isOwnRecord}
			/>
		</QueryClientProvider>,
	);
}

describe("EmployeePersonalDataExportCard (#811)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.list.mockResolvedValue({ success: true, data: [completed] });
	});

	it("lists past admin exports of a colleague with a download button", async () => {
		renderCard(false);
		expect(await screen.findByRole("button", { name: "Download" })).toBeTruthy();
		expect(actions.list).toHaveBeenCalledWith("employee-1");
	});

	it("never loads or offers the admin exports of the admin's own record", async () => {
		renderCard(true);
		expect(
			await screen.findByText(
				"You can't export your own data here. Use My data in your account settings.",
			),
		).toBeTruthy();
		expect(actions.list).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
		expect(screen.queryByRole("list", { name: "Past admin exports" })).toBeNull();
	});
});
