const API_BASE = "https://cubbyhole-stem-viselike.ngrok-free.dev/api";

async function apiGet(path) {
  const response = await fetch(API_BASE + path);
  return await response.json();
}

async function apiPost(path, payload) {
  const response = await fetch(API_BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return await response.json();
}