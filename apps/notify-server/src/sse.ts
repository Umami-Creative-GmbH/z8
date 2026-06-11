export function encodeSseEvent(type: string, data: unknown): string {
  if (type.includes("\n") || type.includes("\r")) {
    throw new Error("Invalid SSE event type");
  }
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}
