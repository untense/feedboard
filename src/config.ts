import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  taostats: {
    apiKey: process.env.TAOSTATS_API_KEY || '',
    apiUrl: process.env.TAOSTATS_API_URL || 'https://api.taostats.io',
  },
};

// Validate required configuration
if (!config.taostats.apiKey && config.nodeEnv === 'production') {
  console.warn('WARNING: TAOSTATS_API_KEY is not set. The application may not work correctly.');
}
