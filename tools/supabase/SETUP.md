# Turns sign-in: Supabase setup

**Status:** project `turns` (`wgysofnocxigucqocxed`, us-east-1) is set up: the table and its rules (step 2),
URLs (step 3), email sign-in (step 4) and the game's config (step 6) are done. What's left is Google:
create the OAuth client (step 4), enable Google in Supabase, then add `'google'` to `providers` in
`public/turns/index.html`.

Sign-in stays hidden in the game until step 6 is done, so you can do these in any order.

## 1. Create the project
1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is quickest).
2. **New project**. Name it e.g. `turns`, set a database password (save it somewhere), pick the region closest to your players.

## 2. Create the table
1. Dashboard → **SQL Editor** → **New query**.
2. Paste all of [`schema.sql`](schema.sql) and click **Run**.

## 3. Tell Supabase where the game lives
Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: `https://alexwp.com/turns/`
- **Redirect URLs**: add `https://alexwp.com/turns/`

## 4. Turn on Google and email sign-in
Dashboard → **Authentication** → **Sign In / Providers**. The Google provider shows a **Callback URL** like
`https://<your-project>.supabase.co/auth/v1/callback`; you'll paste it into Google's settings below. The game only offers Google and email; leave the other providers off.

- **Email** (magic link): on by default. Nothing to do. The free plan only sends a few emails per hour;
  for real traffic, add your own SMTP under Authentication → Emails.
- **Google**:
  1. https://console.cloud.google.com/apis/credentials → **Create credentials** → **OAuth client ID**
     (if asked, set up the consent screen first: External, app name "Turns", your email).
  2. Type **Web application**. Under **Authorized redirect URIs** add the Supabase callback URL.
  3. Copy the **Client ID** and **Client secret** into Supabase's Google provider and enable it.

## 5. Copy the project's public details
Dashboard → **Project Settings** → **API**: copy the **Project URL** and the **anon public** key.
The anon key is designed to be public; row-level security (step 2) is what protects each player's data.
Never put the `service_role` key in the game.

## 6. Put them in the game
In `public/turns/index.html`, set `url` and `anonKey` (the publishable key) in `TURNS_CONFIG.supabase`,
then push to `main`.

## Notes
- Free projects pause after a week with no activity. The game keeps working from the browser while paused;
  restore the project from the dashboard to resume syncing.
- The hint-reveal balance is stored in the player's row, which the player can write to. That's fine while
  reveals are free; before selling them, move the balance to a column only a server function can change.
