document.addEventListener("DOMContentLoaded", async () => {
  const classLinks = document.getElementById("sidebarClassLinks");
  const attendanceClassLinks = document.getElementById("sidebarAttendanceClassLinks");
  const allStudentsLink = document.getElementById("sidebarAllStudentsLink");
  const attendanceLink = document.getElementById("sidebarAttendanceLink");
  if (!allStudentsLink) return;

  attendanceClassLinks?.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    const currentUrl = new URL(window.location.href);
    const selectedDate = currentUrl.searchParams.get("tanggal");
    const selectedMonth = currentUrl.searchParams.get("bulan");
    const selectedView = currentUrl.searchParams.get("tampilan");
    if (!link || (!selectedDate && !selectedMonth && !selectedView)) return;
    const target = new URL(link.href);
    if (selectedDate) target.searchParams.set("tanggal", selectedDate);
    if (selectedMonth) target.searchParams.set("bulan", selectedMonth);
    if (selectedView) target.searchParams.set("tampilan", selectedView);
    link.href = target.href;
  });

  const pageUrl = new URL(window.location.href);
  const studentPageUrl = new URL(allStudentsLink.href);
  const qrGenerationUrl = new URL("../qr-siswa/", studentPageUrl);
  const qrNavigationItem = document.createElement("li");
  qrNavigationItem.className = "nav-item";
  const qrGenerationLink = document.createElement("a");
  qrGenerationLink.className = "nav-link";
  qrGenerationLink.href = qrGenerationUrl.href;
  qrGenerationLink.innerHTML = '<i class="fas fa-fw fa-qrcode"></i><span>QR / Barcode Siswa</span>';
  if (pageUrl.pathname === qrGenerationUrl.pathname) qrGenerationLink.classList.add("active");
  qrNavigationItem.append(qrGenerationLink);
  document.getElementById("studentNavigation")?.insertAdjacentElement("afterend", qrNavigationItem);

  const attendancePageUrl = attendanceLink ? new URL(attendanceLink.href) : null;
  attendancePageUrl?.searchParams.delete("mode");
  const isStudentPage = pageUrl.pathname === studentPageUrl.pathname;
  const isAttendancePage = attendancePageUrl && pageUrl.pathname === attendancePageUrl.pathname;
  const selectedClassId = pageUrl.searchParams.get("kelas");

  if (!(await window.adminSessionReady)) {
    if (classLinks) classLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    if (attendanceClassLinks) attendanceClassLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    return;
  }

  try {
    const result = await apiGet("/data/kelas");
    const classes = result.data || [];
    classLinks?.replaceChildren();
    attendanceClassLinks?.replaceChildren();

    if (!classes.length) {
      if (classLinks) classLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      if (attendanceClassLinks) attendanceClassLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      return;
    }

    classes.forEach((record) => {
      if (classLinks) {
        const link = document.createElement("a");
        const target = new URL(studentPageUrl);
        target.searchParams.set("kelas", record.id);
        link.className = "collapse-item";
        link.href = target.href;
        link.textContent = record.nama_kelas;
        if (isStudentPage && String(record.id) === selectedClassId) link.classList.add("active");
        classLinks.append(link);
      }

      if (attendanceClassLinks && attendancePageUrl) {
        const link = document.createElement("a");
        const target = new URL(attendancePageUrl);
        target.searchParams.set("kelas", record.id);
        const selectedDate = pageUrl.searchParams.get("tanggal");
        const selectedMonth = pageUrl.searchParams.get("bulan");
        const selectedView = pageUrl.searchParams.get("tampilan");
        if (selectedDate) target.searchParams.set("tanggal", selectedDate);
        if (selectedMonth) target.searchParams.set("bulan", selectedMonth);
        if (selectedView) target.searchParams.set("tampilan", selectedView);
        target.hash = "rekap";
        link.className = "collapse-item";
        link.href = target.href;
        link.textContent = record.nama_kelas;
        if (isAttendancePage && String(record.id) === selectedClassId) {
          link.classList.add("active");
          const heading = document.getElementById("attendanceClassHeading");
          if (heading) {
            heading.dataset.className = record.nama_kelas;
            if (window.updateAttendanceHeading) window.updateAttendanceHeading();
          }
          const monthlyHeading = document.getElementById("monthlyAttendanceHeading");
          if (monthlyHeading) {
            monthlyHeading.dataset.className = record.nama_kelas;
            if (window.updateMonthlyAttendanceHeading) window.updateMonthlyAttendanceHeading();
          }
        }
        attendanceClassLinks.append(link);
      }
    });
  } catch (error) {
    if (classLinks) classLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
    if (attendanceClassLinks) attendanceClassLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
  }
});