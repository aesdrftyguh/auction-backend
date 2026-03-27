import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Request,
} from '@nestjs/common';
import { AuctionService } from './auction.service';
import { CreateAuctionDto } from './dto/auction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('auctions')
export class AuctionController {
    constructor(private auctionService: AuctionService) { }

    @UseGuards(JwtAuthGuard)
    @Post()
    async create(@Body() dto: CreateAuctionDto, @Request() req) {
        return this.auctionService.createAuction(dto, req.user.sub);
    }

    @Get()
    async findAll() {
        return this.auctionService.getAllAuctions();
    }

    @Get('active')
    async findActive() {
        return this.auctionService.getActiveAuctions();
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.auctionService.getAuctionById(id);
    }
}
