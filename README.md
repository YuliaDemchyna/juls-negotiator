# Debt Negotiation AI Agent

> Voice-powered debt collection system with intelligent negotiation logic, PDF invoice generation, and email automation.

## 🎬 Demo

### [▶️ **WATCH LIVE DEMO**](https://www.loom.com/share/4249377c2509473da444684a1ceded68?sid=361530d8-27bb-4e1f-b8ba-7b3569358644)
*Click to see the AI agent in action - phone-based debt negotiation with real-time PDF invoice generation*

## 🚀 How to Run

### Prerequisites
- **Node.js 18+**
- **Docker & Docker Compose** 
- **Environment variables** - Copy `env.example` to `.env` and configure

### Quick Start
```bash
# 1. Clone and install dependencies
npm install

# 2. Start PostgreSQL database
docker-compose up postgres -d

# 3. Initialize database with sample data
npm run db:seed

# 4. Start development server
npm run dev
```

### Production Deployment
```bash
# Build and run complete stack
docker-compose up -d

# Verify deployment
curl http://localhost:3000/health
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/userinfo` | Get user details by phone number |
| `POST` | `/api/negotiation` | Calculate negotiation counter-offers |
| `POST` | `/api/call_result` | Process call outcomes & trigger integrations |

## 🏗️ Source Code Walkthrough

### Core Architecture
```
src/
├── server.ts           # Express app setup, middleware, error handling
├── middleware/
│   └── auth.ts         # M2M API authentication
├── routes/
│   └── api.routes.ts   # API endpoints with validation
├── services/
│   ├── negotiation.service.ts # Human-like haggling algorithm
│   └── email.service.ts       # Carbone PDF + Gmail integration
├── db/
│   ├── connection.ts   # PostgreSQL connection pool
│   ├── init.sql        # Database schema with business rules
│   └── seed.ts         # Sample data seeding
└── utils/
    ├── call-session.utils.ts # Session tracking & debt calculations
    ├── user.utils.ts         # User lookup functions
    └── logger.ts             # Winston logging setup
```

### Key Components

#### 🧠 Negotiation Logic (`negotiation.service.ts`)
- **Multi-round haggling** with convergence strategy
- **Target formula**: `initial_offer × 1.3`
- **Progressive concessions** over 3 rounds maximum
- **Minimum thresholds** to prevent unrealistic agreements

#### 🔗 Integration Layer (`email.service.ts`)
- **Carbone.io** - Professional PDF invoice generation
- **Gmail SMTP** - Automated email delivery *(initially considered Resend for better deliverability, but opted for Gmail due to domain requirements)*
- **Styled HTML emails** with subtle pink theming

#### 🗄️ Database Design (`init.sql`)
- **PostgreSQL** with proper constraints and triggers
- **Automatic debt updates** via database triggers
- **JSON fields** for negotiation history and integration status
- **Performance indexes** for common query patterns

## 🎯 Design Process & Decisions

### Development Timeline *(2.5 days)*
**Day 1**: Foundation-first strategy - project design, db schema, backend setup.  
**Day 2**: Integration layer - VAPI connection, email services and Carbone IO.   
**Day 2.5**: Agent refinement - personality tuning, demo cleanup✨

### 1. Agent Conversation Flow *(diagram attached)*
Designed logical conversation flow before implementation:
- **User identification** by phone number lookup
- **Debt verification** and initial offer collection
- **Multi-round negotiation** with intelligent counter-offers
- **Success/failure handling** with appropriate follow-ups

### 2. API-First Approach
Designed endpoints with clear inputs/outputs:
- **Input validation** using Zod schemas
- **Structured responses** for consistent agent consumption  
- **Error handling** with meaningful messages for voice agent

### 3. Integration Selections & Trade-offs
**Email + Invoice Generation** *(production-ready solution)*:
- **Carbone.io** - Professional document generation over simple PDFs
- **Gmail SMTP** - Reliable delivery over complex mail services
- **PDF attachments** - Complete invoice workflow

**Agent Personality vs. Speed**: Invested extra 0.5 days in conversational flow tuning - technical precision alone produces robotic interactions that fail in real debt collection scenarios.

**CRM Integration** - Mocked backend integration patterns

## ⚙️ Technology Stack

### Core Framework
| Technology | Rationale |
|------------|-----------|
| **TypeScript + Node.js** | Matches your stack |
| **Express** | Industry standard, lightweight |
| **PostgreSQL** | Relational data with JSON support |
| **Docker** | Containerized deployment |

### Integrations & Tools
| Tool | Purpose |
|------|---------|
| **Carbone.io** | Professional PDF generation with templates |
| **Nodemailer + Gmail** | Reliable email delivery |
| **Winston** | Structured logging |
| **Zod** | Runtime type validation |

### Architecture Philosophy
*Mirrors production setup from previous company (thePrep)*:
- **Clean separation of concerns**
- **Service layer** for business logic
- **Database triggers** for data consistency
- **Comprehensive error handling** and logging

## 🤖 VAPI Agent Implementation

> **Note**: Agent code and conversation diagram available in `vapi-agents/` folder

### Current State ✅
*Successfully handles happy path (see demo video)*:
- **Phone-based user lookup** with real-time database queries
- **Multi-round negotiation** with embedded business logic
- **PDF invoice generation** and automated email delivery

### Technical Implementation
**VAPI Configuration**: Initially attempted full programmatic setup via API endpoints *(see `temporary-dump.zip` for scripts)*, but switched to dashboard configuration due to time constraints.





## 🚀 Future Improvements

### 1. **Agent Personality vs. Functionality Balance**
**Issue**: Demo agent has excellent customer-friendly tone but struggles with negotiation tool formatting. Functional agent technically works perfectly but sounds robotic.

**Future Solution**: Merge conversational flow of demo agent with technical precision of functional agent through better prompt engineering and tool call formatting.

### 2. **Performance Optimizations**
- **Pre-fetch account data**: Run `getUserInfo` lookup via Workflow before assistant picks up, passing results as variables for instant greeting
- **Post-call persistence**: Move `saveResult` to `call.ended` Workflow node, eliminating latency during goodbye

### 3. **Advanced Negotiation Strategy**
- Replace static formulas with **dynamic scoring model** tuned from historical success rates
- **Sentiment-driven branching**: Different strategies for cooperative vs. defensive callers  
- **Adaptive empathy phrases**: Mirror stress levels, softer counteroffers for resistant callers

### 4. **Analytics & Data Capture**
- Expand `saveResult` payload with **negotiation transcript features** (round count, sentiment, key phrases)
- Track **first-offer vs. final-offer deltas** for performance analysis over time

### 5. **Security & Reliability**
- **Mask sensitive fields** in logs (emails, phone numbers)
- **Rate limiting** on negotiation API to prevent abuse

### 6. **Enhance User Experience**
- **Multi-language support** for common caller demographics
- **Pause and resume handling** for interrupted calls
- **Improved closing phrases** with reassurance: *"Thank you for working with us, this will help reduce your balance"*

