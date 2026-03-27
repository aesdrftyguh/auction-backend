import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AuctionService } from './auction.service';
import { RedisService } from '../redis/redis.service';
export declare class AuctionGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private auctionService;
    private jwtService;
    private redisService;
    server: Server;
    private readonly logger;
    private connectedClients;
    private auctionTimers;
    constructor(auctionService: AuctionService, jwtService: JwtService, redisService: RedisService);
    handleConnection(client: Socket): Promise<void>;
    handleDisconnect(client: Socket): Promise<void>;
    handleAuth(client: Socket, data: {
        token: string;
    }): Promise<void>;
    handleJoinAuction(client: Socket, data: {
        auctionId: string;
    }): Promise<void>;
    handleLeaveAuction(client: Socket, data: {
        auctionId: string;
    }): Promise<void>;
    handlePlaceBid(client: Socket, data: {
        auctionId: string;
        amount: number;
        token?: string;
    }): Promise<void>;
    handleUserTyping(client: Socket, data: {
        auctionId: string;
        isTyping: boolean;
        userId: string;
        userName: string;
    }): void;
    private startTimerBroadcast;
}
