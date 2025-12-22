-- ==========================================
-- TOY APP - Database Setup
-- Run this in your Supabase SQL Editor
-- ==========================================

-- Add toy_id to messages table (run this first!)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS toy_id UUID REFERENCES toys(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_toy ON messages(toy_id);

-- Create toys table (servers/communities)
CREATE TABLE IF NOT EXISTS toys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '🏕️',
  is_public BOOLEAN DEFAULT true,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create toy_members table (who belongs to which toy)
CREATE TABLE IF NOT EXISTS toy_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  toy_id UUID REFERENCES toys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(toy_id, user_id)
);

-- Create toy_invites table (invite codes)
CREATE TABLE IF NOT EXISTS toy_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  toy_id UUID REFERENCES toys(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ,
  max_uses INT,
  uses INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create channels table (text/voice channels within a toy)
CREATE TABLE IF NOT EXISTS channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  toy_id UUID REFERENCES toys(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'text' CHECK (type IN ('text', 'voice')),
  position INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE toys ENABLE ROW LEVEL SECURITY;
ALTER TABLE toy_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE toy_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe to re-run)
DROP POLICY IF EXISTS "Anyone can view public toys" ON toys;
DROP POLICY IF EXISTS "Members can view their toys" ON toys;
DROP POLICY IF EXISTS "Authenticated users can create toys" ON toys;
DROP POLICY IF EXISTS "Owners can update their toys" ON toys;
DROP POLICY IF EXISTS "Owners can delete their toys" ON toys;
DROP POLICY IF EXISTS "Members can view toy membership" ON toy_members;
DROP POLICY IF EXISTS "Users can join toys" ON toy_members;
DROP POLICY IF EXISTS "Users can leave toys" ON toy_members;
DROP POLICY IF EXISTS "Anyone can view invite codes" ON toy_invites;
DROP POLICY IF EXISTS "Admins can create invites" ON toy_invites;
DROP POLICY IF EXISTS "Members can view channels" ON channels;
DROP POLICY IF EXISTS "Admins can create channels" ON channels;
DROP POLICY IF EXISTS "Admins can update channels" ON channels;
DROP POLICY IF EXISTS "Admins can delete channels" ON channels;

-- RLS Policies for toys
CREATE POLICY "Anyone can view public toys" ON toys
  FOR SELECT USING (is_public = true);

CREATE POLICY "Members can view their toys" ON toys
  FOR SELECT USING (
    id IN (SELECT toy_id FROM toy_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create toys" ON toys
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their toys" ON toys
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their toys" ON toys
  FOR DELETE USING (auth.uid() = owner_id);

-- RLS Policies for toy_members
-- Fix: Don't query toy_members to check toy_members access (infinite recursion)
CREATE POLICY "Members can view toy membership" ON toy_members
  FOR SELECT USING (
    user_id = auth.uid() OR 
    toy_id IN (SELECT id FROM toys WHERE owner_id = auth.uid())
  );

CREATE POLICY "Users can join toys" ON toy_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave toys" ON toy_members
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for toy_invites
CREATE POLICY "Anyone can view invite codes" ON toy_invites
  FOR SELECT USING (true);

CREATE POLICY "Admins can create invites" ON toy_invites
  FOR INSERT WITH CHECK (
    toy_id IN (
      SELECT toy_id FROM toy_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- RLS Policies for channels
CREATE POLICY "Members can view channels" ON channels
  FOR SELECT USING (
    toy_id IN (SELECT toy_id FROM toy_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can create channels" ON channels
  FOR INSERT WITH CHECK (
    toy_id IN (
      SELECT toy_id FROM toy_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update channels" ON channels
  FOR UPDATE USING (
    toy_id IN (
      SELECT toy_id FROM toy_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete channels" ON channels
  FOR DELETE USING (
    toy_id IN (
      SELECT toy_id FROM toy_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_toy_members_user ON toy_members(user_id);
CREATE INDEX IF NOT EXISTS idx_toy_members_toy ON toy_members(toy_id);
CREATE INDEX IF NOT EXISTS idx_channels_toy ON channels(toy_id);
CREATE INDEX IF NOT EXISTS idx_toy_invites_code ON toy_invites(code);
