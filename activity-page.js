/**
 * activity-page.js
 * Modul Pengelolaan Data Aktifitas (Field Trip, Akhwah, Ummi, Pembelajaran)
 * Mendukung:
 * 1. Halaman Daftar (index.html): CRUD kegiatan (nama, tanggal, deskripsi)
 * 2. Halaman Kelola Foto (kelola.html): Galeri foto, Multi-upload foto ke Supabase Storage, Preview modal, & Hapus foto
 */

const ACTIVITY_CONFIG = {
  fieldtrip: {
    table: "aktifitas_fieldtrip",
    photoTable: "aktifitas_fieldtrip_photo",
    title: "Data Field Trip",
    categoryName: "Field Trip",
  },
  akhwah: {
    table: "aktifitas_akhwah",
    photoTable: "aktifitas_akhwah_photo",
    title: "Data Akhwah",
    categoryName: "Akhwah",
  },
  ummi: {
    table: "aktifitas_ummi",
    photoTable: "aktifitas_ummi_photo",
    title: "Data Ummi",
    categoryName: "Ummi",
  },
  pembelajaran: {
    table: "aktifitas_pembelajaran",
    photoTable: "aktifitas_pembelajaran_photo",
    title: "Data Pembelajaran",
    categoryName: "Pembelajaran",
  },
};

const STORAGE_BUCKET_ACTIVITY = "activity-photos";

document.addEventListener("DOMContentLoaded", () => {
  const activityType = document.body.dataset.activityType;
  const config = ACTIVITY_CONFIG[activityType];
  if (!config) return;

  function getClient() {
    if (typeof getSupabaseClient === "function") {
      return getSupabaseClient();
    }
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg?.url || !cfg?.anonKey || !window.supabase?.createClient) {
      throw new Error("Konfigurasi Supabase belum siap.");
    }
    return window.supabase.createClient(cfg.url, cfg.anonKey);
  }

  function formatDateID(dateStr) {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  function sanitizeFileName(name) {
    return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================================
  // UPLOAD FOTO KE SUPABASE STORAGE
  // ============================================================================
  async function uploadPhotosToStorage(activityId, files, onProgress) {
    const client = getClient();
    const uploadedRecords = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (onProgress) {
        onProgress(i + 1, files.length, file.name);
      }

      if (!file.type.startsWith("image/")) {
        console.warn(`File ${file.name} bukan gambar, dilewati.`);
        continue;
      }

      const randomId =
        typeof crypto?.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2, 12);
      const safeName = sanitizeFileName(file.name);
      const storagePath = `${activityType}/${activityId}/${randomId}-${safeName}`;

      const { data: uploadData, error: uploadErr } = await client.storage
        .from(STORAGE_BUCKET_ACTIVITY)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        console.error("Gagal upload file ke storage:", uploadErr);
        throw new Error(
          `Gagal mengunggah foto '${file.name}': ${uploadErr.message}`
        );
      }

      // Dapatkan Public URL
      const { data: urlData } = client.storage
        .from(STORAGE_BUCKET_ACTIVITY)
        .getPublicUrl(storagePath);

      uploadedRecords.push({
        aktifitas_id: activityId,
        url_foto: urlData.publicUrl,
        storage_path: storagePath,
      });
    }

    if (uploadedRecords.length > 0) {
      const { error: insertErr } = await client
        .from(config.photoTable)
        .insert(uploadedRecords);

      if (insertErr) {
        console.error("Gagal simpan relasi foto:", insertErr);
        throw new Error(
          `Gagal menyimpan data foto ke database: ${insertErr.message}`
        );
      }
    }

    return uploadedRecords;
  }

  // ============================================================================
  // PENENTUAN MODE HALAMAN:
  // 1. HALAMAN DAFTAR KEGIATAN (index.html)
  // 2. HALAMAN KELOLA FOTO (kelola.html)
  // ============================================================================
  const isManagePhotosPage = !!document.getElementById("photoGalleryGrid");

  if (isManagePhotosPage) {
    initManagePhotosPage();
  } else {
    initActivityListPage();
  }

  // ============================================================================
  // 1. LOGIKA HALAMAN AGENDA KALENDER KEGIATAN (index.html)
  // ============================================================================
  function initActivityListPage() {
    const MONTH_NAMES_ID = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    const MONTH_NAMES_SHORT_ID = [
      "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
      "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
    ];
    const DAY_NAMES_ID = [
      "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"
    ];
    const DAY_NAMES_SHORT_ID = [
      "Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"
    ];

    const statusElement = document.getElementById("supabaseStatus");

    // State
    let activityRecords = [];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    let currentYear = today.getFullYear();
    let currentMonth = today.getMonth(); // 0 - 11
    let selectedDate = null; // null or 'YYYY-MM-DD'
    let searchQuery = "";
    let viewMode = "split"; // 'split', 'calendar', 'agenda'

    function setStatus(message, isError = false) {
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = isError
        ? "alert alert-danger small mb-3"
        : "small text-muted mb-2";
      statusElement.style.display = message ? "block" : "none";
    }

    function formatDateFullID(dateStr) {
      if (!dateStr) return "-";
      try {
        const d = new Date(dateStr + "T00:00:00");
        const dayName = DAY_NAMES_ID[d.getDay()] || "";
        const dateNum = d.getDate();
        const monthName = MONTH_NAMES_ID[d.getMonth()] || "";
        const year = d.getFullYear();
        return `${dayName}, ${dateNum} ${monthName} ${year}`;
      } catch {
        return dateStr;
      }
    }

    async function loadActivities() {
      setStatus("Memuat data agenda kegiatan...");
      try {
        const client = getClient();
        const { data, error } = await client
          .from(config.table)
          .select(`*, photos:${config.photoTable}(id, url_foto)`)
          .order("tanggal_kegiatan", { ascending: true });

        if (error) {
          if (error.code === "42P01" || error.code === "PGRST205") {
            throw new Error(
              `Tabel '${config.table}' belum tersedia. Silakan jalankan script 'supabase-activity.sql' di Supabase SQL Editor terlebih dahulu.`
            );
          }
          throw error;
        }

        activityRecords = data || [];
        setStatus("");
        initSelectors();
        renderView();
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Gagal memuat data agenda kegiatan.", true);
        renderView();
      }
    }

    function initSelectors() {
      const monthSelect = document.getElementById("calMonthSelect");
      const yearSelect = document.getElementById("calYearSelect");

      if (monthSelect && monthSelect.options.length === 0) {
        MONTH_NAMES_ID.forEach((name, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = name;
          monthSelect.appendChild(opt);
        });
        monthSelect.addEventListener("change", (e) => {
          currentMonth = parseInt(e.target.value, 10);
          selectedDate = null;
          renderView();
        });
      }

      if (yearSelect && yearSelect.options.length === 0) {
        const baseYear = today.getFullYear();
        for (let y = baseYear - 3; y <= baseYear + 4; y++) {
          const opt = document.createElement("option");
          opt.value = y;
          opt.textContent = y;
          yearSelect.appendChild(opt);
        }
        yearSelect.addEventListener("change", (e) => {
          currentYear = parseInt(e.target.value, 10);
          selectedDate = null;
          renderView();
        });
      }
    }

    function renderView() {
      // Sync selector values
      const monthSelect = document.getElementById("calMonthSelect");
      if (monthSelect) monthSelect.value = currentMonth;
      const yearSelect = document.getElementById("calYearSelect");
      if (yearSelect) yearSelect.value = currentYear;

      renderCalendar();
      renderAgenda();
    }

    // ==========================================================================
    // RENDER KALENDER BULANAN
    // ==========================================================================
    function renderCalendar() {
      const gridContainer = document.getElementById("calendarDaysGrid");
      if (!gridContainer) return;
      gridContainer.innerHTML = "";

      const firstDay = new Date(currentYear, currentMonth, 1);
      // Format Senin (0) s/d Minggu (6)
      const startDayIndex = (firstDay.getDay() + 6) % 7;
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

      // Hari dari bulan sebelumnya
      for (let i = startDayIndex - 1; i >= 0; i--) {
        const prevDayNum = daysInPrevMonth - i;
        const cell = document.createElement("div");
        cell.className = "cal-day-cell other-month";
        cell.innerHTML = `
          <div class="cal-day-header">
            <span class="cal-day-num">${prevDayNum}</span>
          </div>
        `;
        gridContainer.appendChild(cell);
      }

      // Hari bulan berjalan
      let monthActivitiesCount = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const dayActivities = activityRecords.filter((r) => r.tanggal_kegiatan === dateStr);
        monthActivitiesCount += dayActivities.length;

        const cell = document.createElement("div");
        cell.className = "cal-day-cell";
        if (dateStr === todayStr) cell.classList.add("is-today");
        if (dateStr === selectedDate) cell.classList.add("is-selected");

        let pillsHtml = "";
        if (dayActivities.length > 0) {
          const maxPills = 2;
          dayActivities.slice(0, maxPills).forEach((act) => {
            pillsHtml += `
              <div class="cal-event-pill" title="${escapeHtml(act.nama_kegiatan)}">
                <i class="fas fa-circle" style="font-size: 5px;"></i>
                <span class="text-truncate">${escapeHtml(act.nama_kegiatan)}</span>
              </div>
            `;
          });
          if (dayActivities.length > maxPills) {
            pillsHtml += `<div class="cal-event-more">+${dayActivities.length - maxPills} lainnya</div>`;
          }
        }

        let dotsHtml = "";
        if (dayActivities.length > 0) {
          dotsHtml = `<div class="cal-day-dots"><span class="cal-dot"></span></div>`;
        }

        cell.innerHTML = `
          <div class="cal-day-header">
            <span class="cal-day-num">${d}</span>
            ${dotsHtml}
          </div>
          <div class="cal-day-events">
            ${pillsHtml}
          </div>
        `;

        cell.addEventListener("click", () => {
          if (selectedDate === dateStr) {
            selectedDate = null;
          } else {
            selectedDate = dateStr;
            const inputTanggal = document.querySelector('#formTambahKegiatan [name="tanggal_kegiatan"]');
            if (inputTanggal) inputTanggal.value = dateStr;
          }
          renderView();
        });

        gridContainer.appendChild(cell);
      }

      // Hari dari bulan berikutnya
      const totalCells = startDayIndex + daysInMonth;
      const nextMonthCells = (7 - (totalCells % 7)) % 7;
      for (let d = 1; d <= nextMonthCells; d++) {
        const cell = document.createElement("div");
        cell.className = "cal-day-cell other-month";
        cell.innerHTML = `
          <div class="cal-day-header">
            <span class="cal-day-num">${d}</span>
          </div>
        `;
        gridContainer.appendChild(cell);
      }

      // Title & Count
      const monthTitle = document.getElementById("calCurrentMonthTitle");
      if (monthTitle) {
        monthTitle.textContent = `${MONTH_NAMES_ID[currentMonth]} ${currentYear}`;
      }
      const eventCountBadge = document.getElementById("calEventCountBadge");
      if (eventCountBadge) {
        eventCountBadge.textContent = `${monthActivitiesCount} Kegiatan Bulan Ini`;
      }

      const resetFilterBtn = document.getElementById("calResetFilterBtn");
      if (resetFilterBtn) {
        resetFilterBtn.style.display = selectedDate ? "inline-block" : "none";
      }
    }

    // ==========================================================================
    // RENDER DAFTAR AGENDA
    // ==========================================================================
    function renderAgenda() {
      const container = document.getElementById("agendaListContainer");
      const totalBadge = document.getElementById("agendaTotalBadge");
      const headerTitle = document.getElementById("agendaHeaderTitle");
      const filterBanner = document.getElementById("agendaFilterBanner");
      const filterDateLabel = document.getElementById("agendaFilterDateLabel");

      if (!container) return;
      container.innerHTML = "";

      const curMonthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;

      // Filter Data
      let filtered = activityRecords.filter((item) => {
        // Query search
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchName = item.nama_kegiatan && item.nama_kegiatan.toLowerCase().includes(q);
          const matchDesc = item.deskripsi && item.deskripsi.toLowerCase().includes(q);
          if (!matchName && !matchDesc) return false;
        }

        // Selected Date or Month
        if (selectedDate) {
          return item.tanggal_kegiatan === selectedDate;
        } else if (!searchQuery) {
          return item.tanggal_kegiatan && item.tanggal_kegiatan.startsWith(curMonthPrefix);
        }
        return true;
      });

      // Update Filter Banner & Header
      if (selectedDate) {
        if (filterBanner) filterBanner.style.display = "flex";
        if (filterDateLabel) filterDateLabel.textContent = formatDateFullID(selectedDate);
        if (headerTitle) {
          headerTitle.innerHTML = `<i class="fas fa-calendar-day mr-2 text-primary"></i>Agenda: ${formatDateID(selectedDate)}`;
        }
      } else {
        if (filterBanner) filterBanner.style.display = "none";
        if (headerTitle) {
          if (searchQuery) {
            headerTitle.innerHTML = `<i class="fas fa-search mr-2 text-primary"></i>Hasil Pencarian "${escapeHtml(searchQuery)}"`;
          } else {
            headerTitle.innerHTML = `<i class="fas fa-calendar-check mr-2 text-primary"></i>Agenda Bulan ${MONTH_NAMES_ID[currentMonth]} ${currentYear}`;
          }
        }
      }

      if (totalBadge) {
        totalBadge.textContent = `${filtered.length} Agenda`;
      }

      // Empty State
      if (filtered.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "agenda-empty-state";
        const emptyMsg = selectedDate
          ? `Belum ada agenda kegiatan pada ${formatDateFullID(selectedDate)}.`
          : searchQuery
          ? `Tidak ditemukan kegiatan yang cocok dengan kata kunci "${escapeHtml(searchQuery)}".`
          : `Belum ada agenda kegiatan untuk bulan ${MONTH_NAMES_ID[currentMonth]} ${currentYear}.`;

        emptyDiv.innerHTML = `
          <div class="agenda-empty-icon"><i class="far fa-calendar-times"></i></div>
          <h6 class="font-weight-bold text-gray-700">Tidak Ada Kegiatan</h6>
          <p class="small text-muted mb-3">${escapeHtml(emptyMsg)}</p>
          <button type="button" class="btn btn-sm btn-primary" data-toggle="modal" data-target="#tambahKegiatanModal">
            <i class="fas fa-plus mr-1"></i> Tambah Kegiatan Baru
          </button>
        `;
        container.appendChild(emptyDiv);
        return;
      }

      // Render Cards
      filtered.forEach((item) => {
        const card = document.createElement("div");
        card.className = "agenda-item-card";

        const d = new Date(item.tanggal_kegiatan + "T00:00:00");
        const monthShort = MONTH_NAMES_SHORT_ID[d.getMonth()] || "AGENDA";
        const dayNum = d.getDate() || "-";
        const dayName = DAY_NAMES_ID[d.getDay()] || "";

        // Status badge
        let statusBadge = "";
        if (item.tanggal_kegiatan === todayStr) {
          statusBadge = `<span class="badge badge-success px-2 py-1"><i class="fas fa-bullseye mr-1"></i>Hari Ini</span>`;
        } else if (item.tanggal_kegiatan > todayStr) {
          statusBadge = `<span class="badge badge-info px-2 py-1"><i class="fas fa-clock mr-1"></i>Mendatang</span>`;
        } else {
          statusBadge = `<span class="badge badge-light border text-muted px-2 py-1">Selesai</span>`;
        }

        // Photos thumbnails & badge
        const photos = Array.isArray(item.photos) ? item.photos : [];
        const photoCount = photos.length;
        let photosHtml = "";
        if (photoCount > 0) {
          const maxThumbs = 3;
          const visiblePhotos = photos.slice(0, maxThumbs);
          const remaining = photoCount - maxThumbs;
          let thumbsImg = "";
          visiblePhotos.forEach((p) => {
            thumbsImg += `
              <a href="kelola.html?id=${item.id}" title="Lihat galeri foto">
                <img src="${escapeHtml(p.url_foto)}" class="agenda-thumb" alt="Foto Kegiatan" onerror="this.style.display='none'">
              </a>
            `;
          });
          if (remaining > 0) {
            thumbsImg += `
              <a href="kelola.html?id=${item.id}" class="agenda-thumb-more" title="Lihat semua ${photoCount} foto">
                +${remaining}
              </a>
            `;
          }
          photosHtml = `<div class="agenda-thumbnails">${thumbsImg}</div>`;
        }

        const deskripsiText = item.deskripsi ? item.deskripsi : "Tidak ada deskripsi rincian.";

        card.innerHTML = `
          <!-- Date Box -->
          <div class="agenda-date-box">
            <div class="agenda-date-month">${monthShort}</div>
            <div class="agenda-date-day">${dayNum}</div>
            <div class="agenda-date-dayname">${dayName}</div>
          </div>

          <!-- Content Body -->
          <div class="agenda-body">
            <div class="d-flex justify-content-between align-items-start flex-wrap mb-1" style="gap: 8px;">
              <h5 class="agenda-title mb-0">
                <a href="kelola.html?id=${item.id}">${escapeHtml(item.nama_kegiatan)}</a>
              </h5>
              <div class="d-flex align-items-center" style="gap: 6px;">
                ${statusBadge}
                <a href="kelola.html?id=${item.id}" class="badge ${photoCount > 0 ? "badge-success" : "badge-secondary"} py-1 px-2 text-decoration-none" title="Kelola Foto">
                  <i class="fas fa-camera mr-1"></i>${photoCount} Foto
                </a>
              </div>
            </div>

            <div class="agenda-meta text-muted small">
              <span><i class="far fa-calendar-alt mr-1"></i>${formatDateFullID(item.tanggal_kegiatan)}</span>
            </div>

            <p class="agenda-desc text-muted mb-2">${escapeHtml(deskripsiText)}</p>

            ${photosHtml}

            <!-- Action Buttons -->
            <div class="agenda-actions mt-3 pt-2 border-top">
              <a href="kelola.html?id=${item.id}" class="btn btn-sm btn-info mr-1" title="Masuk ke Halaman Kelola Foto">
                <i class="fas fa-images mr-1"></i>Kelola Foto (${photoCount})
              </a>
              <button type="button" class="btn btn-sm btn-outline-primary btn-edit mr-1" data-id="${item.id}" title="Edit Kegiatan">
                <i class="fas fa-edit mr-1"></i>Edit
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-delete" data-id="${item.id}" title="Hapus Kegiatan">
                <i class="fas fa-trash mr-1"></i>Hapus
              </button>
            </div>
          </div>
        `;

        container.appendChild(card);
      });

      bindAgendaActions();
    }

    function bindAgendaActions() {
      // Edit
      document.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          const item = activityRecords.find((r) => r.id === id);
          if (item) openEditActivityModal(item);
        });
      });

      // Delete
      document.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          const item = activityRecords.find((r) => r.id === id);
          if (item) openDeleteActivityModal(item);
        });
      });
    }

    // ==========================================================================
    // TOOLBAR KONTROL & EVENT LISTENERS
    // ==========================================================================
    const prevBtn = document.getElementById("calPrevMonthBtn");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        currentMonth--;
        if (currentMonth < 0) {
          currentMonth = 11;
          currentYear--;
        }
        selectedDate = null;
        renderView();
      });
    }

    const nextBtn = document.getElementById("calNextMonthBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
        selectedDate = null;
        renderView();
      });
    }

    const todayBtn = document.getElementById("calTodayBtn");
    if (todayBtn) {
      todayBtn.addEventListener("click", () => {
        currentYear = today.getFullYear();
        currentMonth = today.getMonth();
        selectedDate = todayStr;
        renderView();
      });
    }

    const resetFilterBtn = document.getElementById("calResetFilterBtn");
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener("click", () => {
        selectedDate = null;
        renderView();
      });
    }

    const clearDateFilterBtn = document.getElementById("agendaClearDateFilter");
    if (clearDateFilterBtn) {
      clearDateFilterBtn.addEventListener("click", () => {
        selectedDate = null;
        renderView();
      });
    }

    // Search
    const searchInput = document.getElementById("calSearchInput");
    const searchClearBtn = document.getElementById("calSearchClearBtn");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        renderAgenda();
      });
    }
    if (searchClearBtn && searchInput) {
      searchClearBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchQuery = "";
        renderAgenda();
      });
    }

    // View Mode Toggles
    const viewSplitBtn = document.getElementById("calViewSplitBtn");
    const viewCalendarBtn = document.getElementById("calViewCalendarBtn");
    const viewAgendaBtn = document.getElementById("calViewAgendaBtn");
    const colCalendar = document.getElementById("calColCalendar");
    const colAgenda = document.getElementById("calColAgenda");

    function setViewMode(mode) {
      viewMode = mode;
      [viewSplitBtn, viewCalendarBtn, viewAgendaBtn].forEach((btn) => {
        if (!btn) return;
        btn.classList.remove("btn-primary");
        btn.classList.add("btn-outline-primary");
      });

      if (mode === "split") {
        viewSplitBtn?.classList.add("btn-primary");
        viewSplitBtn?.classList.remove("btn-outline-primary");
        if (colCalendar) {
          colCalendar.className = "col-lg-6 mb-4";
          colCalendar.style.display = "block";
        }
        if (colAgenda) {
          colAgenda.className = "col-lg-6 mb-4";
          colAgenda.style.display = "block";
        }
      } else if (mode === "calendar") {
        viewCalendarBtn?.classList.add("btn-primary");
        viewCalendarBtn?.classList.remove("btn-outline-primary");
        if (colCalendar) {
          colCalendar.className = "col-12 mb-4";
          colCalendar.style.display = "block";
        }
        if (colAgenda) {
          colAgenda.style.display = "none";
        }
      } else if (mode === "agenda") {
        viewAgendaBtn?.classList.add("btn-primary");
        viewAgendaBtn?.classList.remove("btn-outline-primary");
        if (colCalendar) {
          colCalendar.style.display = "none";
        }
        if (colAgenda) {
          colAgenda.className = "col-12 mb-4";
          colAgenda.style.display = "block";
        }
      }
    }

    viewSplitBtn?.addEventListener("click", () => setViewMode("split"));
    viewCalendarBtn?.addEventListener("click", () => setViewMode("calendar"));
    viewAgendaBtn?.addEventListener("click", () => setViewMode("agenda"));

    // ==========================================================================
    // MODAL TAMBAH, EDIT, HAPUS
    // ==========================================================================
    const formTambah = document.getElementById("formTambahKegiatan");
    if (formTambah) {
      const inputTanggal = formTambah.querySelector('[name="tanggal_kegiatan"]');
      if (inputTanggal && !inputTanggal.value) {
        inputTanggal.value = todayStr;
      }

      formTambah.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errBox = document.getElementById("tambahKegiatanError");
        const btnSubmit = formTambah.querySelector('button[type="submit"]');

        if (errBox) errBox.textContent = "";
        btnSubmit.disabled = true;

        const nama = formTambah.querySelector('[name="nama_kegiatan"]')?.value.trim();
        const tanggal = formTambah.querySelector('[name="tanggal_kegiatan"]')?.value;
        const deskripsi = formTambah.querySelector('[name="deskripsi"]')?.value.trim();

        try {
          if (!nama) throw new Error("Nama kegiatan wajib diisi.");
          if (!tanggal) throw new Error("Tanggal kegiatan wajib diisi.");

          const client = getClient();
          const { data: newActivity, error: actErr } = await client
            .from(config.table)
            .insert({
              nama_kegiatan: nama,
              tanggal_kegiatan: tanggal,
              deskripsi: deskripsi || null,
            })
            .select()
            .single();

          if (actErr) throw actErr;

          formTambah.reset();
          if (inputTanggal) inputTanggal.value = tanggal || todayStr;
          window.jQuery("#tambahKegiatanModal").modal("hide");

          const goManage = confirm(
            `Kegiatan '${nama}' berhasil dibuat!\n\nApakah Anda ingin langsung masuk ke halaman Kelola Foto untuk menambahkan foto?`
          );
          if (goManage && newActivity?.id) {
            window.location.href = `kelola.html?id=${newActivity.id}`;
          } else {
            // Set current calendar view to the added activity's month & year
            const actDate = new Date(tanggal + "T00:00:00");
            currentYear = actDate.getFullYear();
            currentMonth = actDate.getMonth();
            selectedDate = tanggal;
            await loadActivities();
          }
        } catch (err) {
          console.error(err);
          if (errBox) errBox.textContent = err.message || "Gagal menambah kegiatan.";
        } finally {
          btnSubmit.disabled = false;
        }
      });
    }

    // Modal Edit Kegiatan
    function openEditActivityModal(item) {
      const formEdit = document.getElementById("formEditKegiatan");
      if (!formEdit) return;

      formEdit.querySelector('[name="id"]').value = item.id;
      formEdit.querySelector('[name="nama_kegiatan"]').value = item.nama_kegiatan || "";
      formEdit.querySelector('[name="tanggal_kegiatan"]').value = item.tanggal_kegiatan || "";
      formEdit.querySelector('[name="deskripsi"]').value = item.deskripsi || "";

      const errBox = document.getElementById("editKegiatanError");
      if (errBox) errBox.textContent = "";

      window.jQuery("#editKegiatanModal").modal("show");
    }

    const formEdit = document.getElementById("formEditKegiatan");
    if (formEdit) {
      formEdit.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errBox = document.getElementById("editKegiatanError");
        const btnSubmit = formEdit.querySelector('button[type="submit"]');
        if (errBox) errBox.textContent = "";
        btnSubmit.disabled = true;

        const id = Number(formEdit.querySelector('[name="id"]')?.value);
        const nama = formEdit.querySelector('[name="nama_kegiatan"]')?.value.trim();
        const tanggal = formEdit.querySelector('[name="tanggal_kegiatan"]')?.value;
        const deskripsi = formEdit.querySelector('[name="deskripsi"]')?.value.trim();

        try {
          if (!nama) throw new Error("Nama kegiatan wajib diisi.");
          if (!tanggal) throw new Error("Tanggal kegiatan wajib diisi.");

          const client = getClient();
          const { error } = await client
            .from(config.table)
            .update({
              nama_kegiatan: nama,
              tanggal_kegiatan: tanggal,
              deskripsi: deskripsi || null,
            })
            .eq("id", id);

          if (error) throw error;

          window.jQuery("#editKegiatanModal").modal("hide");
          await loadActivities();
        } catch (err) {
          console.error(err);
          if (errBox) errBox.textContent = err.message || "Gagal memperbarui kegiatan.";
        } finally {
          btnSubmit.disabled = false;
        }
      });
    }

    // Modal Hapus Kegiatan
    function openDeleteActivityModal(item) {
      const modal = document.getElementById("hapusKegiatanModal");
      if (!modal) return;

      modal.querySelector('[name="id"]').value = item.id;
      const nameSpan = modal.querySelector(".activity-name-target");
      if (nameSpan) nameSpan.textContent = item.nama_kegiatan;

      const errBox = document.getElementById("hapusKegiatanError");
      if (errBox) errBox.textContent = "";

      window.jQuery("#hapusKegiatanModal").modal("show");
    }

    const formHapus = document.getElementById("formHapusKegiatan");
    if (formHapus) {
      formHapus.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errBox = document.getElementById("hapusKegiatanError");
        const btnSubmit = formHapus.querySelector('button[type="submit"]');
        if (errBox) errBox.textContent = "";
        btnSubmit.disabled = true;

        const id = Number(formHapus.querySelector('[name="id"]')?.value);
        try {
          const client = getClient();
          const { error } = await client
            .from(config.table)
            .delete()
            .eq("id", id);

          if (error) throw error;

          window.jQuery("#hapusKegiatanModal").modal("hide");
          await loadActivities();
        } catch (err) {
          console.error(err);
          if (errBox) errBox.textContent = err.message || "Gagal menghapus kegiatan.";
        } finally {
          btnSubmit.disabled = false;
        }
      });
    }

    loadActivities();
  }

  // ============================================================================
  // 2. LOGIKA HALAMAN KELOLA FOTO (kelola.html)
  // ============================================================================
  function initManagePhotosPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const activityId = Number(urlParams.get("id"));

    if (!activityId) {
      alert("ID Kegiatan tidak valid.");
      window.location.href = "./";
      return;
    }

    let currentActivity = null;

    async function loadActivityData() {
      const galleryLoading = document.getElementById("galleryLoading");
      if (galleryLoading) galleryLoading.style.display = "block";

      try {
        const client = getClient();
        const { data, error } = await client
          .from(config.table)
          .select(`*, photos:${config.photoTable}(*)`)
          .eq("id", activityId)
          .single();

        if (error) throw error;
        currentActivity = data;

        // Update Elemen Tampilan Informasi Kegiatan
        document.querySelectorAll(".activity-name-heading").forEach((el) => {
          el.textContent = data.nama_kegiatan;
        });
        document.querySelectorAll(".activity-display-name").forEach((el) => {
          el.textContent = data.nama_kegiatan;
        });
        document.querySelectorAll(".activity-display-date").forEach((el) => {
          el.textContent = formatDateID(data.tanggal_kegiatan);
        });
        document.querySelectorAll(".activity-display-desc").forEach((el) => {
          el.textContent = data.deskripsi || "Tidak ada deskripsi untuk kegiatan ini.";
          el.classList.toggle("text-muted", !data.deskripsi);
        });

        const photos = Array.isArray(data.photos) ? data.photos : [];
        document.querySelectorAll(".activity-display-count").forEach((el) => {
          el.textContent = `${photos.length} Foto`;
        });
        const badgeTotal = document.getElementById("galleryCountBadge");
        if (badgeTotal) badgeTotal.textContent = `${photos.length} Foto Tersimpan`;

        renderGalleryGrid(photos);
      } catch (err) {
        console.error(err);
        alert("Gagal memuat detail kegiatan: " + (err.message || err));
      } finally {
        if (galleryLoading) galleryLoading.style.display = "none";
      }
    }

    function renderGalleryGrid(photos) {
      const grid = document.getElementById("photoGalleryGrid");
      if (!grid) return;

      if (!photos || photos.length === 0) {
        grid.innerHTML = `
          <div class="col-12 text-center py-5">
            <div class="mb-3">
              <i class="fas fa-images fa-4x text-gray-300"></i>
            </div>
            <h5 class="font-weight-bold text-gray-700">Belum Ada Foto untuk Kegiatan Ini</h5>
            <p class="text-muted small mb-3">Klik tombol "Tambah Foto Baru" di atas untuk mengunggah foto dokumentasi kegiatan ini.</p>
            <button type="button" class="btn btn-primary btn-sm shadow-sm" data-toggle="modal" data-target="#modalTambahFoto">
              <i class="fas fa-cloud-upload-alt mr-1"></i> Unggah Foto Sekarang
            </button>
          </div>
        `;
        return;
      }

      grid.innerHTML = photos
        .map(
          (photo, idx) => `
        <div class="col-sm-6 col-md-4 col-lg-3 mb-4" id="photo-box-${photo.id}">
          <div class="card h-100 shadow-sm border-0 overflow-hidden photo-card" style="transition: transform 0.2s; border-radius: 8px;">
            <div class="position-relative" style="overflow: hidden; height: 180px; background-color: #f8f9fa;">
              <img src="${photo.url_foto}" alt="Foto ${idx + 1}" class="card-img-top photo-zoom-trigger" 
                   data-url="${photo.url_foto}" 
                   style="height: 100%; width: 100%; object-fit: cover; cursor: pointer;">
              <span class="badge badge-dark position-absolute" style="top: 8px; left: 8px; opacity: 0.85;">
                Foto #${idx + 1}
              </span>
            </div>
            <div class="card-body p-2 d-flex justify-content-between align-items-center bg-white border-top">
              <button type="button" class="btn btn-sm btn-outline-primary py-1 px-2 photo-zoom-trigger" data-url="${photo.url_foto}" title="Lihat Foto Layar Penuh">
                <i class="fas fa-search-plus mr-1"></i>Lihat
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger py-1 px-2 btn-delete-photo-page" 
                      data-photo-id="${photo.id}" data-storage-path="${photo.storage_path || ""}" title="Hapus Foto Ini">
                <i class="fas fa-trash-alt mr-1"></i>Hapus
              </button>
            </div>
          </div>
        </div>
      `
        )
        .join("");

      // Bind Tombol / Gambar Lihat Foto (Modal Lightbox)
      grid.querySelectorAll(".photo-zoom-trigger").forEach((el) => {
        el.addEventListener("click", () => {
          const url = el.dataset.url;
          openViewModal(url);
        });
      });

      // Bind Tombol Hapus Foto
      grid.querySelectorAll(".btn-delete-photo-page").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const photoId = Number(btn.dataset.photoId);
          const storagePath = btn.dataset.storagePath;

          if (!confirm("Apakah Anda yakin ingin menghapus foto ini?")) return;

          btn.disabled = true;
          try {
            const client = getClient();
            const { error: dbErr } = await client
              .from(config.photoTable)
              .delete()
              .eq("id", photoId);

            if (dbErr) throw dbErr;

            if (storagePath) {
              await client.storage
                .from(STORAGE_BUCKET_ACTIVITY)
                .remove([storagePath]);
            }

            await loadActivityData();
          } catch (err) {
            console.error(err);
            alert("Gagal menghapus foto: " + (err.message || err));
            btn.disabled = false;
          }
        });
      });
    }

    function openViewModal(url) {
      const modal = document.getElementById("modalLihatFoto");
      const img = document.getElementById("modalLihatFotoImg");
      const dlBtn = document.getElementById("btnDownloadFoto");

      if (img) img.src = url;
      if (dlBtn) dlBtn.href = url;
      if (modal) window.jQuery(modal).modal("show");
    }

    // Form Tambah Foto Baru di Page Kelola Foto
    const formUpload = document.getElementById("formUploadFotoPage");
    if (formUpload) {
      const fileInput = document.getElementById("inputFotoPageFiles");
      const previewText = document.getElementById("fileSelectionPreview");

      if (fileInput && previewText) {
        fileInput.addEventListener("change", () => {
          const files = Array.from(fileInput.files || []);
          if (files.length > 0) {
            previewText.textContent = `${files.length} foto dipilih: ` + files.map(f => f.name).slice(0, 3).join(", ") + (files.length > 3 ? "..." : "");
          } else {
            previewText.textContent = "";
          }
        });
      }

      formUpload.addEventListener("submit", async (e) => {
        e.preventDefault();
        const files = Array.from(fileInput?.files || []);
        const errBox = document.getElementById("uploadPageError");
        const progressBox = document.getElementById("uploadPageProgress");
        const submitBtn = document.getElementById("btnSubmitUploadPage");

        if (errBox) errBox.textContent = "";
        if (progressBox) progressBox.textContent = "";

        if (files.length === 0) {
          if (errBox) errBox.textContent = "Silakan pilih setidaknya satu foto.";
          return;
        }

        submitBtn.disabled = true;
        try {
          if (progressBox) progressBox.textContent = `Menyiapkan ${files.length} foto...`;

          await uploadPhotosToStorage(activityId, files, (curr, total, name) => {
            if (progressBox) {
              progressBox.textContent = `Mengunggah foto ${curr} dari ${total} (${name})...`;
            }
          });

          if (fileInput) fileInput.value = "";
          if (previewText) previewText.textContent = "";
          window.jQuery("#modalTambahFoto").modal("hide");

          await loadActivityData();
        } catch (err) {
          console.error(err);
          if (errBox) errBox.textContent = err.message || "Gagal mengunggah foto.";
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    loadActivityData();
  }
});
