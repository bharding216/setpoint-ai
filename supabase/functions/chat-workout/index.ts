// Supabase Edge Function — chat-workout
// Multi-turn conversational workout planner using compact AI profile.
//
// Required secrets: OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";
import { checkUsageAllowance, logUsage } from "../_shared/usage.ts";
import {
  loadCompactProfile,
  formatWorkoutHistory,
} from "../_shared/ai-profile.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { user, supabase, serviceClient } = await authenticateUser(req);

    const usage = await checkUsageAllowance(serviceClient, user.id);
    if (!usage.allowed) {
      return jsonError(usage.reason!, 429, usage.code);
    }

    const body = await req.json();
    const messages: { role: string; content: string }[] = body.messages ?? [];
    const date: string =
      body.date ?? new Date().toISOString().split("T")[0];

    // ── Load profile & recent history ─────────────────────────

    const profileText = await loadCompactProfile(supabase, user.id);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const sinceDate = fourteenDaysAgo.toISOString().split("T")[0];

    const { data: recentWorkouts } = await supabase
      .from("workouts")
      .select(
        `
        date, type, status, notes,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order,
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

    const todayDate = new Date(date + "T12:00:00Z");
    const dayOfWeek = todayDate.getDay();
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const { data: schedule } = await supabase
      .from("weekly_schedule")
      .select("day_of_week, session_type")
      .eq("user_id", user.id)
      .order("day_of_week");

    const todaySchedule = schedule?.find(
      (s: any) => s.day_of_week === dayOfWeek,
    );

    // ── System prompt ─────────────────────────────────────────

    const systemPrompt = `You are Setpoint, a friendly AI personal training coach. You have a back-and-forth conversation with the user to plan their workout. Be concise, encouraging, and helpful.

USER PROFILE:
${profileText}

RECENT WORKOUTS (last 5 sessions):
${historyText}

TODAY: ${dayNames[dayOfWeek]}, ${date}
${todaySchedule ? `SCHEDULED SESSION: ${todaySchedule.session_type}` : "No session scheduled for today."}

INSTRUCTIONS:
- Keep your text reply brief and conversational (2-4 sentences).
- ALWAYS include a complete workout recommendation in the "workout" field.
- When the user asks to adjust something, update the workout accordingly and explain what you changed.
- For strength exercises: suggest specific weight, sets, and reps based on recent performance.
- For cardio: suggest duration, distance, or pace as appropriate.
- If they have no training history, create a reasonable introductory workout based on their preferences.

You MUST respond with ONLY valid JSON (no markdown, no code fences):
{
  "reply": "Your conversational response",
  "workout": {
    "type": "Session type",
    "exercises": [
      { "name": "Exercise", "exercise_type": "strength", "sets": 3, "reps": 8, "weight": 135 },
      { "name": "Running", "exercise_type": "cardio", "duration_minutes": 20, "distance": 2.0, "pace": "10:00/mi" }
    ]
  }
}`;

    // ── Build OpenAI messages ─────────────────────────────────

    const openaiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (messages.length === 0) {
      openaiMessages.push({
        role: "user",
        content: "What should I do today?",
      });
    } else {
      for (const m of messages) {
        openaiMessages.push({ role: m.role, content: m.content });
      }
    }

    // ── Call OpenAI ───────────────────────────────────────────

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
          model: "gpt-4o-mini",
          messages: openaiMessages,
          temperature: 0.7,
          max_tokens: 1500,
          response_format: { type: "json_object" },
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
      "chat-workout",
      "gpt-4o-mini",
      aiData.usage ?? {},
    );

    // ── Parse response ────────────────────────────────────────

    let parsed;
    try {
      const cleaned = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return jsonError("Could not parse AI response", 502);
    }

    if (
      !parsed.workout?.exercises ||
      !Array.isArray(parsed.workout.exercises)
    ) {
      return jsonError("Invalid AI response structure", 502);
    }

    return jsonOk(parsed);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});
