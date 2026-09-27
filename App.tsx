import React from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import { SubscriptionProvider } from './src/contexts/SubscriptionContext';
import AppNavigator from './src/navigation/AppNavigator';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 400, fade: true });

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <AppNavigator />
            <StatusBar style="light" />
          </SubscriptionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
