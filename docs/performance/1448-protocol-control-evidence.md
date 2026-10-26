# Prospective browser failure evidence

Clean-evidence policy3 retains the raw browser `failedRequests` metric in both phases. Acceptance requires a complete request-ID partition into genuine failures, unknown failures and positively proved protocol controls. Genuine or unknown measured failures block capture and budget derivation. A canceled request is never recorded as a successful application payload.

The active proof requires actual browser-received Flight bytes, supported framing and required model dependencies, and the same decoded body hash from a unique naturally completed proxy response. HTTP errors, Flight error rows, explicit root action failures, incomplete bodies, ambiguous identity, pending observations and caps reject the proof. Cached native revalidation remains UNKNOWN: the earlier prototype omitted semantic Vary dimensions and a stable browser principal proof. Unsupported segment contracts remain UNKNOWN.

The source-qualified runtime-shell request (`RSC:1`, `Next-Router-Prefetch:3`, no segment subtype) has a narrower output claim. A marked partial response may postpone a lazy rendered child beneath a known React Suspense boundary with a fully fulfilled fallback. Required tree/Map/metadata/type/module references, other component props, plain or promise references, missing fallbacks and cyclic fallback output remain blocking. The same model reached through another required path is still required. This proves only the represented shell output, preserving partiality; it does not claim a complete route. Synthetic tests follow installed Next16.4 buffering and React partial-stream behavior. Real corpus validation remains pending.

Normal primary and companion capture require `--app-manifest <required-server-files.json>`. Before collector or browser IO, the actual file must match `runtime.build`, its SHA256 and its explicit `experimental.cachedNavigations` boolean. Each plan must contain this metadata:

```js
runtime.browserControl = {
  policy: controlCancellationPolicy, // exact exported policy object
  browserRevision: chromiumSWRRevision, // exact exported source revision
  compiledCachedNavigations: /* actual compiled boolean */,
  compiledManifestSha256: /* actual file SHA256 */,
};
```

Browser startup verifies the actual revision through `Browser.getVersion`. Reports retain the verified binding. Both finalizers and independent budget derivation validate the receipt again; optional extra-header event absence does not become invented header knowledge or a control exemption.

Primary measurement retains its existing request-map membership and failure counter. Companion retains its existing observed-after-start counter and supplies those same IDs to the classifier. All-phase observations support correspondence and application evidence; unrelated optional observations do not create a new all-teardown zero-error requirement. Required application UNKNOWNs and errors still block. Each returned visit checks these gates and actual measured native costs before more work is scheduled. Already-started workers still clean up and checkpoint, and the first sanitized failure remains primary.

Mixed capture additionally requires `--browser-control <metadata.json>` with `--app-manifest`, recording the metadata file SHA256. Its declared scope begins before the first application IO and ends at the existing finite-settlement boundary. The actual four browser contexts must belong to the registered native identities. Mixed registration requires independently read `--head-app-manifest` and `--head-browser-control`; ordinary budget derivation requires `--release-app-manifest`. Only the declared compiled manifest/file identities differ between independently verified phases. Browser revision, cache mode and control policy must match.

This is a prospective observer change, not a completed baseline or budget proof. Historical captures and prototype receipts retain their original verdicts. Observation windows (original90s, optimized30s), shared pool10/acquisition60s, workload, native and transport caps, raw metrics and numerical policy9 formulas are unchanged. No production application or dependency inputs changed.
