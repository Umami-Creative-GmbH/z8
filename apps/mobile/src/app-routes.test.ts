import { existsSync } from "node:fs";
import path from "node:path";

describe("mobile app routes", () => {
  it("includes the sign-in route used by the root redirect", () => {
    expect(
      existsSync(path.resolve(__dirname, "../app/sign-in.tsx")),
    ).toBe(true);
  });
});
