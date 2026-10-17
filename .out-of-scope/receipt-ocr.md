# Receipt OCR suggestions

Receipt OCR suggestions for draft expense items are out of scope. The maintainer rejected #1304 on 2026-10-17 because the expected server resource and operating cost outweigh the feature's usefulness.

## Why this is out of scope

The proposal would extract candidate descriptions, expense dates, amounts and currencies from uploaded receipt documents for employees to review. It would also flag possible duplicate receipts. Reducing manual entry does not justify the additional server processing and operating cost for this feature in Z8.

This is a product scope decision, not an approved feature waiting for implementation. No OCR processor, background extraction pipeline or duplicate-detection service should be added for this proposal. Future requests for the same capability should reference this decision rather than treating it as an unreviewed feature gap.

## Existing workflow

Employees can upload or photograph receipt documents and enter the expense item details manually in draft expense reports. The travel expense guide explicitly lists receipt text recognition (OCR) as unsupported. Receipt capture, manual draft entry and supporting documents added after submission (#1254) are separate from this rejected proposal.

## Prior requests

- [#1304: Travel expenses: prefill draft receipt items with reviewed OCR suggestions](https://github.com/Umami-Creative-GmbH/z8/issues/1304)
