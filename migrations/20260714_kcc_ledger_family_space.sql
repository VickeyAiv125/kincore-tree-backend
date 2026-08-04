-- Optional: add family attribution to existing kcc_ledger (run in Supabase SQL editor if column missing)
ALTER TABLE kcc_ledger
    ADD COLUMN IF NOT EXISTS family_space_id UUID REFERENCES family_spaces(id) ON DELETE SET NULL;

ALTER TABLE kcc_ledger
    ADD COLUMN IF NOT EXISTS external_transaction_id VARCHAR(255);

ALTER TABLE kcc_ledger
    ADD COLUMN IF NOT EXISTS external_reference VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_kcc_ledger_family_space_id ON kcc_ledger(family_space_id);
