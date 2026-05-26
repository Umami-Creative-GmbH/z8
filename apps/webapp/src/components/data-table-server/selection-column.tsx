import type { ColumnDef } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";

function createSelectionColumn<TData>(labels?: {
	selectAll?: string;
	selectRow?: string;
}): ColumnDef<TData> {
	return {
		id: "select",
		header: ({ table }) => (
			<div className="flex items-center justify-center">
				<Checkbox
					checked={
						table.getIsAllPageRowsSelected() ||
						(table.getIsSomePageRowsSelected() && "indeterminate")
					}
					onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
					aria-label={labels?.selectAll ?? ["Select", "all"].join(" ")}
				/>
			</div>
		),
		cell: ({ row }) => (
			<div className="flex items-center justify-center">
				<Checkbox
					checked={row.getIsSelected()}
					onCheckedChange={(value) => row.toggleSelected(!!value)}
					aria-label={labels?.selectRow ?? ["Select", "row"].join(" ")}
				/>
			</div>
		),
		enableSorting: false,
		enableHiding: false,
	};
}

export { createSelectionColumn };
