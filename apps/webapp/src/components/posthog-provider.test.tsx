/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
	init: vi.fn(),
	opt_in_capturing: vi.fn(),
	opt_out_capturing: vi.fn(),
	reset: vi.fn(),
}));
const environment = vi.hoisted(() => ({
	NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
	NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
}));
vi.mock("@/env", () => ({ env: environment }));
vi.mock("posthog-js", () => ({ default: sdk }));

import { PostHogProvider } from "./posthog-provider";

let mounts = 0;
function WorkingApp() {
	const [clockedIn, setClockedIn] = useState(false);
	useEffect(() => {
		mounts += 1;
	}, []);
	return (
		<>
			<input aria-label="Work note" defaultValue="" />
			<button type="button" onClick={() => setClockedIn(!clockedIn)}>
				{clockedIn ? "Clock Out" : "Clock In"}
			</button>
			<a href="/en/time-tracking">Time Tracking</a>
		</>
	);
}

describe("consent-aware product analytics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mounts = 0;
		environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
	});
	afterEach(cleanup);
	it("preserves the current clock, draft and DOM when consent changes", async () => {
		const view = render(
			<PostHogProvider
				identityKey="user-1:org-1"
				disabled={false}
				helpImproveProduct={false}
			>
				<WorkingApp />
			</PostHogProvider>,
		);
		const input = screen.getByRole("textbox", { name: "Work note" });
		fireEvent.change(input, { target: { value: "Unsent task detail" } });
		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		await act(async () =>
			view.rerender(
				<PostHogProvider
					identityKey="user-1:org-1"
					disabled={false}
					helpImproveProduct
				>
					<WorkingApp />
				</PostHogProvider>,
			),
		);
		expect(screen.getByRole("textbox")).toBe(input);
		expect(screen.getByDisplayValue("Unsent task detail")).toBe(input);
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
		expect(mounts).toBe(1);
	});
});
