// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ upload: vi.fn(), push: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: remote.push, refresh: vi.fn() }),
}));
vi.mock("@/app/[locale]/(app)/settings/import/csv-actions", () => ({
	uploadCsvWorkAction: remote.upload,
}));
const { CsvWorkUpload } = await import("./csv-work-upload");
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("uploads the selected file and explicit timezone, then opens its durable preview", async () => {
	remote.upload.mockResolvedValue({
		success: true,
		data: { batchId: "batch-1133" },
	});
	render(<CsvWorkUpload organizationId="org-1133" />);
	const user = userEvent.setup();
	const csv =
		"personnel_number,starts_at,ends_at\n0042,2026-07-22T08:00,2026-07-22T09:00\n";
	const file = new File([csv], "work.csv", { type: "text/csv" });
	Object.defineProperty(file, "text", { value: async () => csv });
	await user.upload(screen.getByLabelText("CSV file"), file);
	await user.type(
		screen.getByLabelText("Timezone for local timestamps"),
		"Europe/Berlin",
	);
	await user.click(screen.getByRole("button", { name: "Preview CSV" }));
	await waitFor(() =>
		expect(remote.push).toHaveBeenCalledWith("/settings/import/batch-1133"),
	);
	expect(remote.upload).toHaveBeenCalledWith({
		organizationId: "org-1133",
		csv,
		fileName: "work.csv",
		timezone: "Europe/Berlin",
	});
	expect(
		screen
			.getByRole("link", { name: "Download CSV template" })
			.getAttribute("download"),
	).toBe("z8-completed-work-template.csv");
});
