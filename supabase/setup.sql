-- =====================================================
-- TOY CHAT - Supabase Database Setup
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room TEXT NOT NULL DEFAULT 'general',
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster room queries
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read messages (for simplicity, no auth)
CREATE POLICY "Allow public read access" ON messages
  FOR SELECT USING (true);

-- Allow anyone to insert messages (for simplicity, no auth)
CREATE POLICY "Allow public insert access" ON messages
  FOR INSERT WITH CHECK (true);

-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- =====================================================
-- DONE! Your database is ready.
-- =====================================================
