import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SymbolView } from 'expo-symbols';
import * as SplashScreen from 'expo-splash-screen';

import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';

import LoginScreen from '../screens/LoginScreen';
import TodayScreen from '../screens/TodayScreen';
import WorkoutScreen from '../screens/WorkoutScreen';
import CalendarScreen from '../screens/CalendarScreen';
import ProgressScreen from '../screens/ProgressScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TrainingProfileScreen from '../screens/TrainingProfileScreen';
import BaselineScreen from '../screens/BaselineScreen';
import PaywallScreen from '../screens/PaywallScreen';

export type RootStackParamList = {
  MainTabs: undefined;
  WorkoutScreen: { workoutId: string; mode?: 'log' | 'plan' };
  TrainingProfileScreen: undefined;
  BaselineScreen: undefined;
  PaywallScreen: undefined;
  Login: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', color: colors.text },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          headerShown: false,
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name="bolt.fill"
              tintColor={color}
              style={{ width: size, height: size }}
              type="monochrome"
            />
          ),
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          title: 'Calendar',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name="calendar"
              tintColor={color}
              style={{ width: size, height: size }}
              type="monochrome"
            />
          ),
        }}
      />
      <Tab.Screen
        name="Progress"
        component={ProgressScreen}
        options={{
          title: 'Progress',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name="chart.line.uptrend.xyaxis"
              tintColor={color}
              style={{ width: size, height: size }}
              type="monochrome"
            />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name="gearshape.fill"
              tintColor={color}
              style={{ width: size, height: size }}
              type="monochrome"
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hide();
    }
  }, [loading]);

  if (loading) {
    return null;
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <>
            <RootStack.Screen name="MainTabs" component={MainTabs} />
            <RootStack.Screen
              name="WorkoutScreen"
              component={WorkoutScreen}
              options={{
                headerShown: true,
                title: 'Workout',
                headerBackTitle: 'Back',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerTitleStyle: { color: colors.text },
                headerShadowVisible: false,
                presentation: 'card',
              }}
            />
            <RootStack.Screen
              name="TrainingProfileScreen"
              component={TrainingProfileScreen}
              options={{
                headerShown: true,
                title: 'Training Profile',
                headerBackTitle: 'Settings',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerTitleStyle: { color: colors.text },
                headerShadowVisible: false,
                presentation: 'card',
              }}
            />
            <RootStack.Screen
              name="BaselineScreen"
              component={BaselineScreen}
              options={{
                headerShown: true,
                title: 'Fitness Baseline',
                headerBackTitle: 'Settings',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerTitleStyle: { color: colors.text },
                headerShadowVisible: false,
                presentation: 'card',
              }}
            />
            <RootStack.Screen
              name="PaywallScreen"
              component={PaywallScreen}
              options={{
                headerShown: true,
                title: '',
                headerBackTitle: 'Back',
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerShadowVisible: false,
                presentation: 'modal',
              }}
            />
          </>
        ) : (
          <RootStack.Screen name="Login" component={LoginScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
