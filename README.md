# Bonkilingo Backend API

Standalone Express.js backend for both Bonkilingo Web and Flutter apps.

## Features

- ✅ Text correction using OpenAI
- ✅ Language detection
- ✅ Lesson generation (Tiny Lessons)
- ✅ CORS enabled for cross-origin requests
- ✅ Simple and deployable anywhere

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-key-here
PORT=3001
```

### 3. Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will run on `http://localhost:3001`

## API Endpoints

### POST /api/correct
Correct text with AI.

**Request:**
```json
{
  "text": "i dont no if this work",
  "language": "english",
  "model": "gpt-3.5-turbo"
}
```

**Response:**
```json
{
  "corrected": "I don't know if this works"
}
```

### POST /api/chat
Generate lessons or chat responses.

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "I need vocabulary for ordering food at a restaurant"
    }
  ],
  "model": "gpt-3.5-turbo",
  "systemPrompt": "You are a helpful language tutor..."
}
```

**Response:**
```json
{
  "reply": "Here's vocabulary for ordering food..."
}
```

### POST /api/detect-language
Detect the language of input text.

**Request:**
```json
{
  "text": "Bonjour comment allez-vous"
}
```

**Response:**
```json
{
  "language": "french"
}
```

## Deployment

This can be deployed to:
- **Vercel**: `vercel deploy`
- **Railway**: `railway up`
- **Heroku**: `git push heroku main`
- **Any VPS**: Run with `npm start`

## Update Client Apps

### Flutter App
Update `lib/core/constants/app_constants.dart`:
```dart
static const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3001',  // Changed from 3000
);
```

### Web App
Update your Next.js API routes to proxy to this backend, or call it directly from the client.

## License

MIT

