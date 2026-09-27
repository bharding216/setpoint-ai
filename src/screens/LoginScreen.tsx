import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing } from '../theme';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'welcome' | 'email' | 'email-verify' | 'password';

const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

export default function LoginScreen() {
  const {
    signIn,
    signInWithApple,
    signInWithGoogle,
    signInWithOtp,
    verifyOtp,
    resetPassword,
    isAppleSignInAvailable,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);

  // ─── Google Auth Session ────────────────────────────────

  const googleEnabled = !!GOOGLE_WEB_CLIENT_ID;

  const [googleRequest, googleResponse, promptGoogleAsync] =
    Google.useAuthRequest({
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.params?.id_token;
      if (idToken) {
        handleGoogleToken(idToken);
      }
    }
  }, [googleResponse]);

  const handleGoogleToken = async (idToken: string) => {
    setLoading(true);
    const { error } = await signInWithGoogle(idToken);
    setLoading(false);
    if (error) {
      Alert.alert('Sign In Failed', error.message);
    }
  };

  // ─── Apple Sign In ─────────────────────────────────────

  const handleAppleSignIn = async () => {
    setLoading(true);
    const { error } = await signInWithApple();
    setLoading(false);
    if (error) {
      Alert.alert('Sign In Failed', error.message);
    }
  };

  // ─── Google Sign In ────────────────────────────────────

  const handleGoogleSignIn = async () => {
    if (!googleEnabled) return;
    setLoading(true);
    try {
      await promptGoogleAsync();
    } catch {
      Alert.alert('Error', 'Could not open Google sign-in.');
    }
    setLoading(false);
  };

  // ─── Email OTP ─────────────────────────────────────────

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }
    setLoading(true);
    const { error } = await signInWithOtp(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setMode('email-verify');
    }
  };

  const handleVerifyCode = async () => {
    if (!otpCode.trim()) {
      Alert.alert('Error', 'Please enter the verification code.');
      return;
    }
    setLoading(true);
    const { error } = await verifyOtp(email.trim(), otpCode.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Verification Failed', error.message);
    }
  };

  // ─── Password Sign In (existing users) ─────────────────

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Sign In Failed', error.message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Reset Password', 'Enter your email address first.');
      return;
    }
    const { error } = await resetPassword(email.trim());
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Check Your Email', 'A password reset link has been sent.');
    }
  };

  // ─── Render ────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {/* Branding */}
        <View style={styles.brandContainer}>
          <Text style={styles.title}>SETPOINT</Text>
          <Text style={styles.subtitle}>AI</Text>
          {mode === 'welcome' && (
            <Text style={styles.tagline}>
              AI-powered training, personalized for you
            </Text>
          )}
        </View>

        {/* ── Welcome Mode ──────────────────────────────── */}
        {mode === 'welcome' && (
          <View style={styles.authButtons}>
            {/* Apple Sign In */}
            {isAppleSignInAvailable && (
              <TouchableOpacity
                style={[styles.socialButton, styles.appleButton]}
                onPress={handleAppleSignIn}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={styles.appleButtonText}>
                  Continue with Apple
                </Text>
              </TouchableOpacity>
            )}

            {/* Google Sign In */}
            {googleEnabled && (
              <TouchableOpacity
                style={[styles.socialButton, styles.googleButton]}
                onPress={handleGoogleSignIn}
                disabled={loading || !googleRequest}
                activeOpacity={0.8}
              >
                <Text style={styles.googleButtonText}>
                  Continue with Google
                </Text>
              </TouchableOpacity>
            )}

            {/* Email OTP */}
            <TouchableOpacity
              style={[styles.socialButton, styles.emailButton]}
              onPress={() => setMode('email')}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.emailButtonText}>
                Continue with Email
              </Text>
            </TouchableOpacity>

            {loading && (
              <ActivityIndicator
                color={colors.primary}
                style={{ marginTop: spacing.md }}
              />
            )}

            {/* Password link for existing users */}
            <TouchableOpacity
              onPress={() => setMode('password')}
              activeOpacity={0.6}
              style={styles.existingUserLink}
            >
              <Text style={styles.existingUserText}>
                Sign in with password
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Email OTP Mode ────────────────────────────── */}
        {mode === 'email' && (
          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>
              Enter your email
            </Text>
            <Text style={styles.formSubtitle}>
              We'll send you a sign-in code. No password needed.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleSendCode}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Send Code</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode('welcome')}
              activeOpacity={0.6}
            >
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Email Verify Mode ─────────────────────────── */}
        {mode === 'email-verify' && (
          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>
              Check your email
            </Text>
            <Text style={styles.formSubtitle}>
              Enter the 6-digit code sent to {email}
            </Text>

            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="000000"
              value={otpCode}
              onChangeText={(text) => {
                setOtpCode(text.replace(/[^0-9]/g, '').slice(0, 6));
              }}
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleVerifyCode}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleVerifyCode}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Verify</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSendCode}
              activeOpacity={0.6}
            >
              <Text style={styles.resendText}>Resend code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setOtpCode('');
                setMode('email');
              }}
              activeOpacity={0.6}
            >
              <Text style={styles.backText}>Change email</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Password Mode (existing users) ────────────── */}
        {mode === 'password' && (
          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>Sign in</Text>

            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handlePasswordSignIn}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handlePasswordSignIn}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleForgotPassword}
              activeOpacity={0.6}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode('welcome')}
              activeOpacity={0.6}
            >
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  // Branding
  brandContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl * 2,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.brand.ai,
    textAlign: 'center',
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  // Auth buttons (welcome mode)
  authButtons: {
    gap: spacing.sm,
  },
  socialButton: {
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
  },
  appleButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  emailButton: {
    backgroundColor: colors.primary,
  },
  emailButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  existingUserLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  existingUserText: {
    color: colors.textSecondary,
    fontSize: 14,
  },

  // Form modes
  formContainer: {
    gap: spacing.sm,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  formSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // Shared form elements
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  resendText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  backText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
