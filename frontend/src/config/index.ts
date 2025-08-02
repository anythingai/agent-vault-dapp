/**
 * Frontend Configuration Management
 *
 * This module handles all frontend configuration including environment variables,
 * feature flags, and runtime settings. Only variables prefixed with VITE_ are
 * accessible in the browser.
 */

// Extend ImportMeta interface to include env
declare global {
  interface ImportMetaEnv {
    [key: string]: string | undefined;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// Type definitions for configuration
export type Environment = 'development' | 'staging' | 'production';
export type Theme = 'light' | 'dark' | 'auto';
export type Language = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'ko';
export type GasSpeed = 'standard' | 'fast' | 'rapid';

export interface ApiConfig {
  baseUrl: string;
  relayerUrl: string;
  resolverUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
}

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxRetries: number;
}

export interface BlockchainConfig {
  ethereum: {
    network: string;
    chainId: number;
    rpcUrl: string;
    blockExplorerUrl: string;
  };
  bitcoin: {
    network: string;
    explorerUrl: string;
  };
  alternativeNetworks: {
    polygon?: {
      chainId: number;
      rpcUrl: string;
    };
    arbitrum?: {
      chainId: number;
      rpcUrl: string;
    };
  };
}

export interface ContractAddresses {
  escrowFactory?: string;
  escrowSrcImplementation?: string;
  escrowDstImplementation?: string;
  limitOrderProtocol?: string;
  tokens: {
    usdc?: string;
    usdt?: string;
    dai?: string;
    weth?: string;
    wbtc?: string;
  };
}

export interface WalletConfig {
  supported: {
    metamask: boolean;
    walletConnect: boolean;
    coinbaseWallet: boolean;
    injectedWallets: boolean;
  };
  walletConnect: {
    projectId?: string;
    relayUrl: string;
  };
  connection: {
    timeout: number;
    autoConnect: boolean;
    cacheProvider: boolean;
  };
}

export interface UIConfig {
  theme: {
    default: Theme;
    enableToggle: boolean;
    customColors?: string;
  };
  language: {
    default: Language;
    enableI18n: boolean;
    supported: Language[];
  };
  layout: {
    enableSidebar: boolean;
    enableHeader: boolean;
    enableFooter: boolean;
    compactMode: boolean;
  };
}

export interface FeatureFlags {
  // Core features
  crossChainSwaps: boolean;
  auctionSystem: boolean;
  orderHistory: boolean;
  portfolioView: boolean;
  
  // Advanced features
  limitOrders: boolean;
  batchOrders: boolean;
  flashLoans: boolean;
  advancedCharts: boolean;
  
  // Trading features
  priceAlerts: boolean;
  stopLoss: boolean;
  takeProfit: boolean;
  recurringOrders: boolean;
  
  // UI features
  darkMode: boolean;
  notifications: boolean;
  soundEffects: boolean;
  animations: boolean;
}

export interface TradingConfig {
  defaults: {
    slippage: number;
    gasSpeed: GasSpeed;
  };
  limits: {
    maxSlippage: number;
    minOrderSize: number;
    maxOrderSize: number;
  };
  gas: {
    showEstimates: boolean;
    bufferMultiplier: number;
  };
  prices: {
    updateInterval: number;
    impactWarningThreshold: number;
    enableCharts: boolean;
  };
}

export interface MonitoringConfig {
  errorTracking: {
    sentryDsn?: string;
    environment: string;
    sampleRate: number;
  };
  analytics: {
    googleAnalyticsId?: string;
    mixpanelToken?: string;
    amplitudeApiKey?: string;
    enabled: boolean;
  };
  performance: {
    enabled: boolean;
    sampleRate: number;
    webVitalsEnabled: boolean;
  };
}

export interface SecurityConfig {
  csp: {
    enabled: boolean;
    reportUri?: string;
  };
  https: {
    forceHttps: boolean;
    hstsEnabled: boolean;
  };
  privacy: {
    privacyMode: boolean;
    anonymousUsage: boolean;
    gdprCompliance: boolean;
  };
}

export interface DevelopmentConfig {
  tools: {
    enableDevtools: boolean;
    enableMockData: boolean;
    enableDebugMode: boolean;
    showDevWarnings: boolean;
  };
  hmr: {
    enabled: boolean;
    port: number;
  };
  mock: {
    walletAddress: string;
    walletBalance: number;
    apiDelay: number;
  };
}

export interface BuildConfig {
  bundle: {
    analyzer: boolean;
    sourceMaps: boolean;
    minify: boolean;
    treeShaking: boolean;
  };
  assets: {
    compressAssets: boolean;
    optimizeImages: boolean;
    lazyLoadImages: boolean;
  };
  codeSplitting: {
    enabled: boolean;
    chunkSizeWarningLimit: number;
  };
}

export interface ExternalConfig {
  social: {
    enableSharing: boolean;
    twitterHandle?: string;
    discordInvite?: string;
  };
  support: {
    helpCenterUrl?: string;
    supportEmail?: string;
    feedbackUrl?: string;
  };
  links: {
    githubUrl?: string;
    documentationUrl?: string;
    blogUrl?: string;
  };
}

export interface ExperimentalConfig {
  beta: {
    enabled: boolean;
    experimentalUI: boolean;
    aiPoweredSuggestions: boolean;
    advancedAnalytics: boolean;
  };
  testing: {
    abTestingEnabled: boolean;
    abTestingSegment?: string;
  };
  rollout: {
    gradualRollout: boolean;
    rolloutPercentage: number;
  };
}

export interface FrontendConfig {
  environment: Environment;
  appName: string;
  appVersion: string;
  api: ApiConfig;
  webSocket: WebSocketConfig;
  blockchain: BlockchainConfig;
  contracts: ContractAddresses;
  wallet: WalletConfig;
  ui: UIConfig;
  features: FeatureFlags;
  trading: TradingConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
  development: DevelopmentConfig;
  build: BuildConfig;
  external: ExternalConfig;
  experimental: ExperimentalConfig;
}

// Configuration loader class
class ConfigurationLoader {
  private config: FrontendConfig;

  constructor() {
    this.config = this.loadConfiguration();
    this.validateConfiguration();
  }

  private loadConfiguration(): FrontendConfig {
    return {
      environment: this.getEnvVar('VITE_APP_ENV', 'development') as Environment,
      appName: this.getEnvVar('VITE_APP_NAME', '1inch Fusion+ Cross-Chain'),
      appVersion: this.getEnvVar('VITE_APP_VERSION', '1.0.0'),
      
      api: this.loadApiConfig(),
      webSocket: this.loadWebSocketConfig(),
      blockchain: this.loadBlockchainConfig(),
      contracts: this.loadContractAddresses(),
      wallet: this.loadWalletConfig(),
      ui: this.loadUIConfig(),
      features: this.loadFeatureFlags(),
      trading: this.loadTradingConfig(),
      monitoring: this.loadMonitoringConfig(),
      security: this.loadSecurityConfig(),
      development: this.loadDevelopmentConfig(),
      build: this.loadBuildConfig(),
      external: this.loadExternalConfig(),
      experimental: this.loadExperimentalConfig()
    };
  }

  private loadApiConfig(): ApiConfig {
    return {
      baseUrl: this.getEnvVar('VITE_API_BASE_URL', 'http://localhost:3001'),
      relayerUrl: this.getEnvVar('VITE_RELAYER_API_URL', 'http://localhost:3001'),
      resolverUrl: this.getEnvVar('VITE_RESOLVER_API_URL', 'http://localhost:3002'),
      timeout: this.getEnvVarAsNumber('VITE_API_TIMEOUT', 30000),
      retries: this.getEnvVarAsNumber('VITE_API_RETRIES', 3),
      retryDelay: this.getEnvVarAsNumber('VITE_API_RETRY_DELAY', 1000)
    };
  }

  private loadWebSocketConfig(): WebSocketConfig {
    return {
      url: this.getEnvVar('VITE_WS_URL', 'ws://localhost:3001'),
      reconnectInterval: this.getEnvVarAsNumber('VITE_WS_RECONNECT_INTERVAL', 5000),
      maxRetries: this.getEnvVarAsNumber('VITE_WS_MAX_RETRIES', 5)
    };
  }

  private loadBlockchainConfig(): BlockchainConfig {
    return {
      ethereum: {
        network: this.getEnvVar('VITE_ETH_NETWORK', 'sepolia'),
        chainId: this.getEnvVarAsNumber('VITE_ETH_CHAIN_ID', 11155111),
        rpcUrl: this.getEnvVar('VITE_ETH_RPC_URL', 'https://rpc.sepolia.org'),
        blockExplorerUrl: this.getEnvVar('VITE_ETH_BLOCK_EXPLORER_URL', 'https://sepolia.etherscan.io')
      },
      bitcoin: {
        network: this.getEnvVar('VITE_BTC_NETWORK', 'testnet'),
        explorerUrl: this.getEnvVar('VITE_BTC_EXPLORER_URL', 'https://blockstream.info/testnet')
      },
      alternativeNetworks: (() => {
        const networks: BlockchainConfig['alternativeNetworks'] = {};
        
        if (this.getEnvVar('VITE_POLYGON_CHAIN_ID')) {
          networks.polygon = {
            chainId: this.getEnvVarAsNumber('VITE_POLYGON_CHAIN_ID', 137),
            rpcUrl: this.getEnvVar('VITE_POLYGON_RPC_URL', 'https://polygon-rpc.com')
          };
        }
        
        if (this.getEnvVar('VITE_ARBITRUM_CHAIN_ID')) {
          networks.arbitrum = {
            chainId: this.getEnvVarAsNumber('VITE_ARBITRUM_CHAIN_ID', 42161),
            rpcUrl: this.getEnvVar('VITE_ARBITRUM_RPC_URL', 'https://arb1.arbitrum.io/rpc')
          };
        }
        
        return networks;
      })()
    };
  }

  private loadContractAddresses(): ContractAddresses {
    return {
      escrowFactory: this.getEnvVar('VITE_ESCROW_FACTORY_ADDRESS'),
      escrowSrcImplementation: this.getEnvVar('VITE_ESCROW_SRC_IMPLEMENTATION_ADDRESS'),
      escrowDstImplementation: this.getEnvVar('VITE_ESCROW_DST_IMPLEMENTATION_ADDRESS'),
      limitOrderProtocol: this.getEnvVar('VITE_LIMIT_ORDER_PROTOCOL_ADDRESS'),
      tokens: {
        usdc: this.getEnvVar('VITE_USDC_ADDRESS'),
        usdt: this.getEnvVar('VITE_USDT_ADDRESS'),
        dai: this.getEnvVar('VITE_DAI_ADDRESS'),
        weth: this.getEnvVar('VITE_WETH_ADDRESS'),
        wbtc: this.getEnvVar('VITE_WBTC_ADDRESS')
      }
    };
  }

  private loadWalletConfig(): WalletConfig {
    return {
      supported: {
        metamask: this.getEnvVarAsBoolean('VITE_ENABLE_METAMASK', true),
        walletConnect: this.getEnvVarAsBoolean('VITE_ENABLE_WALLETCONNECT', true),
        coinbaseWallet: this.getEnvVarAsBoolean('VITE_ENABLE_COINBASE_WALLET', true),
        injectedWallets: this.getEnvVarAsBoolean('VITE_ENABLE_INJECTED_WALLETS', true)
      },
      walletConnect: {
        projectId: this.getEnvVar('VITE_WALLETCONNECT_PROJECT_ID'),
        relayUrl: this.getEnvVar('VITE_WALLETCONNECT_RELAY_URL', 'wss://relay.walletconnect.com')
      },
      connection: {
        timeout: this.getEnvVarAsNumber('VITE_WALLET_CONNECT_TIMEOUT', 30000),
        autoConnect: this.getEnvVarAsBoolean('VITE_WALLET_AUTO_CONNECT', true),
        cacheProvider: this.getEnvVarAsBoolean('VITE_WALLET_CACHE_PROVIDER', true)
      }
    };
  }

  private loadUIConfig(): UIConfig {
    const supportedLanguages = this.getEnvVar('VITE_SUPPORTED_LANGUAGES', 'en,es,fr,de,ja,ko')
      .split(',')
      .map(lang => lang.trim()) as Language[];

    return {
      theme: {
        default: this.getEnvVar('VITE_DEFAULT_THEME', 'dark') as Theme,
        enableToggle: this.getEnvVarAsBoolean('VITE_ENABLE_THEME_TOGGLE', true),
        customColors: this.getEnvVar('VITE_CUSTOM_THEME_COLORS')
      },
      language: {
        default: this.getEnvVar('VITE_DEFAULT_LANGUAGE', 'en') as Language,
        enableI18n: this.getEnvVarAsBoolean('VITE_ENABLE_I18N', true),
        supported: supportedLanguages
      },
      layout: {
        enableSidebar: this.getEnvVarAsBoolean('VITE_ENABLE_SIDEBAR', true),
        enableHeader: this.getEnvVarAsBoolean('VITE_ENABLE_HEADER', true),
        enableFooter: this.getEnvVarAsBoolean('VITE_ENABLE_FOOTER', true),
        compactMode: this.getEnvVarAsBoolean('VITE_COMPACT_MODE', false)
      }
    };
  }

  private loadFeatureFlags(): FeatureFlags {
    return {
      // Core features
      crossChainSwaps: this.getEnvVarAsBoolean('VITE_FEATURE_CROSS_CHAIN_SWAPS', true),
      auctionSystem: this.getEnvVarAsBoolean('VITE_FEATURE_AUCTION_SYSTEM', true),
      orderHistory: this.getEnvVarAsBoolean('VITE_FEATURE_ORDER_HISTORY', true),
      portfolioView: this.getEnvVarAsBoolean('VITE_FEATURE_PORTFOLIO_VIEW', true),
      
      // Advanced features
      limitOrders: this.getEnvVarAsBoolean('VITE_FEATURE_LIMIT_ORDERS', true),
      batchOrders: this.getEnvVarAsBoolean('VITE_FEATURE_BATCH_ORDERS', false),
      flashLoans: this.getEnvVarAsBoolean('VITE_FEATURE_FLASH_LOANS', false),
      advancedCharts: this.getEnvVarAsBoolean('VITE_FEATURE_ADVANCED_CHARTS', true),
      
      // Trading features
      priceAlerts: this.getEnvVarAsBoolean('VITE_FEATURE_PRICE_ALERTS', true),
      stopLoss: this.getEnvVarAsBoolean('VITE_FEATURE_STOP_LOSS', false),
      takeProfit: this.getEnvVarAsBoolean('VITE_FEATURE_TAKE_PROFIT', false),
      recurringOrders: this.getEnvVarAsBoolean('VITE_FEATURE_RECURRING_ORDERS', false),
      
      // UI features
      darkMode: this.getEnvVarAsBoolean('VITE_FEATURE_DARK_MODE', true),
      notifications: this.getEnvVarAsBoolean('VITE_FEATURE_NOTIFICATIONS', true),
      soundEffects: this.getEnvVarAsBoolean('VITE_FEATURE_SOUND_EFFECTS', false),
      animations: this.getEnvVarAsBoolean('VITE_FEATURE_ANIMATIONS', true)
    };
  }

  private loadTradingConfig(): TradingConfig {
    return {
      defaults: {
        slippage: this.getEnvVarAsNumber('VITE_DEFAULT_SLIPPAGE', 0.5),
        gasSpeed: this.getEnvVar('VITE_DEFAULT_GAS_SPEED', 'standard') as GasSpeed
      },
      limits: {
        maxSlippage: this.getEnvVarAsNumber('VITE_MAX_SLIPPAGE', 10.0),
        minOrderSize: this.getEnvVarAsNumber('VITE_MIN_ORDER_SIZE', 0.001),
        maxOrderSize: this.getEnvVarAsNumber('VITE_MAX_ORDER_SIZE', 1000)
      },
      gas: {
        showEstimates: this.getEnvVarAsBoolean('VITE_SHOW_GAS_ESTIMATES', true),
        bufferMultiplier: this.getEnvVarAsNumber('VITE_GAS_BUFFER_MULTIPLIER', 1.1)
      },
      prices: {
        updateInterval: this.getEnvVarAsNumber('VITE_PRICE_UPDATE_INTERVAL', 5000),
        impactWarningThreshold: this.getEnvVarAsNumber('VITE_PRICE_IMPACT_WARNING', 3.0),
        enableCharts: this.getEnvVarAsBoolean('VITE_ENABLE_PRICE_CHARTS', true)
      }
    };
  }

  private loadMonitoringConfig(): MonitoringConfig {
    return {
      errorTracking: {
        sentryDsn: this.getEnvVar('VITE_SENTRY_DSN'),
        environment: this.getEnvVar('VITE_SENTRY_ENVIRONMENT', 'development'),
        sampleRate: this.getEnvVarAsNumber('VITE_SENTRY_SAMPLE_RATE', 1.0)
      },
      analytics: {
        googleAnalyticsId: this.getEnvVar('VITE_GOOGLE_ANALYTICS_ID'),
        mixpanelToken: this.getEnvVar('VITE_MIXPANEL_TOKEN'),
        amplitudeApiKey: this.getEnvVar('VITE_AMPLITUDE_API_KEY'),
        enabled: this.getEnvVarAsBoolean('VITE_ENABLE_ANALYTICS', false)
      },
      performance: {
        enabled: this.getEnvVarAsBoolean('VITE_ENABLE_PERFORMANCE_MONITORING', true),
        sampleRate: this.getEnvVarAsNumber('VITE_PERFORMANCE_SAMPLE_RATE', 0.1),
        webVitalsEnabled: this.getEnvVarAsBoolean('VITE_WEB_VITALS_ENABLED', true)
      }
    };
  }

  private loadSecurityConfig(): SecurityConfig {
    return {
      csp: {
        enabled: this.getEnvVarAsBoolean('VITE_CSP_ENABLED', true),
        reportUri: this.getEnvVar('VITE_CSP_REPORT_URI')
      },
      https: {
        forceHttps: this.getEnvVarAsBoolean('VITE_FORCE_HTTPS', false),
        hstsEnabled: this.getEnvVarAsBoolean('VITE_HSTS_ENABLED', true)
      },
      privacy: {
        privacyMode: this.getEnvVarAsBoolean('VITE_PRIVACY_MODE', false),
        anonymousUsage: this.getEnvVarAsBoolean('VITE_ANONYMOUS_USAGE', true),
        gdprCompliance: this.getEnvVarAsBoolean('VITE_GDPR_COMPLIANCE', true)
      }
    };
  }

  private loadDevelopmentConfig(): DevelopmentConfig {
    return {
      tools: {
        enableDevtools: this.getEnvVarAsBoolean('VITE_ENABLE_DEVTOOLS', true),
        enableMockData: this.getEnvVarAsBoolean('VITE_ENABLE_MOCK_DATA', false),
        enableDebugMode: this.getEnvVarAsBoolean('VITE_ENABLE_DEBUG_MODE', false),
        showDevWarnings: this.getEnvVarAsBoolean('VITE_SHOW_DEV_WARNINGS', true)
      },
      hmr: {
        enabled: this.getEnvVarAsBoolean('VITE_HMR_ENABLED', true),
        port: this.getEnvVarAsNumber('VITE_HMR_PORT', 24678)
      },
      mock: {
        walletAddress: this.getEnvVar('VITE_MOCK_WALLET_ADDRESS', '0x742d35Cc6566C02B6b3f5bdAE9d8a3c23d5E7546'),
        walletBalance: this.getEnvVarAsNumber('VITE_MOCK_WALLET_BALANCE', 1000),
        apiDelay: this.getEnvVarAsNumber('VITE_MOCK_API_DELAY', 1000)
      }
    };
  }

  private loadBuildConfig(): BuildConfig {
    return {
      bundle: {
        analyzer: this.getEnvVarAsBoolean('VITE_BUNDLE_ANALYZER', false),
        sourceMaps: this.getEnvVarAsBoolean('VITE_SOURCE_MAPS', true),
        minify: this.getEnvVarAsBoolean('VITE_MINIFY', true),
        treeShaking: this.getEnvVarAsBoolean('VITE_TREE_SHAKING', true)
      },
      assets: {
        compressAssets: this.getEnvVarAsBoolean('VITE_COMPRESS_ASSETS', true),
        optimizeImages: this.getEnvVarAsBoolean('VITE_OPTIMIZE_IMAGES', true),
        lazyLoadImages: this.getEnvVarAsBoolean('VITE_LAZY_LOAD_IMAGES', true)
      },
      codeSplitting: {
        enabled: this.getEnvVarAsBoolean('VITE_CODE_SPLITTING', true),
        chunkSizeWarningLimit: this.getEnvVarAsNumber('VITE_CHUNK_SIZE_WARNING_LIMIT', 1000)
      }
    };
  }

  private loadExternalConfig(): ExternalConfig {
    return {
      social: {
        enableSharing: this.getEnvVarAsBoolean('VITE_ENABLE_SOCIAL_SHARING', true),
        twitterHandle: this.getEnvVar('VITE_TWITTER_HANDLE'),
        discordInvite: this.getEnvVar('VITE_DISCORD_INVITE')
      },
      support: {
        helpCenterUrl: this.getEnvVar('VITE_HELP_CENTER_URL'),
        supportEmail: this.getEnvVar('VITE_SUPPORT_EMAIL', 'support@example.com'),
        feedbackUrl: this.getEnvVar('VITE_FEEDBACK_URL')
      },
      links: {
        githubUrl: this.getEnvVar('VITE_GITHUB_URL'),
        documentationUrl: this.getEnvVar('VITE_DOCUMENTATION_URL'),
        blogUrl: this.getEnvVar('VITE_BLOG_URL')
      }
    };
  }

  private loadExperimentalConfig(): ExperimentalConfig {
    return {
      beta: {
        enabled: this.getEnvVarAsBoolean('VITE_BETA_FEATURES_ENABLED', false),
        experimentalUI: this.getEnvVarAsBoolean('VITE_EXPERIMENTAL_UI', false),
        aiPoweredSuggestions: this.getEnvVarAsBoolean('VITE_AI_POWERED_SUGGESTIONS', false),
        advancedAnalytics: this.getEnvVarAsBoolean('VITE_ADVANCED_ANALYTICS', false)
      },
      testing: {
        abTestingEnabled: this.getEnvVarAsBoolean('VITE_AB_TESTING_ENABLED', false),
        abTestingSegment: this.getEnvVar('VITE_AB_TESTING_SEGMENT')
      },
      rollout: {
        gradualRollout: this.getEnvVarAsBoolean('VITE_GRADUAL_ROLLOUT', false),
        rolloutPercentage: this.getEnvVarAsNumber('VITE_ROLLOUT_PERCENTAGE', 0)
      }
    };
  }

  // Environment variable helpers
  private getEnvVar(key: string, defaultValue?: string): string {
    const value = import.meta.env[key];
    return (typeof value === 'string' ? value : defaultValue) ?? '';
  }

  private getEnvVarAsNumber(key: string, defaultValue: number): number {
    const value = import.meta.env[key];
    return (typeof value === 'string' && value !== '') ? parseFloat(value) : defaultValue;
  }

  private getEnvVarAsBoolean(key: string, defaultValue: boolean): boolean {
    const value = import.meta.env[key];
    if (value === undefined) return defaultValue;
    return value === 'true';
  }

  private validateConfiguration(): void {
    const errors: string[] = [];
    
    // Validate API URLs
    if (!this.isValidUrl(this.config.api.baseUrl)) {
      errors.push('Invalid API base URL');
    }

    // Validate blockchain configuration
    if (this.config.blockchain.ethereum.chainId <= 0) {
      errors.push('Invalid Ethereum chain ID');
    }

    // Validate production requirements
    if (this.config.environment === 'production') {
      if (!this.config.contracts.escrowFactory) {
        errors.push('Escrow factory address required in production');
      }
      
      if (this.config.monitoring.analytics.enabled && !this.config.monitoring.analytics.googleAnalyticsId) {
        console.warn('Analytics enabled but no Google Analytics ID provided');
      }
    }

    if (errors.length > 0) {
      console.error('Configuration validation failed:');
      errors.forEach(error => console.error(`  - ${error}`));
      
      if (this.config.environment === 'production') {
        throw new Error('Configuration validation failed in production');
      }
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  public getConfig(): FrontendConfig {
    return this.config;
  }
}

// Create and export configuration instance
const configLoader = new ConfigurationLoader();
export const config = configLoader.getConfig();

// Configuration utilities
export function isDevelopment(): boolean {
  return config.environment === 'development';
}

export function isProduction(): boolean {
  return config.environment === 'production';
}

export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return config.features[feature];
}

export function getApiUrl(endpoint: string): string {
  return `${config.api.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

export function getBlockExplorerUrl(type: 'ethereum' | 'bitcoin', hash?: string): string {
  const baseUrl = type === 'ethereum' 
    ? config.blockchain.ethereum.blockExplorerUrl
    : config.blockchain.bitcoin.explorerUrl;
    
  return hash ? `${baseUrl}/tx/${hash}` : baseUrl;
}

export function getContractAddress(contract: keyof ContractAddresses): string | undefined {
  if (contract === 'tokens') return undefined;
  return config.contracts[contract];
}

export function getTokenAddress(token: keyof ContractAddresses['tokens']): string | undefined {
  return config.contracts.tokens[token];
}

export function validateRequiredConfig(): void {
  const required: string[] = [];
  
  if (config.environment === 'production') {
    if (!config.contracts.escrowFactory) required.push('VITE_ESCROW_FACTORY_ADDRESS');
    if (!config.api.baseUrl) required.push('VITE_API_BASE_URL');
  }
  
  if (required.length > 0) {
    throw new Error(`Missing required configuration: ${required.join(', ')}`);
  }
}

// Runtime configuration check
export function performRuntimeChecks(): void {
  try {
    validateRequiredConfig();
    console.log(`✅ Frontend configuration loaded successfully (${config.environment})`);
  } catch (error) {
    console.error('❌ Frontend configuration validation failed:', error);
    if (config.environment === 'production') {
      throw error;
    }
  }
}

// Auto-perform runtime checks
if (typeof window !== 'undefined') {
  performRuntimeChecks();
}

export default config;