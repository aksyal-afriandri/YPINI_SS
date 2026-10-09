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

  document.querySelectorAll("#logoutForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sessionStorage.removeItem("ypn_student_nis");
      window.location.replace(loginPath);
    });
  });

  resolve(true);
});