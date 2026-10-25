import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const primaryFiles = [
  "run-baseline.mjs",
  "clean-evidence.mjs",
  "action-result-observer.mjs",
  "next-stream-completion-patch.mjs",
  "primary-context-cleanup.mjs",
  "prerequisite-quiescence.mjs",
  "operator-reload-quiescence.mjs",
  "browser-performance.mjs",
  "journey-steps.mjs",
  "collector-client.mjs",
  "trace-transport.mjs",
  "proxy-wire-observer.mjs",
  "fixture-browser.mjs",
  "protocol-fingerprints.mjs",
];
async function fingerprints(files) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(new URL(name, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  );
}
export const primaryProtocolIdentity = () => fingerprints(primaryFiles);
export const companionProtocolIdentity = () =>
  fingerprints([
    "settled-resources.mjs",
    "clean-evidence.mjs",
    "action-result-observer.mjs",
    "settled-resource-observer.mjs",
    "journey-steps.mjs",
    "run-baseline.mjs",
    "next-stream-completion-patch.mjs",
    "primary-context-cleanup.mjs",
    "prerequisite-quiescence.mjs",
    "operator-reload-quiescence.mjs",
    "collector-client.mjs",
    "trace-transport.mjs",
    "proxy-wire-observer.mjs",
    "fixture-browser.mjs",
    "browser-performance.mjs",
    "protocol-fingerprints.mjs",
    "../../docs/performance/evidence/1450-telemetry-functional-diagnostics.json",
    "../../docs/performance/evidence/1450-observer-v4-before-proof.json",
    "../../docs/performance/evidence/1450-observer-v8-before-proof.json",
    "../../docs/performance/evidence/1450-next-stream-fixed-before-proof.json",
  ]);
export const budgetProtocolIdentity = () =>
  fingerprints([
    ...primaryFiles,
    "release-budgets.mjs",
    "settled-resources.mjs",
    "settled-resource-observer.mjs",
    "../../docs/performance/evidence/1450-telemetry-functional-diagnostics.json",
    "../../docs/performance/evidence/1450-native-paint-and-link-diagnostics.json",
    "../../docs/performance/evidence/1450-observer-v4-before-proof.json",
    "../../docs/performance/evidence/1450-observer-v8-before-proof.json",
    "../../docs/performance/evidence/1450-next-stream-fixed-before-proof.json",
  ]);
