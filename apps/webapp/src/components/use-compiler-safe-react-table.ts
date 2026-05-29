import {
	createTable,
	type RowData,
	type TableOptions,
	type TableOptionsResolved,
} from "@tanstack/react-table";
import * as React from "react";

export function useCompilerSafeReactTable<TData extends RowData>(
	options: TableOptions<TData>,
) {
	const resolvedOptions: TableOptionsResolved<TData> = {
		state: {},
		onStateChange: () => {},
		renderFallbackValue: null,
		...options,
	};

	const [table] = React.useState(() => createTable<TData>(resolvedOptions));

	const [state, setState] = React.useState(() => table.initialState);

	table.setOptions((prev) => ({
		...prev,
		...options,
		state: {
			...state,
			...options.state,
		},
		onStateChange: (updater) => {
			setState(updater);
			options.onStateChange?.(updater);
		},
	}));

	return table;
}
