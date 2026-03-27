"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
let RedisService = class RedisService {
    client;
    onModuleInit() {
        this.client = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379');
    }
    onModuleDestroy() {
        this.client.disconnect();
    }
    getClient() {
        return this.client;
    }
    async tryPlaceBid(auctionId, amount, userId) {
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
        const result = await this.client.eval(luaScript, 1, `auction:${auctionId}`, amount.toString(), userId);
        return result === 1;
    }
    async setAuctionPrice(auctionId, price) {
        await this.client.hset(`auction:${auctionId}`, 'currentPrice', price.toString());
    }
    async getAuctionPrice(auctionId) {
        const price = await this.client.hget(`auction:${auctionId}`, 'currentPrice');
        return price ? parseFloat(price) : null;
    }
    async setAuctionEndTime(auctionId, endTime) {
        await this.client.hset(`auction:${auctionId}`, 'endTime', endTime.getTime().toString());
    }
    async getAuctionEndTime(auctionId) {
        const endTime = await this.client.hget(`auction:${auctionId}`, 'endTime');
        return endTime ? parseInt(endTime) : null;
    }
    async deleteAuction(auctionId) {
        await this.client.del(`auction:${auctionId}`);
        await this.client.del(`auction:viewers:${auctionId}`);
    }
    async incrementViewers(auctionId) {
        const count = await this.client.incr(`auction:viewers:${auctionId}`);
        return count;
    }
    async decrementViewers(auctionId) {
        const count = await this.client.decr(`auction:viewers:${auctionId}`);
        if (count <= 0) {
            await this.client.del(`auction:viewers:${auctionId}`);
            return 0;
        }
        return count;
    }
    async getViewersCount(auctionId) {
        const count = await this.client.get(`auction:viewers:${auctionId}`);
        return count ? parseInt(count) : 0;
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = __decorate([
    (0, common_1.Injectable)()
], RedisService);
//# sourceMappingURL=redis.service.js.map