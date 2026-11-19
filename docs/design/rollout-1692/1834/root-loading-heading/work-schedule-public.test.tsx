/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	push: vi.fn(),
	replace: vi.fn(),
	setWorkScheduleOnboarding: vi.fn(),
	skipWorkScheduleSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	session: {
		data: {
			user: { id: "account-a" },
			session: { id: "session-a", activeOrganizationId: "org-a" },
		},
		isPending: false,
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("@/app/[locale]/onboarding/work-schedule/actions", () => ({
	checkIsAdmin: mocks.checkIsAdmin,
	setWorkScheduleOnboarding: mocks.setWorkScheduleOnboarding,
	skipWorkScheduleSetup: mocks.skipWorkScheduleSetup,
}));

import WorkSchedulePage from "@/app/[locale]/onboarding/work-schedule/page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("R039 independent public arrival review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkIsAdmin.mockReset();
    mocks.setWorkScheduleOnboarding.mockReset();
    mocks.skipWorkScheduleSetup.mockReset();
    mocks.session = {data:{user:{id:"account-a"},session:{id:"session-a",activeOrganizationId:"org-a"}},isPending:false};
  });

  it.each(["session", "administrator"])("keeps the work-schedule heading during %s loading", async (phase) => {
    const held = deferred<{success:true;data:boolean}>();
    mocks.checkIsAdmin.mockReturnValue(held.promise);
    if (phase === "session") mocks.session.isPending = true;
    render(<WorkSchedulePage />);
    expect(screen.getAllByRole("heading",{level:1,name:"Set your work schedule"})).toHaveLength(1);
    expect(screen.queryByLabelText("Hours per Week")).toBeNull();
    expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
    expect(mocks.skipWorkScheduleSetup).not.toHaveBeenCalled();
  });

  it("abandons a queued real Continue event and accepts a deliberate retry after Activity reconnects", async () => {
    mocks.checkIsAdmin.mockResolvedValue({success:true,data:true});
    mocks.setWorkScheduleOnboarding.mockResolvedValue({success:true,data:{nextStep:"/current-server-destination"}});
    const view = render(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    fireEvent.change(await screen.findByLabelText("Hours per Week"),{target:{value:"32.5"}});
    fireEvent.click(screen.getByRole("button",{name:"Continue"}));
    view.rerender(<Activity mode="hidden"><WorkSchedulePage /></Activity>);
    view.rerender(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    await act(async () => undefined);
    expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button",{name:"Continue"}));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/current-server-destination"));
    expect(mocks.setWorkScheduleOnboarding).toHaveBeenCalledOnce();
    expect(mocks.setWorkScheduleOnboarding.mock.calls[0][0]).toMatchObject({hoursPerWeek:32.5,workClassification:"weekly",effectiveFrom:expect.any(Date)});
  });

  it.each([["save","refusal"],["save","exception"],["skip","refusal"],["skip","exception"]])("retains the fresh arrival and accepts a new %s after old %s settles", async (kind,outcome) => {
    const held = deferred<{success:false;error:string}>();
    mocks.checkIsAdmin.mockResolvedValue({success:true,data:true});
    const action = kind === "save" ? mocks.setWorkScheduleOnboarding : mocks.skipWorkScheduleSetup;
    action.mockReturnValueOnce(held.promise).mockResolvedValueOnce({success:true,data:{nextStep:"/fresh-retry"}});
    const view = render(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    fireEvent.change(await screen.findByLabelText("Hours per Week"),{target:{value:"32.5"}});
    const name = kind === "save" ? "Continue" : "Skip for now";
    fireEvent.click(screen.getByRole("button",{name}));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    view.rerender(<Activity mode="hidden"><WorkSchedulePage /></Activity>);
    view.rerender(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    expect(await screen.findByLabelText("Hours per Week")).toHaveProperty("value","32.5");
    await act(async () => {
      if(outcome === "exception") held.reject(new Error("private old failure"));
      else held.resolve({success:false,error:"old refusal"});
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name}));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/fresh-retry"));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("retires old save success through organization ABA and preserves current refusal input and effective boundary on retry", async () => {
    const held = deferred<{success:true;data:{nextStep:string}}>();
    mocks.checkIsAdmin.mockResolvedValue({success:true,data:true});
    mocks.setWorkScheduleOnboarding.mockReturnValueOnce(held.promise).mockResolvedValueOnce({success:false,error:"current refusal"}).mockResolvedValueOnce({success:true,data:{nextStep:"/fresh-aba"}});
    const view = render(<WorkSchedulePage />);
    fireEvent.click(await screen.findByRole("button",{name:"Continue"}));
    await waitFor(() => expect(mocks.setWorkScheduleOnboarding).toHaveBeenCalledOnce());
    mocks.session.data.session.activeOrganizationId = "org-b";
    view.rerender(<WorkSchedulePage />);
    await screen.findByLabelText("Hours per Week");
    mocks.session.data.session.activeOrganizationId = "org-a";
    view.rerender(<WorkSchedulePage />);
    fireEvent.change(await screen.findByLabelText("Hours per Week"),{target:{value:"24.5"}});
    await act(async () => held.resolve({success:true,data:{nextStep:"/abandoned"}}));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Continue"}));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","current refusal");
    expect(screen.getByLabelText("Hours per Week")).toHaveProperty("value","24.5");
    fireEvent.click(screen.getByRole("button",{name:"Continue"}));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/fresh-aba"));
    expect(mocks.setWorkScheduleOnboarding.mock.calls[2][0]).toEqual(mocks.setWorkScheduleOnboarding.mock.calls[1][0]);
  });

  it("does not overlap a held autoskip on reconnection and accepts explicit retry after rejection", async () => {
    const held = deferred<never>();
    mocks.checkIsAdmin.mockResolvedValue({success:true,data:false});
    mocks.skipWorkScheduleSetup.mockReturnValueOnce(held.promise).mockResolvedValueOnce({success:true,data:{nextStep:"/fresh-autoskip"}});
    const view = render(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    await waitFor(() => expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce());
    view.rerender(<Activity mode="hidden"><WorkSchedulePage /></Activity>);
    view.rerender(<Activity mode="visible"><WorkSchedulePage /></Activity>);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button",{name:"Try again"}));
    await act(async () => undefined);
    expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce();
    await act(async () => held.reject(new Error("private old autoskip")));
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Try again"}));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/fresh-autoskip"));
    expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledTimes(2);
  });

  it("lets explicit Skip own the command when Continue is queued in validation", async () => {
    const held = deferred<{success:true;data:{nextStep:string}}>();
    mocks.checkIsAdmin.mockResolvedValue({success:true,data:true});
    mocks.skipWorkScheduleSetup.mockReturnValue(held.promise);
    render(<WorkSchedulePage />);
    fireEvent.click(await screen.findByRole("button",{name:"Continue"}));
    fireEvent.click(screen.getByRole("button",{name:"Skip for now"}));
    fireEvent.click(screen.getByRole("button",{name:"Skip for now"}));
    await act(async () => undefined);
    expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce();
    expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
    await act(async () => held.resolve({success:true,data:{nextStep:"/explicit-skip"}}));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/explicit-skip");
  });
});
