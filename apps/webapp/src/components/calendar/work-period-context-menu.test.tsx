/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { resolveContextMenuWorkPeriod, WorkPeriodContextMenu } from "./work-period-context-menu";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

function workPeriod(id: string, metadata: Record<string, unknown> = {}): CalendarEvent {
	return {
		id,
		type: "work_period",
		date: new Date("2026-09-01T07:00:00.000Z"),
		endDate: new Date("2026-09-01T15:00:00.000Z"),
		title: "Work period",
		color: "#10b981",
		metadata: {
			durationMinutes: 480,
			employeeId: "employee-own",
			employeeName: "Ada Lovelace",
			...metadata,
		},
	};
}

const events: CalendarEvent[] = [
	workPeriod("period-own"),
	workPeriod("period-running", { isRunning: true }),
	workPeriod("period-other", { employeeId: "employee-other" }),
	{
		id: "holiday-1",
		type: "holiday",
		date: new Date("2026-09-02T00:00:00.000Z"),
		title: "Holiday",
		color: "#f59e0b",
		metadata: {},
	},
];

const canManage = (event: CalendarEvent) => event.metadata.employeeId === "employee-own";

function Harness({
	onEdit,
	onDelete,
}: {
	onEdit: (event: CalendarEvent) => void;
	onDelete: (event: CalendarEvent) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<>
			<div ref={containerRef}>
				{events.map((event) => (
					<button key={event.id} type="button" data-event-id={event.id}>
						<span>{event.id}</span>
					</button>
				))}
			</div>
			<WorkPeriodContextMenu
				containerRef={containerRef}
				events={events}
				canManage={canManage}
				onEdit={onEdit}
				onDelete={onDelete}
			/>
		</>
	);
}

describe("resolveContextMenuWorkPeriod", () => {
	it("only offers completed work periods the viewer may manage", () => {
		expect(resolveContextMenuWorkPeriod(events, "period-own", canManage)?.id).toBe("period-own");
		expect(resolveContextMenuWorkPeriod(events, "period-running", canManage)).toBeNull();
		expect(resolveContextMenuWorkPeriod(events, "period-other", canManage)).toBeNull();
		expect(resolveContextMenuWorkPeriod(events, "holiday-1", canManage)).toBeNull();
		expect(resolveContextMenuWorkPeriod(events, undefined, canManage)).toBeNull();
	});
});

describe("WorkPeriodContextMenu", () => {
	const onEdit = vi.fn();
	const onDelete = vi.fn();

	beforeEach(() => {
		onEdit.mockReset();
		onDelete.mockReset();
	});

	it("opens Edit and Delete on right-click of a completed work period", async () => {
		const user = userEvent.setup();
		render(<Harness onEdit={onEdit} onDelete={onDelete} />);

		const opened = fireEvent.contextMenu(screen.getByText("period-own"), {
			clientX: 40,
			clientY: 60,
		});

		expect(opened).toBe(false);
		await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
		expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "period-own" }));
		expect(onDelete).not.toHaveBeenCalled();
	});

	it("requests deletion from the menu", async () => {
		const user = userEvent.setup();
		render(<Harness onEdit={onEdit} onDelete={onDelete} />);

		fireEvent.contextMenu(screen.getByText("period-own"), { clientX: 40, clientY: 60 });
		await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

		expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "period-own" }));
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("keeps the browser menu for running, unmanaged and non-work entries", () => {
		render(<Harness onEdit={onEdit} onDelete={onDelete} />);

		for (const id of ["period-running", "period-other", "holiday-1"]) {
			expect(fireEvent.contextMenu(screen.getByText(id))).toBe(true);
		}
		expect(screen.queryByRole("menu")).toBeNull();
	});
});
