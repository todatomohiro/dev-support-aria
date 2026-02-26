import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.butler.assistant',
  appName: 'Butler Assistant',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Preferences: {
      group: 'ButlerAssistantSettings',
    },
  },
};

export default config;
