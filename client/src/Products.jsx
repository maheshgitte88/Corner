import React, { useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  History,
  SlidersHorizontal,
} from "lucide-react";
import { api, money, date, stockState, toCents } from "./api";
import {
  Modal,
  Field,
  Form,
  PageHeading,
  SearchBox,
  ProductImage,
  Badge,
  Empty,
  Confirm,
} from "./components";
export function ProductForm({
  product,
  categories,
  settings,
  onClose,
  onSaved,
}) {
  const [image, setImage] = useState({
      imageUrl: product?.imageUrl || "",
      imageKey: product?.imageKey || "",
    }),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  return (
    <Modal
      title={product ? "Edit product" : "Add a new product"}
      onClose={onClose}
      wide
    >
      <Form
        onCancel={onClose}
        onSubmit={async (fd) => {
          if (uploading) throw Error("Wait for the image upload");
          const v = Object.fromEntries(fd);
          for (const k of ["sellingPrice", "purchasePrice"])
            v[k] = toCents(v[k]);
          for (const k of ["stockQuantity", "minimumStock", "taxPercent"])
            if (v[k] !== undefined) v[k] = Number(v[k]);
          v.category = v.category || null;
          v.isActive = v.isActive === "true";
          await api(`/products${product ? "/" + product._id : ""}`, {
            method: product ? "PUT" : "POST",
            body: { ...v, ...image },
          });
          await onSaved();
        }}
      >
        <div className="form-grid">
          <Field
            label="Product name *"
            name="name"
            required
            defaultValue={product?.name}
          />
          <Field
            label="SKU / product code *"
            name="sku"
            required
            defaultValue={product?.sku}
          />
          <Field
            label="Barcode"
            name="barcode"
            defaultValue={product?.barcode}
          />
          <Field label="Category">
            <select name="category" defaultValue={product?.category?._id || ""}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Brand" name="brand" defaultValue={product?.brand} />
          <Field label="Unit">
            <select name="unit" defaultValue={product?.unit || "pcs"}>
              {[
                "pcs",
                "kg",
                "gram",
                "litre",
                "ml",
                "box",
                "packet",
                "custom",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Selling price (₹) *"
            name="sellingPrice"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={product ? product.sellingPrice / 100 : ""}
          />
          <Field
            label="Purchase price (₹)"
            name="purchasePrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={(product?.purchasePrice || 0) / 100}
          />
          <Field
            label="GST / tax (%)"
            name="taxPercent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue={product?.taxPercent ?? settings.defaultTax ?? 0}
          />
          {!product && (
            <Field
              label="Opening stock *"
              name="stockQuantity"
              type="number"
              min="0"
              step="0.001"
              required
              defaultValue="0"
            />
          )}
          <Field
            label="Low stock threshold"
            name="minimumStock"
            type="number"
            min="0"
            step="0.001"
            defaultValue={product?.minimumStock ?? 5}
          />
          <Field label="Status">
            <select
              name="isActive"
              defaultValue={String(product?.isActive ?? true)}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
          <Field
            label="Description"
            name="description"
            defaultValue={product?.description}
          />
        </div>
        <Field
          label={
            uploading
              ? "Uploading image…"
              : "Optional product image · PNG, JPEG or WebP · up to 5 MB"
          }
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              setUploading(true);
              setUploadError("");
              try {
                const f = new FormData();
                f.append("image", file);
                setImage(
                  await api("/upload/product-image", {
                    method: "POST",
                    body: f,
                  }),
                );
              } catch (e) {
                setUploadError(e.message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </Field>
        {uploadError && <p className="error">{uploadError}</p>}
        {image.imageUrl && (
          <div className="image-preview">
            <img src={image.imageUrl} alt="Product preview" />
            <button
              type="button"
              className="text-button"
              onClick={() => setImage({ imageUrl: "", imageKey: "" })}
            >
              Remove image
            </button>
          </div>
        )}
        {product && (
          <p className="hint">
            Change stock from Inventory to keep a complete adjustment history.
          </p>
        )}
      </Form>
    </Modal>
  );
}
export default function Products({ data, inventory = false, reload, notify }) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [edit, setEdit] = useState(null),
    [adjust, setAdjust] = useState(null),
    [archive, setArchive] = useState(null),
    [history, setHistory] = useState(null),
    [error, setError] = useState("");
  const list = data.products.filter(
    (p) =>
      `${p.name} ${p.sku} ${p.barcode || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!category || p.category?._id === category) &&
      (!status ||
        (status === "Inactive"
          ? !p.isActive
          : p.isActive && stockState(p) === status)),
  );
  const saved = async () => {
    await reload();
    setEdit(null);
    setAdjust(null);
    setArchive(null);
    notify("Inventory updated");
  };
  return (
    <>
      <PageHeading
        title={
          inventory ? "Every unit, accounted for." : "A well-stocked catalogue."
        }
        description={
          inventory
            ? "Monitor stock, record adjustments and trace every movement."
            : "Manage your products, prices and everyday essentials."
        }
        action={
          !inventory && (
            <button className="button" onClick={() => setEdit({})}>
              <Plus size={18} /> Add product
            </button>
          )
        }
      />
      <div className="filter-bar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search name, SKU or barcode…"
        />
        <select
          aria-label="Category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Stock filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All stock statuses</option>
          {["In stock", "Low stock", "Out of stock", "Inactive"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="muted">{list.length} products</span>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="panel">
        {!list.length ? (
          <Empty
            title="No products found"
            description="Try another search or add your first product."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>{inventory ? "Minimum stock" : "Selling price"}</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <div className="product-cell">
                        <ProductImage product={p} />
                        <div>
                          <b>{p.name}</b>
                          <small>{p.sku}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category?.name || "Uncategorised"}</td>
                    <td>
                      {inventory
                        ? `${p.minimumStock} ${p.unit}`
                        : money(p.sellingPrice)}
                    </td>
                    <td>
                      <b>{p.stockQuantity}</b>{" "}
                      <span className="muted">{p.unit}</span>
                    </td>
                    <td>
                      <Badge>{p.isActive ? stockState(p) : "Inactive"}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {inventory ? (
                          <>
                            <button
                              className="button small secondary"
                              onClick={() => setAdjust(p)}
                            >
                              <SlidersHorizontal size={14} /> Adjust
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Stock history for ${p.name}`}
                              onClick={async () => {
                                try {
                                  setHistory({
                                    product: p,
                                    rows: await api(
                                      "/inventory/transactions?productId=" +
                                        p._id,
                                    ),
                                  });
                                } catch (e) {
                                  setError(e.message);
                                }
                              }}
                            >
                              <History size={17} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="icon-button"
                              aria-label={`Edit ${p.name}`}
                              onClick={() => setEdit(p)}
                            >
                              <Pencil size={17} />
                            </button>
                            {p.isActive && (
                              <button
                                className="icon-button"
                                aria-label={`Archive ${p.name}`}
                                onClick={() => setArchive(p)}
                              >
                                <Archive size={17} />
                              </button>
                            )}
                          </>
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
        <ProductForm
          product={edit._id ? edit : null}
          categories={data.categories}
          settings={data.settings}
          onClose={() => setEdit(null)}
          onSaved={saved}
        />
      )}{" "}
      {adjust && (
        <Modal
          title={`Adjust · ${adjust.name}`}
          onClose={() => setAdjust(null)}
        >
          <p>
            Currently available:{" "}
            <b>
              {adjust.stockQuantity} {adjust.unit}
            </b>
          </p>
          <Form
            onCancel={() => setAdjust(null)}
            onSubmit={async (fd) => {
              await api("/products/" + adjust._id + "/stock", {
                method: "PATCH",
                body: {
                  type: fd.get("type"),
                  quantity: Number(fd.get("quantity")),
                  note: fd.get("note"),
                },
              });
              await saved();
            }}
          >
            <Field label="Adjustment type">
              <select name="type">
                {[
                  "Stock Added",
                  "Stock Reduced",
                  "Correction",
                  "Damaged",
                  "Returned",
                  "Other",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Quantity (Correction sets the new total)"
              name="quantity"
              type="number"
              min="0"
              step={
                ["kg", "gram", "litre", "ml"].includes(adjust.unit)
                  ? "0.001"
                  : "1"
              }
              required
            />
            <Field
              label="Reason / reference *"
              name="note"
              required
              minLength={1}
            />
            <p className="hint">
              Added, Returned and Other increase stock. Reduced and Damaged
              decrease stock.
            </p>
          </Form>
        </Modal>
      )}
      {archive && (
        <Confirm
          title="Archive product?"
          description={`${archive.name} will no longer be available for new bills. Its invoices and stock history will be retained.`}
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api("/products/" + archive._id, { method: "DELETE" });
            await saved();
          }}
        />
      )}
      {history && (
        <Modal
          title={`Stock history · ${history.product.name}`}
          wide
          onClose={() => setHistory(null)}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Movement</th>
                  <th>Before</th>
                  <th>Change</th>
                  <th>After</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((t) => (
                  <tr key={t._id}>
                    <td>{date(t.createdAt)}</td>
                    <td>{t.transactionType}</td>
                    <td>{t.previousQuantity}</td>
                    <td>
                      {t.quantityChange > 0 ? "+" : ""}
                      {t.quantityChange}
                    </td>
                    <td>{t.newQuantity}</td>
                    <td>{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Showing the latest 500 movements.</p>
        </Modal>
      )}
    </>
  );
}
