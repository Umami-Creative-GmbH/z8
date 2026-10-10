/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { employeeScheduleWeek } from "./employee-schedule-utils";
import { EmployeeShiftAgenda } from "./employee-shift-agenda";

const days = employeeScheduleWeek(Temporal.PlainDate.from("2026-10-09"), "monday").days;

const nightShift = {
	id: "shift-1",
	employeeId: "employee-1",
	// Berlin midnight of Friday 2026-10-09.
	date: new Date("2026-10-08T22:00:00Z"),
	startTime: "22:00",
	endTime: "06:00",
	status: "published",
	notes: null,
	subarea: { id: "subarea-1", name: "Floor", location: { id: "location-1", name: "Store" } },
} as ShiftWithRelations;

function renderAgenda(overrides: Partial<Parameters<typeof EmployeeShiftAgenda>[0]> = {}) {
	const props = {
		days,
		shifts: [nightShift],
		loading: false,
		today: Temporal.PlainDate.from("2026-10-08"),
		focusDate: null,
		organizationTimezone: "Europe/Berlin",
		onSelectShift: vi.fn(),
		onPreviousWeek: vi.fn(),
		onNextWeek: vi.fn(),
		...overrides,
	};
	render(<EmployeeShiftAgenda {...props} />);
	return props;
}

describe("EmployeeShiftAgenda", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(cleanup);

	it("lists every day of the week with the shift on its organization day", () => {
		renderAgenda();

		const items = screen.getAllByRole("listitem");
		expect(items).toHaveLength(7);
		expect(within(items[4]).getByText("Fri, Oct 9")).toBeTruthy();
		expect(within(items[4]).getByRole("button").textContent).toContain("22:00 – 06:00");
		expect(within(items[4]).getByRole("button").textContent).toContain("Store · Floor");
		expect(within(items[3]).getByText("No shifts")).toBeTruthy();
		expect(items[3].getAttribute("aria-current")).toBe("date");
	});

	it("opens a shift's details when tapped", () => {
		const props = renderAgenda();

		fireEvent.click(screen.getByRole("button", { name: /22:00/ }));

		expect(props.onSelectShift).toHaveBeenCalledWith(nightShift);
	});

	it("moves between weeks with a horizontal swipe and ignores vertical scrolling", () => {
		const props = renderAgenda();
		const list = screen.getByRole("list");

		fireEvent.touchStart(list, { touches: [{ clientX: 300, clientY: 100 }] });
		fireEvent.touchEnd(list, { changedTouches: [{ clientX: 100, clientY: 110 }] });
		expect(props.onNextWeek).toHaveBeenCalledTimes(1);

		fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 100 }] });
		fireEvent.touchEnd(list, { changedTouches: [{ clientX: 300, clientY: 90 }] });
		expect(props.onPreviousWeek).toHaveBeenCalledTimes(1);

		fireEvent.touchStart(list, { touches: [{ clientX: 100, clientY: 100 }] });
		fireEvent.touchEnd(list, { changedTouches: [{ clientX: 180, clientY: 400 }] });
		expect(props.onNextWeek).toHaveBeenCalledTimes(1);
		expect(props.onPreviousWeek).toHaveBeenCalledTimes(1);
	});

	it("scrolls the focused day into view", () => {
		renderAgenda({ focusDate: "2026-10-09" });

		expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
	});
});
