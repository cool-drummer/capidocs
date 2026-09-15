const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const SMALLEST = DIGITS[0]!;
const LARGEST = DIGITS[DIGITS.length - 1]!;

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new Error(`invalid order: ${lower} >= ${upper}`);
  }
  if (lower.endsWith(SMALLEST) || (upper && upper.endsWith(SMALLEST))) {
    throw new Error('invalid position: trailing zero');
  }

  if (upper) {
    let common = 0;
    while ((lower[common] ?? SMALLEST) === upper[common]) common += 1;
    if (common > 0) {
      return upper.slice(0, common) + midpoint(lower.slice(common), upper.slice(common));
    }
  }

  const lowerDigit = lower ? DIGITS.indexOf(lower[0]!) : 0;
  const upperDigit = upper ? DIGITS.indexOf(upper[0]!) : DIGITS.length;
  if (upperDigit - lowerDigit > 1) {
    return DIGITS[Math.round(0.5 * (lowerDigit + upperDigit))]!;
  }
  if (upper && upper.length > 1) {
    return upper.slice(0, 1);
  }
  return DIGITS[lowerDigit]! + midpoint(lower.slice(1), null);
}

export function positionBetween(lower: string | null, upper: string | null): string {
  if (lower === null && upper === null) return DIGITS[Math.floor(DIGITS.length / 2)]!;
  if (lower === null) return midpoint('', upper);
  if (upper === null) {
    const lastIndex = DIGITS.indexOf(lower[lower.length - 1]!);
    if (lastIndex < DIGITS.length - 1) {
      return lower.slice(0, -1) + DIGITS[lastIndex + 1]!;
    }
    return lower + DIGITS[Math.floor(DIGITS.length / 2)]!;
  }
  return midpoint(lower, upper);
}

export function isValidPosition(value: string): boolean {
  if (!value.length) return false;
  if (value.endsWith(SMALLEST) && value.length > 1) return false;
  return [...value].every((char) => DIGITS.includes(char));
}

export const POSITION_START = DIGITS[Math.floor(DIGITS.length / 2)]!;
export const POSITION_LARGEST = LARGEST;
