-- Approval gate for player-reported results; pending rows haven't had points applied yet.
ALTER TABLE pairings
  ADD COLUMN result_status VARCHAR(20) NOT NULL DEFAULT 'confirmed' AFTER result;
