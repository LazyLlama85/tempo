export type Goal =
  | 'muscle_gain'
  | 'fat_loss'
  | 'strength'
  | 'general_fitness'
  | 'athletic'

export type Experience = 'beginner' | 'intermediate' | 'advanced'

export type Equipment =
  | 'full_gym'
  | 'dumbbells'
  | 'barbell'
  | 'resistance_bands'
  | 'bodyweight'

export type AdaptationMode = 'normal' | 'deload' | 'recovery' | 'maintenance'

export type WorkoutStatus =
  | 'scheduled'
  | 'completed'
  | 'missed'
  | 'skipped'
  | 'rescheduled'

// When the user likes to train. A soft preference — the scheduler still varies
// the exact time within the window so the week doesn't feel robotic.
export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

// How freely Tempo may move a workout to keep the user on track.
//   strict   — protect the chosen day; only nudge the time.
//   balanced — may move a workout within ±1 day.
//   flexible — may move a workout anywhere in the same week.
export type ScheduleFlexibility = 'strict' | 'balanced' | 'flexible'

// Which calendar a synced workout event lives in.
export type CalendarProvider = 'google' | 'device'

// A window the user is never available to train — recurring (a weekday, e.g. every
// Saturday for Shabbat) or a one-off date; all-day or a time range. Distinct from
// work/school hours (routine Tempo works around): these are hard "do not schedule
// here, ever" blocks — religious observance, standing commitments, protected time.
export interface UnavailableBlock {
  id: string
  scope: 'weekday' | 'date'
  weekday?: number        // 1=Mon … 7=Sun, when scope = 'weekday'
  date?: string           // 'YYYY-MM-DD', when scope = 'date'
  allDay: boolean
  start?: string          // 'HH:MM:SS' when not all-day
  end?: string            // 'HH:MM:SS' when not all-day
  label?: string          // optional, e.g. "Shabbat", "Family dinner"
}

export interface UserProfile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  goal: Goal
  experience: Experience
  equipment: Equipment[]
  days_per_week: number
  preferred_duration_min: number
  bodyweight_lbs: number | null
  injuries: string[] | null
  onboarding_complete: boolean
  created_at: string
  // ── Availability + scheduling preferences ──────────────────────────────────
  // 'HH:MM:SS'. Sleep window — workouts are never placed between bedtime and wake.
  wake_time: string
  bedtime: string
  // Recurring commitments to schedule around ('HH:MM:SS' or null = none).
  work_start: string | null
  work_end: string | null
  school_start: string | null
  school_end: string | null
  preferred_time_of_day: TimeOfDay | null
  schedule_flexibility: ScheduleFlexibility
  // Weekdays the user will train, ISO 1=Mon … 7=Sun. Empty = no restriction.
  training_days: number[]
  // Which calendar new workout events sync to when both are connected.
  preferred_calendar: CalendarProvider | null
  // Hard "never schedule here" windows (religious observance, standing commitments).
  // Optional so the app keeps working before the column migration is applied.
  unavailable_blocks?: UnavailableBlock[] | null
  // Temporary equipment override while away from home (see TravelMode). Optional so
  // the app keeps working before the column migration is applied.
  travel_mode?: TravelMode | null
  // Calendar events the user has marked "ignore" — content keys (see lib/ignoredEvents)
  // for events that shouldn't block workout scheduling. Optional so the app keeps
  // working before the column migration is applied.
  ignored_events?: string[] | null
}

// A temporary "I'm away from my usual setup" override. While active, this equipment
// replaces the profile's home equipment everywhere Tempo picks exercises — so a week
// in a hotel with only dumbbells doesn't break the plan. `until` is an inclusive
// 'YYYY-MM-DD' end date (null = stays on until the user turns it off).
export interface TravelMode {
  equipment: Equipment[]
  until: string | null
  label: string | null
}

export interface CalendarConnection {
  id: string
  user_id: string
  provider: 'google' | 'apple'
  sync_enabled: boolean
  last_synced_at: string | null
}

export interface Exercise {
  id: string
  name: string
  movement_pattern: 'push' | 'pull' | 'hinge' | 'squat' | 'carry' | 'core' | 'cardio' | 'mobility'
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: Equipment[]
  experience_level: Experience
  video_url: string | null
  instructions: string[]
  substitute_ids: string[]
}

export interface UserPlan {
  id: string
  user_id: string
  program_id: string
  start_date: string
  end_date: string | null
  current_week: number
  status: 'active' | 'paused' | 'completed' | 'abandoned'
  adaptation_mode: AdaptationMode
}

export interface ScheduledWorkout {
  id: string
  user_plan_id: string
  user_id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  focus: string
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
  status: WorkoutStatus
  completed_at: string | null
}

export interface WorkoutLog {
  id: string
  scheduled_workout_id: string
  user_id: string
  started_at: string
  completed_at: string | null
  notes: string | null
  feeling_score: 1 | 2 | 3 | 4 | 5 | null
}

export interface SetLog {
  id: string
  workout_log_id: string
  exercise_id: string
  set_number: number
  reps_completed: number
  weight_lbs: number | null
  rpe: number | null
  completed_at: string
}

// A single point in a user's body-measurement time series. Weight is the primary
// metric; body fat / waist / a progress photo are optional extras on the same entry.
export interface BodyMeasurement {
  id: string
  user_id: string
  weight_lbs: number | null
  body_fat_pct: number | null
  waist_in: number | null
  photo_url: string | null
  note: string | null
  measured_at: string  // ISO timestamp
  created_at: string
}

export interface TimeSlot {
  date: string
  start_time: string
  end_time: string
  duration_min: number
}
