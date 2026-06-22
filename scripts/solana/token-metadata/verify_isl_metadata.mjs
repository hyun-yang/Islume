// Read back the on-chain Metaplex metadata for the ISL mint and print it.
//
//   node verify_isl_metadata.mjs                      # devnet (.env mint)
//   ISL_MINT=<mainnet_mint> node verify_isl_metadata.mjs --network mainnet

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

import { resolveConfig } from './config.mjs';

const cfg = resolveConfig();
const mint = publicKey(cfg.mint);

const umi = createUmi(cfg.rpc).use(mplTokenMetadata());
const md = await fetchMetadataFromSeeds(umi, { mint });

console.log(`network: ${cfg.network}  rpc: ${cfg.rpc}`);
console.log('mint:', mint);
console.log('name:', md.name);
console.log('symbol:', md.symbol);
console.log('uri:', md.uri);
console.log('updateAuthority:', md.updateAuthority);
console.log('isMutable:', md.isMutable);
console.log('creators:', JSON.stringify(md.creators));
