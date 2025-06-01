-- schema.sql - Main database schema
-- Cast counts table with rolling 24h window
CREATE TABLE IF NOT EXISTS cast_counts (
    fid INTEGER NOT NULL,
    cast_time INTEGER NOT NULL, -- Unix timestamp in milliseconds
    hour_bucket INTEGER NOT NULL, -- Hour bucket for efficient grouping
    PRIMARY KEY (fid, hour_bucket)
);

-- Index for efficient time-based queries
CREATE INDEX IF NOT EXISTS idx_cast_time ON cast_counts(cast_time);
CREATE INDEX IF NOT EXISTS idx_hour_bucket ON cast_counts(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_fid_time ON cast_counts(fid, cast_time);

-- User cache table for storing user profile information
CREATE TABLE IF NOT EXISTS user_cache (
    fid INTEGER PRIMARY KEY,
    username TEXT,
    display_name TEXT,
    pfp_url TEXT,
    follower_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL, -- When this cache entry was last updated
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for efficient username lookups
CREATE INDEX IF NOT EXISTS idx_username ON user_cache(username);
CREATE INDEX IF NOT EXISTS idx_updated_at ON user_cache(updated_at);

-- Following relationships table (optional - for future use)
CREATE TABLE IF NOT EXISTS follows (
    follower_fid INTEGER NOT NULL,
    following_fid INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (follower_fid, following_fid)
);

CREATE INDEX IF NOT EXISTS idx_follower ON follows(follower_fid);
CREATE INDEX IF NOT EXISTS idx_following ON follows(following_fid);

-- Cast details table (optional - for storing cast content)
CREATE TABLE IF NOT EXISTS casts (
    hash TEXT PRIMARY KEY,
    fid INTEGER NOT NULL,
    text TEXT,
    timestamp INTEGER NOT NULL,
    parent_hash TEXT,
    parent_url TEXT,
    thread_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_cast_fid ON casts(fid);
CREATE INDEX IF NOT EXISTS idx_cast_timestamp ON casts(timestamp);
CREATE INDEX IF NOT EXISTS idx_cast_thread ON casts(thread_hash);

-- View for most active users in last 24 hours
CREATE VIEW IF NOT EXISTS most_active_24h AS
SELECT
    cc.fid,
    COUNT(*) as cast_count,
    uc.username,
    uc.display_name,
    uc.pfp_url,
    uc.follower_count,
    MAX(cc.cast_time) as last_cast_time,
    MIN(cc.cast_time) as first_cast_time
FROM cast_counts cc
LEFT JOIN user_cache uc ON cc.fid = uc.fid
WHERE cc.cast_time > (strftime('%s', 'now') * 1000 - 24 * 60 * 60 * 1000)
GROUP BY cc.fid, uc.username, uc.display_name, uc.pfp_url, uc.follower_count
ORDER BY cast_count DESC;
