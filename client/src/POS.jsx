import React, { useState, useRef } from "react";
import {
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  ArrowRight,
  UserRound,
  ScanBarcode,
} from "lucide-react";
import { api, money, toCents } from "./api";
import { calculate } from "../../shared/billing";
import {
  PageHeading,
  SearchBox,
  ProductImage,
  Field,
  Empty,
} from "./components";
export default function POS({ data, reload, openInvoice, notify }) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [cart, setCart] = useState([]),
    [customerId, setCustomerId] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [discount, setDiscount] = useState(""),
    [discountType, setDiscountType] = useState("flat"),
    [paid, setPaid] = useState(""),
    [method, setMethod] = useState("Cash"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef(null);
  const products = data.products.filter(
    (p) =>
      p.isActive &&
      (!category || p.category?._id === category) &&
      `${p.name} ${p.sku} ${p.barcode || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const update = (p, q) => {
    setError("");
    if (q > p.stockQuantity) {
      setError(`Only ${p.stockQuantity} ${p.unit} of ${p.name} available`);
      return;
    }
    setCart((old) =>
      q <= 0
        ? old.filter((l) => l.productId !== p._id)
        : old.some((l) => l.productId === p._id)
          ? old.map((l) => (l.productId === p._id ? { ...l, quantity: q } : l))
          : [...old, { productId: p._id, quantity: q, discount: 0 }],
    );
  };
  const lines = cart.map((l) => {
    const p = data.products.find((p) => p._id === l.productId);
    return {
      ...l,
      productName: p.name,
      sku: p.sku,
      unit: p.unit,
      unitPrice: p.sellingPrice,
      taxPercent: p.taxPercent,
    };
  });
  const billDiscount = {
    type: discountType,
    value: discountType === "flat" ? toCents(discount) : Number(discount || 0),
  };
  let totals = null,
    calculationError = "";
  try {
    if (lines.length)
      totals = calculate(lines, billDiscount, paid === "" ? 0 : toCents(paid));
  } catch (e) {
    calculationError = e.message;
  }
  const payable = paid === "" ? totals?.grandTotal || 0 : toCents(paid);
  const complete = async () => {
    if (!totals) return;
    setBusy(true);
    setError("");
    const input = {
      items: cart,
      discount: billDiscount,
      amountPaid: payable,
      paymentMethod: method,
      ...(customerId
        ? { customerId }
        : name.trim()
          ? { customer: { name: name.trim(), phone } }
          : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const invoice = await api("/invoices", {
        method: "POST",
        body: { ...input, idempotencyKey: attempt.current.key },
      });
      setCart([]);
      setPaid("");
      setDiscount("");
      setName("");
      setPhone("");
      setCustomerId("");
      attempt.current = null;
      openInvoice(invoice);
      notify("Sale completed. Your invoice is ready.");
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="AT THE COUNTER"
        title="Let’s make a sale."
        description="Find a product, build a bill, and keep the queue moving."
      />
      <fieldset className="pos-layout" disabled={busy}>
        <section className="pos-catalogue">
          <div className="pos-search">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search products or scan a barcode…"
            />
            <ScanBarcode size={23} />
          </div>
          <div className="category-tabs">
            <button
              className={!category ? "selected" : ""}
              onClick={() => setCategory("")}
            >
              All products
            </button>
            {data.categories
              .filter((c) => c.isActive)
              .map((c) => (
                <button
                  key={c._id}
                  className={category === c._id ? "selected" : ""}
                  onClick={() => setCategory(c._id)}
                >
                  {c.name}
                </button>
              ))}
          </div>
          <div className="product-grid">
            {products.map((p) => (
              <button
                className="pos-product"
                key={p._id}
                disabled={!p.stockQuantity}
                onClick={() =>
                  update(
                    p,
                    (cart.find((l) => l.productId === p._id)?.quantity || 0) +
                      Math.min(1, p.stockQuantity),
                  )
                }
              >
                <ProductImage product={p} />
                <span className="pos-category">
                  {p.category?.name || "Everyday essentials"}
                </span>
                <b>{p.name}</b>
                <small>
                  {p.sku} · {p.stockQuantity} {p.unit} available
                </small>
                <div>
                  <strong>{money(p.sellingPrice)}</strong>
                  <span className="add-circle">
                    <Plus size={18} />
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!products.length && (
            <Empty
              title="No matching products"
              description="Try a different name, SKU or barcode."
            />
          )}
        </section>
        <section className="cart panel">
          <div className="panel-heading">
            <div>
              <h2>
                Current bill <span className="count">{cart.length}</span>
              </h2>
              <p>A fresh sale, a happy customer</p>
            </div>
            <ShoppingCart size={21} />
          </div>
          <div className="cart-items">
            {!cart.length ? (
              <Empty
                title="Your bill starts here"
                description="Tap a product to add it to the bill."
              />
            ) : (
              cart.map((l, index) => {
                const p = data.products.find((p) => p._id === l.productId);
                return (
                  <div className="cart-item" key={l.productId}>
                    <div className="cart-item-heading">
                      <div>
                        <b>{p.name}</b>
                        <small>
                          {money(p.sellingPrice)} / {p.unit}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => update(p, 0)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="cart-item-controls">
                      <div className="quantity">
                        <button
                          aria-label={`Decrease ${p.name}`}
                          onClick={() => update(p, Math.max(0, l.quantity - 1))}
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          aria-label={`Quantity for ${p.name}`}
                          type="number"
                          min="0.001"
                          max={p.stockQuantity}
                          step={
                            ["kg", "gram", "litre", "ml"].includes(p.unit)
                              ? "0.001"
                              : "1"
                          }
                          value={l.quantity}
                          onChange={(e) => update(p, Number(e.target.value))}
                        />
                        <button
                          aria-label={`Increase ${p.name}`}
                          onClick={() => update(p, l.quantity + 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <label className="line-discount">
                        Discount ₹{" "}
                        <input
                          aria-label={`Discount for ${p.name}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.discount / 100}
                          onChange={(e) =>
                            setCart((old) =>
                              old.map((v) =>
                                v.productId === l.productId
                                  ? { ...v, discount: toCents(e.target.value) }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <b>{money(totals?.items[index]?.lineTotal || 0)}</b>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="cart-details">
            <label className="field">
              <span>
                <UserRound size={14} /> Customer · optional
              </span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Walk-in / enter details</option>
                {data.customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} {c.phone}
                  </option>
                ))}
              </select>
            </label>
            {!customerId && (
              <div className="form-grid compact">
                <input
                  aria-label="Customer name"
                  placeholder="Customer name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  aria-label="Customer mobile"
                  placeholder="Mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}
            <div className="bill-discount">
              <Field label="Bill discount">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <select
                aria-label="Discount type"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
              >
                <option value="flat">₹ Flat</option>
                <option value="percent">% Percent</option>
              </select>
            </div>
            <div className="totals">
              <div>
                <span>Subtotal</span>
                <b>{money(totals?.subtotal)}</b>
              </div>
              <div>
                <span>Item discounts</span>
                <b>− {money(totals?.itemDiscount)}</b>
              </div>
              <div>
                <span>Bill discount</span>
                <b>− {money(totals?.billDiscount)}</b>
              </div>
              <div>
                <span>Tax / GST</span>
                <b>{money(totals?.tax)}</b>
              </div>
              <div className="grand-total">
                <span>Total payable</span>
                <strong>{money(totals?.grandTotal)}</strong>
              </div>
            </div>
            <div className="form-grid compact">
              <Field label="Payment method">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {["Cash", "UPI", "Card", "Bank Transfer", "Other"].map(
                    (m) => (
                      <option key={m}>{m}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Amount paid (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paid}
                  placeholder={String((totals?.grandTotal || 0) / 100)}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </Field>
            </div>
            <div className="balance">
              <span>
                {payable >= (totals?.grandTotal || 0)
                  ? "Change to return"
                  : "Balance due"}
              </span>
              <b>{money(Math.abs(payable - (totals?.grandTotal || 0)))}</b>
            </div>
            {(error || calculationError) && (
              <p className="error" role="alert">
                {error || calculationError}
              </p>
            )}
            <button
              className="button checkout"
              disabled={busy || !totals}
              onClick={complete}
            >
              {busy ? "Completing sale…" : "Complete sale"}
              <ArrowRight size={19} />
            </button>
            <p className="secure-note">
              Prices and stock are verified before checkout.
            </p>
          </div>
        </section>
      </fieldset>
    </>
  );
}
