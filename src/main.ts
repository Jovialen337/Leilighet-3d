import './ui/style.css';
import { App } from './app/App';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // Emulert Quest 3 for testing uten headset: legg til ?emulator i adressen.
  if (params.has('emulator')) {
    const { installEmulator } = await import('./xr/emulator');
    installEmulator();
  }
  const root = document.getElementById('app')!;
  const app = new App(root);
  (window as unknown as { leilighet: App }).leilighet = app;
  await app.start();
}

main().catch((e: unknown) => {
  console.error(e);
  const el = document.getElementById('app');
  if (el) el.textContent = `Noe gikk galt under oppstart: ${(e as Error).message}`;
});
