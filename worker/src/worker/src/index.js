const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8"
    }
  });

function authorized(req, env) {
  const received = req.headers.get("X-Admin-Token");
  return !!env.ADMIN_TOKEN && received === env.ADMIN_TOKEN;
}

async function getSettings(env) {
  return await env.DB.prepare(
    "SELECT * FROM app_settings WHERE id=1"
  ).first();
}

async function saveSettings(env, s) {
  const phone = String(s.whatsapp_number ?? "").replace(/[\s()+-]/g, "");

  if (phone && !/^\d{10,15}$/.test(phone)) {
    throw new Error("شماره واتساپ باید با کد کشور و فقط شامل ارقام باشد.");
  }

  const weight = Number(s.baseline_weight);

  if (!Number.isFinite(weight) || weight < 30 || weight > 300) {
    throw new Error("وزن مبنا معتبر نیست.");
  }

  const sendTime = String(s.send_time || "");

  if (sendTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) {
    throw new Error("ساعت ارسال معتبر نیست.");
  }

  await env.DB.prepare(`
    UPDATE app_settings
    SET recipient_name=?,
        whatsapp_number=?,
        baseline_weight=?,
        target_protein=?,
        send_time=?,
        timezone=?,
        dietary_notes=?,
        active=?
    WHERE id=1
  `).bind(
    String(s.recipient_name || "راضیه").slice(0, 80),
    phone,
    weight,
    String(s.target_protein || "110-125").slice(0, 40),
    sendTime || null,
    "Asia/Tehran",
    String(s.dietary_notes || "").slice(0, 1000),
    s.active === false ? 0 : 1
  ).run();

  return getSettings(env);
}

function dateParts() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const jalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const weekday = new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    weekday: "long"
  }).format(now);

  return { date, jalali, weekday };
}

async function createDinnerMessage(env, s) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("کلید هوش مصنوعی هنوز در Cloudflare تنظیم نشده است.");
  }

  const d = dateParts();

  const prompt = `
یک پیام شام روزانه فارسی و قابل ارسال به ${s.recipient_name || "راضیه"} بنویس.
امروز ${d.weekday}، تاریخ شمسی ${d.jalali} و میلادی ${d.date} است.
وزن مبنا ${s.baseline_weight} کیلوگرم است.
هدف پروتئین ${s.target_protein} گرم است.
ملاحظات: ${s.dietary_notes || "ندارد"}.
یک شام متنوع، کم‌کالری و دارای پروتئین متعادل پیشنهاد بده.
مواد اولیه را با مقدار دقیق گرم، روش پخت کم‌روغن،
کالری و پروتئین تقریبی کل وعده بنویس.
از ادعای درمانی و توصیه پروتئین افراطی پرهیز کن.
با سابقه سنگ کلیه، یادآوری کن هدف پروتئین باید
با توجه به نوع سنگ و عملکرد کلیه بازبینی شود.
پیام صمیمی و مختصر باشد.
`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "دستیار برنامه غذایی محتاط هستی؛ مقادیر تغذیه‌ای را تقریبی اعلام کن."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    })
  });

  const body = await r.json();

  if (!r.ok) {
    throw new Error(body.error?.message || "خطا در تولید پیام هوشمند");
  }

  return body.choices?.[0]?.message?.content || "پیام تولید نشد.";
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const u = new URL(req.url);

    if (
      u.pathname.startsWith("/api/") &&
      u.pathname !== "/api/health"
    ) {
      const received = req.headers.get("X-Admin-Token");
      const secretConfigured = !!env.ADMIN_TOKEN;
      const headerReceived = !!received;
      const tokenMatches = secretConfigured && received === env.ADMIN_TOKEN;

      if (!tokenMatches) {
        return json({
          error:
            `Unauthorized | secretConfigured=${secretConfigured}` +
            ` | headerReceived=${headerReceived}` +
            ` | tokenMatches=${!!tokenMatches}`
        }, 401);
      }
    }

    try {
      if (u.pathname === "/api/health" && req.method === "GET") {
        return json({ ok: true, db: !!env.DB });
      }

      if (u.pathname === "/api/settings" && req.method === "GET") {
        return json({ settings: await getSettings(env) });
      }

      if (u.pathname === "/api/settings" && req.method === "PUT") {
        const settings = await saveSettings(env, await req.json());
        return json({ ok: true, settings });
      }

      if (u.pathname === "/api/preview" && req.method === "POST") {
        const s = {
          ...(await getSettings(env)),
          ...(await req.json())
        };

        return json({
          message: await createDinnerMessage(env, s)
        });
      }

      return env.ASSETS.fetch(req);

    } catch (e) {
      return json({
        error: e.message || "خطای غیرمنتظره"
      }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const s = await getSettings(env);

      if (!s?.active || !s?.send_time) return;

      const now = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tehran",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(new Date());

      if (now !== s.send_time) return;

      console.log(
        "Schedule reached; WhatsApp delivery is not enabled yet."
      );
    })());
  }
};
