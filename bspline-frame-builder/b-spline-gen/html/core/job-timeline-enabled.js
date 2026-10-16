/**
 * core/job-timeline-enabled.js -- the "Job timeline" on/off switch (Fred 2026-10-16, Settings panel): a per-DEVICE
 * preference, like core/haptics.js's own isHapticEnabled/setHapticEnabled (a dedicated localStorage key, never
 * P/the project file). DEFAULT OFF.
 *
 * Off: main/job-timeline-strip.js hides the strip (the canvas keeps its full height) and stops writing P.jobTimeline
 * (order/head/snapshots) on every sync -- the saved timeline is kept exactly as it was, so switching back on resumes
 * right where it left off. No locks apply while off (job-timeline step 3): everything stays editable regardless of
 * the saved head position.
 */
const ENABLED_KEY = 'bspline.jobTimeline.enabled';

export function isJobTimelineEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch (_) { return false; }
}

export function setJobTimelineEnabled(value) {
  try { localStorage.setItem(ENABLED_KEY, value ? '1' : '0'); } catch (_) { /* not remembered */ }
}
