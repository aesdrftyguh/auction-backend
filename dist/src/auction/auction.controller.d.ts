import { AuctionService } from './auction.service';
import { CreateAuctionDto } from './dto/auction.dto';
export declare class AuctionController {
    private auctionService;
    constructor(auctionService: AuctionService);
    create(dto: CreateAuctionDto, req: any): Promise<{
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
    findAll(): Promise<({
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
    findActive(): Promise<({
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
    findOne(id: string): Promise<{
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
}
