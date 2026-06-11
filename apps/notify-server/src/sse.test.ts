import { describe, expect, it } from "vitest";
import { createSseHeaders, encodeSseEvent } from "./sse.js";

describe("sse helpers", () => {
  it("encodes named events", () => {
    expect(encodeSseEvent("count_update", { count: 3, organizationId: "org-1" })).toBe(
      'event: count_update\ndata: {"count":3,"organizationId":"org-1"}\n\n',
    );
  });

  it("sets streaming headers", () => {
    const headers = createSseHeaders();
    expect(headers.get("Content-Type")).toBe("text/event-stream");
    expect(headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(headers.get("Connection")).toBe("keep-alive");
    expect(headers.get("X-Accel-Buffering")).toBe("no");
  });
});
