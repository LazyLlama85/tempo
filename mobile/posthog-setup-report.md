# PostHog post-wizard report

The wizard completed a deep PostHog integration for the Tempo React Native / Expo project. The SDK (`posthog-react-native ^4.52.0`) was already installed and initialized; this run filled in the 12 missing events across 5 files, wired environment variables into `.env.local`, and fixed a pre-existing curly-quote encoding issue in `social.tsx` that was latent in the codebase.

**Files changed:**
- `src/lib/analytics.ts` — 12 new event types added to `EventProperties`
- `src/app/social.tsx` — 6 social events + curly-quote string fix
- `src/app/onboarding/profile-setup.tsx` — 2 onboarding completion events
- `src/app/weekly-report.tsx` — 1 screen-view event
- `src/app/travel-mode.tsx` — 2 feature-enable events
- `src/app/workout-builder.tsx` — 1 custom workout save event
- `mobile/.env.local` — `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` set

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `friend_request_sent` | User tapped 'Add' on a search result to send a friend request. | `src/app/social.tsx` |
| `friend_request_accepted` | User accepted an incoming friend request. | `src/app/social.tsx` |
| `activity_reacted` | User reacted to a friend's completed workout in the activity feed. | `src/app/social.tsx` |
| `workout_invite_responded` | User accepted or declined a social workout invite. | `src/app/social.tsx` |
| `group_created` | User created a new private group. | `src/app/social.tsx` |
| `group_joined` | User joined an existing group via invite code. | `src/app/social.tsx` |
| `profile_setup_completed` | User saved their name, avatar, and optional starting weight at the end of onboarding. | `src/app/onboarding/profile-setup.tsx` |
| `profile_setup_skipped` | User tapped 'Skip' on the profile setup screen without saving. | `src/app/onboarding/profile-setup.tsx` |
| `weekly_report_viewed` | User opened the weekly progress report screen. | `src/app/weekly-report.tsx` |
| `travel_mode_enabled` | User saved travel mode with a chosen equipment set and duration. | `src/app/travel-mode.tsx` |
| `travel_mode_cleared` | User turned off travel mode and returned to normal programming. | `src/app/travel-mode.tsx` |
| `custom_workout_saved` | User saved a custom workout template via the workout builder. | `src/app/workout-builder.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard:** [Analytics basics (wizard)](https://us.posthog.com/project/514051/dashboard/1854300)
- **Insight:** [Onboarding & Activation Funnel](https://us.posthog.com/project/514051/insights/qiN0ca9Y)
- **Insight:** [Daily Sessions Completed](https://us.posthog.com/project/514051/insights/sAHLA626)
- **Insight:** [Social Feature Engagement](https://us.posthog.com/project/514051/insights/nzJSRboU)
- **Insight:** [Feature Adoption](https://us.posthog.com/project/514051/insights/VCanUT73)
- **Insight:** [Paywall Conversion Funnel](https://us.posthog.com/project/514051/insights/GWe5n9qr)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` to `mobile/.env.example` and any EAS build profiles so collaborators and CI builds have the keys available.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
