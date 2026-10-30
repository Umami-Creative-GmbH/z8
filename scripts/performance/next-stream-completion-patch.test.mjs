import assert from "node:assert/strict";
import test from "node:test";
import {
  nextStreamCompletionPatch,
  isNextStreamCompletionPatch,
  matchingNextStreamCompletionPatch,
} from "./next-stream-completion-patch.mjs";

test("one canonical five-field Next condition rejects every missing, changed or extra field", () => {
  assert.equal(isNextStreamCompletionPatch(nextStreamCompletionPatch), true);
  assert.equal(
    isNextStreamCompletionPatch(
      Object.fromEntries(Object.entries(nextStreamCompletionPatch).reverse()),
    ),
    true,
    "JSON property order does not change the common runtime",
  );
  for (const key of Object.keys(nextStreamCompletionPatch)) {
    const missing = { ...nextStreamCompletionPatch };
    delete missing[key];
    assert.equal(isNextStreamCompletionPatch(missing), false);
    const changed = { ...nextStreamCompletionPatch, [key]: "unknown" };
    assert.equal(isNextStreamCompletionPatch(changed), false);
    assert.equal(
      matchingNextStreamCompletionPatch(changed, changed),
      false,
      "Matching unknown values do not qualify.",
    );
    assert.equal(
      matchingNextStreamCompletionPatch(nextStreamCompletionPatch, changed),
      false,
    );
  }
  for (const value of [
    null,
    undefined,
    [],
    {},
    { ...nextStreamCompletionPatch, extra: true },
  ])
    assert.equal(isNextStreamCompletionPatch(value), false);
});
