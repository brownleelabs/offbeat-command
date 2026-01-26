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

/** Reset all tokens to active. Pass orgId to only reset tokens for that org (RLS-friendly). */
export async function resetDemo(orgId?: string | null) {
  const supabase = getSupabase()
  let query = supabase
    .from('tokens')
    .update({ status: 'active' })
    .neq('status', 'active')
  if (orgId != null) {
    query = query.eq('organization_id', orgId)
  }
  const { error } = await query
  if (error) {
    console.error('resetDemo:', error)
    throw new Error(error?.message ?? 'Reset failed')
  }
}