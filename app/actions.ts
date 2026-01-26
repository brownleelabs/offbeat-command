'use server'

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// 1. The Secure Claim Function
export async function claimToken(id: string) {
  console.log("Attempting to claim:", id)
  
  const { data, error } = await supabase
    .from('tokens')
    .update({ status: 'found' })
    .eq('id', id)
    .select()

  if (error) {
    console.error("Supabase Error:", error)
    throw new Error(error.message)
  }
  
  return { success: true }
}

// 2. The Reset Function (For your demo reset)
export async function resetDemo() {
  await supabase
    .from('tokens')
    .update({ status: 'active' })
    .neq('status', 'active')
}