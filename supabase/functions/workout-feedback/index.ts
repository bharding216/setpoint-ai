// Supabase Edge Function — workout-feedback
// Analyzes a completed workout using compact profile + recent context.
//
// Required secrets: OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";
import { checkUsageAllowance, logUsage } from "../_shared/usage.ts";
import { loadCompactProfile, formatWorkoutHistory } from "../_shared/ai-profile.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { user, supabase, serviceClient } = await authenticateUser(req);

    // ── Check usage limits ────────────────────────────────────

    const usage = await checkUsageAllowance(serviceClient, user.id);
    if (!usage.allowed) {
      return jsonError(usage.reason!, 429, usage.code);
    }

    const body = await req.json();
    const workoutId: string = body.workoutId;
    if (!workoutId) {
      return jsonError("workoutId is required", 400);
    }

    // ── Fetch the completed workout ───────────────────────────

    const { data: workout } = await supabase
      .from("workouts")
      .select(
        `
        date, type, status, notes, ai_summary,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order,
          exercise_sets ( set_number, weight, reps, rpe ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `,
      )
      .eq("id", workoutId)
      .eq("user_id", user.id)
      .single();

    if (!workout) {
      return jsonError("Workout not found", 404);
    }

    // ── Load compact profile ──────────────────────────────────

    const profileText = await loadCompactProfile(supabase, user.id);

    // ── Load only last 3 workouts for comparison ──────────────

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const sinceDate = twoWeeksAgo.toISOString().split("T")[0];

    const { data: recentWorkouts } = await supabase
      .from("workouts")
      .select(
        `
        id, date, type, status, notes,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order,
          exercise_sets ( set_number, weight, reps, rpe ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `,
      )
      .eq("user_id", user.id)
      .neq("id", workoutId)
      .in("status", ["completed", "in_progress"])
      .gte("date", sinceDate)
      .order("date", { ascending: false })
      .limit(3);

    const historyText = formatWorkoutHistory(recentWorkouts ?? []);

    // ── Upcoming planned workouts (limit 3) ───────────────────

    const todayStr = new Date().toISOString().split("T")[0];
    const { data: upcomingPlans } = await supabase
      .from("workouts")
      .select(
        `
        id, date, type, status,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order,
          exercise_sets ( set_number, weight, reps )
        )
      `,
      )
      .eq("user_id", user.id)
      .eq("status", "planned")
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(3);

    // ── Format the completed workout ──────────────────────────

    const formatExercises = (exercises: any[], onlyActual: boolean) => {
      const filtered = onlyActual
        ? exercises.filter((e: any) => !e.is_planned)
        : exercises;
      return filtered
        .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
        .map((e: any) => {
          if (e.exercise_type === "cardio") {
            const c = e.cardio_entries?.[0];
            if (!c) return `  ${e.name}: no data`;
            const parts = [e.name + ":"];
            if (c.duration_minutes) parts.push(`${c.duration_minutes} min`);
            if (c.distance) parts.push(`${c.distance} mi`);
            if (c.pace) parts.push(`pace ${c.pace}`);
            if (c.heart_rate) parts.push(`HR ${c.heart_rate}`);
            return "  " + parts.join(", ");
          }
          const sets = (e.exercise_sets ?? []).sort(
            (a: any, b: any) => a.set_number - b.set_number,
          );
          if (sets.length === 0) return `  ${e.name}: no sets`;
          const setStrs = sets.map((s: any) => {
            let str = "";
            if (s.weight != null) str += `${s.weight}`;
            if (s.reps != null) str += `\u00d7${s.reps}`;
            if (s.rpe != null) str += ` @${s.rpe}`;
            return str || "\u2014";
          });
          return `  ${e.name}: ${setStrs.join(", ")}`;
        })
        .join("\n");
    };

    const completedActual = formatExercises(
      (workout.workout_exercises ?? []).filter((e: any) => !e.is_planned),
      false,
    );
    const completedPlannedOnly = formatExercises(
      (workout.workout_exercises ?? []).filter((e: any) => e.is_planned),
      false,
    );

    // Format upcoming plans
    const upcomingLines: string[] = [];
    for (const w of upcomingPlans ?? []) {
      const planned = (w.workout_exercises ?? []).filter(
        (e: any) => e.is_planned,
      );
      if (planned.length === 0) continue;
      upcomingLines.push(
        `${w.date} \u2014 ${w.type ?? "Workout"} (planned)`,
      );
      upcomingLines.push(formatExercises(planned, false));
      upcomingLines.push("");
    }

    // ── Build prompt ──────────────────────────────────────────

    const systemPrompt = `You are Setpoint, an AI personal training coach. The user just completed a workout. Analyze it and provide feedback.

USER PROFILE:
${profileText}

COMPLETED WORKOUT \u2014 ${workout.date} \u2014 ${workout.type ?? "Workout"}
${completedPlannedOnly ? `Planned:\n${completedPlannedOnly}` : ""}
Actual:
${completedActual || "  (no exercises logged)"}

RECENT HISTORY (for comparison):
${historyText}

UPCOMING PLANNED WORKOUTS:
${upcomingLines.length > 0 ? upcomingLines.join("\n") : "(No upcoming plans)"}

INSTRUCTIONS:
1. Compare what they planned vs what they actually did. Note any deviations.
2. Compare today's performance to recent history for the same exercises. Note progression, regression, or plateaus.
3. Evaluate recovery implications \u2014 did they push hard? Will they need extra recovery?
4. Look at upcoming planned workouts and recommend adjustments if needed based on today's effort.
5. Keep the tone encouraging and coach-like. Be specific with numbers.
6. If there are upcoming plans that should be adjusted, explain why and what to change.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "performance_summary": "2-3 sentences about how the workout went compared to plan and recent history.",
  "progression_notes": "1-2 sentences about progression trends (strength gains, endurance changes, etc).",
  "recovery_note": "1 sentence about recovery outlook.",
  "plan_adjustments": [
    {
      "date": "YYYY-MM-DD",
      "workout_type": "The planned session type",
      "suggestion": "What to adjust and why"
    }
  ],
  "coach_tip": "One practical, specific tip for their next session."
}

If no plan adjustments are needed, return an empty array for plan_adjustments.`;

    // ── Call OpenAI ────────────────────────────────────────────

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonError("OPENAI_API_KEY not configured", 500);
    }

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content:
                "How did my workout go? Should I adjust anything coming up?",
            },
          ],
          temperature: 0.7,
          max_tokens: 1200,
        }),
      },
    );

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI error:", errText);
      return jsonError("AI service error", 502);
    }

    const aiData = await openaiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      return jsonError("Empty AI response", 502);
    }

    // ── Log usage ─────────────────────────────────────────────

    await logUsage(
      serviceClient,
      user.id,
      "workout-feedback",
      "gpt-4o",
      aiData.usage ?? {},
    );

    // ── Parse response ────────────────────────────────────────

    let feedback;
    try {
      const cleaned = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      feedback = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI feedback:", content);
      return jsonError("Could not parse AI response", 502);
    }

    return jsonOk(feedback);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});
