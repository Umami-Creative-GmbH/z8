// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, type ComponentProps, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { InviteMemberDialog } from "./invite-member-dialog";

const boundary = vi.hoisted(() => ({
	send: vi.fn(),
	create: vi.fn(),
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	close: vi.fn(),
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => boundary.session }));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: boundary.error } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: boundary.refresh }) }));
vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	sendInvitation: boundary.send,
}));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: async () => ({ success: true, data: [] }),
}));
vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => ({
	createKioskOnlyEmployeeAction: boundary.create,
	getKioskOnlyEmployeeLocationsAction: async () => ({ success: true, data: [] }),
}));

let client: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	boundary.session = {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
	boundary.send.mockResolvedValue({ success: false, error: "Synthetic refusal" });
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
	cleanup();
	client.clear();
});

function Panel(props: Partial<ComponentProps<typeof InviteMemberDialog>> = {}) {
	const [open, setOpen] = useState(true);
	return (
		<InviteMemberDialog
			organizationId="org-a"
			organizationName="Synthetic organization"
			organizationToday="2026-11-23"
			settingsAccess="orgAdmin"
			open={open}
			onOpenChange={(next) => {
				boundary.close(next);
				setOpen(next);
			}}
			{...props}
		/>
	);
}
function content(
	mode: "visible" | "hidden" = "visible",
	props: Partial<ComponentProps<typeof InviteMemberDialog>> = {},
) {
	return (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<Panel {...props} />
			</Activity>
		</QueryClientProvider>
	);
}
function fill() {
	fireEvent.change(screen.getByRole("textbox", { name: "Email Address" }), {
		target: { value: "synthetic-invite@example.test" },
	});
}
function submit() {
	fireEvent.submit(screen.getByRole("button", { name: "Send Invitation" }).closest("form")!);
}

it.each(["Escape", "Close", "Cancel"])(
	"keeps the pending invitation panel open through %s and duplicate submission",
	async (dismiss) => {
		let release!: (value: { success: false; error: string }) => void;
		boundary.send.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		render(content());
		fill();
		submit();
		await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
		if (dismiss === "Escape") await userEvent.keyboard("{Escape}");
		else fireEvent.click(screen.getByRole("button", { name: dismiss }));
		expect(boundary.close).not.toHaveBeenCalled();
		submit();
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(boundary.send).toHaveBeenCalledTimes(1);
		await act(async () => release({ success: false, error: "Synthetic refusal" }));
		expect(screen.getByRole("textbox", { name: "Email Address" })).toHaveProperty(
			"value",
			"synthetic-invite@example.test",
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	},
);

it.each(["actor", "organization", "pending session", "settings access"] as const)(
	"retires queued validation across %s A to B to A",
	async (retirement) => {
		const view = render(content());
		fill();
		act(() => {
			submit();
			expect(boundary.send).not.toHaveBeenCalled();
			if (retirement === "actor") boundary.session.data.user.id = "actor-b";
			if (retirement === "organization")
				boundary.session.data.session.activeOrganizationId = "org-b";
			if (retirement === "pending session") boundary.session.isPending = true;
			flushSync(() =>
				view.rerender(
					content("visible", retirement === "settings access" ? { settingsAccess: null } : {}),
				),
			);
			boundary.session = {
				data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
				isPending: false,
			};
			flushSync(() => view.rerender(content()));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(boundary.send).not.toHaveBeenCalled();
		expect(boundary.error).not.toHaveBeenCalled();
		submit();
		await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
	},
);

it("retires a queued submit when Activity hides and returns before TanStack dispatch", async () => {
	const view = render(content());
	fill();
	act(() => {
		submit();
		expect(boundary.send).not.toHaveBeenCalled();
		flushSync(() => view.rerender(content("hidden")));
		flushSync(() => view.rerender(content()));
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(boundary.send).not.toHaveBeenCalled();
	expect(screen.getByRole("textbox", { name: "Email Address" })).toHaveProperty(
		"value",
		"synthetic-invite@example.test",
	);
	submit();
	await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
});

it.each(["success", "refusal", "rejection"] as const)(
	"suppresses late %s effects after Activity retirement and holds the original command lock",
	async (outcome) => {
		let release!: (value: { success: boolean; error?: string }) => void;
		let reject!: (reason: Error) => void;
		boundary.send.mockImplementation(
			() =>
				new Promise((resolve, fail) => {
					release = resolve;
					reject = fail;
				}),
		);
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const view = render(content());
		fill();
		submit();
		await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
		view.rerender(content("hidden"));
		view.rerender(content());
		submit();
		expect(boundary.send).toHaveBeenCalledTimes(1);
		await act(async () => {
			if (outcome === "rejection") reject(new Error("Synthetic transport failure"));
			else
				release(
					outcome === "success"
						? { success: true }
						: { success: false, error: "Synthetic refusal" },
				);
		});
		expect(boundary.success).not.toHaveBeenCalled();
		expect(boundary.error).not.toHaveBeenCalled();
		expect(boundary.refresh).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox", { name: "Email Address" })).toHaveProperty(
			"value",
			"synthetic-invite@example.test",
		);
	},
);

it("serializes two submit activations before validation begins", async () => {
	render(content());
	fill();
	act(() => {
		submit();
		submit();
	});
	await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(boundary.error).toHaveBeenCalledWith("Synthetic refusal"));
});

it.each(["success", "rejection"] as const)(
	"holds and retires kiosk-only %s without changing its command payload",
	async (outcome) => {
		let release!: (value: { success: true; data: { employeeId: string } }) => void;
		let reject!: (reason: Error) => void;
		boundary.create.mockImplementation(
			() =>
				new Promise((resolve, fail) => {
					release = resolve;
					reject = fail;
				}),
		);
		const view = render(content());
		fireEvent.click(screen.getByRole("checkbox", { name: "Kiosk only, no email" }));
		fireEvent.change(screen.getByRole("textbox", { name: "First name" }), {
			target: { value: "Synthetic" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Last name" }), {
			target: { value: "Person" },
		});
		const form = screen.getByRole("button", { name: "Create employee" }).closest("form")!;
		fireEvent.submit(form);
		await waitFor(() =>
			expect(boundary.create).toHaveBeenCalledExactlyOnceWith({
				firstName: "Synthetic",
				lastName: "Person",
				teamId: null,
				locationIds: [],
			}),
		);
		await userEvent.keyboard("{Escape}");
		expect(boundary.close).not.toHaveBeenCalled();
		view.rerender(content("hidden"));
		view.rerender(content());
		fireEvent.submit(form);
		expect(boundary.create).toHaveBeenCalledTimes(1);
		await act(async () => {
			if (outcome === "rejection") reject(new Error("Synthetic transport failure"));
			else release({ success: true, data: { employeeId: "synthetic-created" } });
		});
		expect(boundary.success).not.toHaveBeenCalled();
		expect(boundary.error).not.toHaveBeenCalled();
		expect(boundary.refresh).not.toHaveBeenCalled();
		expect(boundary.send).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox", { name: "First name" })).toHaveProperty(
			"value",
			"Synthetic",
		);
	},
);
