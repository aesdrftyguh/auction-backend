import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis;

    onModuleInit() {
        this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    }

    onModuleDestroy() {
        this.client.disconnect();
    }

    getClient(): Redis {
        return this.client;
    }

    /**
     * Atomically try to place a bid. Returns true if bid is accepted (higher than current).
     * Uses a Lua script for atomicity — no race conditions possible.
     */
    async tryPlaceBid(auctionId: string, amount: number, userId: string): Promise<boolean> {
        const luaScript = `
      local key = KEYS[1]
      local newAmount = tonumber(ARGV[1])
      local userId = ARGV[2]
      local currentAmount = tonumber(redis.call('HGET', key, 'currentPrice'))
      if currentAmount == nil or newAmount > currentAmount then
        redis.call('HSET', key, 'currentPrice', ARGV[1])
        redis.call('HSET', key, 'leaderId', userId)
        return 1
      end
      return 0
    `;

        const result = await this.client.eval(
            luaScript,
            1,
            `auction:${auctionId}`,
            amount.toString(),
            userId,
        );

        return result === 1;
    }

    async setAuctionPrice(auctionId: string, price: number): Promise<void> {
        await this.client.hset(`auction:${auctionId}`, 'currentPrice', price.toString());
    }

    async getAuctionPrice(auctionId: string): Promise<number | null> {
        const price = await this.client.hget(`auction:${auctionId}`, 'currentPrice');
        return price ? parseFloat(price) : null;
    }

    async setAuctionEndTime(auctionId: string, endTime: Date): Promise<void> {
        await this.client.hset(`auction:${auctionId}`, 'endTime', endTime.getTime().toString());
    }

    async getAuctionEndTime(auctionId: string): Promise<number | null> {
        const endTime = await this.client.hget(`auction:${auctionId}`, 'endTime');
        return endTime ? parseInt(endTime) : null;
    }

    async deleteAuction(auctionId: string): Promise<void> {
        await this.client.del(`auction:${auctionId}`);
        await this.client.del(`auction:viewers:${auctionId}`);
    }

    // ── Live Presence: Viewer Counters ───────────────────────────────
    async incrementViewers(auctionId: string): Promise<number> {
        const count = await this.client.incr(`auction:viewers:${auctionId}`);
        return count;
    }

    async decrementViewers(auctionId: string): Promise<number> {
        const count = await this.client.decr(`auction:viewers:${auctionId}`);
        if (count <= 0) {
            await this.client.del(`auction:viewers:${auctionId}`);
            return 0;
        }
        return count;
    }

    async getViewersCount(auctionId: string): Promise<number> {
        const count = await this.client.get(`auction:viewers:${auctionId}`);
        return count ? parseInt(count) : 0;
    }
}

