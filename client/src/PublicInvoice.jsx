import React, { useEffect, useState } from "react";
import { InvoicePaper } from "./Invoices";
import { BrandMark } from "./components";

export default function PublicInvoice({ token }) {
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/public/invoices/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(data.message || "Invoice not found");
        setInvoice(data);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="public-invoice">
      <header className="public-invoice-bar">
        <BrandMark />
        <span>Tax invoice</span>
      </header>
      {error && <p className="public-invoice-error">{error}</p>}
      {!error && !invoice && <p className="muted">Loading invoice…</p>}
      {invoice && (
        <>
          <div className="invoice-toolbar">
            <button
              className="button secondary"
              onClick={() => window.print()}
            >
              Print / save PDF
            </button>
          </div>
          <InvoicePaper
            invoice={invoice}
            format={invoice.shopSnapshot?.printFormat || "A4"}
          />
        </>
      )}
    </div>
  );
}
