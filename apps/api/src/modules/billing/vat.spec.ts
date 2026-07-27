import { describe, expect, it } from 'vitest';
import { computeTotals, lineAmountCents, rateForTreatment, vatLegend } from './vat.js';

/**
 * The money maths (brief §10). Every assertion here is checked against a hand
 * calculation in the comment beside it — these numbers end up on legal documents.
 */
describe('lineAmountCents', () => {
  it('multiplies exactly', () => {
    expect(lineAmountCents('10.00', 3500)).toBe(35_000); // 10h × €35 = €350.00
    expect(lineAmountCents('7.50', 12_000)).toBe(90_000); // 7.5h × €120 = €900.00
  });

  it('rounds half-up once, on the line', () => {
    // 0.33h × €99.99 = €32.9967 → €33.00
    expect(lineAmountCents('0.33', 9_999)).toBe(3_300);
    // 1.5 × €0.01 = €0.015 → half-up → €0.02
    expect(lineAmountCents('1.50', 1)).toBe(2);
  });

  it('handles negative unit prices for credit notes', () => {
    expect(lineAmountCents('10.00', -3500)).toBe(-35_000);
  });
});

describe('computeTotals', () => {
  it('computes 21% domestic VAT to the cent', () => {
    // 10h × €35 = €350.00; VAT €73.50; total €423.50
    const totals = computeTotals([{ quantity: '10.00', unitPriceCents: 3500, vatRate: '21.00' }]);
    expect(totals).toMatchObject({
      subtotalCents: 35_000,
      vatCents: 7_350,
      totalCents: 42_350,
    });
  });

  it('computes VAT per rate group, not per line', () => {
    // Three lines of €10.01 at 21%: per-line VAT would be 3 × round(210.21) = 3 × 210 = 630.
    // Per-group: base €30.03, VAT = round(630.63) = 631 — one cent different, and the
    // group is what the client's bookkeeping computes.
    const line = { quantity: '1.00', unitPriceCents: 1001, vatRate: '21.00' };
    const totals = computeTotals([line, line, line]);
    expect(totals.subtotalCents).toBe(3_003);
    expect(totals.vatCents).toBe(631);
  });

  it('half-up rounds the group VAT', () => {
    // €0.50 at 21% = €0.105 → half-up → €0.11
    const totals = computeTotals([{ quantity: '1.00', unitPriceCents: 50, vatRate: '21.00' }]);
    expect(totals.vatCents).toBe(11);
  });

  it('keeps 0% lines at zero VAT alongside 21% lines', () => {
    const totals = computeTotals([
      { quantity: '1.00', unitPriceCents: 10_000, vatRate: '21.00' },
      { quantity: '1.00', unitPriceCents: 5_000, vatRate: '0.00' },
    ]);
    expect(totals.subtotalCents).toBe(15_000);
    expect(totals.vatCents).toBe(2_100); // only the 21% line bears VAT
    expect(totals.breakdown).toHaveLength(2);
  });

  it('a credit note mirrors its invoice exactly', () => {
    const invoice = computeTotals([{ quantity: '10.00', unitPriceCents: 3500, vatRate: '21.00' }]);
    const credit = computeTotals([{ quantity: '10.00', unitPriceCents: -3500, vatRate: '21.00' }]);
    expect(credit.subtotalCents).toBe(-invoice.subtotalCents);
    expect(credit.vatCents).toBe(-invoice.vatCents);
    expect(credit.totalCents).toBe(-invoice.totalCents);
  });

  it('survives a many-odd-cent invoice without drift', () => {
    // 50 lines of 1.25h × €123.45 → line amount round(154.3125€) = 15431¢ each.
    const lines = Array.from({ length: 50 }, () => ({
      quantity: '1.25',
      unitPriceCents: 12_345,
      vatRate: '21.00',
    }));
    const totals = computeTotals(lines);
    expect(totals.subtotalCents).toBe(15_431 * 50); // 771550
    expect(totals.vatCents).toBe(Math.round(771_550 * 0.21)); // 162026 — one rounding, on the group
    expect(totals.totalCents).toBe(totals.subtotalCents + totals.vatCents);
  });
});

describe('treatments', () => {
  it('only domestic work bears Dutch BTW', () => {
    expect(rateForTreatment('domestic_21')).toBe('21.00');
    expect(rateForTreatment('reverse_charge')).toBe('0.00');
    expect(rateForTreatment('outside_eu')).toBe('0.00');
  });

  it('carries the legally required legend', () => {
    expect(vatLegend('domestic_21')).toBeNull();
    expect(vatLegend('reverse_charge')).toContain('BTW verlegd');
    expect(vatLegend('outside_eu')).toContain('outside the EU');
  });
});
