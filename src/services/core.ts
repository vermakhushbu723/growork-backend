import type { Types } from 'mongoose';
import { Notification, NOTIFICATION_TYPES } from '../models/Misc.js';
import { Transaction, Wallet, TX_KINDS } from '../models/Wallet.js';
import { ApiError } from '../utils/http.js';

type Id = string | Types.ObjectId;

export async function notify(
  user: Id,
  type: (typeof NOTIFICATION_TYPES)[number],
  title: string,
  message: string,
  ref: Id = '',
) {
  await Notification.create({ user, type, title, message, ref: String(ref) });
}

/** Returns the user's wallet, creating an empty one on first use. */
export async function walletOf(user: Id) {
  return (
    (await Wallet.findOne({ user })) ??
    (await Wallet.create({ user, balance: 0, escrow: 0, plan: 'Starter', jobCredits: 2 }))
  );
}

export async function record(user: Id, title: string, amount: number, isCredit: boolean, kind: (typeof TX_KINDS)[number]) {
  await Transaction.create({ user, title, amount: Math.round(amount), isCredit, kind });
}

/** Adds money to the balance. */
export async function credit(user: Id, amount: number, title: string, kind: (typeof TX_KINDS)[number]) {
  const w = await walletOf(user);
  w.balance += Math.round(amount);
  await w.save();
  await record(user, title, amount, true, kind);
  return w;
}

/** Takes money from the balance; 402 if there isn't enough. */
export async function debit(user: Id, amount: number, title: string, kind: (typeof TX_KINDS)[number]) {
  const w = await walletOf(user);
  const value = Math.round(amount);
  if (value > w.balance) throw new ApiError(402, 'Not enough wallet balance.');
  w.balance -= value;
  await w.save();
  await record(user, title, value, false, kind);
  return w;
}

/** Moves money from the client's balance into escrow. */
export async function fundEscrow(user: Id, amount: number, title: string) {
  const w = await walletOf(user);
  const value = Math.round(amount);
  if (value > w.balance) throw new ApiError(402, 'Not enough wallet balance to fund this milestone.');
  w.balance -= value;
  w.escrow += value;
  await w.save();
  await record(user, `Escrow funded - ${title}`, value, false, 'escrowFund');
}

export async function releaseEscrow(user: Id, amount: number, title: string) {
  const w = await walletOf(user);
  w.escrow = Math.max(0, w.escrow - Math.round(amount));
  await w.save();
  await record(user, `Payment released - ${title}`, amount, false, 'escrowRelease');
}

export async function refundEscrow(user: Id, amount: number, title: string) {
  if (amount <= 0) return;
  const w = await walletOf(user);
  const value = Math.min(Math.round(amount), w.escrow);
  w.escrow -= value;
  w.balance += value;
  await w.save();
  await record(user, `Escrow refunded - ${title}`, value, true, 'escrowRefund');
}

/** Percentage of `required` skills found in `have` (case-insensitive). */
export function skillMatch(have: string[], required: string[]) {
  if (!required.length) return 70;
  const set = new Set(have.map((s) => s.toLowerCase()));
  const hits = required.filter((s) => set.has(s.toLowerCase())).length;
  return Math.round(50 + (hits / required.length) * 50);
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" regex, or undefined for an empty query. */
export const searchRegex = (q: unknown) =>
  typeof q === 'string' && q.trim() ? new RegExp(escapeRegex(q.trim()), 'i') : undefined;
