// Supabase Edge Function — import-workouts
// Parses a CSV of workout history using AI and returns structured records.
//
// Required secrets: OPENAI_API_KEY

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
    const csvContent: string = body.csv;
    if (!csvContent || csvContent.trim().length === 0) {
      return jsonError("csv content is required", 400);
    }

    // Truncate to meaningful rows (skip rows that are all empty after the date)
    const lines = csvContent.split("\n");
    const meaningfulLines = [lines[0]]; // header
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      // A row is meaningful if it has at least a category or exercise
      const hasData = cols.slice(1).some(
        (c) => c.replace(/"/g, "").trim().length > 0
      );
      if (hasData) {
        meaningfulLines.push(lines[i]);
      }
    }

    const trimmedCsv = meaningfulLines.join("\n");

    const systemPrompt = `You are a workout data parser. Parse the following CSV of workout history into structured JSON records.

RULES:
1. Group rows by date into individual workouts.
2. Use the "Category" column as the workout type.
3. If multiple categories exist on the same date (e.g. "Recovery, yoga"), combine them into one workout.
4. Parse exercises:
   - For strength exercises: extract name, weight (numeric only, null if bodyweight/missing), and reps per set from Set 1/2/3 columns.
   - If "Weight/Duration" contains "s" suffix (like "40s"), it means dumbbell weight per hand (e.g., 40s = 40 lbs DBs). Store the numeric value.
   - If "Weight/Duration" is "bodyweight", set weight to null.
   - If "Weight/Duration" contains a range like "185-195", use the higher value.
   - If "Weight/Duration" is a description (like "Conditioning style"), skip structured sets and put it in notes.
5. For cardio exercises (runs, swims, rows):
   - exercise_type should be "cardio"
   - Parse duration, distance, pace, heart_rate from available data
   - Put detailed interval descriptions in notes
6. If a row only has a description in the Exercise column (like "KB, battle ropes, planks") with no set data, create one exercise entry with that name and no sets.
7. Skip rows that have no category AND no exercise data.
8. Only include workouts that have at least one exercise.
9. Dates should be in YYYY-MM-DD format.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "workouts": [
    {
      "date": "2026-08-23",
      "type": "Upper",
      "exercises": [
        {
          "name": "Bench Press",
          "exercise_type": "strength",
          "sets": [
            { "set_number": 1, "weight": 175, "reps": 6 },
            { "set_number": 2, "weight": 175, "reps": 6 },
            { "set_number": 3, "weight": 175, "reps": 6 }
          ]
        },
        {
          "name": "Easy Run",
          "exercise_type": "cardio",
          "duration_minutes": 30,
          "distance": null,
          "pace": null,
          "heart_rate": null,
          "notes": null
        }
      ],
      "notes": null
    }
  ]
}`;

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
              content: `Parse this CSV into structured workout records:\n\n${trimmedCsv}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 8000,
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

    let result;
    try {
      const cleaned = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      return jsonError("Could not parse AI response", 502);
    }

    if (!result.workouts || !Array.isArray(result.workouts)) {
      return jsonError("Invalid response structure", 502);
    }

    return new Response(JSON.stringify(result), {
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
