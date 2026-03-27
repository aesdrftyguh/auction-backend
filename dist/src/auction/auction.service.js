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
var AuctionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuctionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const redis_service_1 = require("../redis/redis.service");
const client_1 = require("@prisma/client");
let AuctionService = AuctionService_1 = class AuctionService {
    prisma;
    redisService;
    logger = new common_1.Logger(AuctionService_1.name);
    constructor(prisma, redisService) {
        this.prisma = prisma;
        this.redisService = redisService;
    }
    async createAuction(dto, userId) {
        const endTime = new Date(dto.endTime);
        if (endTime <= new Date()) {
            throw new common_1.BadRequestException('End time must be in the future');
        }
        const auction = await this.prisma.auction.create({
            data: {
                title: dto.title,
                description: dto.description,
                imageUrl: dto.imageUrl,
                startingPrice: dto.startingPrice,
                currentPrice: dto.startingPrice,
                endTime,
                status: client_1.AuctionStatus.ACTIVE,
                creatorId: userId,
            },
            include: {
                creator: { select: { id: true, name: true, email: true } },
            },
        });
        await this.redisService.setAuctionPrice(auction.id, auction.startingPrice);
        await this.redisService.setAuctionEndTime(auction.id, endTime);
        return auction;
    }
    async getAllAuctions() {
        return this.prisma.auction.findMany({
            include: {
                creator: { select: { id: true, name: true } },
                _count: { select: { bids: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async getActiveAuctions() {
        await this.finalizeExpiredAuctions();
        return this.prisma.auction.findMany({
            where: { status: client_1.AuctionStatus.ACTIVE },
            include: {
                creator: { select: { id: true, name: true } },
                _count: { select: { bids: true } },
            },
            orderBy: { endTime: 'asc' },
        });
    }
    async getAuctionById(id) {
        const auction = await this.prisma.auction.findUnique({
            where: { id },
            include: {
                creator: { select: { id: true, name: true, email: true } },
                winner: { select: { id: true, name: true } },
                bids: {
                    include: {
                        user: { select: { id: true, name: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
            },
        });
        if (!auction) {
            throw new common_1.NotFoundException('Auction not found');
        }
        return auction;
    }
    async placeBid(auctionId, amount, userId) {
        const auction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
        });
        if (!auction) {
            throw new common_1.NotFoundException('Auction not found');
        }
        if (auction.status !== client_1.AuctionStatus.ACTIVE) {
            throw new common_1.BadRequestException('Auction is not active');
        }
        if (new Date() >= auction.endTime) {
            throw new common_1.BadRequestException('Auction has ended');
        }
        if (auction.creatorId === userId) {
            throw new common_1.ForbiddenException('Cannot bid on your own auction');
        }
        if (amount <= auction.currentPrice) {
            throw new common_1.BadRequestException(`Bid must be higher than current price: ${auction.currentPrice}`);
        }
        const accepted = await this.redisService.tryPlaceBid(auctionId, amount, userId);
        if (!accepted) {
            throw new common_1.BadRequestException('Your bid was outpaced. Try a higher amount.');
        }
        const timeLeft = auction.endTime.getTime() - Date.now();
        let newEndTime = null;
        if (timeLeft < 10_000) {
            newEndTime = new Date(Date.now() + 30_000);
            this.logger.log(`Anti-Sniping triggered for auction ${auctionId}. New endTime: ${newEndTime.toISOString()}`);
        }
        const auctionUpdateData = { currentPrice: amount };
        if (newEndTime) {
            auctionUpdateData.endTime = newEndTime;
            await this.redisService.setAuctionEndTime(auctionId, newEndTime);
        }
        const [bid] = await this.prisma.$transaction([
            this.prisma.bid.create({
                data: { amount, auctionId, userId },
                include: { user: { select: { id: true, name: true } } },
            }),
            this.prisma.auction.update({
                where: { id: auctionId },
                data: auctionUpdateData,
            }),
        ]);
        this.logger.log(`Bid placed: ${amount} on auction ${auctionId} by user ${userId}`);
        return { bid, newEndTime };
    }
    async finalizeAuction(auctionId) {
        const auction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
            include: {
                bids: {
                    orderBy: { amount: 'desc' },
                    take: 1,
                    include: { user: { select: { id: true, name: true } } },
                },
            },
        });
        if (!auction || auction.status === client_1.AuctionStatus.ENDED) {
            return null;
        }
        const redisPrice = await this.redisService.getAuctionPrice(auctionId);
        const finalBid = auction.bids.length > 0 ? auction.bids[0] : null;
        const winnerId = finalBid ? finalBid.userId : null;
        const finalPrice = redisPrice ? redisPrice : (finalBid ? finalBid.amount : auction.currentPrice);
        const updated = await this.prisma.auction.update({
            where: { id: auctionId },
            data: {
                status: client_1.AuctionStatus.ENDED,
                winnerId,
                currentPrice: finalPrice,
            },
            include: {
                winner: { select: { id: true, name: true } },
            },
        });
        await this.redisService.deleteAuction(auctionId);
        this.logger.log(`Auction ${auctionId} ended. Winner: ${winnerId}, Final Price: ${finalPrice}`);
        return updated;
    }
    async finalizeExpiredAuctions() {
        const expired = await this.prisma.auction.findMany({
            where: {
                status: client_1.AuctionStatus.ACTIVE,
                endTime: { lte: new Date() },
            },
        });
        for (const auction of expired) {
            await this.finalizeAuction(auction.id);
        }
    }
};
exports.AuctionService = AuctionService;
exports.AuctionService = AuctionService = AuctionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], AuctionService);
//# sourceMappingURL=auction.service.js.map