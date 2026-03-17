-- Per-supplier extraction instructions
ALTER TABLE suppliers
  ADD COLUMN extraction_instructions TEXT NULL AFTER futursoft_supplier_nr;

-- Extraction samples (reference PDFs with correct extraction results)
CREATE TABLE extraction_samples (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  supplier_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NULL,
  storage_key VARCHAR(1024) NOT NULL,
  extracted_json LONGTEXT NOT NULL,
  notes VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_extraction_samples_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  CONSTRAINT fk_extraction_samples_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  INDEX idx_extraction_samples_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extraction duration tracking
ALTER TABLE invoices
  ADD COLUMN extraction_duration_ms INT NULL AFTER math_corrections;
