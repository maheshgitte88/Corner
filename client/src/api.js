export async function api(path, options = {}) {
  const form = options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: form
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers },
    body: options.body
      ? form
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({
      message: "Server is unavailable. Check that the backend is running.",
    }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.message || "Request failed");
  }
  return data;
}
export const money = (v) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((v || 0) / 100);
export const date = (v) =>
  new Date(v).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
export const toCents = (v) => Math.round(Number(v || 0) * 100);
export const stockState = (p) =>
  p.stockQuantity === 0
    ? "Out of stock"
    : p.stockQuantity <= p.minimumStock
      ? "Low stock"
      : "In stock";
