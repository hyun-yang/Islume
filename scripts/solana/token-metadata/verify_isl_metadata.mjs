// Read back the on-chain Metaplex metadata for the ISL mint and print it.
//   node verify_isl_metadata.mjs

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
const mintLine = readFileSync(envPath, 'utf8')
  .split('\n')
  .find((l) => l.startsWith('SOLANA_ISL_MINT='));
const mint = publicKey(mintLine.slice('SOLANA_ISL_MINT='.length).split(' #')[0].trim());

const umi = createUmi('https://api.devnet.solana.com').use(mplTokenMetadata());
const md = await fetchMetadataFromSeeds(umi, { mint });

console.log('mint:', mint);
console.log('name:', md.name);
console.log('symbol:', md.symbol);
console.log('uri:', md.uri);
console.log('updateAuthority:', md.updateAuthority);
console.log('isMutable:', md.isMutable);
console.log('creators:', JSON.stringify(md.creators));
