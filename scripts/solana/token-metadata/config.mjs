// Shared config resolution for the ISL token-metadata scripts.
//
// Network + endpoints + mint/secret, with this precedence (highest first):
//   1. env override  (ISL_RPC_URL / ISL_IRYS_ADDRESS / ISL_MINT / ISL_MINT_AUTHORITY_SECRET)
//   2. per-network default (--network devnet|mainnet)
//   3. repo .env       (SOLANA_ISL_MINT / SOLANA_MINT_AUTHORITY_SECRET)
//
// So mainnet values never have to be written into the devnet .env — pass them
// as env vars for one run. No args → devnet, reads .env → original behavior.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NETWORKS = {
  devnet: { rpc: 'https://api.devnet.solana.com', irys: 'https://devnet.irys.xyz' },
  mainnet: { rpc: 'https://api.mainnet-beta.solana.com', irys: 'https://node1.irys.xyz' },
};

function envFromDotenv(key) {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1).split(' #')[0].trim();
    }
  }
  return null;
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : null;
}

export function resolveConfig({ needSecret = false } = {}) {
  const network = (argValue('--network') || process.env.ISL_NETWORK || 'devnet').toLowerCase();
  const base = NETWORKS[network];
  if (!base) throw new Error(`Unknown --network "${network}" (use devnet|mainnet)`);

  const rpc = process.env.ISL_RPC_URL || base.rpc;
  const irys = process.env.ISL_IRYS_ADDRESS || base.irys;
  const mint = process.env.ISL_MINT || envFromDotenv('SOLANA_ISL_MINT');
  if (!mint) throw new Error('mint missing — set ISL_MINT or SOLANA_ISL_MINT in .env');

  const secret = needSecret
    ? process.env.ISL_MINT_AUTHORITY_SECRET || envFromDotenv('SOLANA_MINT_AUTHORITY_SECRET')
    : null;
  if (needSecret && !secret) {
    throw new Error(
      'authority secret missing — set ISL_MINT_AUTHORITY_SECRET or SOLANA_MINT_AUTHORITY_SECRET in .env',
    );
  }
  return { network, rpc, irys, mint, secret };
}
