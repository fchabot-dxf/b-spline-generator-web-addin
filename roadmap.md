# Project Roadmap: Fusion-IO Template Harmonization

## Vision
To evolve the high-fidelity audit engine into a generative **"Master Template"** system that harmonizes the outputs of our **B-Spline Surface Generator**. By analyzing the algorithmic "DNA" of these surfaces, we will build a unified recipe that can reconstruct any variation (geometry + frames + CAM) with 100% fidelity.

---

## Standardized Workflow
To move from raw CAD data to a generative Master Template, we follow this structured approach:

| Step | Action | Outcome |
| :--- | :--- | :--- |
| **1. Preparation** | Identify 3-4 projects with shared functional intent but diverse structural execution. | Selected Project Portfolio |
| **2. Extraction** | Use the `Fusion-IO` Add-in to generate a comprehensive JSON audit portfolio for each. | Raw JSON Audits |
| **3. Cross-Audit Mapping** | Use the `GeomID` system to align sketch entities across different projects (Harmonization). | Harmonized Map |
| **4. Template Synthesis** | Distill the "Invariant DNA" into a single, unified JSON schema. | Master Template JSON |
| **5. Generative Loop** | Feed the Master Template into `importer.py` to rebuild the model and validate fidelity. | Regenerated Design |

---

## Phase 1: Deep Dataset Collection (Current Target)
**Goal**: Export 3-4 projects that serve a similar purpose but vary by value, parameter, and structural implementation.
- **Project Selection**: Choose 3-4 models with architectural differences (e.g., Multi-body vs. Component-based, or different timeline strategies).
- **High-Fidelity Audit**: Use the "Relational Engine" to capture the full parametric graph and machining DNA for each.
- **Verification**: Ensure `SKETCHES.json` and `CAM/setups/` are 100% complete for all test cases.

## Phase 2: Structural Pattern Recognition
**Goal**: Distill the "Invariants" (Stable DNA) from the "Variants" (Structural Shifts).
- **Relational Comparison**: Map the `GeomID` graphs across projects to find shared sketch logic.
- **Parameter Harmonization**: Identify which parameters are "Core Utility" vs. "Instance Specific."
- **Timeline Analysis**: Identify the most efficient feature sequence shared across all versions.

## Phase 3: Master Template Distillation
**Goal**: Create a single, unified "Template JSON" that can represent all design variations.
- **Dynamic Structural Logic**: Define how the structure can "Shape-Shift" based on input parameters (e.g., adding bodies or changing setup strategies).
- **Universal Parameter Map**: Standardize the naming and expression logic across the portfolio.
- **Machining Logic Standardization**: Harmonize the CAM strategies into a reusable "Machining Template."

## Phase 4: Generative Importer Engine
**Goal**: Build the `importer.py` logic to materialize the "Master Template" into new Fusion 360 files.
- **Parametric Reconstruction**: Rebuild the design tree and relational sketches from the harmonized JSON.
- **Deep CAM Materialization**: Automatically recreate the CAM setups and operation parameters.
- **Validation**: Compare a generated model against the original audit to ensure 100% fidelity.

---

## Technical Hypotheses
- **Structural Invariance**: We hypothesize that despite structural differences, the "Functional Intent" of 3-4 similar projects can be reduced to a single "Master Sketch Graph."
- **AI-Ready Datasets**: By harmonizing these structures, we are building the perfect training data for future AI-driven CAD generators.

---
*Maintained by Frédéric & Antigravity AI @ 2026-03-28*
