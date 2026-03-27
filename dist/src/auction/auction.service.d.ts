import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateAuctionDto } from './dto/auction.dto';
export declare class AuctionService {
    private prisma;
    private redisService;
    private readonly logger;
    constructor(prisma: PrismaService, redisService: RedisService);
    createAuction(dto: CreateAuctionDto, userId: string): Promise<{
        creator: {
            id: string;
            email: string;
            name: string;
        };
    } & {
        id: string;
        title: string;
        description: string;
        imageUrl: string | null;
        startingPrice: number;
        currentPrice: number;
        status: import("@prisma/client").$Enums.AuctionStatus;
        endTime: Date;
        createdAt: Date;
        creatorId: string;
        winnerId: string | null;
    }>;
    getAllAuctions(): Promise<({
        creator: {
            id: string;
            name: string;
        };
        _count: {
            bids: number;
        };
    } & {
        id: string;
        title: string;
        description: string;
        imageUrl: string | null;
        startingPrice: number;
        currentPrice: number;
        status: import("@prisma/client").$Enums.AuctionStatus;
        endTime: Date;
        createdAt: Date;
        creatorId: string;
        winnerId: string | null;
    })[]>;
    getActiveAuctions(): Promise<({
        creator: {
            id: string;
            name: string;
        };
        _count: {
            bids: number;
        };
    } & {
        id: string;
        title: string;
        description: string;
        imageUrl: string | null;
        startingPrice: number;
        currentPrice: number;
        status: import("@prisma/client").$Enums.AuctionStatus;
        endTime: Date;
        createdAt: Date;
        creatorId: string;
        winnerId: string | null;
    })[]>;
    getAuctionById(id: string): Promise<{
        creator: {
            id: string;
            email: string;
            name: string;
        };
        winner: {
            id: string;
            name: string;
        } | null;
        bids: ({
            user: {
                id: string;
                name: string;
            };
        } & {
            id: string;
            createdAt: Date;
            amount: number;
            auctionId: string;
            userId: string;
        })[];
    } & {
        id: string;
        title: string;
        description: string;
        imageUrl: string | null;
        startingPrice: number;
        currentPrice: number;
        status: import("@prisma/client").$Enums.AuctionStatus;
        endTime: Date;
        createdAt: Date;
        creatorId: string;
        winnerId: string | null;
    }>;
    placeBid(auctionId: string, amount: number, userId: string): Promise<{
        bid: any;
        newEndTime: Date | null;
    }>;
    finalizeAuction(auctionId: string): Promise<({
        winner: {
            id: string;
            name: string;
        } | null;
    } & {
        id: string;
        title: string;
        description: string;
        imageUrl: string | null;
        startingPrice: number;
        currentPrice: number;
        status: import("@prisma/client").$Enums.AuctionStatus;
        endTime: Date;
        createdAt: Date;
        creatorId: string;
        winnerId: string | null;
    }) | null>;
    private finalizeExpiredAuctions;
}
