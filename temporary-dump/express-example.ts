/**
 * Express + Vapi TypeScript Integration Example
 * 
 * This example shows how to integrate Vapi with an Express.js application
 * using TypeScript for type safety.
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Vapi } from '@vapi-ai/server-sdk';

const app = express();
app.use(express.json());

// Initialize Vapi client
const client = new Vapi({
  apiKey: process.env.VAPI_API_KEY!,
});

// Serve the main page
app.get('/', (req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Vapi Express TypeScript Example</title>
    <script src="https://cdn.jsdelivr.net/npm/@vapi-ai/web@latest/dist/vapi.js"></script>
</head>
<body>
    <h1>Vapi Voice Assistant (Express + TypeScript)</h1>
    <button id="startCall">Start Call</button>
    <button id="endCall" disabled>End Call</button>
    <div id="status"></div>
    
    <script>
        const vapi = new Vapi("${process.env.VAPI_PUBLIC_KEY}");
        const assistantId = "${process.env.VAPI_ASSISTANT_ID}";
        
        document.getElementById('startCall').onclick = async () => {
            try {
                await vapi.start(assistantId);
                document.getElementById('startCall').disabled = true;
                document.getElementById('endCall').disabled = false;
                document.getElementById('status').innerText = 'Call started';
            } catch (error) {
                console.error('Error starting call:', error);
            }
        };
        
        document.getElementById('endCall').onclick = async () => {
            try {
                await vapi.stop();
                document.getElementById('startCall').disabled = false;
                document.getElementById('endCall').disabled = true;
                document.getElementById('status').innerText = 'Call ended';
            } catch (error) {
                console.error('Error ending call:', error);
            }
        };
    </script>
</body>
</html>
`;
  res.send(html);
});

// API endpoint to list assistants
app.get('/api/assistants', async (req: Request, res: Response) => {
  try {
    const assistants = await client.assistants.list();
    res.json(assistants.map(a => ({
      id: a.id,
      name: a.name
    })));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// API endpoint to create a call
interface CreateCallRequest {
  assistantId: string;
  phoneNumber: string;
}

app.post('/api/calls', async (req: Request<{}, {}, CreateCallRequest>, res: Response) => {
  try {
    const { assistantId, phoneNumber } = req.body;
    const call = await client.calls.create({
      assistantId,
      customer: {
        number: phoneNumber
      }
    });
    res.json({
      id: call.id,
      status: call.status
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Webhook endpoint for Vapi events
interface VapiWebhookEvent {
  type: string;
  call?: {
    id: string;
    [key: string]: any;
  };
  transcript?: string;
}

app.post('/webhook/vapi', (req: Request<{}, {}, VapiWebhookEvent>, res: Response) => {
  const { type } = req.body;
  console.log(`Received Vapi webhook: ${type}`);
  
  switch (type) {
    case 'call.started':
      if (req.body.call) {
        console.log(`Call started: ${req.body.call.id}`);
      }
      break;
      
    case 'call.ended':
      if (req.body.call) {
        console.log(`Call ended: ${req.body.call.id}`);
      }
      break;
      
    case 'transcript':
      if (req.body.transcript) {
        console.log(`Transcript: ${req.body.transcript}`);
      }
      break;
  }
  
  res.json({ status: 'ok' });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'vapi-express-ts-example' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
