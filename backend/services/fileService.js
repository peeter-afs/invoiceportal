/**
 * fileService.js — Abstract file storage
 *
 * Supports two backends controlled by environment variables:
 *   LOCAL (default): files saved to backend/uploads/
 *   S3/R2: any S3-compatible store (AWS S3 or Cloudflare R2)
 *
 * Enable S3/R2 by setting S3_BUCKET in .env.
 * For Cloudflare R2, also set S3_ENDPOINT.
 * For AWS S3, omit S3_ENDPOINT (uses standard AWS endpoints).
 *
 * Env vars:
 *   S3_BUCKET              — bucket name (enables S3 mode when set)
 *   S3_REGION              — region (use "auto" for R2, e.g. "eu-west-1" for S3)
 *   S3_ACCESS_KEY_ID       — access key
 *   S3_SECRET_ACCESS_KEY   — secret key
 *   S3_ENDPOINT            — custom endpoint URL (Cloudflare R2 only)
 *   S3_PRESIGN_EXPIRY_SEC  — presigned URL TTL in seconds (default: 3600)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Local storage ────────────────────────────────────────────────────────────

const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');

function ensureLocalDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── S3 client (lazy-initialised) ─────────────────────────────────────────────

let _s3Client = null;

function getS3Client() {
  if (!_s3Client) {
    const config = {
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    };
    // Cloudflare R2 / MinIO / custom S3-compatible endpoint
    if (process.env.S3_ENDPOINT) {
      config.endpoint = process.env.S3_ENDPOINT;
      config.forcePathStyle = false;
    }
    _s3Client = new S3Client(config);
  }
  return _s3Client;
}

function isS3Mode() {
  return !!process.env.S3_BUCKET;
}

// ── Shared utilities ─────────────────────────────────────────────────────────

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getStorageKey(tenantId, invoiceId, filename) {
  const ext = path.extname(filename) || '.pdf';
  // Use forward slashes (S3 key convention, also works for local)
  return `${tenantId}/${invoiceId}${ext}`;
}

// ── Storage operations ───────────────────────────────────────────────────────

/**
 * Save a file buffer under the given storage key.
 */
async function saveFile(buffer, storageKey) {
  if (isS3Mode()) {
    await getS3Client().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: 'application/pdf',
    }));
  } else {
    const fullPath = path.join(UPLOADS_BASE, storageKey.replace(/\//g, path.sep));
    ensureLocalDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, buffer);
  }
  return storageKey;
}

/**
 * Read a file as a Buffer.
 */
async function readFile(storageKey) {
  if (isS3Mode()) {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey,
    }));
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } else {
    return fs.readFileSync(path.join(UPLOADS_BASE, storageKey.replace(/\//g, path.sep)));
  }
}

/**
 * Check if a file exists.
 */
async function fileExists(storageKey) {
  if (isS3Mode()) {
    try {
      await getS3Client().send(new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
      }));
      return true;
    } catch {
      return false;
    }
  } else {
    return fs.existsSync(path.join(UPLOADS_BASE, storageKey.replace(/\//g, path.sep)));
  }
}

/**
 * Delete a file.
 */
async function deleteFile(storageKey) {
  if (isS3Mode()) {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: storageKey,
    }));
  } else {
    const fullPath = path.join(UPLOADS_BASE, storageKey.replace(/\//g, path.sep));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
}

/**
 * Get a temporary presigned download URL (S3/R2 mode only).
 * Returns null in local mode — caller should stream via readFile() instead.
 */
async function getPresignedUrl(storageKey) {
  if (!isS3Mode()) return null;
  const expiresIn = parseInt(process.env.S3_PRESIGN_EXPIRY_SEC, 10) || 3600;
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: storageKey }),
    { expiresIn }
  );
}

module.exports = {
  computeFileHash,
  getStorageKey,
  saveFile,
  readFile,
  fileExists,
  deleteFile,
  getPresignedUrl,
  isS3Mode,
};
