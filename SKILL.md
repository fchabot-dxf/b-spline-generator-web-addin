# B-Spline & Frame Builder Repository Skill

## Purpose
This repository contains a suite of procedural generation and structural design tools for Fusion 360, including the **Symmetric B-Spline Generator**, the **Frame Builder**, and supporting design bridges.

## Navigation
To access expert knowledge for specific components, use the following skill files:

| Tool | Skill File | Expertise |
| :--- | :--- | :--- |
| **Common API** | [fusion360-api/SKILL.md](file:///c:/Users/danse/APPS/b-spline-generator-web-addin/skills/fusion360-api/SKILL.md) | Shared Fusion 360 API gotchas, constraints, and lifecycle. |
| **B-Spline Gen** | [b-spline-gen/SKILL.md](file:///c:/Users/danse/APPS/b-spline-generator-web-addin/skills/b-spline-gen/SKILL.md) | Web Palettes, bridge messaging, and STEP generation. |
| **Frame Builder** | [frame-builder/SKILL.md](file:///c:/Users/danse/APPS/b-spline-generator-web-addin/skills/frame-builder/SKILL.md) | Parametric sketches, DNA parameter sync, and 4-lock guards. |
| **Fusion-IO** | [fusion-io/SKILL.md](file:///c:/Users/danse/APPS/b-spline-generator-web-addin/skills/fusion-io/SKILL.md) | DNA import/export (JSON), Master Materializer, and Deep Audits. |
| **Inspector** | [frame-inspector/SKILL.md](file:///c:/Users/danse/APPS/b-spline-generator-web-addin/skills/frame-inspector/SKILL.md) | Real-time attribute visualization and metadata HUD. |

## Shared Infrastructure

### Deployment
- **Web Assets**: `tools/DEPLOY_cloudflare.py` handles building and pushing the B-Spline web palette to Cloudflare Pages.
- **Local Add-ins**: Each component has a `deploy-*.py` script to refresh local Fusion 360 add-in folders.

### Logging Standards
- Tools should write to **workspace-relative log files** whenever possible.
- Shared logic for logging is found in `frame-builder/utils/logger.py`.
- Handshake files (`project_path.json`) link deployed add-ins back to this source repository.

### Developer Workflow
- Use the repository root for all git operations to ensure the correct project context.
- On Windows PowerShell, separate commands with `;` rather than `&&`.
- Working workflow that is known to work in this repo:
  - `git add -A; git commit -m "<message>"`
  - `git push`
- When available, use the workspace VS Code tasks named `Stage Modified Files` and `Commit Changes` to avoid shell quoting issues.

## Repository Layout
- `b-spline-gen/`: Generator using HTML/JS palette and chunked STEP import.
- `bspline-frame-builder/`: The unified "One-Click" Hub add-in.
    - `frame-builder/`: Core parametric builder components.
        - `sketch-builder/`: Specialized Sketch UI logic and resources.
        - `solid-builder/`: Specialized Solid UI logic and resources.
        - `engine/`, `sketches/`, `utils/`, `data/`: Shared Parametric Engine core.
- `TOOLS/frame-inspector/`: UI extensions for inspecting frame metadata.
- `TOOLS/fusion-exporter/`: Design DNA bridge (importer and exporter).
- `tools/`: Deployment and maintenance scripts.
