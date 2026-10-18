/** Two-sided empirical Bernstein interval for independent bounded block values.
 * Maurer/Pontil empirical variance bound; union over upper/lower tails.
 * The range term preserves uncertainty for constant and extreme samples.
 */
export function boundedMean(values: number[], lower: number, upper: number, alpha = 0.05) {
  if (!(lower < upper) || !(alpha > 0 && alpha < 1) || values.some(x => !Number.isFinite(x) || x < lower || x > upper)) throw Error('Invalid bounded observations');
  if (!values.length) return { mean: null, variance: null, interval: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1) : 0;
  const log = Math.log(4 / alpha), range = upper - lower;
  const radius = values.length > 1 ? Math.sqrt(2 * variance * log / values.length) + 7 * range * log / (3 * (values.length - 1)) : range;
  return { mean, variance, interval: [Math.max(lower, mean - radius), Math.min(upper, mean + radius)] as [number, number] };
}
export function effectStatus(interval: [number, number] | null, margin: number, missing = 0) {
  if (missing || !interval) return 'unknown' as const;
  if (interval[0] > margin) return 'positive' as const;
  if (interval[1] < -margin) return 'negative' as const;
  if (interval[0] >= -margin && interval[1] <= margin) return 'equivalent' as const;
  return 'unknown' as const;
}
