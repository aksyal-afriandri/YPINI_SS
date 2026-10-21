async function initializeActiveYearControl(userRole = "admin") {
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
  select.title = userRole === "guru" ? "Tahun ajaran aktif ditentukan oleh Administrator" : "Pilih tahun ajaran aktif";
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

  if (userRole === "guru") {
    select.disabled = true;
    select.title = "Tahun ajaran aktif ditentukan oleh Administrator";
    return;
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

function setupProfileModal(user, profile) {
  if (document.getElementById("changePasswordModal")) return;

  const modalHtml = `
    <div class="modal fade" id="changePasswordModal" tabindex="-1" role="dialog" aria-labelledby="changePasswordModalLabel" aria-hidden="true">
      <div class="modal-dialog" role="document">
        <div class="modal-content shadow border-0">
          <div class="modal-header bg-primary text-white">
            <h5 class="modal-title font-weight-bold" id="changePasswordModalLabel">
              <i class="fas fa-user-cog mr-2"></i>Pengaturan Akun & Password
            </h5>
            <button type="button" class="close text-white" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <form id="changePasswordForm">
            <div class="modal-body">
              <div class="card bg-light border-0 mb-3">
                <div class="card-body py-2 px-3 small">
                  <div class="row mb-1">
                    <span class="col-sm-4 text-muted">Nama:</span>
                    <strong class="col-sm-8" id="profileNameDisplay">${profile.name || "-"}</strong>
                  </div>
                  <div class="row mb-1">
                    <span class="col-sm-4 text-muted">Peran:</span>
                    <span class="col-sm-8">
                      <span class="badge badge-${profile.role === "guru" ? "info" : "primary"} text-uppercase font-weight-bold">
                        ${profile.role}
                      </span>
                    </span>
                  </div>
                  <div class="row">
                    <span class="col-sm-4 text-muted">Email / NIP:</span>
                    <span class="col-sm-8 font-monospace text-dark" id="profileIdentifierDisplay">${profile.nip || user.email || "-"}</span>
                  </div>
                </div>
              </div>

              <div id="passwordAlert" class="alert d-none small py-2" role="alert"></div>

              <div class="form-group">
                <label for="newPasswordInput" class="small font-weight-bold text-gray-700">Password Baru</label>
                <input type="password" class="form-control" id="newPasswordInput" required minlength="4" placeholder="Masukkan password baru...">
                <small class="form-text text-muted">Minimal 4 karakter.</small>
              </div>

              <div class="form-group mb-2">
                <label for="confirmPasswordInput" class="small font-weight-bold text-gray-700">Konfirmasi Password Baru</label>
                <input type="password" class="form-control" id="confirmPasswordInput" required minlength="4" placeholder="Ulangi password baru...">
              </div>

              <div class="form-check small text-muted mb-2">
                <input class="form-check-input" type="checkbox" id="showPasswordToggle">
                <label class="form-check-label" for="showPasswordToggle">
                  Lihat teks password
                </label>
              </div>
            </div>
            <div class="modal-footer bg-light py-2">
              <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
              <button type="submit" class="btn btn-primary btn-sm" id="savePasswordBtn">
                <i class="fas fa-save mr-1"></i>Simpan Password
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const form = document.getElementById("changePasswordForm");
  const alertEl = document.getElementById("passwordAlert");
  const saveBtn = document.getElementById("savePasswordBtn");
  const newPass = document.getElementById("newPasswordInput");
  const confirmPass = document.getElementById("confirmPasswordInput");
  const showToggle = document.getElementById("showPasswordToggle");

  showToggle.addEventListener("change", () => {
    const type = showToggle.checked ? "text" : "password";
    newPass.type = type;
    confirmPass.type = type;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertEl.className = "alert d-none small py-2";

    const p1 = newPass.value.trim();
    const p2 = confirmPass.value.trim();

    if (p1.length < 4) {
      alertEl.textContent = "Password minimal 4 karakter.";
      alertEl.className = "alert alert-danger small py-2";
      return;
    }
    if (p1 !== p2) {
      alertEl.textContent = "Konfirmasi password baru tidak cocok.";
      alertEl.className = "alert alert-danger small py-2";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Menyimpan...';

    try {
      if (typeof apiChangeMyPassword === "function") {
        await apiChangeMyPassword(p1);
      } else {
        const client = getSupabaseClient();
        const { error } = await client.auth.updateUser({ password: p1 });
        if (error) throw error;
      }
      alertEl.textContent = "Password berhasil diperbarui! Silakan gunakan password ini pada login berikutnya.";
      alertEl.className = "alert alert-success small py-2";
      form.reset();
    } catch (err) {
      alertEl.textContent = err.message || "Gagal memperbarui password.";
      alertEl.className = "alert alert-danger small py-2";
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save mr-1"></i>Simpan Password';
    }
  });
}

function customizeInterfaceForUser(user, profile) {
  const userDropdown = document.getElementById("userDropdown");
  if (userDropdown) {
    const nameEl = userDropdown.querySelector(".text-gray-600.small") || userDropdown.querySelector("span");
    if (nameEl) {
      const roleBadge = `<span class="badge badge-${profile.role === "guru" ? "info" : "primary"} ml-1">${profile.role === "guru" ? "Guru" : "Admin"}</span>`;
      nameEl.innerHTML = `${profile.name || (profile.role === "guru" ? "Guru" : "Admin")} ${roleBadge}`;
    }

    const dropdownMenu = userDropdown.nextElementSibling;
    if (dropdownMenu) {
      // Connect Profile & Settings triggers to changePasswordModal
      const profileItems = dropdownMenu.querySelectorAll("a.dropdown-item");
      profileItems.forEach((item) => {
        const text = item.textContent.trim().toLowerCase();
        if (text.includes("profile") || text.includes("settings")) {
          item.setAttribute("href", "#");
          item.setAttribute("data-toggle", "modal");
          item.setAttribute("data-target", "#changePasswordModal");
        }
      });

      // Add explicit Ganti Password button if not present
      if (!dropdownMenu.querySelector("#btnMenuGantiPassword")) {
        const divider = dropdownMenu.querySelector(".dropdown-divider");
        const changePasswordLink = document.createElement("a");
        changePasswordLink.id = "btnMenuGantiPassword";
        changePasswordLink.className = "dropdown-item";
        changePasswordLink.href = "#";
        changePasswordLink.setAttribute("data-toggle", "modal");
        changePasswordLink.setAttribute("data-target", "#changePasswordModal");
        changePasswordLink.innerHTML = '<i class="fas fa-key fa-sm fa-fw mr-2 text-gray-400"></i>Ganti Password';
        if (divider) {
          dropdownMenu.insertBefore(changePasswordLink, divider);
        } else {
          dropdownMenu.prepend(changePasswordLink);
        }
      }
    }
  }

  // Role-based sidebar menu visibility
  if (profile.role === "guru") {
    // Hide 'Data Admin' collapse menu (Guru, Kelas, Pelajaran, Tahun Ajaran)
    const adminDataCollapse = document.getElementById("collapseTwo");
    if (adminDataCollapse) {
      const parentNav = adminDataCollapse.closest("li.nav-item");
      if (parentNav) parentNav.style.display = "none";
    }
  }

  setupProfileModal(user, profile);
}

function enforceRoleAccess(profile, loginPath) {
  if (profile.role === "admin") return true;

  if (profile.role === "guru") {
    const path = window.location.pathname.replace(/\\/g, "/");
    // Restricted master data pages for Guru:
    // admin/guru/, admin/kelas/, admin/pelajaran/, admin/tahun/
    const restrictedPatterns = [
      /\/admin\/guru\//i,
      /\/admin\/kelas\//i,
      /\/admin\/pelajaran\//i,
      /\/admin\/tahun\//i,
    ];

    const isRestricted = restrictedPatterns.some((pattern) => pattern.test(path));
    if (isRestricted) {
      window.alert("Akses ditolak: Menu ini hanya dapat diakses oleh Administrator.");
      // Compute relative redirect to admin dashboard
      const dashboardTarget = path.includes("/admin/")
        ? window.location.href.replace(/\/admin\/.*$/i, "/admin/dashboard/index.html")
        : loginPath;
      window.location.replace(dashboardTarget);
      return false;
    }
    return true;
  }

  return false;
}

async function performAdminLogout(loginPath) {
  try {
    const client = typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
    if (client && client.auth) {
      await client.auth.signOut().catch(() => {});
    }
  } catch (err) {
    console.warn("SignOut notice:", err);
  } finally {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("sb-") || key.includes("supabase") || key.includes("auth"))) {
          localStorage.removeItem(key);
        }
      }
      localStorage.removeItem("ypn_remember_admin_flag");
      sessionStorage.clear();
    } catch (e) {}
    window.location.replace(loginPath);
  }
}

function setupLogoutTriggers(loginPath) {
  // 1. Ensure modal exists with exact same structure as dashboard
  let modal = document.getElementById("logoutModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal fade";
    modal.id = "logoutModal";
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-labelledby", "exampleModalLabel");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
            <button class="close" type="button" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
          <div class="modal-footer">
            <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
            <form id="logoutForm" action="#" method="post">
              <button class="btn btn-primary" type="submit">Logout</button>
            </form>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // 2. Wire form submissions (identical to dashboard)
  document.querySelectorAll("#logoutForm").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = form.querySelector("button[type='submit']");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1"></span>Logout...';
      }
      await performAdminLogout(loginPath);
    });
  });
}

window.adminSessionError = "";
window.adminSessionReady = new Promise((resolve) => {
  const loginPath = document.body.dataset.loginPath || "../../../index.html";
  const checkSession = async () => {
    let isAuthorized = false;
    setupLogoutTriggers(loginPath);
    try {
      const client = getSupabaseClient();
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) {
        window.location.replace(loginPath);
        resolve(false);
        return;
      }

      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("name, role, nip")
        .eq("user_id", user.id)
        .single();

      if (profileError || !["admin", "guru"].includes(profile?.role)) {
        await client.auth.signOut();
        localStorage.removeItem("ypn_remember_admin_flag");
        window.location.replace(loginPath);
        resolve(false);
        return;
      }

      window.currentUser = user;
      window.currentUserProfile = profile;
      window.currentUserRole = profile.role;

      // Enforce page-level role guards
      const allowed = enforceRoleAccess(profile, loginPath);
      if (!allowed) {
        resolve(false);
        return;
      }

      // Customize UI & topbar based on role
      customizeInterfaceForUser(user, profile);

      // Setup robust universal logout handlers
      setupLogoutTriggers(loginPath);

      isAuthorized = true;
      await initializeActiveYearControl(profile.role);
    } catch (error) {
      window.adminSessionError = error.message;
      const status = document.getElementById("supabaseStatus");
      if (status) status.textContent = error.message;
      status?.classList.add("text-danger");
    }
    resolve(isAuthorized);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkSession, { once: true });
  } else {
    checkSession();
  }
});