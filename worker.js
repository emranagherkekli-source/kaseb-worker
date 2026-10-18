export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ۱. هندل کردن اتصال وب‌سوکت اپلیکیشن (/ws)
    if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
      if (!env.KASEB_ROOM) {
        return new Response(JSON.stringify({
          error: "Durable Object binding 'KASEB_ROOM' is not configured.",
          hint: "لطفاً با استفاده از wrangler.toml پروژه را دیپلوی کنید."
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      const id = env.KASEB_ROOM.idFromName("global_kaseb_room");
      const room = env.KASEB_ROOM.get(id);
      return room.fetch(request);
    }

    // ۲. دریافت پیام از گوگل اپ اسکریپت و پخش به همه کلاینت‌ها (/broadcast)
    if (url.pathname === "/broadcast" || url.pathname.endsWith("/broadcast")) {
      if (!env.KASEB_ROOM) {
        return new Response(JSON.stringify({
          error: "Durable Object binding 'KASEB_ROOM' is missing."
        }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      const id = env.KASEB_ROOM.idFromName("global_kaseb_room");
      const room = env.KASEB_ROOM.get(id);
      return room.fetch(request);
    }
    // ۳. مسیر دریافت پیام از پایتون و ارسال به Code.gs (ضد فیلتر)
    if (url.pathname === "/sync-to-sheets" || url.pathname.endsWith("/sync-to-sheets")) {
      try {
        const body = await request.json();
        const targetUrl = "https://script.google.com/macros/s/AKfycbzu8n4g9NMtRcyT4tghWeR9o2fSaFLP1_I-zVUgXGxLLEqz0mDyOqEVLXQTZF1WhpCNCw/exec";
        
        const proxyReq = new Request(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        
        const response = await fetch(proxyReq);
        const result = await response.json();
        
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.toString() }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ۳. حفظ قابلیت پروکسی تلگرام (برای سازگاری با کدهای قبلی)
    if (url.pathname.includes("/bot") || url.pathname.startsWith("/bot")) {
      const telegramUrl = "https://api.telegram.org" + url.pathname + url.search;
      const proxyReq = new Request(telegramUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
        redirect: "follow"
      });
      return fetch(proxyReq);
    }

    // صفحه تست
    return new Response(JSON.stringify({
      status: "online",
      service: "Kaseb Realtime WebSocket & Telegram Proxy"
    }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};

export class KasebRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // پاسخ به درخواست اتصال وب‌سوکت
    if (url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // پخش پیام دریافتی
    if (url.pathname.endsWith("/broadcast")) {
      let messageText = "";
      if (request.method === "POST") {
        try {
          const body = await request.json();
          messageText = body.message || body.text || JSON.stringify(body);
        } catch (_) {
          messageText = await request.text();
        }
      } else {
        messageText = url.searchParams.get("message") || "update";
      }
      messageText = (messageText || "").trim();

      const activeSockets = this.state.getWebSockets();
      let sentCount = 0;

      for (const ws of activeSockets) {
        try {
          ws.send(messageText);
          sentCount++;
        } catch (_) {}
      }

      return new Response(JSON.stringify({
        success: true,
        sentCount: sentCount,
        message: messageText
      }), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") {
      ws.send("pong");
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, "Closed"); } catch (_) {}
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, "Error"); } catch (_) {}
  }
}
