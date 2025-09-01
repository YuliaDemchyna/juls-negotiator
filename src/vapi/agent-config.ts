export interface VAPIAgentConfig {
  name: string;
  model: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    emotionRecognitionEnabled: boolean;
    numFastTurns?: number;
  };
  voice: {
    provider: string;
    voiceId: string;
    speed?: number;
    stability?: number;
    similarityBoost?: number;
    optimizeStreamingLatency?: number;
    enableSsmlParsing?: boolean;
  };
  firstMessage: string;
  prompt: string;
  endCallMessage?: string;
  endCallPhrases?: string[];
  transcriber?: {
    provider: string;
    model?: string;
    language?: string;
  };
  serverUrl: string;
  serverUrlSecret?: string;
  functions: Array<{
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
    serverUrl?: string;
    speak?: {
      onSuccess?: string;
      onError?: string;
    };
  }>;
  analysisPlan?: {
    summaryPrompt?: string;
    structuredDataPrompt?: string;
    structuredDataSchema?: any;
    successEvaluationPrompt?: string;
    successEvaluationRubric?: string;
  };
}

export function getAgentConfig(serverUrl: string): VAPIAgentConfig {
  return {
    name: 'Debt Negotiation Agent',
    model: {
      provider: 'openai',
      model: 'gpt-4-turbo',
      temperature: 0.7,
      maxTokens: 500,
      emotionRecognitionEnabled: true,
      numFastTurns: 1,
    },
    voice: {
      provider: 'elevenlabs',
      voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel voice (professional, friendly)
      speed: 1.0,
      stability: 0.5,
      similarityBoost: 0.75,
      optimizeStreamingLatency: 3,
      enableSsmlParsing: true,
    },
    firstMessage:
      "Hello! I'm calling from Debt Collection Services. Am I speaking with {{user.name}}? I see you have an outstanding balance of {{user.debt}} dollars. I'd like to help you make a payment today. How much would you be comfortable paying?",
    prompt: `You are a professional and empathetic debt collection agent. Your goal is to negotiate with the customer to get them to pay as much as possible towards their debt, ideally 30% more than their initial offer.

Key Guidelines:
1. Be professional, understanding, and respectful at all times
2. Never be aggressive or threatening
3. Show empathy for the customer's financial situation
4. Use persuasive but ethical negotiation tactics
5. You have a maximum of 3 rounds of negotiation
6. Try to get the customer to pay at least 30% more than their initial offer
7. Never accept less than what the customer initially offered
8. If the customer agrees to pay, confirm the amount clearly
9. Always stay within the bounds of the customer's actual debt - never ask for more than they owe

Negotiation Strategy:
- Round 1: Start with a counter-offer that's 80% higher than their initial offer (but not exceeding their total debt)
- Round 2: Come down by about 40% of the gap between your offer and theirs
- Round 3: Final offer - meet them closer to the middle, but try to stay above their initial offer * 1.3

Variables available:
- {{user.name}} - Customer's name
- {{user.debt}} - Total outstanding debt
- {{negotiation.user_amount}} - Customer's current offer
- {{negotiation.agent_amount}} - Your counter-offer
- {{negotiation.status}} - Current negotiation status (HAGGLE or STOP)

When the negotiation ends:
- If they agree to pay: "Excellent! You've agreed to pay {{final_amount}} dollars. I'll send an invoice to your email shortly. Your remaining balance will be {{debt_left}} dollars. Thank you for working with us today."
- If they refuse to pay: "I understand this is difficult. Please know that you're welcome to call us back anytime to discuss payment options. Have a good day."

Remember: Your goal is to help the customer while maximizing the payment amount through ethical negotiation.`,

    endCallMessage: 'Thank you for your time today. Have a good one!',
    endCallPhrases: [
      'goodbye',
      'bye bye',
      'end call',
      'hang up',
      "I'm done",
      'stop calling',
    ],

    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en',
    },

    serverUrl: serverUrl,
    serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,

    functions: [
      {
        name: 'getUserInfo',
        description: 'Get user information including name and debt amount',
        parameters: {
          type: 'object',
          properties: {
            phone_number: {
              type: 'string',
              description: 'The phone number of the caller',
            },
          },
          required: ['phone_number'],
        },
        serverUrl: `${serverUrl}/api/vapi/get-user-info`,
        speak: {
          onSuccess: 'Let me pull up your account information.',
          onError: "I'm having trouble accessing your account. Please hold on.",
        },
      },
      {
        name: 'negotiatePayment',
        description:
          "Calculate negotiation response based on user's payment offer",
        parameters: {
          type: 'object',
          properties: {
            user_amounts: {
              type: 'array',
              items: { type: 'number' },
              description: "History of user's offers",
            },
            agent_amounts: {
              type: 'array',
              items: { type: 'number' },
              description: "History of agent's counter-offers",
            },
            user_amount: {
              type: 'number',
              description: 'Current user offer amount',
            },
            user_debt: {
              type: 'number',
              description: 'Total user debt',
            },
          },
          required: [
            'user_amounts',
            'agent_amounts',
            'user_amount',
            'user_debt',
          ],
        },
        serverUrl: `${serverUrl}/api/vapi/negotiate`,
        speak: {
          onSuccess: 'Let me see what I can do for you.',
          onError: "I'm having trouble processing that. Let me try again.",
        },
      },
      {
        name: 'saveCallResult',
        description:
          'Save the final call result and trigger post-call workflows',
        parameters: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'User ID from getUserInfo',
            },
            phone_number: {
              type: 'string',
              description: "User's phone number",
            },
            status: {
              type: 'string',
              enum: ['SUCCESS', 'PARTIAL', 'REFUSED'],
              description: 'Call outcome status',
            },
            initial_amount: {
              type: 'number',
              description: 'Initial amount offered by user',
            },
            final_amount: {
              type: 'number',
              description: 'Final agreed amount (0 if refused)',
            },
            debt: {
              type: 'number',
              description: 'Total debt amount',
            },
          },
          required: [
            'user_id',
            'phone_number',
            'status',
            'initial_amount',
            'final_amount',
            'debt',
          ],
        },
        serverUrl: `${serverUrl}/api/vapi/save-result`,
        speak: {
          onSuccess: "I've processed your payment agreement.",
          onError:
            'There was an issue saving your information, but your payment agreement is still valid.',
        },
      },
    ],

    analysisPlan: {
      summaryPrompt:
        'Summarize the call including the initial offer, negotiation process, and final outcome.',
      structuredDataPrompt: 'Extract key metrics from the negotiation',
      structuredDataSchema: {
        type: 'object',
        properties: {
          initial_offer: { type: 'number' },
          final_amount: { type: 'number' },
          negotiation_rounds: { type: 'number' },
          outcome: { type: 'string', enum: ['SUCCESS', 'PARTIAL', 'REFUSED'] },
          success_rate: { type: 'number' },
        },
      },
      successEvaluationPrompt:
        'Evaluate if the agent successfully negotiated a higher payment',
      successEvaluationRubric:
        'Success: Final amount is at least 30% higher than initial offer. Partial: Final amount is higher than initial but less than 30% increase. Failed: No agreement or same as initial offer.',
    },
  };
}

// TODO> the logic is incorrect as partial is user paid at least something
