// Supabase Edge Function — rebuild-ai-profile
// Computes and upserts a compact AI profile for a user.
// Called after workout completion or preference changes.
//
// No OpenAI key needed — pure data computation.

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { user, supabase, serviceClient } = await authenticateUser(req);

    // ── Load raw data ───────────────────────────────────────

    const [
      { data: preferences },
      { data: schedule },
      { data: recentWorkouts },
    ] = await Promise.all([
      supabase
        .from("training_preferences")
        .select("content, category")
        .eq("user_id", user.id),
      supabase
        .from("weekly_schedule")
        .select("day_of_week, session_type")
        .eq("user_id", user.id)
        .order("day_of_week"),
      supabase
        .from("workouts")
        .select(
          `
          date, type, status, notes,
          workout_exercises (
            name, exercise_type, is_planned, exercise_order,
            exercise_sets ( set_number, weight, reps, rpe ),
            cardio_entries ( duration_minutes, distance, pace, heart_rate )
          )
        `,
        )
        .eq("user_id", user.id)
        .in("status", ["completed", "in_progress"])
        .gte(
          "date",
          new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0],
        )
        .order("date", { ascending: false })
        .limit(30),
    ]);

    // ── Extract goals, preferences, equipment ───────────────

    const goals = (preferences ?? [])
      .filter((p: any) => p.category === "goal")
      .map((p: any) => p.content);

    const prefs = (preferences ?? [])
      .filter((p: any) => p.category === "preference")
      .map((p: any) => p.content);

    const equipment = (preferences ?? [])
      .filter((p: any) => p.category === "equipment")
      .map((p: any) => p.content);

    // ── Compute training split from schedule ────────────────

    const dayNames = [
      "Sunday", "Monday", "Tuesday", "Wednesday",
      "Thursday", "Friday", "Saturday",
    ];

    const scheduleDays = (schedule ?? []).map(
      (s: any) => `${dayNames[s.day_of_week]}: ${s.session_type}`,
    );
    const sessionTypes = (schedule ?? []).map((s: any) => s.session_type);
    const uniqueTypes: Record<string, number> = {};
    for (const t of sessionTypes) {
      uniqueTypes[t] = (uniqueTypes[t] ?? 0) + 1;
    }
    const splitSummary =
      Object.entries(uniqueTypes)
        .map(([type, count]) => `${count} ${type}`)
        .join(" / ") +
      ` / ${7 - sessionTypes.length} rest`;

    // ── Compute recent benchmarks ───────────────────────────

    const exerciseHistory: Record<
      string,
      { type: string; entries: any[] }
    > = {};

    for (const w of recentWorkouts ?? []) {
      const actual = (w.workout_exercises ?? []).filter(
        (e: any) => !e.is_planned,
      );
      for (const e of actual) {
        if (!exerciseHistory[e.name]) {
          exerciseHistory[e.name] = { type: e.exercise_type, entries: [] };
        }
        exerciseHistory[e.name].entries.push({
          date: w.date,
          sets: e.exercise_sets ?? [],
          cardio: e.cardio_entries?.[0] ?? null,
        });
      }
    }

    const recentBenchmarks: Record<
      string,
      { best_recent: string; trend: string }
    > = {};

    for (const [name, data] of Object.entries(exerciseHistory)) {
      if (data.entries.length === 0) continue;

      if (data.type === "strength") {
        // Find best recent set (heaviest weight x reps)
        let bestStr = "";
        let bestVolume = 0;
        let latestVolume = 0;
        let earliestVolume = 0;

        for (let i = 0; i < data.entries.length; i++) {
          const entry = data.entries[i];
          for (const set of entry.sets) {
            const vol = (set.weight ?? 0) * (set.reps ?? 0);
            if (vol > bestVolume) {
              bestVolume = vol;
              const w = set.weight ?? 0;
              const r = set.reps ?? 0;
              const numSets = entry.sets.filter(
                (s: any) => s.weight === set.weight && s.reps === set.reps,
              ).length;
              bestStr =
                numSets > 1 ? `${w}\u00d7${r}\u00d7${numSets}` : `${w}\u00d7${r}`;
            }
          }
          // Track first and last for trend
          const entryMaxVol = Math.max(
            ...entry.sets.map((s: any) => (s.weight ?? 0) * (s.reps ?? 0)),
            0,
          );
          if (i === 0) latestVolume = entryMaxVol;
          earliestVolume = entryMaxVol;
        }

        const trend =
          latestVolume > earliestVolume * 1.02
            ? "progressing"
            : latestVolume < earliestVolume * 0.98
              ? "regressing"
              : "maintaining";

        if (bestStr) {
          recentBenchmarks[name] = { best_recent: bestStr, trend };
        }
      } else if (data.type === "cardio") {
        const latest = data.entries[0]?.cardio;
        if (!latest) continue;
        const parts: string[] = [];
        if (latest.duration_minutes) parts.push(`${latest.duration_minutes} min`);
        if (latest.distance) parts.push(`${latest.distance} mi`);
        if (latest.pace) parts.push(`pace ${latest.pace}`);
        const bestStr = parts.join(", ") || "logged";

        const earliest = data.entries[data.entries.length - 1]?.cardio;
        let trend = "maintaining";
        if (earliest?.pace && latest?.pace) {
          const parsePace = (p: string) => {
            const m = p.match(/(\d+):(\d+)/);
            return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : Infinity;
          };
          const latestSecs = parsePace(latest.pace);
          const earliestSecs = parsePace(earliest.pace);
          trend =
            latestSecs < earliestSecs * 0.98
              ? "progressing"
              : latestSecs > earliestSecs * 1.02
                ? "regressing"
                : "maintaining";
        }
        recentBenchmarks[name] = { best_recent: bestStr, trend };
      }
    }

    // ── Compute training consistency ────────────────────────

    const completedCount = (recentWorkouts ?? []).filter(
      (w: any) => w.status === "completed",
    ).length;
    const weeksSpan = 4;
    const sessionsPerWeek = (completedCount / weeksSpan).toFixed(1);
    const trainingConsistency = `${sessionsPerWeek} sessions/week avg (last 4 weeks)`;

    // ── Compute fatigue notes ───────────────────────────────

    const last3 = (recentWorkouts ?? []).slice(0, 3);
    const recentTypes = last3
      .map((w: any) => w.type ?? "General")
      .join(", ");
    const fatigueNotes =
      last3.length > 0
        ? `Last ${last3.length} sessions: ${recentTypes}`
        : "No recent sessions";

    // ── Build and upsert profile ────────────────────────────

    const profileData = {
      goals,
      training_split: splitSummary,
      equipment,
      preferences: prefs,
      recent_benchmarks: recentBenchmarks,
      training_consistency: trainingConsistency,
      fatigue_notes: fatigueNotes,
    };

    const { error: upsertError } = await serviceClient
      .from("user_ai_profiles")
      .upsert(
        {
          user_id: user.id,
          profile_data: profileData,
          last_rebuilt_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      console.error("Profile upsert error:", upsertError);
      return jsonError("Failed to save AI profile", 500);
    }

    return jsonOk({
      message: "AI profile rebuilt",
      profile_data: profileData,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});
