// Supabase Edge Function — recommend-workout
// Deploy with: supabase functions deploy recommend-workout
//
// Required secrets (set via Supabase Dashboard or CLI):
//   OPENAI_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("Missing authorization header", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const body = await req.json();
    const requestedDate: string = body.date ?? new Date().toISOString().split("T")[0];

    // ── Gather context ──────────────────────────────────────

    // Weekly schedule
    const { data: schedule } = await supabase
      .from("weekly_schedule")
      .select("day_of_week, session_type")
      .eq("user_id", user.id)
      .order("day_of_week");

    // Training preferences
    const { data: preferences } = await supabase
      .from("training_preferences")
      .select("content, category")
      .eq("user_id", user.id);

    // Recent workouts (last 4 weeks) with exercises and sets
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const sinceDate = fourWeeksAgo.toISOString().split("T")[0];

    const { data: recentWorkouts } = await supabase
      .from("workouts")
      .select(
        `
        date, type, status, notes, ai_summary,
        workout_exercises (
          name, exercise_type, is_planned, exercise_order,
          exercise_sets ( set_number, weight, reps, rpe ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `
      )
      .eq("user_id", user.id)
      .gte("date", sinceDate)
      .order("date", { ascending: false })
      .limit(20);

    // Today's day of week
    const todayDate = new Date(requestedDate + "T12:00:00Z");
    const dayOfWeek = todayDate.getDay();
    const dayNames = [
      "Sunday", "Monday", "Tuesday", "Wednesday",
      "Thursday", "Friday", "Saturday",
    ];

    // Scheduled session for today
    const todaySchedule = schedule?.find(
      (s: any) => s.day_of_week === dayOfWeek
    );

    // ── Build workout history summary ───────────────────────

    const historyLines: string[] = [];
    for (const w of recentWorkouts ?? []) {
      if (w.status === "planned") continue; // only include actual workouts
      const actual = (w.workout_exercises ?? []).filter(
        (e: any) => !e.is_planned
      );
      if (actual.length === 0) continue;

      const exSummaries = actual
        .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
        .map((e: any) => {
          if (e.exercise_type === "cardio") {
            const c = e.cardio_entries?.[0];
            if (!c) return `  ${e.name}`;
            const parts = [e.name + ":"];
            if (c.duration_minutes) parts.push(`${c.duration_minutes} min`);
            if (c.distance) parts.push(`${c.distance} mi`);
            if (c.pace) parts.push(`pace ${c.pace}`);
            if (c.heart_rate) parts.push(`HR ${c.heart_rate}`);
            return "  " + parts.join(", ");
          }

          const sets = (e.exercise_sets ?? []).sort(
            (a: any, b: any) => a.set_number - b.set_number
          );
          if (sets.length === 0) return `  ${e.name}: no sets logged`;

          const setStrs = sets.map((s: any) => {
            let str = "";
            if (s.weight != null) str += `${s.weight}`;
            if (s.reps != null) str += `×${s.reps}`;
            if (s.rpe != null) str += ` @${s.rpe}`;
            return str || "—";
          });

          return `  ${e.name}: ${setStrs.join(", ")}`;
        });

      historyLines.push(
        `${w.date} — ${w.type ?? "Workout"} (${w.status})${w.notes ? " [" + w.notes + "]" : ""}`
      );
      historyLines.push(...exSummaries);
      historyLines.push("");
    }

    // ── Build system prompt ─────────────────────────────────

    const scheduleText =
      schedule && schedule.length > 0
        ? schedule
            .map((s: any) => `  ${dayNames[s.day_of_week]}: ${s.session_type}`)
            .join("\n")
        : "  (No schedule set)";

    const goalsText =
      preferences
        ?.filter((p: any) => p.category === "goal")
        .map((p: any) => `  - ${p.content}`)
        .join("\n") || "  (No goals set)";

    const prefsText =
      preferences
        ?.filter((p: any) => p.category === "preference")
        .map((p: any) => `  - ${p.content}`)
        .join("\n") || "  (No preferences set)";

    const equipmentText =
      preferences
        ?.filter((p: any) => p.category === "equipment")
        .map((p: any) => `  - ${p.content}`)
        .join("\n") || "  (No equipment listed)";

    const systemPrompt = `You are Setpoint, an AI personal training coach. You analyze the user's training history and preferences to recommend their next workout.

WEEKLY SCHEDULE:
${scheduleText}

GOALS:
${goalsText}

TRAINING PREFERENCES:
${prefsText}

AVAILABLE EQUIPMENT:
${equipmentText}

RECENT WORKOUT HISTORY (most recent first):
${historyLines.length > 0 ? historyLines.join("\n") : "(No workouts logged yet)"}

TODAY: ${dayNames[dayOfWeek]}, ${requestedDate}
${todaySchedule ? `SCHEDULED SESSION: ${todaySchedule.session_type}` : "No session scheduled for today."}

INSTRUCTIONS:
1. Analyze the user's recent training, scheduled session type, and goals.
2. Consider fatigue, progressive overload, and recovery.
3. Recommend a concrete workout for today.
4. Explain your reasoning briefly — reference specific recent workouts, progression, and recovery needs.
5. For strength exercises, suggest specific weight, reps, and sets based on their recent performance.
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
        "weight": 185
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

    // ── Call OpenAI ──────────────────────────────────────────

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
              content: "What should I do today?",
            },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        }),
      }
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

    // Parse the JSON response (strip potential markdown fences)
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

    // Validate minimum structure
    if (!recommendation.workout?.exercises || !Array.isArray(recommendation.workout.exercises)) {
      return jsonError("Invalid AI response structure", 502);
    }

    return new Response(JSON.stringify(recommendation), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
