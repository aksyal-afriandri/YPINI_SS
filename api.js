const SUPABASE_STORAGE_BUCKET = "student-photos";
const RESOURCE_FIELDS = {
  siswa: ["nis", "nama"],
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
    throw new Error("Data dengan NIS atau NIP tersebut sudah terdaftar.");
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
    const photoFile = input.get("photo");
    const hasNewPhoto = photoFile instanceof File && photoFile.size > 0;
    const removePhoto = isUpdate && input.get("remove_photo") === "1";
    if (isUpdate && (hasNewPhoto || removePhoto)) {
      const { data: current, error: currentError } = await client
        .from(resourceTable(resource)).select("photo_path").eq("id", id).single();
      if (currentError) throwSupabaseError(currentError);
      previousPhotoPath = current.photo_path;
    }
    uploadedPath = await uploadStudentPhoto(photoFile);
    if (uploadedPath) payload.photo_path = uploadedPath;
    else if (removePhoto) payload.photo_path = null;
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

async function apiPostStudentToClass(classId, input) {
  const client = getSupabaseClient();
  const { data: classRecord, error: classError } = await client.from("data_kelas")
    .select("id").eq("id", classId).maybeSingle();
  if (classError) throwSupabaseError(classError);
  if (!classRecord) throw new Error("Kelas tidak ditemukan. Tambahkan kelas dulu.");

  const values = formPayload("siswa", input);
  const { data: existingStudent, error: studentError } = await client.from("data_siswa")
    .select("id, nis, nama").eq("nis", values.nis).maybeSingle();
  if (studentError) throwSupabaseError(studentError);

  const { data: existingLink, error: linkLookupError } = await client.from("siswa_kelas")
    .select("id").eq("kelas_id", classId).eq("siswa_id", existingStudent?.id || -1).maybeSingle();
  if (linkLookupError) throwSupabaseError(linkLookupError);
  if (existingLink) return { created: false, linked: false, student: existingStudent };

  let student = existingStudent;
  let created = false;
  if (!student) {
    const result = await apiPost("/data/siswa", input);
    student = result.data;
    created = true;
  }

  const { error: linkError } = await client.from("siswa_kelas").insert({
    kelas_id: classId,
    siswa_id: student.id,
  });
  if (linkError) {
    if (created) await apiDelete(`/data/siswa/${encodeURIComponent(student.id)}`);
    throwSupabaseError(linkError);
  }
  return { created, linked: true, student };
}

async function apiImportStudentsToClass(classId, rows) {
  if (!Array.isArray(rows)) throw new Error("Format data Excel tidak valid.");

  const client = getSupabaseClient();
  const { data: classRecord, error: classError } = await client.from("data_kelas")
    .select("id, nama_kelas").eq("id", classId).maybeSingle();
  if (classError) throwSupabaseError(classError);
  if (!classRecord) throw new Error("Kelas tidak ditemukan. Tambahkan kelas dulu.");

  const normalizedRows = rows.map((row, index) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[key.trim().toLowerCase()] = String(value ?? "").trim();
    });
    return { nis: normalized.nis || "", nama: normalized.nama || "", rowNumber: index + 3 };
  }).filter((row) => row.nis || row.nama);

  const rowsByNis = new Map();
  normalizedRows.forEach((row) => {
    if (!row.nis || !row.nama || row.nis.length > 255 || row.nama.length > 255) {
      throw new Error(`Baris Excel ${row.rowNumber}: NIS dan Nama wajib diisi (maksimal 255 karakter).`);
    }
    const previous = rowsByNis.get(row.nis);
    if (previous && previous.nama !== row.nama) {
      throw new Error(`NIS ${row.nis} memiliki nama berbeda di file Excel.`);
    }
    rowsByNis.set(row.nis, row);
  });
  if (!rowsByNis.size) throw new Error("File Excel tidak berisi data siswa.");

  const nisValues = [...rowsByNis.keys()];
  const { data: existingStudents, error: lookupError } = await client.from("data_siswa")
    .select("id, nis").in("nis", nisValues);
  if (lookupError) throwSupabaseError(lookupError);

  const studentsByNis = new Map(existingStudents.map((student) => [student.nis, student]));
  const newStudents = [...rowsByNis.values()]
    .filter((row) => !studentsByNis.has(row.nis))
    .map(({ nis, nama }) => ({ nis, nama }));

  if (newStudents.length) {
    const { data, error } = await client.from("data_siswa")
      .insert(newStudents).select("id, nis");
    if (error) throwSupabaseError(error);
    data.forEach((student) => studentsByNis.set(student.nis, student));
  }

  const students = [...rowsByNis.keys()].map((nis) => studentsByNis.get(nis));
  const { data: existingLinks, error: linksLookupError } = await client.from("siswa_kelas")
    .select("siswa_id").eq("kelas_id", classId)
    .in("siswa_id", students.map((student) => student.id));
  if (linksLookupError) {
    const newStudentIds = newStudents.map((row) => studentsByNis.get(row.nis).id);
    if (newStudentIds.length) await client.from("data_siswa").delete().in("id", newStudentIds);
    throwSupabaseError(linksLookupError);
  }

  const existingIds = new Set(existingLinks.map((link) => String(link.siswa_id)));
  const newLinks = students
    .filter((student) => !existingIds.has(String(student.id)))
    .map((student) => ({ kelas_id: classId, siswa_id: student.id }));

  if (newLinks.length) {
    const { error } = await client.from("siswa_kelas").insert(newLinks);
    if (error) {
      const newStudentIds = newStudents.map((row) => studentsByNis.get(row.nis).id);
      if (newStudentIds.length) await client.from("data_siswa").delete().in("id", newStudentIds);
      throwSupabaseError(error);
    }
  }

  return {
    className: classRecord.nama_kelas,
    studentsAdded: newStudents.length,
    linksAdded: newLinks.length,
    linksExisting: students.length - newLinks.length,
  };
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
  const uniqueField = { siswa: "nis", guru: "nip" }[resource];
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
    .select("id, nis, nama, photo_path").in("id", studentIds).order("nama", { ascending: true });
  if (studentsError) throwSupabaseError(studentsError);
  return {
    data: data.map((student) => ({ ...student, photo_endpoint: student.photo_path })),
    className: classRecord.nama_kelas,
  };
}

