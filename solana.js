// =====================================================
// Solana Integration for BONK Token Rewards
// =====================================================

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

// =====================================================
// Configuration
// =====================================================

// BONK Token Mint Address (mainnet)
const BONK_MINT = new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

// RPC Endpoints (use Helius/QuickNode for production)
const RPC_ENDPOINTS = {
  mainnet: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

// =====================================================
// Solana Service Class
// =====================================================

export class SolanaService {
  constructor(network = "mainnet") {
    this.network = network;
    this.connection = new Connection(RPC_ENDPOINTS[network], { commitment: "confirmed" });
    this.hotWallet = null;
    this.hotWalletPublicKey = null;
  }

  /**
   * Initialize the hot wallet from environment variable
   * IMPORTANT: Keep the private key secure!
   */
  initHotWallet() {
    const privateKeyBase58 = process.env.SOLANA_HOT_WALLET_PRIVATE_KEY;

    if (!privateKeyBase58) {
      console.warn("⚠️ SOLANA_HOT_WALLET_PRIVATE_KEY not set - withdrawals disabled");
      return false;
    }

    try {
      const privateKeyBytes = bs58.decode(privateKeyBase58);
      this.hotWallet = Keypair.fromSecretKey(privateKeyBytes);
      this.hotWalletPublicKey = this.hotWallet.publicKey;
      console.log(`✓ Hot wallet initialized: ${this.hotWalletPublicKey.toBase58()}`);
      return true;
    } catch (error) {
      console.error("Failed to initialize hot wallet:", error.message);
      return false;
    }
  }

  /**
   * Get hot wallet public key
   */
  getHotWalletAddress() {
    return this.hotWalletPublicKey?.toBase58() || null;
  }

  /**
   * Check if withdrawals are enabled
   */
  isWithdrawalsEnabled() {
    return this.hotWallet !== null;
  }

  /**
   * Validate a Solana wallet address
   */
  isValidAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get SOL balance of an address
   */
  async getSolBalance(address) {
    try {
      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error("Error getting SOL balance:", error);
      return 0;
    }
  }

  /**
   * Get BONK token balance of an address
   */
  async getBonkBalance(address) {
    try {
      const publicKey = new PublicKey(address);
      const tokenAccount = await getAssociatedTokenAddress(BONK_MINT, publicKey);

      try {
        const account = await getAccount(this.connection, tokenAccount);
        // BONK has 5 decimals
        return Number(account.amount) / 100000;
      } catch {
        // Token account doesn't exist
        return 0;
      }
    } catch (error) {
      console.error("Error getting BONK balance:", error);
      return 0;
    }
  }

  /**
   * Get hot wallet BONK balance (for monitoring)
   */
  async getHotWalletBonkBalance() {
    if (!this.hotWalletPublicKey) return 0;
    return this.getBonkBalance(this.hotWalletPublicKey.toBase58());
  }

  /**
   * Transfer BONK tokens from hot wallet to user
   * @param {string} recipientAddress - User's Solana wallet address
   * @param {number} amount - Amount of BONK tokens to send
   * @returns {Promise<{success: boolean, signature?: string, error?: string}>}
   */
  async transferBonk(recipientAddress, amount) {
    if (!this.hotWallet) {
      return { success: false, error: "Hot wallet not initialized" };
    }

    if (!this.isValidAddress(recipientAddress)) {
      return { success: false, error: "Invalid recipient address" };
    }

    if (amount <= 0) {
      return { success: false, error: "Invalid amount" };
    }

    try {
      const recipientPubkey = new PublicKey(recipientAddress);

      // Get token accounts
      const senderTokenAccount = await getAssociatedTokenAddress(BONK_MINT, this.hotWalletPublicKey);
      const recipientTokenAccount = await getAssociatedTokenAddress(BONK_MINT, recipientPubkey);

      // Check sender balance
      const senderAccount = await getAccount(this.connection, senderTokenAccount);
      const amountInSmallestUnit = BigInt(Math.floor(amount * 100000)); // BONK has 5 decimals

      if (senderAccount.amount < amountInSmallestUnit) {
        return { success: false, error: "Insufficient BONK balance in hot wallet" };
      }

      // Build transaction
      const transaction = new Transaction();

      // Check if recipient has a token account, create if not
      try {
        await getAccount(this.connection, recipientTokenAccount);
      } catch {
        // Create associated token account for recipient
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.hotWalletPublicKey, // payer
            recipientTokenAccount, // associatedToken
            recipientPubkey, // owner
            BONK_MINT // mint
          )
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          senderTokenAccount, // source
          recipientTokenAccount, // destination
          this.hotWalletPublicKey, // owner
          amountInSmallestUnit // amount
        )
      );

      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.hotWallet], { commitment: "confirmed" });

      console.log(`✓ BONK transfer successful: ${signature}`);
      return { success: true, signature };
    } catch (error) {
      console.error("BONK transfer failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get recent transactions for monitoring
   */
  async getRecentTransactions(limit = 10) {
    if (!this.hotWalletPublicKey) return [];

    try {
      const signatures = await this.connection.getSignaturesForAddress(this.hotWalletPublicKey, { limit });
      return signatures.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        err: sig.err,
        blockTime: sig.blockTime,
      }));
    } catch (error) {
      console.error("Error getting transactions:", error);
      return [];
    }
  }
}

// Export singleton instance
export const solanaService = new SolanaService(process.env.SOLANA_NETWORK || "mainnet");

