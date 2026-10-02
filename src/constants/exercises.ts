// ─── Preset Exercise Library ────────────────────────────────
// Canonical names for common exercises. Using these consistently
// enables accurate progress tracking and better AI analysis.

export type ExercisePreset = {
  name: string;
  type: 'strength' | 'cardio';
  equipmentCount: 1 | 2;
  category: ExerciseCategory;
};

export type ExerciseCategory =
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Arms'
  | 'Legs'
  | 'Core'
  | 'Full Body'
  | 'Cardio';

export const EXERCISE_CATEGORIES: ExerciseCategory[] = [
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Legs',
  'Core',
  'Full Body',
  'Cardio',
];

export const EXERCISE_PRESETS: ExercisePreset[] = [
  // ── Chest ──────────────────────────────────────────────────
  { name: 'Bench Press', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Incline Bench Press', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Decline Bench Press', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Close-Grip Bench Press', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'DB Bench Press', type: 'strength', equipmentCount: 2, category: 'Chest' },
  { name: 'DB Incline Bench Press', type: 'strength', equipmentCount: 2, category: 'Chest' },
  { name: 'DB Decline Bench Press', type: 'strength', equipmentCount: 2, category: 'Chest' },
  { name: 'DB Flyes', type: 'strength', equipmentCount: 2, category: 'Chest' },
  { name: 'Incline DB Flyes', type: 'strength', equipmentCount: 2, category: 'Chest' },
  { name: 'Cable Flyes', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Machine Chest Press', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Pec Deck', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Push-Ups', type: 'strength', equipmentCount: 1, category: 'Chest' },
  { name: 'Dips', type: 'strength', equipmentCount: 1, category: 'Chest' },

  // ── Back ───────────────────────────────────────────────────
  { name: 'Deadlift', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Trap Bar Deadlift', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Romanian Deadlift', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'DB Romanian Deadlift', type: 'strength', equipmentCount: 2, category: 'Back' },
  { name: 'Barbell Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Pendlay Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'DB Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'DB Rows', type: 'strength', equipmentCount: 2, category: 'Back' },
  { name: 'Seated Cable Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Lat Pulldown', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Pull-Ups', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Chin-Ups', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'T-Bar Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Machine Row', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Face Pulls', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Rack Pulls', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Good Mornings', type: 'strength', equipmentCount: 1, category: 'Back' },
  { name: 'Back Extensions', type: 'strength', equipmentCount: 1, category: 'Back' },

  // ── Shoulders ──────────────────────────────────────────────
  { name: 'Overhead Press', type: 'strength', equipmentCount: 1, category: 'Shoulders' },
  { name: 'DB Shoulder Press', type: 'strength', equipmentCount: 2, category: 'Shoulders' },
  { name: 'Arnold Press', type: 'strength', equipmentCount: 2, category: 'Shoulders' },
  { name: 'Lateral Raises', type: 'strength', equipmentCount: 2, category: 'Shoulders' },
  { name: 'Cable Lateral Raises', type: 'strength', equipmentCount: 1, category: 'Shoulders' },
  { name: 'Front Raises', type: 'strength', equipmentCount: 2, category: 'Shoulders' },
  { name: 'Reverse Flyes', type: 'strength', equipmentCount: 2, category: 'Shoulders' },
  { name: 'Machine Shoulder Press', type: 'strength', equipmentCount: 1, category: 'Shoulders' },
  { name: 'Upright Rows', type: 'strength', equipmentCount: 1, category: 'Shoulders' },
  { name: 'Shrugs', type: 'strength', equipmentCount: 1, category: 'Shoulders' },
  { name: 'DB Shrugs', type: 'strength', equipmentCount: 2, category: 'Shoulders' },

  // ── Arms ───────────────────────────────────────────────────
  { name: 'Barbell Curl', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'EZ Bar Curl', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'DB Curls', type: 'strength', equipmentCount: 2, category: 'Arms' },
  { name: 'Hammer Curls', type: 'strength', equipmentCount: 2, category: 'Arms' },
  { name: 'Concentration Curls', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Preacher Curls', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Cable Curls', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Incline DB Curls', type: 'strength', equipmentCount: 2, category: 'Arms' },
  { name: 'Tricep Pushdowns', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Overhead Tricep Extension', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'DB Tricep Extension', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Skull Crushers', type: 'strength', equipmentCount: 1, category: 'Arms' },
  { name: 'Tricep Kickbacks', type: 'strength', equipmentCount: 2, category: 'Arms' },
  { name: 'Wrist Curls', type: 'strength', equipmentCount: 1, category: 'Arms' },

  // ── Legs ───────────────────────────────────────────────────
  { name: 'Squat', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Front Squat', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Goblet Squat', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'DB Lunges', type: 'strength', equipmentCount: 2, category: 'Legs' },
  { name: 'Barbell Lunges', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Bulgarian Split Squat', type: 'strength', equipmentCount: 2, category: 'Legs' },
  { name: 'Step-Ups', type: 'strength', equipmentCount: 2, category: 'Legs' },
  { name: 'Leg Press', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Hack Squat', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Leg Extensions', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Leg Curls', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Hip Thrust', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Calf Raises', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Seated Calf Raises', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Glute Bridge', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Sumo Deadlift', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Hip Adductors', type: 'strength', equipmentCount: 1, category: 'Legs' },
  { name: 'Hip Abductors', type: 'strength', equipmentCount: 1, category: 'Legs' },

  // ── Core ───────────────────────────────────────────────────
  { name: 'Planks', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Ab Wheel Rollout', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Hanging Leg Raises', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Cable Crunches', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Russian Twists', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Woodchoppers', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Dead Bugs', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Pallof Press', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Decline Sit-Ups', type: 'strength', equipmentCount: 1, category: 'Core' },
  { name: 'Side Planks', type: 'strength', equipmentCount: 1, category: 'Core' },

  // ── Full Body ──────────────────────────────────────────────
  { name: 'Clean and Press', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'Power Clean', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'Kettlebell Swing', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'Turkish Get-Up', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'Thrusters', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'DB Thrusters', type: 'strength', equipmentCount: 2, category: 'Full Body' },
  { name: 'Burpees', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: "Farmer's Carry", type: 'strength', equipmentCount: 2, category: 'Full Body' },
  { name: 'Sled Push', type: 'strength', equipmentCount: 1, category: 'Full Body' },
  { name: 'Battle Ropes', type: 'strength', equipmentCount: 1, category: 'Full Body' },

  // ── Cardio ─────────────────────────────────────────────────
  { name: 'Running', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Easy Run', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Tempo Run', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Interval Run', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Long Run', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Sprints', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Treadmill', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Cycling', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Stationary Bike', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Indoor Cycling', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Swimming', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Pool Swim', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Open Water Swim', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Rowing', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Elliptical', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Stair Climber', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Jump Rope', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Walking', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Hiking', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Yoga', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
  { name: 'Stretching', type: 'cardio', equipmentCount: 1, category: 'Cardio' },
];

// Flat list of just the names for quick lookups
export const EXERCISE_NAMES = EXERCISE_PRESETS.map((e) => e.name);

// Quick lookup by name
const presetMap = new Map(EXERCISE_PRESETS.map((e) => [e.name.toLowerCase(), e]));
export function findPreset(name: string): ExercisePreset | undefined {
  return presetMap.get(name.toLowerCase());
}

// Fuzzy search: returns presets whose names contain the query (case-insensitive)
export function searchExercises(query: string): ExercisePreset[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return EXERCISE_PRESETS.filter((e) => e.name.toLowerCase().includes(q));
}

// Get presets grouped by category
export function getPresetsByCategory(): Map<ExerciseCategory, ExercisePreset[]> {
  const grouped = new Map<ExerciseCategory, ExercisePreset[]>();
  for (const cat of EXERCISE_CATEGORIES) {
    grouped.set(cat, EXERCISE_PRESETS.filter((e) => e.category === cat));
  }
  return grouped;
}

// ── Workout type presets ────────────────────────────────────
// Commonly used workout titles for quick selection
export const WORKOUT_TYPE_PRESETS = [
  'Upper Body',
  'Lower Body',
  'Push',
  'Pull',
  'Legs',
  'Full Body',
  'Chest & Triceps',
  'Back & Biceps',
  'Shoulders & Arms',
  'Chest & Back',
  'Arms',
  'Heavy Upper',
  'Heavy Lower',
  'Upper Conditioning',
  'Lower Conditioning',
  'HIIT',
  'Easy Run',
  'Long Run',
  'Tempo Run',
  'Easy Bike',
  'Long Ride',
  'Swim',
  'Brick (Bike + Run)',
  'Yoga / Mobility',
  'Recovery',
];
