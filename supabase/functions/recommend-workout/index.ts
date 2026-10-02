// Supabase Edge Function — recommend-workout
// Uses compact AI profile + limited recent history for cost-efficient recommendations.
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
    const requestedDate: string =
      body.date ?? new Date().toISOString().split("T")[0];

    // ── Load compact profile ──────────────────────────────────

    const profileText = await loadCompactProfile(supabase, user.id);

    // ── Load only last 5 workouts (instead of 20) ─────────────

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 14);
    const sinceDate = sevenDaysAgo.toISOString().split("T")[0];

    const { data: recentWorkouts } = await supabase
      .from("workouts")
      .select(
        `
        date, type, status, notes,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order, equipment_count,
          exercise_sets ( set_number, weight, reps, rpe ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `,
      )
      .eq("user_id", user.id)
      .gte("date", sinceDate)
      .order("date", { ascending: false })
      .limit(5);

    const historyText = formatWorkoutHistory(recentWorkouts ?? []);

    // ── Today's context ───────────────────────────────────────

    const todayDate = new Date(requestedDate + "T12:00:00Z");
    const dayOfWeek = todayDate.getDay();
    const dayNames = [
      "Sunday", "Monday", "Tuesday", "Wednesday",
      "Thursday", "Friday", "Saturday",
    ];

    const { data: schedule } = await supabase
      .from("weekly_schedule")
      .select("day_of_week, session_type")
      .eq("user_id", user.id)
      .order("day_of_week");

    const todaySchedule = schedule?.find(
      (s: any) => s.day_of_week === dayOfWeek,
    );

    // ── Build system prompt (compact) ─────────────────────────

    const systemPrompt = `You are Setpoint, an AI personal training coach. You analyze the user's training profile and recent history to recommend their next workout.

USER PROFILE:
${profileText}

RECENT WORKOUTS (last 5 sessions):
${historyText}

TODAY: ${dayNames[dayOfWeek]}, ${requestedDate}
${todaySchedule ? `SCHEDULED SESSION: ${todaySchedule.session_type}` : "No session scheduled for today."}

INSTRUCTIONS:
1. Analyze the user's profile, recent training, scheduled session type, and goals.
2. Consider fatigue, progressive overload, and recovery.
3. Recommend a concrete workout for today.
4. Explain your reasoning briefly — reference specific recent workouts, progression, and recovery needs.
5. For strength exercises, suggest specific weight, reps, and sets based on their recent performance.
   - Include "equipment_count" to indicate how many pieces of equipment are used simultaneously:
     - Bilateral dumbbell exercises (DB Bench Press, DB Rows, DB Shoulder Press, etc.): equipment_count = 2, weight = per-dumbbell weight
     - Single dumbbell/kettlebell exercises (Goblet Squat, Concentration Curl): equipment_count = 1
     - Barbell exercises: equipment_count = 1, weight = total barbell weight
     - Machine / bodyweight exercises: equipment_count = 1 (or omit)
6. For cardio, suggest duration, distance, or pace as appropriate.
7. If they have no history yet, create a reasonable introductory workout based on their preferences and schedule.

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "Brief explanation of your reasoning (2-4 sentences referencing their recent training)",
  "workout": {
    "type": "Session type name",
    "exercises": [
      {
        "name": "Exercise Name",
        "exercise_type": "strength",
        "sets": 3,
        "reps": 5,
        "weight": 185,
        "equipment_count": 1
      },
      {
        "name": "Dumbbell Row",
        "exercise_type": "strength",
        "sets": 3,
        "reps": 10,
        "weight": 40,
        "equipment_count": 2
      },
      {
        "name": "Running",
        "exercise_type": "cardio",
        "duration_minutes": 30,
        "distance": 3.0,
        "pace": "10:00/mi"
      }
    ]
  }
}`;

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
            { role: "user", content: "What should I do today?" },
          ],
          temperature: 0.7,
          max_tokens: 1500,
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
      "recommend-workout",
      "gpt-4o",
      aiData.usage ?? {},
    );

    // ── Parse response ────────────────────────────────────────

    let recommendation;
    try {
      const cleaned = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      recommendation = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return jsonError("Could not parse AI response", 502);
    }

    if (
      !recommendation.workout?.exercises ||
      !Array.isArray(recommendation.workout.exercises)
    ) {
      return jsonError("Invalid AI response structure", 502);
    }

    return jsonOk(recommendation);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});
