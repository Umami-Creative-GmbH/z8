# Unwired DateRange request descriptor

This pure module parses a bounded synthetic/request buffer. It is not imported
by the collector, Flight parser or an operator. It supplies no source, action,
request EOF, client temporary-map, cancellation or `$T` authority. Existing T
failures and all previously captured observations remain unchanged.

parseInertDateRangeRequest requires exactly one JSON object argument with the
five decoded own field names start/end/startDate/endDate/timezone. A small scanner
establishes duplicate absence before creating a descriptor; JSON.parse is used
only for individual bounded string tokens, never an object that could discard
duplicates. Extra/missing/prototype-sensitive keys, extra arguments, unsupported
value types, trailing data, invalid UTF-8 and unpaired Unicode surrogates reject.

Input is at most 16 KiB, grammar depth two, punctuation 32 and work 65,536. The raw
buffer cannot use shared memory. No DateRange business calculation is performed:
start/end must be canonical external React `$D` ISO encodings; the other fields
are literal strings, with React `$$` decoded to a literal leading dollar. Other
dollar-prefixed tokens reject. No calendar range order, date-only text format or
IANA timezone is inferred or normalized.

The frozen public descriptor contains fixed facts, byte/work counts and digests,
with sourceBound=false/requestEOFClaim=false/acceptanceClaim=none. Its immutable
Date/literal-string nodes live only in a private weak association. The explicit
readInertDateRangeRequestValue accessor is for RAM-only future semantic traversal;
it is not a request capability. Copied or deserialized public facts cannot recover
the value. Never persist that private value or treat decoded literal text such
as `$L9` as a protocol reference; the inert kind preserves the distinction.

## Inputs still required before wiring or admission

- Independently qualified per-phase app/build/manifest/action-registry and finite
  caller/Next/React/queue/intrinsics source closure. Draft source-facts files are
  not authority. UI client-map and manual server-request-value producers remain
  distinct; matching request bytes cannot identify which regime produced them.
- Actual request-local action/key/context/document/proxy/CDP joins, complete fresh
  incoming request EOF and exact length/hash. Parsing a supplied buffer cannot
  establish transport EOF or client-map lifetime.
- Reservation BEFORE decode/parse and for the ENTIRE private-value lifetime in
  the existing 32 MiB pool. Do not free the parse reservation while retaining its
  new value or assume the existing 2 KiB metadata reservation covers arbitrary
  decoded strings. Existing encoded/decoded/model/depth limits still apply.
- A reviewed adapter that walks tagged inert values under every original incoming
  semantic role and typed obligation with actual shared work/depth/global-error
  accounting. No target-property exemption or arbitrary token/path resolver.
- Portable source/request/descriptor replay facts for final validation. Neither
  an opaque descriptor nor a WeakMap-membership boolean proves eligibility.

Tests use synthetic bytes only. Run the new test file explicitly while this
module remains unwired; add its transitive fingerprints/test registration only
when a separately reviewed operator actually imports it. No app input changed.
