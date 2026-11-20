// Loads .env before the modules below read process.env as they are imported.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { DEFAULT_MODEL, completeChat, isOpenAIConfigured, resolveModel } from './ai.js';
import rewardsRoutes from './rewards-routes.js';
import keyboardTokenRoutes from './keyboard-tokens.js';
import { solanaService } from './solana.js';
import { isSupabaseConfigured } from './supabase-client.js';
import { aiGuard, cleanLanguage, corsOrigins, limits } from './ai-guard.js';

const app = express();
const port = process.env.PORT || 3001;

// Behind Vercel's (or any) reverse proxy, req.ip must come from the proxy's
// X-Forwarded-For entry, not the proxy itself, or every anonymous caller
// shares one rate limit bucket. TRUST_PROXY overrides (e.g. "2" for two hops).
// Express reads a string as an address list, so "1" must become the number 1.
function trustProxySetting(value) {
  if (value === undefined || value === '') return process.env.VERCEL ? 1 : false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value; // e.g. "loopback" or a list of addresses
}
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

// Initialize Solana (for crypto rewards)
const solanaInitialized = solanaService.initHotWallet();

// Middleware
// The mobile app doesn't need CORS (only browsers enforce it), and the web app
// has its own API routes, so no browser origin is allowed unless listed in
// CORS_ORIGINS (comma-separated).
app.use(cors({ origin: corsOrigins() }));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint (for deployment verification)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Bonkilingo Backend API',
    version: '2.0.0',
    features: {
      ai: isOpenAIConfigured(),
      rewards: isSupabaseConfigured,
      withdrawals: solanaInitialized,
    },
    endpoints: [
      'POST /api/correct',
      'POST /api/keyboard/token',
      'DELETE /api/keyboard/token',
      'POST /api/chat', 
      'POST /api/detect-language',
      'GET  /api/rewards/balance',
      'GET  /api/rewards/history',
      'POST /api/rewards/earn',
      'POST /api/rewards/wallet',
      'POST /api/rewards/withdraw',
      'GET  /api/rewards/withdrawals',
      'GET  /api/rewards/status',
    ]
  });
});

// =====================================================
// AI Endpoints
// =====================================================

// Text Correction Endpoint
// User text is never logged: it can be a private message, and the keyboard
// extension will send text typed into other apps.
app.post('/api/correct', ...aiGuard('correct'), async (req, res) => {
  try {
    const { text } = req.body;
    const model = resolveModel(req.body.model);
    const language = cleanLanguage(req.body.language);

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }
    if (text.length > limits.maxTextChars) {
      return res.status(413).json({ error: `Text is too long (maximum ${limits.maxTextChars} characters)` });
    }

    console.log(`Correcting text (${language ?? 'auto'}, ${text.length} chars, ${req.user ? 'user' : 'anonymous'})`);

    const languageRule = language
      ? `The text is written in ${language}. Return the corrected text in ${language}; never translate it.`
      : 'Return the corrected text in the same language as the input; never translate it.';
    const systemPrompt = `You are a professional language tutor. You receive a piece of text from a learner and must return a corrected version that fixes grammar, spelling, punctuation, and style while preserving the original meaning. ${languageRule} Return ONLY the corrected text, no additional commentary.`;

    const answer = await completeChat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    });

    // Calculate word count for reward calculation
    const wordCount = text.trim().split(/\s+/).length;

    console.log(`✓ Correction complete (${wordCount} words, ${answer.model})`);
    res.json({ 
      corrected: answer.text,
      wordCount, // Include for client-side reward tracking
      model: answer.model, // The model that answered, which is a backup if the requested one failed
    });
  } catch (error) {
    console.error('Error in /api/correct:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to correct text' 
    });
  }
});

// Chat/Lesson Generation Endpoint
app.post('/api/chat', ...aiGuard('chat'), async (req, res) => {
  try {
    const { messages, systemPrompt } = req.body;
    const model = resolveModel(req.body.model);

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }
    // Explanation chats resend the whole conversation, so allow a few texts' worth.
    const totalChars = JSON.stringify(messages).length + (systemPrompt?.length ?? 0);
    if (totalChars > limits.maxTextChars * 4) {
      return res.status(413).json({ error: 'Conversation is too long' });
    }

    console.log(`Generating lesson/chat response`);

    const chatMessages = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const answer = await completeChat({
      model,
      messages: chatMessages,
      temperature: 0.7,
    });

    console.log(`✓ Lesson/chat response generated (${answer.model})`);
    res.json({ reply: answer.text, model: answer.model });
  } catch (error) {
    console.error('Error in /api/chat:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to generate response' 
    });
  }
});

// Language Detection Endpoint
app.post('/api/detect-language', ...aiGuard('detect', { multiplier: 5 }), async (req, res) => {
  try {
    const { text } = req.body;

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }
    if (text.length > limits.maxTextChars) {
      return res.status(413).json({ error: `Text is too long (maximum ${limits.maxTextChars} characters)` });
    }

    console.log(`Detecting language (${text.length} chars)`);

    const answer = await completeChat({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a language detection assistant. Respond with ONLY the language name in lowercase (e.g., "english", "spanish", "french", "german", "italian", "portuguese"). If you cannot determine the language, respond with "unknown".',
        },
        {
          role: 'user',
          content: `What language is this text written in? "${text}"`,
        },
      ],
      temperature: 0.1,
    });

    const language = answer.text.toLowerCase();

    console.log(`✓ Detected language: ${language}`);
    res.json({ language: language || 'unknown' });
  } catch (error) {
    console.error('Error in /api/detect-language:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to detect language' 
    });
  }
});

// =====================================================
// Rewards Routes (mounted at /api/rewards)
// =====================================================
app.use('/api/rewards', rewardsRoutes);

// Keyboard sign-in (iOS keyboard extension): POST/DELETE /api/keyboard/token
app.use('/api/keyboard', keyboardTokenRoutes);

// =====================================================
// Error Handling
// =====================================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// On Vercel the exported app is the request handler and nothing listens on a
// port. Everywhere else (local, Docker, a VPS) start the server as usual.
export default app;

if (!process.env.VERCEL) {
  // Start server with error handling
  const server = app.listen(port, '0.0.0.0', () => {
    console.log('');
    console.log('🚀 Bonkilingo Backend API v2.0');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✓ Server running on http://0.0.0.0:${port}`);
    console.log(`✓ OpenAI API Key: ${isOpenAIConfigured() ? '✓ Set' : '✗ Missing'}`);
    console.log(`✓ Supabase: ${isSupabaseConfigured ? '✓ Configured' : '✗ Missing'}`);
    console.log(`✓ Solana Withdrawals: ${solanaInitialized ? '✓ Enabled' : '✗ Disabled (no hot wallet)'}`);
    console.log('');
    console.log('AI Endpoints:');
    console.log(`  POST http://localhost:${port}/api/correct`);
    console.log(`  POST http://localhost:${port}/api/chat`);
    console.log(`  POST http://localhost:${port}/api/detect-language`);
    console.log('');
    console.log('Rewards Endpoints:');
    console.log(`  GET  http://localhost:${port}/api/rewards/balance`);
    console.log(`  GET  http://localhost:${port}/api/rewards/history`);
    console.log(`  POST http://localhost:${port}/api/rewards/earn`);
    console.log(`  POST http://localhost:${port}/api/rewards/wallet`);
    console.log(`  POST http://localhost:${port}/api/rewards/withdraw`);
    console.log(`  GET  http://localhost:${port}/api/rewards/withdrawals`);
    console.log(`  GET  http://localhost:${port}/api/rewards/status`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  });

  // Handle server errors
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use`);
      process.exit(1);
    } else {
      console.error('❌ Server error:', error);
      process.exit(1);
    }
  });
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
