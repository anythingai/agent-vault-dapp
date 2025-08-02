import 'jest';

// Global test setup
beforeAll(async () => {
  // Set longer timeout for Bitcoin operations
  jest.setTimeout(60000);
});

afterAll(async () => {
  // Cleanup any remaining resources
  const { regtestManager } = await import('../bitcoin/setup.js');
  try {
    await regtestManager.stopRegtestNode();
  } catch (error) {
    console.warn('Error stopping regtest node:', error);
  }
});

// Mock console for cleaner test output
global.console = {
  ...console,
  // Uncomment to silence logs during tests
  // log: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Add custom matchers for Bitcoin testing
expect.extend({
  toBeBitcoinAddress(received: string) {
    // Simple Bitcoin address validation
    const isValidAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$|^tb1[a-z0-9]{39,59}$|^bcrt1[a-z0-9]{39,59}$/.test(received);
    
    if (isValidAddress) {
      return {
        message: () => `Expected ${received} not to be a valid Bitcoin address`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${received} to be a valid Bitcoin address`,
        pass: false,
      };
    }
  },
  
  toBeTransactionId(received: string) {
    // Bitcoin transaction ID validation (64 hex characters)
    const isValidTxId = /^[a-fA-F0-9]{64}$/.test(received);
    
    if (isValidTxId) {
      return {
        message: () => `Expected ${received} not to be a valid transaction ID`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${received} to be a valid transaction ID`,
        pass: false,
      };
    }
  },
  
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    
    if (pass) {
      return {
        message: () => `Expected ${received} not to be within range ${min}-${max}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${received} to be within range ${min}-${max}`,
        pass: false,
      };
    }
  }
});

// Extend Jest matchers interface
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeBitcoinAddress(): R;
      toBeTransactionId(): R;
      toBeWithinRange(min: number, max: number): R;
    }
  }
}