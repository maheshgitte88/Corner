import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../shared/billing.js";
const item = (overrides = {}) => ({
  productId: "one",
  productName: "Rice",
  unit: "pcs",
  unitPrice: 10000,
  quantity: 2,
  taxPercent: 5,
  discount: 0,
  ...overrides,
});
test("calculates supplied bill with proportionate discount before GST", () => {
  const v = calculate(
    [item(), item({ productId: "two", unitPrice: 25000, quantity: 1 })],
    { type: "flat", value: 2000 },
    50000,
  );
  assert.equal(v.subtotal, 45000);
  assert.equal(v.tax, 2150);
  assert.equal(v.grandTotal, 45150);
  assert.equal(v.balance, -4850);
});
test("weighted quantity and fractional money use decimal rounding", () => {
  const v = calculate([
    item({ unit: "kg", quantity: 2.5, unitPrice: 10000, taxPercent: 0 }),
  ]);
  assert.equal(v.grandTotal, 25000);
  assert.equal(
    calculate([
      item({ unit: "kg", quantity: 0.125, unitPrice: 19950, taxPercent: 0 }),
    ]).grandTotal,
    2494,
  );
});
test("item and percentage discounts are reflected in each line", () => {
  const v = calculate([item({ discount: 1000 })], {
    type: "percent",
    value: 10,
  });
  assert.equal(v.itemDiscount, 1000);
  assert.equal(v.billDiscount, 1900);
  assert.equal(v.tax, 855);
  assert.equal(v.grandTotal, 17955);
  assert.equal(v.items[0].lineTotal, v.grandTotal);
});
test("allocated discount and mixed taxes reconcile", () => {
  const v = calculate(
    [
      item({ quantity: 1, unitPrice: 101, taxPercent: 5 }),
      item({ quantity: 1, unitPrice: 202, taxPercent: 18 }),
      item({ quantity: 1, unitPrice: 303, taxPercent: 0 }),
    ],
    { type: "flat", value: 101 },
  );
  assert.equal(
    v.items.reduce((s, i) => s + i.billDiscount, 0),
    101,
  );
  assert.equal(
    v.items.reduce((s, i) => s + i.lineTotal, 0),
    v.grandTotal,
  );
});
test("zero-total sale remains valid with full discount", () => {
  const v = calculate([item()], { type: "percent", value: 100 });
  assert.equal(v.tax, 0);
  assert.equal(v.grandTotal, 0);
});
test("rejects invalid discounts, quantities and payment", () => {
  for (const quantity of [0, -1, NaN, Infinity, 1.0001, 1.5])
    assert.throws(() => calculate([item({ quantity })]));
  for (const discount of [
    { type: "flat", value: 50000 },
    { type: "flat", value: 1.2 },
    { type: "percent", value: 101 },
    { type: "flat", value: -1 },
  ])
    assert.throws(() => calculate([item()], discount));
  assert.throws(() => calculate([item({ discount: 20001 })]));
  assert.throws(() => calculate([item()], undefined, -1));
  assert.throws(() => calculate([]));
});
test("many penny lines never produce negative allocations or taxes", () => {
  const v = calculate(
    Array.from({ length: 10 }, (_, i) =>
      item({
        productId: String(i),
        unitPrice: 1,
        quantity: 1,
        taxPercent: 100,
      }),
    ),
    { type: "flat", value: 4 },
  );
  assert.equal(
    v.items.reduce((s, i) => s + i.billDiscount, 0),
    4,
  );
  for (const l of v.items) {
    assert.ok(l.billDiscount <= l.gross);
    assert.ok(l.lineTotal >= 0);
    assert.ok(l.tax >= 0);
  }
  assert.equal(v.grandTotal, 12);
});
