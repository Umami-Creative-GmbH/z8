/* @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRowMemoization } from "./virtualized-table";

describe("useRowMemoization", () => {
	it("does not keep reporting unchanged rows as changed", async () => {
		const data = [{ id: "row-1", version: 1 }];
		const { result } = renderHook(() =>
			useRowMemoization(
				data,
				(row) => row.id,
				(row) => row.version,
			),
		);

		await waitFor(() => expect(result.current.changedRows.size).toBe(0));
	});
});
