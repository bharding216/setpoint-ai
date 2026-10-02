import * as StoreReview from 'expo-store-review';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const REVIEW_THRESHOLDS = [3, 5, 10, 15, 25, 50, 100];
const LAST_REVIEW_KEY = 'store_review_last_prompt';
const MIN_DAYS_BETWEEN_PROMPTS = 30;

async function tooRecentlyPrompted(): Promise<boolean> {
  try {
    const last = await SecureStore.getItemAsync(LAST_REVIEW_KEY);
    if (!last) return false;
    const daysSince =
      (Date.now() - parseInt(last, 10)) / (1000 * 60 * 60 * 24);
    return daysSince < MIN_DAYS_BETWEEN_PROMPTS;
  } catch {
    return false;
  }
}

async function recordPrompt() {
  try {
    await SecureStore.setItemAsync(LAST_REVIEW_KEY, Date.now().toString());
  } catch {}
}

async function requestIfAvailable(): Promise<boolean> {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;
    if (await tooRecentlyPrompted()) return false;
    await StoreReview.requestReview();
    await recordPrompt();
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompt for a review after completing a workout, at milestone counts.
 */
export async function maybeRequestReview(userId: string) {
  try {
    const { count } = await supabase
      .from('workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (count != null && REVIEW_THRESHOLDS.includes(count)) {
      await requestIfAvailable();
    }
  } catch {
    // Silent — never block the user for a review prompt
  }
}

/**
 * Prompt for a review after a successful CSV import.
 */
export async function maybeRequestReviewAfterImport() {
  try {
    await requestIfAvailable();
  } catch {}
}

/**
 * Manually trigger the native store review sheet (from Settings).
 * Returns false if the platform doesn't support it.
 */
export async function requestReviewManually(): Promise<boolean> {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
