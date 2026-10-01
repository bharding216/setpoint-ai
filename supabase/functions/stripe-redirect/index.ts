// Supabase Edge Function — stripe-redirect
// Handles Stripe Checkout success/cancel redirects.
// Serves a minimal HTML page that deep-links back into the app.

const APP_SCHEME = "setpoint";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // "success" or "cancel"

  const isSuccess = status === "success";
  const title = isSuccess ? "You're all set!" : "Checkout canceled";
  const message = isSuccess
    ? "Your Setpoint+ subscription is being activated. You can close this page and return to the app."
    : "No worries — you weren't charged. Tap below to head back to the app.";
  const emoji = isSuccess ? "✅" : "↩️";
  const deepLink = `${APP_SCHEME}://subscription/${isSuccess ? "success" : "cancel"}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Setpoint AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #191818;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      text-align: center;
      max-width: 400px;
    }
    .emoji { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 16px; color: #aaa; line-height: 1.5; margin-bottom: 32px; }
    .btn {
      display: inline-block;
      background: #6C63FF;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      padding: 14px 32px;
      border-radius: 12px;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="btn" href="${deepLink}">Open Setpoint AI</a>
  </div>
  <script>
    // Auto-redirect into the app after a short delay
    setTimeout(function() {
      window.location.href = "${deepLink}";
    }, 1500);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
