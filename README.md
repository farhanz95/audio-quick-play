# Audio Quick Play for VS Code

Double-click an audio file in the VS Code Explorer and it plays immediately — no
extra click on a play button.

Supported: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.

## What it does

VS Code's built-in media preview opens audio files in a tab that only plays when
you press its play button. This extension registers its own editor
(`audioQuickPlay.player`) for audio file types and maps those types to it via
`workbench.editorAssociations`, so the double-clicked file opens in a player tab
that starts playing on its own:

- `<audio autoplay controls>` in the webview — pause button and seek bar included.
- Closing the tab stops playback. Only one file plays at a time; opening another
  file pauses the previous one.
- `.wma` (and anything else Chromium cannot decode) falls back to Windows audio
  (`MediaPlayer` via a hidden PowerShell process) and the tab shows that it is
  playing in the background. The fallback stops when the tab closes.

Stop everything at once with the Explorer context menu: **Audio Quick Play: Stop**.

## Requirements
- Windows
- VS Code 1.90+
- PowerShell (only used for the `.wma` fallback)

## Notes
- The extension contributes a default `workbench.editorAssociations` mapping for
  the audio extensions above. If your user `settings.json` already sets
  `workbench.editorAssociations`, your value wins — point the audio globs at
  `audioQuickPlay.player` to get the behaviour above.
- VS Code's own audio preview keeps handling anything not listed above.

## Build
```bash
npm install
npm run compile
npm run package
```

Install the generated `.vsix` using **Extensions → ... → Install from VSIX**.

## License
MIT
