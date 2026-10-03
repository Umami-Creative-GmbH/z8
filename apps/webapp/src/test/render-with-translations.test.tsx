/* @vitest-environment jsdom */

import { act, screen } from "@testing-library/react";
import { TolgeeProvider, useTranslate } from "@tolgee/react";
import { describe, expect, it, vi } from "vitest";
import { createTestTolgee, render } from "./render-with-translations";

function Greeting() {
	const { t } = useTranslate();
	return <span>{t("greeting", { name: "Ada" })}</span>;
}

describe("translation test context", () => {
	it("formats translations without starting a browser extension handshake", async () => {
		vi.useFakeTimers();
		const postMessage = vi.spyOn(window, "postMessage");
		const tolgee = createTestTolgee("en", { greeting: "Hello, {name}!" });
		let view: ReturnType<typeof render> | undefined;

		try {
			view = render(<Greeting />, {
				wrapper: ({ children }) => (
					<TolgeeProvider tolgee={tolgee}>{children}</TolgeeProvider>
				),
			});
			await act(async () => {
				await vi.runAllTimersAsync();
			});
			expect(screen.getByText("Hello, Ada!")).toBeTruthy();
			expect(postMessage).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			view?.unmount();
			tolgee.stop();
			vi.clearAllTimers();
			vi.useRealTimers();
			postMessage.mockRestore();
		}
	});
});
