import React, { useState, useEffect, useCallback } from "react";
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
  Plus,
  Store,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import { api } from "./api";
import { Field, Form, Loading } from "./components";
import Dashboard from "./Dashboard";
import Products from "./Products";
import POS from "./POS";
import Invoices, { InvoiceView } from "./Invoices";
import { Directory, Settings, Reports } from "./Management";
import "./styles.css";
const navigation = [
  ["Dashboard", LayoutDashboard],
  ["POS", ShoppingBag],
  ["Products", Package],
  ["Inventory", Boxes],
  ["Categories", Tags],
  ["Customers", Users],
  ["Invoices", Receipt],
  ["Reports", ChartNoAxesCombined],
  ["Settings", SettingsIcon],
];
function App() {
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState("Dashboard"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [invoice, setInvoice] = useState(null),
    [drawer, setDrawer] = useState(false);
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
    const expire = () => {
      setUser(null);
      setData(null);
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  const reload = useCallback(async () => {
    const keys = [
      "products",
      "categories",
      "customers",
      "invoices",
      "settings",
      "dashboard",
    ];
    const values = await Promise.all(keys.map((k) => api("/" + k)));
    setData(Object.fromEntries(keys.map((k, i) => [k, values[i]])));
    setError("");
  }, []);
  useEffect(() => {
    if (user) reload().catch((e) => setError(e.message));
  }, [user, reload]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const go = (p) => {
    setPage(p);
    setDrawer(false);
  };
  if (checking) return <Loading />;
  if (!user)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <span className="brand-mark">
              <Store />
            </span>
            counter<span className="brand-dot">.</span>
          </div>
          <span className="eyebrow">A GOOD DAY STARTS AT THE COUNTER</span>
          <h1>
            Small shop.
            <br />
            Big possibilities.
          </h1>
          <p>
            From the first restock to the last receipt.
            <br />A simpler way to run your everyday.
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
              <ChartNoAxesCombined size={34} />
              <span>Room to grow.</span>
            </div>
          </div>
          <small>INVENTORY & POS · BUILT FOR YOUR EVERYDAY</small>
        </section>
        <section className="login-form">
          <div>
            <span className="eyebrow">WELCOME BACK</span>
            <h2>Open for business.</h2>
            <p>Sign in to your retail workspace.</p>
            <Form
              label="Sign in to Counter →"
              onSubmit={async (fd) =>
                setUser(
                  await api("/auth/login", {
                    method: "POST",
                    body: Object.fromEntries(fd),
                  }),
                )
              }
            >
              <Field
                label="Email address"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="owner@yourshop.com"
                required
              />
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </Form>
            <p className="hint">
              First time here? Configure your shop and run the seed command in
              the setup guide to create your admin account.
            </p>
          </div>
        </section>
      </main>
    );
  const props = { data, reload, notify: setToast, go, openInvoice: setInvoice };
  return (
    <div className="app-shell">
      {drawer && (
        <div className="drawer-scrim" onClick={() => setDrawer(false)} />
      )}
      <aside className={`sidebar ${drawer ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Dashboard");
          }}
        >
          <span className="brand-mark">
            <Store size={22} />
          </span>
          counter<span className="brand-dot">.</span>
        </a>
        <div className="shop-switch">
          <div className="shop-avatar">
            {(data?.settings.shopName || "S").slice(0, 1)}
          </div>
          <div>
            <b>{data?.settings.shopName || "Your store"}</b>
            <small>Retail workspace</small>
          </div>
          <span className="online-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navigation.map(([label, Icon], i) => (
            <React.Fragment key={label}>
              {i === 8 && <div className="nav-divider" />}
              <button
                className={page === label ? "active" : ""}
                onClick={() => go(label)}
              >
                <Icon size={19} />
                {label === "POS" ? "New bill / POS" : label}
                {label === "POS" && <span className="nav-plus">+</span>}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="store-note">
            <span className="online-dot" /> A little more organised.
            <br />
            <span>A lot more possibilities.</span>
          </div>
          <button
            className="profile"
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
                setData(null);
              } catch (e) {
                setToast(e.message);
              }
            }}
          >
            <span className="avatar">
              {user.email.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>Shop admin</b>
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
              Workspace <span>/</span>{" "}
              <b>{page === "POS" ? "New bill" : page}</b>
            </span>
          </div>
          <div className="header-right">
            <span className="today">
              {new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="header-divider" />
            <span className="live-label">
              <i className="online-dot" /> Store workspace
            </span>
            <span className="avatar small-avatar">
              {user.email[0].toUpperCase()}
            </span>
          </div>
        </header>
        <main className="workspace">
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              <button
                className="text-button"
                onClick={() => reload().catch((e) => setError(e.message))}
              >
                Retry
              </button>
            </div>
          )}
          {!data ? (
            <Loading />
          ) : page === "Dashboard" ? (
            <Dashboard {...props} />
          ) : page === "POS" ? (
            <POS {...props} />
          ) : page === "Products" || page === "Inventory" ? (
            <Products key={page} {...props} inventory={page === "Inventory"} />
          ) : page === "Invoices" ? (
            <Invoices {...props} />
          ) : page === "Customers" || page === "Categories" ? (
            <Directory key={page} {...props} type={page} />
          ) : page === "Reports" ? (
            <Reports {...props} />
          ) : (
            <Settings {...props} />
          )}
        </main>
        <footer className="workspace-footer">
          COUNTER · THE EVERYDAY RETAIL WORKSPACE
          <span>Less admin. More business.</span>
        </footer>
      </div>
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
          onCancel={async (id, reason) => {
            const updated = await api("/invoices/" + id + "/cancel", {
              method: "POST",
              body: { reason },
            });
            setInvoice(updated);
            await reload();
            setToast("Invoice cancelled and stock restored");
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
