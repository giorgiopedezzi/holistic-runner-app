/**
 * services/device.service.ts
 * External-device/integration checks. Currently the Garmin "is the watch plugged
 * in" presence check (walks the MTP shell path but copies nothing, so it's fast).
 * No http. `scriptsDir` is injected so __dirname resolution is independent of where
 * this file lives. Same non-inherited, timed-out spawn pattern as the sync scripts —
 * this COM automation can hang without a real console attached. Moved from server.ts
 * (HRA-30).
 */
import path from "path";
import { spawn } from "child_process";

export interface DeviceStatus { connected: boolean; reason?: string; name?: string; }

export function createDeviceService(scriptsDir: string) {
  function checkGarminDevice(): Promise<DeviceStatus> {
    const scriptPath = path.join(scriptsDir, "powershell", "check-garmin-device.ps1");
    return new Promise(resolve => {
      // No -DeviceName: auto-detect by protocol (MTP vs filesystem) instead of
      // requiring an exact name match, which is what actually connects/plugs in —
      // Windows' reported device name isn't always what's in config.json.
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      let out = "";
      child.stdout.on("data", chunk => out += chunk);

      const timer = setTimeout(() => {
        child.kill();
        resolve({ connected: false, reason: "timeout" });
      }, 15_000);

      child.on("error", () => { clearTimeout(timer); resolve({ connected: false, reason: "powershell_error" }); });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(out.trim().split("\n").pop() ?? "{}") as DeviceStatus);
        } catch {
          resolve({ connected: false, reason: "parse_error" });
        }
      });
    });
  }

  return { checkGarminDevice };
}

export type DeviceService = ReturnType<typeof createDeviceService>;
