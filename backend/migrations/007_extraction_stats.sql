-- Add extraction statistics columns to invoices
ALTER TABLE invoices
  ADD COLUMN extraction_model VARCHAR(64) NULL AFTER error_message,
  ADD COLUMN extraction_retried TINYINT(1) NOT NULL DEFAULT 0 AFTER extraction_model,
  ADD COLUMN math_corrections INT NOT NULL DEFAULT 0 AFTER extraction_retried;
