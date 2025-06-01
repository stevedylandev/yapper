// stream.ts - Simple stream processor for Railway
import {
	createDefaultMetadataKeyInterceptor,
	getSSLHubRpcClient,
	HubEventType,
} from "@farcaster/hub-nodejs";

const WORKER_URL = process.env.WORKER_URL || "https://your-worker.workers.dev";
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const BATCH_SIZE = 20;
const BATCH_TIMEOUT = 5000;

if (!NEYNAR_API_KEY) {
	console.error("❌ NEYNAR_API_KEY environment variable is required");
	process.exit(1);
}

interface CastEvent {
	fid: number;
	timestamp: number;
}

class SimpleBatcher {
	private batch: CastEvent[] = [];
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private batchSize = BATCH_SIZE,
		private timeout = BATCH_TIMEOUT,
	) {}

	add(cast: CastEvent) {
		this.batch.push(cast);

		if (this.batch.length >= this.batchSize) {
			this.flush();
		} else {
			this.resetTimer();
		}
	}

	private resetTimer() {
		if (this.timer) clearTimeout(this.timer);

		if (this.batch.length > 0) {
			this.timer = setTimeout(() => this.flush(), this.timeout);
		}
	}

	async flush() {
		if (this.batch.length === 0) return;

		const batchToSend = [...this.batch];
		this.batch = [];

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		try {
			const response = await fetch(`${WORKER_URL}/api/batch-casts`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ casts: batchToSend }),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			console.log(`✅ Sent ${batchToSend.length} casts`);
		} catch (error) {
			console.error("❌ Failed to send batch:", error);
			// Add back to batch for retry (simple retry logic)
			this.batch.unshift(...batchToSend.slice(0, 10)); // Keep only 10 for retry
		}
	}
}

async function startStream() {
	console.log("🚀 Starting Farcaster stream processor");
	console.log(`📡 Worker URL: ${WORKER_URL}`);

	const batcher = new SimpleBatcher();

	// Graceful shutdown
	process.on("SIGINT", async () => {
		console.log("\n🛑 Shutting down...");
		await batcher.flush();
		process.exit(0);
	});

	while (true) {
		try {
			const client = getSSLHubRpcClient("hub-grpc-api.neynar.com", {
				interceptors: [
					createDefaultMetadataKeyInterceptor("x-api-key", NEYNAR_API_KEY),
				],
				"grpc.max_receive_message_length": 20 * 1024 * 1024,
			});

			await new Promise<void>((resolve, reject) => {
				client.$.waitForReady(Date.now() + 10000, async (e) => {
					if (e) {
						reject(e);
						return;
					}

					console.log("✅ Connected to Farcaster hub");

					try {
						const subscribeResult = await client.subscribe({
							eventTypes: [HubEventType.MERGE_MESSAGE],
						});

						if (subscribeResult.isOk()) {
							const stream = subscribeResult.value;
							let castCount = 0;

							console.log("📡 Listening for casts...");

							for await (const event of stream) {
								if (event.mergeMessageBody?.message?.data?.type === 1) {
									const fid = event.mergeMessageBody.message.data.fid;
									batcher.add({ fid, timestamp: Date.now() });
									castCount++;

									if (castCount % 100 === 0) {
										console.log(`📊 Processed ${castCount} casts`);
									}
								}
							}
						} else {
							reject(new Error("Failed to subscribe"));
						}
					} catch (error) {
						reject(error);
					} finally {
						client.close();
					}
				});
			});
		} catch (error) {
			console.error("❌ Connection error:", error);
			console.log("⏳ Reconnecting in 10 seconds...");
			await new Promise((resolve) => setTimeout(resolve, 10000));
		}
	}
}

startStream().catch((error) => {
	console.error("💥 Fatal error:", error);
	process.exit(1);
});
