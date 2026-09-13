import { ResponsiveTable } from "./components";
import React, { useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  History,
  SlidersHorizontal,
  Flag,
} from "lucide-react";
import {
  api,
  money,
  date,
  stockState,
  toCents,
  productLabel,
  isSellable,
  expiryState,
  dateInput,
} from "./api";
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

const UNITS = ["pcs", "kg", "gram", "litre", "ml", "box", "packet", "custom"];
const emptyVariant = () => ({
  key: Math.random().toString(36).slice(2),
  variantLabel: "",
  sku: "",
  barcode: "",
  unit: "pcs",
  sellingPrice: "",
  purchasePrice: "0",
  taxPercent: "",
  stockQuantity: "0",
  minimumStock: "5",
  expiryFrom: "",
  expiryTo: "",
  isActive: true,
});

function parseSellable(fd, image, settings, product) {
  const v = Object.fromEntries(fd);
  for (const k of ["sellingPrice", "purchasePrice"]) v[k] = toCents(v[k]);
  for (const k of ["stockQuantity", "minimumStock", "taxPercent"])
    if (v[k] !== undefined && v[k] !== "") v[k] = Number(v[k]);
  v.category = v.category || null;
  v.isActive = v.isActive === "true";
  v.expiryFrom = v.expiryFrom || "";
  v.expiryTo = v.expiryTo || "";
  if (v.taxPercent === undefined || v.taxPercent === "")
    v.taxPercent = settings.defaultTax ?? 0;
  return { ...v, ...image };
}

export function ProductForm({
  product,
  categories,
  settings,
  onClose,
  onSaved,
}) {
  const isParent = product?.kind === "parent";
  const isVariant = product?.kind === "variant";
  const [mode, setMode] = useState(
    isParent || (product?.variants?.length ? "variants" : "simple"),
  );
  const [image, setImage] = useState({
      imageUrl: product?.imageUrl || "",
      imageKey: product?.imageKey || "",
      imageProvider: product?.imageProvider || "",
    }),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(""),
    [variants, setVariants] = useState(
      product?.variants?.length
        ? product.variants.map((v) => ({
            key: v._id,
            _id: v._id,
            variantLabel: v.variantLabel || "",
            sku: v.sku || "",
            barcode: v.barcode || "",
            unit: v.unit || "pcs",
            sellingPrice: ((v.sellingPrice || 0) / 100).toString(),
            purchasePrice: ((v.purchasePrice || 0) / 100).toString(),
            taxPercent: String(v.taxPercent ?? settings.defaultTax ?? 0),
            stockQuantity: String(v.stockQuantity ?? 0),
            minimumStock: String(v.minimumStock ?? 5),
            expiryFrom: dateInput(v.expiryFrom),
            expiryTo: dateInput(v.expiryTo),
            isActive: v.isActive !== false,
          }))
        : [emptyVariant(), emptyVariant()],
    );
  const title = product
    ? isParent
      ? "Edit product family"
      : isVariant
        ? `Edit size · ${productLabel(product)}`
        : "Edit product"
    : "Add a new product";
  return (
    <Modal title={title} onClose={onClose} wide>
      <Form
        onCancel={onClose}
        onSubmit={async (fd) => {
          if (uploading) throw Error("Wait for the image upload");
          if (!product && mode === "variants") {
            const base = Object.fromEntries(fd);
            if (variants.some((v) => !v.variantLabel.trim() || !v.sku.trim()))
              throw Error("Each size needs a label and SKU");
            await api("/products", {
              method: "POST",
              body: {
                name: base.name,
                category: base.category || null,
                brand: base.brand || "",
                description: base.description || "",
                isActive: base.isActive === "true",
                ...image,
                variants: variants.map((v) => ({
                  variantLabel: v.variantLabel,
                  sku: v.sku,
                  barcode: v.barcode,
                  unit: v.unit,
                  sellingPrice: toCents(v.sellingPrice),
                  purchasePrice: toCents(v.purchasePrice),
                  taxPercent: Number(
                    v.taxPercent === ""
                      ? (settings.defaultTax ?? 0)
                      : v.taxPercent,
                  ),
                  stockQuantity: Number(v.stockQuantity || 0),
                  minimumStock: Number(v.minimumStock || 5),
                  expiryFrom: v.expiryFrom || "",
                  expiryTo: v.expiryTo || "",
                  isActive: v.isActive !== false,
                })),
              },
            });
            await onSaved();
            return;
          }
          if (product?.kind === "parent") {
            const base = Object.fromEntries(fd);
            await api(`/products/${product._id}`, {
              method: "PUT",
              body: {
                name: base.name,
                category: base.category || null,
                brand: base.brand || "",
                description: base.description || "",
                isActive: base.isActive === "true",
                ...image,
              },
            });
            for (const v of variants) {
              const body = {
                variantLabel: v.variantLabel,
                sku: v.sku,
                barcode: v.barcode,
                unit: v.unit,
                sellingPrice: toCents(v.sellingPrice),
                purchasePrice: toCents(v.purchasePrice),
                taxPercent: Number(
                  v.taxPercent === "" ? (settings.defaultTax ?? 0) : v.taxPercent,
                ),
                minimumStock: Number(v.minimumStock || 5),
                expiryFrom: v.expiryFrom || "",
                expiryTo: v.expiryTo || "",
                isActive: v.isActive !== false,
              };
              if (v._id)
                await api(`/products/${v._id}`, { method: "PUT", body });
              else
                await api(`/products/${product._id}/variants`, {
                  method: "POST",
                  body: { ...body, stockQuantity: Number(v.stockQuantity || 0) },
                });
            }
            await onSaved();
            return;
          }
          const body = parseSellable(fd, image, settings, product);
          await api(`/products${product ? "/" + product._id : ""}`, {
            method: product ? "PUT" : "POST",
            body,
          });
          await onSaved();
        }}
      >
        {!product && (
          <div className="segmented">
            <button
              type="button"
              className={mode === "simple" ? "active" : ""}
              onClick={() => setMode("simple")}
            >
              Simple product
            </button>
            <button
              type="button"
              className={mode === "variants" ? "active" : ""}
              onClick={() => setMode("variants")}
            >
              Product with sizes / packs
            </button>
          </div>
        )}
        <div className="form-grid">
          <Field
            label="Product name *"
            name="name"
            required
            defaultValue={product?.name}
            disabled={isVariant}
          />
          {(mode === "simple" || isVariant || (product && !isParent)) &&
            !isParent && (
              <>
                {isVariant && (
                  <Field
                    label="Size / pack label *"
                    name="variantLabel"
                    required
                    defaultValue={product?.variantLabel}
                  />
                )}
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
              </>
            )}
          {!isVariant && (
            <Field label="Category">
              <select
                name="category"
                defaultValue={product?.category?._id || ""}
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!isVariant && (
            <Field label="Brand" name="brand" defaultValue={product?.brand} />
          )}
          {(mode === "simple" || isVariant || (product && !isParent)) &&
            !isParent && (
              <>
                <Field label="Unit">
                  <select name="unit" defaultValue={product?.unit || "pcs"}>
                    {UNITS.map((v) => (
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
                  defaultValue={
                    product?.taxPercent ?? settings.defaultTax ?? 0
                  }
                />
                {!product && mode === "simple" && (
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
                <Field
                  label="Expiry from"
                  name="expiryFrom"
                  type="date"
                  defaultValue={dateInput(product?.expiryFrom)}
                />
                <Field
                  label="Expiry to"
                  name="expiryTo"
                  type="date"
                  defaultValue={dateInput(product?.expiryTo)}
                />
              </>
            )}
          <Field label="Status">
            <select
              name="isActive"
              defaultValue={String(product?.isActive ?? true)}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
          {!isVariant && (
            <Field
              label="Description"
              name="description"
              defaultValue={product?.description}
            />
          )}
        </div>
        {(mode === "variants" || isParent) && (
          <div className="variant-editor">
            <div className="panel-heading">
              <div>
                <h3>Sizes / packs</h3>
                <p>Each row is its own SKU, price and stock.</p>
              </div>
              <button
                type="button"
                className="button small secondary"
                onClick={() => setVariants((rows) => [...rows, emptyVariant()])}
              >
                <Plus size={14} /> Add size
              </button>
            </div>
            {variants.map((row, index) => (
              <div className="variant-row form-grid" key={row.key}>
                <Field label="Label *">
                  <input
                    value={row.variantLabel}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, variantLabel: e.target.value }
                            : r,
                        ),
                      )
                    }
                    placeholder="500 ml / 1 kg"
                    required
                  />
                </Field>
                <Field label="SKU *">
                  <input
                    value={row.sku}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, sku: e.target.value } : r,
                        ),
                      )
                    }
                    required
                  />
                </Field>
                <Field label="Unit">
                  <select
                    value={row.unit}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, unit: e.target.value } : r,
                        ),
                      )
                    }
                  >
                    {UNITS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Selling ₹ *">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={row.sellingPrice}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, sellingPrice: e.target.value }
                            : r,
                        ),
                      )
                    }
                    required
                  />
                </Field>
                <Field label="Purchase ₹">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.purchasePrice}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, purchasePrice: e.target.value }
                            : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="GST / tax (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={row.taxPercent}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, taxPercent: e.target.value }
                            : r,
                        ),
                      )
                    }
                    placeholder={String(settings.defaultTax ?? 0)}
                  />
                </Field>
                {!row._id && (
                  <Field label="Opening stock">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.stockQuantity}
                      onChange={(e) =>
                        setVariants((rows) =>
                          rows.map((r, i) =>
                            i === index
                              ? { ...r, stockQuantity: e.target.value }
                              : r,
                          ),
                        )
                      }
                    />
                  </Field>
                )}
                <Field label="Low stock">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={row.minimumStock}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, minimumStock: e.target.value }
                            : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Expiry from">
                  <input
                    type="date"
                    value={row.expiryFrom}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, expiryFrom: e.target.value }
                            : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Expiry to">
                  <input
                    type="date"
                    value={row.expiryTo}
                    onChange={(e) =>
                      setVariants((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, expiryTo: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                {variants.length > 1 && !row._id && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setVariants((rows) => rows.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!isVariant && (
          <>
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
                  onClick={() =>
                    setImage({ imageUrl: "", imageKey: "", imageProvider: "" })
                  }
                >
                  Remove image
                </button>
              </div>
            )}
          </>
        )}
        {product && isSellable(product) && (
          <p className="hint">
            Change stock from Inventory to keep a complete adjustment history.
          </p>
        )}
      </Form>
    </Modal>
  );
}
export default function Products({
  data,
  inventory = false,
  reload,
  notify,
  readOnly = false,
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [edit, setEdit] = useState(null),
    [adjust, setAdjust] = useState(null),
    [archive, setArchive] = useState(null),
    [history, setHistory] = useState(null),
    [error, setError] = useState("");
  const variantsByParent = Object.fromEntries(
    data.products
      .filter((p) => p.kind === "variant" && p.parentId)
      .reduce((map, p) => {
        const key = String(p.parentId);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
        return map;
      }, new Map()),
  );
  const source = inventory
    ? data.products.filter(isSellable)
    : data.products.filter((p) => p.kind !== "variant");
  const list = source.filter((p) => {
    const hay = `${productLabel(p)} ${p.sku || ""} ${p.barcode || ""} ${
      (variantsByParent[p._id] || []).map((v) => v.variantLabel + v.sku).join(" ")
    }`
      .toLowerCase()
      .includes(query.toLowerCase());
    const catOk = !category || p.category?._id === category;
    const statusOk =
      !status ||
      (status === "Inactive"
        ? !p.isActive
        : isSellable(p) && p.isActive && stockState(p) === status);
    return hay && catOk && statusOk;
  });
  const saved = async () => {
    await reload();
    setEdit(null);
    setAdjust(null);
    setArchive(null);
    notify("Inventory updated");
  };
  const openEdit = async (p) => {
    if (p.kind === "parent") {
      setEdit(await api("/products/" + p._id));
    } else setEdit(p);
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
            : "Manage products, sizes/packs, prices and everyday essentials."
        }
        action={
          !inventory &&
          !readOnly && (
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
          placeholder="Search name, size, SKU or barcode…"
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
            <ResponsiveTable>
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
                {list.map((p) => {
                  const children = variantsByParent[p._id] || [];
                  const rows = inventory
                    ? [p]
                    : p.kind === "parent"
                      ? [p, ...children]
                      : [p];
                  return rows.map((row, i) => (
                    <tr
                      key={row._id}
                      className={
                        row.kind === "variant" && !inventory ? "variant-row" : ""
                      }
                    >
                      <td>
                        <div className="product-cell">
                          <ProductImage product={row.kind === "variant" ? p : row} />
                          <div>
                            <b>{productLabel(row)}</b>
                            <small>
                              {row.kind === "parent"
                                ? `${children.length} sizes / packs`
                                : row.sku}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {i === 0 || inventory
                          ? row.category?.name || "Uncategorised"
                          : ""}
                      </td>
                      <td>
                        {row.kind === "parent"
                          ? "—"
                          : inventory
                            ? `${row.minimumStock} ${row.unit}`
                            : money(row.sellingPrice)}
                      </td>
                      <td>
                        {row.kind === "parent" ? (
                          "—"
                        ) : (
                          <>
                            <b>{row.stockQuantity}</b>{" "}
                            <span className="muted">{row.unit}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <div className="status-stack">
                          {row.kind === "parent" ? (
                            <Badge>{row.isActive ? "Active" : "Inactive"}</Badge>
                          ) : (
                            <Badge>
                              {row.isActive ? stockState(row) : "Inactive"}
                            </Badge>
                          )}
                          {row.kind !== "parent" &&
                            row.isActive &&
                            expiryState(row) && (
                              <Badge
                                tone={
                                  expiryState(row) === "Expired"
                                    ? "red"
                                    : "amber"
                                }
                              >
                                <span className="badge-with-flag">
                                  <Flag size={10} strokeWidth={2.5} />
                                  {expiryState(row)}
                                </span>
                              </Badge>
                            )}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          {inventory ? (
                            <>
                              <button
                                className="button small secondary"
                                disabled={readOnly}
                                onClick={() => setAdjust(row)}
                              >
                                <SlidersHorizontal size={14} /> Adjust
                              </button>
                              <button
                                className="icon-button"
                                aria-label={`Stock history for ${productLabel(row)}`}
                                onClick={async () => {
                                  try {
                                    setHistory({
                                      product: row,
                                      rows: await api(
                                        "/inventory/transactions?productId=" +
                                          row._id,
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
                                aria-label={`Edit ${productLabel(row)}`}
                                disabled={readOnly}
                                onClick={() => openEdit(row)}
                              >
                                <Pencil size={17} />
                              </button>
                              {row.isActive && (
                                <button
                                  className="icon-button"
                                  aria-label={`Archive ${productLabel(row)}`}
                                  disabled={readOnly}
                                  onClick={() => setArchive(row)}
                                >
                                  <Archive size={17} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </ResponsiveTable>
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
          title={`Adjust stock · ${productLabel(adjust)}`}
          onClose={() => setAdjust(null)}
        >
          <div className="adjust-summary">
            <ProductImage product={adjust} />
            <div>
              <b>{productLabel(adjust)}</b>
              <small>
                SKU {adjust.sku || "—"}
                {adjust.kind === "variant" && adjust.variantLabel
                  ? ` · Size/pack ${adjust.variantLabel}`
                  : ""}
                {` · Unit ${adjust.unit}`}
              </small>
              <div className="adjust-badges">
                <Badge>{stockState(adjust)}</Badge>
                {expiryState(adjust) ? (
                  <Badge>{expiryState(adjust)}</Badge>
                ) : null}
              </div>
              <p>
                Available now:{" "}
                <b>
                  {adjust.stockQuantity} {adjust.unit}
                </b>
                <span className="muted">
                  {" "}
                  · Low-stock alert at {adjust.minimumStock} {adjust.unit}
                </span>
              </p>
              {(adjust.expiryFrom || adjust.expiryTo) && (
                <p className="hint">
                  Expiry window:{" "}
                  {adjust.expiryFrom
                    ? new Date(adjust.expiryFrom).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })
                    : "—"}{" "}
                  →{" "}
                  {adjust.expiryTo
                    ? new Date(adjust.expiryTo).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })
                    : "—"}
                </p>
              )}
            </div>
          </div>
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
              label={`Quantity in ${adjust.unit} (Correction sets the new total)`}
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
              placeholder={
                adjust.kind === "variant"
                  ? `e.g. Restock ${adjust.variantLabel}`
                  : "e.g. Supplier delivery"
              }
            />
            <p className="hint">
              Stock is adjusted for this sellable size/pack only
              {adjust.kind === "variant"
                ? ` (${adjust.variantLabel}). Other sizes of ${adjust.name} are unchanged.`
                : "."}{" "}
              Added, Returned and Other increase stock. Reduced and Damaged
              decrease stock.
            </p>
          </Form>
        </Modal>
      )}
      {archive && (
        <Confirm
          title="Archive product?"
          description={`${productLabel(archive)} will no longer be available for new bills. Its invoices and stock history will be retained.`}
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api("/products/" + archive._id, { method: "DELETE" });
            await saved();
          }}
        />
      )}
      {history && (
        <Modal
          title={`Stock history · ${productLabel(history.product)}`}
          wide
          onClose={() => setHistory(null)}
        >
          <p className="hint">
            SKU {history.product.sku || "—"}
            {history.product.variantLabel
              ? ` · ${history.product.variantLabel}`
              : ""}
            {history.product.expiryTo
              ? ` · Expires ${new Date(history.product.expiryTo).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`
              : ""}
          </p>
          <div className="table-wrap">
            <ResponsiveTable>
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
            </ResponsiveTable>
          </div>
          <p className="hint">Showing the latest 500 movements.</p>
        </Modal>
      )}
    </>
  );
}
