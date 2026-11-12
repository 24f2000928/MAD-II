// Shared state, HTTP helper and small utilities used by every component.
const store = Vue.reactive({
  user: JSON.parse(localStorage.getItem("emp_user") || "null"),
  toasts: [],
  confirm: null, // { message, resolve } for the in-page confirm dialog
});

// In-page replacement for window.confirm(), which some browsers silently block.
function askConfirm(message) {
  return new Promise((resolve) => { store.confirm = { message, resolve }; });
}

function setSession(token, user) {
  if (token) localStorage.setItem("emp_token", token);
  localStorage.setItem("emp_user", JSON.stringify(user));
  store.user = user;
}

function clearSession() {
  localStorage.removeItem("emp_token");
  localStorage.removeItem("emp_user");
  store.user = null;
}

let toastId = 0;
function toast(message, type = "success") {
  const id = ++toastId;
  store.toasts.push({ id, message, type });
  setTimeout(() => { store.toasts = store.toasts.filter((t) => t.id !== id); }, 4000);
}

const api = {
  async request(method, url, body) {
    const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem("emp_token");
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && !url.includes("/auth/login")) {
        clearSession();
        window.location.hash = "#/login";
      }
      const err = new Error((data && data.message) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url, params) {
    if (params) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
      if ([...q].length) url += "?" + q.toString();
    }
    return this.request("GET", url);
  },
  post(url, body = {}) { return this.request("POST", url, body); },
  put(url, body = {}) { return this.request("PUT", url, body); },
  del(url) { return this.request("DELETE", url); },
  async download(url, filename) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + localStorage.getItem("emp_token") } });
    if (!res.ok) {
      let msg = "Download failed";
      try { msg = (await res.json()).message || msg; } catch (e) { /* not JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

// formatting helpers (exposed to templates via app.config.globalProperties)
const fmt = {
  date(d) {
    if (!d) return "-";
    return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN",
      { day: "2-digit", month: "short", year: "numeric" });
  },
  datetime(d) {
    if (!d) return "-";
    if (!/[zZ]|[+-]\d\d:\d\d$/.test(d.slice(10))) d += "Z"; // backend stores UTC
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  },
  statusClass(s) {
    return {
      Draft: "secondary", "Slot Creation": "info", "Booking Open": "success", Closed: "warning",
      Completed: "dark", Available: "success", Full: "danger", Cancelled: "secondary",
      Booked: "primary", Absent: "danger", Active: "success", Archived: "secondary",
      Submitted: "success", "On Leave": "warning", Inactive: "secondary",
    }[s] || "secondary";
  },
  today() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); },
};
