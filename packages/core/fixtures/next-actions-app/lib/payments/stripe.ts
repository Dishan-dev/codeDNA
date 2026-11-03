export const stripeGateway = {
  async charge(amount: number) {
    return { id: `stripe-${amount}` };
  },
};
