const RESOURCE_PAGE_CONFIG = {
  guru: {
    resource: "guru",
    title: "Data Guru",
    fields: [{ key: "nip", label: "NIP" }, { key: "nama", label: "Nama" }],
    addModal: "tambahGuruModal",
    editModal: "editGuruModal",
    deleteModal: "hapusGuruModal",
  },
  kelas: {
    resource: "kelas",
    title: "Data Kelas",
    fields: [{ key: "nama_kelas", label: "Nama Kelas" }],
    addModal: "tambahKelasModal",
    editModal: "editKelasModal",
    deleteModal: "hapusKelasModal",
  },
  pelajaran: {
    resource: "pelajaran",
    title: "Data Pelajaran",
    fields: [{ key: "nama_pelajaran", label: "Nama Pelajaran" }],
    addModal: "tambahPelajaranModal",
    editModal: "editPelajaranModal",
    deleteModal: "hapusPelajaranModal",
  },
  tahun: {
    resource: "tahun",
    title: "Data Tahun Ajaran",
    fields: [{ key: "tahun_ajaran", label: "Tahun Ajaran" }],
    addModal: "tambahTahunModal",
    editModal: "editTahunModal",
    deleteModal: "hapusTahunModal",
  },
};

document.addEventListener("DOMContentLoaded", () => {
  const config = RESOURCE_PAGE_CONFIG[document.body.dataset.supabaseResource];
  if (!config) return;

  const table = document.getElementById("dataTable");
  const tableBody = table?.querySelector("tbody");
  const cardBody = table?.closest(".card")?.querySelector(".card-body");
  if (!table || !tableBody || !cardBody) return;

  const status = document.createElement("div");
  status.id = "supabaseStatus";
  status.className = "small text-muted mb-2";
  status.setAttribute("role", "status");
  cardBody.insertBefore(status, cardBody.firstChild);

  const addModal = document.getElementById(config.addModal);
  const editModal = document.getElementById(config.editModal);
  const deleteModal = document.getElementById(config.deleteModal);
  const addForm = addModal?.querySelector("form");
  const editForm = editModal?.querySelector("form");
  const deleteForm = deleteModal?.querySelector("form");
  const importForm = addModal?.querySelectorAll("form")[1];
  let dataTable = null;
  let records = [];

  if (window.jQuery?.fn?.DataTable?.isDataTable(table)) {
    window.jQuery(table).DataTable().destroy();
  }
  tableBody.replaceChildren();

  function setStatus(message, isError = false, isDebug = false) {
    if (isDebug && !isError) return;
    status.textContent = message;
    status.classList.toggle("text-danger", isError);
    status.classList.toggle("text-muted", !isError);
  }

  function addFormError(form, message) {
    let error = form.querySelector(".api-error");
    if (!error) {
      error = document.createElement("div");
      error.className = "api-error text-danger small mt-2";
      error.setAttribute("role", "alert");
      form.append(error);
    }
    error.textContent = message;
  }

  function formValues(form) {
    return Object.fromEntries(config.fields.map(({ key }) => [
      key,
      form.querySelector(`[name="${key}"]`)?.value.trim() || "",
    ]));
  }

  function hideModal(modalId) {
    window.jQuery(`#${modalId}`).modal("hide");
  }

  function renderRows() {
    if (dataTable) {
      dataTable.destroy();
      dataTable = null;
    } else if (window.jQuery?.fn?.DataTable?.isDataTable(table)) {
      window.jQuery(table).DataTable().destroy();
    }
    tableBody.replaceChildren();

    records.forEach((record, index) => {
      const row = document.createElement("tr");
      const numberCell = document.createElement("td");
      numberCell.textContent = String(index + 1);
      row.append(numberCell);

      config.fields.forEach(({ key }) => {
        const cell = document.createElement("td");
        if (config.resource === "kelas" && key === "nama_kelas") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn btn-link p-0 text-left";
          button.textContent = record[key] ?? "";
          button.setAttribute("aria-label", `Lihat siswa kelas ${record[key] ?? ""}`);
          button.dataset.recordAction = "students";
          button.dataset.recordId = record.id;
          cell.append(button);
        } else {
          cell.textContent = record[key] ?? "";
        }
        row.append(cell);
      });

      const actions = document.createElement("td");
      [
        { action: "edit", label: "Edit", style: "warning", target: config.editModal },
        { action: "delete", label: "Hapus", style: "danger", target: config.deleteModal },
      ].forEach(({ action, label, style, target }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn btn-sm btn-${style} mr-1`;
        button.textContent = label;
        button.dataset.recordAction = action;
        button.dataset.recordId = record.id;
        if (target) {
          button.dataset.toggle = "modal";
          button.dataset.target = `#${target}`;
        }
        actions.append(button);
      });
      row.append(actions);
      tableBody.append(row);
    });

    if (window.jQuery?.fn?.DataTable) {
      dataTable = window.jQuery(table).DataTable({
        pageLength: 10,
        language: {
          search: "Cari:",
          lengthMenu: "Tampilkan _MENU_ entri",
          info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
          infoEmpty: "Tidak ada data untuk ditampilkan",
          zeroRecords: "Data tidak ditemukan",
          paginate: { first: "Awal", last: "Akhir", next: "Berikutnya", previous: "Sebelumnya" },
        },
      });
    }
  }

  async function loadRecords() {
    if (!(await window.adminSessionReady)) {
      setStatus(window.adminSessionError || "Sesi admin diperlukan.", true);
      return;
    }
    setStatus("Memuat data dari Supabase...", false, true);
    try {
      const result = await apiGet(`/data/${config.resource}`);
      records = result.data || [];
      renderRows();
      setStatus(`${records.length} data dimuat.`, false, true);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-record-action]");
    if (!button) return;
    const record = records.find((item) => String(item.id) === button.dataset.recordId);
    if (!record) return;

    if (button.dataset.recordAction === "students") {
      const modal = document.getElementById("lihatSiswaKelasModal");
      const studentBody = document.getElementById("siswaKelasBody");
      const studentStatus = document.getElementById("siswaKelasStatus");
      if (!modal || !studentBody || !studentStatus) return;

      document.getElementById("lihatSiswaKelasTitle").textContent = `Siswa Kelas ${record.nama_kelas}`;
      studentBody.replaceChildren();
      studentStatus.textContent = "Memuat daftar siswa...";
      window.jQuery("#lihatSiswaKelasModal").modal("show");
      try {
        const result = await apiGetClassStudents(record.id);
        result.data.forEach((student, index) => {
          const row = document.createElement("tr");
          [index + 1, student.nis, student.nama].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = String(value ?? "");
            row.append(cell);
          });
          studentBody.append(row);
        });
        studentStatus.textContent = result.data.length
          ? `${result.data.length} siswa terhubung ke kelas ini.`
          : "Belum ada siswa yang terhubung ke kelas ini.";
      } catch (error) {
        studentStatus.textContent = error.message;
      }
    } else if (button.dataset.recordAction === "edit") {
      editForm.dataset.recordId = record.id;
      config.fields.forEach(({ key }) => {
        const input = editForm.querySelector(`[name="${key}"]`);
        if (input) input.value = record[key] ?? "";
      });
    } else {
      deleteForm.dataset.recordId = record.id;
      const message = deleteForm.querySelector("p");
      if (message) message.textContent = `Yakin ingin menghapus data ${config.title.toLowerCase()} ini?`;
    }
  });

  addForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiPost(`/data/${config.resource}`, formValues(addForm));
      addForm.reset();
      hideModal(config.addModal);
      await loadRecords();
    } catch (error) {
      addFormError(addForm, error.message);
    }
  });

  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiPut(`/data/${config.resource}/${encodeURIComponent(editForm.dataset.recordId)}`, formValues(editForm));
      hideModal(config.editModal);
      await loadRecords();
    } catch (error) {
      addFormError(editForm, error.message);
    }
  });

  deleteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiDelete(`/data/${config.resource}/${encodeURIComponent(deleteForm.dataset.recordId)}`);
      hideModal(config.deleteModal);
      await loadRecords();
    } catch (error) {
      addFormError(deleteForm, error.message);
    }
  });

  importForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = importForm.querySelector('input[type="file"]')?.files[0];
    try {
      if (!file) throw new Error("Pilih file Excel terlebih dahulu.");
      if (!window.XLSX) throw new Error("Library Excel gagal dimuat.");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { range: 1, defval: "" });
      const result = await apiImport(config.resource, rows);
      importForm.reset();
      hideModal(config.addModal);
      await loadRecords();
      setStatus(`${result.imported} data diimpor; ${result.skipped} duplikat dilewati.`);
    } catch (error) {
      addFormError(importForm, error.message);
    }
  });

  loadRecords();
});