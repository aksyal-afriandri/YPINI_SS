const API_BASE = "https://cubbyhole-stem-viselike.ngrok-free.dev/api";
const API_TOKEN_KEY = "ypini_api_token";

async function apiRequest(path, options = {}) {
  const { auth = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("ngrok-skip-browser-warning", "true");
  const token = sessionStorage.getItem(API_TOKEN_KEY);

  if (auth && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });
  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const validationMessage = result?.errors
      ? Object.values(result.errors).flat().join(" ")
      : null;
    throw new Error(validationMessage || result?.message || `Request gagal (${response.status}).`);
  }

  return result;
}

async function apiLogin(credentials) {
  const result = await apiRequest("/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    auth: false,
  });

  sessionStorage.setItem(API_TOKEN_KEY, result.token);
  return result;
}

async function apiLogout() {
  try {
    await apiRequest("/logout", { method: "POST" });
  } finally {
    sessionStorage.removeItem(API_TOKEN_KEY);
  }
}

function apiGet(path) {
  return apiRequest(path);
}

async function apiGetBlob(path) {
  const headers = new Headers({
    Authorization: `Bearer ${sessionStorage.getItem(API_TOKEN_KEY) || ""}`,
    "ngrok-skip-browser-warning": "true",
  });
  const response = await fetch(`${API_BASE}${path}`, { headers });

  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.message || `Request gagal (${response.status}).`);
  }

  return URL.createObjectURL(await response.blob());
}

function apiPost(path, payload) {
  return apiRequest(path, {
    method: "POST",
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
  });
}

function apiPut(path, payload) {
  if (payload instanceof FormData) {
    payload.set("_method", "PUT");
    return apiRequest(path, { method: "POST", body: payload });
  }

  return apiRequest(path, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

function apiDelete(path) {
  return apiRequest(path, { method: "DELETE" });
}