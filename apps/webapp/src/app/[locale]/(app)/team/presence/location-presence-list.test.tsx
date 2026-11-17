// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocationPresenceList } from "./location-presence-list";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
	useRouter: () => ({ refresh }),
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	refresh.mockReset();
});

it("lets readers open an employee from their current presence record without losing state or since", () => {
	render(
		<LocationPresenceList
			rows={[
				{ employeeId: "anna", name: "Anna Berger", state: "clocked_in", sinceText: "08:30" },
				{ employeeId: "ben", name: "Ben West", state: "on_break", sinceText: "11:45" },
			]}
		/>,
	);
	const anna = screen.getByRole("link", { name: "Anna Berger" });
	expect(anna.getAttribute("href")).toBe("/settings/employees/anna");
	const row = anna.closest("tr");
	expect(row).not.toBeNull();
	if (!row) throw new Error("Missing employee record");
	expect(within(row).getByText("Clocked in")).toBeTruthy();
	expect(within(row).getByText("08:30")).toBeTruthy();
	expect(screen.getByText("On break")).toBeTruthy();
	expect(screen.getByText("11:45")).toBeTruthy();
});

it("refreshes live presence every minute, removes ended work on the next read, and stops on departure", () => {
	vi.useFakeTimers();
	const view = render(
		<LocationPresenceList
			rows={[{ employeeId: "anna", name: "Anna Berger", state: "clocked_in", sinceText: "08:30" }]}
		/>,
	);
	act(() => vi.advanceTimersByTime(60_000));
	expect(refresh).toHaveBeenCalledTimes(1);
	view.rerender(<LocationPresenceList rows={[]} />);
	expect(screen.queryByRole("link", { name: "Anna Berger" })).toBeNull();
	expect(
		screen.getByText("Nobody you can see is clocked in at this location right now."),
	).toBeTruthy();
	view.unmount();
	act(() => vi.advanceTimersByTime(60_000));
	expect(refresh).toHaveBeenCalledTimes(1);
});
