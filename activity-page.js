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
  // 1. LOGIKA HALAMAN DAFTAR KEGIATAN (index.html)
  // ============================================================================
  function initActivityListPage() {
    const tableElement = document.getElementById("dataTable");
    const tableBody = tableElement?.querySelector("tbody");
    const statusElement = document.getElementById("supabaseStatus");

    let dataTableInstance = null;
    let activityRecords = [];

    function setStatus(message, isError = false) {
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.className = isError
        ? "alert alert-danger small mb-3"
        : "small text-muted mb-2";
      statusElement.style.display = message ? "block" : "none";
    }

    async function loadActivities() {
      setStatus("Memuat data kegiatan...");
      try {
        const client = getClient();
        const { data, error } = await client
          .from(config.table)
          .select(`*, photos:${config.photoTable}(id, url_foto)`)
          .order("tanggal_kegiatan", { ascending: false });

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
        renderTable();
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Gagal memuat data kegiatan.", true);
        renderTable();
      }
    }

    function renderTable() {
      if (dataTableInstance) {
        dataTableInstance.destroy();
        dataTableInstance = null;
      } else if (window.jQuery?.fn?.DataTable?.isDataTable(tableElement)) {
        window.jQuery(tableElement).DataTable().destroy();
      }

      if (!tableBody) return;
      tableBody.innerHTML = "";

      activityRecords.forEach((item, index) => {
        const tr = document.createElement("tr");
        const photos = Array.isArray(item.photos) ? item.photos : [];
        const photoCount = photos.length;

        const deskripsiText = item.deskripsi ? item.deskripsi : "-";
        const deskripsiPreview =
          deskripsiText.length > 70
            ? `${deskripsiText.substring(0, 70)}...`
            : deskripsiText;

        // Badge Foto & link ke kelola.html
        let photoBadges = "";
        if (photoCount > 0) {
          photoBadges = `
            <a href="kelola.html?id=${item.id}" class="text-decoration-none">
              <span class="badge badge-success py-1 px-2">
                <i class="fas fa-camera mr-1"></i>${photoCount} Foto
              </span>
            </a>
          `;
        } else {
          photoBadges = `
            <a href="kelola.html?id=${item.id}" class="text-decoration-none">
              <span class="badge badge-secondary py-1 px-2">
                <i class="fas fa-plus mr-1"></i>Tambah Foto
              </span>
            </a>
          `;
        }

        tr.innerHTML = `
          <td class="text-center align-middle">${index + 1}</td>
          <td class="align-middle" style="white-space: nowrap;">${formatDateID(item.tanggal_kegiatan)}</td>
          <td class="align-middle font-weight-bold text-dark">
            <a href="kelola.html?id=${item.id}" class="text-dark font-weight-bold">${escapeHtml(item.nama_kegiatan)}</a>
          </td>
          <td class="align-middle text-muted small" style="max-width: 250px;">${escapeHtml(deskripsiPreview)}</td>
          <td class="align-middle">${photoBadges}</td>
          <td class="text-center align-middle" style="white-space: nowrap;">
            <a href="kelola.html?id=${item.id}" class="btn btn-sm btn-info mr-1" title="Masuk ke Halaman Kelola Foto">
              <i class="fas fa-images mr-1"></i>Kelola Foto (${photoCount})
            </a>
            <button type="button" class="btn btn-sm btn-primary btn-edit mr-1" data-id="${item.id}" title="Edit Kegiatan">
              <i class="fas fa-edit"></i>
            </button>
            <button type="button" class="btn btn-sm btn-danger btn-delete" data-id="${item.id}" title="Hapus Kegiatan">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        `;

        tableBody.appendChild(tr);
      });

      if (window.jQuery?.fn?.DataTable && tableElement) {
        dataTableInstance = window.jQuery(tableElement).DataTable({
          language: {
            search: "Cari:",
            lengthMenu: "Tampilkan _MENU_ data",
            info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ kegiatan",
            infoEmpty: "Menampilkan 0 kegiatan",
            infoFiltered: "(disaring dari _MAX_ total kegiatan)",
            zeroRecords: "Tidak ada data kegiatan ditemukan",
            paginate: {
              first: "Awal",
              last: "Akhir",
              next: "Berikutnya",
              previous: "Sebelumnya",
            },
          },
          columnDefs: [{ orderable: false, targets: [4, 5] }],
        });
      }

      bindListEvents();
    }

    function bindListEvents() {
      // Tombol Edit
      document.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          const item = activityRecords.find((r) => r.id === id);
          if (item) openEditActivityModal(item);
        });
      });

      // Tombol Hapus
      document.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.id);
          const item = activityRecords.find((r) => r.id === id);
          if (item) openDeleteActivityModal(item);
        });
      });
    }

    // Form Tambah Kegiatan (HANYA NAMA, TANGGAL, DESKRIPSI)
    const formTambah = document.getElementById("formTambahKegiatan");
    if (formTambah) {
      const inputTanggal = formTambah.querySelector('[name="tanggal_kegiatan"]');
      if (inputTanggal && !inputTanggal.value) {
        inputTanggal.value = new Date().toISOString().split("T")[0];
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
          if (inputTanggal) inputTanggal.value = new Date().toISOString().split("T")[0];
          window.jQuery("#tambahKegiatanModal").modal("hide");

          // Tanyakan apakah ingin langsung ke halaman kelola foto
          const goManage = confirm(
            `Kegiatan '${nama}' berhasil dibuat!\n\nApakah Anda ingin langsung masuk ke halaman Kelola Foto untuk menambahkan foto?`
          );
          if (goManage && newActivity?.id) {
            window.location.href = `kelola.html?id=${newActivity.id}`;
          } else {
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
