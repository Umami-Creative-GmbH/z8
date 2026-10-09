// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnPositionCaptureData } from "@/app/[locale]/(app)/settings/position-stamps/actions";
import { OwnPositionStampsPanel } from "./own-position-stamps-panel";

const { agreeMock, withdrawMock, refreshMock } = vi.hoisted(() => ({
	agreeMock: vi.fn(),
	withdrawMock: vi.fn(),
	refreshMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback.replace(
				/\{(\w+), plural, one \{# (\w+)\} other \{# (\w+)\}\}/g,
				(_match, name: string, one: string, other: string) =>
					`${params?.[name]} ${params?.[name] === 1 ? one : other}`,
			);
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/position-stamps/actions", () => ({
	agreeToPositionNoticeAction: agreeMock,
	withdrawPositionConsentAction: withdrawMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const notice = {
	id: "d8250000-0000-4000-8000-0000000000f1",
	version: 2,
	purposeStatement: "Proof of on-site work for customers",
	retentionDays: 90,
	templateRevision: 1,
	createdAt: "2026-10-01T08:00:00Z",
};

function data(overrides: Partial<OwnPositionCaptureData>): OwnPositionCaptureData {
	return {
		captureOn: true,
		retentionDays: 60,
		notice,
		consent: { kind: "undecided" },
		canWithdraw: false,
		asksForConsent: true,
		...overrides,
	};
}

describe("OwnPositionStampsPanel", () => {
	beforeEach(() => {
		agreeMock.mockReset().mockResolvedValue({ success: true, data: { grantedAt: "x" } });
		withdrawMock.mockReset().mockResolvedValue({ success: true, data: { withdrawn: 1 } });
		refreshMock.mockReset();
	});

	it("shows that capture is on, the current notice and lets the employee agree to that version", async () => {
		render(<OwnPositionStampsPanel data={data({})} />);

		expect(screen.getByText("Position capture is switched on for you.")).toBeTruthy();
		expect(screen.getByText("You have not decided yet.")).toBeTruthy();
		expect(screen.getByText("Proof of on-site work for customers")).toBeTruthy();
		expect(screen.getByText(/deleted 60 days after it was recorded/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Withdraw consent" })).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "Agree" }));

		expect(agreeMock).toHaveBeenCalledWith({ noticeId: notice.id });
		await waitFor(() => expect(refreshMock).toHaveBeenCalled());
	});

	it("asks for confirmation, saying positions are deleted, before withdrawing", async () => {
		render(
			<OwnPositionStampsPanel
				data={data({
					consent: { kind: "active", noticeVersion: 2, grantedAt: "2026-10-02T08:00:00Z" },
					canWithdraw: true,
					asksForConsent: false,
				})}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Agree" })).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "Withdraw consent" }));
		expect(
			screen.getByText(/immediately deletes all positions recorded with your clock events/),
		).toBeTruthy();
		expect(withdrawMock).not.toHaveBeenCalled();

		await userEvent.click(screen.getByRole("button", { name: "Withdraw and delete positions" }));

		expect(withdrawMock).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(refreshMock).toHaveBeenCalled());
	});

	it("explains a lapsed consent and offers both agreeing to the new version and withdrawing", () => {
		render(
			<OwnPositionStampsPanel
				data={data({
					consent: { kind: "lapsed", noticeVersion: 1, grantedAt: "2026-09-01T08:00:00Z" },
					canWithdraw: true,
				})}
			/>,
		);

		expect(
			screen.getByText(
				"You agreed to version 1. The notice has changed, so no positions are recorded until you agree to version 2.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Agree" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Withdraw consent" })).toBeTruthy();
	});

	it("tells employees capture is off for them and shows no notice when none exists", () => {
		render(
			<OwnPositionStampsPanel
				data={data({ captureOn: false, notice: null, asksForConsent: false })}
			/>,
		);

		expect(screen.getByText("Position capture is not switched on for you.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Agree" })).toBeNull();
	});
});
