// Update ONLY the on-chain `uri` of the ISL metadata, preserving every other
// field. Devnet token by default (reads .env). Used to point the token at
// externally-hosted metadata (e.g. GitHub/jsdelivr) without re-uploading.
//
//   ISL_NEW_URI="https://cdn.jsdelivr.net/gh/.../metadata.json" node set_isl_uri.mjs
//   node set_isl_uri.mjs --uri "https://..."
//   ISL_MINT=<mainnet_mint> node set_isl_uri.mjs --network mainnet --uri "https://..."

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, none, some } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  updateMetadataAccountV2,
  fetchMetadataFromSeeds,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

import { resolveConfig } from './config.mjs';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function secretToBytes(secret) {
  if (secret.length === 128 && /^[0-9a-fA-F]+$/.test(secret)) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }
  return base58.serialize(secret);
}

const newUri = process.env.ISL_NEW_URI || argValue('--uri');
if (!newUri) {
  console.error('missing uri — set ISL_NEW_URI or pass --uri <url>');
  process.exit(1);
}

const cfg = resolveConfig({ needSecret: true });
const umi = createUmi(cfg.rpc).use(mplTokenMetadata());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secretToBytes(cfg.secret))));

const mint = publicKey(cfg.mint);
const md = await fetchMetadataFromSeeds(umi, { mint });
console.log('network:', cfg.network, '| mint:', cfg.mint);
console.log('old uri:', md.uri);
console.log('new uri:', newUri);

const { signature } = await updateMetadataAccountV2(umi, {
  metadata: findMetadataPda(umi, { mint }),
  updateAuthority: umi.identity,
  data: some({
    name: md.name,
    symbol: md.symbol,
    uri: newUri,
    sellerFeeBasisPoints: md.sellerFeeBasisPoints,
    creators: md.creators,
    collection: md.collection,
    uses: md.uses,
  }),
  newUpdateAuthority: none(),
  primarySaleHappened: none(),
  isMutable: none(),
}).sendAndConfirm(umi);

const sig = base58.deserialize(signature)[0];
console.log('done. signature:', sig);
console.log('explorer:', `https://explorer.solana.com/tx/${sig}?cluster=${cfg.network}`);
