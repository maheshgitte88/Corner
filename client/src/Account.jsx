import { ResponsiveTable } from "./components";
import React, { useState, useEffect } from "react";
import { Plus, KeyRound } from "lucide-react";
import { api, date } from "./api";
import { PageHeading, Form, Field, Modal, Loading, Badge } from "./components";
import { PaymentTable, SubscriptionReceipt } from "./Platform";
export function PasswordForm({ done, forced = false }) {
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <h2>{forced ? "Set your own password" : "Change password"}</h2>
          <p>
            {forced
              ? "Replace your temporary password before opening your workspace."
              : "Changing your password signs out all existing sessions."}
          </p>
        </div>
      </div>
      <Form
        label="Change password & sign out"
        onSubmit={async (fd) => {
          await api("/auth/password", {
            method: "POST",
            body: Object.fromEntries(fd),
          });
          done();
        }}
      >
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label="New password · at least 12 characters"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Form>
    </section>
  );
}
export default function Account({
  page,
  subscription,
  refresh,
  user,
  notify,
  logout,
}) {
  const [members, setMembers] = useState(null),
    [error, setError] = useState(""),
    [add, setAdd] = useState(false),
    [reset, setReset] = useState(null),
    [receipt, setReceipt] = useState(null);
  const load = async () => setMembers(await api("/team"));
  useEffect(() => {
    if (page === "Team") load().catch((e) => setError(e.message));
  }, [page]);
  const saved = async () => {
    await load();
    await refresh();
    setAdd(false);
    setReset(null);
    notify("Team updated");
  };
  const t = subscription?.tenant,
    plan = t?.subscription.planSnapshot;
  return (
    <>
      {page === "Account" ? (
        <>
          <PageHeading
            title="Your account, secured."
            description={user.email}
          />
          <PasswordForm done={logout} />
        </>
      ) : page === "Subscription" ? (
        <>
          <PageHeading
            title="A plan for your business."
            description="Your package, usage and subscription payment history."
          />
          {t && (
            <>
              <section className="panel subscription-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">CURRENT PACKAGE</span>
                    <h2>{plan.name}</h2>
                    <p>
                      {t.name} · {t.subscription.cycle}
                    </p>
                  </div>
                  <Badge>{subscription.access}</Badge>
                </div>
                <div className="subscription-stats">
                  <div>
                    <span>Access until</span>
                    <b>{date(t.subscription.endsAt)}</b>
                  </div>
                  <div>
                    <span>Active products</span>
                    <b>
                      {subscription.usage.products} / {plan.maxProducts}
                    </b>
                  </div>
                  <div>
                    <span>Team members</span>
                    <b>
                      {subscription.usage.users} / {plan.maxUsers}
                    </b>
                  </div>
                </div>
                <div className="subscription-note">
                  Contact your platform administrator for renewals, plan changes
                  or payment queries. Payments are recorded manually; there is
                  no automatic charge.
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Payment history</h2>
                </div>
                <PaymentTable
                  rows={subscription.payments}
                  onOpen={setReceipt}
                />
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <PageHeading
            title="Your people, at the counter."
            description="Manage shop administrators and cashiers within your package limit."
            action={
              <button className="button" onClick={() => setAdd(true)}>
                <Plus size={18} /> Add team member
              </button>
            }
          />
          {error && <p className="error">{error}</p>}
          {!members ? (
            <Loading />
          ) : (
            <section className="panel">
              <div className="table-wrap">
                <ResponsiveTable>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m._id}>
                        <td>
                          <b>{m.name || m.email}</b>
                          <small>{m.email}</small>
                        </td>
                        <td>
                          {m.role === "cashier" ? "Cashier" : "Shop admin"}
                        </td>
                        <td>
                          <Badge>{m.isActive ? "Active" : "Inactive"}</Badge>
                        </td>
                        <td>
                          {m.email !== user.email && (
                            <div className="row-actions">
                              <button
                                className="text-button"
                                onClick={() => setReset(m)}
                              >
                                Reset password
                              </button>
                              {m.email !== t?.ownerEmail && (
                                <button
                                  className="button secondary small"
                                  onClick={async () => {
                                    try {
                                      await api("/team/" + m._id, {
                                        method: "PATCH",
                                        body: { isActive: !m.isActive },
                                      });
                                      await saved();
                                    } catch (e) {
                                      setError(e.message);
                                    }
                                  }}
                                >
                                  {m.isActive ? "Deactivate" : "Activate"}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            </section>
          )}
        </>
      )}
      {add && (
        <Modal title="Add team member" onClose={() => setAdd(false)}>
          <Form
            onCancel={() => setAdd(false)}
            onSubmit={async (fd) => {
              await api("/team", {
                method: "POST",
                body: Object.fromEntries(fd),
              });
              await saved();
            }}
          >
            <Field label="Full name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Field
              label="Temporary password"
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
            <Field label="Role">
              <select name="role">
                <option value="cashier">
                  Cashier · billing and read access
                </option>
                <option value="client_admin">
                  Shop admin · full shop management
                </option>
              </select>
            </Field>
            <p className="hint">
              The team member must change their temporary password when signing
              in.
            </p>
          </Form>
        </Modal>
      )}
      {reset && (
        <Modal
          title={"Reset password · " + reset.email}
          onClose={() => setReset(null)}
        >
          <Form
            label="Set temporary password"
            onSubmit={async (fd) => {
              await api("/team/" + reset._id + "/reset-password", {
                method: "POST",
                body: { password: fd.get("password") },
              });
              await saved();
            }}
          >
            <Field
              label="New temporary password"
              name="password"
              type="password"
              minLength={12}
              required
              autoComplete="new-password"
            />
          </Form>
        </Modal>
      )}
      {receipt && (
        <SubscriptionReceipt
          payment={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </>
  );
}
