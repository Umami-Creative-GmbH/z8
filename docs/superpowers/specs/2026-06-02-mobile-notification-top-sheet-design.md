# Mobile Notification Top Sheet Design

## Context

The notification bell currently opens a fixed-width popover. That works on desktop but is awkward on mobile, where a floating popover can be cramped and poorly positioned.

## Design

Keep the desktop notification popover unchanged at `md` and larger breakpoints. On mobile, tapping the notification bell opens a sheet that slides down from the top. The sheet reuses the same notification header, action buttons, notification list, settings link, and view-all footer as the desktop popover.

The mobile sheet should be full width, capped to the viewport height, and hide overflow at the container level so the notification list remains the scrollable content area. The bell trigger remains visually unchanged.

## Behavior

Opening either surface enables notification loading for the active organization. Closing the sheet or popover uses the same close path, including when users navigate to notification settings or all notifications. Mark-as-read, mark-all-read, delete, and delete-all behavior remain unchanged.

## Testing

Verify the implementation preserves desktop popover behavior and renders a top sheet for mobile breakpoints. At minimum, run the relevant TypeScript/lint or test target available for the webapp after the component change.
