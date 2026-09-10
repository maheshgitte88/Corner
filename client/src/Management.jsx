import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { api, money, date } from "./api";
import {
  PageHeading,
  Modal,
  Field,
  Form,
  SearchBox,
  Empty,
  Confirm,
  Loading,
} from "./components";
import { DateFilters } from "./Invoices";
export function Directory({ data, type, reload, notify, openInvoice }) {
  const customers = type === "Customers";
  const rows = customers ? data.customers : data.categories;
  const [query, setQuery] = useState(""),
    [edit, setEdit] = useState(null),
    [remove, setRemove] = useState(null),
    [detail, setDetail] = useState(null);
  const list = rows.filter((r) =>
    `${r.name} ${r.phone || ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const purchases = (c) => data.invoices.filter((i) => i.customer === c._id);
  return (
    <>
      <PageHeading
        title={
          customers
            ? "Familiar faces. Better service."
            : "A place for every product."
        }
        description={
          customers
            ? "Keep customer details and purchase history close at hand."
            : "Organise your catalogue into easy-to-find categories."
        }
        action={
          <button className="button" onClick={() => setEdit({})}>
            <Plus size={18} /> Add {customers ? "customer" : "category"}
          </button>
        }
      />
      <div className="filter-bar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={`Search ${type.toLowerCase()}…`}
        />
        <span className="muted">{list.length} records</span>
      </div>
      <section className="panel">
        {!list.length ? (
          <Empty
            title={`No ${type.toLowerCase()} yet`}
            description="Add your first record to get started."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>{customers ? "Contact" : "Description"}</th>
                  <th>{customers ? "Total purchases" : "Products"}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <b>{r.name}</b>
                      {!customers && !r.isActive && <small>Inactive</small>}
                    </td>
                    <td>
                      {customers ? (
                        <>
                          {r.phone || "—"}
                          <small>{r.email}</small>
                        </>
                      ) : (
                        r.description || "—"
                      )}
                    </td>
                    <td>
                      {customers
                        ? money(
                            purchases(r)
                              .filter((i) => i.status === "Completed")
                              .reduce((s, i) => s + i.grandTotal, 0),
                          )
                        : data.products.filter((p) => p.category?._id === r._id)
                            .length}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => setEdit(r)}
                        >
                          <Pencil size={17} />
                        </button>
                        {customers ? (
                          <button
                            className="icon-button"
                            aria-label={`Purchases by ${r.name}`}
                            onClick={() => setDetail(r)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        ) : (
                          <button
                            className="icon-button"
                            aria-label={`Delete ${r.name}`}
                            onClick={() => setRemove(r)}
                          >
                            <Trash2 size={17} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {edit && (
        <Modal
          title={`${edit._id ? "Edit" : "Add"} ${customers ? "customer" : "category"}`}
          onClose={() => setEdit(null)}
        >
          <Form
            onCancel={() => setEdit(null)}
            onSubmit={async (fd) => {
              const body = Object.fromEntries(fd);
              if (!customers) body.isActive = body.isActive === "true";
              await api(
                `/${type.toLowerCase()}${edit._id ? "/" + edit._id : ""}`,
                { method: edit._id ? "PUT" : "POST", body },
              );
              await reload();
              setEdit(null);
              notify("Saved successfully");
            }}
          >
            <Field
              label="Name *"
              name="name"
              required
              defaultValue={edit.name}
            />
            {customers ? (
              <>
                <Field
                  label="Mobile number"
                  name="phone"
                  defaultValue={edit.phone}
                />
                <Field
                  label="Email"
                  type="email"
                  name="email"
                  defaultValue={edit.email}
                />
                <Field
                  label="Address"
                  name="address"
                  defaultValue={edit.address}
                />
                <Field
                  label="GST number"
                  name="gstNumber"
                  defaultValue={edit.gstNumber}
                />
              </>
            ) : (
              <>
                <Field
                  label="Description"
                  name="description"
                  defaultValue={edit.description}
                />
                <Field label="Status">
                  <select
                    name="isActive"
                    defaultValue={String(edit.isActive ?? true)}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </Field>
              </>
            )}
          </Form>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="Delete category?"
          description="Only categories without products can be deleted."
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api("/categories/" + remove._id, { method: "DELETE" });
            await reload();
            setRemove(null);
            notify("Category deleted");
          }}
        />
      )}
      {detail && (
        <Modal
          title={`${detail.name} · purchase history`}
          wide
          onClose={() => setDetail(null)}
        >
          {purchases(detail).length ? (
            purchases(detail).map((i) => (
              <button
                className="purchase-row"
                key={i._id}
                onClick={() => {
                  setDetail(null);
                  openInvoice(i);
                }}
              >
                <b>{i.invoiceNumber}</b>
                <span>{date(i.createdAt)}</span>
                <span>{i.status}</span>
                <b>{money(i.grandTotal)}</b>
                <ArrowUpRight size={17} />
              </button>
            ))
          ) : (
            <Empty
              title="No purchases yet"
              description="Choose this saved customer at checkout to link their invoices."
            />
          )}
        </Modal>
      )}
    </>
  );
}
export function Settings({ data, reload, notify }) {
  const s = data.settings;
  return (
    <>
      <PageHeading
        title="Make Counter your own."
        description="Your shop details appear automatically on every new invoice."
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Shop & invoice preferences</h2>
            <p>Previous invoices keep their original details.</p>
          </div>
        </div>
        <Form
          onSubmit={async (fd) => {
            const body = Object.fromEntries(fd);
            body.defaultTax = Number(body.defaultTax);
            body.currency = "INR";
            await api("/settings", { method: "PUT", body });
            await reload();
            notify("Shop settings saved");
          }}
        >
          <div className="form-grid">
            <Field
              label="Shop name *"
              name="shopName"
              required
              defaultValue={s.shopName}
            />
            <Field label="Phone" name="phone" defaultValue={s.phone} />
            <Field label="Address" name="address" defaultValue={s.address} />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={s.email}
            />
            <Field label="GSTIN" name="gstNumber" defaultValue={s.gstNumber} />
            <Field
              label="Logo URL (HTTPS)"
              name="logoUrl"
              type="url"
              defaultValue={s.logoUrl}
            />
            <Field
              label="Invoice prefix *"
              name="invoicePrefix"
              required
              pattern="[A-Z0-9\-]{1,12}"
              defaultValue={s.invoicePrefix || "INV"}
            />
            <Field
              label="Default tax for new products (%)"
              name="defaultTax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={s.defaultTax || 0}
            />
            <Field label="Currency">
              <input value="INR · Indian rupee (₹)" disabled />
            </Field>
            <Field label="Default print layout">
              <select name="printFormat" defaultValue={s.printFormat || "A4"}>
                <option>A4</option>
                <option>80mm</option>
              </select>
            </Field>
          </div>
          <Field
            label="Invoice footer message"
            name="invoiceFooter"
            defaultValue={s.invoiceFooter}
          />
        </Form>
      </section>
    </>
  );
}
export function Reports({ data }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [report, setReport] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setReport(null);
    setError("");
    api(
      `/reports/sales?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
    )
      .then((r) => {
        if (current) setReport(r);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [from, to]);
  return (
    <>
      <PageHeading
        title="A clearer view of business."
        description="Understand your sales, popular products and payment mix. Cancelled sales are excluded."
      />
      <div className="filter-bar">
        <DateFilters {...{ from, to, setFrom, setTo }} />
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : !report ? (
        <Loading />
      ) : (
        <>
          <div className="stats-grid three">
            <article className="stat-card featured">
              <span>Net sales</span>
              <strong>{money(report.total)}</strong>
              <small>Including tax, after discounts</small>
            </article>
            <article className="stat-card">
              <span>Completed invoices</span>
              <strong>{report.count}</strong>
              <small>For the selected period</small>
            </article>
            <article className="stat-card">
              <span>Average bill</span>
              <strong>
                {money(
                  report.count ? Math.round(report.total / report.count) : 0,
                )}
              </strong>
              <small>Sales per completed invoice</small>
            </article>
          </div>
          <div className="dashboard-columns">
            <section className="panel">
              <div className="panel-heading">
                <h2>Product performance</h2>
                <span className="muted">Sorted by sales</span>
              </div>
              {report.products.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity sold</th>
                        <th>Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.products.map((p) => (
                        <tr key={p.sku}>
                          <td>
                            <b>{p.name}</b>
                            <small>{p.sku}</small>
                          </td>
                          <td>{Number(p.quantity.toFixed(3))}</td>
                          <td>{money(p.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Sales insights start with a sale" />
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Payment summary</h2>
              </div>
              {Object.entries(report.payments).map(([key, value]) => (
                <div className="payment-row" key={key}>
                  <div>
                    <b>{key}</b>
                    <span>{money(value)}</span>
                  </div>
                  <div className="bar">
                    <i
                      style={{
                        width: `${report.total ? (value / report.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {!report.count && <Empty title="No payments in this range" />}
            </section>
          </div>
          <div className="dashboard-columns">
            {[
              ["Daily sales", report.daily],
              ["Monthly sales", report.monthly],
            ].map(([title, values]) => (
              <section className="panel" key={title}>
                <div className="panel-heading">
                  <h2>{title}</h2>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(values)
                        .sort((a, b) => b[0].localeCompare(a[0]))
                        .map(([period, total]) => (
                          <tr key={period}>
                            <td>{period}</td>
                            <td>{money(total)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Low & out-of-stock products</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Available</th>
                    <th>Minimum</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products
                    .filter(
                      (p) => p.isActive && p.stockQuantity <= p.minimumStock,
                    )
                    .map((p) => (
                      <tr key={p._id}>
                        <td>{p.name}</td>
                        <td>
                          {p.stockQuantity} {p.unit}
                        </td>
                        <td>
                          {p.minimumStock} {p.unit}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
