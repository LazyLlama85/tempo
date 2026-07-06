-- Splits — mark the auto-generated program as a first-class, activatable split.
--
-- Every user now sees a split in "My Splits", even on an auto-generated plan: a
-- kind='auto' split mirrors the program's weekly structure so it can be toggled
-- on/off alongside any custom splits they build (see src/lib/splits.ensureAutoSplit).
-- Activating the auto split regenerates the periodized plan; activating a custom
-- split retires the plan — exactly one schedule drives the calendar at a time.

ALTER TABLE public.splits ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'custom';

-- At most one auto (program-mirror) split per user.
CREATE UNIQUE INDEX IF NOT EXISTS splits_one_auto_per_user
  ON public.splits (user_id) WHERE kind = 'auto';
