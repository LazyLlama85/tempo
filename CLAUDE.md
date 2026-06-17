# Tempo Project

## GitHub Push Protocol
After making any code changes, always ask the user for permission to push to GitHub. If they approve, push immediately and automatically.

## Running the App
- Mobile: `cd mobile && npx expo start --ios`
- Requires `mobile/.env.local` with Supabase credentials (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

## Stack
- Expo ~56 (React Native) in `mobile/`
- Web in `web/`
- Backend: Supabase
