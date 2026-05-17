/**
 * properties-panels.js - REMOVED.
 *
 * This module managed a tabbed property-panels UI (#editorShapePanel /
 * #editorTextPanel / #editorSelectPanel / #editorDefaultPanel) that toggled
 * an .active class on .editor-properties-pane elements. None of those IDs
 * or classes still exist in the HTML - the editor moved to the inline
 * #editor*Group toolbar approach (#editorFontGroup, #editorStrokeGroup,
 * #editorExpandGroup) with simple .property-group.hidden visibility.
 *
 * The original module had no remaining importers and queryAll(...) returned
 * empty, so renderPropertiesPanel() was a no-op every call. Removed during
 * the mobile-UI orphan cleanup that also stripped the matching CSS rules
 * from styles/editor.css.
 *
 * If you need a tabbed property UI again, build it against the live
 * #editor*Group elements in bspline_gen_palette.html - don't reintroduce
 * the .editor-properties-pane abstraction.
 */
