-- Add pHash column to verifications table
ALTER TABLE verifications 
ADD COLUMN IF NOT EXISTS phash VARCHAR(64);

-- Create index for faster searching
CREATE INDEX IF NOT EXISTS idx_verifications_phash 
ON verifications(phash) 
WHERE phash IS NOT NULL;

-- Add comment
COMMENT ON COLUMN verifications.phash IS 'Perceptual hash for finding similar images';
