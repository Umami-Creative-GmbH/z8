import assert from "node:assert/strict";
import test from "node:test";
import { selectWorkRecordsSuites, trackedWebAppFiles } from "./work-records-suites.mjs";

const actions = "apps/webapp/src/app/[locale]/(app)/time-tracking/actions";
const callerSuites = [
  "apps/webapp/src/lib/time-tracking/work-records/work-records.integration.test.ts",
  `${actions}/work-period-amendment.integration.test.ts`,
  `${actions}/work-billability-amendment.integration.test.ts`,
  `${actions}/work-period-split.integration.test.ts`,
  `${actions}/clocking.automatic-break.integration.test.ts`,
  `${actions}/clocking.policy-break-split.integration.test.ts`,
  `${actions}/correction-lifecycle.integration.test.ts`,
  "apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts",
  "apps/webapp/src/lib/effect/services/break-enforcement.integration.test.ts",
  "apps/webapp/src/lib/import-review/reviewed-import-operation.integration.test.ts",
  "apps/webapp/src/lib/demo/demo-work.integration.test.ts",
  "apps/webapp/src/lib/time-tracking/historical-work-proposals.integration.test.ts",
  "apps/webapp/src/lib/time-tracking/historical-gap-repair.integration.test.ts",
  "apps/webapp/src/lib/time-tracking/vehicle-use/clock-out-completion.integration.test.ts",
];
const relative = file => file.replace(/^apps\/webapp\//, "");

test("selects the work records and completed-work caller suites as paths the web-app runner accepts", () => {
  const files = [...callerSuites, "apps/webapp/src/lib/absences/deputy.integration.test.ts"];
  assert.deepEqual(selectWorkRecordsSuites(files), callerSuites.map(relative).sort());
});

test("later work records suites and split caller suites are picked up without listing them", () => {
  const later = [
    "apps/webapp/src/lib/time-tracking/work-records/divide.integration.test.ts",
    "apps/webapp/src/lib/time-tracking/work-records/contract/amend.append.integration.test.ts",
    `${actions}/work-period-split.legacy.integration.test.ts`,
  ];
  const ignored = [
    "apps/webapp/src/lib/time-tracking/work-records/plan.test.ts",
    "apps/webapp/src/lib/time-tracking/work-records-report.integration.test.ts",
    `${actions}/work-period-split.test.ts`,
    `${actions}/nested/work-period-split.integration.test.ts`,
    `apps/webapp/src/app/x/(app)/time-tracking/actions/work-period-split.integration.test.ts`,
  ];
  assert.deepEqual(selectWorkRecordsSuites([...callerSuites, ...ignored, ...later]), [...callerSuites, ...later].map(relative).sort());
});

test("a renamed or moved caller suite fails the selection instead of silently dropping coverage", () => {
  for (const missing of callerSuites) {
    const name = missing.split("/").pop().replace(".integration.test.ts", "");
    assert.throws(() => selectWorkRecordsSuites(callerSuites.filter(file => file !== missing)), new RegExp(name.replace(/\./g, "\\.")));
  }
});

test("every pattern matches a suite in this repository", () => {
  const selected = selectWorkRecordsSuites(trackedWebAppFiles());
  for (const suite of callerSuites) assert.ok(selected.includes(relative(suite)), suite);
});
