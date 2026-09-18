// Exact, nonnegative decimal normalization. No floating-point conversion or semantic inference.
export function canonicalDecimal(raw) {
  if (typeof raw !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) throw Error('invalid decimal representation');
  const [integer, fraction = ''] = raw.replaceAll(',', '').split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const tail = fraction.replace(/0+$/, '');
  return tail ? `${whole}.${tail}` : whole;
}
