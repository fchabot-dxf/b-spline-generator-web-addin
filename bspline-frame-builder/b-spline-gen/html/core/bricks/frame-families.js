/**
 * core/bricks/frame-families.js — Wood frame family classification and brick frame tailoring.
 *
 * 2-Layer Architecture:
 * 1. Engine layer: Segment types (straight, waist_curve, neck_curve, arched, pointy_apex, stepped_tab)
 *    and corner configurations (square_90, miter, butt, quoin, apex, fillet).
 * 2. Wood frame family layer: Curated brick frame presets adapted per wood frame family.
 *
 * Adapted one family at a time:
 * - Family 1: Straight top/bottom, Hourglass & Narrow Neck sides (Templates 1, 2, 3, 4, 12, 13).
 */

export const WOOD_FRAME_FAMILIES = Object.freeze({
  family_1_hourglass_neck: Object.freeze({
    id: 'family_1_hourglass_neck',
    label: 'Straight Top/Bottom & Hourglass / Neck Sides',
    templates: Object.freeze([
      'template_1',
      'template_2',
      'template_3',
      'template_4',
      'template_12',
      'template_13',
    ]),
    segmentTypes: Object.freeze({
      top: 'straight',
      bottom: 'straight',
      corners: 'square_90',
      sides: 'hourglass_or_neck',
    }),
    conformingPresetIds: Object.freeze([
      'none',
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'butt_frame',
      'quoin_corners',
      'double_course',
      'craftsman_apron',
      'double_soldier',
      'english_frame',
      'dentil_cornice',
      'flemish_architrave',
      'header_band',
      'mixed_bands',
      'zigzag_band',
      'art_deco_stepped',
      'tudor_frieze',
    ]),
    defaultPreset: 'soldier_stretcher',
  }),
  family_2_arched: Object.freeze({
    id: 'family_2_arched',
    label: 'Arched Head & Vaulted Frames',
    templates: Object.freeze([
      'template_10',
      'template_16',
      'template_18',
      'template_19',
    ]),
    segmentTypes: Object.freeze({
      top: 'arched',
      bottom: 'straight',
      corners: 'arch_shoulders_and_square_base',
      sides: 'flank_or_hourglass',
    }),
    conformingPresetIds: Object.freeze([
      'none',
      'arch_keystone',
      'quoin_corners',
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'double_soldier',
      'header_band',
      'mixed_bands',
      'craftsman_apron',
      'corbelled_cornice',
      'zigzag_band',
      'florentine_architrave',
      'venetian_dentil',
    ]),
    defaultPreset: 'arch_keystone',
  }),
  family_3_gables: Object.freeze({
    id: 'family_3_gables',
    label: 'Pointed & Dipped Gables',
    templates: Object.freeze([
      'template_5',
      'template_7',
      'template_8',
      'template_11',
      'template_14',
    ]),
    segmentTypes: Object.freeze({
      top: 'peaked_or_dipped',
      bottom: 'straight_or_inverted_peak',
      corners: 'ridge_apex_and_eaves',
      sides: 'hourglass_or_flank',
    }),
    conformingPresetIds: Object.freeze([
      'none',
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'double_soldier',
      'header_band',
      'mixed_bands',
      'craftsman_apron',
      'corbelled_cornice',
      'zigzag_band',
      'venetian_dentil',
      'english_frame',
    ]),
    defaultPreset: 'soldier_stretcher',
  }),
  family_4_stepped_tabs: Object.freeze({
    id: 'family_4_stepped_tabs',
    label: 'Stepped & Tabbed Profiles',
    templates: Object.freeze([
      'template_6',
      'template_9',
    ]),
    segmentTypes: Object.freeze({
      top: 'stepped_tab',
      bottom: 'straight_or_stepped_tab',
      corners: 'stepped_90_and_reflex',
      sides: 'flank_or_waist',
    }),
    conformingPresetIds: Object.freeze([
      'none',
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'double_soldier',
      'header_band',
      'mixed_bands',
      'stepped_fret',
      'zigzag_band',
      'crenellated_battlement',
      'art_deco_stepped',
      'dentil_cornice',
      'soldier_string',
    ]),
    defaultPreset: 'soldier_stretcher',
  }),
  family_5_shouldered_flared: Object.freeze({
    id: 'family_5_shouldered_flared',
    label: 'Shouldered Neck & Flared Profiles',
    templates: Object.freeze([
      'template_15',
      'template_17',
    ]),
    segmentTypes: Object.freeze({
      top: 'neck_or_flared_lip',
      bottom: 'straight',
      corners: 'curved_shoulders_and_square_base',
      sides: 'bottle_or_tulip_curves',
    }),
    conformingPresetIds: Object.freeze([
      'none',
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'double_soldier',
      'header_band',
      'mixed_bands',
      'craftsman_apron',
      'corbelled_cornice',
      'zigzag_band',
      'florentine_architrave',
      'venetian_dentil',
      'tudor_frieze',
      'soldier_string',
    ]),
    defaultPreset: 'soldier_stretcher',
  }),
});

/** Find the declared wood frame family for a template ID. */
export function familyForTemplate(templateId) {
  if (!templateId) return null;
  for (const family of Object.values(WOOD_FRAME_FAMILIES)) {
    if (family.templates.includes(templateId)) return family;
  }
  return null;
}

/** Check if a preset is conforming for a given template ID. */
export function isPresetConforming(templateId, presetId) {
  if (!templateId || !presetId) return true;
  const family = familyForTemplate(templateId);
  if (!family || !family.conformingPresetIds) return true;
  const baseId = presetId.replace(/_quoin$/, '');
  return family.conformingPresetIds.includes(presetId) || family.conformingPresetIds.includes(baseId);
}

/**
 * Filter a preset list (e.g. FRAME_PRESET_LIST) to only those conforming to the given template ID.
 * If the template has no declared family, returns the full preset list.
 */
export function framePresetsForTemplate(templateId, allPresetsList) {
  if (!allPresetsList || !allPresetsList.length) return [];
  const family = familyForTemplate(templateId);
  if (!family || !family.conformingPresetIds) return allPresetsList;
  const allowed = new Set(family.conformingPresetIds);
  return allPresetsList.filter((p) => {
    const baseId = p.id.replace(/_quoin$/, '');
    return allowed.has(p.id) || allowed.has(baseId);
  });
}
