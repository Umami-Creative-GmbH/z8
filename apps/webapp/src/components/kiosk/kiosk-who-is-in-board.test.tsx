/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KioskBoardResponse } from "@/lib/kiosk/protocol";
import { KIOSK_BOARD_REFRESH_MS, KioskWhoIsInBoard } from "./kiosk-who-is-in-board";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

function stubBoard(responses: Array<() => Response>) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const next = responses.length > 1 ? responses.shift() : responses[0];
			return next ? next() : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

const board = (body: KioskBoardResponse) => () => Response.json(body);

async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

describe("KioskWhoIsInBoard", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("lists who is in and who is on break, read with the kiosk token", async () => {
		vi.useFakeTimers();
		const calls = stubBoard([
			board({
				enabled: true,
				entries: [
					{ name: "Anna B.", state: "in" },
					{ name: "Ben Ö.", state: "on_break" },
				],
			}),
		]);
		render(<KioskWhoIsInBoard token="z8k_token" onRevoked={vi.fn()} onUnpaired={vi.fn()} />);
		await flush();

		expect(screen.getByRole("heading", { name: "Who is in" })).toBeTruthy();
		expect(screen.getByText("Anna B.")).toBeTruthy();
		expect(screen.getByText("Clocked in")).toBeTruthy();
		expect(screen.getByText("Ben Ö.")).toBeTruthy();
		expect(screen.getByText("On break")).toBeTruthy();
		expect(calls[0]?.url).toBe("/api/kiosk/board");
		expect(new Headers(calls[0]?.init?.headers).get("x-kiosk-token")).toBe("z8k_token");
	});

	it("refreshes at least every minute", async () => {
		vi.useFakeTimers();
		const calls = stubBoard([
			board({ enabled: true, entries: [{ name: "Anna B.", state: "in" }] }),
			board({ enabled: true, entries: [{ name: "Anna B.", state: "on_break" }] }),
		]);
		render(<KioskWhoIsInBoard token="z8k_token" onRevoked={vi.fn()} onUnpaired={vi.fn()} />);
		await flush();
		expect(screen.getByText("Clocked in")).toBeTruthy();

		expect(KIOSK_BOARD_REFRESH_MS).toBeLessThanOrEqual(60_000);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(KIOSK_BOARD_REFRESH_MS);
		});

		expect(calls).toHaveLength(2);
		expect(screen.getByText("On break")).toBeTruthy();
		expect(screen.queryByText("Clocked in")).toBeNull();
	});

	it("says so when nobody is in", async () => {
		vi.useFakeTimers();
		stubBoard([board({ enabled: true, entries: [] })]);
		render(<KioskWhoIsInBoard token="z8k_token" onRevoked={vi.fn()} onUnpaired={vi.fn()} />);
		await flush();

		expect(screen.getByText("Nobody is clocked in right now.")).toBeTruthy();
	});

	it("shows nothing while the board is switched off or the server cannot be reached", async () => {
		vi.useFakeTimers();
		stubBoard([
			board({ enabled: true, entries: [{ name: "Anna B.", state: "in" }] }),
			() => {
				throw new TypeError("offline");
			},
			board({ enabled: false, entries: [] }),
		]);
		const { container } = render(
			<KioskWhoIsInBoard token="z8k_token" onRevoked={vi.fn()} onUnpaired={vi.fn()} />,
		);
		await flush();
		expect(screen.getByText("Anna B.")).toBeTruthy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(KIOSK_BOARD_REFRESH_MS);
		});
		expect(screen.queryByText("Anna B.")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(KIOSK_BOARD_REFRESH_MS);
		});
		expect(container.innerHTML).toBe("");
	});

	it("hands a refused kiosk token to the kiosk page", async () => {
		vi.useFakeTimers();
		stubBoard([() => Response.json({ code: "kiosk_revoked" }, { status: 401 })]);
		const onRevoked = vi.fn();
		render(<KioskWhoIsInBoard token="z8k_token" onRevoked={onRevoked} onUnpaired={vi.fn()} />);
		await flush();

		expect(onRevoked).toHaveBeenCalledOnce();
	});
});
