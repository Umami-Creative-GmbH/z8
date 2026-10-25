# Fixture exporter context

A bounded private caller-stack witness identified `Date.now()` in the real OTLP retry transport, reached through a batch processor timer inherited from Next's `prerender-runtime` scope. The retained stack proof is SHA256 `7db193c62b4dd7a78c7c9b52af648887d3cdc00ed48be905520759b61f22cbf4`. Earlier incomplete probes remain diagnostics.

The fixture exporter now creates an async resource during instrumentation startup. Each actual export runs in that startup resource while explicitly restoring the captured OpenTelemetry context, including tracing suppression, parent span and baggage. The same batch, callback, receiver, return and exceptions pass through. Flush and shutdown methods are unchanged. Cache operations and native span accounting remain in their original contexts.

The real SDK batch timer and HTTP transport regression failed with inherited render context and passed with isolation. It verifies one actual export, unchanged span identity, and preserved OpenTelemetry suppression/context. A separate contract test checks callback, return, error and lifecycle identity. Both tests, lint and the normal Next type generation plus all three TypeScript configurations passed.

This common observer change requires identical original and optimized builds. Actual rebuilt runtime checks, strict server-log evidence and complete clean captures remain pending; no performance or release acceptance is claimed here.
