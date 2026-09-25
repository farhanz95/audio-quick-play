import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma'
]);

let player: ChildProcess | undefined;
let lastAudioPath: string | undefined;

function isAudio(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function stopPlayer(): void {
  if (player && !player.killed) player.kill();
  player = undefined;
}

function playWindowsAudio(filePath: string): void {
  stopPlayer();
  const escapedPath = filePath.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName PresentationCore',
    '$player = New-Object System.Windows.Media.MediaPlayer',
    "$player.Open([Uri]'"+escapedPath+"')",
    'Start-Sleep -Milliseconds 300',
    '$player.Play()',
    'while ($player.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep -Milliseconds 50 }',
    'while ($player.Position -lt $player.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 100 }',
    '$player.Close()'
  ].join('; ');

  player = spawn(
    'powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-Command',script],
    { windowsHide: true, stdio: 'ignore' }
  );
  player.on('exit', () => { player = undefined; });
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('audioQuickPlay.stop', stopPlayer),
    vscode.workspace.onDidOpenTextDocument((document) => {
      const filePath = document.uri.fsPath;
      if (!isAudio(filePath) || filePath === lastAudioPath) return;
      lastAudioPath = filePath;
      playWindowsAudio(filePath);
      setTimeout(() => {
        if (lastAudioPath === filePath) lastAudioPath = undefined;
      }, 750);
    })
  );
}

export function deactivate(): void {
  stopPlayer();
}
