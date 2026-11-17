// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { render } from "@/test/render-with-translations";
import { afterEach, expect, it, vi } from "vitest";
import { InviteMemberDialog } from "@/components/organization/invite-member-dialog";

const boundary = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({ sendInvitation: boundary.send }));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({ listTeams: async () => ({ success: true, data: [] }) }));
vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => ({ getKioskOnlyEmployeeLocationsAction: async () => ({ success: true, data: [] }), createKioskOnlyEmployeeAction: vi.fn() }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: boundary.refresh }) }));
let client: QueryClient;
afterEach(() => { cleanup(); client.clear(); });
function Panel() {
	const [open, setOpen] = useState(true);
	return <InviteMemberDialog organizationId="org" organizationName="Synthetic organization" settingsAccess="orgAdmin" open={open} onOpenChange={setOpen} />;
}
it("pending invitation must retain its panel when Escape is pressed", async () => {
	let release!: (value: { success: false; error: string }) => void;
	boundary.send.mockImplementation(() => new Promise(done => { release = done; }));
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}><Panel /></QueryClientProvider>);
	fireEvent.change(await screen.findByRole("textbox", { name: "Email Address" }), { target: { value: "synthetic-invite@example.test" } });
	fireEvent.submit(screen.getByRole("button", { name: "Send Invitation" }).closest("form")!);
	await waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
	await userEvent.keyboard("{Escape}");
	await new Promise(done => setTimeout(done, 400));
 const remainsOpen = screen.queryByRole("dialog") !== null;
	release({ success: false, error: "Synthetic authorization refusal" });
	expect(remainsOpen).toBe(true);
});
