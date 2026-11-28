import type { Pool } from 'pg';
import { AccessError, transaction } from '../identity/core.js';
import { lockVenues, notifyAgenda } from './domain.js';

/** Called only after a future financial adapter has verified the payment with its provider. */
export type ValidatedPaymentEvidence = {
  organizationId: string;
  reservationId: string;
  customerId: string;
  externalPaymentRef: string;
  approvedAmountCents: number;
  approvedAt: Date;
  status: 'APPROVED';
};

export async function confirmFromValidatedPayment(pool: Pool, proof: ValidatedPaymentEvidence) {
  if (
    proof.status !== 'APPROVED' ||
    !Number.isSafeInteger(proof.approvedAmountCents) ||
    proof.approvedAmountCents < 0 ||
    !proof.externalPaymentRef ||
    proof.externalPaymentRef.length > 200 ||
    !Number.isFinite(proof.approvedAt.getTime())
  )
    throw new AccessError(400, 'VALIDATION_FAILED');
  return transaction(pool, async (db) => {
    if (
      !(
        await db.query('SELECT 1 FROM organizations WHERE id=$1 AND active FOR SHARE', [
          proof.organizationId,
        ])
      ).rowCount
    )
      throw new AccessError(404, 'NOT_FOUND');
    const initial = (
      await db.query<{ venue_id: string }>(
        'SELECT venue_id FROM reservations WHERE organization_id=$1 AND id=$2 AND customer_id=$3',
        [proof.organizationId, proof.reservationId, proof.customerId],
      )
    ).rows[0];
    if (!initial) throw new AccessError(404, 'NOT_FOUND');
    await lockVenues(db, proof.organizationId, [initial.venue_id]);
    const row = (
      await db.query<{ status: string; version: number; price_cents: string }>(
        'SELECT status,version,price_cents::text FROM reservations WHERE organization_id=$1 AND id=$2 AND customer_id=$3 FOR UPDATE',
        [proof.organizationId, proof.reservationId, proof.customerId],
      )
    ).rows[0];
    if (!row) throw new AccessError(404, 'NOT_FOUND');
    const existing = (
      await db.query<{
        reservation_id: string;
        customer_id: string;
        approved_amount_cents: string;
      }>(
        'SELECT reservation_id,customer_id,approved_amount_cents::text FROM reservation_payment_confirmations WHERE organization_id=$1 AND external_payment_ref=$2',
        [proof.organizationId, proof.externalPaymentRef],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.reservation_id !== proof.reservationId ||
        existing.customer_id !== proof.customerId ||
        Number(existing.approved_amount_cents) !== proof.approvedAmountCents
      )
        throw new AccessError(409, 'IDEMPOTENCY_KEY_REUSED');
      return { id: proof.reservationId, status: row.status, version: row.version, replay: true };
    }
    if (!['PENDING', 'CONFIRMED'].includes(row.status))
      throw new AccessError(409, 'INVALID_TRANSITION');
    if (proof.approvedAmountCents < Number(row.price_cents))
      throw new AccessError(409, 'INVALID_TRANSITION');
    await db.query(
      'INSERT INTO reservation_payment_confirmations(organization_id,reservation_id,customer_id,external_payment_ref,approved_amount_cents,approved_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        proof.organizationId,
        proof.reservationId,
        proof.customerId,
        proof.externalPaymentRef,
        proof.approvedAmountCents,
        proof.approvedAt,
      ],
    );
    if (row.status === 'PENDING') {
      await db.query(
        "UPDATE reservations SET status='CONFIRMED',confirmed_at=now(),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",
        [proof.organizationId, proof.reservationId],
      );
      await db.query(
        "INSERT INTO reservation_history(organization_id,reservation_id,action,from_status,to_status,changes) VALUES($1,$2,'payment_confirmed','PENDING','CONFIRMED',$3)",
        [
          proof.organizationId,
          proof.reservationId,
          JSON.stringify({ approvedAmountCents: proof.approvedAmountCents }),
        ],
      );
      await notifyAgenda(db, proof.organizationId, 'reservation.changed');
    }
    return {
      id: proof.reservationId,
      status: 'CONFIRMED',
      version: row.version + (row.status === 'PENDING' ? 1 : 0),
      replay: false,
    };
  });
}
