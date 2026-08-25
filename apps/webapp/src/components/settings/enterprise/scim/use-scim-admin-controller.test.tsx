/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScimAdminController } from "./use-scim-admin-controller";

const actions = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), events: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), decommission: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/[locale]/(app)/settings/enterprise/scim-actions", () => ({
	createEnterpriseIdentityScimConnectionAction: actions.create, getEnterpriseIdentityScimStatusAction: actions.get, listEnterpriseIdentityScimEventsAction: actions.events, rotateEnterpriseIdentityScimCredentialAction: actions.rotate, revokeEnterpriseIdentityScimCredentialAction: actions.revoke, decommissionEnterpriseIdentityScimConnectionAction: actions.decommission,
}));

const safeStatus = { connection: { connectionId: "connection-1", decommissionedAt: null, decommissionStartedAt: null }, credentials: [] };
const setup = { state: { scim: { connection: { connectionId: "connection-1" }, policy: { defaultRoleTemplateId: "role-1" } } } } as any;

describe("useScimAdminController", () => {
	it("creates then refreshes only safe status while retaining the raw token in transient state", async () => {
		actions.create.mockResolvedValue({ connection: { connectionId: "connection-1" }, token: "raw-token" }); actions.get.mockResolvedValue(safeStatus); actions.events.mockResolvedValue([]);
		const { result } = renderHook(() => useScimAdminController(setup));
		act(() => result.current.create("role-1"));
		await waitFor(() => expect(actions.create).toHaveBeenCalledWith({ autoActivateUsers: false, deprovisionAction: "suspend", defaultRoleTemplateId: "role-1" }));
		await waitFor(() => expect(result.current.status).toEqual(safeStatus));
		expect(result.current.credential).toBe("raw-token"); expect(JSON.stringify(result.current.status)).not.toContain("raw-token"); expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining("raw-token"));
	});

	it("refreshes safe metadata after rotate and confirmed revoke without retaining its token in status", async () => {
		actions.rotate.mockResolvedValue({ token: "rotated-token" }); actions.get.mockResolvedValue(safeStatus); actions.events.mockResolvedValue([]); actions.revoke.mockResolvedValue(undefined);
		const { result } = renderHook(() => useScimAdminController(setup));
		act(() => result.current.rotate()); await waitFor(() => expect(actions.rotate).toHaveBeenCalledWith("connection-1")); await waitFor(() => expect(result.current.credential).toBe("rotated-token"));
		act(() => result.current.requestRevoke("credential-1")); act(() => result.current.confirm()); await waitFor(() => expect(actions.revoke).toHaveBeenCalledWith("connection-1", "credential-1"));
		expect(JSON.stringify(result.current.status)).not.toContain("rotated-token");
	});

	it("does not mutate on cancelled confirmation and clears status after decommission", async () => {
		actions.decommission.mockResolvedValue("decommissioned");
		const { result } = renderHook(() => useScimAdminController(setup));
		act(() => result.current.requestDecommission()); act(() => result.current.cancelDestructive());
		expect(actions.decommission).not.toHaveBeenCalled();
		act(() => result.current.requestDecommission()); act(() => result.current.confirm());
		await waitFor(() => expect(actions.decommission).toHaveBeenCalledWith("connection-1")); await waitFor(() => expect(result.current.lifecycle).toBe("decommissioned"));
	});

	it.each(["creating", "creation_failed"] as const)("retains the safe %s create result for recovery", async (lifecycle) => {
		actions.create.mockResolvedValue({ status: lifecycle, creationRequestId: "safe-request-id" });
		const { result } = renderHook(() => useScimAdminController(setup));
		act(() => result.current.create("role-1"));
		await waitFor(() => expect(result.current.lifecycle).toBe(lifecycle));
		expect(result.current.credential).toBeNull();
	});
});
