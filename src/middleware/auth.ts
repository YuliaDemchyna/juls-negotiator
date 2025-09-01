import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query } from '../db/connection';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: any;
  apiKey?: any;
}

// JWT M2M Authentication Middleware
export async function authenticateM2M(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Check for API key in header
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      // Validate API key from database
      const result = await query(
        'SELECT * FROM api_credentials WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())'
      );

      for (const keyRecord of result.rows) {
        const isValid = await bcrypt.compare(apiKey, keyRecord.key_hash);
        if (isValid) {
          // Update last used timestamp and increment request count
          await query(
            'UPDATE api_credentials SET last_used_at = NOW(), request_count = request_count + 1 WHERE id = $1',
            [keyRecord.id]
          );

          req.apiKey = keyRecord;
          logger.info('API key authenticated', { keyName: keyRecord.name });
          return next();
        }
      }
    }

    // Check for JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res
        .status(401)
        .json({ error: 'No authorization header provided' });
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify JWT token
    const secret = process.env.JWT_M2M_SECRET || 'default_m2m_secret';
    const decoded = jwt.verify(token, secret) as any;

    req.user = decoded;
    logger.info('JWT authenticated', { service: decoded.service });
    next();
  } catch (error) {
    logger.error('Authentication error', { error });
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Generate M2M JWT token (utility function for external services)
export function generateM2MToken(
  service: string,
  expiresIn: string = '24h'
): string {
  const secret = process.env.JWT_M2M_SECRET || 'default_m2m_secret';
  return jwt.sign(
    {
      service,
      type: 'm2m',
      iat: Math.floor(Date.now() / 1000),
    } as any,
    secret,
    { expiresIn } as any
  );
}

// VAPI Webhook Authentication
export function authenticateVAPIWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const signature = req.headers['x-vapi-signature'] as string;
    const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      logger.warn('Missing VAPI webhook signature or secret');
      res.status(401).json({ error: 'Unauthorized webhook request' });
      return;
    }

    // VAPI uses HMAC-SHA256 for webhook signatures
    // In production, verify the signature properly
    // For now, we'll do a simple comparison
    if (signature !== webhookSecret) {
      logger.warn('Invalid VAPI webhook signature');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    logger.info('VAPI webhook authenticated');
    next();
  } catch (error) {
    logger.error('VAPI webhook authentication error', { error });
    res.status(500).json({ error: 'Webhook authentication failed' });
  }
}
