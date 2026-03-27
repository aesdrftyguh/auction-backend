import { IsString, IsNumber, IsDateString, Min, MinLength, IsOptional } from 'class-validator';

export class CreateAuctionDto {
    @IsString()
    @MinLength(3)
    title: string;

    @IsString()
    @MinLength(10)
    description: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;

    @IsNumber()
    @Min(1)
    startingPrice: number;

    @IsDateString()
    endTime: string;
}

export class PlaceBidDto {
    @IsString()
    auctionId: string;

    @IsNumber()
    @Min(1)
    amount: number;
}
