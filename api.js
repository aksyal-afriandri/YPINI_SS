const SUPABASE_STORAGE_BUCKET = "student-photos";
const RESOURCE_FIELDS = {
  siswa: ["nis", "nama"],
  guru: ["nip", "nama"],
  kelas: ["jenjang", "nama_kelas"],
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
  if (["42P01", "PGRST204", "PGRST205"].includes(error?.code)) {
    throw new Error("Skema tahun ajaran belum lengkap. Jalankan supabase-academic-year-settings.sql dan supabase-academic-year-relations.sql di Supabase SQL Editor.");
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
  if (resource === "kelas") {
    const yearId = await getActiveAcademicYearId();
    const { data, error } = await getSupabaseClient().from("kelas_tahun_ajaran")
      .select("id, kelas_id, jenjang, nama_kelas")
      .eq("tahun_ajaran_id", yearId)
      .order("nama_kelas", { ascending: true });
    if (error) throwSupabaseError(error);
    return { data };
  }

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

async function getActiveAcademicYearId() {
  if (window.activeAcademicYear?.id) return String(window.activeAcademicYear.id);

  const { data, error } = await getSupabaseClient().from("pengaturan_tahun_ajaran")
    .select("tahun_ajaran_id").eq("id", 1).maybeSingle();
  if (error) throwSupabaseError(error);
  if (!data?.tahun_ajaran_id) {
    throw new Error("Pilih tahun ajaran aktif terlebih dahulu.");
  }
  return String(data.tahun_ajaran_id);
}

async function getAcademicYearPlacements({ classYearId = null, attendanceDate = null } = {}) {
  const yearId = await getActiveAcademicYearId();
  let query = getSupabaseClient().from("siswa_kelas_tahun_ajaran")
    .select("id, siswa_id, kelas_tahun_ajaran_id, tanggal_mulai")
    .eq("tahun_ajaran_id", yearId);
  if (classYearId) query = query.eq("kelas_tahun_ajaran_id", classYearId);
  if (attendanceDate) {
    query = query.lte("tanggal_mulai", attendanceDate)
      .or(`tanggal_selesai.is.null,tanggal_selesai.gte.${attendanceDate}`);
  }
  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return data;
}

async function apiGetAcademicYearSettings() {
  const client = getSupabaseClient();
  const [{ data: years, error: yearsError }, { data: setting, error: settingError }] = await Promise.all([
    client.from("tahun_ajaran").select("id, tahun_ajaran").order("id", { ascending: false }),
    client.from("pengaturan_tahun_ajaran").select("tahun_ajaran_id").eq("id", 1).maybeSingle(),
  ]);
  if (yearsError) throwSupabaseError(yearsError);
  if (settingError) throwSupabaseError(settingError);
  return { years, activeYearId: setting?.tahun_ajaran_id ?? "" };
}

async function apiSetActiveAcademicYear(yearId) {
  const client = getSupabaseClient();
  const { data: year, error: yearError } = await client.from("tahun_ajaran")
    .select("id").eq("id", yearId).maybeSingle();
  if (yearError) throwSupabaseError(yearError);
  if (!year) throw new Error("Tahun ajaran tidak ditemukan.");

  const { error } = await client.from("pengaturan_tahun_ajaran").upsert({
    id: 1,
    tahun_ajaran_id: year.id,
  }, { onConflict: "id" });
  if (error) throwSupabaseError(error);
}

function attendanceDateInJakarta(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseAttendanceNis(rawCode) {
  const value = String(rawCode || "").trim();
  if (!value) throw new Error("QR atau barcode belum terbaca.");

  try {
    const payload = JSON.parse(value);
    const nis = payload && typeof payload === "object"
      ? payload.nis ?? payload.NIS
      : null;
    if (nis !== undefined && nis !== null && String(nis).trim()) {
      return String(nis).trim();
    }
  } catch {
    const match = value.match(/(?:^|[\r\n;,|])\s*nis\s*[:=]\s*([^\r\n;,|]+)/i);
    if (match) return match[1].trim();
  }

  return value;
}

async function apiRecordAttendance(rawCode) {
  const client = getSupabaseClient();
  const nis = parseAttendanceNis(rawCode);
  const { data: student, error: studentError } = await client.from("data_siswa")
    .select("id, nis, nama, photo_path").eq("nis", nis).maybeSingle();
  if (studentError) throwSupabaseError(studentError);
  if (!student) throw new Error(`NIS ${nis} tidak ditemukan di data siswa.`);

  const attendanceDate = attendanceDateInJakarta();
  const placements = await getAcademicYearPlacements({ attendanceDate });
  const studentPlacements = placements.filter((placement) => String(placement.siswa_id) === String(student.id));
  if (!studentPlacements.length) {
    throw new Error("Siswa belum ditempatkan di kelas pada tahun ajaran aktif.");
  }
  if (studentPlacements.length > 1) {
    throw new Error("Siswa memiliki lebih dari satu kelas aktif. Periksa riwayat penempatannya.");
  }

  const markedAt = new Date().toISOString();
  const { data: attendance, error: attendanceError } = await client.from("absensi")
    .insert({
      siswa_id: student.id,
      siswa_kelas_tahun_ajaran_id: studentPlacements[0].id,
      tanggal: attendanceDate,
      waktu_scan: markedAt,
      status: "Hadir",
    })
    .select("id, tanggal, waktu_scan, status")
    .single();

  let alreadyRecorded = false;
  let record = attendance;
  if (attendanceError?.code === "23505") {
    const { data: existing, error: existingError } = await client.from("absensi")
      .select("id, tanggal, waktu_scan, status")
      .eq("siswa_id", student.id)
      .eq("tanggal", attendanceDate)
      .single();
    if (existingError) throwSupabaseError(existingError);
    record = existing;
    alreadyRecorded = true;
  } else if (attendanceError) {
    throwSupabaseError(attendanceError);
  }

  let photoUrl = null;
  if (student.photo_path) {
    const { data: photo, error: photoError } = await client.storage
      .from(SUPABASE_STORAGE_BUCKET).createSignedUrl(student.photo_path, 600);
    if (!photoError) photoUrl = photo.signedUrl;
  }

  return {
    student: { id: student.id, nis: student.nis, nama: student.nama, photoUrl },
    attendance: record,
    alreadyRecorded,
  };
}

async function apiGetTodayAttendance(classId = null, attendanceDate = attendanceDateInJakarta()) {
  const client = getSupabaseClient();
  const placements = await getAcademicYearPlacements({ classYearId: classId, attendanceDate });
  const placementIds = [...new Set(placements.map((placement) => placement.id))];
  if (!placementIds.length) return { data: [] };

  let query = client.from("absensi")
    .select("id, tanggal, waktu_scan, status, data_siswa(nis, nama)")
    .eq("tanggal", attendanceDate)
    .in("siswa_kelas_tahun_ajaran_id", placementIds)
    .order("waktu_scan", { ascending: false });

  const { data, error } = await query;
  if (error) throwSupabaseError(error);
  return { data };
}

async function apiGetMonthlyAttendance(classId, year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100
    || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    throw new Error("Bulan atau tahun rekap tidak valid.");
  }

  const client = getSupabaseClient();
  const placements = await getAcademicYearPlacements({ classYearId: classId });
  const placementIds = [...new Set(placements.map((placement) => placement.id))];
  const studentIds = [...new Set(placements.map((placement) => placement.siswa_id))];
  if (!placementIds.length) return { students: [], records: [] };

  const students = [];
  const studentPageSize = 1000;
  for (let offset = 0; ; offset += studentPageSize) {
    let studentsQuery = client.from("data_siswa").select("id, nis, nama")
      .order("nama").order("id", { ascending: true })
      .range(offset, offset + studentPageSize - 1);
    studentsQuery = studentsQuery.in("id", studentIds);
    const { data: page, error: studentsError } = await studentsQuery;
    if (studentsError) throwSupabaseError(studentsError);
    students.push(...page);
    if (page.length < studentPageSize) break;
  }

  const monthStart = `${numericYear}-${String(numericMonth).padStart(2, "0")}-01`;
  const daysInMonth = new Date(numericYear, numericMonth, 0).getDate();
  const monthEnd = `${numericYear}-${String(numericMonth).padStart(2, "0")}-${daysInMonth}`;
  const records = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let recordsQuery = client.from("absensi")
      .select("id, siswa_id, tanggal, waktu_scan, status")
      .gte("tanggal", monthStart)
      .lte("tanggal", monthEnd)
      .order("tanggal", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    recordsQuery = recordsQuery.in("siswa_kelas_tahun_ajaran_id", placementIds);

    const { data: page, error: recordsError } = await recordsQuery;
    if (recordsError) throwSupabaseError(recordsError);
    records.push(...page);
    if (page.length < pageSize) break;
  }

  return { students, records, daysInMonth };
}

async function saveRecord(path, input, isUpdate) {
  const { resource, id } = parseDataPath(path, isUpdate);
  const client = getSupabaseClient();
  const payload = formPayload(resource, input);
  if (resource === "kelas") {
    const yearId = await getActiveAcademicYearId();
    if (isUpdate) {
      const { data, error } = await client.from("kelas_tahun_ajaran")
        .update({ jenjang: payload.jenjang, nama_kelas: payload.nama_kelas })
        .eq("id", id).eq("tahun_ajaran_id", yearId)
        .select("id, kelas_id, jenjang, nama_kelas").single();
      if (error) throwSupabaseError(error);
      return { data };
    }

    const { data: baseClass, error: classError } = await client.from("data_kelas")
      .insert({ nama_kelas: payload.nama_kelas }).select("id").single();
    if (classError) throwSupabaseError(classError);

    const { data, error } = await client.from("kelas_tahun_ajaran").insert({
      kelas_id: baseClass.id,
      tahun_ajaran_id: yearId,
      jenjang: payload.jenjang,
      nama_kelas: payload.nama_kelas,
    }).select("id, kelas_id, jenjang, nama_kelas").single();
    if (error) {
      await client.from("data_kelas").delete().eq("id", baseClass.id);
      throwSupabaseError(error);
    }
    return { data };
  }

  let uploadedPath = null;
  let previousPhotoPath = null;

  if (resource === "siswa" && input instanceof FormData) {
    const photoFile = input.get("photo");
    const hasNewPhoto = photoFile instanceof File && photoFile.size > 0;
    if (isUpdate && hasNewPhoto) {
      const { data: current, error: currentError } = await client
        .from(resourceTable(resource)).select("photo_path").eq("id", id).single();
      if (currentError) throwSupabaseError(currentError);
      previousPhotoPath = current.photo_path;
    }
    uploadedPath = await uploadStudentPhoto(photoFile);
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

async function apiPostStudentToClass(classId, input) {
  const client = getSupabaseClient();
  const yearId = await getActiveAcademicYearId();
  const { data: classRecord, error: classError } = await client.from("kelas_tahun_ajaran")
    .select("id, kelas_id, tahun_ajaran_id, jenjang, nama_kelas")
    .eq("id", classId).eq("tahun_ajaran_id", yearId).maybeSingle();
  if (classError) throwSupabaseError(classError);
  if (!classRecord) throw new Error("Kelas tidak ditemukan. Tambahkan kelas dulu.");

  const values = formPayload("siswa", input);
  const { data: existingStudent, error: studentError } = await client.from("data_siswa")
    .select("id, nis, nama").eq("nis", values.nis).maybeSingle();
  if (studentError) throwSupabaseError(studentError);

  const today = attendanceDateInJakarta();
  const currentPlacements = existingStudent
    ? (await getAcademicYearPlacements({ attendanceDate: today }))
      .filter((placement) => String(placement.siswa_id) === String(existingStudent.id))
    : [];
  const currentPlacement = currentPlacements[0];
  if (currentPlacements.length > 1) {
    throw new Error("Siswa memiliki lebih dari satu kelas aktif pada tahun ajaran ini.");
  }
  if (currentPlacement && String(currentPlacement.kelas_tahun_ajaran_id) !== String(classId)) {
    throw new Error("Siswa sudah terdaftar di kelas lain pada tahun ajaran ini.");
  }
  if (currentPlacement) return { created: false, linked: false, student: existingStudent };

  let student = existingStudent;
  let created = false;
  if (!student) {
    const result = await apiPost("/data/siswa", input);
    student = result.data;
    created = true;
  }

  const { error: linkError } = await client.from("siswa_kelas_tahun_ajaran").insert({
    siswa_id: student.id,
    kelas_tahun_ajaran_id: classRecord.id,
    tahun_ajaran_id: classRecord.tahun_ajaran_id,
    tanggal_mulai: today,
  });
  if (linkError) {
    if (created) await apiDelete(`/data/siswa/${encodeURIComponent(student.id)}`);
    throwSupabaseError(linkError);
  }
  return {
    created,
    linked: true,
    student,
    className: [classRecord.jenjang, classRecord.nama_kelas].filter(Boolean).join(" - "),
  };
}

async function apiImportStudentsToClass(classId, rows) {
  if (!Array.isArray(rows)) throw new Error("Format data Excel tidak valid.");

  const client = getSupabaseClient();
  const yearId = await getActiveAcademicYearId();
  const { data: classRecord, error: classError } = await client.from("kelas_tahun_ajaran")
    .select("id, tahun_ajaran_id, jenjang, nama_kelas")
    .eq("id", classId).eq("tahun_ajaran_id", yearId).maybeSingle();
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
  const today = attendanceDateInJakarta();
  const existingPlacements = await getAcademicYearPlacements({ attendanceDate: today });
  const requestedStudentIds = new Set(students.map((student) => String(student.id)));
  const conflictingPlacement = existingPlacements.find((placement) =>
    requestedStudentIds.has(String(placement.siswa_id))
      && String(placement.kelas_tahun_ajaran_id) !== String(classId));
  if (conflictingPlacement) {
    const newStudentIds = newStudents.map((row) => studentsByNis.get(row.nis).id);
    if (newStudentIds.length) await client.from("data_siswa").delete().in("id", newStudentIds);
    throw new Error("File berisi siswa yang sudah ditempatkan di kelas lain pada tahun ajaran ini.");
  }
  const existingIds = new Set(existingPlacements
    .filter((placement) => String(placement.kelas_tahun_ajaran_id) === String(classId))
    .map((placement) => String(placement.siswa_id)));
  const newLinks = students
    .filter((student) => !existingIds.has(String(student.id)))
    .map((student) => ({
      siswa_id: student.id,
      kelas_tahun_ajaran_id: classRecord.id,
      tahun_ajaran_id: classRecord.tahun_ajaran_id,
      tanggal_mulai: today,
    }));

  if (newLinks.length) {
    const { error } = await client.from("siswa_kelas_tahun_ajaran").insert(newLinks);
    if (error) {
      const newStudentIds = newStudents.map((row) => studentsByNis.get(row.nis).id);
      if (newStudentIds.length) await client.from("data_siswa").delete().in("id", newStudentIds);
      throwSupabaseError(error);
    }
  }

  return {
    className: [classRecord.jenjang, classRecord.nama_kelas].filter(Boolean).join(" - "),
    studentsAdded: newStudents.length,
    linksAdded: newLinks.length,
    linksExisting: students.length - newLinks.length,
  };
}

function apiPut(path, payload) {
  return saveRecord(path, payload, true);
}

async function apiDeleteStudentPhoto(id) {
  const client = getSupabaseClient();
  const { data: student, error: lookupError } = await client.from("data_siswa")
    .select("photo_path").eq("id", id).single();
  if (lookupError) throwSupabaseError(lookupError);
  if (!student.photo_path) return { removed: false, cleanupWarning: false };

  const { error: updateError } = await client.from("data_siswa")
    .update({ photo_path: null }).eq("id", id);
  if (updateError) throwSupabaseError(updateError);

  const { error: storageError } = await client.storage.from(SUPABASE_STORAGE_BUCKET)
    .remove([student.photo_path]);
  return { removed: true, cleanupWarning: Boolean(storageError) };
}

async function apiDelete(path) {
  const { resource, id } = parseDataPath(path, true);
  const client = getSupabaseClient();
  if (resource === "kelas") {
    const yearId = await getActiveAcademicYearId();
    const { error } = await client.from("kelas_tahun_ajaran")
      .delete().eq("id", id).eq("tahun_ajaran_id", yearId);
    if (error) throwSupabaseError(error);
    return { message: "Data kelas tahun ajaran ini berhasil dihapus." };
  }

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
  const yearId = await getActiveAcademicYearId();
  const { data: classRecord, error: classError } = await client.from("kelas_tahun_ajaran")
    .select("jenjang, nama_kelas").eq("id", classId).eq("tahun_ajaran_id", yearId).single();
  if (classError) throwSupabaseError(classError);

  const { data: links, error } = await client.from("siswa_kelas_tahun_ajaran")
    .select("siswa_id").eq("kelas_tahun_ajaran_id", classId)
    .eq("tahun_ajaran_id", yearId);
  if (error) throwSupabaseError(error);
  const className = [classRecord.jenjang, classRecord.nama_kelas].filter(Boolean).join(" - ");
  if (!links.length) return { data: [], className };

  const studentIds = [...new Set(links.map((link) => link.siswa_id))];
  const { data, error: studentsError } = await client.from("data_siswa")
    .select("id, nis, nama, photo_path").in("id", studentIds).order("nama", { ascending: true });
  if (studentsError) throwSupabaseError(studentsError);
  return {
    data: data.map((student) => ({
      ...student,
      jenjang: classRecord.jenjang,
      photo_endpoint: student.photo_path,
    })),
    className,
  };
}

async function apiGetStudentsWithActiveClass() {
  const [studentResult, placements] = await Promise.all([
    apiGet("/data/siswa"),
    getAcademicYearPlacements(),
  ]);
  const classYearIds = [...new Set(placements.map((placement) => placement.kelas_tahun_ajaran_id))];
  const classesById = new Map();
  if (classYearIds.length) {
    const { data, error } = await getSupabaseClient().from("kelas_tahun_ajaran")
      .select("id, jenjang, nama_kelas").in("id", classYearIds);
    if (error) throwSupabaseError(error);
    data.forEach((classYear) => classesById.set(String(classYear.id), classYear));
  }

  const placementsByStudent = new Map();
  placements.forEach((placement) => {
    const studentKey = String(placement.siswa_id);
    placementsByStudent.set(studentKey, [...(placementsByStudent.get(studentKey) || []), placement]);
  });

  return {
    data: studentResult.data.map((student) => {
      const studentPlacements = (placementsByStudent.get(String(student.id)) || [])
        .sort((left, right) => right.tanggal_mulai.localeCompare(left.tanggal_mulai));
      const classYear = studentPlacements.length
        ? classesById.get(String(studentPlacements[0].kelas_tahun_ajaran_id))
        : null;
      return {
        ...student,
        jenjang: classYear?.jenjang || "",
        nama_kelas: classYear?.nama_kelas || "",
      };
    }),
  };
}

