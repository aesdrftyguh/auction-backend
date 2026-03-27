import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
export declare class RedisService implements OnModuleInit, OnModuleDestroy {
    private client;
    onModuleInit(): void;
    onModuleDestroy(): void;
    getClient(): Redis;
    tryPlaceBid(auctionId: string, amount: number, userId: string): Promise<boolean>;
    setAuctionPrice(auctionId: string, price: number): Promise<void>;
    getAuctionPrice(auctionId: string): Promise<number | null>;
    setAuctionEndTime(auctionId: string, endTime: Date): Promise<void>;
    getAuctionEndTime(auctionId: string): Promise<number | null>;
    deleteAuction(auctionId: string): Promise<void>;
    incrementViewers(auctionId: string): Promise<number>;
    decrementViewers(auctionId: string): Promise<number>;
    getViewersCount(auctionId: string): Promise<number>;
}
