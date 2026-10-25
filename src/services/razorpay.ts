import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';

/** Razorpay over its REST API (no SDK needed for orders and signatures). */

export const razorpayReady = () => !!(env.razorpayKeyId && env.razorpayKeySecret);

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/** Creates an order for `amountRupees`; Razorpay works in paise. */
export async function createOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes }),
  });
  const json = (await res.json().catch(() => ({}))) as RazorpayOrder & { error?: { description?: string } };
  if (!res.ok) {
    console.error('Razorpay order failed:', res.status, json.error?.description);
    throw new ApiError(502, res.status === 401 ? 'Payment gateway keys are invalid.' : 'Couldn’t start the payment. Please try again.');
  }
  return json;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function checkoutSignatureValid(orderId: string, paymentId: string, signature: string) {
  const expected = createHmac('sha256', env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Webhook: signature = HMAC_SHA256(raw body, webhook secret). */
export function webhookSignatureValid(rawBody: Buffer, signature: string) {
  if (!env.razorpayWebhookSecret) return false;
  const expected = createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
