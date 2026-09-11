import React, { useState, useRef } from "react";
import { useMobileDialog } from "./mobile";
import { X, Package, Search, LoaderCircle } from "lucide-react";
export function Modal({ title, children, onClose, wide = false }) {
  const dialogRef = useRef(null);
  useMobileDialog(true, dialogRef, onClose);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
export function SearchBox({ value, onChange, placeholder = "Search…" }) {
  return (
    <div className="search">
      <Search size={18} />
      <input
        aria-label={placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function ProductImage({ product }) {
  return (
    <div className={`product-image tone-${(product.name || "").length % 4}`}>
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <Package size={24} strokeWidth={1.5} />
      )}
    </div>
  );
}
export function Badge({ children }) {
  return (
    <span
      className={`badge ${["Low stock", "Cancelled", "trial", "expired", "suspended", "Archived", "Inactive"].includes(children) ? "amber" : children === "Out of stock" ? "red" : "green"}`}
    >
      {children}
    </span>
  );
}
export function Empty({
  title = "Nothing here yet",
  description = "New records will appear here.",
}) {
  return (
    <div className="empty">
      <Package size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <p>Loading your workspace…</p>
    </div>
  );
}
export function Form({ children, onSubmit, label = "Save changes", onCancel }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          await onSubmit(new FormData(e.currentTarget));
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : label}
        </button>
      </footer>
    </form>
  );
}
export function Confirm({ title, description, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <Form onSubmit={onConfirm} label="Confirm" onCancel={onClose}>
        <p>{description}</p>
      </Form>
    </Modal>
  );
}
export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow || "YOUR RETAIL WORKSPACE"}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

// Retain table semantics on desktop and provide explicit labels for phone cards.
export function ResponsiveTable({ children }) {
  const sections = React.Children.toArray(children);
  const head = sections.find((section) => section.type === "thead");
  const row = React.Children.toArray(head?.props.children)[0];
  const labels = React.Children.toArray(row?.props.children).map(
    (cell) => cell.props.children || "Actions",
  );
  return (
    <table className="responsive-table" role="table">
      {sections.map((section) =>
        section.type !== "tbody"
          ? section
          : React.cloneElement(
              section,
              {},
              React.Children.map(section.props.children, (row) =>
                React.isValidElement(row)
                  ? React.cloneElement(
                      row,
                      { role: "row" },
                      React.Children.map(row.props.children, (cell, index) =>
                        React.isValidElement(cell)
                          ? React.cloneElement(
                              cell,
                              { role: "cell" },
                              <>
                                <span
                                  className="mobile-cell-label"
                                  aria-hidden="true"
                                >
                                  {labels[index]}
                                </span>
                                <div className="mobile-cell-value">
                                  {cell.props.children}
                                </div>
                              </>,
                            )
                          : cell,
                      ),
                    )
                  : row,
              ),
            ),
      )}
    </table>
  );
}
