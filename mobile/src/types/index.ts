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
  movement_pattern: 'push' | 'pull' | 'hinge' | 'squat' | 'carry' | 'core' | 'cardio'
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

export interface TimeSlot {
  date: string
  start_time: string
  end_time: string
  duration_min: number
}
