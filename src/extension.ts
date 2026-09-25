import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';

const VIEW_TYPE = 'audioQuickPlay.player';

/** Fallback decoder for containers the VS Code webview cannot play (e.g. .wma). */
const BACKGROUND_EXTENSIONS = new Set(['.wma']);

let backgroundPlayer: ChildProcess | undefined;
let backgroundPath: string | undefined;

const openPanels = new Set<vscode.WebviewPanel>();

function stopBackgroundPlayer(): void {
	if (backgroundPlayer && !backgroundPlayer.killed) {
		backgroundPlayer.kill();
	}
	backgroundPlayer = undefined;
	backgroundPath = undefined;
}

function startBackgroundPlayer(filePath: string): void {
	stopBackgroundPlayer();
	const escapedPath = filePath.replace(/'/g, "''");
	const script = [
		'Add-Type -AssemblyName PresentationCore',
		'$player = New-Object System.Windows.Media.MediaPlayer',
		"$player.Open([Uri]'" + escapedPath + "')",
		'Start-Sleep -Milliseconds 300',
		'$player.Play()',
		'while ($player.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep -Milliseconds 50 }',
		'while ($player.Position -lt $player.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 100 }',
		'$player.Close()'
	].join('; ');

	backgroundPath = filePath;
	backgroundPlayer = spawn(
		'powershell.exe',
		['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
		{ windowsHide: true, stdio: 'ignore' }
	);
	backgroundPlayer.on('exit', () => {
		backgroundPlayer = undefined;
		if (backgroundPath === filePath) backgroundPath = undefined;
	});
}

function pauseOtherPanels(keep: vscode.WebviewPanel): void {
	for (const panel of openPanels) {
		if (panel !== keep) {
			panel.webview.postMessage({ type: 'pause' }).then(undefined, () => { /* panel may be disposed */ });
		}
	}
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	return out;
}

class AudioPlayerEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => { /* nothing to dispose */ } };
	}

	resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): void {
		openPanels.add(webviewPanel);

		// Starting a new file stops whatever was playing before (background fallback).
		if (backgroundPath !== document.uri.fsPath) {
			stopBackgroundPlayer();
		}
		// Only one file should be audible at a time.
		pauseOtherPanels(webviewPanel);

		const webview = webviewPanel.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.dirname(document.uri.fsPath))]
		};
		webview.html = this.getHtml(webview, document);

		const messageSubscription = webview.onDidReceiveMessage((message) => {
			if (message?.type === 'unsupported') {
				// Chromium cannot decode this container (e.g. WMA): hand it to Windows audio.
				if (BACKGROUND_EXTENSIONS.has(path.extname(document.uri.fsPath).toLowerCase())) {
					startBackgroundPlayer(document.uri.fsPath);
				}
			} else if (message?.type === 'stopped' && backgroundPath === document.uri.fsPath) {
				stopBackgroundPlayer();
			}
		});

		webviewPanel.onDidDispose(() => {
			messageSubscription.dispose();
			openPanels.delete(webviewPanel);
			if (backgroundPath === document.uri.fsPath) stopBackgroundPlayer();
		});
	}

	private getHtml(webview: vscode.Webview, document: vscode.CustomDocument): string {
		const nonce = createNonce();
		const audioUri = webview.asWebviewUri(document.uri);
		const fileName = path.basename(document.uri.fsPath);

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(fileName)}</title>
<style>
	:root { color-scheme: light dark; }
	html, body { height: 100%; }
	body {
		margin: 0;
		padding: 24px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 16px;
		background: var(--vscode-editor-background, #1f1f1f);
		color: var(--vscode-foreground, #cccccc);
		font-family: var(--vscode-font-family, system-ui, sans-serif);
		font-size: var(--vscode-font-size, 13px);
	}
	.player {
		width: min(640px, 100%);
		height: 48px;
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		width: min(640px, 100%);
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 60%;
	}
	.time {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}
	.status { opacity: 0.8; }
	.status.warn { color: var(--vscode-charts-yellow, #e5e510); opacity: 1; }
	.hint { opacity: 0.6; font-size: 12px; width: min(640px, 100%); }
</style>
</head>
<body>
	<audio id="player" class="player" controls autoplay preload="auto" src="${audioUri}"></audio>
	<div class="meta">
		<span class="name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
		<span id="status" class="status">Loading…</span>
		<span id="time" class="time">0:00 / --:--</span>
	</div>
	<div class="hint">Audio plays automatically. Close this tab to stop playback.</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const audio = document.getElementById('player');
		const statusEl = document.getElementById('status');
		const timeEl = document.getElementById('time');

		function setStatus(text, kind) {
			statusEl.textContent = text;
			statusEl.className = 'status' + (kind ? ' ' + kind : '');
		}

		function format(seconds) {
			if (!isFinite(seconds) || seconds < 0) return '--:--';
			const s = Math.floor(seconds);
			const m = Math.floor(s / 60);
			return m + ':' + String(s % 60).padStart(2, '0');
		}

		function renderTime() {
			timeEl.textContent = format(audio.currentTime) + ' / ' + format(audio.duration);
		}

		// Use the editor background to decide light/dark native controls.
		try {
			const bg = getComputedStyle(document.body).backgroundColor;
			const match = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
			if (match) {
				const [r, g, b] = [1, 2, 3].map(i => Number(match[i]));
				const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
				document.documentElement.style.colorScheme = luminance > 0.5 ? 'light' : 'dark';
			}
		} catch (e) { /* keep default */ }

		audio.addEventListener('loadedmetadata', () => { renderTime(); setStatus('Ready'); });
		audio.addEventListener('timeupdate', renderTime);
		audio.addEventListener('playing', () => setStatus('Playing'));
		audio.addEventListener('pause', () => { if (!audio.ended) setStatus('Paused'); });
		audio.addEventListener('ended', () => setStatus('Ended'));
		audio.addEventListener('waiting', () => setStatus('Buffering…'));
		audio.addEventListener('error', () => {
			setStatus('Format not supported here — playing through Windows audio instead', 'warn');
			vscode.postMessage({ type: 'unsupported' });
		});
		vscode.window.addEventListener('message', (event) => {
			if (event.data && event.data.type === 'pause') {
				audio.pause();
			} else if (event.data && event.data.type === 'stop') {
				audio.pause();
				audio.currentTime = 0;
				vscode.postMessage({ type: 'stopped' });
			}
		});

		const attempt = audio.play();
		if (attempt && typeof attempt.then === 'function') {
			attempt.then(
				() => setStatus('Playing'),
				(err) => setStatus('Autoplay blocked — press play (' + (err && err.message ? err.message : err) + ')', 'warn')
			);
		}
	</script>
</body>
</html>`;
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new AudioPlayerEditorProvider();

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false
		}),
		vscode.commands.registerCommand('audioQuickPlay.stop', () => {
			stopBackgroundPlayer();
			for (const panel of openPanels) {
				panel.webview.postMessage({ type: 'stop' }).then(undefined, () => { /* panel may be disposed */ });
			}
		})
	);
}

export function deactivate(): void {
	stopBackgroundPlayer();
	openPanels.clear();
}
