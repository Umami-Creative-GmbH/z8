import { ApiException } from "@kubernetes/client-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KubernetesAdapter } from "./kubernetes.js";

describe("KubernetesAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates migration jobs with the image layout working directory", async () => {
    let createdJob: unknown;
    const batchApi = {
      deleteNamespacedJob: vi.fn(async () => {
        throw new ApiException(404, "not found", {}, {});
      }),
      createNamespacedJob: vi.fn(async ({ body }: { body: unknown }) => {
        createdJob = body;
        return body;
      }),
      readNamespacedJobStatus: vi
        .fn()
        .mockRejectedValueOnce(new ApiException(404, "not found", {}, {}))
        .mockResolvedValue({ status: { succeeded: 1 } })
    };

    const adapter = new KubernetesAdapter({
      namespace: "app-prod",
      appsApi: {} as never,
      batchApi: batchApi as never
    });

    await adapter.runMigration("sha-abcdef1", "ghcr.io/owner/z8-migration:sha-abcdef1", 1_000);

    expect(createdJob).toMatchObject({
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "migrate",
                workingDir: "/app",
                command: ["node", "./scripts/migrate-with-lock.js"]
              }
            ]
          }
        }
      }
    });
  });

  it("waits for an existing active migration job instead of deleting it", async () => {
    vi.useFakeTimers();
    let statusReadCount = 0;
    const batchApi = {
      deleteNamespacedJob: vi.fn(),
      createNamespacedJob: vi.fn(),
      readNamespacedJob: vi.fn(async () => {
        throw new ApiException(404, "not found", {}, {});
      }),
      readNamespacedJobStatus: vi.fn(async () => {
        statusReadCount += 1;
        return statusReadCount === 1 ? { status: { active: 1 } } : { status: { succeeded: 1 } };
      })
    };

    const adapter = new KubernetesAdapter({
      namespace: "app-prod",
      appsApi: {} as never,
      batchApi: batchApi as never
    });

    const run = adapter.runMigration("sha-abcdef1", "ghcr.io/owner/z8-migration:sha-abcdef1", 10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await run;

    expect(batchApi.deleteNamespacedJob).not.toHaveBeenCalled();
    expect(batchApi.createNamespacedJob).not.toHaveBeenCalled();
    expect(batchApi.readNamespacedJobStatus).toHaveBeenCalledTimes(2);
  });
});
