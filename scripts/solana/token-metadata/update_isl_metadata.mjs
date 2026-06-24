// One-off: re-point the EXISTING ISL metadata at PERMANENT Arweave storage.
//
// Why this exists: the original set_isl_metadata.mjs uploaded the icon + JSON
// via *devnet* Irys (https://devnet.irys.xyz). Devnet Irys never settles data
// to the permanent Arweave network, so the on-chain `uri` (arweave.net/<id>)
// and the JSON's `image` (arweave.net/<id>) return HTML instead of the file —
// solscan/wallets can't render the icon. Only gateway.irys.xyz serves them.
//
// Fix: re-upload the SAME icon + JSON to *mainnet* Irys (real Arweave). Files
// under ~100 KiB upload for free; our icon is ~10 KB. The data then resolves on
// arweave.net permanently. The token stays on DEVNET — storage location and
// token cluster are independent. Finally updateMetadataAccountV2 swaps the
// on-chain uri to the new permanent URL (metadata isMutable=true).
//
//   node update_isl_metadata.mjs            # devnet token, mainnet-Irys storage
//
// Env overrides:
//   ISL_IRYS_MAINNET  default https://node1.irys.xyz             (mainnet Irys node)
//   ISL_MAINNET_RPC   default https://api.mainnet-beta.solana.com (Irys funding provider)
//   ISL_ALLOW_PAID=1  proceed even if the upload would cost mainnet SOL (>free tier)

import { Resvg } from '@resvg/resvg-js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createGenericFile,
  keypairIdentity,
  publicKey,
  none,
  some,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  updateMetadataAccountV2,
  fetchMetadataFromSeeds,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

import { resolveConfig } from './config.mjs';

// Off-chain JSON fields — kept identical to set_isl_metadata.mjs so nothing but
// the storage host (and thus the URLs) changes.
const TOKEN_NAME = 'Islume';
const TOKEN_SYMBOL = 'ISL';
const CREATOR_NAME = 'Hayden Yang';
const DESCRIPTION =
  'Islume — Agent 시대의 소셜 레이어. ISL is the in-app currency of Islume, ' +
  'minted on-chain as an SPL token on withdrawal.';
const EXTERNAL_URL = 'https://github.com/hyun-yang/Islume';

// 512x512 icon built from the brand mountain logo on a rounded white tile.
const ICON_SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#ffffff"/>
  <g transform="translate(86,101) scale(10)">
    <polygon points="17,2 3,29 17,20" fill="#2d5f8a"/>
    <polygon points="17,2 31,29 17,20" fill="#e07a52"/>
    <polygon points="3,29 31,29 17,20" fill="#7d9590"/>
  </g>
</svg>`;

const IRYS_MAINNET_NODE = process.env.ISL_IRYS_MAINNET || 'https://node1.irys.xyz';
const IRYS_PROVIDER_RPC = process.env.ISL_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';

function secretToBytes(secret) {
  // shared/solana.py accepts a 128-hex-char (64-byte) secret or a base58 string.
  if (secret.length === 128 && /^[0-9a-fA-F]+$/.test(secret)) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }
  return base58.serialize(secret); // base58 -> bytes
}

function formatAmount(amount) {
  return `${Number(amount.basisPoints) / 10 ** amount.decimals} ${amount.identifier}`;
}

async function main() {
  const cfg = resolveConfig({ needSecret: true });
  if (cfg.network !== 'devnet') {
    console.log(`[!] token RPC resolved to ${cfg.network} (${cfg.rpc}); this script is meant for the devnet token.`);
  }
  console.log(`[cfg] token RPC=${cfg.rpc}  storage=mainnet Irys (${IRYS_MAINNET_NODE}, provider ${IRYS_PROVIDER_RPC})`);
  console.log('[1/6] mint:', cfg.mint);

  // umi RPC = the TOKEN's cluster (devnet) for the on-chain write. The Irys
  // uploader targets MAINNET (permanent Arweave) via address + providerUrl,
  // independent of the umi RPC — storage location != token cluster.
  const umi = createUmi(cfg.rpc)
    .use(mplTokenMetadata())
    .use(irysUploader({ address: IRYS_MAINNET_NODE, providerUrl: IRYS_PROVIDER_RPC }));

  const keypair = umi.eddsa.createKeypairFromSecretKey(secretToBytes(cfg.secret));
  umi.use(keypairIdentity(keypair));
  const authority = umi.identity.publicKey;
  console.log('[2/6] update-authority / Irys identity:', authority);

  const png = new Resvg(ICON_SVG, { fitTo: { mode: 'width', value: 512 } })
    .render()
    .asPng();
  const imageFile = createGenericFile(png, 'isl.png', { contentType: 'image/png' });
  console.log(`[3/6] icon rasterized — ${png.length} bytes`);

  // Cost guard: our icon is ~10 KB, well under Irys's free (<100 KiB) tier. If
  // the node ever quotes a non-zero price, stop rather than silently spend
  // mainnet SOL the devnet authority may not even hold.
  const price = await umi.uploader.getUploadPrice([imageFile]);
  console.log('[3/6] quoted upload price:', formatAmount(price));
  if (price.basisPoints > 0n && process.env.ISL_ALLOW_PAID !== '1') {
    console.error('[x] Upload is NOT free — aborting. Re-run with ISL_ALLOW_PAID=1 to fund with mainnet SOL.');
    process.exit(1);
  }

  const [imageUri] = await umi.uploader.upload([imageFile]);
  console.log('[4/6] icon uploaded (permanent):', imageUri);

  const offchain = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: DESCRIPTION,
    image: imageUri,
    external_url: EXTERNAL_URL,
    attributes: [{ trait_type: 'Creator', value: CREATOR_NAME }],
    properties: {
      files: [{ uri: imageUri, type: 'image/png' }],
      category: 'image',
      creators: [{ address: authority, share: 100 }],
    },
  };
  const metadataUri = await umi.uploader.uploadJson(offchain);
  console.log('[5/6] metadata JSON uploaded (permanent):', metadataUri);

  // Metadata already exists -> updateMetadataAccountV2 (not createV3). Preserve
  // every existing field; swap only the uri. isMutable stays as-is (true).
  const mint = publicKey(cfg.mint);
  const md = await fetchMetadataFromSeeds(umi, { mint });
  console.log('[6/6] old uri:', md.uri);
  const { signature } = await updateMetadataAccountV2(umi, {
    metadata: findMetadataPda(umi, { mint }),
    updateAuthority: umi.identity,
    data: some({
      name: md.name,
      symbol: md.symbol,
      uri: metadataUri,
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
  console.log('\ndone. new on-chain uri:', metadataUri);
  console.log('signature:', sig);
  console.log('explorer:', `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log('verify:  node verify_isl_metadata.mjs');
  console.log('\nnote: arweave.net may take a few minutes to mirror the new upload;');
  console.log('      gateway.irys.xyz/<id> serves it immediately. Solscan may cache the old icon for a while.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
