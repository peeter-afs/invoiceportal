const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { computeFileHash, getStorageKey, saveFile } = require('../services/fileService');
const { processInvoice } = require('../services/extractionService');

// Use memory storage so we can compute the hash before writing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  },
});

// POST /api/upload  — upload a PDF invoice
router.post('/', auth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const buffer = req.file.buffer;
    const originalFilename = req.file.originalname || 'invoice.pdf';
    const fileHash = computeFileHash(buffer);

    // Duplicate detection within tenant
    const existing = await query(
      'SELECT id FROM invoices WHERE tenant_id = ? AND file_hash = ? LIMIT 1',
      [req.tenantId, fileHash]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'This PDF has already been uploaded',
        invoiceId: existing[0].id,
      });
    }

    const invoiceId = crypto.randomUUID();
    const storageKey = getStorageKey(req.tenantId, invoiceId, originalFilename);

    // Save PDF to storage (local disk or S3/R2)
    await saveFile(buffer, storageKey);

    // Create invoice record
    await query(
      `INSERT INTO invoices
         (id, tenant_id, status, source_type, file_hash, original_filename, created_by)
       VALUES (?, ?, 'queued', 'upload', ?, ?, ?)`,
      [invoiceId, req.tenantId, fileHash, originalFilename, req.userId]
    );

    // Create file record
    await query(
      `INSERT INTO invoice_files (id, invoice_id, storage_key, filename, mime, size_bytes)
       VALUES (?, ?, ?, ?, 'application/pdf', ?)`,
      [crypto.randomUUID(), invoiceId, storageKey, originalFilename, buffer.length]
    );

    // Kick off async processing (do not await)
    setImmediate(() => {
      processInvoice(invoiceId, buffer, originalFilename).catch((err) => {
        console.error(`processInvoice failed for ${invoiceId}:`, err.message);
      });
    });

    res.status(201).json({
      invoiceId,
      status: 'queued',
      message: 'Invoice uploaded and queued for processing',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handler for multer (file size / type)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF files are accepted') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
