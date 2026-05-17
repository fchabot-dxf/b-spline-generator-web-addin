/**
 * Profile registry. Add a new tool profile by:
 *   1. dropping a `profiles/<name>.js` file that exports the profile
 *      object (see flat.js for the contract);
 *   2. registering it here;
 *   3. adding an <option> to the stampProfile <select> in the HTML.
 *
 * Nothing in stamp.js or main/stamp/* needs to change.
 */
import { flat } from './flat.js';
import { vbit } from './vbit.js';
import { ballnose } from './ballnose.js';
import { adaptive } from './adaptive.js';

const REGISTRY = Object.freeze({
  flat,
  vbit,
  ballnose,
  adaptive,
});

const FALLBACK = flat;

/** Look up a profile by id. Falls back to flat for unknown ids. */
export function getProfile(id) {
  return REGISTRY[id] || FALLBACK;
}

/** All profiles, in registration order. UI uses this to build the dropdown. */
export function listProfiles() {
  return Object.values(REGISTRY);
}

export { REGISTRY };
