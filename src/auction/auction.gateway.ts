import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuctionService } from './auction.service';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/',
})
export class AuctionGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(AuctionGateway.name);

    // Map socketId → { userId, auctionId }
    private connectedClients = new Map<string, { userId?: string; auctionId?: string }>();

    // Auction timers: auctionId → { interval, endTime (mutable for Anti-Sniping) }
    private auctionTimers = new Map<string, { interval: NodeJS.Timeout; endTime: Date }>();

    constructor(
        private auctionService: AuctionService,
        private jwtService: JwtService,
        private redisService: RedisService,
    ) {}

    // ── Connection lifecycle ─────────────────────────────────────────

    async handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
        this.connectedClients.set(client.id, {});
    }

    async handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
        const info = this.connectedClients.get(client.id);
        if (info?.auctionId) {
            client.leave(`auction:${info.auctionId}`);
            // Live Presence: decrement viewer count
            const count = await this.redisService.decrementViewers(info.auctionId);
            this.server.to(`auction:${info.auctionId}`).emit('viewers_count_updated', {
                auctionId: info.auctionId,
                count,
            });
        }
        this.connectedClients.delete(client.id);
    }

    // ── Authentication ───────────────────────────────────────────────

    @SubscribeMessage('authenticate')
    async handleAuth(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { token: string },
    ) {
        try {
            const payload = this.jwtService.verify(data.token);
            const info = this.connectedClients.get(client.id) || {};
            info.userId = payload.sub;
            this.connectedClients.set(client.id, info);
            client.emit('authenticated', { userId: payload.sub });
            this.logger.log(`Client ${client.id} authenticated as user ${payload.sub}`);
        } catch {
            client.emit('error', { message: 'Authentication failed' });
        }
    }

    // ── Join / Leave auction ─────────────────────────────────────────

    @SubscribeMessage('join_auction')
    async handleJoinAuction(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { auctionId: string },
    ) {
        const { auctionId } = data;

        try {
            const auction = await this.auctionService.getAuctionById(auctionId);

            const info = this.connectedClients.get(client.id) || {};

            // Leave previous room (and decrement that room's counter)
            if (info.auctionId && info.auctionId !== auctionId) {
                client.leave(`auction:${info.auctionId}`);
                const prevCount = await this.redisService.decrementViewers(info.auctionId);
                this.server.to(`auction:${info.auctionId}`).emit('viewers_count_updated', {
                    auctionId: info.auctionId,
                    count: prevCount,
                });
            }

            // Join new room
            info.auctionId = auctionId;
            this.connectedClients.set(client.id, info);
            client.join(`auction:${auctionId}`);

            // Live Presence: increment viewer count
            const count = await this.redisService.incrementViewers(auctionId);
            this.server.to(`auction:${auctionId}`).emit('viewers_count_updated', {
                auctionId,
                count,
            });

            // Send full auction data to the joining client
            client.emit('auction_data', auction);

            // Start server-side timer broadcast
            this.startTimerBroadcast(auctionId, new Date(auction.endTime));

            this.logger.log(`Client ${client.id} joined auction ${auctionId} (viewers: ${count})`);
        } catch (error) {
            client.emit('error', { message: 'Auction not found' });
        }
    }

    @SubscribeMessage('leave_auction')
    async handleLeaveAuction(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { auctionId: string },
    ) {
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

    // ── Place Bid ────────────────────────────────────────────────────

    @SubscribeMessage('place_bid')
    async handlePlaceBid(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { auctionId: string; amount: number; token?: string },
    ) {
        const info = this.connectedClients.get(client.id) || {};

        // Inline token fallback to handle auth race condition
        if (!info.userId && data.token) {
            try {
                const payload = this.jwtService.verify(data.token);
                info.userId = payload.sub;
                this.connectedClients.set(client.id, info);
            } catch {
                client.emit('bid_error', { message: 'Ошибка авторизации. Перезайдите.' });
                return;
            }
        }

        if (!info.userId) {
            client.emit('bid_error', { message: 'Войдите в аккаунт, чтобы делать ставки' });
            return;
        }

        try {
            const { bid, newEndTime } = await this.auctionService.placeBid(
                data.auctionId,
                data.amount,
                info.userId,
            );

            // Broadcast new bid to everyone in the room
            this.server.to(`auction:${data.auctionId}`).emit('bid_placed', {
                id: bid.id,
                amount: bid.amount,
                userId: bid.userId,
                userName: bid.user.name,
                auctionId: data.auctionId,
                createdAt: bid.createdAt,
            });

            // Anti-Sniping: if time was extended, update the server timer and notify clients
            if (newEndTime) {
                const timerEntry = this.auctionTimers.get(data.auctionId);
                if (timerEntry) {
                    timerEntry.endTime = newEndTime; // mutate — interval uses this ref
                }

                this.server.to(`auction:${data.auctionId}`).emit('auction_time_extended', {
                    auctionId: data.auctionId,
                    newEndTime: newEndTime.toISOString(),
                });

                this.logger.log(
                    `Anti-Sniping broadcast: auction ${data.auctionId} extended to ${newEndTime.toISOString()}`,
                );
            }

            this.logger.log(`Bid placed: ${data.amount} on auction ${data.auctionId}`);
        } catch (error) {
            client.emit('bid_error', {
                message: error.message || 'Failed to place bid',
            });
        }
    }

    // ── User Typing (Ephemeral — not stored anywhere) ────────────────

    @SubscribeMessage('user_typing_bid')
    handleUserTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { auctionId: string; isTyping: boolean; userId: string; userName: string },
    ) {
        // Broadcast to everyone in the room EXCEPT the sender
        client.broadcast.to(`auction:${data.auctionId}`).emit('user_typing_bid', {
            auctionId: data.auctionId,
            isTyping: data.isTyping,
            userId: data.userId,
            userName: data.userName,
        });
    }

    // ── Server-side Timer Broadcast ──────────────────────────────────

    private startTimerBroadcast(auctionId: string, initialEndTime: Date) {
        if (this.auctionTimers.has(auctionId)) {
            return; // Timer already running
        }

        // Wrap endTime in a mutable object so Anti-Sniping can update it
        const timerEntry = { interval: null as any, endTime: initialEndTime };

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
            } else {
                this.server.to(`auction:${auctionId}`).emit('timer_update', {
                    auctionId,
                    timeLeft,
                });
            }
        }, 1000);

        timerEntry.interval = interval;
        this.auctionTimers.set(auctionId, timerEntry);
    }
}
