# Backend Environment Setup

Create a `.env` file in this directory with the following variables:

```bash
# OpenAI API (required for AI features)
OPENAI_API_KEY=sk-your-openai-key-here

# Supabase (required for database/auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key

# Solana Configuration (required for crypto withdrawals)
SOLANA_NETWORK=mainnet
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_HOT_WALLET_PRIVATE_KEY=your-base58-private-key

# Server
PORT=3001
```

## Getting Solana Hot Wallet Key

1. Install Solana CLI: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
2. Generate keypair: `solana-keygen new --no-bip39-passphrase -o hot-wallet.json`
3. Get base58 key: Use a tool to convert the JSON array to base58
4. Fund the wallet with BONK tokens for distributions

## Security Warning

⚠️ **NEVER commit your `.env` file or expose your hot wallet private key!**

