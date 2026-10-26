# Cached CDP text forward projection

`scripts/performance/cdp-cached-text-projection.mjs` is pure diagnostic math observed at naturally completed proxy bodies. It forward-projects bounded original bytes using the Windows-1252 byte-to-code-unit table at Chromium revision `d0c02bfad08ec92a6ffcf989e53cd995e6381a4c`. It does not decode or reconstruct browser bytes and does not prove browser/cache/Native eligibility.

`projectCachedCdpText(originalBuffer)` returns only:

```text
protocol, sourceRevision, mappingSha256,
originalBytes, originalSha256, outputCodeUnits, utf8Bytes, utf8Sha256
```

`originalBytes` is the input byte count, not retained payload. `outputCodeUnits` counts the projected UTF-16 code units; `utf8Bytes`/`utf8Sha256` describe that projected string encoded as UTF-8. No raw bytes, strings, cookie values, URL, or eligible/clean boolean are returned. The input is neither copied nor mutated. The caller must not concurrently mutate it.

The function rejects non-Buffer/shared-memory inputs, UTF-8/UTF-16 BOM prefixes, input above 8 MiB, and projected UTF-8 output above 8 MiB. Empty input yields empty mathematical digests; it does not prove a valid Flight body. Explicit encoding workspace is one 32 KiB chunk and a 512-byte mapping table, plus small hash state; no complete projected body or string is allocated. Existing aggregate retention limits remain caller obligations.

`validateCachedCdpTextProjection(facts, originalBuffer)` checks the exact schema and recomputes every fact against the still-available bounded original. Missing original, extra fields, accessors, altered facts, and invalid input fail validation. Persisted facts alone do not establish their content or event provenance.

The mapping SHA-256 is over the 256 code units in byte order, each encoded as unsigned 16-bit big-endian, with no prefix or separators: `5f883b3909ed608b74067ebb03d75c351259da8f44d13a119c25e5b53fbf9756`. C1 uses Windows-1252 (80→U+20AC, 81→U+0081); Node Latin-1 would be incorrect. Fixed full-corpus and mojibake test digests independently match the platform Windows-1252 decoder. No normalization is performed.

Source: [pinned TextCodecLatin1 table/registration/Decode](https://github.com/chromium/chromium/blob/d0c02bfad08ec92a6ffcf989e53cd995e6381a4c/third_party/blink/renderer/platform/wtf/text/text_codec_latin1.cc). [Pinned page-agent decoder selection](https://github.com/chromium/chromium/blob/d0c02bfad08ec92a6ffcf989e53cd995e6381a4c/third_party/blink/renderer/core/inspector/inspector_page_agent.cc#L263) selects ISO-8859-1, an alias of Windows-1252, for plain text absent a charset; supplied encoding and BOM handling can select a different path. This helper intentionally supports only the non-BOM mapping, not every path of the browser decoder.

Before using a projection match as equality evidence, a caller must independently prove the exact actual decoder path/charset and browser revision; complete browser `dataLength` total N = original EOF byte count = actual CDP UTF-16 string length; non-BOM/injective domain; unique cache variant/origin-response identity; principal and complete EOF/body provenance; actual CDP projected-string digest/length correspondence; and the required original Flight framing/type/E/error checks. All existing browser, semantic, resource, Native, byte, aggregate, and deadline gates remain unchanged. This module establishes none of those facts. No existing mismatched capture is requalified.

```powershell
pnpm --config.verifyDepsBeforeRun=false node --test scripts/performance/cdp-cached-text-projection.test.mjs
```

The collector records this bounded forward projection under transportBodyReceipt.cdpTextProjection only after actual proxy EOF and decoding, before discarding the original bytes. Unsupported BOMs or projection limits produce an explicit unavailable reason. The helper retains no body or projected string and adds no reads or waits. All four operator source closures include the helper. Existing independent CDP code-unit length, dataLength and readback mode remain separate. The actual effective CDP response MIME and charset have their own known flags, fixed enums and Network.responseReceived provenance, distinct from parsed HTTP Content-Type headers. Missing or unsupported effective decoder metadata remains unknown; the projection alone is not a browser byte proof.

The qualified Native segment classifier may use the forward-image facts only within its separately validated cached-byte correspondence certificate. It requires the full independent final browser data ledger, decoder-domain premises, original/current natural EOF and required Flight proof, unique request identities and all existing source/principal/variant authority. Raw CDP text parsing stays separate and may remain UNKNOWN. The exact-byte branch remains available; neither branch clears a positive error or admits NoExtra, canceled-current or unsupported route-tree requests.
