/**
 * VAT and money arithmetic.
 *
 * In core rather than in Billing because two modules now price the same work: a quote
 * and the invoice that follows must agree to the cent, and they can only do that by
 * running the same code. The boundary rule caught this the moment Sales imported it —
 * a module's internals are private, so anything genuinely shared belongs here.
 *
 * Pure functions over integers: no database, no dependencies, no I/O.
 */
/**
 * The VAT engine (Phase 5 brief §4).
 *
 * Pure functions over integer cents, kept apart from the service so the money maths is
 * testable without a database. Every number here ends up on a legal document.
 */

export type VatTreatment = 'domestic_21' | 'reverse_charge' | 'outside_eu';

export interface LineInput {
  /** Quantity as an exact decimal string ('7.50'), matching the numeric column. */
  quantity: string;
  unitPriceCents: number;
  vatRate: string; // '21.00' | '0.00'
}

export interface VatBreakdownRow {
  rate: string;
  baseCents: number;
  vatCents: number;
}

export interface Totals {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  breakdown: VatBreakdownRow[];
}

/** The VAT rate a treatment carries. Only domestic work bears Dutch BTW. */
export function rateForTreatment(treatment: VatTreatment): string {
  return treatment === 'domestic_21' ? '21.00' : '0.00';
}

/** The legend the treatment legally requires on the printed invoice. */
export function vatLegend(treatment: VatTreatment): string | null {
  switch (treatment) {
    case 'domestic_21':
      return null;
    case 'reverse_charge':
      return 'BTW verlegd / VAT reverse charged';
    case 'outside_eu':
      return 'VAT out of scope — customer established outside the EU';
  }
}

/**
 * Half-up rounding to whole cents, symmetric about zero.
 *
 * Implemented over scaled integers rather than floats: 0.1 + 0.2 !== 0.3 is a rounding
 * story nobody wants to tell the Belastingdienst. Symmetry matters because credit notes
 * negate their invoice: BigInt division truncates toward zero, so the naive +0.5 trick
 * rounds -349.995 to -34999 — and a credit note one cent short of its invoice is a
 * reconciliation error on a legal document.
 */
export function roundHalfUpCents(numeratorTimes100: bigint, denominator: bigint): number {
  if (denominator === 0n) throw new Error('Division by zero');
  const negative = numeratorTimes100 < 0n !== denominator < 0n;
  const n = numeratorTimes100 < 0n ? -numeratorTimes100 : numeratorTimes100;
  const d = denominator < 0n ? -denominator : denominator;
  const magnitude = Number((n * 2n + d) / (d * 2n));
  return negative ? -magnitude : magnitude;
}

/** quantity × unit price, exact, rounded half-up once. */
export function lineAmountCents(quantity: string, unitPriceCents: number): number {
  const [whole, frac = ''] = quantity.split('.');
  const scale = BigInt(10 ** frac.length || 1);
  const quantityScaled = BigInt(whole + frac); // '7.50' → 750, scale 100
  return roundHalfUpCents(quantityScaled * BigInt(unitPriceCents) * 100n, scale * 100n);
}

/**
 * Totals with VAT computed PER RATE GROUP.
 *
 * Lines are summed by rate first; VAT is calculated once on each group's base and
 * rounded there. Rounding per line drifts from the client's own bookkeeping by a cent
 * or two, which is exactly the discrepancy that costs someone an hour (brief §4).
 */
export function computeTotals(lines: LineInput[]): Totals {
  const groups = new Map<string, number>();
  let subtotalCents = 0;

  for (const line of lines) {
    const amount = lineAmountCents(line.quantity, line.unitPriceCents);
    subtotalCents += amount;
    groups.set(line.vatRate, (groups.get(line.vatRate) ?? 0) + amount);
  }

  const breakdown: VatBreakdownRow[] = [...groups.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([rate, baseCents]) => {
      // rate '21.00' → 2100 basis points; VAT = base × rate / 100, rounded once here.
      const basisPoints = BigInt(Math.round(Number(rate) * 100));
      const vatCents = roundHalfUpCents(BigInt(baseCents) * basisPoints * 100n, 10_000n * 100n);
      return { rate, baseCents, vatCents };
    });

  const vatCents = breakdown.reduce((sum, row) => sum + row.vatCents, 0);
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents, breakdown };
}
