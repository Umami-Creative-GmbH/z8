# AVV fonts

These unmodified static TrueType fonts are served by Z8 itself. They are fetched
only when exporting an AVV and embedded as subsets; no font service is contacted.
Noto Sans covers Latin, Greek and Cyrillic. Droid Sans Fallback adds Chinese and
Japanese characters. This is a bounded font set, not full Unicode coverage.
The exporter checks every supplied character and refuses an unsupported export
with its Unicode code points instead of dropping or transliterating legal data.
Profile validation and saved values are unaffected. Add a licensed font and an
export/render regression when extending script coverage.

## Sources and licenses

- `NotoSans-Regular.ttf`: [Noto fonts](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf),
  SIL Open Font License 1.1, reproduced in `OFL-NotoSans.txt`.
  SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.
- `DroidSansFallbackFull.ttf`: [Android Open Source Project](https://android.googlesource.com/platform/frameworks/base/+/9bae0c864c214d2b2856ab607881af07f049d3de/data/fonts/DroidSansFallbackFull.ttf),
  Apache License 2.0; upstream copyright notice and full license reproduced in
  `NOTICE-DroidSans.txt` from the same revision's `data/fonts/NOTICE`.
  SHA-256: `2392015530438bafc48edfc4aee6d9de2387f627a6134d8ab3dfcc99d21c8240`.
