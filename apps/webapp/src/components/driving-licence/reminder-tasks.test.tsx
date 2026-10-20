// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ list: vi.fn(), complete: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "verifier" },
			session: { activeOrganizationId: "org" },
		},
	}),
}));
vi.mock("@/lib/organization/driving-licence/task-actions", () => ({
	getDrivingLicenceTasksAction: remote.list,
	completeDrivingLicencePersonalReminderAction: remote.complete,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

import { toast } from "sonner";
import { DrivingLicencePersonalReminderTasks } from "./reminder-tasks";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
function mount(element: React.ReactNode) {
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			{element}
		</QueryClientProvider>,
	);
}
it("shows unavailable direct notification before and after completing a personal reminder", async () => {
	const task = {
		id: "task",
		employeeName: "Driver",
		employeeId: "employee",
		kind: "personal_reminder",
		state: "pending",
		directEmployeeNotification: "unavailable",
		occasion: { kind: "initial", classCode: null, validThrough: null },
		completedAt: null,
	};
	remote.list.mockResolvedValue({ success: true, data: [task] });
	remote.complete.mockImplementation(async () => {
		remote.list.mockResolvedValue({
			success: true,
			data: [
				{ ...task, state: "completed", completedAt: "2026-01-31T11:00:00Z" },
			],
		});
		return { success: true };
	});
	mount(<DrivingLicencePersonalReminderTasks />);
	expect(
		await screen.findByText(/Direct employee notification was unavailable/),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Mark personal reminder completed" }),
	);
	await waitFor(() =>
		expect(remote.complete).toHaveBeenCalledWith({ taskId: "task" }),
	);
	expect(await screen.findByText("Personal reminder completed")).toBeTruthy();
	expect(toast.success).toHaveBeenCalledWith("Personal reminder marked completed");
	expect(
		screen.getByText(
			/Task completion does not confirm direct delivery or employee reading/,
		),
	).toBeTruthy();
});
it("links a personal reminder task to the employee's check page (#1429)", async () => {
	remote.list.mockResolvedValue({
		success: true,
		data: [
			{
				id: "task",
				employeeName: "Driver",
				employeeId: "employee",
				kind: "personal_reminder",
				state: "pending",
				directEmployeeNotification: "unavailable",
				occasion: { kind: "deadline", classCode: "B", validThrough: "2026-02-28" },
				completedAt: null,
			},
		],
	});
	mount(<DrivingLicencePersonalReminderTasks />);
	expect(
		(await screen.findByRole("link", { name: "Open check" })).getAttribute("href"),
	).toBe("/driving-licence/checks/employee");
});
