// F35 item 70: the CAM palette's loading card -- the B-Spline palette's own overlay (core/loading-signal.js, the
// shared styles/loading-stage.css), with the CAM steps declared in cam-stages.js. Both add-ins deploy side by side
// under the same AddIns folder, so this palette imports the module where it lives. The palette's classic script calls
// window.camLoading: begin(sequence) paints the sequence's first step BEFORE the request goes to Fusion (the add-in
// works on Fusion's main thread, which is also the palette's); stage(id) follows the add-in's 'cam_stage' reports;
// end() closes it on the report.
import { declareLoadingStages, beginLoadingSequence, holdLoadingStage, releaseHeldStage } from '../../../b-spline-gen/html/core/loading-signal.js';
import CAM_STAGES from './cam-stages.js';

declareLoadingStages(
  Object.fromEntries(CAM_STAGES.stages.map((s) => [s.id, { group: 'waiting', label: `Fusion: ${s.label}`, surface: 'card' }])),
  Object.fromEntries(Object.entries(CAM_STAGES.sequences).map(([id, stages]) => [id, { stages }])),
);

window.camLoading = {
  begin(sequenceId) {
    beginLoadingSequence(sequenceId);
    return holdLoadingStage(CAM_STAGES.sequences[sequenceId][0]);
  },
  stage: (id) => holdLoadingStage(id),
  end: () => releaseHeldStage(),
};
