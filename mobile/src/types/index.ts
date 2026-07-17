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
  | 'kettlebell'
  | 'resistance_bands'
  // A pull-up / dip apparatus (doorway bar, dip station, parallel bars, or rings).
  // Distinct from `bodyweight` so pull-ups, chin-ups, dips and hanging work are only
  // programmed for people who actually have something to hang from — see
  // lib/equipmentMatch (needsApparatus / canPerform).
  | 'pull_up_bar'
  // Truly no equipment: floor work only. Always implicitly available (expandEquipment
  // adds it to every set), so an empty selection still yields a bodyweight plan.
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

// How workout TIMES get placed. Connecting a calendar no longer implies 'auto'.
//   auto   — Tempo places each workout at a calendar-aware time and re-slots it
//            when a new event overlaps (reads busy times from the chosen calendar).
//   manual — the user owns the times; Tempo never moves them on its own. A connected
//            calendar is still used to read busy times and to sync events.
export type SchedulingMode = 'auto' | 'manual'

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
  // Social identity (add_social_v2.sql): unique handle + shareable add-me code.
  // Optional so the app keeps working before the migration is applied.
  username?: string | null
  friend_code?: string | null
  goal: Goal
  experience: Experience
  equipment: Equipment[]
  days_per_week: number
  preferred_duration_min: number
  // Optional cardio finisher on generated sessions (Phase 7c) — only changes
  // anything for muscle_gain/strength (see lib/generatePlan.ts's withCardio()).
  include_cardio?: boolean
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
  // Auto-add scheduled workouts to the connected calendar (default true).
  calendar_autosync?: boolean
  // Per-rule notification opt-outs (add_notification_prefs.sql, §6.1). jsonb keyed
  // by retention-rule name → boolean; absent key = that rule's default. Optional so
  // the app keeps working before the column migration is applied.
  notification_prefs?: Record<string, boolean> | null
  // Whether Tempo auto-places/auto-moves workout times. Optional so the app keeps
  // working before the column migration is applied; treated as 'auto' when absent.
  scheduling_mode?: SchedulingMode
  // Google calendar ids (beyond 'primary') Tempo also reads busy-time from
  // (B1.5, multi-calendar). Optional/nullable so the app keeps working before
  // the column migration is applied and before a user configures it — null/empty
  // means "just primary", identical to pre-B1.5 behavior. Dormant until the
  // calendar.calendarlist.readonly OAuth scope is granted (see
  // services/googleCalendar/config.ts).
  selected_google_calendar_ids?: string[] | null
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

export type MovementPattern = 'push' | 'pull' | 'hinge' | 'squat' | 'carry' | 'core' | 'cardio' | 'mobility'

// Which numbers a user logs for an exercise. Built-ins default to weight+reps;
// custom exercises (e.g. a run) can track duration/distance instead.
export type MetricKey = 'weight' | 'reps' | 'duration' | 'distance' | 'rpe'

// Coarse muscle bucket used for library filtering (null on user customs — the UI
// derives one from movement_pattern instead).
export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'arms' | 'core'
  | 'legs' | 'glutes' | 'cardio' | 'mobility'

export interface Exercise {
  id: string
  name: string
  movement_pattern: MovementPattern
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: Equipment[]
  experience_level: Experience
  video_url: string | null
  instructions: string[]
  substitute_ids: string[]
  // Custom-exercise fields (null/false/empty for the built-in library).
  user_id?: string | null
  is_custom?: boolean
  category?: string | null
  notes?: string | null
  tracking_metrics?: MetricKey[]
  // Library-v2 fields (add_exercise_library_v2.sql). Optional so the app keeps
  // working before the migration is applied.
  is_core?: boolean
  popularity?: number
  muscle_group?: MuscleGroup | null
}

// One exercise's prescription inside a user-built workout / template.
export interface WorkoutExerciseConfig {
  exercise_id: string
  sets: number
  rep_low: number
  rep_high: number
  weight_lbs: number | null
  duration_sec: number | null
  distance_m: number | null
  metrics: MetricKey[]
}

export interface WorkoutTemplate {
  id: string
  user_id: string
  name: string
  exercise_ids: string[]
  config: WorkoutExerciseConfig[]
  notes: string | null
  est_duration_min: number
  created_at: string
  updated_at: string
}

// One day of a weekly split. A non-rest day carries the workout to run that day —
// snapshotted from a template (or built inline) so the split is self-contained.
export interface SplitDay {
  weekday: number            // 1=Mon … 7=Sun
  label: string              // e.g. "Push", "Pull", "Legs", "Rest"
  rest: boolean              // true = recovery day, no workout
  template_id?: string | null  // source template, if picked from one (for reference)
  exercise_ids?: string[]    // resolved exercise ids for the day's workout
  config?: WorkoutExerciseConfig[]  // per-exercise prescription (snapshot)
}

// The user's overall training schedule: a named weekly weekday→workout pattern.
// One split is active at a time; activating it materializes scheduled_workouts.
//   kind 'custom' — the user built it.
//   kind 'auto'   — a mirror of the auto-generated program, so it appears in My
//                   Splits and can be toggled like any other; activating it
//                   regenerates the periodized plan (see lib/splitSchedule).
export interface Split {
  id: string
  user_id: string
  name: string
  is_active: boolean
  days: SplitDay[]
  kind?: 'custom' | 'auto'
  created_at: string
  updated_at: string
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

export type WorkoutSource = 'plan' | 'quick' | 'smart' | 'custom' | 'split'

export interface ScheduledWorkout {
  id: string
  user_plan_id: string | null
  user_id: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  focus: string
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
  status: WorkoutStatus
  completed_at: string | null
  source?: WorkoutSource
  split_id?: string | null
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
