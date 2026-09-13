import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  ArrowRight,
  UserRound,
  ScanBarcode,
  Flag,
} from "lucide-react";
import { useMobile, useMobileDialog } from "./mobile";
import { api, money, toCents, productLabel, digitsOnly, isSellable, expiryState } from "./api";
import { calculate } from "../../shared/billing";
import {
  PageHeading,
  SearchBox,
  ProductImage,
  Field,
  Empty,
  Modal,
} from "./components";

function worstExpiry(products) {
  const states = products.map((p) => expiryState(p)).filter(Boolean);
  if (states.includes("Expired")) return "Expired";
  if (states.includes("Near expiry")) return "Near expiry";
  return "";
}

function ExpiryFlag({ state }) {
  if (!state) return null;
  return (
    <span
      className={
        "expiry-flag" + (state === "Expired" ? " is-expired" : " is-near")
      }
    >
      <Flag size={11} strokeWidth={2.4} />
      {state}
    </span>
  );
}
export default function POS({
  data,
  reload,
  openInvoice,
  notify,
  draft,
  setDraft,
  attempt,
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [cart, setCart] = useState(draft.cart ?? []),
    [customerId, setCustomerId] = useState(draft.customerId ?? ""),
    [name, setName] = useState(draft.name ?? ""),
    [phone, setPhone] = useState(draft.phone ?? ""),
    [discount, setDiscount] = useState(draft.discount ?? ""),
    [discountType, setDiscountType] = useState(draft.discountType ?? "flat"),
    [paid, setPaid] = useState(draft.paid ?? ""),
    [method, setMethod] = useState(draft.method ?? "Cash"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [quantityProduct, setQuantityProduct] = useState(null);
  const [quantityValue, setQuantityValue] = useState("");
  const [sizeParent, setSizeParent] = useState(null);
  const mobile = useMobile();
  const [cartOpen, setCartOpen] = useState(false);
  const cartRef = useRef(null);
  useMobileDialog(mobile && cartOpen, cartRef, () => setCartOpen(false));
  useEffect(() => {
    setDraft({
      cart,
      customerId,
      name,
      phone,
      discount,
      discountType,
      paid,
      method,
    });
  }, [
    cart,
    customerId,
    name,
    phone,
    discount,
    discountType,
    paid,
    method,
    setDraft,
  ]);

  const sellables = data.products.filter(
    (p) => p.isActive && isSellable(p),
  );
  const variantsByParent = sellables
    .filter((p) => p.kind === "variant" && p.parentId)
    .reduce((map, p) => {
      const key = String(p.parentId);
      (map[key] ||= []).push(p);
      return map;
    }, {});
  const q = query.toLowerCase().trim();
  const exactSellable = q
    ? sellables.find(
        (p) =>
          (p.barcode && p.barcode.toLowerCase() === q) ||
          (p.sku && p.sku.toLowerCase() === q),
      )
    : null;
  const products = exactSellable
    ? [exactSellable]
    : data.products.filter((p) => {
        if (!p.isActive || p.kind === "variant") return false;
        if (category && p.category?._id !== category) return false;
        if (!q) return true;
        if (p.kind === "parent") {
          const kids = variantsByParent[p._id] || [];
          return (
            p.name.toLowerCase().includes(q) ||
            kids.some((v) =>
              `${v.variantLabel} ${v.sku} ${v.barcode || ""}`
                .toLowerCase()
                .includes(q),
            )
          );
        }
        return `${p.name} ${p.sku} ${p.barcode || ""}`
          .toLowerCase()
          .includes(q);
      });
  const update = (p, qty) => {
    setError("");
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Enter a valid quantity of zero or more.");
      return;
    }
    if (qty > p.stockQuantity) {
      setError(
        `Only ${p.stockQuantity} ${p.unit} of ${productLabel(p)} available`,
      );
      return;
    }
    setCart((old) =>
      qty <= 0
        ? old.filter((l) => l.productId !== p._id)
        : old.some((l) => l.productId === p._id)
          ? old.map((l) =>
              l.productId === p._id ? { ...l, quantity: qty } : l,
            )
          : [...old, { productId: p._id, quantity: qty, discount: 0 }],
    );
  };
  const shopName = data.settings?.shopName || "Your store";
  const openQuantity = (p) => {
    const inBill = cart.find((l) => l.productId === p._id)?.quantity || 0;
    setQuantityProduct(p);
    setQuantityValue(String(inBill || Math.min(1, p.stockQuantity)));
  };
  const addProduct = (p) => {
    if (p.kind === "parent") {
      setSizeParent(p);
      return;
    }
    update(
      p,
      (cart.find((l) => l.productId === p._id)?.quantity || 0) +
        Math.min(1, p.stockQuantity),
    );
  };
  const matchCustomerPhone = (value) => {
    setPhone(value);
    const digits = digitsOnly(value);
    if (digits.length < 6) return;
    const matches = data.customers.filter(
      (c) => digitsOnly(c.phone) === digits,
    );
    if (matches.length === 1) {
      setCustomerId(matches[0]._id);
      setName("");
      setPhone("");
    }
  };
  const lines = cart.map((l) => {
    const p = data.products.find((p) => p._id === l.productId);
    return {
      ...l,
      productName: productLabel(p),
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
      setCartOpen(false);
      openInvoice(invoice);
      notify("Sale completed. Your invoice is ready.");
      const mobile = digitsOnly(phone);
      if (mobile.length >= 10) {
        api("/invoices/" + invoice._id + "/whatsapp", { method: "POST" })
          .then((r) => notify("Invoice sent on WhatsApp to " + r.to))
          .catch(() => {});
      }
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {sizeParent && !quantityProduct && (
        <Modal
          title={`Choose size · ${sizeParent.name}`}
          onClose={() => setSizeParent(null)}
        >
          <p className="pos-modal-meta">
            {shopName}
            {sizeParent.brand ? ` · ${sizeParent.brand}` : ""}
          </p>
          <p>
            Use − / + to change quantity. Tap the count to enter an exact
            amount.
          </p>
          <div className="size-picker">
            {(variantsByParent[sizeParent._id] || [])
              .filter((v) => v.isActive)
              .map((v) => {
                const inBill =
                  cart.find((l) => l.productId === v._id)?.quantity || 0;
                const out = !v.stockQuantity && !inBill;
                return (
                  <article
                    key={v._id}
                    className={
                      "size-option" + (inBill ? " size-option-in-bill" : "")
                    }
                  >
                    <div className="size-option-info">
                      <span className="size-option-top">
                        <b>{v.variantLabel}</b>
                        <ExpiryFlag state={expiryState(v)} />
                      </span>
                      <small>
                        {v.sku} · {v.stockQuantity} {v.unit} available
                      </small>
                      <span className="size-option-meta">
                        <strong>{money(v.sellingPrice)}</strong>
                        <span>GST {v.taxPercent ?? 0}%</span>
                      </span>
                    </div>
                    <div
                      className="product-card-stepper size-option-stepper"
                      role="group"
                      aria-label={`Quantity for ${productLabel(v)}`}
                    >
                      <button
                        type="button"
                        className="product-step-button"
                        aria-label={`Decrease ${productLabel(v)}`}
                        disabled={!inBill}
                        onClick={() => update(v, Math.max(0, inBill - 1))}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        type="button"
                        className={
                          "product-quantity-button" +
                          (inBill ? " has-quantity" : "")
                        }
                        title={`${inBill} ${v.unit} in bill`}
                        aria-label={`Set quantity for ${productLabel(v)}, ${inBill} ${v.unit} in bill`}
                        disabled={out}
                        onClick={() => openQuantity(v)}
                      >
                        {inBill}
                      </button>
                      <button
                        type="button"
                        className="product-step-button"
                        aria-label={`Increase ${productLabel(v)}`}
                        disabled={inBill >= v.stockQuantity}
                        onClick={() =>
                          update(v, Math.min(v.stockQuantity, inBill + 1))
                        }
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </article>
                );
              })}
            {!(variantsByParent[sizeParent._id] || []).some((v) => v.isActive) && (
              <Empty
                title="No sizes available"
                description="Add sizes to this product in the catalogue."
              />
            )}
          </div>
        </Modal>
      )}
      {quantityProduct && (
        <Modal
          title={`Quantity · ${productLabel(quantityProduct)}`}
          onClose={() => setQuantityProduct(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(quantityValue);
              if (
                quantityValue.trim() === "" ||
                !Number.isFinite(value) ||
                value < 0 ||
                value > quantityProduct.stockQuantity
              )
                return;
              update(quantityProduct, value);
              setQuantityProduct(null);
            }}
          >
            <p className="pos-modal-meta">
              {shopName}
              {quantityProduct.brand ? ` · ${quantityProduct.brand}` : ""}
            </p>
            <div className="quantity-summary">
              <p>
                Set the total quantity in this bill.{" "}
                {quantityProduct.stockQuantity} {quantityProduct.unit}{" "}
                available.
              </p>
              <p className="quantity-summary-meta">
                {money(quantityProduct.sellingPrice)} / {quantityProduct.unit}
                {" · "}
                GST {quantityProduct.taxPercent ?? 0}%
                {quantityProduct.variantLabel
                  ? ` · Size ${quantityProduct.variantLabel}`
                  : ""}
              </p>
            </div>
            <Field label={`Quantity (${quantityProduct.unit})`}>
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                min="0"
                max={quantityProduct.stockQuantity}
                step={
                  ["kg", "gram", "litre", "ml"].includes(quantityProduct.unit)
                    ? "0.001"
                    : "1"
                }
                required
                value={quantityValue}
                onChange={(event) => setQuantityValue(event.target.value)}
              />
            </Field>
            <div className="quantity-presets" aria-label="Quick quantities">
              {[5, 10, 20, 50].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="button secondary"
                  disabled={value > quantityProduct.stockQuantity}
                  onClick={() => setQuantityValue(String(value))}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="hint">
              Enter 0 to remove this product from the bill.
            </p>
            <button className="button quantity-save" type="submit">
              Update bill
            </button>
          </form>
        </Modal>
      )}
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
            {products.map((p) => {
              const kids = variantsByParent[p._id] || [];
              const quantity =
                p.kind === "parent"
                  ? kids.reduce(
                      (s, v) =>
                        s +
                        (cart.find((line) => line.productId === v._id)
                          ?.quantity || 0),
                      0,
                    )
                  : cart.find((line) => line.productId === p._id)?.quantity ||
                    0;
              const available =
                p.kind === "parent"
                  ? kids.reduce((s, v) => s + v.stockQuantity, 0)
                  : p.stockQuantity;
              const expiry =
                p.kind === "parent" ? worstExpiry(kids) : expiryState(p);
              return (
                <article
                  key={p._id}
                  className={
                    "pos-product-card" +
                    (quantity ? " in-bill" : "") +
                    (expiry === "Expired" ? " is-expired" : "")
                  }
                >
                  <button
                    className="pos-product"
                    aria-label={`Add ${productLabel(p)} to bill`}
                    disabled={!available}
                    onClick={() => addProduct(p)}
                  >
                    <ExpiryFlag state={expiry} />
                    <ProductImage product={p} />
                    <span className="pos-category">
                      {p.category?.name || "Everyday essentials"}
                    </span>
                    <b>{productLabel(p)}</b>
                    <small>
                      {p.kind === "parent"
                        ? `${kids.length} sizes · ${available} units available${p.brand ? ` · ${p.brand}` : ""}`
                        : `${p.sku} · ${p.stockQuantity} ${p.unit} available`}
                    </small>
                    <div>
                      <strong>
                        {p.kind === "parent"
                          ? kids.length
                            ? `from ${money(Math.min(...kids.map((v) => v.sellingPrice)))}`
                            : "—"
                          : money(p.sellingPrice)}
                      </strong>
                    </div>
                  </button>
                  {p.kind === "parent" ? (
                    <div
                      className="product-card-stepper"
                      role="group"
                      aria-label={`Sizes for ${p.name}`}
                    >
                      <button
                        className={
                          "product-quantity-button" +
                          (quantity ? " has-quantity" : "")
                        }
                        title={
                          quantity
                            ? `${quantity} units in bill across sizes`
                            : "Choose a size"
                        }
                        aria-label={
                          quantity
                            ? `${quantity} units of ${p.name} in bill. Choose size to adjust.`
                            : `Choose size for ${p.name}`
                        }
                        disabled={!available && !quantity}
                        onClick={() => setSizeParent(p)}
                      >
                        {quantity || "Size"}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="product-card-stepper"
                      role="group"
                      aria-label={`Quantity for ${productLabel(p)}`}
                    >
                      <button
                        className="product-step-button"
                        aria-label={`Decrease ${productLabel(p)} on card`}
                        disabled={!quantity}
                        onClick={() => update(p, Math.max(0, quantity - 1))}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        className={
                          "product-quantity-button" +
                          (quantity ? " has-quantity" : "")
                        }
                        title={`${quantity} ${p.unit} in bill`}
                        aria-label={`Set quantity for ${productLabel(p)}, ${quantity} ${p.unit} in bill`}
                        disabled={!p.stockQuantity && !quantity}
                        onClick={() => openQuantity(p)}
                      >
                        {quantity}
                      </button>
                      <button
                        className="product-step-button"
                        aria-label={`Increase ${productLabel(p)} on card`}
                        disabled={quantity >= p.stockQuantity}
                        onClick={() =>
                          update(p, Math.min(p.stockQuantity, quantity + 1))
                        }
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!products.length && (
            <Empty
              title="No matching products"
              description="Try a different name, SKU or barcode."
            />
          )}
        </section>
        {mobile && cartOpen && (
          <div className="cart-scrim" onClick={() => setCartOpen(false)} />
        )}
        <section
          ref={cartRef}
          className={"cart panel" + (cartOpen ? " is-open" : "")}
          role={mobile && cartOpen ? "dialog" : undefined}
          aria-modal={mobile && cartOpen ? true : undefined}
          aria-label="Current bill"
        >
          <div className="panel-heading">
            <div>
              <h2>
                Current bill <span className="count">{cart.length}</span>
              </h2>
              <p>A fresh sale, a happy customer</p>
            </div>
            <ShoppingCart className="desktop-cart-icon" size={21} />
            <button
              className="icon-button cart-close"
              aria-label="Back to products"
              onClick={() => setCartOpen(false)}
            >
              <X size={22} />
            </button>
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
                        <b>{productLabel(p)}</b>
                        <small>
                          {money(p.sellingPrice)} / {p.unit}
                          {" · "}
                          GST {p.taxPercent ?? 0}%
                        </small>
                        <ExpiryFlag state={expiryState(p)} />
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${productLabel(p)}`}
                        onClick={() => update(p, 0)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="cart-item-controls">
                      <div className="quantity">
                        <button
                          aria-label={`Decrease ${productLabel(p)}`}
                          onClick={() => update(p, Math.max(0, l.quantity - 1))}
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          aria-label={`Quantity for ${productLabel(p)}`}
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
                          aria-label={`Increase ${productLabel(p)}`}
                          onClick={() => update(p, l.quantity + 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <label className="line-discount">
                        Discount ₹{" "}
                        <input
                          aria-label={`Discount for ${productLabel(p)}`}
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
                  type="tel"
                  aria-label="Customer mobile"
                  placeholder="Mobile number"
                  value={phone}
                  onChange={(e) => matchCustomerPhone(e.target.value)}
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
      {!cartOpen && error && (
        <p className="mobile-pos-error error" role="alert">
          {error}
        </p>
      )}
      <button
        className="mobile-bill-bar"
        onClick={() => setCartOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={cartOpen}
      >
        <ShoppingCart size={22} />
        <span>
          <b>View bill · {cart.length}</b>
          <small>
            {cart.length
              ? "Review & collect payment"
              : "Add products to start a sale"}
          </small>
        </span>
        <strong>{money(totals?.grandTotal || 0)}</strong>
        <ArrowRight size={19} />
      </button>
    </>
  );
}
