'use server'

import { createClient } from '@supabase/supabase-js'

// Helper to get a fresh connection every time
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase API Keys on Server")
  }

  return createClient(url, key)
}

export async function claimToken(id: string) {
  console.log("Server Action: Claiming ID:", id)

  // 1. Initialize inside the function (The Fix)
  const supabase = getSupabase()
  
  // 2. Perform the update
  const { data, error } = await supabase
    .from('tokens')
    .update({ status: 'found' })
    .eq('id', id)
    .select()

  // 3. Handle errors explicitly
  if (error) {
    console.error("Supabase Write Error:", error)
    throw new Error(error.message)
  }
  
  if (!data || data.length === 0) {
    console.error("No row updated. ID might be wrong:", id)
    throw new Error("Token ID not found in database")
  }
  
  return { success: true }
}

export async function resetDemo() {
  const supabase = getSupabase()
  await supabase
    .from('tokens')
    .update({ status: 'active' })
    .neq('status', 'active')
}