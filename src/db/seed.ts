import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function seedDatabase() {
  const client = await pool.connect();

  try {
    console.log('Starting database seeding...');

    // Begin transaction
    await client.query('BEGIN');

    // Seed users with mock data
    const users = [
      {
        phone: '+1234567890',
        name: 'John Doe',
        email: 'john.doe@example.com',
        debt: 5000.0,
      },
      {
        phone: '+1234567891',
        name: 'Jane Smith',
        email: 'jane.smith@example.com',
        debt: 3500.5,
      },
      {
        phone: '+1234567892',
        name: 'Bob Johnson',
        email: 'bob.johnson@example.com',
        debt: 7250.75,
      },
      {
        phone: '+1234567893',
        name: 'Alice Williams',
        email: 'alice.williams@example.com',
        debt: 2100.0,
      },
      {
        phone: '+1234567894',
        name: 'Charlie Brown',
        email: 'charlie.brown@example.com',
        debt: 9800.25,
      },
    ];

    for (const user of users) {
      await client.query(
        `INSERT INTO users (phone_number, name, email, total_debt, remaining_debt) 
         VALUES ($1, $2, $3, $4, $4) 
         ON CONFLICT (phone_number) DO UPDATE 
         SET name = EXCLUDED.name, 
             email = EXCLUDED.email,
             total_debt = EXCLUDED.total_debt,
             remaining_debt = EXCLUDED.remaining_debt`,
        [user.phone, user.name, user.email, user.debt]
      );
    }

    console.log(`Seeded ${users.length} users`);

    // Seed API credentials for M2M authentication
    const apiKeys = [
      {
        name: 'VAPI Service',
        key: 'vapi_test_key_123456',
        scopes: ['userinfo', 'negotiation', 'call_result'],
      },
      {
        name: 'Test Client',
        key: 'test_client_key_345678',
        scopes: ['userinfo', 'negotiation', 'call_result', 'admin'],
      },
    ];

    for (const apiKey of apiKeys) {
      const hashedKey = await bcrypt.hash(apiKey.key, 10);
      await client.query(
        `INSERT INTO api_credentials (name, key_hash, scopes, is_active, expires_at) 
         VALUES ($1, $2, $3, true, NOW() + INTERVAL '1 year') 
         ON CONFLICT DO NOTHING`,
        [apiKey.name, hashedKey, apiKey.scopes]
      );
    }

    console.log(`Seeded ${apiKeys.length} API credentials`);

    // Add some sample call session history
    const johnDoe = await client.query(
      'SELECT id FROM users WHERE phone_number = $1',
      ['+1234567890']
    );

    if (johnDoe.rows.length > 0) {
      const userId = johnDoe.rows[0].id;
      const sessionId = 'SAMPLE-SESSION-123';

      // Prepare sample negotiation data
      const negotiationData = {
        rounds: [
          {
            round: 1,
            user_offer: 100,
            agent_counter: 200,
            timestamp: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
            strategy_applied: 'aggressive_start',
          },
          {
            round: 2,
            user_offer: 150,
            agent_counter: 175,
            timestamp: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
            strategy_applied: 'converge_middle',
          },
        ],
        user_amounts: [100, 150],
        agent_amounts: [200, 175],
        target_amount: 130,
        acceptance_threshold: 145,
        negotiation_strategy: 'standard',
        metadata: {
          max_rounds: 3,
          target_multiplier: 1.3,
        },
      };

      // Prepare sample integration data
      const integrations = {
        invoice: {
          status: 'SUCCESS',
          external_id: 'SAMPLE-INV-456',
          url: 'https://mock-invoices.example.com/sample-inv-456.pdf',
          generated_at: new Date().toISOString(),
          error: null,
        },
        email: {
          status: 'SUCCESS',
          external_id: 'email-sample-789',
          sent_at: new Date().toISOString(),
          recipient: 'john.doe@example.com',
          error: null,
        },
        crm: {
          status: 'SUCCESS',
          external_id: sessionId,
          synced_at: new Date().toISOString(),
          error: null,
        },
      };

      // Add sample call session
      await client.query(
        `INSERT INTO call_sessions (user_id, external_session_id, call_channel, outcome, 
         initial_offer, final_amount, debt_before, debt_after, negotiation_data, 
         integrations, started_at, ended_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId,
          sessionId,
          'VAPI',
          'PARTIAL',
          100,
          150,
          5000,
          4850,
          JSON.stringify(negotiationData),
          JSON.stringify(integrations),
          new Date(Date.now() - 600000), // Started 10 minutes ago
          new Date(Date.now() - 60000), // Ended 1 minute ago
        ]
      );

      console.log('Seeded sample call session history');
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('Database seeding completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run seeding
seedDatabase().catch(console.error);
