import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function formatPhoneNumber(raw: string): string {
  let cleaned = raw.replace(/[^0-9]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("8")) {
    cleaned = "62" + cleaned;
  }
  return cleaned;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const wasenderApiKey = Deno.env.get("WASENDER_API_KEY") ?? "";
    let wasenderApiUrl = Deno.env.get("WASENDER_API_URL") || "";

    if (!wasenderApiUrl) {
      // Auto-detect: if token starts with wsk_ (WASender.dev token), use api.wasender.dev
      if (wasenderApiKey.startsWith("wsk_")) {
        wasenderApiUrl = "https://api.wasender.dev/messages/text";
      } else {
        wasenderApiUrl = "https://api.wasender.dev/messages/text"; // Default to wasender.dev
      }
    }

    if (!wasenderApiKey) {
      console.error("WASENDER_API_KEY is not configured in Supabase Secrets.");
      return new Response(
        JSON.stringify({
          error: "WASENDER_API_KEY belum dikonfigurasi di Supabase Secrets.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const client = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));

    // Support both Database Webhook (body.record) and Direct Function Call (body.attendance_id)
    let attendance = body.record;
    const attendanceId = body.attendance_id;

    if (!attendance && attendanceId) {
      const { data, error } = await client
        .from("absensi")
        .select("*")
        .eq("id", attendanceId)
        .maybeSingle();

      if (error) throw error;
      attendance = data;
    }

    if (!attendance) {
      return new Response(
        JSON.stringify({ error: "Data absensi tidak ditemukan dalam payload request." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Skip if already sent to prevent duplicate messages
    if (attendance.wa_status === "sent") {
      return new Response(
        JSON.stringify({ message: "Notifikasi WA sudah pernah dikirim sebelumnya." }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch student data including WhatsApp number
    const { data: student, error: studentError } = await client
      .from("data_siswa")
      .select("id, nis, nama, no_wa")
      .eq("id", attendance.siswa_id)
      .maybeSingle();

    if (studentError || !student) {
      throw new Error(`Data siswa dengan ID ${attendance.siswa_id} tidak ditemukan.`);
    }

    if (!student.no_wa || !student.no_wa.trim()) {
      await client
        .from("absensi")
        .update({ wa_status: "skipped_no_phone" })
        .eq("id", attendance.id);

      return new Response(
        JSON.stringify({
          success: false,
          skipped: true,
          message: `Siswa ${student.nama} belum memiliki nomor WhatsApp terdaftar.`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const targetPhone = formatPhoneNumber(student.no_wa);
    if (!targetPhone || targetPhone.length < 9) {
      await client
        .from("absensi")
        .update({ wa_status: "invalid_phone" })
        .eq("id", attendance.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: `Nomor WhatsApp tidak valid: ${student.no_wa}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Format Indonesian timestamp
    const scanDate = new Date(attendance.waktu_scan || new Date());
    const waktuWib = scanDate.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tanggalIndo = scanDate.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const messageText = 
`*PEMBERITAHUAN KEHADIRAN SISWA*

Assalamu'alaikum Warahmatullahi Wabarakatuh,
Bapak/Ibu Orang Tua/Wali Murid yang kami hormati,

Alhamdulillah, ananda telah hadir di sekolah:
👤 *Nama*: ${student.nama}
🆔 *NIS*: ${student.nis}
📅 *Hari/Tanggal*: ${tanggalIndo}
⏰ *Waktu*: ${waktuWib} WIB
✅ *Status*: ${attendance.status || "Hadir"}

Terima kasih atas perhatian dan kerja sama Bapak/Ibu.
Wassalamu'alaikum Warahmatullahi Wabarakatuh.`;

    // Send HTTP POST to WASender API
    // Kirim field "body" (wasender.dev) dan "text" (wasenderapi.com) agar kompatibel dengan keduanya
    const waResponse = await fetch(wasenderApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${wasenderApiKey}`,
      },
      body: JSON.stringify({
        to: targetPhone,
        body: messageText,
        text: messageText,
      }),
    });

    const waResult = await waResponse.json().catch(() => null);

    if (waResponse.ok) {
      await client
        .from("absensi")
        .update({
          wa_status: "sent",
          wa_sent_at: new Date().toISOString(),
        })
        .eq("id", attendance.id);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Notifikasi WA berhasil dikirim ke ${student.nama} (${targetPhone})`,
          result: waResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      console.error("WASender Error:", waResult);
      await client
        .from("absensi")
        .update({ wa_status: "failed" })
        .eq("id", attendance.id);

      const errorMessage =
        waResult?.message ||
        (waResponse.status === 401
          ? "API Key WASender tidak valid (Unauthorized). Periksa WASENDER_API_KEY di Supabase Secrets."
          : `Gagal mengirim ke WASender (HTTP ${waResponse.status}).`);

      return new Response(
        JSON.stringify({
          success: false,
          wasender_status: waResponse.status,
          error: errorMessage,
          detail: waResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Server Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Terjadi kesalahan internal.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
