window.studentSessionReady = new Promise((resolve) => {
  const loginPath = document.body.dataset.loginPath || "login.html";
  let nis = sessionStorage.getItem("ypn_student_nis");

  // Jika tidak ada di sessionStorage, cek apakah Remember Me aktif di localStorage
  if (!nis && localStorage.getItem("ypn_remember_student_flag") === "true") {
    const rememberedNis = localStorage.getItem("ypn_remember_student_nis");
    if (rememberedNis) {
      nis = rememberedNis;
      try {
        sessionStorage.setItem("ypn_student_nis", nis);
      } catch (_) {}
    }
  }

  if (!nis) {
    window.location.replace(loginPath);
    resolve(false);
    return;
  }

  const studentName = document.getElementById("studentName");
  if (studentName) studentName.textContent = `NIS ${nis}`;

  function performStudentLogout() {
    sessionStorage.removeItem("ypn_student_nis");
    sessionStorage.clear();
    // Hilangkan flag auto-login agar tidak redirect otomatis, tapi biarkan NIS tersimpan untuk prefill form login
    localStorage.removeItem("ypn_remember_student_flag");
    window.location.replace(loginPath);
  }

  document.querySelectorAll("#logoutForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      performStudentLogout();
    });
  });

  document.querySelectorAll('a[data-target="#logoutModal"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      if (typeof window.jQuery === "undefined" || !window.jQuery.fn || !window.jQuery.fn.modal) {
        e.preventDefault();
        if (window.confirm("Apakah Anda yakin ingin logout?")) {
          performStudentLogout();
        }
      }
    });
  });

  resolve(true);
});
