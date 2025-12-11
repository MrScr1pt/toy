# Toy Chat - Setup Instructions

A simple text, voice, and video chat app built with Electron, Supabase, and LiveKit.

## 🚀 Quick Setup

### Step 1: Install Dependencies

Open a terminal in this folder and run:

```bash
npm install
```

### Step 2: Set Up Supabase Database

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Open your project: `wnyxdfoydxsbkhtujsxm`
3. Go to **SQL Editor** (left sidebar)
4. Copy and paste the contents of `supabase/setup.sql`
5. Click **Run** to execute

This creates the `messages` table with real-time enabled.

### Step 3: Deploy the LiveKit Token Edge Function

You need the Supabase CLI for this. Install it first:

```bash
npm install -g supabase
```

Then login and deploy:

```bash
# Login to Supabase
supabase login

# Link to your project (you'll need your project ref)
supabase link --project-ref wnyxdfoydxsbkhtujsxm

# Set the LiveKit secrets
supabase secrets set LIVEKIT_API_KEY=APICPAyJFc5N6yu
supabase secrets set LIVEKIT_API_SECRET=aqIdclz8vAjmsKApubfxpSFHASBxzn7wPjpUNUY1MsE

# Deploy the edge function
supabase functions deploy livekit-token --no-verify-jwt
```

### Step 4: Run the App

```bash
npm start
```

## 📦 Building the Installer

To create an MSI installer:

```bash
npm run build
```

The installer will be in the `dist` folder.

## 🎮 How to Use

1. Enter a username
2. Enter a room name (or leave blank for "general")
3. Click "Join Room"
4. **Text Chat**: Type messages and hit Enter or click Send
5. **Voice/Video Call**: Click the 📞 button to join voice
6. **Camera**: Click 📷 to enable camera
7. **Screen Share**: Click 🖥️ to share screen

## 🧪 Testing with a Friend

1. Build the installer: `npm run build`
2. Send the installer from `dist` folder to your friend
3. Both of you enter the **same room name**
4. You should see each other in the online users list
5. Text messages will sync in real-time
6. Click the phone button to join voice/video together

## ⚠️ Troubleshooting

### "Database table not set up" error
- Run the SQL from `supabase/setup.sql` in your Supabase SQL Editor

### "Could not connect to voice/video" error
- Make sure you deployed the Edge Function (Step 3)
- Check that the function is running: go to Supabase Dashboard → Edge Functions

### Users can't see each other
- Make sure you're using the **exact same room name** (case-sensitive)
- Check your internet connection

### Voice/Video not working
- Allow microphone/camera permissions when prompted
- Try a different browser/device to test

## 🔧 Configuration

All configuration is in `src/renderer/app.js`:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anon/public key
- `LIVEKIT_URL` - Your LiveKit server URL
