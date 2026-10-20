window.studentSessionReady = new Promise((resolve) => {
  const loginPath = document.body.dataset.loginPath || "login.html";
  const nis = sessionStorage.getItem("ypn_student_nis");

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