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

export function createButton(attrs = {}) {
    const button = document.createElement('button');
    button.type = attrs.type || 'button';
    if (attrs.className) button.className = attrs.className;
    if (attrs.textContent) button.textContent = attrs.textContent;
    return button;
}
