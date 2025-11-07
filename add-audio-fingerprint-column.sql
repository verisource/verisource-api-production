-- Add audio_fingerprint column to verifications table
ALTER TABLE verifications 
ADD COLUMN IF NOT EXISTS audio_fingerprint TEXT;

-- Create index for faster audio fingerprint searches
CREATE INDEX IF NOT EXISTS idx_audio_fingerprint 
ON verifications(audio_fingerprint) 
WHERE audio_fingerprint IS NOT NULL;
