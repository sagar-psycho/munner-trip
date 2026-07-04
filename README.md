# Munnar trip app — setup guide

A private trip app for you and your friends: expenses with admin-approved
group splitting, a read-only itinerary, shared photo/video gallery, and
group + one-to-one chat. Only people you add can sign in.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell — login screen + app shell with the 4-5 tabs |
| `styles.css` | All styling |
| `firebase-config.js` | Your Firebase project keys + the admin email |
| `auth.js` | Sign in / sign out, loads each member's profile |
| `expenses.js` | Add expenses, admin approval queue, balance calculation |
| `planner.js` | Admin-edited / member-viewed itinerary |
| `media.js` | Photo/video upload + gallery |
| `chat.js` | Group chat + 1:1 chat |
| `admin.js` | Admin tab: add members, view roster |
| `app.js` | Ties it all together — tab routing, auth gating |
| `functions/index.js` | Cloud Function the Admin tab calls to create member accounts |
| `firestore.rules` | Database security rules (who can read/write what) |
| `storage.rules` | Storage security rules (who can upload/read media) |

## One-time setup (about 20–30 minutes)

### 1. Create the Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**.
3. In **Build → Firestore Database**, click **Create database** (production mode is fine — the rules file below locks it down).
4. In **Build → Storage**, click **Get started**.

### 2. Get your config and fill in `firebase-config.js`
1. In Project settings (gear icon) → General → Your apps, click the web icon `</>` to register a web app.
2. Copy the `firebaseConfig` object it gives you into `firebase-config.js`, replacing the placeholder values.

### 3. Deploy the security rules
You'll need the Firebase CLI once:
```bash
npm install -g firebase-tools
firebase login
firebase init
```
When `firebase init` asks, select **Firestore**, **Functions**, and **Storage**, and point it at the project you just created. It will ask to overwrite `firestore.rules` and `storage.rules` — say no if it tries to overwrite the ones already in this folder (they're already written for you), or just paste this project's rules files over the generated ones.

Then deploy:
```bash
firebase deploy --only firestore:rules,storage
```

### 4. Deploy the Cloud Function (lets you add members from the Admin tab)
This step requires Firebase's **Blaze (pay-as-you-go)** plan to be enabled on the project — it stays effectively free at this trip's scale (a handful of function calls total), but Firebase requires Blaze to be selected even for near-zero usage.

1. In the Firebase console, go to **Usage and billing** and switch to the Blaze plan.
2. Set the admin secret (pick any random string):
   ```bash
   firebase functions:config:set trip.secret="pick-a-long-random-string"
   ```
3. Deploy:
   ```bash
   firebase deploy --only functions
   ```
4. Copy the function URL it prints (looks like `https://us-central1-yourproject.cloudfunctions.net/addMember`) into `admin.js`, replacing `FUNCTION_URL`. Also paste the same secret you set above into `ADMIN_SECRET` in `admin.js`.

### 5. Set your admin password
1. In the Firebase console, go to **Authentication → Users → Add user**.
2. Add yourself: `kothakulasagar2002@gmail.com` with a password you'll remember.
3. That's it — the app auto-detects this email as admin on first login and creates your profile.

### 6. Host it
Easiest option, since you're already using Firebase:
```bash
firebase init hosting
firebase deploy --only hosting
```
This gives you a free `https://yourproject.web.app` URL to share. Alternatively, you can open `index.html` directly or host it anywhere static (Netlify, GitHub Pages) — it's plain HTML/CSS/JS with no build step.

## How it works day to day

- **You (admin)**: sign in, go to the **Admin** tab, add each friend by name + email + a temporary password. Share that password with them directly. You'll also see a **Pending approval** section on the Expenses tab — approve or reject group expenses there.
- **Friends**: sign in with the email + password you gave them. They can log expenses (individual or group), view the itinerary, upload/download photos and videos, and chat.
- **Group expense flow**: a member logs a ₹2,000 group expense for food → it shows as pending → you approve it → it's split equally across all current members (including the payer) → the Balances card updates live for everyone.
- **Planner**: only you can add or delete itinerary items (pickups, bus times, train times). Everyone sees the same read-only timeline, sorted by the time text you enter.

## Notes and limits

- The admin-secret approach in `functions/index.js` is intentionally simple for a small friend-group trip — anyone with the function URL and secret could add members, so don't post them publicly. Let me know if you'd rather have it verify your actual login token instead, which is a bit more setup but tighter.
- Balances assume an equal split every time. If you want unequal splits (e.g. someone skips a meal), tell me and I'll add a "split between selected members" option.
- Firebase's free tier (Spark) covers Auth, Firestore, and Storage for this trip's scale comfortably. Only Cloud Functions requires Blaze to be enabled, and your usage will stay near ₹0.
