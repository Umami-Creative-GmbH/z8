# Mixed annual capture stage diagnostic

This diagnostic records at most three fixed actor/reader rows at the existing
mixed annual-capture boundaries. It distinguishes page/identity/annual-selection,
response-text retrieval, public-result parsing and fixed-summary checks. Only
finite nullable scalar status/count fields, booleans, fixed enums and whitelisted
exception names survive; payloads, requests, action IDs, messages, stacks and
causes are never retained. Missing facts stay null or not-reached.

The original request listener/predicate, awaits, single text retrieval, parser,
business summary, short-circuit checks, returned value and thrown exception are
preserved. The new response.status() read is local Puppeteer metadata only. No
fallback, retry, decode, wait, request, deadline, cap, workload or acceptance gate
changes. Both phases use the same diagnostic. The failed1620 capture remains
failed; its unrecorded exception stage is not inferred retroactively.

Pure tests execute the actual capture function in a mock context and verify await
order, text-error identity, malformed/incorrect summaries and privacy. A fresh
Root-owned run is required to identify the actual failing stage.
