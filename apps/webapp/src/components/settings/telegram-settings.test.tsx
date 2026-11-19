/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkCodeMinutesRemaining, TelegramLinkCodeExpiry } from "./telegram-settings";

const mocks = vi.hoisted(() => ({
	t: vi.fn(
		(_key: string, defaultValue?: string, params?: Record<string, unknown>) =>
			params && "minutes" in params
				? `Expires in ${String(params.minutes)} min`
				: (defaultValue ?? _key),
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.t }),
}));

vi.mock("@/app/[locale]/(app)/settings/telegram/actions", () => ({}));

const start = Temporal.Instant.from("2026-11-19T10:00:00Z");

describe("linkCodeMinutesRemaining", () => {
	it("rounds the remaining time up to whole minutes", () => {
		expect(linkCodeMinutesRemaining("2026-11-19T10:10:00Z", start)).toBe(10);
		expect(linkCodeMinutesRemaining("2026-11-19T10:00:30Z", start)).toBe(1);
	});

	it("is zero once the code has expired", () => {
		expect(linkCodeMinutesRemaining("2026-11-19T10:00:00Z", start)).toBe(0);
		expect(linkCodeMinutesRemaining("2026-11-19T09:59:00Z", start)).toBe(0);
	});
});

describe("TelegramLinkCodeExpiry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(start.epochMilliseconds));
		mocks.t.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("counts down with a plural message and offers a new code once expired", () => {
		const onRegenerate = vi.fn();
		render(
			<TelegramLinkCodeExpiry
				expiresAt="2026-11-19T10:01:00Z"
				isRegenerating={false}
				onRegenerate={onRegenerate}
			>
				<p>CODE123</p>
			</TelegramLinkCodeExpiry>,
		);

		expect(screen.getByText("CODE123")).toBeTruthy();
		expect(screen.getByText("Expires in 1 min")).toBeTruthy();
		expect(mocks.t).toHaveBeenCalledWith(
			"settings.telegram.linking.expiresIn",
			"Expires in {minutes, plural, one {# minute} other {# minutes}}",
			{ minutes: 1 },
		);

		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(screen.getByText("Expires in 1 min")).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(screen.queryByText("CODE123")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe(
			"Expired — generate a new code",
		);

		fireEvent.click(screen.getByRole("button", { name: "Generate new code" }));
		expect(onRegenerate).toHaveBeenCalledTimes(1);
	});

	it("prevents duplicate regeneration while a new code is requested", () => {
		render(
			<TelegramLinkCodeExpiry
				expiresAt="2026-11-19T09:00:00Z"
				isRegenerating
				onRegenerate={vi.fn()}
			>
				<p>CODE123</p>
			</TelegramLinkCodeExpiry>,
		);

		expect(
			screen
				.getByRole("button", { name: "Generate new code" })
				.hasAttribute("disabled"),
		).toBe(true);
	});
});
