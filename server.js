'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const { users, payments, deleted, verifyPassword } = require('./db');
const wa = require('./manager');
const pay = require('./payments');

const app = express();

/* ── body parsing ───────────────────────────────────────────────────── */
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── tiny signed-cookie session ─────────────────────────────────────── */
const COOKIE = 'wabot_sid';

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

function setSession(res, userId) {
  const payload = `${userId}.${Date.now()}`;
  const token = `${payload}.${sign(payload)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function readSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = sign(`${userId}.${ts}`);
  if (sig !== expected) return null;
  return userId;
}

app.use((req, res, next) => {
  const userId = readSession(req);
  if (userId) {
    const u = users.refreshPlan(userId);
    if (u) req.user = u;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireActive(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!users.isActive(req.user.id)) return res.redirect('/subscribe');
  next();
}

function requireAdmin(req, res, next) {
  if (!config.adminToken) return res.status(404).send('Admin disabled');
  const given = req.query.token || req.headers['x-admin-token'];
  if (given !== config.adminToken) return res.status(401).send('Unauthorized');
  next();
}

/* ── helpers ────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function layout({ title, body, user = null, active = '' }) {
  const nav = user
    ? `<nav>
         <a href="/dashboard" class="${active === 'dash' ? 'on' : ''}">Dashboard</a>
         <a href="/subscribe" class="${active === 'sub' ? 'on' : ''}">Subscription</a>
         <a href="/settings" class="${active === 'set' ? 'on' : ''}">Settings</a>
         <a href="/deleted" class="${active === 'del' ? 'on' : ''}">Deleted</a>
         <form method="post" action="/logout" class="inline"><button class="link">Log out</button></form>
       </nav>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · WA Bot Suite</title>
<style>
  :root{
    --bg:#0b0f14; --panel:#121821; --panel2:#182130; --line:#243040;
    --text:#e6edf6; --muted:#8b9bb0; --accent:#25d366; --accent2:#128c7e;
    --danger:#ef4444; --warn:#f59e0b; --ok:#22c55e;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  header{background:var(--panel);border-bottom:1px solid var(--line);padding:14px 20px;
    display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .brand{font-weight:700;font-size:17px;letter-spacing:-.2px}
  .brand span{color:var(--accent)}
  nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-left:auto}
  nav a{color:var(--muted);font-size:14px}
  nav a.on{color:var(--text);font-weight:600}
  .inline{display:inline;margin:0}
  button.link{background:none;border:0;color:var(--muted);cursor:pointer;font:inherit;padding:0}
  button.link:hover{color:var(--text)}
  main{max-width:920px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:24px;margin:0 0 6px;letter-spacing:-.3px}
  h2{font-size:17px;margin:28px 0 12px}
  .sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
  .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
  input[type=text],input[type=email],input[type=password],input[type=tel],textarea,select{
    width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:8px;padding:10px 12px;font:inherit;outline:none}
  input:focus,textarea:focus,select:focus{border-color:var(--accent2)}
  textarea{min-height:80px;resize:vertical}
  button.btn{background:var(--accent);color:#04140a;border:0;border-radius:8px;
    padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
  button.btn:hover{background:#1fbe5b}
  button.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
  button.btn.ghost:hover{background:var(--panel2)}
  button.btn.danger{background:var(--danger);color:#fff}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .badge.ok{background:rgba(34,197,94,.15);color:var(--ok)}
  .badge.warn{background:rgba(245,158,11,.15);color:var(--warn)}
  .badge.bad{background:rgba(239,68,68,.15);color:var(--danger)}
  .badge.mut{background:var(--panel2);color:var(--muted)}
  .msg{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
  .msg.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fca5a5}
  .msg.ok{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);color:#86efac}
  .msg.info{background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.25);color:#a7f3d0}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  code{background:var(--panel2);padding:2px 6px;border-radius:5px;font-size:13px}
  .qr{background:#fff;padding:12px;border-radius:10px;display:inline-block}
  .qr img{display:block;width:260px;height:260px}
  .muted{color:var(--muted)}
  .small{font-size:13px}
  .warnbox{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);
    border-radius:10px;padding:14px 16px;font-size:13.5px;color:#fcd34d;margin-bottom:20px}
  .switch{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:12px 0;border-bottom:1px solid var(--line)}
  .switch:last-child{border-bottom:0}
  .switch .t{font-weight:500}
  .switch .d{color:var(--muted);font-size:13px}
  input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);cursor:pointer}
  .center{text-align:center}
  .auth{max-width:400px;margin:60px auto}
  .auth .card{padding:26px}
  .auth h1{text-align:center;margin-bottom:22px}
  .field{margin-bottom:14px}
  .foot{color:var(--muted);font-size:12.5px;text-align:center;margin-top:26px}
  .paybox{background:var(--panel2);border:1px dashed var(--accent2);border-radius:10px;
    padding:18px;margin:16px 0;text-align:center}
  .paybox .num{font-size:26px;font-weight:700;letter-spacing:1px;color:var(--accent);margin:6px 0}
  .paybox .amt{font-size:20px;font-weight:700;margin:4px 0}
  .steps{counter-reset:s;list-style:none;padding:0;margin:0}
  .steps li{counter-increment:s;position:relative;padding:10px 0 10px 38px;
    border-bottom:1px solid var(--line);font-size:14px}
  .steps li:last-child{border-bottom:0}
  .steps li:before{content:counter(s);position:absolute;left:0;top:10px;width:24px;height:24px;
    border-radius:50%;background:var(--accent2);color:#fff;font-size:12px;font-weight:700;
    display:flex;align-items:center;justify-content:center}
</style>
</head>
<body>
<header>
  <div class="brand">WA <span>Bot</span> Suite</div>
  ${nav}
</header>
<main>${body}</main>
</body>
</html>`;
}

/* ── landing ────────────────────────────────────────────────────────── */
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(layout({
    title: 'WhatsApp automation, on autopilot',
    body: `
      <div class="center" style="padding:40px 0 20px">
        <h1 style="font-size:32px">WhatsApp automation, on autopilot</h1>
        <p class="sub" style="max-width:520px;margin:12px auto 28px">
          Auto-view statuses, auto-react, 112 commands, group moderation and more —
          running on your own number, from one dashboard.
        </p>
        <div class="row" style="justify-content:center">
          <a href="/register"><button class="btn">Get started</button></a>
          <a href="/login"><button class="btn ghost">Log in</button></a>
        </div>
      </div>
      <div class="grid" style="margin-top:40px">
        <div class="card"><h2 style="margin-top:0">👁️ Auto view status</h2>
          <p class="muted small">Every contact status gets viewed the moment it lands.</p></div>
        <div class="card"><h2 style="margin-top:0">❤️ Auto react</h2>
          <p class="muted small">React to statuses and messages automatically, with your emoji.</p></div>
        <div class="card"><h2 style="margin-top:0">🛡️ Group moderation</h2>
          <p class="muted small">Antilink, antispam, antibadword, antitag and more — per group.</p></div>
        <div class="card"><h2 style="margin-top:0">🗑️ Anti-delete</h2>
          <p class="muted small">Deleted messages are captured and sent back to you.</p></div>
      </div>
      <div class="warnbox" style="margin-top:28px">
        ⚠️ This bot drives WhatsApp Web automation, which is not an official WhatsApp API.
        WhatsApp can ban numbers that use it. Use a number you can afford to lose.
      </div>
      <p class="foot">Subscription: KES ${config.plan.priceKes} / ${config.plan.days} days</p>
    `,
  }));
});

/* ── auth ───────────────────────────────────────────────────────────── */
app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(layout({
    title: 'Create account',
    body: `
      <div class="auth">
        <div class="card">
          <h1>Create account</h1>
          ${req.query.err ? `<div class="msg err">${esc(req.query.err)}</div>` : ''}
          <form method="post" action="/register">
            <div class="field"><label>Email</label>
              <input type="email" name="email" required autofocus></div>
            <div class="field"><label>Password (min 8 chars)</label>
              <input type="password" name="password" minlength="8" required></div>
            <button class="btn" style="width:100%">Create account</button>
          </form>
          <p class="foot">Already have one? <a href="/login">Log in</a></p>
        </div>
      </div>
    `,
  }));
});

app.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || String(password).length < 8) {
    return res.redirect('/register?err=' + encodeURIComponent('Email and a password of 8+ characters are required.'));
  }
  if (users.byEmail(email)) {
    return res.redirect('/register?err=' + encodeURIComponent('That email is already registered.'));
  }
  const u = users.create({ email, password });
  setSession(res, u.id);
  res.redirect('/subscribe');
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(layout({
    title: 'Log in',
    body: `
      <div class="auth">
        <div class="card">
          <h1>Log in</h1>
          ${req.query.err ? `<div class="msg err">${esc(req.query.err)}</div>` : ''}
          <form method="post" action="/login">
            <div class="field"><label>Email</label>
              <input type="email" name="email" required autofocus></div>
            <div class="field"><label>Password</label>
              <input type="password" name="password" required></div>
            <button class="btn" style="width:100%">Log in</button>
          </form>
          <p class="foot">No account? <a href="/register">Create one</a></p>
        </div>
      </div>
    `,
  }));
});

app.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = users.byEmail(email || '');
  if (!u || !verifyPassword(password || '', u.password_hash)) {
    return res.redirect('/login?err=' + encodeURIComponent('Wrong email or password.'));
  }
  setSession(res, u.id);
  res.redirect(users.isActive(u.id) ? '/dashboard' : '/subscribe');
});

app.post('/logout', (req, res) => {
  clearSession(res);
  res.redirect('/');
});

/* ── subscription ───────────────────────────────────────────────────── */
app.get('/subscribe', requireAuth, (req, res) => {
  const u = users.refreshPlan(req.user.id);
  const active = users.isActive(u.id);
  const pending = payments.pendingForUser(u.id);
  const expires = u.plan_expires ? new Date(u.plan_expires).toLocaleString() : '—';
  const sm = config.payment.sendMoney;

  res.send(layout({
    title: 'Subscription',
    user: u,
    active: 'sub',
    body: `
      <h1>Subscription</h1>
      <p class="sub">A monthly subscription is required before you can connect a WhatsApp number.</p>

      ${req.query.paid ? `<div class="msg ok">Payment received — your plan is active.</div>` : ''}
      ${req.query.cancelled ? `<div class="msg err">Payment cancelled.</div>` : ''}
      ${req.query.err ? `<div class="msg err">${esc(req.query.err)}</div>` : ''}
      ${req.query.msg ? `<div class="msg info">${esc(req.query.msg)}</div>` : ''}

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <h2 style="margin:0 0 4px">${config.plan.days}-day plan</h2>
            <p class="muted small" style="margin:0">KES ${config.plan.priceKes} · renews manually</p>
          </div>
          <span class="badge ${active ? 'ok' : 'bad'}">${active ? 'Active' : (u.plan_status === 'expired' ? 'Expired' : 'Inactive')}</span>
        </div>
        <p class="small muted" style="margin:14px 0 0">Expires: ${esc(expires)}</p>
      </div>

      ${active ? `
        <div class="msg ok">Your plan is active. <a href="/dashboard">Go to dashboard →</a></div>
      ` : `
        <div class="card">
          <h2 style="margin-top:0">Pay KES ${config.plan.priceKes}</h2>

          <div class="paybox">
            <div class="small muted">Send <strong>KES ${config.plan.priceKes}</strong> via M-Pesa Send Money to</div>
            <div class="num">${esc(sm.display)}</div>
            <div class="small muted">Name: <strong>${esc(sm.name)}</strong></div>
          </div>

          <ol class="steps">
            <li>Open M-Pesa on your phone → <strong>Send Money</strong></li>
            <li>Enter <strong>${esc(sm.display)}</strong> (${esc(sm.name)})</li>
            <li>Enter amount <strong>KES ${config.plan.priceKes}</strong> and confirm with your PIN</li>
            <li>Copy the M-Pesa confirmation code from the SMS</li>
            <li>Paste it below and submit — your plan activates once it's confirmed</li>
          </ol>

          <form method="post" action="/subscribe/sendmoney" style="margin-top:18px">
            <div class="field">
              <label>M-Pesa confirmation code</label>
              <input type="text" name="code" placeholder="e.g. SLK7XQ2M9P" required
                     style="text-transform:uppercase" autocomplete="off">
            </div>
            <button class="btn">Submit code</button>
          </form>

          <p class="small muted" style="margin-top:14px">
            Codes are checked by hand, usually within a few hours.
            Questions? Email <a href="mailto:${esc(config.owner.email)}">${esc(config.owner.email)}</a>.
          </p>
        </div>
      `}

      ${pending.length ? `
        <div class="card">
          <h2 style="margin-top:0">Pending payments</h2>
          <table>
            <tr><th>Reference</th><th>Amount</th><th>M-Pesa code</th><th>Created</th></tr>
            ${pending.map((p) => `<tr>
              <td><code>${esc(p.reference)}</code></td>
              <td>${esc(p.currency)} ${esc(p.amount)}</td>
              <td>${p.provider_ref ? `<code>${esc(p.provider_ref)}</code>` : '<span class="muted small">not submitted</span>'}</td>
              <td class="muted small">${new Date(p.created_at).toLocaleString()}</td>
            </tr>`).join('')}
          </table>
        </div>
      ` : ''}
    `,
  }));
});

app.post('/subscribe/sendmoney', requireAuth, (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) throw new Error('Enter the M-Pesa confirmation code.');

    // Create a pending payment if there isn't one yet, then attach the code.
    if (!payments.pendingForUser(req.user.id).length) {
      pay.sendMoneyPayment({ userId: req.user.id });
    }
    const { code: clean } = pay.submitMpesaCode({ userId: req.user.id, code });

    res.redirect('/subscribe?msg=' + encodeURIComponent(
      `Code ${clean} received. Your plan activates once the payment is confirmed.`
    ));
  } catch (err) {
    res.redirect('/subscribe?err=' + encodeURIComponent(err.message));
  }
});

app.post('/subscribe/manual', requireAuth, (req, res) => {
  pay.manualPayment({ userId: req.user.id });
  res.redirect('/subscribe?msg=' + encodeURIComponent('Payment requested. An admin will approve it shortly.'));
});

app.post('/subscribe/mpesa', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) throw new Error('Phone number required');
    const result = await pay.mpesaStkPush({ userId: req.user.id, phone });
    res.redirect('/subscribe?msg=' + encodeURIComponent(result.message || 'STK push sent — check your phone.'));
  } catch (err) {
    res.redirect('/subscribe?err=' + encodeURIComponent(err.message));
  }
});

app.post('/subscribe/stripe', requireAuth, async (req, res) => {
  try {
    const { url } = await pay.stripeCheckout({ userId: req.user.id });
    res.redirect(url);
  } catch (err) {
    res.redirect('/subscribe?err=' + encodeURIComponent(err.message));
  }
});

/* ── dashboard ──────────────────────────────────────────────────────── */
app.get('/dashboard', requireAuth, (req, res) => {
  const u = users.refreshPlan(req.user.id);
  const active = users.isActive(u.id);
  const session = wa.getSession(u.id);
  const status = session?.status || u.wa_status || 'disconnected';
  const number = u.wa_number;

  const statusBadge = {
    connected: '<span class="badge ok">Connected</span>',
    pairing: '<span class="badge warn">Waiting for scan</span>',
    reconnecting: '<span class="badge warn">Reconnecting</span>',
    disconnected: '<span class="badge mut">Disconnected</span>',
  }[status] || '<span class="badge mut">Disconnected</span>';

  res.send(layout({
    title: 'Dashboard',
    user: u,
    active: 'dash',
    body: `
      <h1>Dashboard</h1>
      <p class="sub">Your WhatsApp connection and bot status.</p>

      ${!active ? `<div class="msg err">Your subscription is not active.
        <a href="/subscribe">Subscribe to connect a number →</a></div>` : ''}

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <h2 style="margin:0 0 4px">WhatsApp connection</h2>
            <p class="muted small" style="margin:0">
              ${number ? `Linked number: <code>+${esc(number)}</code>` : 'No number linked yet'}
            </p>
          </div>
          ${statusBadge}
        </div>

        <div id="linkArea" style="margin-top:18px">
          ${status === 'connected' ? `
            <div class="row">
              <form method="post" action="/wa/logout" class="inline">
                <button class="btn danger">Unlink number</button>
              </form>
            </div>
          ` : active ? `
            <div class="row">
              <form method="post" action="/wa/start" class="inline">
                <button class="btn">Generate QR code</button>
              </form>
              <form method="post" action="/wa/pair" class="inline row" style="gap:8px">
                <input type="tel" name="phone" placeholder="2547XXXXXXXX" style="width:180px">
                <button class="btn ghost">Get pairing code</button>
              </form>
            </div>
            <div id="qrBox" style="margin-top:18px"></div>
          ` : `<p class="muted small">Subscribe first to link a number.</p>`}
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Quick links</h2>
        <div class="row">
          <a href="/settings"><button class="btn ghost">Bot settings</button></a>
          <a href="/deleted"><button class="btn ghost">Deleted messages</button></a>
        </div>
      </div>

      <script>
        (function(){
          const qrBox = document.getElementById('qrBox');
          if (!qrBox) return;
          let lastQr = null;
          async function poll(){
            try{
              const r = await fetch('/wa/state', {headers:{'Accept':'application/json'}});
              const d = await r.json();
              if (d.qr && d.qr !== lastQr){
                lastQr = d.qr;
                qrBox.innerHTML = '<div class="qr"><img src="'+d.qr+'" alt="QR"></div>'+
                  '<p class="small muted" style="margin-top:10px">WhatsApp → Linked devices → Link a device</p>';
              }
              if (d.pairingCode){
                qrBox.innerHTML = '<div class="card" style="background:var(--panel2)">'+
                  '<p class="small muted" style="margin:0 0 6px">Enter this on your phone:</p>'+
                  '<div style="font-size:26px;font-weight:700;letter-spacing:3px">'+d.pairingCode+'</div></div>';
              }
              if (d.status === 'connected'){ location.reload(); return; }
            }catch(e){}
            setTimeout(poll, 2500);
          }
          poll();
        })();
      </script>
    `,
  }));
});

/* ── WhatsApp link actions ──────────────────────────────────────────── */
app.post('/wa/start', requireActive, async (req, res) => {
  try {
    await wa.startSession(req.user.id);
  } catch (err) { /* surfaced via /wa/state */ }
  res.redirect('/dashboard');
});

app.post('/wa/pair', requireActive, async (req, res) => {
  try {
    const phone = (req.body?.phone || '').replace(/\D/g, '');
    if (!phone) throw new Error('Phone required');
    await wa.startSession(req.user.id, { phoneNumber: phone });
  } catch (err) { /* surfaced via /wa/state */ }
  res.redirect('/dashboard');
});

app.post('/wa/logout', requireAuth, async (req, res) => {
  await wa.logoutSession(req.user.id);
  res.redirect('/dashboard');
});

app.get('/wa/state', requireAuth, (req, res) => {
  const s = wa.getSession(req.user.id);
  res.json({
    status: s?.status || req.user.wa_status || 'disconnected',
    qr: s?.qrDataUrl || null,
    pairingCode: s?.pairingCode || null,
  });
});

/* ── settings ───────────────────────────────────────────────────────── */
app.get('/settings', requireAuth, (req, res) => {
  const s = wa.getSettings(req.user.id);
  const sw = (key, title, desc) => `
    <div class="switch">
      <div><div class="t">${title}</div><div class="d">${desc}</div></div>
      <input type="checkbox" name="${key}" ${s[key] ? 'checked' : ''}>
    </div>`;

  res.send(layout({
    title: 'Bot settings',
    user: req.user,
    active: 'set',
    body: `
      <h1>Bot settings</h1>
      <p class="sub">Changes apply immediately to your running session.</p>
      ${req.query.saved ? `<div class="msg ok">Settings saved.</div>` : ''}

      <form method="post" action="/settings">
        <div class="card">
          <h2 style="margin-top:0">Status</h2>
          ${sw('autoViewStatus', 'Auto view status', 'View every contact status automatically.')}
          ${sw('autoReactStatus', 'Auto react to status', 'React to statuses with the emoji below.')}
          <div class="field" style="margin-top:14px">
            <label>Status reaction emoji</label>
            <input type="text" name="statusReaction" value="${esc(s.statusReaction)}" maxlength="8">
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Messages</h2>
          ${sw('autoRead', 'Auto read (blue ticks)', 'Mark incoming messages as read.')}
          ${sw('autoReactMessage', 'Auto react to messages', 'React to incoming messages with the emoji below.')}
          <div class="field" style="margin-top:14px">
            <label>Message reaction emoji</label>
            <input type="text" name="messageReaction" value="${esc(s.messageReaction || '👍')}" maxlength="8">
          </div>
          ${sw('antiDelete', 'Anti-delete', 'Capture deleted messages and send them back to you.')}
        </div>

        <div class="card">
          <h2 style="margin-top:0">Auto reply</h2>
          ${sw('autoReply', 'Enable auto reply', 'Reply automatically to incoming messages.')}
          ${sw('autoReplyGroups', 'Also reply in groups', 'Off = direct chats only.')}
          <div class="field" style="margin-top:14px">
            <label>Auto reply text</label>
            <textarea name="autoReplyText">${esc(s.autoReplyText)}</textarea>
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Presence</h2>
          ${sw('alwaysOnline', 'Always online', 'Keep your presence set to available.')}
        </div>

        <button class="btn">Save settings</button>
      </form>
    `,
  }));
});

app.post('/settings', requireAuth, (req, res) => {
  const current = wa.getSettings(req.user.id);
  const next = { ...current };
  const b = req.body || {};

  for (const key of ['autoViewStatus', 'autoReactStatus', 'autoRead', 'autoReactMessage',
                     'antiDelete', 'autoReply', 'autoReplyGroups', 'alwaysOnline']) {
    next[key] = b[key] === 'on' || b[key] === 'true' || b[key] === '1';
  }
  if (typeof b.statusReaction === 'string' && b.statusReaction.trim()) next.statusReaction = b.statusReaction.trim();
  if (typeof b.messageReaction === 'string' && b.messageReaction.trim()) next.messageReaction = b.messageReaction.trim();
  if (typeof b.autoReplyText === 'string') next.autoReplyText = b.autoReplyText;

  users.setSettings(req.user.id, next);
  res.redirect('/settings?saved=1');
});

/* ── deleted messages ───────────────────────────────────────────────── */
app.get('/deleted', requireAuth, (req, res) => {
  const rows = deleted.forUser(req.user.id, 100);
  res.send(layout({
    title: 'Deleted messages',
    user: req.user,
    active: 'del',
    body: `
      <h1>Deleted messages</h1>
      <p class="sub">Messages captured before they were deleted. Requires anti-delete to be on.</p>
      ${rows.length === 0 ? `<div class="card"><p class="muted" style="margin:0">Nothing captured yet.</p></div>` : `
        <div class="card">
          <table>
            <tr><th>When</th><th>From</th><th>Message</th></tr>
            ${rows.map((r) => `<tr>
              <td class="muted small">${new Date(r.deleted_at).toLocaleString()}</td>
              <td class="small"><code>${esc((r.sender_jid || '').split('@')[0])}</code></td>
              <td class="small">${esc(r.body)}</td>
            </tr>`).join('')}
          </table>
        </div>
      `}
    `,
  }));
});

/* ── payment webhooks ───────────────────────────────────────────────── */
app.post('/webhook/mpesa', (req, res) => {
  try {
    pay.handleMpesaCallback(req.body);
  } catch { /* always ack so Safaricom stops retrying */ }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.post('/webhook/stripe', (req, res) => {
  try {
    const raw = req.body.toString('utf8');
    const event = pay.verifyStripeSignature(raw, req.headers['stripe-signature']);
    pay.handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook error: ${err.message}`);
  }
});

/* ── admin ──────────────────────────────────────────────────────────── */
app.get('/admin', requireAdmin, (req, res) => {
  const allUsers = users.all();
  const allPayments = payments.all();
  const pending = allPayments.filter((p) => p.status === 'pending');

  res.send(layout({
    title: 'Admin',
    body: `
      <h1>Admin</h1>
      <p class="sub">Confirm M-Pesa payments and inspect users.</p>

      <div class="card">
        <h2 style="margin-top:0">Pending payments (${pending.length})</h2>
        ${pending.length === 0
          ? '<p class="muted small" style="margin:0">None pending.</p>'
          : `<table>
              <tr><th>Reference</th><th>User</th><th>Amount</th><th>M-Pesa code</th><th></th></tr>
              ${pending.map((p) => {
                const u = users.byId(p.user_id);
                return `<tr>
                  <td><code>${esc(p.reference)}</code></td>
                  <td class="small">${esc(u?.email || p.user_id)}</td>
                  <td>${esc(p.currency)} ${esc(p.amount)}</td>
                  <td>${p.provider_ref ? `<code>${esc(p.provider_ref)}</code>` : '<span class="muted small">—</span>'}</td>
                  <td><form method="post" action="/admin/approve?token=${encodeURIComponent(config.adminToken)}" class="inline">
                    <input type="hidden" name="paymentId" value="${esc(p.id)}">
                    <button class="btn" style="padding:6px 12px;font-size:13px">Approve</button>
                  </form></td>
                </tr>`;
              }).join('')}
            </table>`}
      </div>

      <div class="card">
        <h2 style="margin-top:0">Users (${allUsers.length})</h2>
        <table>
          <tr><th>Email</th><th>Plan</th><th>Expires</th><th>WhatsApp</th></tr>
          ${allUsers.map((u) => `<tr>
            <td class="small">${esc(u.email)}</td>
            <td><span class="badge ${u.plan_status === 'active' ? 'ok' : 'mut'}">${esc(u.plan_status)}</span></td>
            <td class="muted small">${u.plan_expires ? new Date(u.plan_expires).toLocaleDateString() : '—'}</td>
            <td class="muted small">${esc(u.wa_status)}${u.wa_number ? ` · +${esc(u.wa_number)}` : ''}</td>
          </tr>`).join('')}
        </table>
      </div>
    `,
  }));
});

app.post('/admin/approve', requireAdmin, (req, res) => {
  const { paymentId } = req.body || {};
  if (paymentId) payments.markPaid(paymentId, 'manual-approval');
  res.redirect(`/admin?token=${encodeURIComponent(config.adminToken)}`);
});

/* ── health ─────────────────────────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), provider: config.payment.provider });
});

module.exports = app;
