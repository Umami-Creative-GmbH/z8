import { afterAll, afterEach } from "vitest";
import { assertNoUnitProjectDatabaseRefusals } from "@/db/unit-project-guard";

// The unit project's setupFiles. A refused PostgreSQL connection fails the test
// that caused it, even when the code under test caught and swallowed the error.
afterEach(assertNoUnitProjectDatabaseRefusals);
afterAll(assertNoUnitProjectDatabaseRefusals);
