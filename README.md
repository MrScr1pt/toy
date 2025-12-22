# 🏕️ Toy Chat

A Discord-inspired chat application with a unique Turkic/Ancient Steppe aesthetic. Built with Electron, Supabase, and LiveKit for real-time text, voice, and video communication.

![Toy Chat](https://img.shields.io/badge/version-1.0.5-blue) ![Electron](https://img.shields.io/badge/Electron-28.x-47848F?logo=electron) ![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?logo=supabase) ![LiveKit](https://img.shields.io/badge/LiveKit-Voice%2FVideo-FF6B6B)

## ✨ Features

- **Unique "Gathering Hub" Design** - Central Otağ (yurt) with floating server bubbles
- **Real-time Messaging** - Instant text chat powered by Supabase Realtime
- **Voice & Video Calls** - High-quality WebRTC calls via LiveKit
- **Email Authentication** - Secure sign up/sign in with Supabase Auth
- **Toys (Servers)** - Create and join community spaces
- **Turkic-Inspired UI** - Deep steppe blues, gold accents, and traditional motifs

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Supabase Account](https://supabase.com/) (free tier works)
- [LiveKit Cloud Account](https://livekit.io/) (free tier available)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/toy_2.git
   cd toy_2
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Open `src/renderer/app.js` and update with your own credentials:
   ```javascript
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'your-supabase-anon-key';
   const LIVEKIT_URL = 'wss://your-project.livekit.cloud';
   ```

4. **Set up Supabase Database**
   
   - Go to your [Supabase Dashboard](https://supabase.com/dashboard)
   - Open the SQL Editor
   - Run the contents of `supabase_setup.sql` to create tables

5. **Deploy LiveKit Token Function**
   ```bash
   # Install Supabase CLI
   npm install -g supabase
   
   # Login and link your project
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   
   # Set your LiveKit secrets
   supabase secrets set LIVEKIT_API_KEY=your-livekit-api-key
   supabase secrets set LIVEKIT_API_SECRET=your-livekit-api-secret
   
   # Deploy the edge function
   supabase functions deploy livekit-token --no-verify-jwt
   ```

6. **Run the app**
   ```bash
   npm start
   ```

## 📦 Building

Create a distributable installer:

```bash
npm run build
```

The installer will be generated in the `dist` folder.

## 🎮 Usage

1. **Sign Up/Sign In** - Create an account or log in with email
2. **Create a Toy** - Click "Create Toy" to start your own server
3. **Join a Toy** - Enter an invite code to join an existing server
4. **Chat** - Send messages in real-time
5. **Voice/Video** - Click the call button to start a voice/video session

## 🏗️ Project Structure

```
toy_2/
├── src/
│   ├── main/           # Electron main process
│   │   └── main.js
│   └── renderer/       # Frontend UI
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── supabase/
│   └── functions/      # Edge functions (LiveKit token)
├── supabase_setup.sql  # Database schema
└── package.json
```

## 🔐 Security Note

This repo requires your own Supabase and LiveKit credentials. **Never commit your actual API keys to a public repository.** The credentials in `app.js` should be replaced with your own before running.

**Required credentials:**
- Supabase URL & Anon Key (from Supabase Dashboard → Settings → API)
- LiveKit URL, API Key & Secret (from LiveKit Cloud Dashboard)

## 🛠️ Tech Stack

- **Electron** - Desktop application framework
- **Supabase** - Authentication, PostgreSQL database, Realtime subscriptions
- **LiveKit** - WebRTC infrastructure for voice/video
- **Vanilla JS** - No frontend framework, pure JavaScript

## ⚠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| "Database table not set up" | Run `supabase_setup.sql` in Supabase SQL Editor |
| Voice/Video not connecting | Ensure LiveKit edge function is deployed and secrets are set |
| Users can't see each other | Check you're in the same Toy (server) |
| Auth errors | Verify your Supabase URL and anon key are correct |

## 📄 License

MIT License - feel free to use this project as a starting point for your own chat application!

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

*Inspired by the vast steppes and rich traditions of Central Asian nomadic cultures* 🌙
