import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateAuctionDto } from './dto/auction.dto';
import { AuctionStatus } from '@prisma/client';

@Injectable()
export class AuctionService {
    private readonly logger = new Logger(AuctionService.name);

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
    ) { }

    async createAuction(dto: CreateAuctionDto, userId: string) {
        const endTime = new Date(dto.endTime);

        if (endTime <= new Date()) {
            throw new BadRequestException('End time must be in the future');
        }

        const auction = await this.prisma.auction.create({
            data: {
                title: dto.title,
                description: dto.description,
                imageUrl: dto.imageUrl,
                startingPrice: dto.startingPrice,
                currentPrice: dto.startingPrice,
                endTime,
                status: AuctionStatus.ACTIVE,
                creatorId: userId,
            },
            include: {
                creator: { select: { id: true, name: true, email: true } },
            },
        });

        // Cache auction in Redis
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
        // First, finalize any auctions that have passed their end time
        await this.finalizeExpiredAuctions();

        return this.prisma.auction.findMany({
            where: { status: AuctionStatus.ACTIVE },
            include: {
                creator: { select: { id: true, name: true } },
                _count: { select: { bids: true } },
            },
            orderBy: { endTime: 'asc' },
        });
    }

    async getAuctionById(id: string) {
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
            throw new NotFoundException('Auction not found');
        }

        return auction;
    }

    /**
     * Core bid logic:
     * 1. Validate auction status
     * 2. Atomic Redis check (Lua script)
     * 3. Anti-Sniping: if timeLeft < 10s → extend endTime by 30s
     * 4. Persist to PostgreSQL inside a transaction
     */
    async placeBid(
        auctionId: string,
        amount: number,
        userId: string,
    ): Promise<{ bid: any; newEndTime: Date | null }> {
        // 1. Get auction
        const auction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
        });

        if (!auction) {
            throw new NotFoundException('Auction not found');
        }

        if (auction.status !== AuctionStatus.ACTIVE) {
            throw new BadRequestException('Auction is not active');
        }

        if (new Date() >= auction.endTime) {
            throw new BadRequestException('Auction has ended');
        }

        if (auction.creatorId === userId) {
            throw new ForbiddenException('Cannot bid on your own auction');
        }

        if (amount <= auction.currentPrice) {
            throw new BadRequestException(
                `Bid must be higher than current price: ${auction.currentPrice}`,
            );
        }

        // 2. Atomic check in Redis (prevents race conditions)
        const accepted = await this.redisService.tryPlaceBid(auctionId, amount, userId);

        if (!accepted) {
            throw new BadRequestException('Your bid was outpaced. Try a higher amount.');
        }

        // 3. Anti-Sniping: extend time if bid arrives within last 10 seconds
        const timeLeft = auction.endTime.getTime() - Date.now();
        let newEndTime: Date | null = null;

        if (timeLeft < 10_000) {
            newEndTime = new Date(Date.now() + 30_000);
            this.logger.log(
                `Anti-Sniping triggered for auction ${auctionId}. New endTime: ${newEndTime.toISOString()}`,
            );
        }

        // 4. Persist to database inside a transaction
        const auctionUpdateData: any = { currentPrice: amount };
        if (newEndTime) {
            auctionUpdateData.endTime = newEndTime;
            // Keep Redis in sync with the new endTime
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


    async finalizeAuction(auctionId: string) {
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

        if (!auction || auction.status === AuctionStatus.ENDED) {
            return null;
        }

        // 1. Считываем последнюю максимальную ставку из Redis перед удалением
        const redisPrice = await this.redisService.getAuctionPrice(auctionId);

        const finalBid = auction.bids.length > 0 ? auction.bids[0] : null;
        const winnerId = finalBid ? finalBid.userId : null;

        // Финальная цена берется из Redis (самая актуальная), либо из последней ставки
        const finalPrice = redisPrice ? redisPrice : (finalBid ? finalBid.amount : auction.currentPrice);

        const updated = await this.prisma.auction.update({
            where: { id: auctionId },
            data: {
                status: AuctionStatus.ENDED,
                winnerId,
                currentPrice: finalPrice, // Обновляем финальную цену!
            },
            include: {
                winner: { select: { id: true, name: true } },
            },
        });

        // Cleanup Redis
        await this.redisService.deleteAuction(auctionId);

        this.logger.log(`Auction ${auctionId} ended. Winner: ${winnerId}, Final Price: ${finalPrice}`);

        return updated;
    }

    private async finalizeExpiredAuctions() {
        const expired = await this.prisma.auction.findMany({
            where: {
                status: AuctionStatus.ACTIVE,
                endTime: { lte: new Date() },
            },
        });

        for (const auction of expired) {
            await this.finalizeAuction(auction.id);
        }
    }
}
