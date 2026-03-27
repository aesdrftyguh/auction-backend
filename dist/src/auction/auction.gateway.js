"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuctionGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuctionGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const auction_service_1 = require("./auction.service");
const redis_service_1 = require("../redis/redis.service");
let AuctionGateway = AuctionGateway_1 = class AuctionGateway {
    auctionService;
    jwtService;
    redisService;
    server;
    logger = new common_1.Logger(AuctionGateway_1.name);
    connectedClients = new Map();
    auctionTimers = new Map();
    constructor(auctionService, jwtService, redisService) {
        this.auctionService = auctionService;
        this.jwtService = jwtService;
        this.redisService = redisService;
    }
    async handleConnection(client) {
        this.logger.log(`Client connected: ${client.id}`);
        this.connectedClients.set(client.id, {});
    }
    async handleDisconnect(client) {
        this.logger.log(`Client disconnected: ${client.id}`);
        const info = this.connectedClients.get(client.id);
        if (info?.auctionId) {
            client.leave(`auction:${info.auctionId}`);
            const count = await this.redisService.decrementViewers(info.auctionId);
            this.server.to(`auction:${info.auctionId}`).emit('viewers_count_updated', {
                auctionId: info.auctionId,
                count,
            });
        }
        this.connectedClients.delete(client.id);
    }
    async handleAuth(client, data) {
        try {
            const payload = this.jwtService.verify(data.token);
            const info = this.connectedClients.get(client.id) || {};
            info.userId = payload.sub;
            this.connectedClients.set(client.id, info);
            client.emit('authenticated', { userId: payload.sub });
            this.logger.log(`Client ${client.id} authenticated as user ${payload.sub}`);
        }
        catch {
            client.emit('error', { message: 'Authentication failed' });
        }
    }
    async handleJoinAuction(client, data) {
        const { auctionId } = data;
        try {
            const auction = await this.auctionService.getAuctionById(auctionId);
            const info = this.connectedClients.get(client.id) || {};
            if (info.auctionId && info.auctionId !== auctionId) {
                client.leave(`auction:${info.auctionId}`);
                const prevCount = await this.redisService.decrementViewers(info.auctionId);
                this.server.to(`auction:${info.auctionId}`).emit('viewers_count_updated', {
                    auctionId: info.auctionId,
                    count: prevCount,
                });
            }
            info.auctionId = auctionId;
            this.connectedClients.set(client.id, info);
            client.join(`auction:${auctionId}`);
            const count = await this.redisService.incrementViewers(auctionId);
            this.server.to(`auction:${auctionId}`).emit('viewers_count_updated', {
                auctionId,
                count,
            });
            client.emit('auction_data', auction);
            this.startTimerBroadcast(auctionId, new Date(auction.endTime));
            this.logger.log(`Client ${client.id} joined auction ${auctionId} (viewers: ${count})`);
        }
        catch (error) {
            client.emit('error', { message: 'Auction not found' });
        }
    }
    async handleLeaveAuction(client, data) {
        client.leave(`auction:${data.auctionId}`);
        const info = this.connectedClients.get(client.id) || {};
        if (info.auctionId === data.auctionId) {
            info.auctionId = undefined;
            this.connectedClients.set(client.id, info);
            const count = await this.redisService.decrementViewers(data.auctionId);
            this.server.to(`auction:${data.auctionId}`).emit('viewers_count_updated', {
                auctionId: data.auctionId,
                count,
            });
        }
    }
    async handlePlaceBid(client, data) {
        const info = this.connectedClients.get(client.id) || {};
        if (!info.userId && data.token) {
            try {
                const payload = this.jwtService.verify(data.token);
                info.userId = payload.sub;
                this.connectedClients.set(client.id, info);
            }
            catch {
                client.emit('bid_error', { message: 'Ошибка авторизации. Перезайдите.' });
                return;
            }
        }
        if (!info.userId) {
            client.emit('bid_error', { message: 'Войдите в аккаунт, чтобы делать ставки' });
            return;
        }
        try {
            const { bid, newEndTime } = await this.auctionService.placeBid(data.auctionId, data.amount, info.userId);
            this.server.to(`auction:${data.auctionId}`).emit('bid_placed', {
                id: bid.id,
                amount: bid.amount,
                userId: bid.userId,
                userName: bid.user.name,
                auctionId: data.auctionId,
                createdAt: bid.createdAt,
            });
            if (newEndTime) {
                const timerEntry = this.auctionTimers.get(data.auctionId);
                if (timerEntry) {
                    timerEntry.endTime = newEndTime;
                }
                this.server.to(`auction:${data.auctionId}`).emit('auction_time_extended', {
                    auctionId: data.auctionId,
                    newEndTime: newEndTime.toISOString(),
                });
                this.logger.log(`Anti-Sniping broadcast: auction ${data.auctionId} extended to ${newEndTime.toISOString()}`);
            }
            this.logger.log(`Bid placed: ${data.amount} on auction ${data.auctionId}`);
        }
        catch (error) {
            client.emit('bid_error', {
                message: error.message || 'Failed to place bid',
            });
        }
    }
    handleUserTyping(client, data) {
        client.broadcast.to(`auction:${data.auctionId}`).emit('user_typing_bid', {
            auctionId: data.auctionId,
            isTyping: data.isTyping,
            userId: data.userId,
            userName: data.userName,
        });
    }
    startTimerBroadcast(auctionId, initialEndTime) {
        if (this.auctionTimers.has(auctionId)) {
            return;
        }
        const timerEntry = { interval: null, endTime: initialEndTime };
        const interval = setInterval(async () => {
            const now = new Date();
            const timeLeft = timerEntry.endTime.getTime() - now.getTime();
            if (timeLeft <= 0) {
                clearInterval(interval);
                this.auctionTimers.delete(auctionId);
                const result = await this.auctionService.finalizeAuction(auctionId);
                this.server.to(`auction:${auctionId}`).emit('auction_ended', {
                    auctionId,
                    winnerId: result?.winnerId || null,
                    winnerName: result?.winner?.name || null,
                    finalPrice: result?.currentPrice || 0,
                });
                this.logger.log(`Auction ${auctionId} ended.`);
            }
            else {
                this.server.to(`auction:${auctionId}`).emit('timer_update', {
                    auctionId,
                    timeLeft,
                });
            }
        }, 1000);
        timerEntry.interval = interval;
        this.auctionTimers.set(auctionId, timerEntry);
    }
};
exports.AuctionGateway = AuctionGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], AuctionGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('authenticate'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], AuctionGateway.prototype, "handleAuth", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('join_auction'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], AuctionGateway.prototype, "handleJoinAuction", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leave_auction'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], AuctionGateway.prototype, "handleLeaveAuction", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('place_bid'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], AuctionGateway.prototype, "handlePlaceBid", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('user_typing_bid'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], AuctionGateway.prototype, "handleUserTyping", null);
exports.AuctionGateway = AuctionGateway = AuctionGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
        namespace: '/',
    }),
    __metadata("design:paramtypes", [auction_service_1.AuctionService,
        jwt_1.JwtService,
        redis_service_1.RedisService])
], AuctionGateway);
//# sourceMappingURL=auction.gateway.js.map