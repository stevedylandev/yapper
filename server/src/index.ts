// src/index.ts - Cloudflare Worker (API only, no stream processing)
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { D1Database } from "@cloudflare/workers-types";

type Bindings = {
	DB: D1Database;
	NEYNAR_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

async function recordCast(db: D1Database, fid: number, timestamp?: number) {
	const now = timestamp || Date.now();
	const hourBucket = Math.floor(now / (1000 * 60 * 60));

	await db
		.prepare(`
    INSERT INTO cast_counts (fid, cast_time, hour_bucket)
    VALUES (?, ?, ?)
    ON CONFLICT(fid, hour_bucket) DO UPDATE SET cast_time = ?
  `)
		.bind(fid, now, hourBucket, now)
		.run();
}

async function cleanOldCasts(db: D1Database) {
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	await db
		.prepare(`
    DELETE FROM cast_counts WHERE cast_time < ?
  `)
		.bind(cutoff)
		.run();
}

async function getMostActiveCasters(db: D1Database, limit = 10) {
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;

	const result = await db
		.prepare(`
    SELECT
      cc.fid,
      COUNT(*) as cast_count,
      uc.username,
      uc.display_name,
      MAX(cc.cast_time) as last_cast_time
    FROM cast_counts cc
    LEFT JOIN user_cache uc ON cc.fid = uc.fid
    WHERE cc.cast_time > ?
    GROUP BY cc.fid
    ORDER BY cast_count DESC
    LIMIT ?
  `)
		.bind(cutoff, limit)
		.all();

	return result.results;
}

// API Routes
app.get("/api/most-active", async (c) => {
	try {
		const limit = parseInt(c.req.query("limit") || "10");
		const results = await getMostActiveCasters(c.env.DB, limit);

		return c.json({
			success: true,
			data: results,
			timestamp: Date.now(),
			period: "24 hours",
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				error: error.message,
			},
			500,
		);
	}
});

app.get("/api/user/:fid/stats", async (c) => {
	try {
		const fid = parseInt(c.req.param("fid"));
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;

		const result = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as cast_count,
        MIN(cast_time) as first_cast_time,
        MAX(cast_time) as last_cast_time
      FROM cast_counts
      WHERE fid = ? AND cast_time > ?
    `)
			.bind(fid, cutoff)
			.first();

		return c.json({
			success: true,
			fid,
			data: result,
			period: "24 hours",
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				error: error.message,
			},
			500,
		);
	}
});

app.get("/api/stats", async (c) => {
	try {
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;

		const totalCasts = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM cast_counts WHERE cast_time > ?
    `)
			.bind(cutoff)
			.first();

		const uniqueUsers = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT fid) as unique_users FROM cast_counts WHERE cast_time > ?
    `)
			.bind(cutoff)
			.first();

		return c.json({
			success: true,
			data: {
				total_casts: totalCasts.total,
				unique_users: uniqueUsers.unique_users,
				period: "24 hours",
			},
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				error: error.message,
			},
			500,
		);
	}
});

// Batch processing endpoint for external stream processor
app.post("/api/batch-casts", async (c) => {
	try {
		const { casts } = await c.req.json();

		if (!Array.isArray(casts)) {
			return c.json(
				{
					success: false,
					error: "Invalid casts data",
				},
				400,
			);
		}

		// Process each cast in the batch
		for (const cast of casts) {
			await recordCast(c.env.DB, cast.fid, cast.timestamp);
		}

		// Periodic cleanup
		if (Math.random() < 0.01) {
			await cleanOldCasts(c.env.DB);
		}

		return c.json({
			success: true,
			processed: casts.length,
			timestamp: Date.now(),
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				error: error.message,
			},
			500,
		);
	}
});

// Add single cast (for testing)
app.post("/api/cast", async (c) => {
	try {
		const { fid, timestamp } = await c.req.json();

		if (!fid) {
			return c.json(
				{
					success: false,
					error: "fid is required",
				},
				400,
			);
		}

		await recordCast(c.env.DB, fid, timestamp);

		return c.json({
			success: true,
			fid,
			timestamp: timestamp || Date.now(),
		});
	} catch (error) {
		return c.json(
			{
				success: false,
				error: error.message,
			},
			500,
		);
	}
});

app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: Date.now() });
});

export default app;
