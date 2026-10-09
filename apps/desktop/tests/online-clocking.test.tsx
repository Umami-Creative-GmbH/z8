import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useClock } from "../src/hooks/useClock";
import type { ClockJournal } from "../src/types";
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(() => new Promise(() => {})),
}));
afterEach(cleanup);
const journal: ClockJournal = {
	busy: false,
	onBreak: false,
	signInRequired: false,
	legacy: {
		total: 0,
		malformed: 0,
		exhausted: 0,
		possiblePartialBreaks: 0,
		breaksWithAcknowledgedClose: 0,
	},
	serverReachable: true,
	commandsEnabled: false,
	onlineClockingEnabled: true,
	breaksEnabled: false,
	commands: [],
	otherContexts: 0,
	projection: null,
};
function View() {
	const clock = useClock({
		enabled: true,
		sessionVersion: 3,
		sessionRevision: 1,
		serverUrl: "https://z8.test",
		organizationId: "org",
	});
	return (
		<p>
			{clock.canClock ? "Clock ready" : "Clock paused"} /{" "}
			{clock.canRecordBreak ? "Idle available" : "Idle unavailable"}
		</p>
	);
}
function show(value: ClockJournal) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Infinity, gcTime: 0 },
		},
	});
	const scope = JSON.stringify([3, "https://z8.test", "org"]);
	client.setQueryData(["clock-status", scope], {
		hasEmployee: true,
		employeeId: "employee",
		isClockedIn: false,
		activeWorkPeriod: null,
	});
	client.setQueryData(["clock-journal", scope], value);
	render(
		<QueryClientProvider client={client}>
			<View />
		</QueryClientProvider>,
	);
}
it("allows online clocking and manual breaks without the offline rollout", () => {
	show(journal);
	expect(screen.getByText("Clock ready / Idle unavailable")).toBeDefined();
});
it("keeps online-only clocking disabled without a connection", () => {
	show({ ...journal, serverReachable: false });
	expect(screen.getByText("Clock paused / Idle unavailable")).toBeDefined();
});
it("does not require atomic idle breaks for durable ordinary clocking", () => {
	show({ ...journal, commandsEnabled: true, serverReachable: false });
	expect(screen.getByText("Clock ready / Idle unavailable")).toBeDefined();
});
it("still pauses for unresolved recovery or a native action in progress", () => {
	show({ ...journal, legacy: { ...journal.legacy, total: 1 } });
	expect(screen.getByText("Clock paused / Idle unavailable")).toBeDefined();
	cleanup();
	show({ ...journal, busy: true });
	expect(screen.getByText("Clock paused / Idle unavailable")).toBeDefined();
});
