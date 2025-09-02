import { query } from '../db/connection';

export interface CallSessionData {
  userId: string;
  sessionId: string;
  channel: 'VAPI' | 'MANUAL';
  status: 'SUCCESS' | 'PARTIAL' | 'REFUSED';
  initialAmount: number;
  finalAmount: number;
  debtBefore: number;
  debtAfter: number;
  negotiationData: any;
  integrations: any;
}

/**
 * Calculate debt after payment
 */
export function calculateDebtAfter(
  status: 'SUCCESS' | 'PARTIAL' | 'REFUSED',
  currentDebt: number,
  paymentAmount: number
): number {
  return status === 'REFUSED'
    ? currentDebt
    : Math.max(0, currentDebt - paymentAmount);
}

/**
 * Create initial integration tracking object
 */
export function createIntegrationTracking(sessionId: string) {
  return {
    invoice: {
      status: 'PENDING' as string,
      external_id: null as string | null,
      url: null as string | null,
      error: null as string | null,
      generated_at: null as string | null,
    },
    email: {
      status: 'PENDING' as string,
      external_id: null as string | null,
      sent_at: null as string | null,
      recipient: null as string | null,
      error: null as string | null,
    },
    crm: {
      status: 'SUCCESS' as string,
      external_id: sessionId,
      synced_at: new Date().toISOString(),
      error: null as string | null,
    },
  };
}

/**
 * Save call session to database
 */
export async function saveCallSession(
  data: CallSessionData,
  client?: any
): Promise<any> {
  const queryFn = client ? client.query.bind(client) : query;

  const result = await queryFn(
    `INSERT INTO call_sessions 
     (user_id, external_session_id, call_channel, outcome, initial_offer, final_amount, 
      debt_before, debt_after, negotiation_data, integrations, ended_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
     RETURNING *`,
    [
      data.userId,
      data.sessionId,
      data.channel,
      data.status,
      data.initialAmount,
      data.finalAmount,
      data.debtBefore,
      data.debtAfter,
      JSON.stringify(data.negotiationData),
      JSON.stringify(data.integrations),
    ]
  );

  return result.rows[0];
}
