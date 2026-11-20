import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { camera } from "@/shared/api/commands.ts";

/** Answers the barcode scanner plugin as a phone would: the camera `granted` or not, after asking if `granting`. */
function phone({ granted, granting = false }: { granted: boolean; granting?: boolean }) {
  const calls: { command: string; args: unknown }[] = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "plugin:barcode-scanner|check_permissions")
      return { camera: granted ? "granted" : "prompt" };
    if (command === "plugin:barcode-scanner|request_permissions")
      return { camera: granting ? "granted" : "denied" };
    if (command === "plugin:barcode-scanner|scan")
      return { content: "moxia:abc", format: "QR_CODE" };
    throw new Error(`Unmocked command: ${command}`);
  });
  return calls;
}

describe("camera.scanQrCode", () => {
  it("reads one QR code with the page see-through over the camera", async () => {
    const calls = phone({ granted: true });
    await expect(camera.scanQrCode()).resolves.toBe("moxia:abc");
    expect(calls.at(-1)?.args).toMatchObject({ windowed: true, formats: ["QR_CODE"] });
  });

  it("asks for the camera first, and gives up if it is refused", async () => {
    phone({ granted: false, granting: true });
    await expect(camera.scanQrCode()).resolves.toBe("moxia:abc");
    const calls = phone({ granted: false });
    await expect(camera.scanQrCode()).resolves.toBeNull();
    expect(calls.map((call) => call.command)).not.toContain("plugin:barcode-scanner|scan");
  });
});
