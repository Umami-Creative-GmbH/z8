import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClockButton } from "../src/components/ClockButton";
import { OrganizationSelector } from "../src/components/OrganizationSelector";
import { LocaleProvider } from "../src/lib/i18n";
afterEach(cleanup);
describe("companion clock controls", () => {
	it("offers Resume and End Day on break, without sending another clock-out", async () => {
		const resume = vi.fn(async () => {}),
			end = vi.fn(async () => {}),
			out = vi.fn(async () => {});
		render(
			<ClockButton
				isClockedIn={false}
				isOnBreak
				startTime={null}
				onClockIn={resume}
				onClockOut={out}
				onStartBreak={out}
				onEndDay={end}
				isLoading={false}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "End day" }));
		expect(end).toHaveBeenCalledOnce();
		expect(out).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Resume work" }));
		expect(resume).toHaveBeenCalledOnce();
	});
	it("presents the same manual-break workflow in German", () => {
		const action = async () => {};
		render(
			<LocaleProvider language="de">
				<ClockButton
					isClockedIn={false}
					isOnBreak
					startTime={null}
					onClockIn={action}
					onClockOut={action}
					onStartBreak={action}
					onEndDay={action}
					isLoading={false}
				/>
			</LocaleProvider>,
		);
		expect(
			screen.getByRole("button", { name: "Arbeit fortsetzen" }),
		).toBeDefined();
		expect(screen.getByText("In Pause")).toBeDefined();
	});
	it("does not present a sole organization as selected until the server confirms it", () => {
		render(
			<OrganizationSelector
				organizations={[
					{
						id: "org",
						name: "Acme",
						slug: "acme",
						logo: null,
						memberRole: "member",
						hasEmployeeRecord: true,
					},
				]}
				activeOrganizationId={null}
				onSwitch={async () => {}}
				isSwitching={false}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /Select organization/ }),
		).toBeDefined();
	});
});
