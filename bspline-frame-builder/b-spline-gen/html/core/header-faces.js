/**
 * The header buttons' faces, declared (Fred 2026-10-15: on a phone the Send button is ICON ONLY -- "Send to Fusion" was
 * clipped to "d to Fu" in the 36 px phone button; the desktop keeps the full label). Each face: its label (the text, and
 * what a busy state rewrites), its title, and an optional phoneIcon. A face with a phoneIcon renders both, and ONE phone
 * rule (bspline_gen_palette.html's phone block, `.cad-nav-has-phone-icon`) shows the icon instead of the label there.
 * The mode is the host's: 'web' (the website) or 'fusion' (the add-in's palette).
 */

/** An 18 px send glyph (an arrow out of a tray), drawn in the button's own text colour. */
const SEND_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>';

export const HEADER_BUTTON_FACES = Object.freeze({
  btnDownload: Object.freeze({
    web: Object.freeze({ label: 'STEP', title: 'Download the STEP file', phoneIcon: null }),
    fusion: Object.freeze({ label: 'Send to Fusion', title: 'Send to Fusion', phoneIcon: SEND_ICON }),
  }),
});

export const FACE_CLASSES = Object.freeze({ label: 'cad-nav-face-label', icon: 'cad-nav-face-icon', hasPhoneIcon: 'cad-nav-has-phone-icon' });

/** Renders a declared face on its button: the label span, the phone icon span when declared, the title. */
export function applyHeaderFace(btn, mode) {
  const face = btn && HEADER_BUTTON_FACES[btn.id] && HEADER_BUTTON_FACES[btn.id][mode];
  if (!face) return null;
  btn.innerHTML = '';
  const label = document.createElement('span');
  label.className = FACE_CLASSES.label;
  label.textContent = face.label;
  btn.appendChild(label);
  if (face.phoneIcon) {
    const icon = document.createElement('span');
    icon.className = FACE_CLASSES.icon;
    icon.innerHTML = face.phoneIcon;
    btn.appendChild(icon);
  }
  btn.classList.toggle(FACE_CLASSES.hasPhoneIcon, !!face.phoneIcon);
  btn.title = face.title;
  btn.setAttribute('aria-label', face.label);
  return face;
}

/** A busy / idle text on a faced button: the label only (the phone icon stays), mirrored in its title. A button
 *  without a face takes the text as before. */
export function setHeaderFaceLabel(btn, text) {
  const label = btn && btn.querySelector(`.${FACE_CLASSES.label}`);
  if (!label) { if (btn) btn.textContent = text; return; }
  label.textContent = text;
  btn.title = text;
  btn.setAttribute('aria-label', text);
}
