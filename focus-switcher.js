/**
 * Corsair Galleon 100 SD — focus-based profile switcher
 *
 * Automatically switches to a configured profile when a watched application
 * gains focus, and restores the previous profile when it loses focus.
 *
 * See README.md for setup and usage instructions.
 *
 * ─── CONFIGURATION ────────────────────────────────────────────────────────────
 */

const WATCHED_APPS = [
  { exe: "notepad.exe",    profile: 1 },
  { exe: "photoshop.exe",  profile: 2 },
  // Add as many apps as you like. Use the .exe name (case-insensitive).
  // To find the right name: open the app, then run in PowerShell:
  //   Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Name
];

const POLL_MS = 300; // how often to check the foreground window (milliseconds)

/** ─────────────────────────────────────────────────────────────────────────── */

"use strict";

const path = require("path");
const fs   = require("fs");

// ── Platform guard ────────────────────────────────────────────────────────────

if (process.platform !== "win32") {
  console.error("[ERROR] This script only runs on Windows.");
  process.exit(1);
}

// ── Locate the Corsair native addon ──────────────────────────────────────────

const ADDON_PATH = path.join(
  process.env.APPDATA,
  "Elgato", "StreamDeck", "Plugins",
  "com.corsair.ctrl.sdPlugin", "bin", "addons",
  "bragiWinService.node"
);

if (!fs.existsSync(ADDON_PATH)) {
  console.error(
    "[ERROR] Corsair Ctrl plugin addon not found.\n" +
    "        Make sure the Corsair Ctrl plugin is installed in Stream Deck.\n" +
    "        Expected path:\n        " + ADDON_PATH
  );
  process.exit(1);
}

let callAction, startDeviceWatcher, stopDeviceWatcher;
try {
  ({ callAction, startDeviceWatcher, stopDeviceWatcher } = require(ADDON_PATH));
} catch (err) {
  console.error("[ERROR] Failed to load Corsair native addon:", err.message);
  process.exit(1);
}

// ── Load koffi for Windows API ────────────────────────────────────────────────

let koffi;
try {
  koffi = require("koffi");
} catch (err) {
  console.error("[ERROR] Could not load koffi. Did you run 'npm install'?", err.message);
  process.exit(1);
}

const user32   = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

const GetForegroundWindow       = user32.func("void *GetForegroundWindow()");
const GetWindowThreadProcessId  = user32.func("uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)");
const OpenProcess               = kernel32.func("void *OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)");
const QueryFullProcessImageName = kernel32.func("bool QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ uint8 *lpExeName, _Inout_ uint32 *lpdwSize)");
const CloseHandle               = kernel32.func("bool CloseHandle(void *hObject)");

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function getForegroundExe() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;

  const pidOut = [0];
  GetWindowThreadProcessId(hwnd, pidOut);
  const pid = pidOut[0];
  if (!pid) return null;

  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return null;

  try {
    const buf  = Buffer.alloc(1024);
    const size = [512];
    const ok   = QueryFullProcessImageName(handle, 0, buf, size);
    if (!ok) return null;
    const exePath = buf.slice(0, size[0] * 2).toString("utf16le");
    return path.basename(exePath).toLowerCase();
  } finally {
    CloseHandle(handle);
  }
}

// ── Watched apps index (exe → profile, all lowercased) ────────────────────────

const watchedIndex = new Map(
  WATCHED_APPS.map(({ exe, profile }) => [exe.toLowerCase(), profile])
);

console.log(`[INFO] Watching ${watchedIndex.size} application(s):`);
for (const [exe, profile] of watchedIndex)
  console.log(`       ${exe} → profile ${profile}`);
console.log();

// ── Profile index normalisation (mirrors the Corsair plugin's own logic) ──────
// The device reports raw HID byte values that don't always equal 0-4 directly.

function normalizeProfileIndex(raw) {
  if (!Number.isFinite(raw)) return null;
  if (raw >= 0 && raw < 5)  return raw;       // already 0-indexed
  if (raw >= 1 && raw <= 5) return raw - 1;   // 1-indexed → 0-indexed
  return null;                                 // unexpected value, ignore
}

// ── State ─────────────────────────────────────────────────────────────────────

let deviceId       = null;  // set once the watcher finds the keyboard
let currentProfile = null;  // best-known current profile (our own tracking)
let savedProfile   = null;  // profile to restore when watched app loses focus
let focusedApp     = null;  // exe name of currently focused watched app, or null
let pollTimer      = null;
let switchPending  = false; // true while we triggered a switch (to filter our own config_changed events)

// ── Profile switching ─────────────────────────────────────────────────────────

function switchProfile(index, reason) {
  if (!deviceId) return;
  console.log(`[INFO] Switching to profile ${index} (${reason})`);
  switchPending  = true;
  currentProfile = index;
  callAction(deviceId, "select_profile", index);
  // Clear the pending flag after a short debounce
  setTimeout(() => { switchPending = false; }, 800);
}

// ── Device watcher ────────────────────────────────────────────────────────────

console.log("[INFO] Starting device watcher...");

startDeviceWatcher((event) => {
  if (event.eventType === "connected") {
    deviceId = event.deviceId;
    console.log(`[INFO] Keyboard connected: "${event.deviceName}"`);
    startPolling();
    return;
  }

  if (event.eventType === "disconnected") {
    console.log("[WARN] Keyboard disconnected.");
    stopPolling();
    deviceId      = null;
    focusedApp    = null;
    savedProfile  = null;
    currentProfile = null;
    return;
  }

  if (event.eventType === "config_changed" && event.configData) {
    // Ignore events we triggered ourselves
    if (switchPending) return;

    const normalized = normalizeProfileIndex(event.configData.profileIndex);
    if (normalized === null) return;

    if (normalized === currentProfile) return;
    console.log(`[INFO] Profile changed externally to ${normalized} (raw: ${event.configData.profileIndex})`);
    currentProfile = normalized;
  }
});

// ── Focus polling ─────────────────────────────────────────────────────────────

function startPolling() {
  if (pollTimer) return;
  console.log("[INFO] Polling for foreground window...\n");
  pollTimer = setInterval(checkFocus, POLL_MS);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function checkFocus() {
  if (!deviceId) return;

  const exe        = getForegroundExe();
  const targetProfile = exe ? watchedIndex.get(exe) : undefined;
  const isWatched  = targetProfile !== undefined;

  if (isWatched && focusedApp !== exe) {
    // A watched app gained focus (either from an unwatched app, or from another watched app)
    const previous = focusedApp;
    focusedApp     = exe;

    if (previous === null) {
      // Coming from a non-watched app — snapshot the current profile to restore later
      savedProfile = currentProfile;
      console.log(`[INFO] "${exe}" focused — saving profile ${savedProfile}, switching to ${targetProfile}`);
    } else {
      // Switching directly from one watched app to another — keep the original savedProfile
      console.log(`[INFO] "${exe}" focused (from "${previous}") — keeping saved profile ${savedProfile}, switching to ${targetProfile}`);
    }

    switchProfile(targetProfile, `${exe} focused`);

  } else if (!isWatched && focusedApp !== null) {
    // All watched apps lost focus — restore the original profile
    const leaving = focusedApp;
    focusedApp    = null;
    console.log(`[INFO] "${leaving}" unfocused — restoring profile ${savedProfile}`);
    switchProfile(savedProfile, `${leaving} unfocused`);
    savedProfile  = null;
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

function shutdown() {
  console.log("\n[INFO] Shutting down...");
  stopPolling();
  if (focusedApp !== null && savedProfile !== null && deviceId) {
    switchProfile(savedProfile, "shutdown restore");
  }
  setTimeout(() => { stopDeviceWatcher(); process.exit(0); }, 500);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
