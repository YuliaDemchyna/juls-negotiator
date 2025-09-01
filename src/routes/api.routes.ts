import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/connection';
import { NegotiationService } from '../services/negotiation.service';
import { EmailService } from '../services/email.service';
import { logger } from '../utils/logger';
import { authenticateM2M } from '../middleware/auth';

const router = Router();
const negotiationService = new NegotiationService();
const emailService = new EmailService();

// Validation schemas
const UserInfoSchema = z.object({
  phone_number: z.string().min(1),
});

const NegotiationSchema = z.object({
  user_amounts: z.array(z.number()),
  agent_amounts: z.array(z.number()),
  user_amount: z.number().positive(),
  user_debt: z.number().positive(),
});

const CallResultSchema = z.object({
  user_id: z.string(),
  status: z.enum(['SUCCESS', 'PARTIAL', 'REFUSED']),
  initial_amount: z.number().min(0),
  final_amount: z.number().min(0),
  debt: z.number().min(0),
});

/**
 * GET /api/userinfo
 * Get user information by phone number
 */
router.get(
  '/userinfo',
  authenticateM2M,
  async (req: Request, res: Response) => {
    try {
      const validation = UserInfoSchema.safeParse(req.query);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid request parameters',
          details: validation.error.errors,
        });
      }

      const { phone_number } = validation.data;

      logger.info('Fetching user info', { phone_number });

      // Query user from database
      const result = await query(
        'SELECT id, name, phone_number, email, remaining_debt FROM users WHERE phone_number = $1',
        [phone_number]
      );

      if (result.rows.length === 0) {
        logger.warn('User not found', { phone_number });
        return res.status(404).json({ error: 'User not found' });
      }

      const user = result.rows[0];

      res.json({
        user_id: user.id,
        name: user.name,
        phone_number: user.phone_number,
        email: user.email,
        debt: parseFloat(user.remaining_debt),
      });
    } catch (error) {
      logger.error('Error fetching user info', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/negotiation
 * Calculate negotiation response
 */
router.get('/negotiation', authenticateM2M, (req: Request, res: Response) => {
  try {
    const validation = NegotiationSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: validation.error.errors,
      });
    }

    const negotiationData = validation.data;

    logger.info('Processing negotiation', negotiationData);

    // Use negotiation service to calculate response
    const response = negotiationService.negotiate(negotiationData);

    res.json(response);
  } catch (error) {
    logger.error('Error processing negotiation', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/call_result
 * Save call results and trigger post-call workflows
 */
router.post(
  '/call_result',
  authenticateM2M,
  async (req: Request, res: Response) => {
    try {
      const validation = CallResultSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.errors,
        });
      }

      const { user_id, status, initial_amount, final_amount, debt } =
        validation.data;

      logger.info('Processing call result', { user_id, status, final_amount });

      // Start database transaction
      const result = await transaction(async client => {
        // Get user details
        const userResult = await client.query(
          'SELECT * FROM users WHERE id = $1',
          [user_id]
        );

        if (userResult.rows.length === 0) {
          throw new Error('User not found');
        }

        const user = userResult.rows[0];
        const sessionId = `SESSION-${Date.now()}`;

        // Calculate new debt
        const debtAfter =
          status === 'REFUSED' ? debt : Math.max(0, debt - final_amount);

        // Prepare integration tracking
        const integrations: any = {
          invoice: {
            status: 'PENDING',
            external_id: null,
            url: null,
            error: null,
          },
          email: {
            status: 'PENDING',
            external_id: null,
            sent_at: null,
            recipient: null,
            error: null,
          },
          crm: {
            status: 'SUCCESS',
            external_id: sessionId,
            synced_at: new Date().toISOString(),
            error: null,
          },
        };

        // Process integrations for successful/partial payments
        if (status === 'SUCCESS' || status === 'PARTIAL') {
          try {
            // Generate invoice
            const invoiceData = {
              userId: user_id,
              userName: user.name,
              userEmail: user.email,
              phoneNumber: user.phone_number,
              amount: final_amount,
              debtBefore: debt,
              debtAfter: debtAfter,
              invoiceDate: new Date(),
              dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            };

            // Send email with invoice attachment if user has email address
            if (user.email) {
              const emailResult =
                await emailService.sendInvoiceEmail(invoiceData);

              integrations.invoice = {
                status: 'SUCCESS',
                external_id: emailResult.invoiceId,
                url: null, // No longer needed since PDF is attached
                generated_at: new Date().toISOString(),
                error: null,
              };

              integrations.email = {
                status: 'SUCCESS',
                external_id: emailResult.emailId,
                sent_at: new Date().toISOString(),
                recipient: user.email,
                error: null,
              };
            }
          } catch (error: any) {
            logger.error('Error processing invoice/email', { error, user_id });
            // Update integration status with error
            if (error?.message?.includes('invoice')) {
              integrations.invoice.status = 'FAILED';
              integrations.invoice.error = error.message;
            }
            if (error?.message?.includes('email')) {
              integrations.email.status = 'FAILED';
              integrations.email.error = error.message;
            }
          }
        }

        // Save call session using new schema
        const callSessionQuery = await client.query(
          `INSERT INTO call_sessions 
         (user_id, external_session_id, call_channel, outcome, initial_offer, final_amount, 
          debt_before, debt_after, negotiation_data, integrations, ended_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         RETURNING *`,
          [
            user_id,
            sessionId,
            'MANUAL', // API calls are manual
            status,
            initial_amount,
            final_amount,
            debt,
            debtAfter,
            JSON.stringify({
              user_amounts: [initial_amount, final_amount],
              agent_amounts: [],
              rounds: [],
            }),
            JSON.stringify(integrations),
          ]
        );

        const callSession = callSessionQuery.rows[0];

        return {
          status,
          final_amount,
          debt_left: debtAfter,
          invoice_id: integrations.invoice.external_id,
          invoice_url: integrations.invoice.url,
          email_sent: integrations.email.status === 'SUCCESS',
          session_id: callSession.id,
        };
      });

      logger.info('Call result processed successfully', { user_id, result });

      res.json(result);
    } catch (error) {
      logger.error('Error processing call result', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Check database connection
    await query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'negotiator-backend',
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

export default router;
