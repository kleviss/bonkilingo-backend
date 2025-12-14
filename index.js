import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import rewardsRoutes from './rewards-routes.js';
import { solanaService } from './solana.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Solana (for crypto rewards)
const solanaInitialized = solanaService.initHotWallet();

// Middleware
app.use(cors()); // Allow all origins (configure for production!)
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Bonkilingo Backend API',
    version: '2.0.0',
    features: {
      ai: !!process.env.OPENAI_API_KEY,
      rewards: true,
      withdrawals: solanaInitialized,
    },
    endpoints: [
      'POST /api/correct',
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
app.post('/api/correct', async (req, res) => {
  try {
    const { text, model = 'gpt-3.5-turbo', language } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log(`Correcting text (${language}): "${text.substring(0, 50)}..."`);

    const systemPrompt = 'You are a professional language tutor. You receive a piece of text from a learner and must return a corrected version that fixes grammar, spelling, punctuation, and style while preserving the original meaning. Return ONLY the corrected text, no additional commentary.';

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    });

    const corrected = completion.choices[0].message?.content?.trim();

    // Calculate word count for reward calculation
    const wordCount = text.trim().split(/\s+/).length;

    console.log(`✓ Correction complete (${wordCount} words)`);
    res.json({ 
      corrected,
      wordCount, // Include for client-side reward tracking
    });
  } catch (error) {
    console.error('Error in /api/correct:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to correct text' 
    });
  }
});

// Chat/Lesson Generation Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'gpt-3.5-turbo', systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    console.log(`Generating lesson/chat response`);

    const chatMessages = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const completion = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0].message?.content?.trim();

    console.log(`✓ Lesson/chat response generated`);
    res.json({ reply });
  } catch (error) {
    console.error('Error in /api/chat:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to generate response' 
    });
  }
});

// Language Detection Endpoint
app.post('/api/detect-language', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log(`Detecting language for: "${text.substring(0, 30)}..."`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
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
      max_tokens: 10,
    });

    const language = completion.choices[0].message?.content?.trim().toLowerCase();

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

// =====================================================
// Error Handling
// =====================================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 Bonkilingo Backend API v2.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✓ Server running on http://localhost:${port}`);
  console.log(`✓ OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`✓ Supabase: ${process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing'}`);
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
