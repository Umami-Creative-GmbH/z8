/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineRecoveryDialog } from "./offline-recovery-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params: Record<string, string> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? ""),
	}),
}));

describe("OfflineRecoveryDialog", () => {
	it("still shows a frozen command held because the organization is not adopted (#845)", async () => {
		const held = {
			id: "local-1",
			format: "z8-clock-command-record-v1",
			operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
			state: "pending",
			hold: { reason: "not_adopted" },
		};
		const loadRecords = vi.fn(async () => [held]);
		const archiveRecord = vi.fn(async () => []);
		render(<OfflineRecoveryDialog loadRecords={loadRecords} archiveRecord={archiveRecord} />);

		fireEvent.click(screen.getByRole("button", { name: "Review saved records" }));

		expect(
			await screen.findByText("Paused — the server does not accept this clock action yet"),
		).toBeTruthy();
		// Still owed an outcome, so it can be archived with its evidence kept.
		expect(screen.getByRole("button", { name: "Archive and retain evidence" })).toBeTruthy();
	});
});
