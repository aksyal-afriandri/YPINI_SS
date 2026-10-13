async function initializeActiveYearControl() {
  const navbar = document.querySelector(".navbar-nav.ml-auto");
  const userDropdown = document.getElementById("userDropdown");
  if (!navbar || !userDropdown) return;

  const item = document.createElement("li");
  item.className = "nav-item d-flex align-items-center mr-3";

  const label = document.createElement("span");
  label.className = "small text-gray-600 mr-2 d-none d-md-inline";
  label.textContent = "Tahun ajaran";
  item.append(label);

  const select = document.createElement("select");
  select.id = "activeAcademicYear";
  select.className = "form-control form-control-sm";
  select.setAttribute("aria-label", "Tahun ajaran aktif");
  select.style.maxWidth = "160px";
  select.title = "Pilih tahun ajaran aktif";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Pilih tahun...";
  select.append(placeholder);
  item.append(select);

  const userItem = userDropdown.closest("li");
  const divider = navbar.querySelector(".topbar-divider");
  navbar.insertBefore(item, divider || userItem);

  let academicYears = [];
  try {
    const { years, activeYearId } = await apiGetAcademicYearSettings();
    academicYears = years;
    academicYears.forEach((year) => {
      const option = document.createElement("option");
      option.value = String(year.id);
      option.textContent = year.tahun_ajaran;
      select.append(option);
    });

    const activeYear = academicYears.find((year) => String(year.id) === String(activeYearId));
    if (activeYear) {
      select.value = String(activeYear.id);
      window.activeAcademicYear = activeYear;
    } else {
      window.activeAcademicYear = null;
    }

    if (!academicYears.length) {
      placeholder.textContent = "Tambah tahun ajaran";
      select.disabled = true;
    }
  } catch (error) {
    placeholder.textContent = "Atur database tahun";
    select.disabled = true;
    select.title = error.message;
  }

  select.addEventListener("change", async () => {
    if (!select.value) return;
    const previousYearId = window.activeAcademicYear?.id;
    select.disabled = true;
    try {
      await apiSetActiveAcademicYear(select.value);
      window.activeAcademicYear = academicYears.find((year) => String(year.id) === select.value) || null;
      window.dispatchEvent(new CustomEvent("academic-year-changed", {
        detail: window.activeAcademicYear,
      }));
      window.location.reload();
    } catch (error) {
      select.value = previousYearId ? String(previousYearId) : "";
      window.alert(error.message);
    } finally {
      select.disabled = false;
    }
  });
}

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
      await initializeActiveYearControl();
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