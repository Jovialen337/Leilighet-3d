/**
 * Emulert Quest 3 (Meta Immersive Web Emulation Runtime) for testing på
 * laptop og i Playwright. Lastes bare når adressen har `?emulator`.
 */
import { XRDevice, metaQuest3 } from 'iwer';

export function installEmulator(): XRDevice {
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  device.installRuntime({ forceInstall: true });
  device.position.set(0, 1.6, 0);
  (window as unknown as { __iwer: XRDevice }).__iwer = device;
  return device;
}
