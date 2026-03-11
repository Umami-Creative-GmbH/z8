/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportHub } from "@/components/settings/import/import-hub";

vi.mock("@/components/settings/clockodo-import/clockodo-import-wizard", () => ({
	ClockodoImportWizard: ({ organizationId }: { organizationId: string }) => (
		<div>Clockodo wizard {organizationId}</div>
	),
}));

vi.mock("@/components/settings/clockin-import/clockin-import-wizard", () => ({
	ClockinImportWizard: ({ organizationId }: { organizationId: string }) => (
		<div>Clockin wizard {organizationId}</div>
	),
}));

describe("ImportHub", () => {
	it("renders Clockodo and Clockin tabs", () => {
		render(<ImportHub organizationId="org_123" />);

		expect(screen.getByRole("tab", { name: /clockodo/i })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /clockin/i })).toBeTruthy();
		expect(screen.getByText(/clockodo wizard org_123/i)).toBeTruthy();
	});
});
