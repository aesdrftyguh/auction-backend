export declare class CreateAuctionDto {
    title: string;
    description: string;
    imageUrl?: string;
    startingPrice: number;
    endTime: string;
}
export declare class PlaceBidDto {
    auctionId: string;
    amount: number;
}
