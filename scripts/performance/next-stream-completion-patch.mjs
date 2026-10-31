/** Common maintained runtime condition; never a timing or native-coverage waiver. */
export const nextStreamCompletionPatch = Object.freeze({
  nextVersion: "16.4.3",
  patchSha256:
    "0e7fd3eef6034e754a9ef87ad3887b564baf544dce77b046c6f4b805a51b7558",
  lockSha256:
    "ca09eedb38131207b4a780c00c6dca4238743036a41560c8d4868cab38f8b9b8",
  cjsSha256: "13d6b042e0a52e8845a7c04086515418a26bb45eec00fca2ea2b728ecc2aad4e",
  esmSha256: "098cae63c84dad74f95b1121981cb04dfb71b8ee9614e547de853a693332bf81",
});

export function isNextStreamCompletionPatch(value) {
  const keys = Object.keys(nextStreamCompletionPatch);
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        value[key] === nextStreamCompletionPatch[key],
    )
  );
}

/** Both sides must match the one admitted condition; equal unknown values fail. */
export function matchingNextStreamCompletionPatch(expected, observed) {
  return (
    isNextStreamCompletionPatch(expected) &&
    isNextStreamCompletionPatch(observed)
  );
}
