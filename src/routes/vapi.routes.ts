import { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { NegotiationService } from '../services/negotiation.service';
import { logger } from '../utils/logger';
import { authenticateVAPIWebhook } from '../middleware/auth';

const router = Router();
const negotiationService = new NegotiationService();

// Apply VAPI webhook authentication to all routes
router.use(authenticateVAPIWebhook);

/**
 * POST /api/vapi/get-user-info
 * VAPI function to get user information
 */
router.post('/get-user-info', async (req: Request, res: Response) => {
  try {
    const { phone_number } = req.body.message.functionCall.parameters;

    logger.info('VAPI: Getting user info', { phone_number });

    // Query user from database
    const result = await query(
      'SELECT id, name, phone_number, email, remaining_debt FROM users WHERE phone_number = $1',
      [phone_number]
    );

    if (result.rows.length === 0) {
      // Return a default response for unknown users
      return res.json({
        results: [
          {
            name: 'getUserInfo',
            result: {
              user_id: null,
              name: 'valued customer',
              debt: 0,
              error: 'User not found in our system',
            },
          },
        ],
      });
    }

    const user = result.rows[0];

    res.json({
      results: [
        {
          name: 'getUserInfo',
          result: {
            user_id: user.id,
            name: user.name,
            debt: parseFloat(user.remaining_debt),
            phone_number: user.phone_number,
            email: user.email,
          },
        },
      ],
    });
  } catch (error) {
    logger.error('VAPI: Error getting user info', { error });
    res.json({
      results: [
        {
          name: 'getUserInfo',
          error: 'Failed to retrieve user information',
        },
      ],
    });
  }
});

/**
 * POST /api/vapi/negotiate
 * VAPI function to handle negotiation
 */
router.post('/negotiate', (req: Request, res: Response) => {
  try {
    const params = req.body.message.functionCall.parameters;

    logger.info('VAPI: Processing negotiation', params);

    // Ensure arrays are properly formatted
    const user_amounts = Array.isArray(params.user_amounts)
      ? params.user_amounts
      : [];
    const agent_amounts = Array.isArray(params.agent_amounts)
      ? params.agent_amounts
      : [];

    // Use negotiation service
    const negotiationResponse = negotiationService.negotiate({
      user_amounts,
      agent_amounts,
      user_amount: params.user_amount,
      user_debt: params.user_debt,
    });

    res.json({
      results: [
        {
          name: 'negotiatePayment',
          result: negotiationResponse,
        },
      ],
    });
  } catch (error) {
    logger.error('VAPI: Error processing negotiation', { error });
    res.json({
      results: [
        {
          name: 'negotiatePayment',
          error: 'Failed to process negotiation',
        },
      ],
    });
  }
});

/**
 * POST /api/vapi/save-result
 * VAPI function to save call results
 */
router.post('/save-result', async (req: Request, res: Response) => {
  try {
    const params = req.body.message.functionCall.parameters;

    logger.info('VAPI: Saving call result', params);

    // Import services here to avoid circular dependencies
    const { EmailService } = require('../services/email.service');

    const emailService = new EmailService();

    // Get user details
    const userResult = await query('SELECT * FROM users WHERE id = $1', [
      params.user_id,
    ]);

    if (userResult.rows.length === 0) {
      return res.json({
        results: [
          {
            name: 'saveCallResult',
            error: 'User not found',
          },
        ],
      });
    }

    const user = userResult.rows[0];
    const sessionId = params.phone_number || `VAPI-${Date.now()}`;

    // Calculate new debt
    const debtAfter =
      params.status === 'REFUSED'
        ? params.debt
        : Math.max(0, params.debt - params.final_amount);

    // Prepare integration tracking
    const integrations: any = {
      invoice: { status: 'PENDING', external_id: null, url: null, error: null },
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

    // Prepare negotiation data from call history
    const negotiationData = {
      user_amounts: [params.initial_amount, params.final_amount],
      agent_amounts: [],
      rounds: [
        {
          round: 1,
          user_offer: params.initial_amount,
          agent_counter: params.final_amount,
          timestamp: new Date().toISOString(),
          strategy_applied: 'vapi_negotiation',
        },
      ],
      target_amount: params.final_amount,
      acceptance_threshold: params.final_amount,
      negotiation_strategy: 'vapi',
      metadata: {
        max_rounds: 3,
        target_multiplier: 1.3,
      },
    };

    // Process integrations for successful/partial payments
    const workflowResults = {
      invoice_generated: false,
      email_sent: false,
      crm_updated: true,
    };

    if (params.status === 'SUCCESS' || params.status === 'PARTIAL') {
      try {
        // Send email with invoice attachment if user has email
        if (user.email) {
          const emailResult = await emailService.sendInvoiceEmail({
            userId: params.user_id,
            userName: user.name,
            userEmail: user.email,
            phoneNumber: user.phone_number,
            amount: params.final_amount,
            debtBefore: params.debt,
            debtAfter: debtAfter,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });

          integrations.invoice = {
            status: 'SUCCESS',
            external_id: emailResult.invoiceId,
            url: null, // No longer needed since PDF is attached
            generated_at: new Date().toISOString(),
            error: null,
          };
          workflowResults.invoice_generated = true;

          integrations.email = {
            status: 'SUCCESS',
            external_id: emailResult.emailId,
            sent_at: new Date().toISOString(),
            recipient: user.email,
            error: null,
          };
          workflowResults.email_sent = true;
        }
      } catch (error: any) {
        logger.error('VAPI: Error in post-call workflows', { error });
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
    const callSessionQuery = await query(
      `INSERT INTO call_sessions 
       (user_id, external_session_id, call_channel, outcome, initial_offer, final_amount, 
        debt_before, debt_after, negotiation_data, integrations, ended_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
       RETURNING *`,
      [
        params.user_id,
        sessionId,
        'VAPI',
        params.status,
        params.initial_amount,
        params.final_amount,
        params.debt,
        debtAfter,
        JSON.stringify(negotiationData),
        JSON.stringify(integrations),
      ]
    );

    const callSession = callSessionQuery.rows[0];

    res.json({
      results: [
        {
          name: 'saveCallResult',
          result: {
            success: true,
            status: params.status,
            final_amount: params.final_amount,
            debt_left: debtAfter,
            session_id: callSession.id,
            workflows: workflowResults,
          },
        },
      ],
    });
  } catch (error) {
    logger.error('VAPI: Error saving call result', { error });
    res.json({
      results: [
        {
          name: 'saveCallResult',
          error: 'Failed to save call result',
        },
      ],
    });
  }
});

/**
 * POST /api/vapi/webhook
 * Main VAPI webhook endpoint for call events
 */
router.post('/webhook', (req: Request, res: Response) => {
  try {
    const { type, call } = req.body;

    logger.info('VAPI webhook received', { type, callId: call?.id });

    switch (type) {
      case 'call-started':
        logger.info('Call started', {
          callId: call.id,
          phoneNumber: call.customer?.number,
        });
        break;

      case 'call-ended':
        logger.info('Call ended', {
          callId: call.id,
          duration: call.duration,
          endedReason: call.endedReason,
        });
        break;

      case 'function-called':
        logger.info('Function called', {
          callId: call.id,
          function: req.body.functionCall?.name,
        });
        break;

      case 'transcript-complete':
        logger.info('Transcript complete', {
          callId: call.id,
        });
        // You could save the transcript to database here
        break;

      case 'analysis-complete':
        logger.info('Analysis complete', {
          callId: call.id,
          analysis: req.body.analysis,
        });
        // You could save the analysis to database here
        break;

      default:
        logger.debug('Unhandled webhook type', { type });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('VAPI webhook error', { error });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
