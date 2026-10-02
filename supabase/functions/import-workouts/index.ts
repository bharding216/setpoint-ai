// Supabase Edge Function — import-workouts
// Parses a CSV of workout history using AI and returns structured records.
// Chunks large CSVs to stay within model output limits.
//
// Required secrets: OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";
import { checkUsageAllowance, logUsage } from "../_shared/usage.ts";

const MAX_ROWS_PER_CHUNK = 40;

// ── CSV Parsing Helpers ────────────────────────────────────

/** Split raw CSV text into individual records, handling quoted fields that span multiple lines */
function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && i + 1 < csv.length && csv[i + 1] === "\n") i++;
      if (current.trim().length > 0) records.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) records.push(current);

  return records;
}

/** Parse a single CSV record into fields, respecting quoted values with commas */
function parseCsvFields(record: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of record) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Check whether a CSV record has meaningful data beyond the date column */
function recordHasData(record: string): boolean {
  const fields = parseCsvFields(record);
  return fields.slice(1).some((f) => f.trim().length > 0);
}

/** Extract the date field from a CSV record (first column) */
function getRecordDate(record: string): string {
  return parseCsvFields(record)[0] ?? "";
}

/** Group records by date, keeping same-date rows together, then chunk */
function chunkRecords(
  header: string,
  dataRecords: string[],
  maxRows: number,
): string[][] {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  for (let i = 0; i < dataRecords.length; i++) {
    currentChunk.push(dataRecords[i]);

    const nextDate =
      i + 1 < dataRecords.length ? getRecordDate(dataRecords[i + 1]) : null;
    const currentDate = getRecordDate(dataRecords[i]);

    // Split when we hit the row limit AND the next row is a new date
    if (currentChunk.length >= maxRows && nextDate !== currentDate) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

const SYSTEM_PROMPT = `You are a workout data parser. Parse the following CSV of workout history into structured JSON records.

RULES:
1. Group rows by date into individual workouts.
2. Use the "Category" column as the workout type.
3. If multiple categories exist on the same date (e.g. "Recovery, yoga"), combine them into one workout.
4. Parse exercises:
   - For strength exercises: extract name, weight (numeric only, null if bodyweight/missing), and reps per set from Set 1/2/3 columns.
   - If "Weight/Duration" contains "s" suffix (like "40s"), it means dumbbell weight per hand (e.g., 40s = 40 lbs DBs). Store the numeric value and set "equipment_count": 2 on the exercise.
   - For any bilateral dumbbell exercise (DB Bench, DB Rows, DB Curls, etc.), set "equipment_count": 2 and weight = per-dumbbell weight.
   - For barbell, machine, single-dumbbell, or bodyweight exercises, set "equipment_count": 1.
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
          "equipment_count": 1,
          "sets": [
            { "set_number": 1, "weight": 175, "reps": 6 },
            { "set_number": 2, "weight": 175, "reps": 6 },
            { "set_number": 3, "weight": 175, "reps": 6 }
          ]
        },
        {
          "name": "DB Incline Press",
          "exercise_type": "strength",
          "equipment_count": 2,
          "sets": [
            { "set_number": 1, "weight": 40, "reps": 10 }
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

/** Call OpenAI to parse a single CSV chunk */
async function parseChunk(
  openaiKey: string,
  header: string,
  rows: string[],
  chunkIndex: number,
  totalChunks: number,
): Promise<{ workouts: any[]; usage: any }> {
  const csv = [header, ...rows].join("\n");

  console.log(
    `[import-workouts] Chunk ${chunkIndex + 1}/${totalChunks}: ${rows.length} rows, ${csv.length} chars`,
  );

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Parse this CSV into structured workout records:\n\n${csv}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 16384,
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      `[import-workouts] OpenAI error (chunk ${chunkIndex + 1}):`,
      response.status,
      errText,
    );
    throw new Error(`AI service error (${response.status})`);
  }

  const aiData = await response.json();
  const content = aiData.choices?.[0]?.message?.content;
  const finishReason = aiData.choices?.[0]?.finish_reason;

  console.log(
    `[import-workouts] Chunk ${chunkIndex + 1} response: finish_reason=${finishReason}, ` +
      `content length=${content?.length ?? 0}`,
  );

  if (finishReason === "length") {
    console.error(
      `[import-workouts] Chunk ${chunkIndex + 1} truncated (finish_reason=length)`,
    );
    throw new Error("AI response was truncated. Try a smaller file.");
  }

  if (!content) {
    throw new Error("Empty AI response");
  }

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  let result;
  try {
    result = JSON.parse(cleaned);
  } catch {
    console.error(
      `[import-workouts] Chunk ${chunkIndex + 1} JSON parse failed. Preview:`,
      cleaned.slice(0, 300),
    );
    throw new Error("Could not parse AI response");
  }

  if (!result.workouts || !Array.isArray(result.workouts)) {
    throw new Error("Invalid AI response structure");
  }

  return { workouts: result.workouts, usage: aiData.usage ?? {} };
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { user, serviceClient } = await authenticateUser(req);

    // ── Check usage limits ────────────────────────────────────

    const usage = await checkUsageAllowance(serviceClient, user.id);
    if (!usage.allowed) {
      return jsonError(usage.reason!, 429, usage.code);
    }

    const body = await req.json();
    const csvContent: string = body.csv;
    if (!csvContent || csvContent.trim().length === 0) {
      return jsonError("csv content is required", 400);
    }

    const records = splitCsvRecords(csvContent);
    const header = records[0];
    const dataRecords: string[] = [];
    for (let i = 1; i < records.length; i++) {
      if (recordHasData(records[i])) {
        dataRecords.push(records[i]);
      }
    }

    console.log(
      `[import-workouts] CSV stats: ${records.length} total records, ` +
        `${dataRecords.length} meaningful rows`,
    );

    if (dataRecords.length === 0) {
      return jsonOk({ workouts: [] });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonError("OPENAI_API_KEY not configured", 500);
    }

    // ── Chunk and parse ─────────────────────────────────────

    const chunks = chunkRecords(header, dataRecords, MAX_ROWS_PER_CHUNK);

    console.log(
      `[import-workouts] Split into ${chunks.length} chunk(s)`,
    );

    const allWorkouts: any[] = [];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for (let i = 0; i < chunks.length; i++) {
      const { workouts, usage: chunkUsage } = await parseChunk(
        openaiKey,
        header,
        chunks[i],
        i,
        chunks.length,
      );

      allWorkouts.push(...workouts);

      totalUsage.prompt_tokens += chunkUsage.prompt_tokens ?? 0;
      totalUsage.completion_tokens += chunkUsage.completion_tokens ?? 0;
      totalUsage.total_tokens += chunkUsage.total_tokens ?? 0;
    }

    // ── Log usage ─────────────────────────────────────────────

    await logUsage(
      serviceClient,
      user.id,
      "import-workouts",
      "gpt-4o-mini",
      totalUsage,
    );

    console.log(
      `[import-workouts] Success: ${allWorkouts.length} workouts parsed, ` +
        `total exercises: ${allWorkouts.reduce((sum: number, w: any) => sum + (w.exercises?.length ?? 0), 0)}, ` +
        `total tokens: ${totalUsage.total_tokens}`,
    );

    return jsonOk({ workouts: allWorkouts });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("[import-workouts] Edge function error:", err);
    return jsonError(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
});
