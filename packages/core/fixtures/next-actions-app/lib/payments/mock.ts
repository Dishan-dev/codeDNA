export const mockGateway = {
  async charge(amount: number) {
    return { id: `mock-${amount}` };
  },
};
