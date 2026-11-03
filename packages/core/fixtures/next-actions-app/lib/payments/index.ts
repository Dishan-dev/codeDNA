import { stripeGateway } from './stripe';
import { mockGateway } from './mock';

const gateways = { stripe: stripeGateway, mock: mockGateway };

export function getPaymentGateway() {
  const key = process.env.PAYMENT_GATEWAY as keyof typeof gateways;
  return gateways[key];
}
