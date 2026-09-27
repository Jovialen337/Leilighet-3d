# Leilighet-3d

An accurate 3D model of my apartment for planning systems, organisation, changes, remodeling and refurnishing in layers.
Walk through it in VR on **Meta Quest 3** (Quest Browser) or view it in orbit/top-down on a laptop. The UI is in Norwegian (bokmål).

**Live:** https://jovialen337.github.io/Leilighet-3d/ (published from `main` by GitHub Actions)

- Project plan and data model: [docs/PLAN.md](docs/PLAN.md)
- Self-assessment and Quest test list: [docs/QA.md](docs/QA.md)

## Everything comes from `public/apartment.json`

The app only renders (and later edits) this one file. Units are millimetres; the origin is the inside corner at the entrance door, on the hallway floor, with y pointing up.
Change a number, push, and the model changes. See [docs/PLAN.md](docs/PLAN.md#data-model) for the format.

```bash
npm run validate   # checks apartment.json and prints Norwegian error messages
```

## Development

Requires Node 22.12 or newer.

```bash
npm ci
npm run dev        # http://localhost:5173 (laptop view; VR needs HTTPS or the emulator)
npm run build      # typecheck + production build
npm run test:unit  # schema, geometry, door swing, teleport maths (Vitest)
npm run test:e2e   # Playwright: laptop UI + emulated Quest 3 (IWER)
```

To try VR without a headset, open the app with `?emulator` (for example `http://localhost:5173/?emulator`). This loads Meta's Immersive Web Emulation Runtime as an emulated Quest 3. Meta's Immersive Web Emulator browser extension also works.

Other URL options: `?fps` shows the frame rate at startup (the F key toggles it on the laptop, the Y button in VR); `?hz=90` asks the Quest for 90 Hz.

## Deploy

`.github/workflows/pages.yml` runs on every push: validate → typecheck/build → unit tests → Playwright. Pushes to `main` are then published to GitHub Pages.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
