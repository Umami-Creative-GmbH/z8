/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClock } from "./useClock";

const storageMock = vi.hoisted(() => ({
  getLastAction: vi.fn(),
  getOptimisticState: vi.fn(),
  getQueuedActions: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({ storage: storageMock }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      getClockStatus: vi.fn().mockResolvedValue({
        hasEmployee: true,
        employeeId: "employee-1",
        isClockedIn: false,
        activeWorkPeriod: null,
      }),
    },
  };
});

type StorageChangeListener = Parameters<
  typeof chrome.storage.onChanged.addListener
>[0];

function HookHarness({ revision: _revision }: { revision: number }) {
  useClock();
  return null;
}

function createWrapper(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
}

describe("useClock storage listeners", () => {
  const listeners = new Set<StorageChangeListener>();
  const addListener = vi.fn((listener: StorageChangeListener) => {
    listeners.add(listener);
  });
  const removeListener = vi.fn((listener: StorageChangeListener) => {
    listeners.delete(listener);
  });

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    storageMock.getLastAction.mockResolvedValue(null);
    storageMock.getOptimisticState.mockResolvedValue(null);
    storageMock.getQueuedActions.mockResolvedValue([]);
    vi.stubGlobal("chrome", {
      storage: { onChanged: { addListener, removeListener } },
      runtime: { sendMessage: vi.fn(), lastError: undefined },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("removes each exact listener through StrictMode replay, rerender, and unmount", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createWrapper(<HookHarness revision={0} />));
    });

    expect(addListener).toHaveBeenCalledTimes(4);
    expect(removeListener).toHaveBeenCalledTimes(2);
    expect(listeners).toHaveProperty("size", 2);

    await act(async () => {
      root.render(createWrapper(<HookHarness revision={1} />));
    });

    expect(addListener).toHaveBeenCalledTimes(4);
    expect(removeListener).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });

    const addedListeners = addListener.mock.calls.map(([listener]) => listener);
    const removedListeners = removeListener.mock.calls.map(([listener]) => listener);

    expect(removeListener).toHaveBeenCalledTimes(4);
    expect(listeners).toHaveProperty("size", 0);
    expect(removedListeners).toHaveLength(addedListeners.length);
    expect(removedListeners).toEqual(expect.arrayContaining(addedListeners));
  });
});
