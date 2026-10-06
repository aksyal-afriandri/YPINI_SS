const SUPABASE_STORAGE_BUCKET = "student-photos";
const RESOURCE_FIELDS = {
  siswa: ["nisn", "nama"],
  guru: ["nip", "nama"],
  kelas: ["nama_kelas"],
  pelajaran: ["nama_pelajaran"],
  tahun: ["tahun_ajaran"],
};

let supabaseClient = null;

function getSupabaseClient() {
  const config = window.SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) {
    throw new Error("Konfigurasi Supabase belum diisi di supabase-config.js.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("Library Supabase gagal dimuat. Periksa koneksi internet Anda.");
  }
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  }
  return supabaseClient;
}

function throwSupabaseError(error) {
  if (error?.code === "23505") {
    throw new Error("Data dengan NISN atau NIP tersebut sudah terdaftar.");
  }
  if (error?.code === "42501") {
    throw new Error("Akses ditolak. Pastikan akun memiliki peran admin.");
  }
  throw new Error(error?.message || "Permintaan ke Supabase gagal.");
}

function parseDataPath(path, expectsId = false) {
  const match = path.match(/^\/data\/(siswa|guru|kelas|pelajaran|tahun)(?:\/([^/]+))?$/);
  if (!match || (expectsId && !match[2])) {
    throw new Error("Alamat data tidak dikenal.");
  }
  return { resource: match[1], id: match[2] ? decodeURIComponent(match[2]) : null };
}

function resourceTable(resource) {
  return {
    siswa: "data_siswa",
    guru: "data_guru",
    kelas: "data_kelas",
    pelajaran: "data_pelajaran",
    tahun: "tahun_ajaran",
  }[resource];
}

function formPayload(resource, input) {
  const values = {};
  RESOURCE_FIELDS[resource].forEach((field) => {
    const value = input instanceof FormData ? input.get(field) : input[field];
    if (value !== undefined && value !== null) {
      values[field] = String(value).trim();
    }
  });
  return values;
}

function safeFileName(name) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadStudentPhoto(file) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!/^image\/(jpeg|png|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
    throw new Error("Foto harus JPG, PNG, atau GIF dan maksimal 2 MB.");
  }

  const path = `siswa/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { data, error } = await getSupabaseClient()
    .storage.from(SUPABASE_STORAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
  if (error) throwSupabaseError(error);
  return data.path;
}

function normalizeStudentPhotoName(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function apiBulkUploadStudentPhotos(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("Pilih setidaknya satu foto siswa.");
  }

  const client = getSupabaseClient();
  const { data: students, error } = await client.from("data_siswa")
    .select("id, nama, photo_path");
  if (error) throwSupabaseError(error);

  const studentsByName = new Map();
  students.forEach((student) => {
    const key = normalizeStudentPhotoName(student.nama);
    studentsByName.set(key, [...(studentsByName.get(key) || []), student]);
  });

  const filesByName = new Map();
  files.forEach((file) => {
    const fileName = file.name.split(/[\\/]/).pop();
    const key = normalizeStudentPhotoName(fileName.replace(/\.[^.]+$/, ""));
    filesByName.set(key, [...(filesByName.get(key) || []), file]);
  });

  const result = { updated: 0, skipped: [], failed: [] };
  for (const [key, matchingFiles] of filesByName) {
    const matchingStudents = studentsByName.get(key) || [];
    if (matchingStudents.length !== 1) {
      result.skipped.push({
        file: matchingFiles.map((file) => file.name).join(", "),
        reason: matchingStudents.length ? "Nama siswa tidak unik" : "Nama siswa tidak ditemukan",
      });
      continue;
    }
    if (matchingFiles.length !== 1) {
      result.skipped.push({
        file: matchingFiles.map((file) => file.name).join(", "),
        reason: "Ada lebih dari satu foto dengan nama yang sama",
      });
      continue;
    }

    const student = matchingStudents[0];
    let uploadedPath = null;
    try {
      uploadedPath = await uploadStudentPhoto(matchingFiles[0]);
      const { error: updateError } = await client.from("data_siswa")
        .update({ photo_path: uploadedPath }).eq("id", student.id);
      if (updateError) throwSupabaseError(updateError);
      if (student.photo_path) {
        await client.storage.from(SUPABASE_STORAGE_BUCKET).remove([student.photo_path]);
      }
      result.updated += 1;
    } catch (uploadError) {
      if (uploadedPath) {
        await client.storage.from(SUPABASE_STORAGE_BUCKET).remove([uploadedPath]);
      }
      result.failed.push({ file: matchingFiles[0].name, reason: uploadError.message });
    }
  }

  return result;
}

async function apiLogin(credentials) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) throwSupabaseError(error);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("name, role")
    .eq("user_id", data.user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    await client.auth.signOut();
    throw new Error("Akun ini tidak memiliki akses admin.");
  }

  return { user: { id: data.user.id, name: profile.name, role: profile.role } };
}

async function apiLogout() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throwSupabaseError(error);
}

async function apiGet(path) {
  const { resource } = parseDataPath(path);
  const { data, error } = await getSupabaseClient()
    .from(resourceTable(resource))
    .select("*")
    .order("id", { ascending: true });

  if (error) throwSupabaseError(error);
  const records = resource === "siswa"
    ? data.map((record) => ({ ...record, photo_endpoint: record.photo_path }))
    : data;
  return { data: records };
}

async function saveRecord(path, input, isUpdate) {
  const { resource, id } = parseDataPath(path, isUpdate);
  const client = getSupabaseClient();
  const payload = formPayload(resource, input);
  let uploadedPath = null;
  let previousPhotoPath = null;

  if (resource === "siswa" && input instanceof FormData) {
    if (isUpdate && input.get("photo") instanceof File && input.get("photo").size > 0) {
      const { data: current, error: currentError } = await client
        .from(resourceTable(resource)).select("photo_path").eq("id", id).single();
      if (currentError) throwSupabaseError(currentError);
      previousPhotoPath = current.photo_path;
    }
    uploadedPath = await uploadStudentPhoto(input.get("photo"));
    if (uploadedPath) payload.photo_path = uploadedPath;
  }

  const query = isUpdate
    ? client.from(resourceTable(resource)).update(payload).eq("id", id)
    : client.from(resourceTable(resource)).insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) {
    if (uploadedPath) await client.storage.from(SUPABASE_STORAGE_BUCKET).remove([uploadedPath]);
    throwSupabaseError(error);
  }
  if (previousPhotoPath) {
    await client.storage.from(SUPABASE_STORAGE_BUCKET).remove([previousPhotoPath]);
  }
  return { data: resource === "siswa" ? { ...data, photo_endpoint: data.photo_path } : data };
}

function apiPost(path, payload) {
  return saveRecord(path, payload, false);
}

function apiPut(path, payload) {
  return saveRecord(path, payload, true);
}

async function apiDelete(path) {
  const { resource, id } = parseDataPath(path, true);
  const client = getSupabaseClient();
  let photoPath = null;

  if (resource === "siswa") {
    const { data, error } = await client.from(resourceTable(resource))
      .select("photo_path").eq("id", id).single();
    if (error) throwSupabaseError(error);
    photoPath = data.photo_path;
  }

  const { error } = await client.from(resourceTable(resource)).delete().eq("id", id);
  if (error) throwSupabaseError(error);
  if (photoPath) await client.storage.from(SUPABASE_STORAGE_BUCKET).remove([photoPath]);
  return { message: "Data berhasil dihapus." };
}

async function apiBulkDeleteStudents(ids) {
  const studentIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
  if (!studentIds.length) throw new Error("Pilih setidaknya satu siswa.");

  const client = getSupabaseClient();
  const { data, error } = await client.from("data_siswa")
    .delete().in("id", studentIds).select("id, photo_path");
  if (error) throwSupabaseError(error);

  const photoPaths = data.map((student) => student.photo_path).filter(Boolean);
  let photoCleanupWarning = false;
  if (photoPaths.length) {
    const { error: storageError } = await client.storage.from(SUPABASE_STORAGE_BUCKET).remove(photoPaths);
    photoCleanupWarning = Boolean(storageError);
  }
  return { deleted: data.length, photoCleanupWarning };
}

async function apiGetBlob(path) {
  const { data, error } = await getSupabaseClient()
    .storage.from(SUPABASE_STORAGE_BUCKET).createSignedUrl(path, 60);
  if (error) throwSupabaseError(error);
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error("Foto siswa gagal dimuat.");
  return URL.createObjectURL(await response.blob());
}

async function apiImport(resource, rows) {
  if (!RESOURCE_FIELDS[resource] || !Array.isArray(rows)) {
    throw new Error("Format data import tidak valid.");
  }

  const fields = RESOURCE_FIELDS[resource];
  const uniqueField = { siswa: "nisn", guru: "nip" }[resource];
  const client = getSupabaseClient();
  const normalizedRows = rows.map((row) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[key.trim().toLowerCase()] = String(value ?? "").trim();
    });
    return Object.fromEntries(fields.map((field) => [field, normalized[field] || ""]));
  }).filter((record) => fields.some((field) => record[field]));
  const records = normalizedRows.map((record, index) => {
    if (fields.some((field) => !record[field] || record[field].length > 255)) {
      throw new Error(`Baris Excel ${index + 3}: kolom wajib kosong atau melebihi 255 karakter.`);
    }
    return record;
  });

  let existingValues = new Set();
  if (uniqueField) {
    const { data, error } = await client.from(resourceTable(resource)).select(uniqueField);
    if (error) throwSupabaseError(error);
    existingValues = new Set(data.map((record) => record[uniqueField]));
  }

  const seen = new Set(existingValues);
  const uniqueRecords = records.filter((record) => {
    if (!uniqueField) return true;
    if (seen.has(record[uniqueField])) return false;
    seen.add(record[uniqueField]);
    return true;
  });

  if (uniqueRecords.length) {
    const { error } = await client.from(resourceTable(resource)).insert(uniqueRecords);
    if (error) throwSupabaseError(error);
  }
  return { imported: uniqueRecords.length, skipped: records.length - uniqueRecords.length };
}

function normalizeClassName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function apiGetClassStudents(classId) {
  const client = getSupabaseClient();
  const { data: classRecord, error: classError } = await client.from("data_kelas")
    .select("nama_kelas").eq("id", classId).single();
  if (classError) throwSupabaseError(classError);

  const { data: links, error } = await client.from("siswa_kelas")
    .select("siswa_id").eq("kelas_id", classId);
  if (error) throwSupabaseError(error);
  if (!links.length) return { data: [], className: classRecord.nama_kelas };

  const studentIds = [...new Set(links.map((link) => link.siswa_id))];
  const { data, error: studentsError } = await client.from("data_siswa")
    .select("id, nisn, nama, photo_path").in("id", studentIds).order("nama", { ascending: true });
  if (studentsError) throwSupabaseError(studentsError);
  return {
    data: data.map((student) => ({ ...student, photo_endpoint: student.photo_path })),
    className: classRecord.nama_kelas,
  };
}

async function apiImportStudentsByClass(sheetGroups) {
  if (!Array.isArray(sheetGroups) || !sheetGroups.length) {
    throw new Error("File Excel harus berisi sheet dengan data siswa.");
  }

  const groups = sheetGroups.map((group) => ({
    className: String(group.name ?? "").trim(),
    rows: Array.isArray(group.rows) ? group.rows : [],
  })).filter((group) => group.rows.length);
  if (!groups.length) throw new Error("File Excel tidak berisi data siswa.");

  const client = getSupabaseClient();
  const { data: classes, error: classesError } = await client.from("data_kelas")
    .select("id, nama_kelas");
  if (classesError) throwSupabaseError(classesError);

  const classesByName = new Map();
  classes.forEach((record) => {
    const key = normalizeClassName(record.nama_kelas);
    classesByName.set(key, [...(classesByName.get(key) || []), record]);
  });

  const classForSheet = new Map();
  groups.forEach((group) => {
    const key = normalizeClassName(group.className);
    const matches = classesByName.get(key) || [];
    if (!group.className || !matches.length) {
      throw new Error(`Kelas "${group.className || "(kosong)"}" belum tersedia. Tambahkan kelas dulu sebelum import.`);
    }
    if (matches.length > 1) {
      throw new Error(`Nama kelas "${group.className}" terdaftar lebih dari sekali. Periksa data kelas dulu.`);
    }
    classForSheet.set(group, matches[0]);
  });

  const rowsByNisn = new Map();
  const requestedLinks = new Map();
  groups.forEach((group) => {
    const classRecord = classForSheet.get(group);
    group.rows.forEach((row, index) => {
      const normalized = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[key.trim().toLowerCase()] = String(value ?? "").trim();
      });
      const nisn = normalized.nisn || "";
      const nama = normalized.nama || "";
      if (!nisn && !nama) return;
      if (!nisn || !nama || nisn.length > 255 || nama.length > 255) {
        throw new Error(`Sheet "${group.className}", baris ${index + 3}: NISN dan Nama wajib diisi (maksimal 255 karakter).`);
      }

      const existingRow = rowsByNisn.get(nisn);
      if (existingRow && existingRow.nama !== nama) {
        throw new Error(`NISN ${nisn} memiliki nama berbeda pada file Excel.`);
      }
      rowsByNisn.set(nisn, { nisn, nama });
      requestedLinks.set(`${classRecord.id}:${nisn}`, { classId: classRecord.id, nisn });
    });
  });
  if (!rowsByNisn.size) throw new Error("Tidak ada baris siswa yang dapat diimpor.");

  const nisns = [...rowsByNisn.keys()];
  const { data: existingStudents, error: studentsError } = await client.from("data_siswa")
    .select("id, nisn").in("nisn", nisns);
  if (studentsError) throwSupabaseError(studentsError);

  const studentsByNisn = new Map(existingStudents.map((student) => [student.nisn, student]));
  const newStudents = [...rowsByNisn.values()].filter((row) => !studentsByNisn.has(row.nisn));
  if (newStudents.length) {
    const { data, error } = await client.from("data_siswa").insert(newStudents).select("id, nisn");
    if (error) throwSupabaseError(error);
    data.forEach((student) => studentsByNisn.set(student.nisn, student));
  }

  const studentIds = [...new Set([...studentsByNisn.values()].map((student) => student.id))];
  const { data: existingLinks, error: linksError } = await client.from("siswa_kelas")
    .select("kelas_id, siswa_id").in("siswa_id", studentIds);
  if (linksError) throwSupabaseError(linksError);
  const existingLinkKeys = new Set(existingLinks.map((link) => `${link.kelas_id}:${link.siswa_id}`));
  const newLinks = [...requestedLinks.values()].map((link) => ({
    kelas_id: link.classId,
    siswa_id: studentsByNisn.get(link.nisn).id,
  })).filter((link) => !existingLinkKeys.has(`${link.kelas_id}:${link.siswa_id}`));

  if (newLinks.length) {
    const { error } = await client.from("siswa_kelas").insert(newLinks);
    if (error) throwSupabaseError(error);
  }

  return {
    studentsAdded: newStudents.length,
    linksAdded: newLinks.length,
    linksExisting: requestedLinks.size - newLinks.length,
  };
}