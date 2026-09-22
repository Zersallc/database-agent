/**
 * Just enough statistics to say whether two pass rates differ or whether ten
 * runs simply happened to land differently.
 *
 * Ten runs is a small sample, and "100% then 80%" looks like a regression and
 * is often noise. These are here so a comparison says how much it can and
 * cannot tell, instead of leaving that to whoever reads the table.
 */

/** The Wilson score interval for a proportion, 95%. Behaves at 0 and n, where the plain normal one does not. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

function logChoose(n: number, k: number): number {
  let result = 0;
  for (let i = 1; i <= k; i++) result += Math.log(n - k + i) - Math.log(i);
  return result;
}

/**
 * Fisher's exact test, two-sided: the chance of a split at least as lopsided as
 * this one between two groups if both had the same underlying rate.
 */
export function fisherExact(a: { pass: number; n: number }, b: { pass: number; n: number }): number {
  const total = a.n + b.n;
  const passes = a.pass + b.pass;
  if (a.n === 0 || b.n === 0) return 1;

  const probability = (x: number) =>
    Math.exp(logChoose(passes, x) + logChoose(total - passes, a.n - x) - logChoose(total, a.n));

  const observed = probability(a.pass);
  const lowest = Math.max(0, a.n - (total - passes));
  const highest = Math.min(a.n, passes);
  let sum = 0;
  for (let x = lowest; x <= highest; x++) {
    const p = probability(x);
    // A tolerance, so a split exactly as likely as the observed one is counted despite float error.
    if (p <= observed * (1 + 1e-9)) sum += p;
  }
  return Math.min(1, sum);
}

export const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;
