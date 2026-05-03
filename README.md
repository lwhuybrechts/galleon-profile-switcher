# Galleon 100 SD Profile Switcher

Automatically switches the **Corsair Galleon 100 SD** keyboard profile when a configured application gains or loses focus on Windows.

When a watched app is focused, the script saves the current profile and switches to a configured one. When the app loses focus, the previous profile is restored.

---

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) (v18 or later)
- [Stream Deck](https://www.elgato.com/stream-deck) desktop app
- [Corsair Ctrl plugin](https://marketplace.elgato.com/) installed in Stream Deck

---

## Installation

1. Clone or download this repository into a folder of your choice.

2. Install dependencies:
   ```
   npm install
   ```

3. Open `focus-switcher.js` and configure your apps at the top:
   ```js
   const WATCHED_APPS = [
     { exe: "notepad.exe",   profile: 1 },
     { exe: "photoshop.exe", profile: 2 },
   ];
   ```

   Profiles are numbered **0–4**, matching the slots in the Corsair Web Hub app.

   To find the correct `.exe` name for an app, open it and run in PowerShell:
   ```powershell
   Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Name
   ```

4. Test it:
   ```
   node focus-switcher.js
   ```

---

## Running on Windows Startup

The script runs silently in the background using Windows Task Scheduler.

1. Open **PowerShell as Administrator**: press Start, type `powershell`, right-click **Windows PowerShell** → **Run as administrator**.

2. Navigate to the folder where you saved the scripts:
   ```powershell
   cd "C:\path\to\your\folder"
   ```

3. Unblock the script (required because it was downloaded from the internet):
   ```powershell
   Unblock-File -Path .\setup-startup.ps1
   ```

4. Run the setup script:
   ```powershell
   .\setup-startup.ps1
   ```

5. The task is now registered. To start it immediately without rebooting:
   ```powershell
   Start-ScheduledTask -TaskName "GalleonProfileSwitcher"
   ```

6. To remove the startup task:
   ```powershell
   Unregister-ScheduledTask -TaskName "GalleonProfileSwitcher" -Confirm:$false
   ```

The script is launched by `start-hidden.vbs`, which tells Windows to run Node.js without showing a console window.

---

## How It Works

- Starts the Corsair native device watcher (`bragiWinService.node`) to connect to the keyboard.
- Polls the foreground window every 300 ms using the Windows `QueryFullProcessImageName` API.
- On focus: snapshots the current profile, switches to the configured one.
- On unfocus: restores the saved profile.
- Profile indices reported by the device are normalised using the same logic as the official Corsair Ctrl plugin, ensuring correct values across all five profile slots.
- Handles manual profile changes (via Stream Deck buttons or the keyboard itself) by listening to `config_changed` events from the device watcher.

---

## License

MIT