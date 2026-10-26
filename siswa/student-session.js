window.studentSessionReady = new Promise((resolve) => {
  const loginPath = document.body.dataset.loginPath || "login.html";
  let nis = sessionStorage.getItem("ypn_student_nis");

  // Jika tidak ada di sessionStorage, cek apakah Remember Me aktif di localStorage
  if (!nis && localStorage.getItem("ypn_remember_student_flag") === "true") {
    const rememberedNis = localStorage.getItem("ypn_remember_student_nis");
    if (rememberedNis) {
      nis = rememberedNis;
      try {
        sessionStorage.setItem("ypn_student_nis", nis);
      } catch (_) {}
    }
  }

  if (!nis) {
    window.location.replace(loginPath);
    resolve(false);
    return;
  }

  // Tampilkan NIS awal sebagai placeholder
  const studentNameEls = document.querySelectorAll("#studentName");
  studentNameEls.forEach((el) => {
    el.textContent = `NIS ${nis}`;
  });

  // Fungsi update UI nama dan foto profil di topbar
  function updateStudentTopbarUI(profile) {
    if (!profile) return;

    if (profile.nama) {
      document.querySelectorAll("#studentName").forEach((el) => {
        el.textContent = profile.nama;
        el.title = `NIS: ${profile.nis || nis}`;
      });
    }

    if (profile.photo_url) {
      document.querySelectorAll("#studentAvatar, .img-profile").forEach((img) => {
        img.src = profile.photo_url;
        img.style.objectFit = "cover";
        img.onerror = function () {
          this.src = "img/undraw_profile.svg";
          this.onerror = null;
        };
      });
    }
  }

  // Helper untuk mendapatkan URL foto dari photo_path
  function getStudentPhotoUrl(photoPath) {
    if (!photoPath) return null;
    if (photoPath.startsWith("http://") || photoPath.startsWith("https://") || photoPath.startsWith("data:")) {
      return photoPath;
    }
    const config = window.SUPABASE_CONFIG;
    if (!config?.url) return null;
    const cleanUrl = config.url.replace(/\/+$/, "");
    const cleanPath = photoPath.replace(/^\/+/, "");
    return `${cleanUrl}/storage/v1/object/public/student-photos/${cleanPath}`;
  }

  // 1. Terapkan cache sesi secara instan jika sudah ada
  const cacheKey = "ypn_student_profile_" + nis;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      updateStudentTopbarUI(parsed);
    }
  } catch (_) {}

  // 2. Fetch data profil siswa dari Supabase secara asinkron
  async function fetchStudentProfile() {
    // Tunggu hingga library dan konfigurasi Supabase siap
    let attempts = 0;
    while ((!window.supabase?.createClient || !window.SUPABASE_CONFIG?.url) && attempts < 25) {
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    if (!window.supabase?.createClient || !window.SUPABASE_CONFIG?.url) return;

    try {
      const client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
      let profile = null;

      // Coba lewat RPC get_student_profile
      try {
        const { data: res, error: rpcErr } = await client.rpc("get_student_profile", { p_nis: nis });
        if (!rpcErr && res?.success) {
          profile = {
            nama: res.nama,
            nis: res.nis,
            photo_path: res.photo_path,
            photo_url: getStudentPhotoUrl(res.photo_path),
          };
        }
      } catch (_) {}

      // Fallback: lewat get_student_exam_history
      if (!profile) {
        try {
          const { data: resHist } = await client.rpc("get_student_exam_history", { p_nis: nis });
          if (resHist?.success && resHist.siswa) {
            profile = {
              nama: resHist.siswa.nama,
              nis: resHist.siswa.nis,
              photo_path: null,
              photo_url: null,
            };
          }
        } catch (_) {}
      }

      // Jika bucket bersifat private, fallback ke createSignedUrl
      if (profile?.photo_path && !profile.photo_url) {
        try {
          const { data: signedData } = await client.storage
            .from("student-photos")
            .createSignedUrl(profile.photo_path, 3600);
          if (signedData?.signedUrl) {
            profile.photo_url = signedData.signedUrl;
          }
        } catch (_) {}
      }

      if (profile) {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(profile));
        } catch (_) {}
        updateStudentTopbarUI(profile);
      }
    } catch (err) {
      console.warn("Gagal memuat profil siswa:", err);
    }
  }

  // Jalankan pemuatan profil
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchStudentProfile);
  } else {
    fetchStudentProfile();
  }

  function performStudentLogout() {
    sessionStorage.removeItem("ypn_student_nis");
    sessionStorage.removeItem(cacheKey);
    sessionStorage.clear();
    // Hilangkan flag auto-login agar tidak redirect otomatis, tapi biarkan NIS tersimpan untuk prefill form login
    localStorage.removeItem("ypn_remember_student_flag");
    window.location.replace(loginPath);
  }

  document.querySelectorAll("#logoutForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      performStudentLogout();
    });
  });

  document.querySelectorAll('a[data-target="#logoutModal"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      if (typeof window.jQuery === "undefined" || !window.jQuery.fn || !window.jQuery.fn.modal) {
        e.preventDefault();
        if (window.confirm("Apakah Anda yakin ingin logout?")) {
          performStudentLogout();
        }
      }
    });
  });

  resolve(true);
});
