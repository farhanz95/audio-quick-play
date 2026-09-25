# Audio Quick Play for VS Code

Play audio files from the VS Code Explorer without an audio player tab.

Double-click a supported audio file and the extension starts background playback through Windows audio.

Supported: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.

## Requirements
- Windows
- VS Code 1.90+
- PowerShell

## Limitation
VS Code's public extension API does not expose a direct hook to replace the Explorer's native double-click command. This extension listens for audio documents being opened and starts background playback, so exact Explorer behavior depends on VS Code media-preview handling.

## Build
```bash
npm install
npm run compile
npm run package
```

Install the generated `.vsix` using **Extensions → ... → Install from VSIX**.

## License
MIT
