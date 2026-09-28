/**
 * The `data-editor-layers` attribute codec -- the layer roster (JSON) stored on the saved document's root <svg>.
 * Save audit #2: only `"` used to be escaped, so a layer named "Rails & Ties" (or with a `<`) made the saved
 * document invalid XML and the next open came back BLANK. Every writer and reader of the attribute goes through
 * these two, so the escaping and the hand-decoding (app-init's string migrations) can never disagree again.
 * No imports: safe from anywhere.
 */
export function encodeLayersAttr(value) {
    return JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The raw attribute text (as a regex pulled it from the markup) -> the roster. `&amp;` last, so an escaped
 *  entity-looking name ("&amp;quot;") decodes to its literal text. */
export function decodeLayersAttr(text) {
    return JSON.parse(String(text).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

/** Rescue for documents saved before the fix: escape the bare `&` / `<` inside the data-editor-layers attribute so
 *  the document parses. Returns the markup unchanged when there is nothing to fix. */
export function repairLayersAttr(markup) {
    return String(markup).replace(/data-editor-layers="([^"]*)"/, (m, v) =>
        `data-editor-layers="${v.replace(/&(?!(?:amp|quot|lt|gt|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;')}"`);
}
