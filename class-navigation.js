document.addEventListener("DOMContentLoaded", async () => {
  const classLinks = document.getElementById("sidebarClassLinks");
  const allStudentsLink = document.getElementById("sidebarAllStudentsLink");
  if (!classLinks || !allStudentsLink) return;

  const pageUrl = new URL(window.location.href);
  const studentPageUrl = new URL(allStudentsLink.href);
  const isStudentPage = pageUrl.pathname === studentPageUrl.pathname;
  const selectedClassId = pageUrl.searchParams.get("kelas");

  if (!(await window.adminSessionReady)) {
    classLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    return;
  }

  try {
    const result = await apiGet("/data/kelas");
    const classes = result.data || [];
    classLinks.replaceChildren();

    if (!classes.length) {
      classLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      return;
    }

    classes.forEach((record) => {
      const link = document.createElement("a");
      const target = new URL(studentPageUrl);
      target.searchParams.set("kelas", record.id);
      link.className = "collapse-item";
      link.href = target.href;
      link.textContent = record.nama_kelas;
      if (isStudentPage && String(record.id) === selectedClassId) link.classList.add("active");
      classLinks.append(link);
    });
  } catch (error) {
    classLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
  }
});