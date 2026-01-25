'use server'

import { createClient } from '@/lib/supabase' 
// Note: We switch to your lib helper to ensure consistency

export async function resetDemo() {
  const supabase = createClient()

  // Reset all tokens to 'active'
  const { error } = await supabase
    .from('tokens')
    .update({ status: 'active' })
    .neq('status', 'active') 

  if (error) console.error('Reset failed:', error)
  return { success: !error }
}