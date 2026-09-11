import { ResponsiveTable } from "./components";
import React, { useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Receipt,
  Package,
  IndianRupee,
  AlertTriangle,
  ShoppingBag,
  ArrowRight,
} from "lucide-react";
import { money, date, stockState } from "./api";
import { PageHeading, ProductImage, Badge, Empty } from "./components";
export default function Dashboard({ data, go, openInvoice }) {
  const d = data.dashboard;
  const cards = [
    [
      "Sales today",
      money(d.todaySales),
      `${d.todayInvoices} invoices completed`,
      IndianRupee,
    ],
    [
      "Sales this month",
      money(d.monthSales),
      "Completed sales · net of cancellations",
      Receipt,
    ],
    [
      "Active products",
      d.totalProducts,
      `${d.totalQuantity.toLocaleString("en-IN")} units across inventory`,
      Package,
    ],
    [
      "Needs attention",
      d.lowStock.length + d.outOfStock,
      `${d.outOfStock} out of stock`,
      AlertTriangle,
    ],
  ];
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE CLARITY FOR YOUR EVERYDAY"
        title="Your store, at a glance."
        description="Everything you need to keep business moving."
        action={
          <button className="button" onClick={() => go("POS")}>
            <Plus size={18} /> Create new bill
          </button>
        }
      />
      <div className="stats-grid">
        {cards.map(([label, value, sub, Icon], i) => (
          <article
            className={`stat-card ${i === 0 ? "featured" : ""}`}
            key={label}
          >
            <div className="stat-label">
              {label}
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <span>{sub}</span>
          </article>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent invoices</h2>
              <p>Your latest activity at the counter</p>
            </div>
            <button className="text-button" onClick={() => go("Invoices")}>
              View all <ArrowUpRight size={16} />
            </button>
          </div>
          {!d.recent.length ? (
            <Empty
              title="Ready for your first sale"
              description="Create a bill and your latest invoices will appear here."
            />
          ) : (
            <div className="table-wrap">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Invoice / customer</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((i) => (
                    <tr key={i._id}>
                      <td>
                        <b>{i.invoiceNumber}</b>
                        <small>{i.customerSnapshot.name}</small>
                      </td>
                      <td>{date(i.createdAt)}</td>
                      <td className="number">{money(i.grandTotal)}</td>
                      <td>
                        <Badge>{i.status}</Badge>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Open ${i.invoiceNumber}`}
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
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Stock watch</h2>
              <p>A little restock goes a long way</p>
            </div>
            <span className="count">{d.lowStock.length}</span>
          </div>
          {d.lowStock.length ? (
            d.lowStock.slice(0, 5).map((p) => (
              <div className="stock-row" key={p._id}>
                <ProductImage product={p} />
                <div>
                  <b>{p.name}</b>
                  <small>{p.sku}</small>
                </div>
                <span className="stock-count">
                  {p.stockQuantity} <small>{p.unit} left</small>
                </span>
              </div>
            ))
          ) : (
            <Empty
              title="Stock looks good"
              description="No active products are running low."
            />
          )}
          <button className="panel-link" onClick={() => go("Inventory")}>
            Manage inventory <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="quick-grid">
        <button onClick={() => go("Products")}>
          <span className="quick-icon">
            <Package />
          </span>
          <div>
            <b>Make room for something new</b>
            <p>Add a product to your catalogue</p>
          </div>
          <ArrowUpRight />
        </button>
        <button onClick={() => go("Reports")}>
          <span className="quick-icon">
            <ShoppingBag />
          </span>
          <div>
            <b>Know what’s selling</b>
            <p>Explore sales and product performance</p>
          </div>
          <ArrowUpRight />
        </button>
      </div>
    </>
  );
}
