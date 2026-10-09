# z8 Timer icons

The app icon is a white Tabler-style clock on the existing blue background.
The tray uses the same clock in gray when clocked out and green when working.

The source is app-icon.svg. Generate app assets with:

~~~powershell
pnpm --filter desktop tauri icon src-tauri/icons/app-icon.svg
~~~

Tray icons are 32 × 32 PNGs with a transparent background, white clock face and
hands, and a gray (#9ca3af) or green (#22c55e) circular background. Keep the
clock shape readable at the Windows tray's 16 × 16 display size.
