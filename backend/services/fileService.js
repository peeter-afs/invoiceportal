const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');

function getTenantUploadDir(tenantId) {
  return path.join(UPLOADS_BASE, tenantId);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getStorageKey(tenantId, invoiceId, filename) {
  const ext = path.extname(filename) || '.pdf';
  return path.join(tenantId, `${invoiceId}${ext}`);
}

function getAbsolutePath(storageKey) {
  return path.join(UPLOADS_BASE, storageKey);
}

function saveFile(buffer, storageKey) {
  const fullPath = getAbsolutePath(storageKey);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

function readFile(storageKey) {
  const fullPath = getAbsolutePath(storageKey);
  return fs.readFileSync(fullPath);
}

function fileExists(storageKey) {
  return fs.existsSync(getAbsolutePath(storageKey));
}

module.exports = {
  computeFileHash,
  getStorageKey,
  getAbsolutePath,
  saveFile,
  readFile,
  fileExists,
  getTenantUploadDir,
};
