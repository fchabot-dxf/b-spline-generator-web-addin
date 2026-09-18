export function el(id) {
    return document.getElementById(id);
}

export function query(selector) {
    return document.querySelector(selector);
}

export function queryAll(selector) {
    return Array.from(document.querySelectorAll(selector));
}

export function on(target, event, handler, options) {
    const node = typeof target === 'string' ? el(target) : target;
    if (!node) return null;
    node.addEventListener(event, handler, options);
    return node;
}

export function bindClick(id, handler) {
    const node = el(id);
    if (!node) return null;
    node.addEventListener('click', handler);
    return node;
}

export function toggleClass(target, className, condition) {
    const node = typeof target === 'string' ? el(target) : target;
    if (!node) return;
    node.classList.toggle(className, condition);
}

export function addClass(target, className) {
    const node = typeof target === 'string' ? el(target) : target;
    if (!node) return;
    node.classList.add(className);
}

export function removeClass(target, className) {
    const node = typeof target === 'string' ? el(target) : target;
    if (!node) return;
    node.classList.remove(className);
}

/** Is the user typing into a text field where the browser's native
 *  undo/keystrokes should be in charge (rename inputs, project manager
 *  forms, the SVG editor's hidden text-editing input, etc.)? Shared by
 *  main/global-events.js (Ctrl+Z/Y) and editor/editor-interaction.js
 *  (tool shortcuts) so both skip the same set of typing targets. */
export function _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    return false;
}
