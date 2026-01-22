# z8 Timer Icons

This folder contains icons for the z8 Timer desktop application.

## Required Icons

### App Icons (for installer/taskbar)
- `icon.ico` - Windows ICO format (256x256, 128x128, 64x64, 48x48, 32x32, 16x16)
- `icon.icns` - macOS ICNS format
- `32x32.png` - 32x32 PNG
- `128x128.png` - 128x128 PNG
- `128x128@2x.png` - 256x256 PNG (2x scale)

### Tray Icons
- `tray-gray.png` - 32x32 PNG, gray clock icon (clocked out state)
- `tray-green.png` - 32x32 PNG, green clock icon (clocked in state)

## Creating Icons

### Using Tauri Icon Generator
```bash
pnpm tauri icon path/to/source-icon.png
```

### Tray Icon Design Guidelines
- Size: 32x32 pixels
- Format: PNG with transparency
- Colors:
  - Gray: #9CA3AF (clocked out)
  - Green: #22C55E (clocked in)
- Design: Simple clock or timer symbol

### Placeholder Generation
For development, you can use ImageMagick to create placeholder icons:

```bash
# Gray tray icon
convert -size 32x32 xc:transparent -fill "#9CA3AF" -draw "circle 16,16 16,4" tray-gray.png

# Green tray icon
convert -size 32x32 xc:transparent -fill "#22C55E" -draw "circle 16,16 16,4" tray-green.png
```

Or use any icon editor to create 32x32 PNG files with transparent backgrounds.
