import Decimal from "decimal.js";
const D = (value) => new Decimal(value);
export const money = (value) =>
  D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
export function calculate(
  items,
  discount = { type: "flat", value: 0 },
  amountPaid = 0,
) {
  if (!items.length) throw new Error("Add at least one item");
  const lines = items.map((item) => {
    if (
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      D(item.quantity).decimalPlaces() > 3
    )
      throw new Error("Quantity must be positive with at most 3 decimals");
    if (
      !["kg", "gram", "litre", "ml"].includes(item.unit) &&
      !Number.isInteger(item.quantity)
    )
      throw new Error("This unit requires a whole quantity");
    if (
      !Number.isSafeInteger(item.unitPrice) ||
      item.unitPrice <= 0 ||
      !Number.isFinite(item.taxPercent) ||
      item.taxPercent < 0 ||
      item.taxPercent > 100
    )
      throw new Error("Invalid product pricing");
    const gross = money(D(item.unitPrice).mul(item.quantity));
    const itemDiscount = item.discount || 0;
    if (
      !Number.isSafeInteger(itemDiscount) ||
      itemDiscount < 0 ||
      itemDiscount > gross
    )
      throw new Error("Invalid item discount");
    return {
      ...item,
      gross,
      discount: itemDiscount,
      taxable: gross - itemDiscount,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.gross, 0);
  const itemDiscount = lines.reduce((s, l) => s + l.discount, 0);
  const base = subtotal - itemDiscount;
  if (
    !["flat", "percent"].includes(discount.type) ||
    !Number.isFinite(discount.value) ||
    discount.value < 0 ||
    (discount.type === "percent" && discount.value > 100) ||
    (discount.type === "flat" && !Number.isSafeInteger(discount.value))
  )
    throw new Error("Invalid bill discount");
  const billDiscount =
    discount.type === "percent"
      ? money(D(base).mul(discount.value).div(100))
      : discount.value;
  if (billDiscount > base) throw new Error("Discount exceeds subtotal");
  // Largest-remainder allocation: no line can receive more than its taxable base.
  const shares = lines.map((line, index) => {
    const exact = base ? D(billDiscount).mul(line.taxable).div(base) : D(0);
    const floor = exact.floor().toNumber();
    return { index, value: floor, remainder: exact.minus(floor) };
  });
  let remaining = billDiscount - shares.reduce((s, x) => s + x.value, 0);
  for (const share of [...shares].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index,
  )) {
    if (!remaining) break;
    share.value++;
    remaining--;
  }
  lines.forEach((line, i) => {
    line.billDiscount = shares[i].value;
    line.tax = money(
      D(line.taxable - line.billDiscount)
        .mul(line.taxPercent)
        .div(100),
    );
    line.lineTotal = line.taxable - line.billDiscount + line.tax;
    delete line.taxable;
  });
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const grandTotal = subtotal - itemDiscount - billDiscount + tax;
  if (!Number.isSafeInteger(grandTotal) || grandTotal > 1e12)
    throw new Error("Bill is too large");
  if (!Number.isSafeInteger(amountPaid) || amountPaid < 0 || amountPaid > 1e12)
    throw new Error("Invalid amount paid");
  return {
    items: lines,
    subtotal,
    itemDiscount,
    billDiscount,
    discount: itemDiscount + billDiscount,
    tax,
    roundOff: 0,
    grandTotal,
    amountPaid,
    balance: grandTotal - amountPaid,
  };
}
