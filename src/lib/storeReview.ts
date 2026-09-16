import * as StoreReview from 'expo-store-review';
import { supabase } from './supabase';

const REVIEW_THRESHOLDS = [5, 15, 50];

export async function maybeRequestReview(userId: string) {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;

    const { count } = await supabase
      .from('workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (count != null && REVIEW_THRESHOLDS.includes(count)) {
      await StoreReview.requestReview();
    }
  } catch {
    // Silent — never block the user for a review prompt
  }
}
