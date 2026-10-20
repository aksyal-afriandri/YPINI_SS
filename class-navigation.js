document.addEventListener("DOMContentLoaded", async () => {
  const pageUrl = new URL(window.location.href);
  const selectedClassId = pageUrl.searchParams.get("kelas");

  // Pastikan menu Monitoring Ujian ada di sidebar
  let allMonitoringLink = document.getElementById("sidebarAllMonitoringLink");
  let monitoringClassLinks = document.getElementById("sidebarMonitoringClassLinks");
  let monitoringNav = document.getElementById("examMonitoringNavigation");

  // Pastikan menu Nilai & Jawaban Siswa ada di sidebar
  let allExamResultsLink = document.getElementById("sidebarAllExamResultsLink");
  let examResultClassLinks = document.getElementById("sidebarExamResultClassLinks");
  let examResultNav = document.getElementById("examResultNavigation");

  const examNavLinks = Array.from(document.querySelectorAll("#accordionSidebar .nav-link"));
  const examNavLink = examNavLinks.find((link) => {
    const text = link.textContent.trim().toLowerCase();
    return text.includes("pengaturan ujian") || text.includes("setting ujian");
  });

  if (examNavLink) {
    const examNavItem = examNavLink.closest("li.nav-item");
    const examHref = examNavLink.getAttribute("href") || "";

    // 1. Injeksi Monitoring Ujian jika belum ada
    if (!monitoringNav && examNavItem) {
      let baseMonitoringUrl = "../monitoring-ujian/";
      if (examHref.startsWith("../../")) baseMonitoringUrl = "../../monitoring-ujian/";
      else if (examHref.startsWith("../")) baseMonitoringUrl = "../monitoring-ujian/";
      else if (examHref.startsWith("./")) baseMonitoringUrl = "../monitoring-ujian/";
      else if (window.location.pathname.includes("/admin/monitoring-ujian/")) baseMonitoringUrl = "./";

      const navLi = document.createElement("li");
      navLi.className = "nav-item";
      navLi.id = "examMonitoringNavigation";
      navLi.innerHTML = `
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseExamMonitoring" aria-expanded="false" aria-controls="collapseExamMonitoring">
          <i class="fas fa-fw fa-desktop"></i>
          <span>Monitoring Ujian</span>
        </a>
        <div id="collapseExamMonitoring" class="collapse" data-parent="#accordionSidebar">
          <div class="bg-white py-2 collapse-inner rounded">
            <a class="collapse-item" id="sidebarAllMonitoringLink" href="${baseMonitoringUrl}">Semua Kelas</a>
            <h6 class="collapse-header">Berdasarkan Kelas:</h6>
            <div id="sidebarMonitoringClassLinks"><span class="small text-muted px-3">Memuat kelas...</span></div>
          </div>
        </div>
      `;
      examNavItem.insertAdjacentElement("afterend", navLi);
      allMonitoringLink = document.getElementById("sidebarAllMonitoringLink");
      monitoringClassLinks = document.getElementById("sidebarMonitoringClassLinks");
      monitoringNav = navLi;
    }

    // 2. Injeksi Nilai & Jawaban Siswa jika belum ada
    if (!examResultNav && examNavItem) {
      const referenceItem = monitoringNav || examNavItem;
      let baseNilaiUrl = "../nilai-ujian/";
      if (examHref.startsWith("../../")) baseNilaiUrl = "../../nilai-ujian/";
      else if (examHref.startsWith("../")) baseNilaiUrl = "../nilai-ujian/";
      else if (examHref.startsWith("./")) baseNilaiUrl = "../nilai-ujian/";
      else if (window.location.pathname.includes("/admin/nilai-ujian/")) baseNilaiUrl = "./";

      const navLi = document.createElement("li");
      navLi.className = "nav-item";
      navLi.id = "examResultNavigation";
      navLi.innerHTML = `
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseExamResult" aria-expanded="false" aria-controls="collapseExamResult">
          <i class="fas fa-fw fa-user-check"></i>
          <span>Jawaban & Nilai Siswa</span>
        </a>
        <div id="collapseExamResult" class="collapse" data-parent="#accordionSidebar">
          <div class="bg-white py-2 collapse-inner rounded">
            <a class="collapse-item" id="sidebarAllExamResultsLink" href="${baseNilaiUrl}">Semua Siswa</a>
            <h6 class="collapse-header">Berdasarkan Kelas:</h6>
            <div id="sidebarExamResultClassLinks"><span class="small text-muted px-3">Memuat kelas...</span></div>
          </div>
        </div>
      `;
      referenceItem.insertAdjacentElement("afterend", navLi);
      allExamResultsLink = document.getElementById("sidebarAllExamResultsLink");
      examResultClassLinks = document.getElementById("sidebarExamResultClassLinks");
      examResultNav = navLi;
    }
  }

  // Active state untuk Monitoring Ujian
  const isMonitoringPage = pageUrl.pathname.includes("/monitoring-ujian/");
  if (isMonitoringPage && monitoringNav) {
    monitoringNav.classList.add("active");
    const collapseMon = document.getElementById("collapseExamMonitoring");
    if (collapseMon) {
      collapseMon.classList.add("show");
      const toggleBtn = monitoringNav.querySelector('a[data-toggle="collapse"]');
      if (toggleBtn) {
        toggleBtn.classList.remove("collapsed");
        toggleBtn.setAttribute("aria-expanded", "true");
      }
    }
    if (!selectedClassId && allMonitoringLink) {
      allMonitoringLink.classList.add("active");
    }
  }

  // Active state untuk Nilai & Jawaban Siswa
  const isExamResultPage = pageUrl.pathname.includes("/nilai-ujian/");
  if (isExamResultPage && examResultNav) {
    examResultNav.classList.add("active");
    const collapseExam = document.getElementById("collapseExamResult");
    if (collapseExam) {
      collapseExam.classList.add("show");
      const toggleBtn = examResultNav.querySelector('a[data-toggle="collapse"]');
      if (toggleBtn) {
        toggleBtn.classList.remove("collapsed");
        toggleBtn.setAttribute("aria-expanded", "true");
      }
    }
    if (!selectedClassId && allExamResultsLink) {
      allExamResultsLink.classList.add("active");
    }
  }

  const classLinks = document.getElementById("sidebarClassLinks");
  const attendanceClassLinks = document.getElementById("sidebarAttendanceClassLinks");
  const allStudentsLink = document.getElementById("sidebarAllStudentsLink");
  const attendanceLink = document.getElementById("sidebarAttendanceLink");

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

  const studentPageUrl = allStudentsLink ? new URL(allStudentsLink.href) : null;
  if (studentPageUrl) {
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
  }

  const attendancePageUrl = attendanceLink ? new URL(attendanceLink.href) : null;
  attendancePageUrl?.searchParams.delete("mode");
  const isStudentPage = studentPageUrl && pageUrl.pathname === studentPageUrl.pathname;
  const isAttendancePage = attendancePageUrl && pageUrl.pathname === attendancePageUrl.pathname;

  const monitoringPageUrl = allMonitoringLink ? new URL(allMonitoringLink.href) : null;
  const examResultPageUrl = allExamResultsLink ? new URL(allExamResultsLink.href) : null;

  if (!(await window.adminSessionReady)) {
    if (classLinks) classLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    if (attendanceClassLinks) attendanceClassLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    if (monitoringClassLinks) monitoringClassLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    if (examResultClassLinks) examResultClassLinks.textContent = "Sesi admin diperlukan untuk memuat kelas.";
    return;
  }

  try {
    const result = await apiGet("/data/kelas");
    const classes = result.data || [];
    classLinks?.replaceChildren();
    attendanceClassLinks?.replaceChildren();
    monitoringClassLinks?.replaceChildren();
    examResultClassLinks?.replaceChildren();

    if (!classes.length) {
      if (classLinks) classLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      if (attendanceClassLinks) attendanceClassLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      if (monitoringClassLinks) monitoringClassLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      if (examResultClassLinks) examResultClassLinks.textContent = "Belum ada kelas. Tambahkan melalui Data Kelas.";
      return;
    }

    classes.forEach((record) => {
      const classLabel = [record.jenjang, record.nama_kelas].filter(Boolean).join(" - ");

      // 1. Link Kelas di Data Siswa
      if (classLinks && studentPageUrl) {
        const link = document.createElement("a");
        const target = new URL(studentPageUrl);
        target.searchParams.set("kelas", record.id);
        link.className = "collapse-item";
        link.href = target.href;
        link.textContent = classLabel;
        if (isStudentPage && String(record.id) === selectedClassId) link.classList.add("active");
        classLinks.append(link);
      }

      // 2. Link Kelas di Absensi
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
        link.textContent = classLabel;
        if (isAttendancePage && String(record.id) === selectedClassId) {
          link.classList.add("active");
          const heading = document.getElementById("attendanceClassHeading");
          if (heading) {
            heading.dataset.className = classLabel;
            if (window.updateAttendanceHeading) window.updateAttendanceHeading();
          }
          const monthlyHeading = document.getElementById("monthlyAttendanceHeading");
          if (monthlyHeading) {
            monthlyHeading.dataset.className = classLabel;
            if (window.updateMonthlyAttendanceHeading) window.updateMonthlyAttendanceHeading();
          }
        }
        attendanceClassLinks.append(link);
      }

      // 3. Link Kelas di Monitoring Ujian
      if (monitoringClassLinks && monitoringPageUrl) {
        const link = document.createElement("a");
        const target = new URL(monitoringPageUrl);
        target.searchParams.set("kelas", record.id);
        link.className = "collapse-item";
        link.href = target.href;
        link.textContent = classLabel;
        if (isMonitoringPage && String(record.id) === selectedClassId) {
          link.classList.add("active");
          const heading = document.getElementById("monitoringClassHeading");
          if (heading) {
            heading.dataset.className = classLabel;
            heading.textContent = `Monitoring Ujian - ${classLabel}`;
          }
        }
        monitoringClassLinks.append(link);
      }

      // 4. Link Kelas di Nilai & Jawaban Siswa
      if (examResultClassLinks && examResultPageUrl) {
        const link = document.createElement("a");
        const target = new URL(examResultPageUrl);
        target.searchParams.set("kelas", record.id);
        link.className = "collapse-item";
        link.href = target.href;
        link.textContent = classLabel;
        if (isExamResultPage && String(record.id) === selectedClassId) {
          link.classList.add("active");
          const heading = document.getElementById("examResultClassHeading");
          if (heading) {
            heading.dataset.className = classLabel;
            if (window.updateExamResultHeading) window.updateExamResultHeading();
          }
        }
        examResultClassLinks.append(link);
      }
    });
  } catch (error) {
    if (classLinks) classLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
    if (attendanceClassLinks) attendanceClassLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
    if (monitoringClassLinks) monitoringClassLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
    if (examResultClassLinks) examResultClassLinks.textContent = error.message || "Daftar kelas gagal dimuat.";
  }
});