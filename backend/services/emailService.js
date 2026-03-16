const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { query } = require('../db');
const { computeFileHash, getStorageKey, saveFile } = require('./fileService');
const { processInvoice } = require('./extractionService');

// ---------------------------------------------------------------------------
// Password encryption (AES-256-GCM, key derived from SESSION_SECRET)
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = 'invoiceportal-email-enc'; // static salt, per-install key via SESSION_SECRET

function deriveKey() {
  const secret = process.env.SESSION_SECRET || 'change-this-session-secret';
  return crypto.pbkdf2Sync(secret, SALT, 100000, KEY_LENGTH, 'sha256');
}

function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  });
}

function decryptPassword(encJson) {
  const key = deriveKey();
  const { iv, tag, ciphertext } = JSON.parse(encJson);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64'),
    { authTagLength: TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(ciphertext, 'base64')) + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// IMAP helpers
// ---------------------------------------------------------------------------

function buildImapConfig(inbox, password) {
  return {
    host: inbox.imap_host,
    port: inbox.imap_port || 993,
    secure: inbox.imap_tls !== 0,
    auth: {
      user: inbox.imap_user,
      pass: password,
    },
    logger: false,
  };
}

/**
 * Test an IMAP connection. Returns { success, folders?, error? }.
 */
async function testConnection(config) {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort || 993,
    secure: config.imapTls !== false,
    auth: {
      user: config.imapUser,
      pass: config.imapPassword,
    },
    logger: false,
  });

  try {
    await client.connect();
    const folders = [];
    const tree = await client.list();
    for (const folder of tree) {
      folders.push(folder.path);
    }
    await client.logout();
    return { success: true, folders };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Email → Invoice pipeline
// ---------------------------------------------------------------------------

async function processEmail(message, tenantId, inboxId) {
  const parsed = await simpleParser(message.source);

  const sourceMeta = {
    from: parsed.from?.text || null,
    subject: parsed.subject || null,
    date: parsed.date?.toISOString() || null,
    messageId: parsed.messageId || null,
    inboxId,
  };

  const pdfAttachments = (parsed.attachments || []).filter(
    (att) => att.contentType === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'))
  );

  if (pdfAttachments.length === 0) {
    return { skipped: true, reason: 'no PDF attachments' };
  }

  const results = [];

  for (const attachment of pdfAttachments) {
    const buffer = attachment.content;
    const filename = attachment.filename || 'email-attachment.pdf';
    const fileHash = computeFileHash(buffer);

    // Duplicate detection within tenant
    const existing = await query(
      'SELECT id FROM invoices WHERE tenant_id = ? AND file_hash = ? LIMIT 1',
      [tenantId, fileHash]
    );
    if (existing.length > 0) {
      results.push({ filename, skipped: true, reason: 'duplicate', existingId: existing[0].id });
      continue;
    }

    const invoiceId = crypto.randomUUID();
    const storageKey = getStorageKey(tenantId, invoiceId, filename);

    // Save PDF to storage (local disk or S3/R2)
    await saveFile(buffer, storageKey);

    // Create invoice record
    await query(
      `INSERT INTO invoices
         (id, tenant_id, status, source_type, source_ref, source_meta, file_hash, original_filename)
       VALUES (?, ?, 'queued', 'email', ?, ?, ?, ?)`,
      [
        invoiceId,
        tenantId,
        sourceMeta.messageId || null,
        JSON.stringify(sourceMeta),
        fileHash,
        filename,
      ]
    );

    // Create file record
    await query(
      `INSERT INTO invoice_files (id, invoice_id, storage_key, filename, mime, size_bytes)
       VALUES (?, ?, ?, ?, 'application/pdf', ?)`,
      [crypto.randomUUID(), invoiceId, storageKey, filename, buffer.length]
    );

    // Kick off async processing
    setImmediate(() => {
      processInvoice(invoiceId, buffer, filename).catch((err) => {
        console.error(`[email] processInvoice failed for ${invoiceId}:`, err.message);
      });
    });

    results.push({ filename, invoiceId, status: 'queued' });
  }

  return { results };
}

// ---------------------------------------------------------------------------
// Poll a single inbox
// ---------------------------------------------------------------------------

async function pollInbox(inbox) {
  let password;
  try {
    password = decryptPassword(inbox.imap_password_enc);
  } catch (err) {
    console.error(`[email] Failed to decrypt password for inbox ${inbox.id}:`, err.message);
    return { error: 'decryption_failed' };
  }

  const client = new ImapFlow(buildImapConfig(inbox, password));
  const results = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock(inbox.folder || 'INBOX');

    try {
      // Build search criteria: messages with UID greater than last processed
      const searchCriteria = inbox.last_uid
        ? { uid: `${inbox.last_uid + 1}:*` }
        : { all: true };

      let maxUid = inbox.last_uid || 0;

      for await (const message of client.fetch(searchCriteria, { source: true, uid: true })) {
        // ImapFlow may return the last_uid message itself when using uid range
        if (inbox.last_uid && message.uid <= inbox.last_uid) {
          continue;
        }

        try {
          const result = await processEmail(message, inbox.tenant_id, inbox.id);
          results.push({ uid: message.uid, ...result });
        } catch (err) {
          console.error(`[email] Error processing message UID ${message.uid}:`, err.message);
          results.push({ uid: message.uid, error: err.message });
        }

        if (message.uid > maxUid) {
          maxUid = message.uid;
        }
      }

      // Update last_uid
      if (maxUid > (inbox.last_uid || 0)) {
        await query(
          'UPDATE email_inboxes SET last_uid = ? WHERE id = ?',
          [maxUid, inbox.id]
        );
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error(`[email] IMAP error for inbox ${inbox.id}:`, err.message);
    return { error: err.message, results };
  }

  return { success: true, messagesProcessed: results.length, results };
}

// ---------------------------------------------------------------------------
// Poll all enabled inboxes
// ---------------------------------------------------------------------------

async function pollAllInboxes() {
  try {
    // Check if email_inboxes table exists (migration may not have run yet)
    try {
      await query('SELECT 1 FROM email_inboxes LIMIT 1');
    } catch {
      return; // table doesn't exist, skip silently
    }

    const inboxes = await query(
      'SELECT * FROM email_inboxes WHERE enabled = 1'
    );

    if (inboxes.length === 0) return;

    console.log(`[email] Polling ${inboxes.length} inbox(es)...`);

    for (const inbox of inboxes) {
      try {
        const result = await pollInbox(inbox);
        if (result.error) {
          console.error(`[email] Inbox ${inbox.id} poll error:`, result.error);
        } else if (result.messagesProcessed > 0) {
          console.log(`[email] Inbox ${inbox.id}: processed ${result.messagesProcessed} message(s)`);
        }
      } catch (err) {
        console.error(`[email] Unexpected error polling inbox ${inbox.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[email] Failed to fetch inboxes:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Inbox CRUD helpers
// ---------------------------------------------------------------------------

async function getInboxForTenant(tenantId) {
  const rows = await query(
    'SELECT * FROM email_inboxes WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

async function upsertInbox(tenantId, config) {
  const existing = await getInboxForTenant(tenantId);
  const encPassword = config.imapPassword
    ? encryptPassword(config.imapPassword)
    : (existing ? existing.imap_password_enc : null);

  if (!encPassword) {
    throw new Error('IMAP password is required');
  }

  if (existing) {
    await query(
      `UPDATE email_inboxes SET
         enabled = ?, folder = ?, imap_host = ?, imap_port = ?,
         imap_tls = ?, imap_user = ?, imap_password_enc = ?
       WHERE id = ?`,
      [
        config.enabled ? 1 : 0,
        config.folder || 'INBOX',
        config.imapHost,
        config.imapPort || 993,
        config.imapTls !== false ? 1 : 0,
        config.imapUser,
        encPassword,
        existing.id,
      ]
    );
    return existing.id;
  } else {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO email_inboxes
         (id, tenant_id, enabled, folder, imap_host, imap_port, imap_tls, imap_user, imap_password_enc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        config.enabled ? 1 : 0,
        config.folder || 'INBOX',
        config.imapHost,
        config.imapPort || 993,
        config.imapTls !== false ? 1 : 0,
        config.imapUser,
        encPassword,
      ]
    );
    return id;
  }
}

async function deleteInbox(tenantId) {
  await query('DELETE FROM email_inboxes WHERE tenant_id = ?', [tenantId]);
}

// ---------------------------------------------------------------------------
// Polling scheduler
// ---------------------------------------------------------------------------

let pollIntervalHandle = null;

function startPollingScheduler() {
  if (process.env.EMAIL_POLL_ENABLED === 'false') {
    console.log('[email] Polling disabled (EMAIL_POLL_ENABLED=false)');
    return;
  }

  const intervalMs = parseInt(process.env.EMAIL_POLL_INTERVAL_MS, 10) || 300000; // 5 min default
  console.log(`[email] Starting polling scheduler (interval: ${intervalMs / 1000}s)`);

  // Delay first poll to let DB connections settle
  setTimeout(() => pollAllInboxes().catch(() => {}), 30000);

  pollIntervalHandle = setInterval(() => pollAllInboxes().catch(() => {}), intervalMs);
}

function stopPollingScheduler() {
  if (pollIntervalHandle) {
    clearInterval(pollIntervalHandle);
    pollIntervalHandle = null;
  }
}

module.exports = {
  encryptPassword,
  decryptPassword,
  testConnection,
  pollInbox,
  pollAllInboxes,
  getInboxForTenant,
  upsertInbox,
  deleteInbox,
  startPollingScheduler,
  stopPollingScheduler,
};
