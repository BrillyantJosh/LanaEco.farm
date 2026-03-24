import { Router, Request, Response } from 'express';

const SUPABASE_CHECK_URL = 'https://laluxmwarlejdwyboudz.supabase.co/functions/v1/check';
const SUPABASE_REGISTER_URL = 'https://laluxmwarlejdwyboudz.supabase.co/functions/v1/register-virgin-wallets';

// Validate wallet format: starts with 'L', 26-35 chars, alphanumeric
function isValidWalletId(wallet_id: string): boolean {
  return /^L[a-zA-Z0-9]{25,34}$/.test(wallet_id);
}

export function createRegisterRouter(): Router {
  const router = Router();

  /**
   * POST /api/register/check
   * Read-only check: is this wallet already registered?
   * Uses simple_check_wallet_registration (no side effects).
   */
  router.post('/check', async (req: Request, res: Response) => {
    const apiKey = process.env.LANA_REGISTER_API_KEY;

    if (!apiKey) {
      console.error('LANA_REGISTER_API_KEY is not configured');
      res.status(500).json({ error: 'Registration service not configured' });
      return;
    }

    const { wallet_id } = req.body;

    if (!wallet_id || typeof wallet_id !== 'string') {
      res.status(400).json({ error: 'wallet_id is required' });
      return;
    }

    if (!isValidWalletId(wallet_id)) {
      res.status(400).json({ error: 'Invalid wallet address format' });
      return;
    }

    try {
      const response = await fetch(SUPABASE_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'simple_check_wallet_registration',
          api_key: apiKey,
          data: { wallet_id }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Registration API error:', response.status, data);
        res.status(response.status).json({
          error: data.message || 'Registration check failed'
        });
        return;
      }

      res.json(data);
    } catch (error: any) {
      console.error('Registration API request failed:', error);
      res.status(500).json({ error: 'Failed to check registration' });
    }
  });

  /**
   * POST /api/register/wallet
   * Register a wallet via check_wallet method.
   * If wallet is unregistered and virgin (balance=0), it auto-registers
   * and broadcasts KIND 87006, KIND 87002, KIND 30889 events.
   */
  router.post('/wallet', async (req: Request, res: Response) => {
    const apiKey = process.env.LANA_REGISTER_API_KEY;

    if (!apiKey) {
      console.error('LANA_REGISTER_API_KEY is not configured');
      res.status(500).json({ error: 'Registration service not configured' });
      return;
    }

    const { wallet_id, nostr_id_hex } = req.body;

    if (!wallet_id || typeof wallet_id !== 'string') {
      res.status(400).json({ error: 'wallet_id is required' });
      return;
    }

    if (!isValidWalletId(wallet_id)) {
      res.status(400).json({ error: 'Invalid wallet address format' });
      return;
    }

    // Validate nostr_id_hex if provided (64-char hex)
    if (nostr_id_hex && (typeof nostr_id_hex !== 'string' || !/^[a-f0-9]{64}$/.test(nostr_id_hex))) {
      res.status(400).json({ error: 'Invalid nostr_id_hex format (must be 64-char hex)' });
      return;
    }

    try {
      const requestBody: any = {
        method: 'check_wallet',
        api_key: apiKey,
        data: { wallet_id }
      };

      // Include nostr_id_hex if provided
      if (nostr_id_hex) {
        requestBody.data.nostr_id_hex = nostr_id_hex;
      }

      console.log(`[register/wallet] Registering wallet ${wallet_id}${nostr_id_hex ? ` with nostr ${nostr_id_hex.slice(0, 8)}...` : ''}`);

      const response = await fetch(SUPABASE_REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Wallet registration API error:', response.status, data);
        res.status(response.status).json({
          error: data.message || 'Wallet registration failed'
        });
        return;
      }

      console.log(`[register/wallet] Result for ${wallet_id}: ${data.status} - ${data.message}`);
      res.json(data);
    } catch (error: any) {
      console.error('Wallet registration API request failed:', error);
      res.status(500).json({ error: 'Failed to register wallet' });
    }
  });

  return router;
}
