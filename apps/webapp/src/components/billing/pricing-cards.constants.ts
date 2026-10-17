import { seatPriceEuros } from "@/lib/billing/seat-prices";

const fullSeatPrice = seatPriceEuros("full");
export const MONTHLY_PRICE = fullSeatPrice.monthly;
export const YEARLY_PRICE_PER_MONTH = fullSeatPrice.yearlyPerMonth;
export const YEARLY_PRICE_TOTAL = fullSeatPrice.yearlyTotal;
