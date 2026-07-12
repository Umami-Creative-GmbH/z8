# Telegram Digest Test Stability

## Problem

The first `daily-digest.test.ts` case performs dynamic imports of the mocked database and production module inside the five-second Vitest test timeout. It takes about 2.36 seconds in isolation and exceeded five seconds when the full 719-file webapp suite was under transform and CPU contention. The same concurrency behavior passes when rerun alone.

## Design

Import the mocked `db` object and `processTelegramBotDigest` statically at file scope. Vitest hoists the existing `vi.mock` declarations before imports are evaluated, so both imports continue to receive mocked dependencies. Remove the repeated dynamic imports from all five cases.

This moves module transformation and evaluation into test-file loading, outside individual test timeouts, without increasing timeout limits or changing production behavior.

## Alternatives Considered

- Import the modules once in `beforeAll`. This avoids per-test imports but requires mutable setup variables and hook orchestration.
- Increase the test timeout. This masks avoidable module-loading cost and remains sensitive to sufficiently heavy suite contention.

## Verification

- Run the Telegram digest test with the verbose reporter and confirm the concurrency case no longer carries the module-import delay.
- Run the test repeatedly to exercise stability.
- Run the complete webapp suite and confirm the previous Telegram timeout does not recur.

