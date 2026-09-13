import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingBag,
  Users,
  Receipt,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  Tags,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  Building2,
  CreditCard,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { api } from "./api";
import { Field, Form, Loading, BrandMark } from "./components";
import Dashboard from "./Dashboard";
import Products from "./Products";
import POS from "./POS";
import Invoices, { InvoiceView } from "./Invoices";
import PublicInvoice from "./PublicInvoice";
import { Directory, Settings, Reports } from "./Management";
import Platform from "./Platform";
import Account, { PasswordForm } from "./Account";
import "./styles.css";
import "./mobile.css";
import { useMobile, useMobileDialog } from "./mobile";
const shopNavigation = [
  ["Dashboard", LayoutDashboard],
  ["POS", ShoppingBag],
  ["Products", Package],
  ["Inventory", Boxes],
  ["Categories", Tags],
  ["Customers", Users],
  ["Invoices", Receipt],
  ["Reports", ChartNoAxesCombined],
  ["Settings", SettingsIcon],
  ["Team", Users],
  ["Subscription", CreditCard],
  ["Account", KeyRound],
];
const platformNavigation = [
  ["Overview", LayoutDashboard],
  ["Clients", Building2],
  ["Packages", Package],
  ["Payments", CreditCard],
  ["Audit log", ShieldCheck],
  ["Account", KeyRound],
];
function App() {
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState("Dashboard"),
    [data, setData] = useState(null),
    [subscription, setSubscription] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [invoice, setInvoice] = useState(null),
    [drawer, setDrawer] = useState(false);
  const mobile = useMobile();
  const drawerRef = useRef(null);
  const [draft, setDraft] = useState({});
  useMobileDialog(mobile && drawer, drawerRef, () => setDrawer(false));
  const billingAttempt = useRef(null);
  const generation = useRef(0);
  const clear = () => {
    generation.current++;
    setUser(null);
    setDraft({});
    billingAttempt.current = null;
    setDrawer(false);
    setData(null);
    setSubscription(null);
    setInvoice(null);
    setError("");
  };
  const establish = async () => {
    const ticket = ++generation.current;
    const u = await api("/auth/me");
    if (ticket !== generation.current) return;
    setData(null);
    setSubscription(null);
    setUser(u);
    setPage(u.role === "platform_admin" ? "Overview" : "Dashboard");
  };
  useEffect(() => {
    establish()
      .catch(() => {})
      .finally(() => setChecking(false));
    window.addEventListener("session-expired", clear);
    return () => window.removeEventListener("session-expired", clear);
  }, []);
  const reload = useCallback(async () => {
    const ticket = generation.current;
    const keys = [
      "products",
      "categories",
      "customers",
      "invoices",
      "settings",
      "dashboard",
    ];
    const [values, sub] = await Promise.all([
      Promise.all(keys.map((k) => api("/" + k))),
      api("/subscription"),
    ]);
    if (ticket !== generation.current) return;
    setData(Object.fromEntries(keys.map((k, i) => [k, values[i]])));
    setSubscription(sub);
    setError("");
  }, []);
  useEffect(() => {
    if (user && user.role !== "platform_admin" && !user.mustChangePassword)
      reload().catch((e) => setError(e.message));
  }, [user, reload]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      clear();
    } catch (e) {
      setToast(e.message);
    }
  };
  const go = (p) => {
    if (
      user?.role === "cashier" &&
      !["Dashboard", "POS", "Invoices", "Subscription", "Account"].includes(p)
    ) {
      setToast("This section is available to shop administrators.");
      return;
    }
    window.scrollTo({ top: 0 });
    setPage(p);
    setDrawer(false);
  };
  if (checking) return <Loading />;
  if (!user)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <BrandMark />
            counter<span className="brand-dot">.</span>
          </div>
          <span className="eyebrow">
            ONE PLATFORM. EVERY RETAIL POSSIBILITY.
          </span>
          <h1>
            More shops.
            <br />
            Same simplicity.
          </h1>
          <p>
            A workspace for every business.
            <br />
            From the first restock to the next milestone.
          </p>
          <div className="login-art">
            <div>
              <Package size={34} />
              <span>Inventory in order.</span>
            </div>
            <div>
              <Receipt size={34} />
              <span>Every sale, sorted.</span>
            </div>
            <div>
              <Building2 size={34} />
              <span>Built to grow.</span>
            </div>
          </div>
          <small>COUNTER CLOUD · RETAIL, TOGETHER</small>
        </section>
        <section className="login-form">
          <div>
            <span className="eyebrow">WELCOME TO COUNTER</span>
            <h2>Your workspace awaits.</h2>
            <p>Sign in to your shop or platform admin account.</p>
            <Form
              label="Sign in to Counter →"
              onSubmit={async (fd) => {
                await api("/auth/login", {
                  method: "POST",
                  body: Object.fromEntries(fd),
                });
                await establish();
              }}
            >
              <Field
                label="Email address"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@yourbusiness.com"
                required
              />
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Form>
            <p className="hint">
              New to Counter? Your platform administrator will create your
              workspace and share your initial login. For password help, contact
              your administrator.
            </p>
          </div>
        </section>
      </main>
    );
  if (user.mustChangePassword)
    return (
      <main className="password-onboarding">
        <div className="brand">
          <BrandMark />
          counter.
        </div>
        <PasswordForm forced done={logout} />
        <button className="text-button" onClick={logout}>
          Sign out
        </button>
      </main>
    );
  const isPlatform = user.role === "platform_admin",
    isCashier = user.role === "cashier",
    plan = subscription?.tenant.subscription.planSnapshot;
  const navigation = isPlatform
    ? platformNavigation
    : shopNavigation.filter(
        ([p]) =>
          !(
            isCashier &&
            [
              "Products",
              "Inventory",
              "Categories",
              "Customers",
              "Reports",
              "Settings",
              "Team",
            ].includes(p)
          ) && !(p === "Reports" && plan && !plan.reportsEnabled),
      );
  const mobileNavigation = isPlatform
    ? [
        ["Overview", LayoutDashboard, "Home"],
        ["Clients", Building2, "Clients"],
        ["Packages", Package, "Packages"],
        ["Payments", CreditCard, "Payments"],
      ]
    : [
        ["Dashboard", LayoutDashboard, "Home"],
        ...(!isCashier ? [["Products", Package, "Products"]] : []),
        ["POS", ShoppingBag, "New bill"],
        ["Invoices", Receipt, "Sales"],
      ];
  const readonly =
    subscription && ["expired", "suspended"].includes(subscription.access);
  const props = { data, reload, notify: setToast, go, openInvoice: setInvoice };
  return (
    <div className="app-shell">
      {drawer && (
        <div className="drawer-scrim" onClick={() => setDrawer(false)} />
      )}
      <aside
        ref={drawerRef}
        className={"sidebar " + (drawer ? "open" : "")}
        role={mobile && drawer ? "dialog" : undefined}
        aria-modal={mobile && drawer ? true : undefined}
        aria-label="Workspace navigation"
        inert={mobile && !drawer ? "" : undefined}
      >
        <button
          className="icon-button drawer-close"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        >
          <X size={22} />
        </button>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go(isPlatform ? "Overview" : "Dashboard");
          }}
        >
          <BrandMark />
          counter<span className="brand-dot">.</span>
        </a>
        <div className="shop-switch">
          <div className="shop-avatar">
            {isPlatform ? (
              <ShieldCheck size={20} />
            ) : (
              (data?.settings.shopName || "S")[0]
            )}
          </div>
          <div>
            <b>
              {isPlatform
                ? "Platform administration"
                : data?.settings.shopName || user.tenant?.name || "Your store"}
            </b>
            <small>
              {isPlatform
                ? "All client workspaces"
                : subscription?.tenant.slug || "Retail workspace"}
            </small>
          </div>
          <span className="online-dot" />
        </div>
        <span className="nav-label">
          {isPlatform ? "PLATFORM" : "WORKSPACE"}
        </span>
        <nav>
          {navigation.map(([label, Icon]) => (
            <button
              key={label}
              aria-current={page === label ? "page" : undefined}
              className={page === label ? "active" : ""}
              onClick={() => go(label)}
            >
              <Icon size={18} />
              {label === "POS" ? "New bill / POS" : label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="store-note">
            {isPlatform
              ? "Every client, supported."
              : plan?.name || "Your package"}
            <br />
            <span>
              {isPlatform
                ? "A platform built to grow."
                : subscription?.access === "trial"
                  ? "Your workspace is on trial."
                  : "A little more organised."}
            </span>
          </div>
          <button className="profile" onClick={logout}>
            <span className="avatar">{user.email[0].toUpperCase()}</span>
            <span>
              <b>
                {isPlatform
                  ? "Platform admin"
                  : isCashier
                    ? "Cashier"
                    : "Shop admin"}
              </b>
              <small>Sign out</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              {isPlatform ? "Platform" : "Workspace"} <span>/</span>{" "}
              <b>{page}</b>
            </span>
          </div>
          <div className="header-right">
            <span className="today">
              {new Date().toLocaleDateString("en-IN", { dateStyle: "medium" })}
            </span>
            <span className="avatar small-avatar">
              {user.email[0].toUpperCase()}
            </span>
          </div>
        </header>
        <main className="workspace">
          {error && (
            <div className="error">
              {error}{" "}
              <button
                className="text-button"
                onClick={() => reload().catch((e) => setError(e.message))}
              >
                Retry
              </button>
            </div>
          )}
          {readonly && (
            <div className="access-banner">
              <b>Workspace {subscription.access} · read-only</b>
              <span>
                Your existing records are available. Contact your platform
                administrator to restore billing and editing.
              </span>
              <button
                className="text-button"
                onClick={() => go("Subscription")}
              >
                View subscription
              </button>
            </div>
          )}
          {isPlatform ? (
            page === "Account" ? (
              <Account
                page={page}
                user={user}
                notify={setToast}
                logout={logout}
              />
            ) : (
              <Platform page={page} notify={setToast} go={go} />
            )
          ) : !data ? (
            <Loading />
          ) : ["Team", "Subscription", "Account"].includes(page) ? (
            <Account
              page={page}
              subscription={subscription}
              refresh={reload}
              user={user}
              notify={setToast}
              logout={logout}
            />
          ) : page === "Dashboard" ? (
            <Dashboard {...props} />
          ) : page === "POS" ? (
            readonly ? (
              <div className="saas-callout">
                Billing is paused. Renew or reactivate your workspace to create
                a new sale.
              </div>
            ) : (
              <POS
                {...props}
                draft={draft}
                setDraft={setDraft}
                attempt={billingAttempt}
              />
            )
          ) : page === "Products" || page === "Inventory" ? (
            <Products key={page} {...props} inventory={page === "Inventory"} />
          ) : page === "Invoices" ? (
            <Invoices {...props} />
          ) : page === "Customers" || page === "Categories" ? (
            <Directory key={page} {...props} type={page} />
          ) : page === "Reports" ? (
            plan?.reportsEnabled && !isCashier ? (
              <Reports {...props} />
            ) : (
              <div className="saas-callout">
                Reports are not available for this account and package.
              </div>
            )
          ) : (
            <Settings {...props} />
          )}
        </main>
        <footer className="workspace-footer">
          COUNTER CLOUD · A WORKSPACE FOR EVERY BUSINESS
          <span>Less admin. More possibilities.</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">
        {mobileNavigation.map(([target, Icon, label]) => (
          <button
            key={target}
            className={page === target ? "active" : ""}
            aria-current={page === target ? "page" : undefined}
            onClick={() => go(target)}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
        <button onClick={() => setDrawer(true)} aria-expanded={drawer}>
          <Menu size={22} />
          <span>More</span>
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {invoice && (
        <InvoiceView
          invoice={invoice}
          onClose={() => setInvoice(null)}
          canCancel={!isCashier && !readonly}
          onCancel={async (id, reason) => {
            setInvoice(
              await api("/invoices/" + id + "/cancel", {
                method: "POST",
                body: { reason },
              }),
            );
            await reload();
            setToast("Invoice cancelled and stock restored");
          }}
        />
      )}
    </div>
  );
}
const publicToken = window.location.pathname.match(
  /^\/b\/([A-Za-z0-9_-]+)$/,
);
createRoot(document.getElementById("root")).render(
  publicToken ? <PublicInvoice token={publicToken[1]} /> : <App />,
);
