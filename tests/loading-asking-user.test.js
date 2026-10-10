/**
 * 2026-10-10 (Fred: "the saving to cloud modal spinner is over the password modal"): a save that meets a 401 asks for
 * the edit password INSIDE its 'cloudSave' stage, and the card (z-index 10001) sat above the prompt (9700). While the
 * app waits on the user the overlay steps back (core/loading-signal.js whileAskingUser) and comes back after; the
 * password prompt, the name prompt and the confirm box all go through it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { withLoadingStage, whileAskingUser, currentLoadingStage, resetLoadingSignal } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { askPassword } from '../bspline-frame-builder/b-spline-gen/html/main/edit-password.js';
import { confirmDialog } from '../bspline-frame-builder/b-spline-gen/html/core/confirm-dialog.js';

const FIXTURE = `<div id="loading-stage" class="loading-stage" hidden role="status" aria-live="polite"><span class="loading-stage-spinner"></span><span class="loading-stage-text"></span></div>`;
const card = () => document.getElementById('loading-stage');
const cardShows = () => !card().hidden && card().style.visibility !== 'hidden';
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = FIXTURE; resetLoadingSignal(); });

describe('the loading card steps back while the app waits on the user', () => {
  it('the save\'s password prompt: the card hides while it is open, the stage stays; OK brings the card back', async () => {
    let answered;
    const save = withLoadingStage('cloudSave', async () => { answered = await askPassword('Edit password'); return 'saved'; });
    await tick();
    expect(document.querySelector('.pm-prompt-overlay')).not.toBeNull();
    expect(cardShows()).toBe(false);
    expect(card().dataset.stage).toBe('cloudSave'); // still saving underneath: not dropped, only out of the way
    document.querySelector('.pm-prompt-input').value = 'pw';
    document.querySelector('.pm-prompt-ok').click();
    await tick();
    expect(answered).toBe('pw');
    expect(await save).toBe('saved');
  });
  it('the card is back the moment the prompt closes, while its stage still runs', async () => {
    let release;
    const save = withLoadingStage('cloudSave', async () => {
      await askPassword('Edit password');
      await new Promise((r) => { release = r; }); // the save goes on after the answer
    });
    await tick();
    document.querySelector('.pm-prompt-cancel').click();
    await tick();
    expect(cardShows()).toBe(true);
    expect(currentLoadingStage().id).toBe('cloudSave');
    release(); await save;
  });
  it('the confirm box too ("already exists. Replace it?")', async () => {
    const run = withLoadingStage('cloudSave', () => confirmDialog('Replace it?'));
    await tick();
    expect(cardShows()).toBe(false);
    document.querySelector('.pm-prompt-ok').click();
    expect(await run).toBe(true);
  });
  it('nested asks count: the card returns only when the last one closes', async () => {
    const stage = withLoadingStage('cloudSave', () => new Promise(() => {}));
    await tick();
    let a, b;
    const outer = whileAskingUser(() => new Promise((r) => { a = r; }));
    const inner = whileAskingUser(() => new Promise((r) => { b = r; }));
    b(); await inner;
    expect(cardShows()).toBe(false);
    a(); await outer;
    expect(cardShows()).toBe(true);
    void stage;
  });
});
