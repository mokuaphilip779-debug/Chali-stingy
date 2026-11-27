'use strict';

/**
 * Payment abstraction.
 *
 * Providers:
 *   manual  — user sends M-Pesa Send Money to the owner's number, then types
 *             the M-Pesa confirmation code on the site. You approve it in
 *             /admin. This is the default and needs no credentials.
 *   mpesa   — Safaricom Daraja STK Push (needs a paybill/till).
 *   stripe  — Stripe Checkout Session + webhook.
 *
 * Every provider ends in the same place: payments.markPaid(id), which extends
 * the user's plan by PLAN_DAYS.
 */

const crypto = require('crypto');
const axios = require('axios');
const config = require('./config');
const { payments, users } = require('./db');

/* ── M-Pesa Send Money (manual verification) ────────────────────────── */

/**
 * Create a pending payment for the Send Money flow.
 * The user is told to send KES to config.payment.sendMoney.display and then
 * submit the M-Pesa code, which lands in provider_ref for the admin to check.
 */
function sendMoneyPayment({ userId }) {
  const payment = payments.create({
    userId,
    provider: 'sendmoney',
    amount: config.plan.priceKes,
    currency: 'KES',
  });
  return { payment };
}

/**
 * Attach the M-Pesa code the user typed in. Does NOT activate the plan —
 * an admin still has to confirm the money arrived.
 */
function submitMpesaCode({ userId, code }) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 6) throw new Error('That does not look like an M-Pesa code.');

  if (payments.byProviderRef(clean)) {
    throw new Error('That M-Pesa code has already been submitted.');
  }

  const pending = payments.pendingForUser(userId);
  if (!pending.length) {
    throw new Error('Start a payment first, then submit the code.');
  }

  const payment = pending[0];
  require('./db').db
    .prepare('UPDATE payments SET provider_ref = ? WHERE id = ?')
    .run(clean, payment.id);

  return { payment: payments.byId(payment.id), code: clean };
}

/* ── M-Pesa Daraja STK Push ─────────────────────────────────────────── */

const MPESA_BASE = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

async function mpesaToken() {
  const { env, consumerKey, consumerSecret } = config.payment.mpesa;
  const base = MPESA_BASE[env] || MPESA_BASE.sandbox;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const { data } = await axios.get(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` }, timeout: 15000 }
  );
  return data.access_token;
}

function mpesaTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function mpesaStkPush({ userId, phone }) {
  const { env, shortcode, passkey, callbackUrl } = config.payment.mpesa;
  const base = MPESA_BASE[env] || MPESA_BASE.sandbox;

  const payment = payments.create({
    userId,
    provider: 'mpesa',
    amount: config.plan.priceKes,
    currency: 'KES',
  });

  const ts = mpesaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
  const token = await mpesaToken();

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: config.plan.priceKes,
    PartyA: String(phone).replace(/\D/g, ''),
    PartyB: shortcode,
    PhoneNumber: String(phone).replace(/\D/g, ''),
    CallBackURL: callbackUrl,
    AccountReference: payment.reference,
    TransactionDesc: `WA Bot ${config.plan.days}-day subscription`,
  };

  const { data } = await axios.post(
    `${base}/mpesa/stkpush/v1/processrequest`,
    body,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
  );

  if (data.ResponseCode === '0') {
    return { payment, checkoutRequestId: data.CheckoutRequestID, message: data.CustomerMessage };
  }
  payments.markFailed(payment.id);
  throw new Error(data.errorMessage || data.ResponseDescription || 'STK push failed');
}

/** Handle Safaricom's callback. Returns { ok, reference }. */
function handleMpesaCallback(payload) {
  const stk = payload?.Body?.stkCallback;
  if (!stk) return { ok: false, reason: 'malformed' };

  const reference = stk.CallbackMetadata?.Item?.find((i) => i.Name === 'AccountReference')?.Value;
  const receipt = stk.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

  const payment = reference ? payments.byReference(reference) : null;
  if (!payment) return { ok: false, reason: 'unknown_reference' };

  if (stk.ResultCode === 0) {
    payments.markPaid(payment.id, receipt || stk.CheckoutRequestID);
    return { ok: true, reference, userId: payment.user_id };
  }
  payments.markFailed(payment.id);
  return { ok: false, reason: stk.ResultDesc || 'cancelled' };
}

/* ── Stripe ─────────────────────────────────────────────────────────── */

async function stripeCheckout({ userId }) {
  const { secretKey, priceId } = config.payment.stripe;
  const payment = payments.create({
    userId,
    provider: 'stripe',
    amount: config.plan.priceUsd,
    currency: 'USD',
  });

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${config.baseUrl}/dashboard?paid=1`);
  params.append('cancel_url', `${config.baseUrl}/dashboard?cancelled=1`);
  params.append('client_reference_id', payment.reference);
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');

  const { data } = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 20000,
  });

  return { payment, url: data.url, sessionId: data.id };
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = config.payment.stripe.webhookSecret;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const parts = String(signatureHeader || '').split(',').reduce((acc, kv) => {
    const [k, v] = kv.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const given = parts.v1 || '';
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid Stripe signature');
  }
  return JSON.parse(rawBody);
}

function handleStripeEvent(event) {
  if (event.type === 'checkout.session.completed') {
    const ref = event.data?.object?.client_reference_id;
    const payment = ref ? payments.byReference(ref) : null;
    if (payment) {
      payments.markPaid(payment.id, event.data.object.id);
      return { ok: true, userId: payment.user_id };
    }
  }
  return { ok: false };
}

/* ── Manual (admin approval) ────────────────────────────────────────── */

function manualPayment({ userId }) {
  const payment = payments.create({
    userId,
    provider: 'manual',
    amount: config.plan.priceKes,
    currency: 'KES',
  });
  return { payment };
}

/* ── dispatcher ─────────────────────────────────────────────────────── */

async function startPayment({ userId, phone }) {
  switch (config.payment.provider) {
    case 'mpesa':
      return { type: 'mpesa', ...(await mpesaStkPush({ userId, phone })) };
    case 'stripe':
      return { type: 'stripe', ...(await stripeCheckout({ userId })) };
    case 'sendmoney':
      return { type: 'sendmoney', ...sendMoneyPayment({ userId }) };
    case 'manual':
    default:
      return { type: 'manual', ...manualPayment({ userId }) };
  }
}

module.exports = {
  startPayment,
  sendMoneyPayment,
  submitMpesaCode,
  handleMpesaCallback,
  handleStripeEvent,
  verifyStripeSignature,
  mpesaStkPush,
  stripeCheckout,
  manualPayment,
};
