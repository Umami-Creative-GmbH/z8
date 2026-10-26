/** Finite network drain seam. No URL, header, body or user data survives events. */
export const settledPolicy = Object.freeze({
  version: 1,
  quietMs: 1000,
  postReadyCapMs: 10000,
  pollMs: 50,
  scope:
    "finite requests observed from navigation start through post-readiness quiet; explicit prefetch and long-lived traffic counted separately",
});
const groupFor = (type, headers = {}) => {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k.toLowerCase(),
      String(v).toLowerCase(),
    ]),
  );
  if (
    h["next-router-prefetch"] === "1" ||
    /prefetch/.test(h.purpose ?? "") ||
    /prefetch/.test(h["sec-purpose"] ?? "")
  )
    return "prefetch";
  if (["WebSocket", "EventSource"].includes(type)) return "longLived";
  if (type === "Script") return "javascript";
  if (type === "Document") return "document";
  if (h.rsc === "1") return "rsc";
  return "otherFinite";
};
export function createSettledObserver({ onMeasuredFailure } = {}) {
  const requests = new Map(),
    redirects = [];
  let started,
    readyAt,
    failedRequests = null,
    lastActivity = 0,
    observationErrors = 0;
  const eventAt = (at) => {
    lastActivity = Math.max(lastActivity, at);
  };
  return {
    request(event, at) {
      // CDP reuses an id for redirects; retain the prior hop as a censored request.
      if (
        requests.has(event.requestId) &&
        !requests.get(event.requestId).done
      ) {
        requests.get(event.requestId).redirected = true;
        requests.get(event.requestId).done = true;
        requests.get(event.requestId).bytes = Number.isFinite(
          event.redirectResponse?.encodedDataLength,
        )
          ? event.redirectResponse.encodedDataLength
          : null;
        redirects.push(requests.get(event.requestId));
      }
      const group = groupFor(event.type, event.request?.headers),
        request = {
          group,
          done: false,
          error: false,
          observedAfterStart: started !== undefined,
          bytes: null,
          inherited:
            started === undefined ||
            !!(
              event.redirectResponse && requests.get(event.requestId)?.inherited
            ),
        };
      requests.set(event.requestId, request);
      if (!["prefetch", "longLived"].includes(group)) eventAt(at);
    },
    response(event, at) {
      const r = requests.get(event.requestId);
      if (!r) return;
      if (
        r.group !== "prefetch" &&
        (event.type === "EventSource" ||
          event.response?.mimeType?.includes("text/event-stream"))
      )
        r.group = "longLived";
      if (
        r.group !== "prefetch" &&
        r.group !== "longLived" &&
        event.response?.mimeType?.includes("text/x-component")
      )
        r.group = "rsc";
      r.cache = !!(
        event.response?.fromDiskCache || event.response?.fromServiceWorker
      );
      r.httpError = event.response?.status >= 400;
      if (r.httpError) r.error = true;
      if (!["prefetch", "longLived"].includes(r.group)) eventAt(at);
    },
    finished(event, at) {
      const r = requests.get(event.requestId);
      if (!r) return;
      r.done = true;
      r.bytes =
        Number.isFinite(event.encodedDataLength) && event.encodedDataLength >= 0
          ? event.encodedDataLength
          : null;
      if (!["prefetch", "longLived"].includes(r.group)) eventAt(at);
    },
    failed(event, at) {
      const r = requests.get(event.requestId);
      if (!r) return;
      if (r.observedAfterStart) {
        failedRequests++;
        try { onMeasuredFailure?.(event.requestId); } catch { observationErrors++; }
      }
      r.done = true;
      r.error = true;
      if (!["prefetch", "longLived"].includes(r.group)) eventAt(at);
    },
    begin(at) {
      for (const [id, r] of requests) if (r.done) requests.delete(id);
      redirects.length = 0;
      started = at;
      failedRequests = 0;
      lastActivity = at;
    },
    ready(at) {
      readyAt = at;
      lastActivity = Math.max(lastActivity, at);
    },
    state(at) {
      const groups = Object.fromEntries(
        [
          "javascript",
          "document",
          "rsc",
          "otherFinite",
          "prefetch",
          "longLived",
        ].map((name) => [
          name,
          {
            requests: 0,
            pending: 0,
            errors: 0,
            completedBytes: 0,
            unknownBytes: 0,
            cacheHits: 0,
            inheritedRequests: 0,
            inheritedCompletedBytes: 0,
          },
        ]),
      );
      for (const r of [...requests.values(), ...redirects]) {
        const g = groups[r.group];
        g.requests++;
        g.pending += !r.done;
        g.errors += !!r.error;
        g.cacheHits += !!r.cache;
        if (r.inherited) {
          g.inheritedRequests++;
          if (r.done && Number.isFinite(r.bytes))
            g.inheritedCompletedBytes += r.bytes;
          else if (r.done) g.unknownBytes++;
        } else if (r.done && Number.isFinite(r.bytes))
          g.completedBytes += r.bytes;
        else if (r.done) g.unknownBytes++;
      }
      const mandatory = Object.entries(groups)
        .filter(([name]) => !["prefetch", "longLived"].includes(name))
        .map(([, g]) => g);
      const pending = mandatory.reduce((n, g) => n + g.pending, 0),
        errors = mandatory.reduce((n, g) => n + g.errors + g.unknownBytes, 0);
      const capped =
        readyAt !== undefined && at - readyAt >= settledPolicy.postReadyCapMs;
      const complete =
        observationErrors === 0 &&
        readyAt !== undefined &&
        pending === 0 &&
        errors === 0 &&
        lastActivity + settledPolicy.quietMs <=
          readyAt + settledPolicy.postReadyCapMs &&
        at - lastActivity >= settledPolicy.quietMs;
      return {
        failedRequests,
        observationErrors,
        complete,
        capped: capped && !complete,
        censored: !complete,
        groups,
        mandatoryPending: pending,
        mandatoryErrors: errors,
        quietObservedMs: at - lastActivity,
        postReadyMs: readyAt === undefined ? null : at - readyAt,
        bytes: {
          javascript: groups.javascript.completedBytes,
          document: groups.document.completedBytes,
          rsc: groups.rsc.completedBytes,
          otherFinite: groups.otherFinite.completedBytes,
        },
        scope: settledPolicy.scope,
      };
    },
  };
}
