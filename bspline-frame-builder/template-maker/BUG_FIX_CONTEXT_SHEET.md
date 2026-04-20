# Template Maker Bug Fix Contest Sheet

## Bug Summary
The Fusion 360 `template-maker` add-in currently generates template code that only contains comment metadata like `# coordExpr: ...` instead of using real expression-based coordinates in generated `Seeds.Line`, `Seeds.Arc`, and other construct calls.

## Observed Symptoms
- The current template generation path is building preview comments correctly, but the actual seed instruction strings still use named point IDs or placeholder point references.
- `template_payload.py` contains logic to prefer expression coordinates, but the emitted template code still appears to fall back to IDs or placeholder references in actual output.
