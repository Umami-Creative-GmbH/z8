import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";

/**
 * Drag and drop for Schedule-X 4. The open-source `@schedule-x/drag-and-drop` stopped at 3.7.3;
 * for v4 it moved to the licensed `@sx-premium/drag-and-drop`. Calendar 4 still calls the same
 * handlers with the same arguments, only renamed from `create…DragHandler` to `start…Drag`, so
 * this exposes 3.7.3's handlers under the new names. The unit test fails if a calendar upgrade
 * calls the plugin differently.
 */
export function createScheduleXDragAndDropPlugin(minutesPerInterval = 15) {
	const plugin = createDragAndDropPlugin(minutesPerInterval);
	return Object.assign(plugin, {
		startTimeGridDrag: plugin.createTimeGridDragHandler.bind(plugin),
		startDateGridDrag: plugin.createDateGridDragHandler.bind(plugin),
		startMonthGridDrag: plugin.createMonthGridDragHandler.bind(plugin),
	});
}
