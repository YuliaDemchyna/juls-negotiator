# Debt Negotiation Backend with VAPI Voice Agent

## 🎯 Features

- **VAPI Voice Agent**: Automated voice agent that negotiates payment amounts with customers
- **Smart Negotiation**: AI-powered negotiation logic that aims for 30% increase from initial offer
- **JWT M2M Authentication**: Secure machine-to-machine authentication
- **PostgreSQL Database**: Robust data storage with migrations and seeding
- **Invoice Generation**: integration with Carbone.io for PDF invoices
- **Email Notifications**: Gmail SMTP integration for email delivery
- **Database CRM**: Simple CRM tracking table for customer debt and follow-ups
- **Docker Support**: Full containerization with Docker Compose
- **Logging**: Winston-based logging system, featuring logging best practices

## 📋 Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose
- PostgreSQL (or use Docker)
- VAPI account and API key

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your credentials:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/debt_negotiation
DB_HOST=localhost
DB_PORT=5432
DB_NAME=debt_negotiation
DB_USER=user
DB_PASSWORD=password

# Server Configuration
PORT=3000
NODE_ENV=development
API_KEY=your_secret_api_key
JWT_SECRET=your_jwt_secret_key
SERVER_URL=http://localhost:3000

# VAPI Configuration
VAPI_API_KEY=your_vapi_api_key
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id

# Gmail SMTP Configuration
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your_16_character_app_password

# Invoice Generation (Carbone.io)
CARBONE_API_KEY=your_carbone_api_key
CARBONE_TEMPLATE_ID=your_template_id
```

**Gmail Setup Instructions:**
1. Enable 2-Factor Authentication on your Gmail account
2. Go to Google Account settings → Security → App passwords
3. Generate a new app password for "Mail"
4. Use this 16-character password as `GMAIL_APP_PASSWORD`

### 3. Start Database

```bash
# Start PostgreSQL with Docker
npm run docker:up

# Wait for database to be ready, then run migrations
npm run db:migrate

# Seed with test data
npm run db:seed
```

### 4. Start Backend Server

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start
```

### 5. Deploy VAPI Agent

```bash
# Deploy agent configuration to VAPI
npm run vapi:deploy
```

## 📡 API Endpoints

### Public Endpoints

- `GET /` - API documentation
- `GET /health` - Health check

### Authenticated Endpoints (require API key or JWT)

#### User Management
- `GET /api/userinfo?phone_number=+1234567890` - Get user info by phone

#### Negotiation
- `GET /api/negotiation` - Calculate negotiation response
  ```json
  {
    "user_amounts": [100, 150],
    "agent_amounts": [200, 175],
    "user_amount": 160,
    "user_debt": 5000
  }
  ```

#### Call Results
- `POST /api/call_result` - Save call results and trigger workflows
  ```json
  {
    "user_id": "uuid",
    "status": "SUCCESS",
    "initial_amount": 100,
    "final_amount": 150,
    "debt": 5000
  }
  ```

### VAPI Webhook Endpoints

- `POST /api/vapi/webhook` - Main webhook for call events
- `POST /api/vapi/get-user-info` - Function: Get user information
- `POST /api/vapi/negotiate` - Function: Process negotiation
- `POST /api/vapi/save-result` - Function: Save call results

## 🔐 Authentication

### API Key Authentication

Add to request headers:
```
X-API-Key: your_api_key_here
```

### JWT M2M Authentication

Add to request headers:
```
Authorization: Bearer your_jwt_token_here
```

Generate test token:
```javascript
// Use the generateM2MToken function in src/middleware/auth.ts
const token = generateM2MToken('test-service', '24h');
```

## 🗄️ Database Schema


## 🧪 Testing

### Test Data

The seed script creates test users:
- Phone: `+1234567890`, Name: John Doe, Debt: $5000
- Phone: `+1234567891`, Name: Jane Smith, Debt: $3500.50
- Phone: `+1234567892`, Name: Bob Johnson, Debt: $7250.75

### Test API Keys

Default test API keys (for development only):
- `vapi_test_key_123456`
- `test_client_key_345678`

### Test VAPI Agent

1. Ensure backend is running and accessible from internet (using ngrok for local testing)
2. Update `SERVER_URL` in `.env` with your public URL
3. Deploy agent: `npm run vapi:deploy`
4. Call your VAPI phone number
5. Test negotiation flow with different amounts :)

## 🐳 Docker Deployment

### Full Stack Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Deployment

1. Update `docker-compose.yml` with production values
2. Set `NODE_ENV=production` in environment
3. Use secrets management for sensitive data
4. Set up SSL/TLS termination
5. Configure firewall rules

## 📊 Monitoring

### Logs

Logs are stored in `./logs/` directory:
- `app.log` - All application logs
- `error.log` - Error logs only
- `exceptions.log` - Unhandled exceptions
- `rejections.log` - Unhandled promise rejections

### Health Checks

- Backend: `GET /health`
- Database: Automatic health check in Docker Compose

## 🔧 Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps

# View database logs
docker logs negotiator_db

# Connect to database manually
docker exec -it negotiator_db psql -U negotiator_user -d negotiator_db
```

### VAPI Integration Issues

1. Verify `SERVER_URL` is publicly accessible
2. Check VAPI webhook signature in logs
3. Ensure all VAPI function URLs are correct
4. Test with VAPI dashboard's function tester

### Common Errors

- **"User not found"**: Phone number not in database, run seed script
- **"Invalid token"**: Check API key or JWT token
- **"Database connection failed"**: Verify PostgreSQL is running and credentials are correct

## 📝 Development Notes

### Negotiation Logic

The negotiation service follows these rules:
1. Maximum 3 rounds of negotiation
2. Target: Initial offer × 1.30
3. Never exceed total debt amount
4. Progressive concessions each round
5. Accept if within 10% of user's offer


## 🚢 Production Checklist

- [ ] Set strong passwords for database
- [ ] Generate secure JWT secrets
- [ ] Configure HTTPS/SSL
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy
- [ ] Implement rate limiting
- [ ] Set up log rotation
- [ ] Configure firewall rules
- [ ] Use environment-specific configs
- [ ] Set up CI/CD pipeline

## 📄 License

MIT 

