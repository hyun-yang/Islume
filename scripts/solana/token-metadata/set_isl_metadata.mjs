// One-off: attach Metaplex Token Metadata to the existing ISL SPL mint.
//
// Adds name="Islume", symbol="ISL", an on-chain creator (the mint authority,
// labelled "Hayden Yang" in the off-chain JSON), and a PNG icon rasterized from
// the brand SVG. The icon + JSON are uploaded to Arweave via Irys; only the
// resulting metadata URI is written on-chain (createMetadataAccountV3).
//
// Defaults to devnet, reading SOLANA_ISL_MINT + SOLANA_MINT_AUTHORITY_SECRET
// from the repo .env (secret never touches shell history). For mainnet, pass
// --network mainnet and override the mint/secret/RPC via env (see config.mjs)
// so the devnet .env stays untouched:
//
//   # devnet (default)
//   node set_isl_metadata.mjs
//
//   # mainnet (real SOL for ATA rent + Irys upload; irreversible on-chain write)
//   ISL_MINT=<mainnet_mint> \
//   ISL_MINT_AUTHORITY_SECRET=<mainnet_secret> \
//   ISL_RPC_URL=<paid_mainnet_rpc>   # optional; default api.mainnet-beta
//   node set_isl_metadata.mjs --network mainnet

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
  createMetadataAccountV3,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

import { resolveConfig } from './config.mjs';

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

function secretToBytes(secret) {
  // shared/solana.py accepts a 128-hex-char (64-byte) secret or a base58 string.
  if (secret.length === 128 && /^[0-9a-fA-F]+$/.test(secret)) {
    return Uint8Array.from(Buffer.from(secret, 'hex'));
  }
  return base58.serialize(secret); // base58 -> bytes
}

async function main() {
  const cfg = resolveConfig({ needSecret: true });
  console.log(`[cfg] network=${cfg.network} rpc=${cfg.rpc} irys=${cfg.irys}`);
  console.log('[1/6] mint:', cfg.mint);
  if (cfg.network === 'mainnet') {
    console.log('[!] MAINNET — spends REAL SOL (ATA rent + Irys upload); the on-chain write is irreversible.');
  }

  const umi = createUmi(cfg.rpc)
    .use(mplTokenMetadata())
    .use(irysUploader({ address: cfg.irys }));

  const keypair = umi.eddsa.createKeypairFromSecretKey(secretToBytes(cfg.secret));
  umi.use(keypairIdentity(keypair));
  const authority = umi.identity.publicKey;
  console.log('[2/6] authority / update-authority:', authority);

  const png = new Resvg(ICON_SVG, { fitTo: { mode: 'width', value: 512 } })
    .render()
    .asPng();
  console.log(`[3/6] icon rasterized — ${png.length} bytes`);

  const imageFile = createGenericFile(png, 'isl.png', { contentType: 'image/png' });
  const [imageUri] = await umi.uploader.upload([imageFile]);
  console.log('[4/6] icon uploaded:', imageUri);

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
  console.log('[5/6] metadata JSON uploaded:', metadataUri);

  const mint = publicKey(cfg.mint);
  const { signature } = await createMetadataAccountV3(umi, {
    metadata: findMetadataPda(umi, { mint }),
    mint,
    mintAuthority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    data: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: metadataUri,
      sellerFeeBasisPoints: 0,
      // authority signs this tx, so it can self-verify as a creator
      creators: some([{ address: authority, verified: true, share: 100 }]),
      collection: none(),
      uses: none(),
    },
    isMutable: true,
    collectionDetails: none(),
  }).sendAndConfirm(umi);

  const sig = base58.deserialize(signature)[0];
  console.log('[6/6] metadata account created.');
  console.log('signature:', sig);
  console.log('explorer:', `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
