# Scoring system – improvement rounds with agents

Improvements are made in **rounds**. Each round uses these roles:

| Role | Agent | Job |
|---|---|---|
| **Research A – graphics** | research agent | Looks for ways to improve how things *look*, on the Quest 3 and on the laptop, within the frame budget. Reads the code, proposes concrete, prioritised changes with cost and benefit. |
| **Research B – options & control** | research agent | Looks for ways to improve what you can *choose and control*: settings, camera, movement, comfort, tools and menus, in VR and on the laptop. Also looks at everything else (robustness, docs, tests) with fresh eyes. |
| **Builder** | main session | Picks the proposals that best serve the goal, implements them, and fixes what the gatekeeper and the judge send back. |
| **Gatekeeper** | verification agent | Runs **before** scoring. Confirms **viability** (it builds and works), **quality** (tests, code, Norwegian UI), **efficiency** (frame budget on Quest 3) and **integrity** (geometry only from `apartment.json`, no data loss, no regressions). Answers **PASS** or **FAIL** with reasons. FAIL goes straight back to the builder; nothing is scored. |
| **Judge** | evaluation agent | Scores each item and the round as a whole, using the terms below, and says exactly what must change for anything that isn't acceptable. |

Research runs in every round. The researchers see the judge's last verdict, so they can look for better answers to what was rejected as well as new improvements.

## Verdicts

Each item gets a score from 1 to 9 and one of three verdicts:

| Verdict | Score | Meaning | What happens |
|---|---|---|---|
| ✅ **Akseptabel** (acceptable) | 8–9 | Clearly serves the goal, works on the Quest within budget, tests green, intuitive in Norwegian, with no known weakness worth another round. | Kept. |
| 🟡 **Nesten – tenk nytt** (almost – rethink) | 5–7 | The right direction, but with a specific gap: a missing piece, rough or unclear use, uncertain frame budget, or research found a clearly better way. The judge must name the change. | Reworked next round. |
| ❌ **Ikke akseptabel** (not acceptable) | 1–4, **or any hard-gate breach** | Does not serve the goal, or breaks a hard gate. | Removed or rebuilt from scratch. |

### Hard gates (any breach means ❌, whatever the score)

1. Build, typecheck, `npm run validate`, unit tests and Playwright tests are all green.
2. **Quest 3 frame budget:** 90 fps on the default setting. Concretely:
   - At most 40 draw calls per eye for the apartment on the default quality setting.
   - No per-frame allocations or expensive work in the render loop.
   - Texture memory at most 32 MB on the default setting.
   - Heavier effects only behind an explicit higher quality setting, never on by default in VR.
3. All geometry still comes from `apartment.json`. Presentation-only details (textures, lighting) may live in code.
4. All UI text is in Norwegian (bokmål).
5. No existing feature regresses: walking, teleport, snap turn, measuring, the top-down view, layers.
6. No data loss: settings and measurements survive a reload, and broken storage falls back safely.

### Dimensions and weights (the goal: better graphics, more options and control)

| Dimension | Weight |
|---|---|
| Visual quality (VR and laptop) | 25 % |
| Performance and headroom on Quest 3 | 20 % |
| Options and control: breadth and usefulness | 20 % |
| Intuitive use (Norwegian, discoverable, consistent across VR and laptop) | 15 % |
| Code quality and integrity (architecture, tests, data-driven) | 10 % |
| Robustness (saved settings, fallbacks, no regressions) | 10 % |

### Round result

- **The round is accepted** when every item is ✅, the weighted total is **≥ 8.0**, and no dimension is below 7.
- **Rounds continue** until the round is accepted *and* the researchers' new proposals give only small gains (diminishing returns). The maximum is **4 rounds** per goal. After that, what is left goes into `docs/PLAN.md` as later work.
- Every round's results are written to [QA.md](QA.md): proposals taken and rejected, the gatekeeper's answer, and the judge's scores.

The agent prompts are in `.claude/agents/`, so the same loop can run again in later sessions.
