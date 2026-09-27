import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signInWithGoogle: (idToken: string) => Promise<{ error: Error | null }>;
  signInWithOtp: (email: string) => Promise<{ error: Error | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  isAppleSignInAvailable: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAppleSignInAvailable, setIsAppleSignInAvailable] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setIsAppleSignInAvailable);
    }
  }, []);

  // ─── Email + password (existing users) ──────────────────

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  // ─── Apple Sign In ──────────────────────────────────────

  const signInWithApple = async (): Promise<{ error: Error | null }> => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        return { error: new Error('No identity token returned from Apple') };
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });

      // If Apple provided a name (first sign-in only), update the profile
      if (!error && credential.fullName) {
        const displayName = [
          credential.fullName.givenName,
          credential.fullName.familyName,
        ]
          .filter(Boolean)
          .join(' ');
        if (displayName) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase
              .from('profiles')
              .update({ display_name: displayName })
              .eq('id', user.id);
          }
        }
      }

      return { error };
    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') {
        return { error: null }; // User canceled — not an error
      }
      return { error: e };
    }
  };

  // ─── Google Sign In (receives idToken from login screen) ─

  const signInWithGoogle = async (
    idToken: string,
  ): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    return { error };
  };

  // ─── Email OTP (magic code) ─────────────────────────────

  const signInWithOtp = async (
    email: string,
  ): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    return { error };
  };

  const verifyOtp = async (
    email: string,
    token: string,
  ): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    return { error };
  };

  // ─── Password reset ────────────────────────────────────

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
  };

  // ─── Sign out ──────────────────────────────────────────

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signInWithApple,
        signInWithGoogle,
        signInWithOtp,
        verifyOtp,
        signOut,
        resetPassword,
        isAppleSignInAvailable,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
