/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportHub } from "@/components/settings/import/import-hub";
import { render } from "@/test/render-with-translations";

vi.mock("@/components/settings/clockodo-import/clockodo-import-wizard", () => ({
	ClockodoImportWizard: () => <div>Clockodo wizard</div>,
}));

vi.mock("@/components/settings/clockin-import/clockin-import-wizard", () => ({
	ClockinImportWizard: () => <div>Clockin wizard</div>,
}));

vi.mock("@/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/[locale]/(app)/settings/import/csv-actions", () => ({
	uploadCsvWorkAction: vi.fn(),
}));

describe("ImportHub", () => {
	it("renders Clockodo, Clockin and CSV work tabs", () => {
		render(<ImportHub />);

		expect(screen.getByRole("tab", { name: /clockodo/i })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /clockin/i })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /csv work/i })).toBeTruthy();
		expect(screen.getByText(/clockodo wizard/i)).toBeTruthy();
	});
});
