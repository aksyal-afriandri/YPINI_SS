document.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("supabaseStatus");
  if (!(await window.adminSessionReady)) {
    if (status) status.textContent = window.adminSessionError || "Sesi admin diperlukan.";
    return;
  }

  const tableByLabel = {
    "Total Siswa": "siswa",
    "Total Guru": "guru",
    "Total Kelas": "kelas",
    "Total Pelajaran": "pelajaran",
  };

  await Promise.all(Object.entries(tableByLabel).map(async ([label, resource]) => {
    const heading = [...document.querySelectorAll(".text-uppercase")]
      .find((element) => element.textContent.trim() === label);
    const value = heading?.parentElement.querySelector(".h5");
    if (!value) return;
    try {
      const result = await apiGet(`/data/${resource}`);
      value.textContent = String(result.data.length);
    } catch (error) {
      value.textContent = "-";
      value.title = error.message;
    }
  }));
});