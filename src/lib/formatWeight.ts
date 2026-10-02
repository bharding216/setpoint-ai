/**
 * Format a weight value for display, appending an equipment-count
 * multiplier when the exercise uses more than one implement.
 *
 *   formatWeight(25, 2)     → "25 ×2"
 *   formatWeight(135, 1)    → "135"
 *   formatWeight(50)        → "50"
 *   formatWeight(null)      → ""
 */
export function formatWeight(
  weight: number | null | undefined,
  equipmentCount?: number | null,
): string {
  if (weight == null) return '';
  if (equipmentCount != null && equipmentCount > 1) {
    return `${weight} ×${equipmentCount}`;
  }
  return `${weight}`;
}

/**
 * Same as formatWeight but includes a unit label.
 *
 *   formatWeightWithUnit(25, 2)     → "25 lbs ×2"
 *   formatWeightWithUnit(135, 1)    → "135 lbs"
 *   formatWeightWithUnit(null)      → ""
 */
export function formatWeightWithUnit(
  weight: number | null | undefined,
  equipmentCount?: number | null,
  unit: string = 'lbs',
): string {
  if (weight == null) return '';
  if (equipmentCount != null && equipmentCount > 1) {
    return `${weight} ${unit} ×${equipmentCount}`;
  }
  return `${weight} ${unit}`;
}
