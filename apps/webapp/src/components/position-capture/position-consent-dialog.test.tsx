// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PositionConsentDialogHost } from "./position-consent-dialog";
import { askForPositionConsent } from "./position-consent-prompt";

const { agreeMock, declineMock } = vi.hoisted(() => ({
	agreeMock: vi.fn(),
	declineMock: vi.fn(),
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
	declinePositionNoticeAction: declineMock,
}));

const question = {
	notice: {
		id: "d8260000-0000-4000-8000-0000000000f1",
		version: 3,
		purposeStatement: "Proof of on-site work for customers",
	},
	retentionDays: 45,
};

describe("PositionConsentDialogHost", () => {
	beforeEach(() => {
		agreeMock.mockReset().mockResolvedValue({ success: true, data: { grantedAt: "x" } });
		declineMock.mockReset().mockResolvedValue({ success: true, data: { declined: true } });
	});

	it("shows the current notice on a clock action and records Agree for that version", async () => {
		render(<PositionConsentDialogHost />);
		let answered: Promise<string> = Promise.resolve("none");
		act(() => {
			answered = askForPositionConsent(question);
		});

		expect(await screen.findByText("Proof of on-site work for customers")).toBeTruthy();
		expect(screen.getByText(/deleted 45 days after it was recorded/)).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Agree" }));

		await expect(answered).resolves.toBe("agreed");
		expect(agreeMock).toHaveBeenCalledWith({ noticeId: question.notice.id });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("records Not now, and lets the clock action go ahead", async () => {
		render(<PositionConsentDialogHost />);
		let answered: Promise<string> = Promise.resolve("none");
		act(() => {
			answered = askForPositionConsent(question);
		});

		await userEvent.click(await screen.findByRole("button", { name: "Not now" }));

		await expect(answered).resolves.toBe("declined");
		expect(declineMock).toHaveBeenCalledWith({ noticeId: question.notice.id });
	});

	it("never blocks the clock action when saving the answer fails", async () => {
		agreeMock.mockResolvedValue({ success: false, error: "The position notice has changed." });
		render(<PositionConsentDialogHost />);
		let answered: Promise<string> = Promise.resolve("none");
		act(() => {
			answered = askForPositionConsent(question);
		});

		await userEvent.click(await screen.findByRole("button", { name: "Agree" }));

		await expect(answered).resolves.toBe("dismissed");
	});

	it("answers at once when no dialog host is mounted", async () => {
		await expect(askForPositionConsent(question)).resolves.toBe("dismissed");
	});
});
