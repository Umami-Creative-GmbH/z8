/**
 * The surface every form field shares: background, border, radius, shadow, focus ring and
 * invalid state. `Input`, `SelectTrigger` and the popover picker triggers all build on it, so a
 * picker placed next to a text input cannot drift from it.
 */
const fieldSurfaceClassName =
	"rounded-md border border-input bg-card shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40";

/**
 * A button that opens a picker for a form field: `SelectTrigger`, and the `field` button variant
 * used by `DatePicker`, `TimezonePicker`, `SearchableSelect` and the employee select. An empty
 * trigger sets `data-placeholder` to get the placeholder colour.
 */
const fieldTriggerClassName = `${fieldSurfaceClassName} flex items-center justify-between gap-2 whitespace-nowrap px-3 py-2 font-normal text-sm disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[placeholder]:text-muted-foreground dark:hover:bg-input/50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0`;

export { fieldSurfaceClassName, fieldTriggerClassName };
