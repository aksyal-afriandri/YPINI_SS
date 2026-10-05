window.adminSessionError = "";
window.adminSessionReady = new Promise((resolve) => {
  const loginPath = document.body.dataset.loginPath || "../../../index.html";
  const checkSession = async () => {
    let isAdmin = false;
    try {
      const client = getSupabaseClient();
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) {
        window.location.replace(loginPath);
        resolve(false);
        return;
      }

      const { data: profile, error: profileError } = await client
        .from("profiles").select("name, role").eq("user_id", user.id).single();
      if (profileError || profile?.role !== "admin") {
        await client.auth.signOut();
        window.location.replace(loginPath);
        resolve(false);
        return;
      }

      document.querySelectorAll("#logoutForm").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await apiLogout();
            window.location.replace(loginPath);
          } catch (logoutError) {
            window.alert(logoutError.message);
          }
        });
      });
      isAdmin = true;
    } catch (error) {
      window.adminSessionError = error.message;
      const status = document.getElementById("supabaseStatus");
      if (status) status.textContent = error.message;
      status?.classList.add("text-danger");
    }
    resolve(isAdmin);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkSession, { once: true });
  } else {
    checkSession();
  }
});