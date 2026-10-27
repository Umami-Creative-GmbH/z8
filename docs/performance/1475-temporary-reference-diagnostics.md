# Observe unsupported temporary-reference tokens

An unsupported Flight `$T` token still returns `complete:false` and `unsupported-model-reference`. Its existing technical `modelReference` now also records the exact token's SHA-256, the actual `semantic-loop` phase, and its existing semantic-role enum when known. The token, suffix, map key and values are never serialized. Existing embedded-prefetch diagnostics carry the same nested metadata without resolving the reference.

This is diagnostic collection only. React's temporary-reference map is request-local; a token hash does not prove a map entry, value, lifetime, action success or completed required payload. The prior mixed failure remains failed. Non-T diagnostics, parser decisions, work counters, caps, resource gates and numerical policies are unchanged.

Pure synthetic tests cover exact/different token hashes, the actual required role, embedded propagation, privacy, the existing decoded-body limit, E errors and explicit action failures. No captured payload is replayed. Passive request-body collection remains a separate design: any future implementation must respect the existing **4 MiB encoded**, 8 MiB decoded and shared 32 MiB retained limits, and must preserve forwarding and actual request EOF rather than infer completion.
