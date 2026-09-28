/**
 * breakpoints.js -- Audit (tidy-up): the ONE definition of the phone breakpoints. The app shell used 700/701 px
 * and the editor 720/721 px for the same two ideas, so a 701-720 px coarse-pointer window was "landscape phone" to
 * one half of the app and "portrait phone" to the other. CSS can't import this: the @media blocks in
 * styles/layout-app.css, styles/editor.css and bspline_gen_palette.html use the same numbers and name this file.
 */
export const MOBILE_MAX_PX = 720;
/** Portrait / narrow phone. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_PX}px)`;
/** Landscape phone: a coarse pointer, short, and wider than the portrait breakpoint (so the two never both match). */
export const LANDSCAPE_PHONE_QUERY = `(pointer: coarse) and (max-height: 500px) and (min-width: ${MOBILE_MAX_PX + 1}px)`;
