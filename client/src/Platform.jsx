import { ResponsiveTable } from "./components";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  ArrowUpRight,
  Check,
  Building2,
  Users,
  IndianRupee,
  Clock3,
  ShieldCheck,
  Package as PackageIcon,
  KeyRound,
} from "lucide-react";
import { api, money, date, toCents } from "./api";
import {
  PageHeading,
  Modal,
  Form,
  Field,
  SearchBox,
  Empty,
  Loading,
  Badge,
} from "./components";
export function SubscriptionReceipt({ payment, onClose }) {
  return (
    <Modal title="Subscription receipt" wide onClose={onClose}>
      <article className="invoice-paper" id="print-invoice">
        <header className="invoice-header">
          <div>
            <h2>Counter</h2>
            <p>Subscription payment acknowledgement</p>
          </div>
          <div>
            <h3>{payment.receiptNumber}</h3>
            <p>{date(payment.createdAt)}</p>
          </div>
        </header>
        <div className="invoice-customer">
          <span className="eyebrow">CLIENT</span>
          <b>{payment.clientSnapshot.name}</b>
          <p>{payment.clientSnapshot.email}</p>
        </div>
        <div className="subscription-summary">
          <h2>
            {payment.planSnapshot.name} · {payment.cycle}
          </h2>
          <p>
            {date(payment.periodStart)} to {date(payment.periodEnd)}
          </p>
          <strong>{money(payment.amount)}</strong>
          <p>Payment method: {payment.paymentMethod}</p>
          <p>Reference: {payment.paymentReference}</p>
          <p>{payment.note}</p>
        </div>
        <footer>
          Payment recorded by the platform administrator. This is an
          acknowledgement, not a tax invoice.
        </footer>
      </article>
      <footer className="form-actions">
        <button
          className="button"
          onClick={() => {
            document.body.dataset.printFormat = "A4";
            document.getElementById("print-page-size")?.remove();
            window.print();
          }}
        >
          Print receipt
        </button>
      </footer>
    </Modal>
  );
}
function PackageForm({ value, onClose, saved }) {
  return (
    <Modal
      title={value._id ? "Edit package" : "Create package"}
      wide
      onClose={onClose}
    >
      <Form
        onCancel={onClose}
        onSubmit={async (fd) => {
          const body = Object.fromEntries(fd);
          for (const k of ["monthlyPrice", "yearlyPrice"])
            body[k] = toCents(body[k]);
          for (const k of ["maxProducts", "maxUsers"])
            body[k] = Number(body[k]);
          for (const k of ["reportsEnabled", "imagesEnabled", "isActive"])
            body[k] = body[k] === "true";
          await api("/platform/packages" + (value._id ? "/" + value._id : ""), {
            method: value._id ? "PUT" : "POST",
            body,
          });
          await saved();
        }}
      >
        <div className="form-grid">
          <Field
            label="Package name *"
            name="name"
            required
            defaultValue={value.name}
          />
          <Field
            label="Description"
            name="description"
            defaultValue={value.description}
          />
          <Field
            label="Monthly price (₹) *"
            name="monthlyPrice"
            type="number"
            required
            min="0"
            step="0.01"
            defaultValue={(value.monthlyPrice || 0) / 100}
          />
          <Field
            label="Yearly price (₹) *"
            name="yearlyPrice"
            type="number"
            required
            min="0"
            step="0.01"
            defaultValue={(value.yearlyPrice || 0) / 100}
          />
          <Field
            label="Active product limit *"
            name="maxProducts"
            type="number"
            required
            min="1"
            step="1"
            defaultValue={value.maxProducts || 100}
          />
          <Field
            label="Active user limit *"
            name="maxUsers"
            type="number"
            required
            min="1"
            step="1"
            defaultValue={value.maxUsers || 2}
          />
          {[
            ["reportsEnabled", "Sales reports"],
            ["imagesEnabled", "Product image uploads"],
            ["isActive", "Available for new subscriptions"],
          ].map(([name, label]) => (
            <Field label={label} key={name}>
              <select name={name} defaultValue={String(value[name] ?? true)}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
          ))}
        </div>
        <p className="hint">
          Existing subscriptions keep their saved package terms until renewal or
          replacement. Disabling a package stops new activations without
          affecting current clients.
        </p>
      </Form>
    </Modal>
  );
}
function SubscriptionFields({ plans, tenant, onChange }) {
  const [planId, setPlanId] = useState(
      tenant?.subscription.planId || plans.find((p) => p.isActive)?._id || "",
    ),
    [cycle, setCycle] = useState(tenant?.subscription.cycle || "monthly");
  const plan = plans.find((p) => p._id === planId);
  return (
    <>
      <div className="form-grid">
        <Field label="Package *">
          <select
            name="planId"
            required
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Choose a package</option>
            {plans
              .filter((p) => p.isActive)
              .map((p) => (
                <option value={p._id} key={p._id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Billing cycle">
          <select
            name="cycle"
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
      </div>
      {plan && (
        <div className="plan-preview">
          <b>
            {money(plan[cycle + "Price"])} /{" "}
            {cycle === "monthly" ? "month" : "year"}
          </b>
          <span>
            {plan.maxProducts.toLocaleString()} products · {plan.maxUsers} users
          </span>
        </div>
      )}
      <div className="form-grid">
        <Field label="Payment method">
          <select name="paymentMethod">
            {["Bank Transfer", "UPI", "Cash", "Card", "Other"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Payment / trial reference *"
          name="paymentReference"
          required
          placeholder="Bank reference, UPI ID or trial approval"
        />
      </div>
      <Field label="Receipt note (visible to client)" name="note" />
    </>
  );
}
function Onboard({ plans, onClose, saved }) {
  const key = useRef(crypto.randomUUID());
  return (
    <Modal title="Onboard a new client" wide onClose={onClose}>
      <Form
        label="Create client workspace"
        onCancel={onClose}
        onSubmit={async (fd) => {
          const body = Object.fromEntries(fd);
          body.trialDays = Number(body.trialDays);
          await api("/platform/clients", {
            method: "POST",
            body: { ...body, idempotencyKey: key.current },
          });
          await saved();
        }}
      >
        <div className="form-grid">
          <Field
            label="Business / shop name *"
            name="name"
            required
            minLength={2}
          />
          <Field
            label="Workspace code *"
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            placeholder="corner-and-co"
          />
          <Field label="Owner name *" name="ownerName" required />
          <Field
            label="Owner email *"
            name="ownerEmail"
            type="email"
            required
          />
          <Field
            label="Temporary password *"
            name="ownerPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <Field label="Phone" name="phone" />
          <Field
            label="Trial days (0 = paid activation)"
            name="trialDays"
            type="number"
            min="0"
            max="30"
            step="1"
            defaultValue="0"
          />
        </div>
        <SubscriptionFields plans={plans} />
        <p className="hint">
          Paid activation records the package price as received. Trials record
          ₹0. Share the login with the owner through your usual secure channel;
          they must change their temporary password on first sign-in.
        </p>
      </Form>
    </Modal>
  );
}
function ClientDetails({ id, plans, onClose, changed }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("overview"),
    [receipt, setReceipt] = useState(null),
    [reset, setReset] = useState(null);
  const key = useRef(crypto.randomUUID());
  const load = async () => {
    setDetail(await api("/platform/clients/" + id));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);
  const save = async () => {
    await load();
    await changed();
    setTab("overview");
    key.current = crypto.randomUUID();
  };
  if (!detail)
    return (
      <Modal title="Client details" onClose={onClose}>
        {error ? <p className="error">{error}</p> : <Loading />}
      </Modal>
    );
  const t = detail.tenant;
  return (
    <Modal title={t.name} wide onClose={onClose}>
      <div className="client-meta">
        <Badge>{detail.access}</Badge>
        <span>{t.slug}</span>
        <span>{t.ownerEmail}</span>
      </div>
      <div className="category-tabs">
        {["overview", "subscription", "members", "payments"].map((v) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => setTab(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="plan-preview">
            <div>
              <b>
                {t.subscription.planSnapshot.name} · {t.subscription.cycle}
              </b>
              <p>Access until {date(t.subscription.endsAt)}</p>
            </div>
            <span>
              {detail.usage.products} products · {detail.usage.users} users
            </span>
          </div>
          <Form
            onSubmit={async (fd) => {
              await api("/platform/clients/" + id, {
                method: "PATCH",
                body: { ...Object.fromEntries(fd), revision: t.revision },
              });
              await save();
            }}
          >
            <div className="form-grid">
              <Field
                label="Client name"
                name="name"
                required
                defaultValue={t.name}
              />
              <Field label="Phone" name="phone" defaultValue={t.phone} />
              <Field label="Workspace access">
                <select name="status" defaultValue={t.status}>
                  <option value="active">
                    Active (subscription dates still apply)
                  </option>
                  <option value="suspended">Suspended · read-only</option>
                </select>
              </Field>
              <Field
                label="Internal notes"
                name="notes"
                defaultValue={t.notes}
              />
            </div>
          </Form>
        </>
      )}
      {tab === "subscription" && (
        <Form
          label="Record payment & activate"
          onSubmit={async (fd) => {
            await api("/platform/clients/" + id + "/renew", {
              method: "POST",
              body: {
                ...Object.fromEntries(fd),
                revision: t.revision,
                idempotencyKey: key.current,
              },
            });
            await save();
          }}
        >
          <Field label="Activation mode">
            <select name="mode">
              <option value="extend">Extend current package and cycle</option>
              <option value="replace">
                Replace immediately with selected package
              </option>
            </select>
          </Field>
          <SubscriptionFields plans={plans} tenant={t} />
          <p className="hint">
            Extend adds a full period after the current expiry, or from today if
            expired. Replace starts a new period now and discards any remaining
            time without refund or proration. Both use the current package price
            and limits. Suspended clients remain suspended until reactivated on
            Overview.
          </p>
        </Form>
      )}
      {tab === "members" && (
        <div>
          {detail.members.map((u) => (
            <div className="purchase-row" key={u._id}>
              <div>
                <b>{u.name || u.email}</b>
                <p className="muted">
                  {u.email} · {u.role}
                </p>
              </div>
              <Badge>{u.isActive ? "Active" : "Inactive"}</Badge>
              <button className="text-button" onClick={() => setReset(u)}>
                Reset password
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === "payments" && (
        <PaymentTable rows={detail.payments} onOpen={setReceipt} />
      )}{" "}
      {receipt && (
        <SubscriptionReceipt
          payment={receipt}
          onClose={() => setReceipt(null)}
        />
      )}{" "}
      {reset && (
        <Modal
          title={"Reset password · " + reset.email}
          onClose={() => setReset(null)}
        >
          <Form
            label="Set temporary password"
            onSubmit={async (fd) => {
              await api("/platform/clients/" + id + "/reset-password", {
                method: "POST",
                body: { userId: reset._id, password: fd.get("password") },
              });
              setReset(null);
              await load();
            }}
          >
            <Field
              label="New temporary password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
            <p className="hint">
              Existing sessions are revoked. The user must change this password
              after signing in.
            </p>
          </Form>
        </Modal>
      )}
    </Modal>
  );
}
export function PaymentTable({ rows, onOpen }) {
  return rows.length ? (
    <div className="table-wrap">
      <ResponsiveTable>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Client</th>
            <th>Package</th>
            <th>Recorded</th>
            <th>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p._id}>
              <td>
                <b>{p.receiptNumber}</b>
                <small>{p.paymentMethod}</small>
              </td>
              <td>{p.clientSnapshot.name}</td>
              <td>
                {p.planSnapshot.name}
                <small>{p.cycle}</small>
              </td>
              <td>{date(p.createdAt)}</td>
              <td>{money(p.amount)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={"Open " + p.receiptNumber}
                  onClick={() => onOpen(p)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </div>
  ) : (
    <Empty
      title="No subscription payments yet"
      description="Activations and renewals will appear here."
    />
  );
}
export default function Platform({ page, notify, go }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [create, setCreate] = useState(false),
    [edit, setEdit] = useState(null),
    [client, setClient] = useState(null),
    [receipt, setReceipt] = useState(null);
  const reload = useCallback(async () => {
    const keys = ["overview", "clients", "packages", "payments", "audit"];
    const values = await Promise.all(keys.map((k) => api("/platform/" + k)));
    setData(Object.fromEntries(keys.map((k, i) => [k, values[i]])));
    setError("");
  }, []);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);
  const saved = async () => {
    await reload();
    setCreate(false);
    setEdit(null);
    notify("Saved successfully");
  };
  if (!data)
    return error ? (
      <div className="error">
        {error}
        <button onClick={() => reload().catch((e) => setError(e.message))}>
          Retry
        </button>
      </div>
    ) : (
      <Loading />
    );
  const clients = data.clients.filter(
    (t) =>
      (t.name + " " + t.ownerEmail + " " + t.slug)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!status || t.access === status),
  );
  return (
    <>
      {page === "Overview" ? (
        <>
          <PageHeading
            eyebrow="COUNTER PLATFORM"
            title="Every client. One clear view."
            description="Onboard shops, manage subscriptions and keep your business growing."
            action={
              <button className="button" onClick={() => setCreate(true)}>
                <Plus size={18} /> Onboard client
              </button>
            }
          />
          <div className="stats-grid">
            {[
              [
                "Client workspaces",
                data.overview.clients,
                `${data.overview.active} paid · ${data.overview.trials} on trial`,
              ],
              [
                "Monthly recurring value",
                money(data.overview.mrr),
                "Active paid plans, normalized monthly",
              ],
              [
                "Recorded collections",
                money(data.overview.collected),
                "All-time admin-recorded payments",
              ],
              [
                "Needs attention",
                data.overview.expired + data.overview.suspended,
                `${data.overview.expired} expired · ${data.overview.suspended} suspended`,
              ],
            ].map(([title, value, sub], i) => (
              <article
                key={title}
                className={"stat-card " + (!i ? "featured" : "")}
              >
                <span>{title}</span>
                <strong>{value}</strong>
                <small>{sub}</small>
              </article>
            ))}
          </div>
          <div className="dashboard-columns">
            <section className="panel">
              <div className="panel-heading">
                <h2>Recent subscription payments</h2>
                <button className="text-button" onClick={() => go("Payments")}>
                  View all
                </button>
              </div>
              <PaymentTable
                rows={data.overview.recentPayments}
                onOpen={setReceipt}
              />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Renewals in the next 7 days</h2>
              </div>
              {data.overview.expiring.length ? (
                data.overview.expiring.map((t) => (
                  <button
                    className="renewal-row"
                    key={t._id}
                    onClick={() => setClient(t._id)}
                  >
                    <div>
                      <b>{t.name}</b>
                      <small>{date(t.subscription.endsAt)}</small>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))
              ) : (
                <Empty
                  title="No renewals due this week"
                  description="Upcoming expiries will be listed here."
                />
              )}
            </section>
          </div>
          <div className="saas-callout">
            <ShieldCheck size={27} />
            <div>
              <b>A separate workspace for every business</b>
              <p>
                Products, customers, sales and invoices are isolated per client.
                Platform access is dedicated to onboarding and subscriptions.
              </p>
            </div>
          </div>
        </>
      ) : page === "Clients" ? (
        <>
          <PageHeading
            title="Your client community."
            description="Create workspaces and manage every subscription through its lifecycle."
            action={
              <button className="button" onClick={() => setCreate(true)}>
                <Plus size={18} /> Onboard client
              </button>
            }
          />
          <div className="filter-bar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search client, email or workspace code…"
            />
            <select
              aria-label="Client status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {["active", "trial", "expired", "suspended"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <section className="panel">
            {clients.length ? (
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Owner</th>
                      <th>Package</th>
                      <th>Access until</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((t) => (
                      <tr key={t._id}>
                        <td>
                          <b>{t.name}</b>
                          <small>{t.slug}</small>
                        </td>
                        <td>{t.ownerEmail}</td>
                        <td>
                          {t.subscription.planSnapshot.name}
                          <small>{t.subscription.cycle}</small>
                        </td>
                        <td>{date(t.subscription.endsAt)}</td>
                        <td>
                          <Badge>{t.access}</Badge>
                        </td>
                        <td>
                          <button
                            className="button small secondary"
                            onClick={() => setClient(t._id)}
                          >
                            Manage <ArrowUpRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            ) : (
              <Empty
                title="No clients found"
                description="Onboard your first client to get started."
              />
            )}
          </section>
        </>
      ) : page === "Packages" ? (
        <>
          <PageHeading
            title="Packages that grow with them."
            description="Set monthly and yearly prices, limits and included features."
            action={
              <button className="button" onClick={() => setEdit({})}>
                <Plus size={18} /> Create package
              </button>
            }
          />
          <div className="package-grid">
            {data.packages.map((p) => (
              <article className="package-card" key={p._id}>
                <div className="package-top">
                  <PackageIcon size={23} />
                  <Badge>{p.isActive ? "Available" : "Archived"}</Badge>
                </div>
                <h2>{p.name}</h2>
                <p>{p.description}</p>
                <div className="package-price">
                  {money(p.monthlyPrice)}
                  <small>/ month</small>
                </div>
                <p>{money(p.yearlyPrice)} billed yearly</p>
                <ul>
                  {[
                    `${p.maxProducts.toLocaleString()} active products`,
                    `${p.maxUsers} team members`,
                    p.reportsEnabled
                      ? "Sales reports included"
                      : "Core POS and inventory",
                    p.imagesEnabled
                      ? "Product image uploads"
                      : "Image-free catalogue",
                  ].map((f) => (
                    <li key={f}>
                      <Check size={15} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button className="button secondary" onClick={() => setEdit(p)}>
                  Edit package
                </button>
              </article>
            ))}
          </div>
        </>
      ) : page === "Payments" ? (
        <>
          <PageHeading
            title="Every renewal, on record."
            description="Payment acknowledgements preserve client, package and period details."
          />
          <section className="panel">
            <PaymentTable rows={data.payments} onOpen={setReceipt} />
          </section>
        </>
      ) : (
        <>
          <PageHeading
            title="A clear record of changes."
            description="Latest 200 onboarding, package, renewal and account actions."
          />
          <section className="panel">
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((e) => (
                    <tr key={e._id}>
                      <td>{date(e.createdAt)}</td>
                      <td>{e.actorEmail}</td>
                      <td>{e.action}</td>
                      <td className="audit-details">
                        {Object.entries(e.details || {})
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </section>
        </>
      )}
      {create && (
        <Onboard
          plans={data.packages}
          onClose={() => setCreate(false)}
          saved={saved}
        />
      )}{" "}
      {edit && (
        <PackageForm value={edit} onClose={() => setEdit(null)} saved={saved} />
      )}{" "}
      {client && (
        <ClientDetails
          id={client}
          plans={data.packages}
          onClose={() => setClient(null)}
          changed={reload}
        />
      )}{" "}
      {receipt && (
        <SubscriptionReceipt
          payment={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </>
  );
}
