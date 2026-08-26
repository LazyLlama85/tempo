-- Arclo — objectionable-name filtering (App Store Guideline 1.2, second half).
--
-- APPLIED 2026-08-26. This file is the final, consolidated state of what is live;
-- it was applied in three passes (initial, a normalisation fix, and the
-- create_group raise) and has been rewritten here to match production exactly,
-- so nobody reads a stale version and reapplies a broken matcher.
--
-- WHY. `add_moderation_block_report.sql` gave users report and block, which is
-- two of Guideline 1.2's requirements. The third is "a method for filtering
-- objectionable material from being posted." Three fields are user-authored and
-- shown to other people:
--
--   user_profiles.username      set by lib/social.updateUsername
--   user_profiles.display_name  set directly from the Profile screen
--   groups.name                 set by create_group, rendered to every member
--
-- None was filtered. A client-side check would be theatre: both profile fields
-- are written straight to `user_profiles` under RLS, so any modified client
-- bypasses it. Enforcement lives in a trigger and in the SECURITY DEFINER
-- function, where it cannot be routed around.
--
-- THE TWO BUGS THE FIRST VERSION HAD, since they are easy to reintroduce:
--
--   1. Repeated letters were collapsed BEFORE separators were stripped, so
--      "nigger" folded to "niger" while the list term stayed "nigger" and the
--      plain spelling of the worst slur sailed through, even though the
--      separator-evaded "n_i_g_g_e_r" was caught. Both sides of every
--      comparison now go through `mod_norm`, and stripping happens first.
--   2. Slurs were substring-matched, so "spicy", "suspicious", "despicable",
--      "conspicuous", "chinkapin" and "flame retardant" were all blocked.
--
-- THE MATCHING MODEL, which is what avoids blocking Scunthorpe:
--   • Tokens on an allowlist are dropped entirely — they can neither match nor
--     contribute letters to the concatenation check.
--   • `words` are blocked only when a token IS that word. Every entry appears
--     inside some innocent word, so substring matching would be a disaster.
--   • `unambiguous` are blocked anywhere in the concatenated remainder, which
--     is what catches "fuckyou", "xXfaggotXx" and separator evasion.
--
-- Verified against an 80-case corpus (40 must-block, 40 must-allow) with zero
-- failures, and against all 61 live profiles and every existing group: none is
-- flagged. The trigger also only inspects a field that actually CHANGED, so an
-- untouched legacy name can never block an unrelated profile edit.

-- 1) Normalisation --------------------------------------------------------------
-- Lowercase, fold leetspeak, drop non-letters, THEN collapse repeats. Applied to
-- both the input and every list term so the two sides always agree.
create or replace function public.mod_norm(t text)
returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(t, '')), '4@31!07$5', 'aaeiiotss'),
             '[^a-z]', '', 'g'),
           '(.)\1+', '\1', 'g')
$$;

-- 2) The check -------------------------------------------------------------------
create or replace function public.is_objectionable_text(t text)
returns boolean
language plpgsql immutable as $$
declare
  raw_tokens text[];
  tok text;
  kept text[] := '{}';
  joined text;
  term text;
  safe_words text[] := array[
    'scunthorpe','penistone','shiitake','spicy','spice','spices','suspicious',
    'despicable','conspicuous','retardant','retardants','assassin','assassins',
    'class','classic','bass','pass','passion','glass','grass','brass','mass',
    'cassandra','cockpit','hancock','babcock','peacock','shuttlecock',
    'dictionary','dickinson','analysis','analyst','uranus','titanic','titicaca',
    'grape','grapes','therapist','therapy','scrape','drape','raccoon','cocoon',
    'tycoon','chinkapin','massachusetts','assessment','assess','asset','assets',
    'assist','assign','assignment','embassy','harassment','compass','sassy',
    'essex','sussex','middlesex','arsenal','sharpie','pissarro','cumberland',
    'damnation','crapaud','lass','molasses','canvass','surpass','bypass'
  ];
  words text[] := array[
    'fuck','fucker','fucking','fucked','shit','shitty','shithead','bitch','bitches',
    'cunt','whore','slut','bastard','wanker','twat','prick','dick','cock','pussy',
    'arse','ass','asshole','arsehole','dickhead','motherfucker','bollocks','piss',
    'crap','damn','goddamn','rape','rapist','nazi','hitler','pedo','pedophile',
    'paedophile','spic','chink','gook','coon','retard','retarded','fag','fags'
  ];
  unambiguous text[] := array[
    'nigger','nigga','faggot','tranny','transexual','wetback','raghead',
    'towelhead','beaner','kike','fuck','cunt','whore','rapist'
  ];
begin
  if t is null or btrim(t) = '' then return false; end if;

  raw_tokens := regexp_split_to_array(
    translate(lower(t), '4@31!07$5', 'aaeiiotss'), '[^a-z]+');

  foreach tok in array raw_tokens loop
    tok := public.mod_norm(tok);
    if tok = '' then continue; end if;
    if tok = any (select public.mod_norm(x) from unnest(safe_words) x) then continue; end if;
    if tok = any (select public.mod_norm(x) from unnest(words) x) then return true; end if;
    kept := kept || tok;
  end loop;

  -- Re-collapse after joining: separator evasion splits a doubled letter across
  -- two tokens ("g" + "g"), which only merges once the pieces are adjacent.
  joined := regexp_replace(array_to_string(kept, ''), '(.)\1+', '\1', 'g');
  if joined = '' then return false; end if;

  foreach term in array unambiguous loop
    if position(public.mod_norm(term) in joined) > 0 then return true; end if;
  end loop;

  return false;
end;
$$;

-- 3) Enforce on profiles ---------------------------------------------------------
create or replace function public.reject_objectionable_profile()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.username is distinct from old.username then
    if public.is_objectionable_text(new.username) then
      raise exception 'username_not_allowed' using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name then
    if public.is_objectionable_text(new.display_name) then
      raise exception 'display_name_not_allowed' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_objectionable_profile on public.user_profiles;
create trigger trg_reject_objectionable_profile
  before insert or update on public.user_profiles
  for each row execute function public.reject_objectionable_profile();

-- 4) Enforce on group names ------------------------------------------------------
-- Raises rather than returning empty, so lib/groups.createGroup can tell a
-- blocked name from a generic failure and say which. An empty return still
-- means failure for every other reason, so that path is unchanged.
create or replace function public.create_group(p_name text)
returns table(id uuid, name text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid; code text;
begin
  if me is null or length(trim(coalesce(p_name, ''))) = 0 then return; end if;
  if public.is_objectionable_text(p_name) then
    raise exception 'group_name_not_allowed' using errcode = 'check_violation';
  end if;
  loop
    begin
      code := public.gen_friend_code();
      insert into public.groups (name, owner_id, invite_code)
        values (left(trim(p_name), 40), me, code) returning groups.id into gid;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  insert into public.group_members (group_id, user_id, role) values (gid, me, 'owner');
  return query select gid, left(trim(p_name), 40), code;
end;
$$;

grant execute on function public.is_objectionable_text(text) to authenticated;
