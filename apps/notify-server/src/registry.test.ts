import { describe, expect, it, vi } from "vitest";
import { ClientRegistry } from "./registry.js";

describe("ClientRegistry", () => {
  it("fans out only to matching user and organization", () => {
    const registry = new ClientRegistry();
    const matching = vi.fn();
    const wrongOrg = vi.fn();
    registry.add({ id: "c1", userId: "u1", organizationId: "o1", send: matching });
    registry.add({ id: "c2", userId: "u1", organizationId: "o2", send: wrongOrg });

    expect(registry.fanout("u1", "count_update", { count: 4, organizationId: "o1" })).toBe(1);
    expect(matching).toHaveBeenCalledWith("count_update", { count: 4, organizationId: "o1" });
    expect(wrongOrg).not.toHaveBeenCalled();
  });

  it("removes disconnected clients", () => {
    const registry = new ClientRegistry();
    const send = vi.fn();
    registry.add({ id: "c1", userId: "u1", organizationId: "o1", send });
    registry.remove("c1");
    expect(registry.fanout("u1", "count_update", { count: 1, organizationId: "o1" })).toBe(0);
  });

  it("moves replaced client ids to the new user index", () => {
    const registry = new ClientRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.add({ id: "c1", userId: "u1", organizationId: "o1", send: first });
    registry.add({ id: "c1", userId: "u2", organizationId: "o1", send: second });

    expect(registry.fanout("u1", "count_update", { count: 1, organizationId: "o1" })).toBe(0);
    expect(registry.fanout("u2", "count_update", { count: 1, organizationId: "o1" })).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("count_update", { count: 1, organizationId: "o1" });
  });
});
