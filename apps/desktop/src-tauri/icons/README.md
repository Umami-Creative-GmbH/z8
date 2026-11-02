# z8 Timer icons

The app icon is the z8 brand mark: the white z8 glyph on brand blue (#3860c6),
matching the web app's favicons and PWA icons.
The tray uses a clock in gray when clocked out and green when working.

The sources are app-icon.png (rounded square, desktop default),
app-icon-android-fg.png and app-icon-android-bg.png (adaptive layers), tied
together by app-icon.json. Generate app assets with:

~~~powershell
pnpm --filter desktop tauri icon src-tauri/icons/app-icon.json
~~~

Tray icons are 32 × 32 PNGs with a transparent background, white clock face and
hands, and a gray (#9ca3af) or green (#22c55e) circular background. Keep the
clock shape readable at the Windows tray's 16 × 16 display size.
