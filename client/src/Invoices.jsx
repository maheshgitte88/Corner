import { ResponsiveTable } from "./components";
import React, { useState } from "react";
import { Printer, Link2, MessageCircle } from "lucide-react";
import { api, money, date } from "./api";
import {
  Modal,
  Form,
  Field,
  PageHeading,
  SearchBox,
  Badge,
  Empty,
} from "./components";

export function InvoicePaper({ invoice, format }) {
  const shop = invoice.shopSnapshot || {},
    customer = invoice.customerSnapshot || {};
  return (
    <article
      className={`invoice-paper ${format === "80mm" ? "thermal" : ""}`}
      id="print-invoice"
    >
      <header className="invoice-header">
        <div>
          {shop.logoUrl && (
            <img className="shop-logo" src={shop.logoUrl} alt="Shop logo" />
          )}
          <h2>{shop.shopName}</h2>
          <p>{shop.address}</p>
          <p>
            {shop.phone} {shop.email}
          </p>
          {shop.gstNumber && <p>GSTIN: {shop.gstNumber}</p>}
        </div>
        <div>
          <span className="eyebrow">SALES INVOICE</span>
          <h3>{invoice.invoiceNumber}</h3>
          <p>{date(invoice.createdAt)} IST</p>
          <b>{invoice.status}</b>
        </div>
      </header>
      <div className="invoice-customer">
        <span className="eyebrow">BILLED TO</span>
        <b>{customer.name || "Walk-in Customer"}</b>
        <p>{customer.phone}</p>
        <p>{customer.address}</p>
        {customer.gstNumber && <p>GSTIN: {customer.gstNumber}</p>}
      </div>
      <table className="invoice-items">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Disc.</th>
            <th>Tax</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((l, i) => (
            <tr key={i}>
              <td>
                <b>
                  {l.variantLabel
                    ? `${l.productName} · ${l.variantLabel}`
                    : l.productName}
                </b>
                <small>{l.sku}</small>
              </td>
              <td>
                {l.quantity} {l.unit}
              </td>
              <td>{money(l.unitPrice)}</td>
              <td>{money(l.discount + l.billDiscount)}</td>
              <td>
                {money(l.tax)}
                <small>{l.taxPercent}%</small>
              </td>
              <td>{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-bottom">
        <div>
          <b>Payment: {invoice.paymentMethod}</b>
          {invoice.status === "Cancelled" && (
            <p className="cancellation">
              Cancelled: {invoice.cancellationReason}
              <br />
              {date(invoice.cancelledAt)}
            </p>
          )}
        </div>
        <div className="totals">
          <div>
            <span>Subtotal</span>
            <b>{money(invoice.subtotal)}</b>
          </div>
          <div>
            <span>Item discounts</span>
            <b>− {money(invoice.itemDiscount)}</b>
          </div>
          <div>
            <span>Bill discount</span>
            <b>− {money(invoice.billDiscount)}</b>
          </div>
          <div>
            <span>Tax / GST</span>
            <b>{money(invoice.tax)}</b>
          </div>
          <div>
            <span>Round off</span>
            <b>{money(invoice.roundOff)}</b>
          </div>
          <div className="grand-total">
            <b>Grand total</b>
            <strong>{money(invoice.grandTotal)}</strong>
          </div>
          <div>
            <span>Amount paid</span>
            <b>{money(invoice.amountPaid)}</b>
          </div>
          <div>
            <span>
              {invoice.balance < 0 ? "Change returned" : "Balance due"}
            </span>
            <b>{money(Math.abs(invoice.balance))}</b>
          </div>
        </div>
      </div>
      <footer>
        {shop.invoiceFooter || "Thank you for shopping with us."}
      </footer>
    </article>
  );
}

export function InvoiceView({ invoice, onClose, onCancel, canCancel = true }) {
  const [format, setFormat] = useState(
      invoice.shopSnapshot?.printFormat || "A4",
    ),
    [cancel, setCancel] = useState(false),
    [shareNote, setShareNote] = useState("");
  const copyLink = async () => {
    const data = invoice.shareUrl
      ? { shareUrl: invoice.shareUrl }
      : await api("/invoices/" + invoice._id + "/share", { method: "POST" });
    await navigator.clipboard.writeText(data.shareUrl);
    setShareNote("Invoice link copied");
  };
  const sendWhatsApp = async () => {
    const data = await api("/invoices/" + invoice._id + "/whatsapp", {
      method: "POST",
    });
    setShareNote("Sent on WhatsApp to " + data.to);
  };
  return (
    <Modal title="Invoice details" onClose={onClose} wide>
      <div className="invoice-toolbar">
        <Badge>{invoice.status}</Badge>
        <select
          aria-label="Print format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option>A4</option>
          <option>80mm</option>
        </select>
        <button
          className="button secondary"
          onClick={() => {
            document.body.dataset.printFormat = format;
            let style = document.getElementById("print-page-size");
            if (!style) {
              style = document.createElement("style");
              style.id = "print-page-size";
              document.head.appendChild(style);
            }
            const height = Math.max(
              100,
              Math.ceil(
                (document.getElementById("print-invoice").scrollHeight * 25.4) /
                  96,
              ) + 12,
            );
            style.textContent =
              format === "80mm"
                ? `@page { size: 80mm ${height}mm; margin: 4mm; }`
                : "@page { size: A4; margin: 12mm; }";
            window.print();
          }}
        >
          <Printer size={16} /> Print / save PDF
        </button>
        <button className="button secondary" onClick={() => copyLink().catch((e) => setShareNote(e.message))}>
          <Link2 size={16} /> Copy link
        </button>
        <button
          className="button secondary"
          onClick={() => sendWhatsApp().catch((e) => setShareNote(e.message))}
        >
          <MessageCircle size={16} /> WhatsApp
        </button>
        {invoice.status === "Completed" && canCancel && (
          <button
            className="text-button danger"
            onClick={() => setCancel(!cancel)}
          >
            Cancel sale
          </button>
        )}
      </div>
      {shareNote && <p className="invoice-share-note">{shareNote}</p>}
      {cancel && (
        <Form
          label="Cancel sale & restore stock"
          onSubmit={async (fd) => {
            await onCancel(invoice._id, fd.get("reason"));
            setCancel(false);
          }}
        >
          <p>This restores all quantities and retains the cancelled invoice.</p>
          <Field
            label="Cancellation reason *"
            name="reason"
            required
            minLength={3}
          />
        </Form>
      )}
      <InvoicePaper invoice={invoice} format={format} />
    </Modal>
  );
}
export function DateFilters({ from, to, setFrom, setTo }) {
  const setRange = (type) => {
    const now = new Date();
    const end = new Date(now);
    if (type === "Yesterday") {
      now.setDate(now.getDate() - 1);
      end.setDate(end.getDate() - 1);
    }
    if (type === "This week")
      now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    if (type === "This month") now.setDate(1);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFrom(fmt(now));
    setTo(fmt(end));
  };
  return (
    <>
      <select
        aria-label="Date range preset"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value === "All time") {
            setFrom("");
            setTo("");
          } else setRange(e.target.value);
        }}
      >
        <option value="" disabled>
          Date range
        </option>
        {["All time", "Today", "Yesterday", "This week", "This month"].map(
          (d) => (
            <option key={d}>{d}</option>
          ),
        )}
      </select>
      <input
        aria-label="From date"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => setFrom(e.target.value)}
      />
      <span className="muted">to</span>
      <input
        aria-label="To date"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => setTo(e.target.value)}
      />
    </>
  );
}
export default function Invoices({ data, openInvoice }) {
  const [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [method, setMethod] = useState("");
  const invoices = data.invoices.filter(
    (i) =>
      `${i.invoiceNumber} ${i.customerSnapshot.name} ${i.customerSnapshot.phone || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!method || i.paymentMethod === method) &&
      (!from || new Date(i.createdAt) >= new Date(from + "T00:00:00+05:30")) &&
      (!to || new Date(i.createdAt) <= new Date(to + "T23:59:59.999+05:30")),
  );
  return (
    <>
      <PageHeading
        title="Every sale has a story."
        description="Find, review and reprint your invoices in one place."
      />
      <div className="filter-bar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Invoice, customer or mobile…"
        />
        <DateFilters {...{ from, to, setFrom, setTo }} />
        <select
          aria-label="Payment filter"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="">All payments</option>
          {["Cash", "UPI", "Card", "Bank Transfer", "Other"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="range-summary">
        <span>{invoices.length} invoices in this range</span>
        <b>
          Net sales{" "}
          {money(
            invoices
              .filter((i) => i.status === "Completed")
              .reduce((s, i) => s + i.grandTotal, 0),
          )}
        </b>
      </div>
      <section className="panel">
        {!invoices.length ? (
          <Empty
            title="No invoices found"
            description="Completed bills will appear here. Try changing your filters."
          />
        ) : (
          <div className="table-wrap">
            <ResponsiveTable>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i._id}>
                    <td>
                      <b>{i.invoiceNumber}</b>
                    </td>
                    <td>{i.customerSnapshot.name}</td>
                    <td>{date(i.createdAt)}</td>
                    <td>{i.items.length}</td>
                    <td>{i.paymentMethod}</td>
                    <td className="number">{money(i.grandTotal)}</td>
                    <td>
                      <Badge>{i.status}</Badge>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${i.invoiceNumber}`}
                        onClick={() => openInvoice(i)}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        )}
      </section>
    </>
  );
}
