const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: {...cors, "Content-Type":"application/json; charset=utf-8"}
});
function authorized(req, env) {
  return req.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}
async function getSettings(env) {
  return await env.DB.prepare("SELECT * FROM settings WHERE id=1").first();
}
function localDateIran() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function localTimeIran() {
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tehran",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
}
async function createDinnerMessage(env, s) {
  const date = localDateIran();
  const prompt = `برای امین یک پیام فارسی قابل ارسال به همسرش ${s.recipient_name} بساز.
تاریخ میلادی ${date} است؛ روز هفته و تاریخ شمسی را دقیق محاسبه کن.
وزن مبنا ${s.baseline_weight} کیلوگرم است. هدف موقت پروتئین روزانه ${s.protein_target} گرم است.
ملاحظات: ${s.dietary_notes}
یک شام متنوع نسبت به شام‌های قبلی، پرپروتئین و کم‌کالری پیشنهاد بده.
مقدار تمام مواد اولیه را دقیق به گرم، روش پخت کم‌روغن، کالری و پروتئین تقریبی کل وعده را بنویس.
هدف کاهش چربی و حفظ عضله است؛ از رژیم پرپروتئین افراطی و ادعاهای درمانی پرهیز کن.
با توجه به سابقه سنگ کلیه، هدف پروتئین را قطعی/پزشکی جلوه نده و یادآوری کن که باید با توجه به نوع سنگ و عملکرد کلیه بازبینی شود.
پیام کوتاه، روشن و صمیمی باشد.`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      messages:[{role:"system",content:"تو دستیار برنامه‌ریزی غذایی محتاط هستی. اطلاعات را جعل نکن و برآوردهای غذایی را تقریبی اعلام کن."},{role:"user",content:prompt}],
      temperature:0.7
    })
  });
  if(!response.ok) throw new Error("AI generation failed: "+await response.text());
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "ساخت پیام ناموفق بود.";
}
async function sendWhatsApp(env, phone, message) {
  // Meta requires an approved template for business-initiated messages outside the 24-hour customer-service window.
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v23.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product:"whatsapp", to:phone, type:"template",
    template:{
      name:env.WHATSAPP_TEMPLATE_NAME || "daily_dinner",
      language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE || "fa"},
      components:[{type:"body",parameters:[{type:"text",text:message.slice(0,1024)}]}]
    }
  };
  const res = await fetch(url,{method:"POST",headers:{
    "Authorization":`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    "Content-Type":"application/json"
  },body:JSON.stringify(payload)});
  const body=await res.text();
  if(!res.ok) throw new Error("WhatsApp send failed: "+body);
  return body;
}
async function runDaily(env) {
  const s=await getSettings(env);
  if(!s || !s.recipient_phone) throw new Error("Recipient WhatsApp number is not configured.");
  if(localTimeIran() !== (s.send_time || "19:00")) return;
  const date=localDateIran();
  const reservation=await env.DB.prepare(
    "INSERT OR IGNORE INTO sent_log(send_date,message,status) VALUES(?,?,?)"
  ).bind(date,"","pending").run();
  if(!reservation.meta || reservation.meta.changes !== 1) return; // Already attempted today.
  try {
    const message=await createDinnerMessage(env,s);
    const provider=await sendWhatsApp(env,s.recipient_phone,message);
    await env.DB.prepare("UPDATE sent_log SET message=?,status=?,provider_response=? WHERE send_date=?")
      .bind(message,"sent",provider,date).run();
  } catch(e) {
    await env.DB.prepare("UPDATE sent_log SET status=?,provider_response=? WHERE send_date=?")
      .bind("failed",String(e),date).run();
    throw e;
  }
}
export default {
  async fetch(req,env) {
    if(req.method==="OPTIONS") return new Response(null,{headers:cors});
    const url=new URL(req.url);
    if(url.pathname.startsWith("/api/") && !authorized(req,env)) return json({error:"Unauthorized"},401);
    try {
      if(url.pathname==="/api/settings" && req.method==="GET") return json({settings:await getSettings(env)});
      if(url.pathname==="/api/settings" && req.method==="PUT") {
        const s=await req.json();
        await env.DB.prepare(`UPDATE settings SET recipient_name=?,recipient_phone=?,baseline_weight=?,protein_target=?,send_time=?,timezone=?,dietary_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
          .bind(s.recipient_name||"راضیه",s.recipient_phone||"",Number(s.baseline_weight)||116,s.protein_target||"110-125",s.send_time||"19:00",s.timezone||"Asia/Tehran",s.dietary_notes||"").run();
        return json({ok:true});
      }
      if(url.pathname==="/api/preview" && req.method==="POST") {
        const s={...(await getSettings(env)),...(await req.json())};
        return json({message:await createDinnerMessage(env,s)});
      }
      if(url.pathname==="/api/test-send" && req.method==="POST") {
        const s=await getSettings(env); const body=await req.json();
        const result=await sendWhatsApp(env,body.phone||s.recipient_phone,body.message||"پیام آزمایشی از برنامه غذایی امین");
        return json({ok:true,result});
      }
      return env.ASSETS.fetch(req);
    } catch(e) { return json({error:e.message||"Unexpected error"},500); }
  },
  async scheduled(event,env,ctx) {
    ctx.waitUntil(runDaily(env).catch(e=>console.error("Scheduled run failed",e)));
  }
};
