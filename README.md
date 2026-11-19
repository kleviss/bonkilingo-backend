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
  "model": "gpt-6-luna"
}
```

`model` is optional. Supported values are `gpt-6-luna` (the default) and `gpt-6.1-terra`; a request that names any other model, including a retired one, is answered with the default.

If the model can't answer, the request falls back to the default and then to the backups listed in `ai.js`. The response's `model` field names the model that answered.

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
  "model": "gpt-6-luna",
  "systemPrompt": "You are a helpful language tutor..."
}
```

`model` is optional and handled the same way as in `/api/correct`.

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

### Vercel

The app deploys to Vercel as it is; `index.js` exports the Express app and Vercel runs it as a function.

1. In Vercel, add a new project and import this repository. No build settings are needed.
2. Add the environment variables (see `ENV_SETUP.md`):
   - `OPENAI_API_KEY`: required for the AI endpoints.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: required for the rewards endpoints. Without them the AI endpoints still work and `/api/rewards/*` answers 503.
   - `SOLANA_HOT_WALLET_PRIVATE_KEY`, `SOLANA_RPC_URL`, `SOLANA_NETWORK`: only for withdrawals. Without the key, withdrawals are disabled and everything else works.
3. Deploy, then open the project's URL. `GET /` lists which features are configured, and `GET /health` answers `{"status":"ok"}`.

### Elsewhere

- **Docker**: `docker compose up`
- **Any server**: `npm start`

## Client Apps

### Flutter App
Set `API_BASE_URL` in the Flutter project's `env.json` to this deployment's URL.

### Web App
The web app answers `/api/correct`, `/api/chat` and `/api/detect-language` itself and does not call this backend.

## License

MIT

