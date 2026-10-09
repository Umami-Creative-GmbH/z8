import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionHeader } from "../src/components/CompanionHeader";
import { ServerSetupNotice } from "../src/components/ServerSetupNotice";
import { LocaleProvider } from "../src/lib/i18n";
import type { ClockJournal } from "../src/types";
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
	breaksEnabled: false,
	commands: [],
	otherContexts: 0,
	projection: null,
};
it("provides one icon-only dashboard action in German", async () => {
	const dashboard = vi.fn();
	render(
		<LocaleProvider language="de">
			<CompanionHeader
				organizations={{
					organizations: [],
					activeOrganizationId: null,
					isLoading: false,
					isOffline: false,
					error: null,
					switchOrganization: async () => {},
					isSwitching: false,
					refetch: async () => {
						throw Error("Unused");
					},
				}}
				theme={{ theme: "light", resolvedTheme: "light", setTheme: () => {} }}
				busy={false}
				offline={false}
				onOpenSettings={() => {}}
				onOpenDashboard={dashboard}
			/>
		</LocaleProvider>,
	);
	const button = screen.getByRole("button", { name: "Dashboard öffnen" });
	expect(button.textContent).toBe("");
	await userEvent.click(button);
	expect(dashboard).toHaveBeenCalledOnce();
	expect(screen.queryByText("Zeiten und Korrekturen")).toBeNull();
	expect(screen.queryByText("Berichte")).toBeNull();
});
it("explains that an unavailable clock needs a connection", () => {
	render(
		<LocaleProvider language="de">
			<ServerSetupNotice journal={journal} />
		</LocaleProvider>,
	);
	expect(screen.getByText("Verbindung erforderlich")).toBeDefined();
	expect(screen.getByText(/Verbinden Sie sich mit Z8/)).toBeDefined();
	expect(screen.queryByText(/atomare Pausen/)).toBeNull();
});
it("shows no availability notice when the server supports desktop clocking", () => {
	render(
		<ServerSetupNotice
			journal={{ ...journal, commandsEnabled: true, breaksEnabled: true }}
		/>,
	);
	expect(screen.queryByRole("status")).toBeNull();
});

it("explains online clocking without asking for organization activation", () => {
	render(
		<LocaleProvider language="de">
			<ServerSetupNotice
				journal={{ ...journal, onlineClockingEnabled: true }}
			/>
		</LocaleProvider>,
	);
	expect(screen.getByText("Online-Modus")).toBeDefined();
	expect(
		screen.getByText(/Internet erforderlich. Offline-Stempeln/),
	).toBeDefined();
	expect(screen.queryByText(/freischalten/)).toBeNull();
});

it("identifies an older webapp without suggesting a tenant setting", () => {
	render(
		<LocaleProvider language="de">
			<ServerSetupNotice journal={{ ...journal, serverUpdateRequired: true }} />
		</LocaleProvider>,
	);
	expect(screen.getByText("Z8-Update erforderlich")).toBeDefined();
	expect(screen.getByText(/Die Z8-Webapp benötigt ein Update/)).toBeDefined();
});
