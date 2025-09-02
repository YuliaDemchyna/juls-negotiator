import { query } from '../db/connection';
import { logger } from './logger';

export interface User {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  remaining_debt: string;
}

/**
 * Get user by phone number
 */
export async function getUserByPhone(phoneNumber: string): Promise<User | null> {
  logger.info('Fetching user by phone', { phone_number: phoneNumber });
  
  const result = await query(
    'SELECT id, name, phone_number, email, remaining_debt FROM users WHERE phone_number = $1',
    [phoneNumber]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}