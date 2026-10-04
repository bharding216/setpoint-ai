import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Load the compact AI profile for a user as a text block suitable for
 * inclusion in a system prompt. Falls back to raw preferences/schedule
 * if no profile has been built yet.
 */
export async function loadCompactProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const [{ data: aiProfile }, { data: baseline }] = await Promise.all([
    supabase
      .from("user_ai_profiles")
      .select("profile_data")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("fitness_baselines")
      .select("experience_level, benchmarks, notes")
      .eq("user_id", userId)
      .single(),
  ]);

  const sections: string[] = [];

  if (aiProfile?.profile_data && Object.keys(aiProfile.profile_data).length > 0) {
    sections.push(formatProfileData(aiProfile.profile_data));
  } else {
    // Fallback: build inline from raw data (first-time user or profile not yet built)
    sections.push(await buildInlineProfile(supabase, userId));
  }

  if (baseline) {
    const baselineText = formatBaseline(baseline);
    if (baselineText) sections.push(baselineText);
  }

  return sections.join("\n\n");
}

function formatProfileData(data: any): string {
  const sections: string[] = [];

  if (data.goals?.length > 0) {
    sections.push("GOALS:\n" + data.goals.map((g: string) => `  - ${g}`).join("\n"));
  }

  if (data.training_split) {
    sections.push(`TRAINING SPLIT: ${data.training_split}`);
  }

  if (data.equipment?.length > 0) {
    sections.push("EQUIPMENT:\n" + data.equipment.map((e: string) => `  - ${e}`).join("\n"));
  }

  if (data.preferences?.length > 0) {
    sections.push("PREFERENCES:\n" + data.preferences.map((p: string) => `  - ${p}`).join("\n"));
  }

  if (data.recent_benchmarks && Object.keys(data.recent_benchmarks).length > 0) {
    const benchLines = Object.entries(data.recent_benchmarks).map(
      ([exercise, info]: [string, any]) =>
        `  ${exercise}: ${info.best_recent} (${info.trend})`
    );
    sections.push("RECENT PERFORMANCE:\n" + benchLines.join("\n"));
  }

  if (data.training_consistency) {
    sections.push(`CONSISTENCY: ${data.training_consistency}`);
  }

  if (data.fatigue_notes) {
    sections.push(`FATIGUE NOTES: ${data.fatigue_notes}`);
  }

  return sections.join("\n\n");
}

function formatBaseline(baseline: any): string {
  const sections: string[] = [];

  if (baseline.experience_level) {
    sections.push(`EXPERIENCE LEVEL: ${baseline.experience_level}`);
  }

  const bm = baseline.benchmarks ?? {};

  if (bm.strength && Object.keys(bm.strength).length > 0) {
    const lines = Object.entries(bm.strength).map(
      ([key, val]: [string, any]) => {
        const name = key
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        const parts: string[] = [];
        if (val.weight != null) parts.push(`${val.weight} lbs`);
        if (val.reps != null) parts.push(`${val.reps} reps`);
        return `  ${name}: ${parts.join(" × ")}`;
      },
    );
    sections.push(
      "SELF-REPORTED STRENGTH BASELINES (user-provided starting point):\n" +
        lines.join("\n"),
    );
  }

  if (bm.cardio && Object.keys(bm.cardio).length > 0) {
    const lines: string[] = [];
    if (bm.cardio.run_pace) lines.push(`  Running — easy pace: ${bm.cardio.run_pace}/mi`);
    if (bm.cardio.swim_pace) lines.push(`  Swimming: ${bm.cardio.swim_pace}`);
    if (bm.cardio.bike_pace) lines.push(`  Cycling: ${bm.cardio.bike_pace}`);
    if (bm.cardio.notes) lines.push(`  Other: ${bm.cardio.notes}`);
    if (lines.length > 0) {
      sections.push(
        "SELF-REPORTED CARDIO BASELINES:\n" + lines.join("\n"),
      );
    }
  }

  if (baseline.notes) {
    sections.push(`ATHLETE NOTES: ${baseline.notes}`);
  }

  return sections.join("\n\n");
}

async function buildInlineProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: preferences } = await supabase
    .from("training_preferences")
    .select("content, category")
    .eq("user_id", userId);

  const { data: schedule } = await supabase
    .from("weekly_schedule")
    .select("day_of_week, session_type")
    .eq("user_id", userId)
    .order("day_of_week");

  const dayNames = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday",
  ];

  const sections: string[] = [];

  const goals = preferences?.filter((p: any) => p.category === "goal")
    .map((p: any) => `  - ${p.content}`).join("\n");
  sections.push("GOALS:\n" + (goals || "  (No goals set)"));

  const prefs = preferences?.filter((p: any) => p.category === "preference")
    .map((p: any) => `  - ${p.content}`).join("\n");
  sections.push("PREFERENCES:\n" + (prefs || "  (No preferences set)"));

  const equipment = preferences?.filter((p: any) => p.category === "equipment")
    .map((p: any) => `  - ${p.content}`).join("\n");
  sections.push("EQUIPMENT:\n" + (equipment || "  (No equipment listed)"));

  const schedText = schedule && schedule.length > 0
    ? schedule.map((s: any) => `  ${dayNames[s.day_of_week]}: ${s.session_type}`).join("\n")
    : "  (No schedule set)";
  sections.push("WEEKLY SCHEDULE:\n" + schedText);

  return sections.join("\n\n");
}

/**
 * Format recent workouts into a compact text summary.
 * Used by Edge Functions to include only the last N workouts in the prompt.
 */
export function formatWorkoutHistory(workouts: any[]): string {
  const lines: string[] = [];

  for (const w of workouts) {
    if (w.status === "planned") continue;
    const actual = (w.workout_exercises ?? []).filter((e: any) => !e.is_planned);
    if (actual.length === 0) continue;

    const exSummaries = actual
      .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
      .map((e: any) => {
        const ecTag = e.equipment_count > 1 ? ` (×${e.equipment_count})` : "";
        if (e.exercise_type === "cardio") {
          const c = e.cardio_entries?.[0];
          if (!c) return `  ${e.name}`;
          const parts = [e.name + ecTag + ":"];
          if (c.duration_minutes) parts.push(`${c.duration_minutes} min`);
          if (c.distance) parts.push(`${c.distance} mi`);
          if (c.pace) parts.push(`pace ${c.pace}`);
          if (c.heart_rate) parts.push(`HR ${c.heart_rate}`);
          return "  " + parts.join(", ");
        }

        const sets = (e.exercise_sets ?? []).sort(
          (a: any, b: any) => a.set_number - b.set_number,
        );
        if (sets.length === 0) return `  ${e.name}${ecTag}: no sets logged`;

        const setStrs = sets.map((s: any) => {
          let str = "";
          if (s.weight != null) str += `${s.weight}`;
          if (s.reps != null) str += `\u00d7${s.reps}`;
          if (s.rpe != null) str += ` @${s.rpe}`;
          return str || "\u2014";
        });

        return `  ${e.name}${ecTag}: ${setStrs.join(", ")}`;
      });

    lines.push(
      `${w.date} \u2014 ${w.type ?? "Workout"} (${w.status})${w.notes ? " [" + w.notes + "]" : ""}`,
    );
    lines.push(...exSummaries);
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n") : "(No workouts logged yet)";
}
