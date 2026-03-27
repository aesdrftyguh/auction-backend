import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { AuctionModule } from './auction/auction.module';

@Module({
  imports: [PrismaModule, RedisModule, AuthModule, AuctionModule],
})
export class AppModule { }
